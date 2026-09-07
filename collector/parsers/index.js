// パーサモジュールを解決する。

import * as archivePageV1 from './archive-page-v1.js';
import * as sdsHistoryV1 from './sds-history-v1.js';

const HOURLY_PARSERS = {
  'sds-history-v1': sdsHistoryV1,
};

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
