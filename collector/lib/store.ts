// data配下を読み書きする。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { compareHourKey, hourKeyToEpoch, hourKeyToIso } from '#lib/hours.ts';

import type {
  AggregationPeriod,
  CollectionLogLine,
  Division,
  EventFile,
  EventId,
  FinalRanking,
  HourKey,
  HourlyIndex,
  IsoDateTime,
  RankingColumn,
  RankingEntry,
  RankingMeta,
  Snapshot,
  UnavailableReason,
  Video,
  VideosFile,
  WatchId,
} from '@data-model';

export const SCHEMA_VERSION = 1;
const DEFAULT_MAX_REQUESTS_PER_RUN = 120;

/** event.json を正規化したもの。省略可能な項目は null で埋める。 */
export interface CollectorEvent {
  eventId: EventId;
  title: string;
  parser: string;
  finalParser: string | null;
  eventTag: string;
  divisions: Division[];
  collect: {
    hourFrom: HourKey;
    hourUntil: HourKey;
    until: IsoDateTime;
    maxRequestsPerRun: number;
  };
  final: EventFile['final'] | null;
}

/** index.json の読み書きに使う可変状態。 */
export interface IndexState {
  eventId: EventId;
  division: Division;
  aggregationPeriod: AggregationPeriod | null;
  collected: { hourKey: HourKey; entryCount: number }[];
  unavailable: { hourKey: HourKey; reason: UnavailableReason }[];
  changed: boolean;
}

/** videos.json の読み書きに使う可変状態。 */
export interface VideosState {
  videos: Record<WatchId, Video>;
  changed: boolean;
}

/** 文字列を比較する。 */
export const compareString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- 直列化

const isPrimitive = (v: unknown): boolean => v === null || typeof v !== 'object';

function renderInline(value: unknown): string {
  if (isPrimitive(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(renderInline).join(', ')}]`;
  const parts = Object.entries(value as object).map(
    ([key, v]) => `${JSON.stringify(key)}: ${renderInline(v)}`,
  );
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
}

function renderCompact(value: unknown, indent: string): string {
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

function render(value: unknown, indent: string, compactKeys: Set<string>): string {
  if (isPrimitive(value)) return JSON.stringify(value);
  const pad = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => pad + render(v, pad, compactKeys)).join(',\n');
    return `[\n${items}\n${indent}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) return '{}';
  const items = keys
    .map((key) => {
      const rendered = compactKeys.has(key)
        ? renderCompact(record[key], pad)
        : render(record[key], pad, compactKeys);
      return `${pad}${JSON.stringify(key)}: ${rendered}`;
    })
    .join(',\n');
  return `{\n${items}\n${indent}}`;
}

/** JSONを固定形式で文字列化する。 */
export function stringifyJson(value: unknown, compactKeys: string[] = []): string {
  return `${render(value, '', new Set(compactKeys))}\n`;
}

// ---------------------------------------------------------------- ファイル

export function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`${filePath} が JSON として読めない: ${detail}`);
  }
}

/** 内容が変わる場合だけテキストを書き込む。 */
export function writeTextIfChanged(filePath: string, text: string, dryRun = false): boolean {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === text) return false;
  if (dryRun) return true;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, 'utf8');
  return true;
}

export function writeJsonIfChanged(
  filePath: string,
  value: unknown,
  compactKeys: string[],
  dryRun = false,
): boolean {
  return writeTextIfChanged(filePath, stringifyJson(value, compactKeys), dryRun);
}

/** 生データをgzipで書き込む。 */
export function writeRaw(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }));
}

/** 生データを読み込む。 */
export function readRaw(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8');
}

/** 存在しない場合だけ生データを書き込む。 */
export function writeRawIfAbsent(filePath: string, text: string): boolean {
  if (fs.existsSync(filePath)) return false;
  writeRaw(filePath, text);
  return true;
}

// ---------------------------------------------------------------- パス

export const eventsRoot = (root: string): string => path.join(root, 'data', 'events');
export const eventsJsonPath = (root: string): string => path.join(root, 'data', 'events.json');
export const eventDir = (root: string, eventId: EventId): string =>
  path.join(eventsRoot(root), eventId);
export const eventJsonPath = (root: string, eventId: EventId): string =>
  path.join(eventDir(root, eventId), 'event.json');
export const videosJsonPath = (root: string, eventId: EventId): string =>
  path.join(eventDir(root, eventId), 'videos.json');
export const logPath = (root: string, eventId: EventId): string =>
  path.join(eventDir(root, eventId), 'collection-log.jsonl');

export const indexJsonPath = (root: string, eventId: EventId, division: Division): string =>
  path.join(eventDir(root, eventId), 'hourly', division, 'index.json');
export const snapshotPath = (
  root: string,
  eventId: EventId,
  division: Division,
  hourKey: HourKey,
): string => path.join(eventDir(root, eventId), 'hourly', division, `${hourKey}.json`);
export const rawHourlyDir = (root: string, eventId: EventId, division: Division): string =>
  path.join(eventDir(root, eventId), 'raw', 'hourly', division);
export const rawSnapshotPath = (
  root: string,
  eventId: EventId,
  division: Division,
  hourKey: HourKey,
): string => path.join(rawHourlyDir(root, eventId, division), `${hourKey}.json.gz`);

/** 保存済みraw時刻キーを返す。 */
export function listRawHourKeys(root: string, eventId: EventId, division: Division): HourKey[] {
  const dir = rawHourlyDir(root, eventId, division);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json.gz'))
    .map((name) => name.slice(0, -'.json.gz'.length))
    .sort(compareHourKey);
}

export const finalPath = (root: string, eventId: EventId, division: Division): string =>
  path.join(eventDir(root, eventId), 'final', `${division}.json`);
export const rawFinalPath = (root: string, eventId: EventId, division: Division): string =>
  path.join(eventDir(root, eventId), 'raw', 'final', `${division}.html.gz`);

/**
 * 解析に失敗した生データ・別の開催回だった生データの退避先。
 * スナップショットと 1 対 1 にならないため raw/hourly とは分ける
 * （reparse.js が raw/hourly だけを辿れるようにするため）。
 */
export const rawAnomalyPath = (
  root: string,
  eventId: EventId,
  kind: string,
  division: Division,
  fileName: string,
): string => path.join(eventDir(root, eventId), 'raw', kind, division, fileName);

// ---------------------------------------------------------------- event.json

/** 開催回を新しい順に比較する。 */
export function compareEventDesc(a: CollectorEvent, b: CollectorEvent): number {
  const ta = hourKeyToEpoch(a.collect.hourFrom);
  const tb = hourKeyToEpoch(b.collect.hourFrom);
  if (ta !== tb) return tb - ta;
  return compareString(b.eventId, a.eventId);
}

/** 開催回IDを返す。 */
export function listEventIds(root: string): EventId[] {
  const dir = eventsRoot(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((eventId) => fs.existsSync(eventJsonPath(root, eventId)))
    .sort(compareString);
}

/** 全開催回を新しい順で返す。 */
export function readEvents(root: string): CollectorEvent[] {
  return listEventIds(root)
    .map((eventId) => readEvent(root, eventId))
    .sort(compareEventDesc);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${label} が無い`);
  return value;
}

export function readEvent(root: string, eventId: EventId): CollectorEvent {
  const filePath = eventJsonPath(root, eventId);
  const raw = readJsonFile<any>(filePath);
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

/** events.jsonを書き出す。 */
export function writeEventsJson(root: string, events: CollectorEvent[]): boolean {
  const value = {
    schemaVersion: SCHEMA_VERSION,
    events: events.map((event) => ({ eventId: event.eventId, title: event.title })),
  };
  return writeJsonIfChanged(eventsJsonPath(root), value, ['events']);
}

// ---------------------------------------------------------------- index.json

export function readIndexState(root: string, eventId: EventId, division: Division): IndexState {
  const raw = readJsonFile<HourlyIndex>(indexJsonPath(root, eventId, division));
  return {
    eventId,
    division,
    aggregationPeriod: raw?.aggregationPeriod ?? null,
    collected: raw?.collected ?? [],
    unavailable: raw?.unavailable ?? [],
    changed: false,
  };
}

export function knownHourKeys(state: IndexState): Set<HourKey> {
  return new Set([
    ...state.collected.map((entry) => entry.hourKey),
    ...state.unavailable.map((entry) => entry.hourKey),
  ]);
}

export function addCollected(state: IndexState, hourKey: HourKey, entryCount: number): void {
  state.collected = state.collected
    .filter((entry) => entry.hourKey !== hourKey)
    .concat([{ hourKey, entryCount }])
    .sort((a, b) => compareHourKey(a.hourKey, b.hourKey));
  state.changed = true;
}

export function addUnavailable(
  state: IndexState,
  hourKey: HourKey,
  reason: UnavailableReason,
): void {
  state.unavailable = state.unavailable
    .filter((entry) => entry.hourKey !== hourKey)
    .concat([{ hourKey, reason }])
    .sort((a, b) => compareHourKey(a.hourKey, b.hourKey));
  state.changed = true;
}

/** 公式の集計期間を記録する。 */
export function recordAggregationPeriod(state: IndexState, ranking: RankingMeta): string | null {
  const next: AggregationPeriod = {
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

export function writeIndexState(
  root: string,
  state: IndexState,
  updatedAt: IsoDateTime,
  dryRun = false,
): boolean {
  const value = {
    schemaVersion: SCHEMA_VERSION,
    eventId: state.eventId,
    division: state.division,
    updatedAt,
    ...(state.aggregationPeriod ? { aggregationPeriod: state.aggregationPeriod } : {}),
    collected: state.collected,
    unavailable: state.unavailable,
  };
  return writeJsonIfChanged(
    indexJsonPath(root, state.eventId, state.division),
    value,
    ['collected', 'unavailable'],
    dryRun,
  );
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
}: {
  eventId: EventId;
  division: Division;
  hourKey: HourKey;
  capturedAt: IsoDateTime;
  url: string;
  parser: string;
  ranking: RankingMeta;
  columns: RankingColumn[];
  entries: RankingEntry[];
}): Snapshot {
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

export function writeSnapshot(root: string, snapshot: Snapshot, dryRun = false): boolean {
  const filePath = snapshotPath(root, snapshot.eventId, snapshot.division, snapshot.hourKey);
  return writeJsonIfChanged(filePath, snapshot, ['columns', 'entries'], dryRun);
}

// ---------------------------------------------------------------- 最終ランキング

/** 最終ランキングの保存データを作る。 */
export function buildFinalRanking({
  eventId,
  division,
  capturedAt,
  url,
  parser,
  columns,
  entries,
}: {
  eventId: EventId;
  division: Division;
  capturedAt: IsoDateTime;
  url: string;
  parser: string;
  columns: RankingColumn[];
  entries: RankingEntry[];
}): FinalRanking {
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

export function writeFinalRanking(root: string, final: FinalRanking, dryRun = false): boolean {
  const filePath = finalPath(root, final.eventId, final.division);
  const prev = readJsonFile<FinalRanking>(filePath);
  const unchanged =
    prev !== null &&
    stringifyJson({ ...final, capturedAt: prev.capturedAt }, FINAL_COMPACT_KEYS) ===
      stringifyJson(prev, FINAL_COMPACT_KEYS);
  if (unchanged) return false;
  return writeJsonIfChanged(filePath, final, FINAL_COMPACT_KEYS, dryRun);
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

export function readVideos(root: string, eventId: EventId): VideosState {
  const raw = readJsonFile<VideosFile>(videosJsonPath(root, eventId));
  return { videos: raw?.videos ?? {}, changed: false };
}

/** 動画情報をマージする。 */
export function mergeVideos(
  state: VideosState,
  incoming: Record<WatchId, Video>,
  hourKey: HourKey | 'final',
): void {
  for (const [watchId, video] of Object.entries(incoming)) {
    const prev = state.videos[watchId];
    if (prev && compareHourKey(hourKey, prev.sourceHour ?? '') < 0) continue;

    const source = video as unknown as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const key of VIDEO_KEYS) next[key] = source[key] ?? null;
    next.sourceHour = hourKey;

    if (prev && JSON.stringify(prev) === JSON.stringify(next)) continue;
    state.videos[watchId] = next as unknown as Video;
    state.changed = true;
  }
}

export function writeVideos(
  root: string,
  eventId: EventId,
  state: VideosState,
  dryRun = false,
): boolean {
  const sorted: Record<WatchId, Video> = {};
  for (const watchId of Object.keys(state.videos).sort(compareString)) {
    sorted[watchId] = state.videos[watchId];
  }
  const value = { schemaVersion: SCHEMA_VERSION, eventId, videos: sorted };
  return writeJsonIfChanged(videosJsonPath(root, eventId), value, ['owner'], dryRun);
}

// ---------------------------------------------------------------- ログ

/** 収集ログを追記する。 */
export function appendLog(root: string, eventId: EventId, record: CollectionLogLine): void {
  const filePath = logPath(root, eventId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}
