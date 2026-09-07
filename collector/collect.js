#!/usr/bin/env node
// 毎時ランキングを収集する。

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import {
  HOUR_MS,
  compareHourKey,
  enumerateHourKeys,
  epochToIso,
  hourKeyToEpoch,
  isoToEpoch,
  latestFetchableHourKey,
  minHourKey,
} from './lib/hours.js';
import * as store from './lib/store.js';
import { FetchError, fetchText } from './lib/http.js';
import { ParseError, resolveHourlyParser } from './parsers/index.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const HISTORY_BASE_URL = 'https://data.sds.nicovideo.jp/static/vocacolle-ranking-history';

const EXPIRE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

const USAGE = `使い方: node collector/collect.js [オプション]

  --event <eventId>            対象の開催回を指定する（collect.until を見ない）
  --assume-expired             HTTP 404 を保持期限切れとして即確定する（過去回の取り込み用）
  --dry-run                    候補時刻を表示するだけ。HTTP 取得もファイル出力もしない
  --max-requests <n>           collect.maxRequestsPerRun を上書きする（動作確認用）
  --commit-message-out <path>  コミットメッセージ 1 行を書き出す（ワークフロー用）
  --help
`;

// ---------------------------------------------------------------- 引数

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      event: { type: 'string' },
      'assume-expired': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'max-requests': { type: 'string' },
      'commit-message-out': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });

  let maxRequests = null;
  if (values['max-requests'] !== undefined) {
    maxRequests = Number(values['max-requests']);
    if (!Number.isInteger(maxRequests) || maxRequests < 0) {
      throw new Error(`--max-requests が 0 以上の整数でない: ${values['max-requests']}`);
    }
  }

  return {
    eventId: values.event ?? null,
    assumeExpired: values['assume-expired'],
    dryRun: values['dry-run'],
    maxRequests,
    commitMessageOut: values['commit-message-out'] ?? null,
    help: values.help,
  };
}

// ---------------------------------------------------------------- 対象の決定

function selectTargets(events, options, nowEpoch) {
  if (options.eventId) {
    const found = events.find((event) => event.eventId === options.eventId);
    if (!found) {
      throw new Error(
        `開催回 ${options.eventId} が無い（data/events/${options.eventId}/event.json を作成する）`,
      );
    }
    return [found];
  }
  return events.filter(
    (event) => nowEpoch <= isoToEpoch(event.collect.until, `${event.eventId}: collect.until`),
  );
}

/** 部門ごとの取得候補を作る。 */
function planEvent(event, nowEpoch, maxRequests) {
  const limit = maxRequests ?? event.collect.maxRequestsPerRun;
  const latestFetchable = latestFetchableHourKey(nowEpoch);
  const untilKey = minHourKey(event.collect.hourUntil, latestFetchable);
  const range = enumerateHourKeys(event.collect.hourFrom, untilKey);

  const divisions = event.divisions.map((division) => {
    const state = store.readIndexState(ROOT, event.eventId, division);
    const known = store.knownHourKeys(state);
    return {
      division,
      state,
      rangeCount: range.length,
      candidates: range.filter((hourKey) => !known.has(hourKey)),
    };
  });

  const queue = [];
  divisions.forEach((entry, divisionIndex) => {
    for (const hourKey of entry.candidates) queue.push({ entry, divisionIndex, hourKey });
  });
  queue.sort(
    (a, b) => compareHourKey(a.hourKey, b.hourKey) || a.divisionIndex - b.divisionIndex,
  );

  return {
    latestFetchable,
    untilKey,
    clamped: untilKey !== event.collect.hourUntil,
    limit,
    divisions,
    planned: queue.slice(0, limit),
    deferred: Math.max(0, queue.length - limit),
  };
}

/** 連続する時刻をまとめる。 */
function compressHourKeys(hourKeys) {
  const groups = [];
  for (const hourKey of hourKeys) {
    const last = groups.at(-1);
    if (last && hourKeyToEpoch(hourKey) === hourKeyToEpoch(last.to) + HOUR_MS) {
      last.to = hourKey;
      last.count += 1;
    } else {
      groups.push({ from: hourKey, to: hourKey, count: 1 });
    }
  }
  return groups.map((group) =>
    group.count === 1 ? group.from : `${group.from} .. ${group.to}（${group.count}）`,
  );
}

// ---------------------------------------------------------------- --dry-run

function printDryRun(event, plan, nowEpoch) {
  console.log(`\n${event.eventId}（${event.title}）`);
  console.log(`  parser              ${event.parser}`);
  console.log(`  現在時刻            ${epochToIso(nowEpoch)}`);
  console.log(`  取得できる最新時刻  ${plan.latestFetchable}`);
  console.log(
    `  収集範囲            ${event.collect.hourFrom} .. ${plan.untilKey}` +
      `（${plan.divisions[0]?.rangeCount ?? 0} 時刻）`,
  );
  if (plan.clamped) {
    console.log(
      `    ※ collect.hourUntil（${event.collect.hourUntil}）より「取得できる最新時刻」が古いため打ち切った`,
    );
  }
  for (const entry of plan.divisions) {
    console.log(
      `\n  ${entry.division}` +
        `  範囲 ${entry.rangeCount} / 取得済み ${entry.state.collected.length}` +
        ` / 取得不能 ${entry.state.unavailable.length} / 候補 ${entry.candidates.length}`,
    );
    for (const line of compressHourKeys(entry.candidates)) console.log(`    ${line}`);
  }
  console.log(
    `\n  この実行で取得する時刻: ${plan.planned.length}` +
      `（上限 ${plan.limit}` +
      (plan.deferred > 0 ? `、次回以降に残す ${plan.deferred}` : '') +
      '）',
  );
}

// ---------------------------------------------------------------- 収集

function logAttempt(eventId, { at, division, hourKey, httpStatus, result, ...extra }) {
  store.appendLog(ROOT, eventId, {
    at: at ?? epochToIso(Date.now()),
    division,
    hourKey,
    ...(typeof httpStatus === 'number' ? { httpStatus } : {}),
    result,
    ...extra,
  });
}

/** HTTP 404をexpiredと判断する時刻を返す。 */
function expireCutoffEpoch(event, state) {
  const endDateTime = state.aggregationPeriod?.endDateTime;
  const endEpoch = endDateTime
    ? isoToEpoch(endDateTime, `${state.division}: aggregationPeriod.endDateTime`)
    : hourKeyToEpoch(event.collect.hourUntil);
  return endEpoch + EXPIRE_AFTER_MS;
}

/** HTTP 404を分類する。 */
function classifyNotFound(event, state, hourKey, nowEpoch, assumeExpired) {
  const startDateTime = state.aggregationPeriod?.startDateTime;
  if (startDateTime) {
    const label = `${state.division}: aggregationPeriod.startDateTime`;
    if (hourKeyToEpoch(hourKey) < isoToEpoch(startDateTime, label)) return 'out-of-period';
  }
  if (assumeExpired) return 'expired';
  if (nowEpoch > expireCutoffEpoch(event, state)) return 'expired';
  return null;
}

async function collectEvent(event, options, nowEpoch, plan) {
  const parser = resolveHourlyParser(event.parser);
  const videos = store.readVideos(ROOT, event.eventId);
  const counters = new Map(
    event.divisions.map((division) => [
      division,
      { saved: [], unavailable: 0, notPublished: 0, error: 0 },
    ]),
  );
  const warnings = [];
  const notFound = [];
  let parseFailed = false;

  for (const item of plan.planned) {
    const { division, state } = item.entry;
    const { hourKey } = item;
    const counter = counters.get(division);
    const url = `${HISTORY_BASE_URL}/${division}/${hourKey}.json`;
    const label = `[${event.eventId}/${division}] ${hourKey}`;

    let response;
    try {
      response = await fetchText(url);
    } catch (cause) {
      if (!(cause instanceof FetchError)) throw cause;
      counter.error += 1;
      console.log(`${label} error（${cause.message}）`);
      logAttempt(event.eventId, {
        division,
        hourKey,
        httpStatus: cause.status,
        result: 'error',
        message: cause.message,
      });
      continue;
    }

    if (response.status === 404) {
      notFound.push({ entry: item.entry, hourKey, at: epochToIso(Date.now()) });
      continue;
    }

    if (response.status !== 200) {
      counter.error += 1;
      console.log(`${label} error（HTTP ${response.status}）`);
      logAttempt(event.eventId, {
        division,
        hourKey,
        httpStatus: response.status,
        result: 'error',
        message: `HTTP ${response.status}`,
      });
      continue;
    }

    let parsed;
    try {
      parsed = parser.parse(response.text, { eventTag: event.eventTag });
    } catch (cause) {
      if (!(cause instanceof ParseError)) throw cause;
      store.writeRawIfAbsent(
        store.rawAnomalyPath(ROOT, event.eventId, 'parse-failed', division, `${hourKey}.json.gz`),
        response.text,
      );
      parseFailed = true;
      warnings.push(`${division} ${hourKey}: 解析に失敗（${cause.message}）`);
      console.log(`${label} parse-failed（${cause.message}）`);
      logAttempt(event.eventId, {
        division,
        hourKey,
        httpStatus: 200,
        result: 'parse-failed',
        message: cause.message,
      });
      continue;
    }

    if (parsed.status === 'out-of-period') {
      store.addUnavailable(state, hourKey, 'out-of-period');
      counter.unavailable += 1;
      console.log(`${label} out-of-period`);
      logAttempt(event.eventId, { division, hourKey, httpStatus: 200, result: 'out-of-period' });
      continue;
    }

    if (!parsed.ranking.tag.includes(event.eventTag)) {
      store.writeRawIfAbsent(
        store.rawAnomalyPath(ROOT, event.eventId, 'tag-mismatch', division, `${hourKey}.json.gz`),
        response.text,
      );
      warnings.push(
        `${division} ${hourKey}: setting.tag に ${event.eventTag} が含まれない` +
          `（${parsed.ranking.tag}）。保存しない`,
      );
      console.log(`${label} tag-mismatch（${parsed.ranking.tag}）`);
      logAttempt(event.eventId, {
        division,
        hourKey,
        httpStatus: 200,
        result: 'tag-mismatch',
        tag: parsed.ranking.tag,
      });
      continue;
    }

    const periodWarning = store.recordAggregationPeriod(state, parsed.ranking);
    if (periodWarning) warnings.push(periodWarning);

    if (parsed.status === 'empty') {
      store.addUnavailable(state, hourKey, 'empty');
      counter.unavailable += 1;
      console.log(`${label} empty`);
      logAttempt(event.eventId, { division, hourKey, httpStatus: 200, result: 'empty' });
      continue;
    }

    const entryCount = parsed.entries.length;
    store.writeRawIfAbsent(
      store.rawSnapshotPath(ROOT, event.eventId, division, hourKey),
      response.text,
    );
    store.writeSnapshot(
      ROOT,
      store.buildSnapshot({
        eventId: event.eventId,
        division,
        hourKey,
        capturedAt: epochToIso(Date.now()),
        url,
        parser: event.parser,
        ranking: parsed.ranking,
        columns: parser.columns,
        entries: parsed.entries,
      }),
    );
    store.addCollected(state, hourKey, entryCount);
    store.mergeVideos(videos, parsed.videos, hourKey);
    counter.saved.push(hourKey);
    console.log(`${label} saved（${entryCount} 件）`);
    logAttempt(event.eventId, {
      division,
      hourKey,
      httpStatus: 200,
      result: 'saved',
      entryCount,
    });
    if (entryCount !== 100) {
      warnings.push(`${division} ${hourKey}: ${entryCount} 件（100 件揃っていない）`);
    }
  }

  for (const item of notFound) {
    const { division, state } = item.entry;
    const { hourKey } = item;
    const counter = counters.get(division);
    const label = `[${event.eventId}/${division}] ${hourKey}`;
    const reason = classifyNotFound(event, state, hourKey, nowEpoch, options.assumeExpired);

    if (reason === null) {
      counter.notPublished += 1;
      console.log(`${label} not-published`);
      continue;
    }
    store.addUnavailable(state, hourKey, reason);
    counter.unavailable += 1;
    console.log(`${label} ${reason}`);
    logAttempt(event.eventId, {
      at: item.at,
      division,
      hourKey,
      httpStatus: 404,
      result: reason,
    });
  }

  const updatedAt = epochToIso(Date.now());
  for (const entry of plan.divisions) {
    if (entry.state.changed) store.writeIndexState(ROOT, entry.state, updatedAt);
  }
  if (videos.changed) store.writeVideos(ROOT, event.eventId, videos);

  return { event, counters, warnings, parseFailed, deferred: plan.deferred };
}

// ---------------------------------------------------------------- 報告

export function summarizeEvent(summary) {
  const saved = [];
  const hours = new Set();
  let unavailable = 0;
  let notPublished = 0;
  let error = 0;
  for (const [division, counter] of summary.counters) {
    if (counter.saved.length > 0) saved.push(`${division} +${counter.saved.length}`);
    for (const hourKey of counter.saved) hours.add(hourKey);
    unavailable += counter.unavailable;
    notPublished += counter.notPublished;
    error += counter.error;
  }
  return { saved, hours: [...hours].sort(), unavailable, notPublished, error };
}

export function buildCommitMessage(summaries) {
  const segments = [];
  for (const summary of summaries) {
    const { hours, unavailable } = summarizeEvent(summary);
    const chunks = [];
    if (hours.length > 0) chunks.push(compressHourKeys(hours).join(', '));
    if (unavailable > 0) chunks.push(`${unavailable} unavailable`);
    if (chunks.length > 0) {
      segments.push({ eventId: summary.event.eventId, text: chunks.join(', ') });
    }
  }
  if (segments.length === 0) return 'collect: no new hours';
  if (segments.length === 1) return `collect(${segments[0].eventId}): ${segments[0].text}`;
  return `collect: ${segments.map((s) => `${s.eventId} ${s.text}`).join('; ')}`;
}

function report(summaries) {
  const lines = [];
  for (const summary of summaries) {
    const { saved, unavailable, notPublished, error } = summarizeEvent(summary);
    const detail = [
      saved.length > 0 ? `${saved.join(' / ')} hours` : '取得なし',
      `unavailable ${unavailable}`,
      `未公開 ${notPublished}`,
      `error ${error}`,
      ...(summary.deferred > 0 ? [`次回以降に残す ${summary.deferred}`] : []),
    ];
    lines.push(`- ${summary.event.eventId}: ${detail.join(' / ')}`);
  }
  const warnings = summaries.flatMap((summary) =>
    summary.warnings.map((warning) => `- ${summary.event.eventId}: ${warning}`),
  );

  console.log('');
  for (const line of lines) console.log(line);
  if (warnings.length > 0) {
    console.log('\n警告');
    for (const warning of warnings) console.log(warning);
  }

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    const md = ['## collect', '', ...lines];
    if (warnings.length > 0) md.push('', '### 警告', '', ...warnings);
    fs.appendFileSync(summaryPath, `${md.join('\n')}\n`, 'utf8');
  }
}

// ---------------------------------------------------------------- 本体

async function main() {
  const options = parseCliArgs();
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const nowEpoch = Date.now();
  const events = store.readEvents(ROOT);
  if (events.length === 0) {
    console.log('data/events/ に開催回がない');
    return;
  }

  if (!options.dryRun && store.writeEventsJson(ROOT, events)) {
    console.log('data/events.json を更新した');
  }

  const targets = selectTargets(events, options, nowEpoch);
  if (targets.length === 0) {
    console.log(`収集対象の開催回がない（現在時刻 ${epochToIso(nowEpoch)} が collect.until を過ぎている）`);
    return;
  }

  const summaries = [];
  for (const event of targets) {
    const plan = planEvent(event, nowEpoch, options.maxRequests);
    if (options.dryRun) {
      printDryRun(event, plan, nowEpoch);
      continue;
    }
    summaries.push(await collectEvent(event, options, nowEpoch, plan));
  }

  if (options.dryRun) return;

  report(summaries);

  if (options.commitMessageOut) {
    fs.writeFileSync(options.commitMessageOut, `${buildCommitMessage(summaries)}\n`, 'utf8');
  }

  if (summaries.some((summary) => summary.parseFailed)) process.exitCode = 1;
}

if (import.meta.main) await main();
