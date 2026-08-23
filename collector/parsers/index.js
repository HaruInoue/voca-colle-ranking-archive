// 版名 → パーサモジュールの解決。
//
// パーサは取得元の構造が変わったときにだけ版を増やす。
// event.json の parser で開催回ごとに固定するため、新版を追加しても旧版は消さない。

import * as archivePageV1 from './archive-page-v1.js';
import * as sdsHistoryV1 from './sds-history-v1.js';

/** 毎時履歴用（event.json の parser） */
const HOURLY_PARSERS = {
  'sds-history-v1': sdsHistoryV1,
};

/** 最終ランキング用（event.json の finalParser） */
const FINAL_PARSERS = {
  'archive-page-v1': archivePageV1,
};

function resolve(table, kind, name) {
  const parser = table[name];
  if (!parser) {
    throw new Error(`${kind}のパーサ "${name}" が無い。実装済み: ${Object.keys(table).join(', ')}`);
  }
  return parser;
}

export const resolveHourlyParser = (name) => resolve(HOURLY_PARSERS, '毎時履歴', name);
export const resolveFinalParser = (name) => resolve(FINAL_PARSERS, '最終ランキング', name);

export { ParseError } from './parse-error.js';
