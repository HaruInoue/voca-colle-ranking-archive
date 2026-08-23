// 時刻キー（YYYY-MM-DD-HH00, JST）と UTC エポックの相互変換。
//
// GitHub Actions は UTC で動くため、ローカル時刻に依存する API
// （getHours / getMonth / オフセットの無い文字列の Date 解釈）は一切使わない。
// JST に夏時間は無いので、オフセットは +09:00 固定として扱う。

const HOUR_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})00$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const HOUR_MS = 60 * 60 * 1000;

const p2 = (n) => String(n).padStart(2, '0');

/** 時刻キー → UTC エポック（ミリ秒）。存在しない日付は例外にする。 */
export function hourKeyToEpoch(hourKey) {
  const m = HOUR_KEY_RE.exec(hourKey ?? '');
  if (!m) throw new Error(`時刻キーの形式が不正: ${hourKey}`);
  const [, year, month, day, hour] = m;
  const epoch = Date.UTC(+year, +month - 1, +day, +hour) - JST_OFFSET_MS;
  // Date.UTC は 2026-02-30 や 24 時のような値を繰り上げてしまうため、往復で検算する。
  if (epochToHourKey(epoch) !== hourKey) throw new Error(`存在しない時刻: ${hourKey}`);
  return epoch;
}

/** UTC エポック → 時刻キー。JST で時単位に切り捨てる。 */
export function epochToHourKey(epoch) {
  // JST のオフセットは時単位なので、UTC で切り捨てても JST で切り捨てたのと同じになる。
  const d = new Date(Math.floor(epoch / HOUR_MS) * HOUR_MS + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}-${p2(d.getUTCHours())}00`;
}

/** 時刻キー → オフセット付き ISO 8601（スナップショットの aggregatedAt 用）。 */
export function hourKeyToIso(hourKey) {
  const m = HOUR_KEY_RE.exec(hourKey ?? '');
  if (!m) throw new Error(`時刻キーの形式が不正: ${hourKey}`);
  const [, year, month, day, hour] = m;
  return `${year}-${month}-${day}T${hour}:00:00+09:00`;
}

/** UTC エポック → 秒までのオフセット付き ISO 8601（capturedAt / ログの at 用）。 */
export function epochToIso(epoch) {
  const d = new Date(epoch + JST_OFFSET_MS);
  const date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
  const time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
  return `${date}T${time}+09:00`;
}

/**
 * 取得できる最新の時刻キー。
 * 公式は「現在時刻の 1 時間前」までを公開する（02-data-source.md 2 節）。
 */
export function latestFetchableHourKey(nowEpoch) {
  return epochToHourKey(nowEpoch - HOUR_MS);
}

/** fromKey 〜 untilKey（両端を含む）の時刻キーを昇順に列挙する。 */
export function enumerateHourKeys(fromKey, untilKey) {
  const from = hourKeyToEpoch(fromKey);
  const until = hourKeyToEpoch(untilKey);
  const keys = [];
  for (let t = from; t <= until; t += HOUR_MS) keys.push(epochToHourKey(t));
  return keys;
}

/** 時刻キーは辞書順が時刻順と一致する。 */
export function compareHourKey(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minHourKey(a, b) {
  return a <= b ? a : b;
}

/**
 * オフセット付き ISO 8601 → UTC エポック。
 * オフセットの無い文字列はローカル時刻として解釈されてしまうため、明示的に弾く。
 */
export function isoToEpoch(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} が文字列でない: ${value}`);
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    throw new Error(`${label} にタイムゾーンオフセットが無い: ${value}`);
  }
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) throw new Error(`${label} が日時として読めない: ${value}`);
  return epoch;
}
