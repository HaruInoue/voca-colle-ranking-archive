// data/ 配下の読み書き。
//
// 手元（Windows）と GitHub Actions（Linux）が同じファイルを書き換えるため、
// 書き出し方を固定する（インデント 2 / 末尾改行 1 つ / LF / キー順は定義順 /
// 並びは昇順）。揃っていないと、内容が同じでも Git の差分になる。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { compareHourKey, hourKeyToEpoch, hourKeyToIso } from './hours.js';

export const SCHEMA_VERSION = 1;
const DEFAULT_MAX_REQUESTS_PER_RUN = 120;

/** 文字列の昇順。localeCompare は環境で結果が変わるため使わない。 */
export const compareString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- 直列化

const isPrimitive = (v) => v === null || typeof v !== 'object';

/** 1 行に収める形。差分が読める粒度のものだけに使う。 */
function renderInline(value) {
  if (isPrimitive(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(renderInline).join(', ')}]`;
  const parts = Object.entries(value).map(
    ([key, v]) => `${JSON.stringify(key)}: ${renderInline(v)}`,
  );
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
}

function renderCompact(value, indent) {
  if (isPrimitive(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isPrimitive)) return renderInline(value);
    const pad = `${indent}  `;
    const items = value.map((v) => pad + renderInline(v)).join(',\n');
    return `[\n${items}\n${indent}]`;
  }
  return renderInline(value);
}

function render(value, indent, compactKeys) {
  if (isPrimitive(value)) return JSON.stringify(value);
  const pad = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => pad + render(v, pad, compactKeys)).join(',\n');
    return `[\n${items}\n${indent}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const items = keys
    .map((key) => {
      const rendered = compactKeys.has(key)
        ? renderCompact(value[key], pad)
        : render(value[key], pad, compactKeys);
      return `${pad}${JSON.stringify(key)}: ${rendered}`;
    })
    .join(',\n');
  return `{\n${items}\n${indent}}`;
}

/**
 * 決められた形で JSON にする。
 * compactKeys に挙げたキーの値は 1 行（配列なら 1 要素 1 行）に収める。
 */
export function stringifyJson(value, compactKeys = []) {
  return `${render(value, '', new Set(compactKeys))}\n`;
}

// ---------------------------------------------------------------- ファイル

export function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`${filePath} が JSON として読めない: ${cause.message}`);
  }
}

/** 内容が変わらない場合は書かない（更新時刻だけの差分を作らないため）。 */
export function writeTextIfChanged(filePath, text) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === text) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
  return true;
}

export function writeJsonIfChanged(filePath, value, compactKeys) {
  return writeTextIfChanged(filePath, stringifyJson(value, compactKeys));
}

/** 生データを gzip で書く。同じ内容なら同じバイト列になる（mtime を持たない）。 */
export function writeRaw(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }));
}

/** 毎時履歴の生データは時刻ごとに不変なので、既に存在するファイルには書かない。 */
export function writeRawIfAbsent(filePath, text) {
  if (fs.existsSync(filePath)) return false;
  writeRaw(filePath, text);
  return true;
}

// ---------------------------------------------------------------- パス

export const eventsRoot = (root) => path.join(root, 'data', 'events');
export const eventsJsonPath = (root) => path.join(root, 'data', 'events.json');
export const eventDir = (root, eventId) => path.join(eventsRoot(root), eventId);
export const eventJsonPath = (root, eventId) => path.join(eventDir(root, eventId), 'event.json');
export const videosJsonPath = (root, eventId) => path.join(eventDir(root, eventId), 'videos.json');
export const logPath = (root, eventId) =>
  path.join(eventDir(root, eventId), 'collection-log.jsonl');

export const indexJsonPath = (root, eventId, division) =>
  path.join(eventDir(root, eventId), 'hourly', division, 'index.json');
export const snapshotPath = (root, eventId, division, hourKey) =>
  path.join(eventDir(root, eventId), 'hourly', division, `${hourKey}.json`);
export const rawSnapshotPath = (root, eventId, division, hourKey) =>
  path.join(eventDir(root, eventId), 'raw', 'hourly', division, `${hourKey}.json.gz`);

export const finalPath = (root, eventId, division) =>
  path.join(eventDir(root, eventId), 'final', `${division}.json`);
export const rawFinalPath = (root, eventId, division) =>
  path.join(eventDir(root, eventId), 'raw', 'final', `${division}.html.gz`);

/**
 * 解析に失敗した生データ・別の開催回だった生データの退避先。
 * スナップショットと 1 対 1 にならないため raw/hourly とは分ける
 * （reparse.js が raw/hourly だけを辿れるようにするため）。
 */
export const rawAnomalyPath = (root, eventId, kind, division, fileName) =>
  path.join(eventDir(root, eventId), 'raw', kind, division, fileName);

// ---------------------------------------------------------------- event.json

/**
 * 新しい開催回が先。順序は `collect.hourFrom`（実際の開催時期）で決める。
 *
 * **eventId の季節名から順序を決めてはいけない。**
 * 公式の命名は開催時期を保証しない。「冬」が年初に開催されるとは限らず、
 * 2027 夏が 7 月・2027 冬が 12 月ということもあり得る。
 * `collect.hourFrom` は必須項目で、その回の集計開始より前を指すため、
 * 命名の規則を仮定せずに実際の時系列で並べられる。
 */
export function compareEventDesc(a, b) {
  const ta = hourKeyToEpoch(a.collect.hourFrom);
  const tb = hourKeyToEpoch(b.collect.hourFrom);
  if (ta !== tb) return tb - ta;
  return compareString(b.eventId, a.eventId);
}

/** ディレクトリ名の一覧。並びに意味は持たせない（順序は readEvents が決める）。 */
export function listEventIds(root) {
  const dir = eventsRoot(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((eventId) => fs.existsSync(eventJsonPath(root, eventId)))
    .sort(compareString);
}

/** すべての開催回を読み、新しい順に並べて返す。 */
export function readEvents(root) {
  return listEventIds(root)
    .map((eventId) => readEvent(root, eventId))
    .sort(compareEventDesc);
}

function requireString(value, label) {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} が無い`);
  return value;
}

export function readEvent(root, eventId) {
  const filePath = eventJsonPath(root, eventId);
  const raw = readJsonFile(filePath);
  if (raw === null) throw new Error(`${filePath} が無い`);

  const where = `${eventId}/event.json`;
  if (raw.eventId !== eventId) {
    throw new Error(`${where}: eventId がディレクトリ名と一致しない（${raw.eventId}）`);
  }
  if (!Array.isArray(raw.divisions) || raw.divisions.length === 0) {
    throw new Error(`${where}: divisions が無い`);
  }
  const collect = raw.collect ?? {};

  return {
    eventId,
    title: requireString(raw.title, `${where}: title`),
    parser: requireString(raw.parser, `${where}: parser`),
    finalParser: raw.finalParser ?? null,
    eventTag: requireString(raw.eventTag, `${where}: eventTag`),
    divisions: raw.divisions,
    collect: {
      hourFrom: requireString(collect.hourFrom, `${where}: collect.hourFrom`),
      hourUntil: requireString(collect.hourUntil, `${where}: collect.hourUntil`),
      until: requireString(collect.until, `${where}: collect.until`),
      maxRequestsPerRun: collect.maxRequestsPerRun ?? DEFAULT_MAX_REQUESTS_PER_RUN,
    },
    final: raw.final ?? null,
  };
}

/** data/events.json は event.json から生成する。手で編集しない。 */
export function writeEventsJson(root, events) {
  const value = {
    schemaVersion: SCHEMA_VERSION,
    events: events.map((event) => ({ eventId: event.eventId, title: event.title })),
  };
  return writeJsonIfChanged(eventsJsonPath(root), value, ['events']);
}

// ---------------------------------------------------------------- index.json

export function readIndexState(root, eventId, division) {
  const raw = readJsonFile(indexJsonPath(root, eventId, division));
  return {
    eventId,
    division,
    aggregationPeriod: raw?.aggregationPeriod ?? null,
    collected: raw?.collected ?? [],
    unavailable: raw?.unavailable ?? [],
    changed: false,
  };
}

export function knownHourKeys(state) {
  return new Set([
    ...state.collected.map((entry) => entry.hourKey),
    ...state.unavailable.map((entry) => entry.hourKey),
  ]);
}

export function addCollected(state, hourKey, entryCount) {
  state.collected = state.collected
    .filter((entry) => entry.hourKey !== hourKey)
    .concat([{ hourKey, entryCount }])
    .sort((a, b) => compareHourKey(a.hourKey, b.hourKey));
  state.changed = true;
}

export function addUnavailable(state, hourKey, reason) {
  state.unavailable = state.unavailable
    .filter((entry) => entry.hourKey !== hourKey)
    .concat([{ hourKey, reason }])
    .sort((a, b) => compareHourKey(a.hourKey, b.hourKey));
  state.changed = true;
}

/**
 * 公式の集計期間を記録する。既存の記録と変わった場合は保存しつつ警告を返す。
 * @returns {string|null} 警告文
 */
export function recordAggregationPeriod(state, ranking) {
  const next = {
    startDateTime: ranking.startDateTime,
    endDateTime: ranking.endDateTime,
    source: 'official',
  };
  const prev = state.aggregationPeriod;
  if (prev && prev.startDateTime === next.startDateTime && prev.endDateTime === next.endDateTime) {
    return null;
  }
  state.aggregationPeriod = next;
  state.changed = true;
  if (!prev) return null;
  return (
    `${state.division}: 集計期間が変わった` +
    `（${prev.startDateTime}〜${prev.endDateTime} → ${next.startDateTime}〜${next.endDateTime}）`
  );
}

export function writeIndexState(root, state, updatedAt) {
  const value = {
    schemaVersion: SCHEMA_VERSION,
    eventId: state.eventId,
    division: state.division,
    updatedAt,
    ...(state.aggregationPeriod ? { aggregationPeriod: state.aggregationPeriod } : {}),
    collected: state.collected,
    unavailable: state.unavailable,
  };
  return writeJsonIfChanged(indexJsonPath(root, state.eventId, state.division), value, [
    'collected',
    'unavailable',
  ]);
}

// ---------------------------------------------------------------- スナップショット

export function buildSnapshot({
  eventId,
  division,
  hourKey,
  capturedAt,
  url,
  parser,
  ranking,
  columns,
  entries,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    eventId,
    division,
    hourKey,
    aggregatedAt: hourKeyToIso(hourKey),
    capturedAt,
    source: { url, parser },
    ranking,
    columns,
    entries,
  };
}

export function writeSnapshot(root, snapshot) {
  const filePath = snapshotPath(root, snapshot.eventId, snapshot.division, snapshot.hourKey);
  return writeJsonIfChanged(filePath, snapshot, ['columns', 'entries']);
}

// ---------------------------------------------------------------- 最終ランキング

/**
 * 毎時スナップショットと同じ columns / entries を持つ。閲覧側が同じ描画処理を使える。
 * 時刻に紐づかない全期間集計なので hourKey / aggregatedAt / ranking は持たない。
 */
export function buildFinalRanking({ eventId, division, capturedAt, url, parser, columns, entries }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    eventId,
    division,
    isFinal: true,
    capturedAt,
    source: { url, parser },
    columns,
    entries,
  };
}

const FINAL_COMPACT_KEYS = ['columns', 'entries'];

export function writeFinalRanking(root, final) {
  const filePath = finalPath(root, final.eventId, final.division);
  const prev = readJsonFile(filePath);
  // 取得し直しただけで capturedAt の差分を出さない。順位が同じなら据え置く。
  const unchanged =
    prev !== null &&
    stringifyJson({ ...final, capturedAt: prev.capturedAt }, FINAL_COMPACT_KEYS) ===
      stringifyJson(prev, FINAL_COMPACT_KEYS);
  if (unchanged) return false;
  return writeJsonIfChanged(filePath, final, FINAL_COMPACT_KEYS);
}

// ---------------------------------------------------------------- videos.json

const VIDEO_KEYS = [
  'title',
  'registeredAt',
  'duration',
  'owner',
  'thumbnailUrl',
  'shortDescription',
];

export function readVideos(root, eventId) {
  const raw = readJsonFile(videosJsonPath(root, eventId));
  return { videos: raw?.videos ?? {}, changed: false };
}

/**
 * videos.json をマージ更新する。
 *
 * 取り込むスナップショットの hourKey が既存の sourceHour 以上なら上書きし、
 * 未満なら無視する。こうしておくと、どの順で何回流しても同じ結果になり、
 * raw/ からの再解析と結果が一致する。
 *
 * 最終ランキングからの取り込みでは hourKey に `'final'` を渡す。
 * 辞書順でどの時刻キーよりも後になるため、開催後に取得した最終ランキングの値が
 * 常に勝つ。これも順序に依存しない。
 */
export function mergeVideos(state, incoming, hourKey) {
  for (const [watchId, video] of Object.entries(incoming)) {
    const prev = state.videos[watchId];
    if (prev && compareHourKey(hourKey, prev.sourceHour ?? '') < 0) continue;

    const next = {};
    for (const key of VIDEO_KEYS) next[key] = video[key] ?? null;
    next.sourceHour = hourKey;

    if (prev && JSON.stringify(prev) === JSON.stringify(next)) continue;
    state.videos[watchId] = next;
    state.changed = true;
  }
}

export function writeVideos(root, eventId, state) {
  const sorted = {};
  for (const watchId of Object.keys(state.videos).sort(compareString)) {
    sorted[watchId] = state.videos[watchId];
  }
  const value = { schemaVersion: SCHEMA_VERSION, eventId, videos: sorted };
  return writeJsonIfChanged(videosJsonPath(root, eventId), value, ['owner']);
}

// ---------------------------------------------------------------- ログ

/** collection-log.jsonl に 1 行追記する。保存に至らなかった試行も残す。 */
export function appendLog(root, eventId, record) {
  const filePath = logPath(root, eventId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}
