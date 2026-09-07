import fs from 'node:fs';
import path from 'node:path';

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

const cache = new Map();

function readJson(relPath) {
  const full = path.join(DATA_DIR, relPath);
  const raw = fs.readFileSync(full, 'utf8');
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `未対応の schemaVersion です: ${relPath} は ${parsed.schemaVersion}、対応版は ${SUPPORTED_SCHEMA_VERSION}`
    );
  }
  return parsed;
}

function cached(key, produce) {
  if (!cache.has(key)) cache.set(key, produce());
  return cache.get(key);
}

export function loadEvents() {
  return cached('events', () => readJson('events.json').events);
}

export function loadEvent(eventId) {
  return cached(`event:${eventId}`, () => {
    const event = readJson(path.join('events', eventId, 'event.json'));
    if (event.eventId !== eventId) {
      throw new Error(`event.json の eventId が不一致です: ディレクトリ ${eventId} / 内容 ${event.eventId}`);
    }
    return event;
  });
}

export function loadVideos(eventId) {
  return cached(`videos:${eventId}`, () => readJson(path.join('events', eventId, 'videos.json')).videos);
}

export function loadHourlyIndex(eventId, division) {
  return cached(`index:${eventId}:${division}`, () => {
    const relPath = path.join('events', eventId, 'hourly', division, 'index.json');
    if (!fs.existsSync(path.join(DATA_DIR, relPath))) return null;
    return readJson(relPath);
  });
}

/** 保存済みの時刻キーを古い順で返す。 */
export function availableHourKeys(eventId, division) {
  const index = loadHourlyIndex(eventId, division);
  if (!index) return [];
  return index.collected.map((entry) => entry.hourKey).sort();
}

export function loadSnapshot(eventId, division, hourKey) {
  return cached(`snapshot:${eventId}:${division}:${hourKey}`, () => {
    const snapshot = readJson(path.join('events', eventId, 'hourly', division, `${hourKey}.json`));
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

export function loadFinal(eventId, division) {
  return cached(`final:${eventId}:${division}`, () => {
    const relPath = path.join('events', eventId, 'final', `${division}.json`);
    if (!fs.existsSync(path.join(DATA_DIR, relPath))) return null;
    return readJson(relPath);
  });
}

/** 公開可能な開催回を返す。 */
export function publishableEvents() {
  return loadEvents().filter((summary) => {
    const event = loadEvent(summary.eventId);
    return event.divisions.some((division) => availableHourKeys(summary.eventId, division).length > 0);
  });
}

/** 公開可能な部門を返す。 */
export function publishableDivisions(eventId) {
  const event = loadEvent(eventId);
  return event.divisions.filter((division) => availableHourKeys(eventId, division).length > 0);
}
