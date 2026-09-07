// 最終ランキングのアーカイブページを解析する。

import { ParseError } from './parse-error.js';

export const name = 'archive-page-v1';

export const columns = ['rank', 'watchId', 'view', 'comment', 'mylist', 'like'];

const NEXT_DATA_RE = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const METRICS = ['view', 'comment', 'mylist', 'like'];

function requireString(value, label) {
  if (typeof value !== 'string' || value === '') throw new ParseError(`${label} が文字列でない`);
  return value;
}

function optionalString(value) {
  return typeof value === 'string' ? value : null;
}

function requireInteger(value, label) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ParseError(`${label} が整数でない`);
  }
  return value;
}

/** アーカイブページを解析する。 */
export function parse(rawHtml, _context = {}) {
  const matched = NEXT_DATA_RE.exec(rawHtml);
  if (!matched) throw new ParseError('__NEXT_DATA__ が無い（構造 C の可能性がある）');

  let data;
  try {
    data = JSON.parse(matched[1]);
  } catch (cause) {
    throw new ParseError(`__NEXT_DATA__ が JSON として読めない: ${cause.message}`);
  }

  const pageProps = data?.props?.pageProps;
  if (!pageProps || typeof pageProps !== 'object') throw new ParseError('props.pageProps が無い');

  const items = pageProps.localRankingData?.data?.items;
  if (!Array.isArray(items)) {
    const shape = Object.keys(pageProps.localRankingData?.data ?? {}).join(', ') || '（なし）';
    throw new ParseError(`localRankingData.data.items が配列でない（data のキー: ${shape}）`);
  }
  if (items.length === 0) throw new ParseError('items が空');

  const entries = [];
  const videos = {};

  items.forEach((item, i) => {
    const video = item?.video;
    if (!video || typeof video !== 'object') throw new ParseError(`items[${i}].video が無い`);

    const rank = i + 1;
    const watchId = requireString(video.id, `items[${i}].video.id`);
    if (item.watchId !== undefined && item.watchId !== watchId) {
      throw new ParseError(`items[${i}]: watchId と video.id が一致しない`);
    }
    const count = video.count;
    if (!count || typeof count !== 'object') throw new ParseError(`items[${i}].video.count が無い`);

    entries.push([
      rank,
      watchId,
      ...METRICS.map((metric) =>
        requireInteger(count[metric], `items[${i}].video.count.${metric}`),
      ),
    ]);

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
