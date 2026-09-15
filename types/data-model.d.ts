// data/ 配下の JSON の形。docs/03-data-model.md が定義元。

/** "YYYY-MM-DD-HH00"（JST、分は常に 00）。 */
export type HourKey = string;
/** "2026-08-23T03:00:00+09:00" 形式。 */
export type IsoDateTime = string;
/** "sm46709740"。 */
export type WatchId = string;
/** "2026-summer"。 */
export type EventId = string;
/** "top100" / "rookie" / "remix"。値は event.json の divisions が宣言する。 */
export type Division = string;

export type MetricKey = 'view' | 'comment' | 'mylist' | 'like';
export type RankingColumn = 'rank' | 'watchId' | MetricKey;

/** [rank, watchId, view, comment, mylist, like]。columns と順序が対応する。 */
export type RankingEntry = [number, WatchId, number, number, number, number];

export interface EventSummary {
  eventId: EventId;
  title: string;
}

export interface EventsFile {
  schemaVersion: number;
  events: EventSummary[];
}

export interface Notice {
  title: string;
  body: string;
  division?: Division;
}

export interface EventFile {
  schemaVersion: number;
  eventId: EventId;
  title: string;
  parser: string;
  finalParser: string;
  eventTag: string;
  website?: { notices?: Notice[] };
  collect: {
    hourFrom: HourKey;
    hourUntil: HourKey;
    until: IsoDateTime;
    maxRequestsPerRun?: number;
  };
  divisions: Division[];
  final: {
    archiveUrlTemplate: string;
    submissionFrom: IsoDateTime;
    submissionUntil: IsoDateTime;
  };
}

export interface SourceInfo {
  url: string;
  parser: string;
}

export interface RankingMeta {
  id: number;
  tag: string;
  term: string;
  startDateTime: IsoDateTime;
  endDateTime: IsoDateTime;
}

export interface Snapshot {
  schemaVersion: number;
  eventId: EventId;
  division: Division;
  hourKey: HourKey;
  aggregatedAt: IsoDateTime;
  capturedAt: IsoDateTime;
  source: SourceInfo;
  ranking: RankingMeta;
  columns: RankingColumn[];
  entries: RankingEntry[];
}

export interface FinalRanking {
  schemaVersion: number;
  eventId: EventId;
  division: Division;
  isFinal: true;
  capturedAt: IsoDateTime;
  source: SourceInfo;
  columns: RankingColumn[];
  entries: RankingEntry[];
}

export type UnavailableReason = 'out-of-period' | 'empty' | 'expired';

export interface AggregationPeriod {
  startDateTime: IsoDateTime;
  endDateTime: IsoDateTime;
  source: 'official';
}

export interface HourlyIndex {
  schemaVersion: number;
  eventId: EventId;
  division: Division;
  updatedAt: IsoDateTime;
  aggregationPeriod?: AggregationPeriod;
  collected: { hourKey: HourKey; entryCount: number }[];
  unavailable: { hourKey: HourKey; reason: UnavailableReason }[];
}

export interface VideoOwner {
  type: string | null;
  id: string | null;
  name: string | null;
}

export interface Video {
  title: string;
  registeredAt: IsoDateTime | null;
  duration: number | null;
  owner: VideoOwner | null;
  thumbnailUrl: string | null;
  shortDescription: string | null;
  /** 由来のスナップショット時刻。最終ランキング由来は "final"。表示には使わない。 */
  sourceHour?: HourKey | 'final';
}

export interface VideosFile {
  schemaVersion: number;
  eventId: EventId;
  videos: Record<WatchId, Video>;
}

export type CollectionResult =
  | 'saved'
  | 'out-of-period'
  | 'empty'
  | 'expired'
  | 'error'
  | 'tag-mismatch'
  | 'parse-failed'
  | 'failed';

export interface CollectionLogLine {
  at: IsoDateTime;
  division: Division;
  hourKey?: HourKey;
  httpStatus?: number;
  result: CollectionResult;
  entryCount?: number;
  message?: string;
  tag?: string;
  /** 最終ランキングの取得試行であることを示す。毎時履歴の行には付かない。 */
  target?: 'final';
}

/**
 * 毎時履歴パーサ (sds-history-v1) の戻り値。
 * 集計期間外のときだけ ranking を取得できないため、status で判別する。
 */
export type HourlyParseResult =
  | {
      status: 'out-of-period';
      ranking: null;
      entries: RankingEntry[];
      videos: Record<WatchId, Video>;
    }
  | {
      status: 'ok' | 'empty';
      ranking: RankingMeta;
      entries: RankingEntry[];
      videos: Record<WatchId, Video>;
    };

/** 最終ランキングパーサ (archive-page-v1) の戻り値。 */
export interface FinalParseResult {
  pageId: string | null;
  entries: RankingEntry[];
  videos: Record<WatchId, Video>;
}
