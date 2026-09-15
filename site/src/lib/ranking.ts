/** 表示用のランキング導出規則。 */

import { hourKeyToPlotSeconds, isoToPlotSeconds } from '#lib/format.ts';

import type {
  AggregationPeriod,
  Division,
  FinalRanking,
  HourKey,
  MetricKey,
  Snapshot,
  WatchId,
} from '@data-model';

/** entries の 1 行を名前付きにしたもの。 */
export interface RankRow {
  rank: number;
  watchId: WatchId;
  view: number;
  comment: number;
  mylist: number;
  like: number;
}

export type RankDelta =
  | { kind: 'none' }
  | { kind: 'rankin' }
  | { kind: 'same'; value: 0 }
  | { kind: 'up' | 'down'; value: number };

export interface SeriesPoint {
  hourKey: HourKey;
  rank: number | null;
  view: number | null;
  comment: number | null;
  mylist: number | null;
  like: number | null;
}

export interface VideoSeries {
  points: SeriesPoint[];
  bestRank: number | null;
  bestRankHourKey: HourKey | null;
  lastRankedHourKey: HourKey | null;
  rankedHourCount: number;
}

export const METRIC_KEYS: MetricKey[] = ['view', 'comment', 'mylist', 'like'];

export const METRIC_LABELS: Record<MetricKey, string> = {
  view: '再生',
  comment: 'コメント',
  mylist: 'マイリスト',
  like: 'いいね',
};

const DIVISION_LABELS: Record<Division, string> = {
  top100: 'TOP100',
  rookie: 'ルーキー',
  remix: 'REMIX',
};

/** 部門の表示名を返す。 */
export function divisionLabel(division: Division): string {
  return DIVISION_LABELS[division] ?? division;
}

/** 列指向のentriesをオブジェクトの配列に変換する。 */
export function toEntries(snapshot: Snapshot | FinalRanking): RankRow[] {
  const { columns, entries } = snapshot;
  const indexOf: Record<string, number> = {};
  columns.forEach((name, i) => {
    indexOf[name] = i;
  });
  return entries.map((row) => {
    const cells = row as readonly (number | string)[];
    const entry = {
      rank: cells[indexOf.rank] as number,
      watchId: cells[indexOf.watchId] as WatchId,
    } as RankRow;
    for (const key of METRIC_KEYS) entry[key] = cells[indexOf[key]] as number;
    return entry;
  });
}

/** 順位変動を判定する。 */
export function rankDelta(
  rank: number,
  watchId: WatchId,
  previousRankByWatchId: Map<WatchId, number> | null | undefined,
): RankDelta {
  if (!previousRankByWatchId) return { kind: 'none' };
  const previousRank = previousRankByWatchId.get(watchId);
  if (previousRank === undefined) return { kind: 'rankin' };
  const change = previousRank - rank;
  if (change === 0) return { kind: 'same', value: 0 };
  return { kind: change > 0 ? 'up' : 'down', value: Math.abs(change) };
}

export function rankMapOf(entries: RankRow[]): Map<WatchId, number> {
  return new Map(entries.map((entry) => [entry.watchId, entry.rank]));
}

/** 表示する毎時ランキングの範囲を解決する。 */
export function resolveHourWindow(
  availableHourKeys: HourKey[],
  requestedHour: HourKey | null | undefined,
  windowSize: number,
): { hourKeys: HourKey[]; rightEdge: HourKey | null } {
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
export function outOfPeriodHourKeys(
  hourKeys: HourKey[],
  aggregationPeriod: AggregationPeriod | null | undefined,
): Set<HourKey> {
  const from = isoToPlotSeconds(aggregationPeriod?.startDateTime);
  const until = isoToPlotSeconds(aggregationPeriod?.endDateTime);
  if (from === null && until === null) return new Set<HourKey>();
  return new Set(
    hourKeys.filter((hourKey) => {
      const at = hourKeyToPlotSeconds(hourKey);
      return (from !== null && at < from) || (until !== null && at > until);
    })
  );
}

/** 1曲の部門別推移を作る。最高順位とランクイン回数は公式の集計期間内だけで数える。 */
export function buildVideoSeries(
  hourKeys: HourKey[],
  entriesByHour: Map<HourKey, Map<WatchId, RankRow>>,
  watchId: WatchId,
  outOfPeriod: Set<HourKey> = new Set(),
): VideoSeries {
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
  const ranked = points.filter(
    (point): point is SeriesPoint & { rank: number } => point.rank !== null,
  );
  const rankedInPeriod = ranked.filter((point) => !outOfPeriod.has(point.hourKey));
  const bestRank = rankedInPeriod.length
    ? Math.min(...rankedInPeriod.map((point) => point.rank))
    : null;
  return {
    points,
    bestRank,
    bestRankHourKey: rankedInPeriod.findLast((point) => point.rank === bestRank)?.hourKey ?? null,
    lastRankedHourKey: ranked.at(-1)?.hourKey ?? null,
    rankedHourCount: rankedInPeriod.length,
  };
}

/** 曲を代表する部門を返す。 */
export function canonicalDivision<
  T extends { division: Division; finalEntry: unknown; lastRankedHourKey: HourKey | null },
>(seriesList: T[]): Division | null {
  const finalized = seriesList.filter((series) => series.finalEntry);
  const candidates = finalized.length > 0 ? finalized : seriesList;
  if (candidates.length === 0) return null;
  return candidates.reduce((best, series) =>
    (series.lastRankedHourKey ?? '') > (best.lastRankedHourKey ?? '') ? series : best
  ).division;
}

/** 直前に比較可能な点との差分を作る。 */
export function metricDiffs(points: SeriesPoint[]): Record<MetricKey, number | null>[] {
  let previous: SeriesPoint | null = null;
  return points.map((point) => {
    const diffs = {} as Record<MetricKey, number | null>;
    for (const key of METRIC_KEYS) {
      const before = previous?.[key] ?? null;
      const after = point[key];
      diffs[key] = previous && before !== null && after !== null ? after - before : null;
    }
    if (point.rank !== null) previous = point;
    return diffs;
  });
}
