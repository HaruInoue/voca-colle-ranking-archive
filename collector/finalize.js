#!/usr/bin/env node
// 最終ランキングを取得する。

import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { epochToIso, isoToEpoch } from './lib/hours.js';
import * as store from './lib/store.js';
import { FetchError, fetchText } from './lib/http.js';
import { ParseError, resolveFinalParser } from './parsers/index.js';

const ROOT = path.resolve(import.meta.dirname, '..');

const MIN_IN_PERIOD_RATIO = 0.9;

const FINAL_SOURCE_HOUR = 'final';

const USAGE = `使い方: node collector/finalize.js --event <eventId>

  --event <eventId>   対象の開催回（必須）
  --division <name>   部門を 1 つだけ処理する（既定: event.json の全部門）
  --help
`;

/** 最終ランキングを取得して保存する。 */
async function finalizeDivision(root, event, parser, division) {
  const url = event.final.archiveUrlTemplate.replace('{division}', division);

  let response;
  try {
    response = await fetchText(url);
  } catch (cause) {
    if (!(cause instanceof FetchError)) throw cause;
    return { division, ok: false, message: `取得に失敗（${cause.message}）` };
  }
  if (response.status === 404) {
    return { division, ok: false, notYet: true, message: 'アーカイブページがまだ作られていない' };
  }
  if (response.status !== 200) {
    return { division, ok: false, message: `HTTP ${response.status}` };
  }

  let parsed;
  try {
    parsed = parser.parse(response.text, { division });
  } catch (cause) {
    if (!(cause instanceof ParseError)) throw cause;
    store.writeRawIfAbsent(
      store.rawAnomalyPath(root, event.eventId, 'parse-failed', 'final', `${division}.html.gz`),
      response.text,
    );
    return { division, ok: false, message: `解析に失敗（${cause.message}）` };
  }

  if (parsed.pageId !== null && parsed.pageId !== division) {
    return { division, ok: false, message: `別の部門のページ（pageId: ${parsed.pageId}）` };
  }

  const check = checkSubmissionPeriod(event, parsed.videos);
  if (check.ratio < MIN_IN_PERIOD_RATIO) {
    return {
      division,
      ok: false,
      message:
        `別の開催回のデータ（投稿期間内 ${check.inPeriod}/${check.total} = ` +
        `${Math.round(check.ratio * 100)}%、${Math.round(MIN_IN_PERIOD_RATIO * 100)}% 未満）` +
        `${check.sample ? ` 例: ${check.sample}` : ''}`,
    };
  }

  store.writeRaw(store.rawFinalPath(root, event.eventId, division), response.text);
  store.writeFinalRanking(
    root,
    store.buildFinalRanking({
      eventId: event.eventId,
      division,
      capturedAt: epochToIso(Date.now()),
      url,
      parser: event.finalParser,
      columns: parser.columns,
      entries: parsed.entries,
    }),
  );

  return {
    division,
    ok: true,
    url,
    videos: parsed.videos,
    entryCount: parsed.entries.length,
    inPeriodRatio: check.ratio,
  };
}

/** 投稿期間内のエントリ比率を数える。 */
function checkSubmissionPeriod(event, videos) {
  const from = isoToEpoch(event.final.submissionFrom, `${event.eventId}: final.submissionFrom`);
  const until = isoToEpoch(event.final.submissionUntil, `${event.eventId}: final.submissionUntil`);

  let inPeriod = 0;
  let total = 0;
  let sample = null;
  for (const [watchId, video] of Object.entries(videos)) {
    if (!video.registeredAt) continue;
    total += 1;
    const at = /(?:Z|[+-]\d{2}:?\d{2})$/.test(video.registeredAt)
      ? Date.parse(video.registeredAt)
      : Number.NaN;
    if (!Number.isNaN(at) && at >= from && at <= until) inPeriod += 1;
    else if (sample === null) sample = `${watchId} ${video.registeredAt}`;
  }
  return { inPeriod, total, ratio: total === 0 ? 0 : inPeriod / total, sample };
}

function requireFinalConfig(event) {
  const missing = ['archiveUrlTemplate', 'submissionFrom', 'submissionUntil'].filter(
    (key) => !event.final?.[key],
  );
  if (missing.length > 0) {
    throw new Error(`${event.eventId}/event.json: final.${missing.join(' / final.')} が無い`);
  }
  if (!event.finalParser) throw new Error(`${event.eventId}/event.json: finalParser が無い`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      event: { type: 'string' },
      division: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || !values.event) {
    console.log(USAGE);
    if (!values.help) process.exitCode = 1;
    return;
  }

  const event = store.readEvent(ROOT, values.event);
  requireFinalConfig(event);
  const parser = resolveFinalParser(event.finalParser);

  if (values.division && !event.divisions.includes(values.division)) {
    throw new Error(`${event.eventId} に部門 ${values.division} が無い`);
  }
  const divisions = values.division ? [values.division] : event.divisions;

  const videos = store.readVideos(ROOT, event.eventId);
  const results = [];

  for (const division of divisions) {
    const result = await finalizeDivision(ROOT, event, parser, division);
    results.push(result);

    if (result.ok) {
      store.mergeVideos(videos, result.videos, FINAL_SOURCE_HOUR);
      console.log(
        `[${event.eventId}/${division}] saved（${result.entryCount} 件 / ` +
          `投稿期間内 ${Math.round(result.inPeriodRatio * 100)}%）`,
      );
    } else {
      console.log(`[${event.eventId}/${division}] ${result.message}`);
    }
    if (!result.notYet) {
      store.appendLog(ROOT, event.eventId, {
        at: epochToIso(Date.now()),
        division,
        target: 'final',
        result: result.ok ? 'saved' : 'failed',
        ...(result.ok ? { entryCount: result.entryCount } : { message: result.message }),
      });
    }
  }

  if (videos.changed) store.writeVideos(ROOT, event.eventId, videos);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 部門を保存した`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
