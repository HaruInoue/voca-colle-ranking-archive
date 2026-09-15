// 最終ランキングのアーカイブページを解析する。

import { ParseError } from '#parsers/parse-error.ts';

import type { FinalParseResult, RankingColumn, RankingEntry, Video, WatchId } from '@data-model';

export const name = 'archive-page-v1';

export const columns: RankingColumn[] = ['rank', 'watchId', 'view', 'comment', 'mylist', 'like'];

const NEXT_DATA_RE = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const METRICS = ['view', 'comment', 'mylist', 'like'] as const;

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw new ParseError(`${label} が文字列でない`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ParseError(`${label} が整数でない`);
  }
  return value;
}

/** アーカイブページを解析する。 */
export function parse(rawHtml: string, _context: object = {}): FinalParseResult {
  const matched = NEXT_DATA_RE.exec(rawHtml);
  if (!matched?.[1]) throw new ParseError('__NEXT_DATA__ が無い（構造 C の可能性がある）');

  let data: any;
  try {
    data = JSON.parse(matched[1]);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ParseError(`__NEXT_DATA__ が JSON として読めない: ${detail}`);
  }

  const pageProps = data?.props?.pageProps;
  if (!pageProps || typeof pageProps !== 'object') throw new ParseError('props.pageProps が無い');

  const items = pageProps.localRankingData?.data?.items;
  if (!Array.isArray(items)) {
    const shape = Object.keys(pageProps.localRankingData?.data ?? {}).join(', ') || '（なし）';
    throw new ParseError(`localRankingData.data.items が配列でない（data のキー: ${shape}）`);
  }
  if (items.length === 0) throw new ParseError('items が空');

  const entries: RankingEntry[] = [];
  const videos: Record<WatchId, Video> = {};

  items.forEach((item: any, i: number) => {
    const video = item?.video;
    if (!video || typeof video !== 'object') throw new ParseError(`items[${i}].video が無い`);

    const rank = i + 1;
    const watchId = requireString(video.id, `items[${i}].video.id`);
    if (item.watchId !== undefined && item.watchId !== watchId) {
      throw new ParseError(`items[${i}]: watchId と video.id が一致しない`);
    }
    const count = video.count;
    if (!count || typeof count !== 'object') throw new ParseError(`items[${i}].video.count が無い`);

    const [view, comment, mylist, like] = METRICS.map((metric) =>
      requireInteger(count[metric], `items[${i}].video.count.${metric}`),
    ) as [number, number, number, number];

    entries.push([rank, watchId, view, comment, mylist, like]);

    const owner = video.owner;
    videos[watchId] = {
      title: requireString(video.title, `items[${i}].video.title`),
      registeredAt: optionalString(video.registeredAt),
      duration: typeof video.duration === 'number' ? video.duration : null,
      owner:
        owner && typeof owner === 'object'
          ? {
              type: optionalString(owner.type),
              id: optionalString(owner.id),
              name: optionalString(owner.name),
            }
          : null,
      thumbnailUrl: optionalString(video.thumbnail?.middleUrl),
      shortDescription: optionalString(video.shortDescription),
    };
  });

  return { pageId: optionalString(pageProps.pageId), entries, videos };
}
