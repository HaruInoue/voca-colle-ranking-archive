#!/usr/bin/env node
// rawデータを再解析する。

import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { compareHourKey, epochToIso } from './lib/hours.js';
import * as store from './lib/store.js';
import { ParseError, resolveFinalParser, resolveHourlyParser } from './parsers/index.js';

const ROOT = path.resolve(import.meta.dirname, '..');

const FINAL_SOURCE_HOUR = 'final';

const USAGE = `使い方: node collector/reparse.js [--event <eventId>] [--parser <name>] [--dry-run]

  --event <eventId>   対象の開催回（既定: 全開催回）
  --parser <name>     毎時履歴のパーサ（既定: event.json の parser）
  --dry-run           書き換えず、差分の有無だけを報告する
  --help

差分または異常があれば終了コード 1 で終わる。
`;

const relative = (filePath) => path.relative(ROOT, filePath).split(path.sep).join('/');

/** 1開催回をrawデータから再構築する。 */
function reparseEvent(event, options) {
  const parserName = options.parser ?? event.parser;
  const parser = resolveHourlyParser(parserName);
  const changed = [];
  const problems = [];

  const videos = { videos: {}, changed: false };
  const states = new Map(
    event.divisions.map((division) => [
      division,
      store.readIndexState(ROOT, event.eventId, division),
    ]),
  );

  const items = event.divisions
    .flatMap((division, divisionIndex) =>
      store
        .listRawHourKeys(ROOT, event.eventId, division)
        .map((hourKey) => ({ division, divisionIndex, hourKey })),
    )
    .sort((a, b) => compareHourKey(a.hourKey, b.hourKey) || a.divisionIndex - b.divisionIndex);

  for (const { division, hourKey } of items) {
    const label = `${division} ${hourKey}`;
    const rawText = store.readRaw(store.rawSnapshotPath(ROOT, event.eventId, division, hourKey));

    let parsed;
    try {
      parsed = parser.parse(rawText, { eventTag: event.eventTag });
    } catch (cause) {
      if (!(cause instanceof ParseError)) throw cause;
      problems.push(`${label}: 解析に失敗（${cause.message}）`);
      continue;
    }

    if (parsed.status !== 'ok') {
      problems.push(`${label}: status が ${parsed.status} になった`);
      continue;
    }
    if (!parsed.ranking.tag.includes(event.eventTag)) {
      problems.push(`${label}: setting.tag に ${event.eventTag} が含まれない（${parsed.ranking.tag}）`);
      continue;
    }

    const prev = store.readJsonFile(store.snapshotPath(ROOT, event.eventId, division, hourKey));
    if (!prev) {
      problems.push(`${label}: スナップショットが無い（capturedAt と URL を引き継げない）`);
      continue;
    }

    const snapshot = store.buildSnapshot({
      eventId: event.eventId,
      division,
      hourKey,
      capturedAt: prev.capturedAt,
      url: prev.source.url,
      parser: parserName,
      ranking: parsed.ranking,
      columns: parser.columns,
      entries: parsed.entries,
    });
    if (store.writeSnapshot(ROOT, snapshot, options.dryRun)) {
      changed.push(relative(store.snapshotPath(ROOT, event.eventId, division, hourKey)));
    }

    const state = states.get(division);
    store.recordAggregationPeriod(state, parsed.ranking);
    store.addCollected(state, hourKey, parsed.entries.length);
    store.mergeVideos(videos, parsed.videos, hourKey);
  }

  reparseFinal(event, videos, changed, problems, options);

  const now = epochToIso(Date.now());
  for (const state of states.values()) {
    const filePath = store.indexJsonPath(ROOT, event.eventId, state.division);
    const keptAt = store.readJsonFile(filePath)?.updatedAt ?? now;
    if (!store.writeIndexState(ROOT, state, keptAt, true)) continue;
    store.writeIndexState(ROOT, state, now, options.dryRun);
    changed.push(relative(filePath));
  }

  if (store.writeVideos(ROOT, event.eventId, videos, options.dryRun)) {
    changed.push(relative(store.videosJsonPath(ROOT, event.eventId)));
  }

  return { hourlyCount: items.length, changed, problems };
}

/** 最終ランキングをrawデータから再構築する。 */
function reparseFinal(event, videos, changed, problems, options) {
  if (!event.finalParser) return;
  const parser = resolveFinalParser(event.finalParser);

  for (const division of event.divisions) {
    const rawText = store.readRaw(store.rawFinalPath(ROOT, event.eventId, division));
    if (rawText === null) continue;

    let parsed;
    try {
      parsed = parser.parse(rawText, { division });
    } catch (cause) {
      if (!(cause instanceof ParseError)) throw cause;
      problems.push(`${division} final: 解析に失敗（${cause.message}）`);
      continue;
    }
    if (parsed.pageId !== null && parsed.pageId !== division) {
      problems.push(`${division} final: 別の部門のページ（pageId: ${parsed.pageId}）`);
      continue;
    }

    const filePath = store.finalPath(ROOT, event.eventId, division);
    const prev = store.readJsonFile(filePath);
    if (!prev) {
      problems.push(`${division} final: 最終ランキングが無い（capturedAt と URL を引き継げない）`);
      continue;
    }

    const final = store.buildFinalRanking({
      eventId: event.eventId,
      division,
      capturedAt: prev.capturedAt,
      url: prev.source.url,
      parser: event.finalParser,
      columns: parser.columns,
      entries: parsed.entries,
    });
    if (store.writeFinalRanking(ROOT, final, options.dryRun)) changed.push(relative(filePath));

    store.mergeVideos(videos, parsed.videos, FINAL_SOURCE_HOUR);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      event: { type: 'string' },
      parser: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const options = { parser: values.parser ?? null, dryRun: values['dry-run'] };

  const events = values.event ? [store.readEvent(ROOT, values.event)] : store.readEvents(ROOT);
  let changedTotal = 0;
  let problemTotal = 0;

  for (const event of events) {
    const { hourlyCount, changed, problems } = reparseEvent(event, options);
    console.log(
      `\n${event.eventId}（${options.parser ?? event.parser}）` +
        `  毎時 ${hourlyCount} 件 / ${options.dryRun ? '差分' : '書き換え'} ${changed.length}` +
        (problems.length > 0 ? ` / 異常 ${problems.length}` : ''),
    );
    for (const line of changed) console.log(`  ${options.dryRun ? '差分' : '書換'} ${line}`);
    for (const line of problems) console.log(`  異常 ${line}`);
    changedTotal += changed.length;
    problemTotal += problems.length;
  }

  console.log(
    `\n${events.length} 開催回。` +
      (options.dryRun ? `差分 ${changedTotal}` : `書き換え ${changedTotal}`) +
      ` / 異常 ${problemTotal}`,
  );
  if (problemTotal > 0 || (options.dryRun && changedTotal > 0)) process.exitCode = 1;
}

if (import.meta.main) await main();
