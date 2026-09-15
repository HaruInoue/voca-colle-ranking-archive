import {
  publishableDivisions,
  availableHourKeys,
  loadHourlyIndex,
  loadSnapshot,
  loadFinal,
} from '#lib/data.ts';
import { toEntries, buildVideoSeries, metricDiffs, outOfPeriodHourKeys } from '#lib/ranking.ts';

import type { MetricKey, Division, EventId, HourKey, WatchId } from '@data-model';
import type { RankRow, VideoSeries } from '#lib/ranking.ts';

/** 曲詳細ページ用の索引。 */

export interface DivisionIndex {
  division: Division;
  hourKeys: HourKey[];
  entriesByHour: Map<HourKey, Map<WatchId, RankRow>>;
  finalEntries: Map<WatchId, RankRow> | null;
  outOfPeriod: Set<HourKey>;
}

export interface EventIndex {
  divisions: DivisionIndex[];
  watchIds: Set<WatchId>;
}

export type DivisionSeries = VideoSeries & {
  division: Division;
  diffs: Record<MetricKey, number | null>[];
  finalEntry: RankRow | null;
  finalPublished: boolean;
  totalHourCount: number;
  outOfPeriodHourCount: number;
};

const cache = new Map<EventId, EventIndex>();

function buildIndex(eventId: EventId): EventIndex {
  const divisions: DivisionIndex[] = publishableDivisions(eventId).map((division) => {
    const hourKeys = availableHourKeys(eventId, division);
    const entriesByHour = new Map<HourKey, Map<WatchId, RankRow>>();
    for (const hourKey of hourKeys) {
      const entries = toEntries(loadSnapshot(eventId, division, hourKey));
      entriesByHour.set(hourKey, new Map(entries.map((entry) => [entry.watchId, entry])));
    }
    const final = loadFinal(eventId, division);
    const finalEntries = final
      ? new Map(toEntries(final).map((entry) => [entry.watchId, entry]))
      : null;
    const aggregationPeriod = loadHourlyIndex(eventId, division)?.aggregationPeriod;
    const outOfPeriod = outOfPeriodHourKeys(hourKeys, aggregationPeriod);
    return { division, hourKeys, entriesByHour, finalEntries, outOfPeriod };
  });

  const watchIds = new Set<WatchId>();
  for (const item of divisions) {
    for (const entries of item.entriesByHour.values()) {
      for (const watchId of entries.keys()) watchIds.add(watchId);
    }
    if (item.finalEntries) for (const watchId of item.finalEntries.keys()) watchIds.add(watchId);
  }

  return { divisions, watchIds };
}

export function eventSnapshotIndex(eventId: EventId): EventIndex {
  if (!cache.has(eventId)) cache.set(eventId, buildIndex(eventId));
  return cache.get(eventId) as EventIndex;
}

/** ランキングに登場した動画IDを返す。 */
export function rankedWatchIds(eventId: EventId): WatchId[] {
  return [...eventSnapshotIndex(eventId).watchIds];
}

/** 1曲の部門ごとの推移を返す。 */
export function videoDivisionSeries(eventId: EventId, watchId: WatchId): DivisionSeries[] {
  return eventSnapshotIndex(eventId)
    .divisions.map((item) => {
      const series = buildVideoSeries(item.hourKeys, item.entriesByHour, watchId, item.outOfPeriod);
      const finalEntry = item.finalEntries?.get(watchId) ?? null;
      if (series.lastRankedHourKey === null && !finalEntry) return null;
      return {
        division: item.division,
        ...series,
        diffs: metricDiffs(series.points),
        finalEntry,
        finalPublished: item.finalEntries !== null,
        totalHourCount: item.hourKeys.length - item.outOfPeriod.size,
        outOfPeriodHourCount: item.outOfPeriod.size,
      };
    })
    .filter((series): series is DivisionSeries => series !== null);
}
