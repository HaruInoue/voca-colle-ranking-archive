// 版名 → パーサモジュールの解決。
//
// パーサは取得元の構造が変わったときにだけ版を増やす。
// event.json の parser で開催回ごとに固定するため、新版を追加しても旧版は消さない。

import * as sdsHistoryV1 from './sds-history-v1.js';

const HOURLY_PARSERS = {
  'sds-history-v1': sdsHistoryV1,
};

export function resolveHourlyParser(name) {
  const parser = HOURLY_PARSERS[name];
  if (!parser) {
    const known = Object.keys(HOURLY_PARSERS).join(', ');
    throw new Error(`毎時履歴のパーサ "${name}" が無い。実装済み: ${known}`);
  }
  return parser;
}

export { ParseError } from './parse-error.js';
