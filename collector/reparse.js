#!/usr/bin/env node
// raw/ の生データを読み直して、スナップショットと videos.json を作り直す。
//
//   node collector/reparse.js --dry-run
//   node collector/reparse.js --event 2026-summer --parser sds-history-v2 --dry-run
//
// **--dry-run はパーサの回帰確認そのものである。**
// 差分 0 が「解析結果が変わっていない」ことの担保になる。テストコードを置かない
// 代わりの手段なので、パーサに手を入れたら必ず通す。
//
// HTTP は 1 回も出さない。git commit / push もしない。

import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { compareHourKey, epochToIso } from './lib/hours.js';
import * as store from './lib/store.js';
import { ParseError, resolveFinalParser, resolveHourlyParser } from './parsers/index.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/** videos.json のマージで使う sourceHour。辞書順でどの時刻キーよりも後になる。 */
const FINAL_SOURCE_HOUR = 'final';

const USAGE = `使い方: node collector/reparse.js [--event <eventId>] [--parser <name>] [--dry-run]

  --event <eventId>   対象の開催回（既定: 全開催回）
  --parser <name>     毎時履歴のパーサ（既定: event.json の parser）
  --dry-run           書き換えず、差分の有無だけを報告する
  --help

差分または異常があれば終了コード 1 で終わる。
`;

const relative = (filePath) => path.relative(ROOT, filePath).split(path.sep).join('/');

/**
 * 1 開催回を raw から作り直す。
 *
 * `capturedAt` と `source.url` は生データから導けないため、既存のファイルから
 * 引き継ぐ。こうすると差分に出るのはパーサの出力だけになり、`--dry-run` が
 * そのまま回帰確認として使える。
 */
function reparseEvent(event, options) {
  const parserName = options.parser ?? event.parser;
  const parser = resolveHourlyParser(parserName);
  const changed = [];
  const problems = [];

  // videos.json は空から作り直す。既存に足すと、パーサが返さなくなった動画が
  // いつまでも残り、raw だけを根拠にした状態にならない。
  const videos = { videos: {}, changed: false };
  const states = new Map(
    event.divisions.map((division) => [
      division,
      store.readIndexState(ROOT, event.eventId, division),
    ]),
  );

  // 時刻順・部門順に流す。collect.js の取得順と揃えることで、同じ時刻に同じ動画が
  // 複数部門から入る場合も収集時と同じ結果になる。
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

    // raw/hourly には保存に至った時刻だけが入っている。ここで保存対象から外れるのは
    // パーサの挙動が変わったということなので、差分ではなく異常として報告する。
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
    // 集計期間が変わった旨の警告は収集時に出ているので、ここでは受け取らない。
    // 実際に値が変わっていれば index.json の差分として出る。
    store.recordAggregationPeriod(state, parsed.ranking);
    store.addCollected(state, hourKey, parsed.entries.length);
    store.mergeVideos(videos, parsed.videos, hourKey);
  }

  reparseFinal(event, videos, changed, problems, options);

  // index.json は unavailable を生データから導けないため、既存のものに
  // entryCount と aggregationPeriod だけを上書きする。
  const now = epochToIso(Date.now());
  for (const state of states.values()) {
    const filePath = store.indexJsonPath(ROOT, event.eventId, state.division);
    const keptAt = store.readJsonFile(filePath)?.updatedAt ?? now;
    // まず updatedAt を据え置いたまま判定する。中身が変わっていなければ
    // 再解析しただけで updatedAt の差分を出さない。
    if (!store.writeIndexState(ROOT, state, keptAt, true)) continue;
    store.writeIndexState(ROOT, state, now, options.dryRun);
    changed.push(relative(filePath));
  }

  if (store.writeVideos(ROOT, event.eventId, videos, options.dryRun)) {
    changed.push(relative(store.videosJsonPath(ROOT, event.eventId)));
  }

  return { hourlyCount: items.length, changed, problems };
}

/** 最終ランキングを raw から作り直す。未取得の部門は飛ばす。 */
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
  // --dry-run で差分が出たらパーサの出力が変わったということなので失敗させる。
  if (problemTotal > 0 || (options.dryRun && changedTotal > 0)) process.exitCode = 1;
}

if (import.meta.main) await main();
