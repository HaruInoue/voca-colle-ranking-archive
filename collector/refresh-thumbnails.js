#!/usr/bin/env node
// 404になったサムネイルURLを現在の版数に差し替える。

import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

import { fetchStatus, fetchText } from './lib/http.js';
import * as store from './lib/store.js';

const ROOT = path.resolve(import.meta.dirname, '..');

const THUMB_INFO_URL = 'https://ext.nicovideo.jp/api/getthumbinfo/';

const MIDDLE_SUFFIX = '.M';

const CHECK_CONCURRENCY = 4;

const USAGE = `使い方: node collector/refresh-thumbnails.js [--event <eventId>] [--dry-run]

  --event <eventId>   対象の開催回（既定: 全開催回）
  --dry-run           書き換えず、差し替え対象だけを報告する
  --help

videos.json のサムネイルURLをHEADで検査し、404のものだけニコニコの
getthumbinfo から現在の版数を引いて差し替える。
削除・非公開になった動画は null として記録する。

異常があれば終了コード 1 で終わる。

reparse.js は videos.json を raw から作り直すため、実行後はこのコマンドも回し直す。
`;

/** 並列数を抑えて順に処理する。 */
async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(items[index]);
      }
    }),
  );
  return results;
}

/** getthumbinfo の応答から現在のサムネイルURLを取り出す。 */
export function parseThumbInfo(xml) {
  if (/<nicovideo_thumb_response[^>]*status="ok"/.test(xml)) {
    const url = /<thumbnail_url>([^<]+)<\/thumbnail_url>/.exec(xml)?.[1];
    return url ? { ok: true, url } : { ok: false, reason: 'thumbnail_url が無い' };
  }
  const code = /<code>([^<]+)<\/code>/.exec(xml)?.[1];
  return { ok: false, reason: code ?? '応答を解釈できない' };
}

/** 1開催回のサムネイルURLを検査して差し替える。 */
async function refreshEvent(eventId, options) {
  const state = store.readVideos(ROOT, eventId);
  const watchIds = Object.keys(state.videos);

  const statuses = await mapLimited(watchIds, CHECK_CONCURRENCY, async (watchId) => {
    const url = state.videos[watchId].thumbnailUrl;
    return { watchId, status: url === null ? 404 : await fetchStatus(url) };
  });

  const fixed = [];
  const lost = [];
  const problems = [];
  let stillLost = 0;

  for (const { watchId, status } of statuses) {
    if (status === 200) continue;
    if (status !== 404) {
      problems.push(`${watchId}: 想定外のステータス（${status ?? '取得できず'}）`);
      continue;
    }

    const { status: infoStatus, text } = await fetchText(`${THUMB_INFO_URL}${watchId}`);
    if (infoStatus !== 200) {
      problems.push(`${watchId}: getthumbinfo が ${infoStatus}`);
      continue;
    }

    const previous = state.videos[watchId].thumbnailUrl;

    const info = parseThumbInfo(text);
    if (!info.ok) {
      if (previous === null) {
        stillLost += 1;
        continue;
      }
      lost.push(`${watchId}: ${info.reason}`);
      state.videos[watchId].thumbnailUrl = null;
      state.changed = true;
      continue;
    }

    const url = `${info.url}${MIDDLE_SUFFIX}`;
    const urlStatus = await fetchStatus(url);
    if (urlStatus !== 200) {
      problems.push(`${watchId}: 差し替え先も参照できない（${urlStatus ?? '取得できず'}: ${url}）`);
      continue;
    }

    fixed.push(`${watchId}: ${previous ?? '欠落'} → ${url}`);
    state.videos[watchId].thumbnailUrl = url;
    state.changed = true;
  }

  const written = state.changed && store.writeVideos(ROOT, eventId, state, options.dryRun);

  return { checked: watchIds.length, stillLost, fixed, lost, problems, written };
}

async function main() {
  const { values } = parseArgs({
    options: {
      event: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const options = { dryRun: values['dry-run'] };

  const eventIds = values.event
    ? [store.readEvent(ROOT, values.event).eventId]
    : store.readEvents(ROOT).map((event) => event.eventId);

  let fixedTotal = 0;
  let lostTotal = 0;
  let problemTotal = 0;

  for (const eventId of eventIds) {
    const { checked, stillLost, fixed, lost, problems, written } = await refreshEvent(
      eventId,
      options,
    );
    console.log(
      `\n${eventId}  検査 ${checked} 件 / ${options.dryRun ? '差し替え対象' : '差し替え'} ${
        fixed.length
      }` +
        (lost.length > 0 ? ` / 欠落 ${lost.length}` : '') +
        (stillLost > 0 ? ` / 欠落のまま ${stillLost}` : '') +
        (problems.length > 0 ? ` / 異常 ${problems.length}` : ''),
    );
    for (const line of fixed) console.log(`  ${options.dryRun ? '対象' : '差替'} ${line}`);
    for (const line of lost) console.log(`  欠落 ${line}`);
    for (const line of problems) console.log(`  異常 ${line}`);
    if ((fixed.length > 0 || lost.length > 0) && !written) {
      console.log('  ※ videos.json に変更なし');
    }
    fixedTotal += fixed.length;
    lostTotal += lost.length;
    problemTotal += problems.length;
  }

  console.log(
    `\n${eventIds.length} 開催回。` +
      `${options.dryRun ? '差し替え対象' : '差し替え'} ${fixedTotal}` +
      ` / 欠落 ${lostTotal} / 異常 ${problemTotal}`,
  );
  if (problemTotal > 0) process.exitCode = 1;
}

if (import.meta.main) await main();
