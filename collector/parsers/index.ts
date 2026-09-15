// パーサモジュールを解決する。

import * as archivePageV1 from '#parsers/archive-page-v1.ts';
import * as sdsHistoryV1 from '#parsers/sds-history-v1.ts';

export type HourlyParser = typeof sdsHistoryV1;
export type FinalParser = typeof archivePageV1;

const HOURLY_PARSERS: Record<string, HourlyParser> = {
  'sds-history-v1': sdsHistoryV1,
};

const FINAL_PARSERS: Record<string, FinalParser> = {
  'archive-page-v1': archivePageV1,
};

function resolve<T>(table: Record<string, T>, kind: string, name: string): T {
  const parser = table[name];
  if (!parser) {
    throw new Error(`${kind}のパーサ "${name}" が無い。実装済み: ${Object.keys(table).join(', ')}`);
  }
  return parser;
}

export const resolveHourlyParser = (name: string): HourlyParser =>
  resolve(HOURLY_PARSERS, '毎時履歴', name);
export const resolveFinalParser = (name: string): FinalParser =>
  resolve(FINAL_PARSERS, '最終ランキング', name);

export { ParseError } from '#parsers/parse-error.ts';
