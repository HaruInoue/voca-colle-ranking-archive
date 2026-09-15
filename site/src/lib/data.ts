import fs from 'node:fs';
import path from 'node:path';

import type {
  Division,
  EventFile,
  EventId,
  EventSummary,
  FinalRanking,
  HourKey,
  HourlyIndex,
  Snapshot,
  Video,
  WatchId,
} from '@data-model';

/** ビルド時に data/ を直接読む。 */

const SUPPORTED_SCHEMA_VERSION = 1;

/** data/ を含むリポジトリルートを作業ディレクトリから探す。 */
function findDataDir() {
  let current = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(current, 'data');
    if (fs.existsSync(path.join(candidate, 'events.json'))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`data/events.json が見つかりません（探索の起点: ${process.cwd()}）`);
}

const DATA_DIR = findDataDir();

const cache = new Map<string, unknown>();

function readJson<T extends { schemaVersion: number }>(relPath: string): T {
  const full = path.join(DATA_DIR, relPath);
  const raw = fs.readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw) as T;
  if (parsed.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `未対応の schemaVersion です: ${relPath} は ${parsed.schemaVersion}、対応版は ${SUPPORTED_SCHEMA_VERSION}`
    );
  }
  return parsed;
}

function cached<T>(key: string, produce: () => T): T {
  if (!cache.has(key)) cache.set(key, produce());
  return cache.get(key) as T;
}

export function loadEvents(): EventSummary[] {
  return cached('events', () => readJson<{ schemaVersion: number; events: EventSummary[] }>('events.json').events);
}

export function loadEvent(eventId: EventId): EventFile {
  return cached(`event:${eventId}`, () => {
    const event = readJson<EventFile>(path.join('events', eventId, 'event.json'));
    if (event.eventId !== eventId) {
      throw new Error(`event.json の eventId が不一致です: ディレクトリ ${eventId} / 内容 ${event.eventId}`);
    }
    return event;
  });
}

export function loadVideos(eventId: EventId): Record<WatchId, Video> {
  return cached(
    `videos:${eventId}`,
    () =>
      readJson<{ schemaVersion: number; videos: Record<WatchId, Video> }>(
        path.join('events', eventId, 'videos.json'),
      ).videos,
  );
}

export function loadHourlyIndex(eventId: EventId, division: Division): HourlyIndex | null {
  return cached(`index:${eventId}:${division}`, () => {
    const relPath = path.join('events', eventId, 'hourly', division, 'index.json');
    if (!fs.existsSync(path.join(DATA_DIR, relPath))) return null;
    return readJson<HourlyIndex>(relPath);
  });
}

/** 保存済みの時刻キーを古い順で返す。 */
export function availableHourKeys(eventId: EventId, division: Division): HourKey[] {
  const index = loadHourlyIndex(eventId, division);
  if (!index) return [];
  return index.collected.map((entry) => entry.hourKey).sort();
}

export function loadSnapshot(eventId: EventId, division: Division, hourKey: HourKey): Snapshot {
  return cached(`snapshot:${eventId}:${division}:${hourKey}`, () => {
    const snapshot = readJson<Snapshot>(
      path.join('events', eventId, 'hourly', division, `${hourKey}.json`),
    );
    if (snapshot.hourKey !== hourKey) {
      throw new Error(
        `スナップショットの hourKey が不一致です: ${eventId}/${division}/${hourKey}.json の内容は ${snapshot.hourKey}`
      );
    }
    if (snapshot.division !== division || snapshot.eventId !== eventId) {
      throw new Error(
        `スナップショットの開催回・部門が不一致です: ${eventId}/${division}/${hourKey}.json`
      );
    }
    return snapshot;
  });
}

export function loadFinal(eventId: EventId, division: Division): FinalRanking | null {
  return cached(`final:${eventId}:${division}`, () => {
    const relPath = path.join('events', eventId, 'final', `${division}.json`);
    if (!fs.existsSync(path.join(DATA_DIR, relPath))) return null;
    return readJson<FinalRanking>(relPath);
  });
}

/** 公開可能な開催回を返す。 */
export function publishableEvents(): EventSummary[] {
  return loadEvents().filter((summary) => {
    const event = loadEvent(summary.eventId);
    return event.divisions.some((division) => availableHourKeys(summary.eventId, division).length > 0);
  });
}

/** 公開可能な部門を返す。 */
export function publishableDivisions(eventId: EventId): Division[] {
  const event = loadEvent(eventId);
  return event.divisions.filter((division) => availableHourKeys(eventId, division).length > 0);
}
