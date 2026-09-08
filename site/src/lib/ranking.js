/** 表示用のランキング導出規則。 */

import { hourKeyToPlotSeconds, isoToPlotSeconds } from './format.js';

export const METRIC_KEYS = ['view', 'comment', 'mylist', 'like'];

export const METRIC_LABELS = {
  view: '再生',
  comment: 'コメント',
  mylist: 'マイリスト',
  like: 'いいね',
};

const DIVISION_LABELS = {
  top100: 'TOP100',
  rookie: 'ルーキー',
  remix: 'REMIX',
};

/** 部門の表示名を返す。 */
export function divisionLabel(division) {
  return DIVISION_LABELS[division] ?? division;
}

/** 列指向のentriesをオブジェクトの配列に変換する。 */
export function toEntries(snapshot) {
  const { columns, entries } = snapshot;
  const indexOf = {};
  columns.forEach((name, i) => {
    indexOf[name] = i;
  });
  return entries.map((row) => {
    const entry = { rank: row[indexOf.rank], watchId: row[indexOf.watchId] };
    for (const key of METRIC_KEYS) entry[key] = row[indexOf[key]];
    return entry;
  });
}

/** 順位変動を判定する。 */
export function rankDelta(rank, watchId, previousRankByWatchId) {
  if (!previousRankByWatchId) return { kind: 'none' };
  const previousRank = previousRankByWatchId.get(watchId);
  if (previousRank === undefined) return { kind: 'rankin' };
  const change = previousRank - rank;
  if (change === 0) return { kind: 'same', value: 0 };
  return { kind: change > 0 ? 'up' : 'down', value: Math.abs(change) };
}

export function rankMapOf(entries) {
  return new Map(entries.map((entry) => [entry.watchId, entry.rank]));
}

/** 表示する毎時ランキングの範囲を解決する。 */
export function resolveHourWindow(availableHourKeys, requestedHour, windowSize) {
  if (availableHourKeys.length === 0) {
    return { hourKeys: [], rightEdge: null };
  }
  const requestedIndex = requestedHour ? availableHourKeys.indexOf(requestedHour) : -1;
  const endIndex = requestedIndex !== -1 ? requestedIndex : availableHourKeys.length - 1;
  const startIndex = Math.max(0, endIndex - windowSize + 1);
  return {
    hourKeys: availableHourKeys.slice(startIndex, endIndex + 1),
    rightEdge: availableHourKeys[endIndex],
  };
}

/** 集計期間の外にある時刻キーを返す。 */
export function outOfPeriodHourKeys(hourKeys, aggregationPeriod) {
  const from = isoToPlotSeconds(aggregationPeriod?.startDateTime);
  const until = isoToPlotSeconds(aggregationPeriod?.endDateTime);
  if (from === null && until === null) return new Set();
  return new Set(
    hourKeys.filter((hourKey) => {
      const at = hourKeyToPlotSeconds(hourKey);
      return (from !== null && at < from) || (until !== null && at > until);
    })
  );
}

/** 1曲の部門別推移を作る。 */
export function buildVideoSeries(hourKeys, entriesByHour, watchId) {
  const points = hourKeys.map((hourKey) => {
    const entry = entriesByHour.get(hourKey)?.get(watchId);
    return {
      hourKey,
      rank: entry ? entry.rank : null,
      view: entry ? entry.view : null,
      comment: entry ? entry.comment : null,
      mylist: entry ? entry.mylist : null,
      like: entry ? entry.like : null,
    };
  });
  const ranked = points.filter((point) => point.rank !== null);
  const bestRank = ranked.length ? Math.min(...ranked.map((point) => point.rank)) : null;
  return {
    points,
    bestRank,
    bestRankHourKey: ranked.findLast((point) => point.rank === bestRank)?.hourKey ?? null,
    lastRankedHourKey: ranked.at(-1)?.hourKey ?? null,
    rankedHourCount: ranked.length,
  };
}

/** 曲を代表する部門を返す。 */
export function canonicalDivision(seriesList) {
  const finalized = seriesList.filter((series) => series.finalEntry);
  const candidates = finalized.length > 0 ? finalized : seriesList;
  if (candidates.length === 0) return null;
  return candidates.reduce((best, series) =>
    (series.lastRankedHourKey ?? '') > (best.lastRankedHourKey ?? '') ? series : best
  ).division;
}

/** 直前に比較可能な点との差分を作る。 */
export function metricDiffs(points) {
  let previous = null;
  return points.map((point) => {
    const diffs = {};
    for (const key of METRIC_KEYS) {
      diffs[key] =
        previous && previous[key] !== null && point[key] !== null ? point[key] - previous[key] : null;
    }
    if (point.rank !== null) previous = point;
    return diffs;
  });
}
