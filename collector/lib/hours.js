// JST時刻キーとUTCエポックを変換する。

const HOUR_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})00$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const HOUR_MS = 60 * 60 * 1000;

const p2 = (n) => String(n).padStart(2, '0');

/** 時刻キーをUTCエポックへ変換する。 */
export function hourKeyToEpoch(hourKey) {
  const m = HOUR_KEY_RE.exec(hourKey ?? '');
  if (!m) throw new Error(`時刻キーの形式が不正: ${hourKey}`);
  const [, year, month, day, hour] = m;
  const epoch = Date.UTC(+year, +month - 1, +day, +hour) - JST_OFFSET_MS;
  if (epochToHourKey(epoch) !== hourKey) throw new Error(`存在しない時刻: ${hourKey}`);
  return epoch;
}

/** UTCエポックを時刻キーへ変換する。 */
export function epochToHourKey(epoch) {
  const d = new Date(Math.floor(epoch / HOUR_MS) * HOUR_MS + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}-${p2(d.getUTCHours())}00`;
}

/** 時刻キーをISO 8601へ変換する。 */
export function hourKeyToIso(hourKey) {
  const m = HOUR_KEY_RE.exec(hourKey ?? '');
  if (!m) throw new Error(`時刻キーの形式が不正: ${hourKey}`);
  const [, year, month, day, hour] = m;
  return `${year}-${month}-${day}T${hour}:00:00+09:00`;
}

/** UTCエポックをISO 8601へ変換する。 */
export function epochToIso(epoch) {
  const d = new Date(epoch + JST_OFFSET_MS);
  const date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  const time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  return `${date}T${time}+09:00`;
}

/** 取得可能な最新時刻キーを返す。 */
export function latestFetchableHourKey(nowEpoch) {
  return epochToHourKey(nowEpoch);
}

/** 時刻キーの範囲を列挙する。 */
export function enumerateHourKeys(fromKey, untilKey) {
  const from = hourKeyToEpoch(fromKey);
  const until = hourKeyToEpoch(untilKey);
  const keys = [];
  for (let t = from; t <= until; t += HOUR_MS) keys.push(epochToHourKey(t));
  return keys;
}

/** 時刻キーを比較する。 */
export function compareHourKey(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minHourKey(a, b) {
  return a <= b ? a : b;
}

/** オフセット付きISO 8601をUTCエポックへ変換する。 */
export function isoToEpoch(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} が文字列でない: ${value}`);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    throw new Error(`${label} にタイムゾーンオフセットが無い: ${value}`);
  }
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) throw new Error(`${label} が日時として読めない: ${value}`);
  return epoch;
}
