#!/usr/bin/env node
// 最終ランキングの取得。開催回あたり 1 回、手動で実行する。
//
//   node collector/finalize.js --event 2025-summer
//
// 最終ランキングがいつ公開され、いつアーカイブパスが作られるかを公式から
// 機械的に判定する手段がないため、自動化しない（04-collector.md 4.2）。
//
// git commit / push は行わない。手元でファイル出力までを行う。

import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { epochToIso, isoToEpoch } from './lib/hours.js';
import * as store from './lib/store.js';
import { FetchError, fetchText } from './lib/http.js';
import { ParseError, resolveFinalParser } from './parsers/index.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * 投稿期間に収まっているべきエントリの割合。
 * 全件一致は条件にできない。2026 冬のアーカイブページには投稿期間外の
 * registeredAt を持つエントリが 1 件含まれていた（02-data-source.md 5 節）。
 */
const MIN_IN_PERIOD_RATIO = 0.9;

/** videos.json のマージで使う sourceHour。辞書順でどの時刻キーよりも後になる。 */
const FINAL_SOURCE_HOUR = 'final';

const USAGE = `使い方: node collector/finalize.js --event <eventId>

  --event <eventId>   対象の開催回（必須）
  --division <name>   部門を 1 つだけ処理する（既定: event.json の全部門）
  --help
`;

/** アーカイブページの HTML を取得して検証し、最終ランキングとして保存する。 */
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
    // アーカイブページがまだ作られていない。毎時履歴の not-published と同じで、
    // 予期された状態であり記録しない（06-decisions.md D-32）。
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

  // 目的の部門のページかを確認する。毎時履歴の setting.tag に相当する検証。
  if (parsed.pageId !== null && parsed.pageId !== division) {
    return { division, ok: false, message: `別の部門のページ（pageId: ${parsed.pageId}）` };
  }

  // 開催期間中は日付なしのパスに前回開催の最終ランキングが出るため、
  // どの開催回のデータかを registeredAt で判別する。
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

  // 生データとスナップショットは必ず同じ取得結果から書く。
  // 片方だけ残すと raw/ からの再解析が一致しなくなるため、ここは上書きを許す。
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

/** registeredAt が投稿期間に収まっているエントリの割合を数える。 */
function checkSubmissionPeriod(event, videos) {
  const from = isoToEpoch(event.final.submissionFrom, `${event.eventId}: final.submissionFrom`);
  const until = isoToEpoch(event.final.submissionUntil, `${event.eventId}: final.submissionUntil`);

  let inPeriod = 0;
  let total = 0;
  let sample = null;
  for (const [watchId, video] of Object.entries(videos)) {
    if (!video.registeredAt) continue;
    total += 1;
    // オフセットの無い文字列はローカル時刻として解釈されるため、期間外として数える。
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
  // 保存できなかった部門があれば失敗させる（静かに欠測させない）。
  if (failed.length > 0) process.exitCode = 1;
}

await main();
