import { publishableEvents, loadEvent, loadVideos } from './data.js';
import { eventSnapshotIndex } from './video-series.js';
import { eventTheme } from './theme.js';

/**
 * 全開催回を横断する検索索引をビルド時に組み立てる。
 * 最高順位の良い順・同順位は開催回の新しい順に並べておき先頭から取る。
 * 全開催回を1ファイルで配信する（gzip 約 210KB）。1 開催回あたり約 2,000 行増えるので、
 * 重くなったら開催回ごとに分割するか、語の先頭 n 文字で引ける索引に変える。
 */

/** 開催回内の各動画の最高順位。毎時スナップショットと最終ランキングの両方から採る。 */
function bestRanks(eventId) {
  const best = new Map();
  const record = (watchId, rank) => {
    const current = best.get(watchId);
    if (current === undefined || rank < current) best.set(watchId, rank);
  };
  for (const item of eventSnapshotIndex(eventId).divisions) {
    for (const entries of item.entriesByHour.values()) {
      for (const entry of entries.values()) record(entry.watchId, entry.rank);
    }
    if (item.finalEntries) {
      for (const entry of item.finalEntries.values()) record(entry.watchId, entry.rank);
    }
  }
  return best;
}

export function buildSearchIndex() {
  const events = publishableEvents();

  const scored = [];
  events.forEach((summary, eventOrder) => {
    const { eventId } = summary;
    const videos = loadVideos(eventId);
    for (const [watchId, rank] of bestRanks(eventId)) {
      const video = videos[watchId];
      if (!video) {
        throw new Error(`曲情報が見つかりません: ${eventId} の ${watchId}`);
      }
      scored.push({
        rank,
        eventOrder,
        row: [watchId, video.title, video.owner?.name ?? '', eventId],
      });
    }
  });
  scored.sort((a, b) => a.rank - b.rank || a.eventOrder - b.eventOrder);

  return {
    events: Object.fromEntries(
      events.map(({ eventId }) => [
        eventId,
        {
          // 候補行では「ボカコレ」は全件共通で情報量がないため落とす
          label: loadEvent(eventId).title.replace(/^ボカコレ/, ''),
          accent: eventTheme(eventId).accent,
        },
      ])
    ),
    videos: scored.map((item) => item.row),
  };
}
