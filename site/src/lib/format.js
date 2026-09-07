/** 表示用の値を整形する。 */

const HOUR_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})$/;
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** 時刻キーを日付と時刻に分解する。 */
export function parseHourKey(hourKey) {
  const matched = HOUR_KEY_PATTERN.exec(hourKey);
  if (!matched) throw new Error(`時刻キーの形式が不正です: ${hourKey}`);
  const [, year, month, day, hour, minute] = matched;
  return {
    date: `${year}/${month}/${day}`,
    time: `${hour}:${minute}`,
    full: `${year}/${month}/${day} ${hour}:${minute}`,
  };
}

/** ISO 8601の日時を整形する。 */
export function formatIsoDateTime(iso) {
  const matched = ISO_PATTERN.exec(iso ?? '');
  if (!matched) return '';
  const [, year, month, day, hour, minute] = matched;
  return `${year}/${month}/${day} ${hour}:${minute}`;
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '';
  return value.toLocaleString('ja-JP');
}

export function formatSignedNumber(value) {
  if (value === null || value === undefined) return '';
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

export function formatDuration(seconds) {
  if (typeof seconds !== 'number') return '';
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

/** 期間を整形する。 */
export function formatPeriod(startIso, endIso) {
  const start = formatIsoDateTime(startIso);
  const end = formatIsoDateTime(endIso);
  if (!start || !end) return '';
  return start.slice(0, 4) === end.slice(0, 4) ? `${start} 〜 ${end.slice(5)}` : `${start} 〜 ${end}`;
}

export function formatAggregationPeriod(period) {
  if (!period) return '';
  return formatPeriod(period.startDateTime, period.endDateTime);
}

/** グラフの縦軸の上限を切りの良い値に切り上げる。 */
export function niceCeil(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const candidates = [1, 1.5, 2, 3, 5, 8, 10].map((step) => step * magnitude);
  return candidates.find((candidate) => candidate >= value) ?? 10 * magnitude;
}

/** ISO 8601をグラフのx値に変換する。 */
export function isoToPlotSeconds(iso) {
  const matched = ISO_PATTERN.exec(iso ?? '');
  if (!matched) return null;
  const [, year, month, day, hour, minute] = matched.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute) / 1000;
}

export function hourKeyToPlotSeconds(hourKey) {
  const matched = HOUR_KEY_PATTERN.exec(hourKey);
  if (!matched) throw new Error(`時刻キーの形式が不正です: ${hourKey}`);
  const [, year, month, day, hour, minute] = matched.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute) / 1000;
}
