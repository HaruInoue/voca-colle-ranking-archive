import {
  publishableDivisions,
  availableHourKeys,
  loadHourlyIndex,
  loadSnapshot,
  loadFinal,
} from './data.js';
import { toEntries, buildVideoSeries, metricDiffs, outOfPeriodHourKeys } from './ranking.js';

/** 曲詳細ページ用の索引。 */

const cache = new Map();

function buildIndex(eventId) {
  const divisions = publishableDivisions(eventId).map((division) => {
    const hourKeys = availableHourKeys(eventId, division);
    const entriesByHour = new Map();
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

  const watchIds = new Set();
  for (const item of divisions) {
    for (const entries of item.entriesByHour.values()) {
      for (const watchId of entries.keys()) watchIds.add(watchId);
    }
    if (item.finalEntries) for (const watchId of item.finalEntries.keys()) watchIds.add(watchId);
  }

  return { divisions, watchIds };
}

export function eventSnapshotIndex(eventId) {
  if (!cache.has(eventId)) cache.set(eventId, buildIndex(eventId));
  return cache.get(eventId);
}

/** ランキングに登場した動画IDを返す。 */
export function rankedWatchIds(eventId) {
  return [...eventSnapshotIndex(eventId).watchIds];
}

/** 1曲の部門ごとの推移を返す。 */
export function videoDivisionSeries(eventId, watchId) {
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
    .filter(Boolean);
}
