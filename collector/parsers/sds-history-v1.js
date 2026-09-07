// 毎時履歴JSONを解析する。

import { ParseError } from './parse-error.js';

export const name = 'sds-history-v1';

export const columns = ['rank', 'watchId', 'view', 'comment', 'mylist', 'like'];

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

/** 毎時履歴JSONを解析する。 */
export function parse(rawText, _context = {}) {
  let body;
  try {
    body = JSON.parse(rawText);
  } catch (cause) {
    throw new ParseError(`JSON として読めない: ${cause.message}`);
  }

  const metaStatus = body?.meta?.status;
  if (typeof metaStatus !== 'number') throw new ParseError('meta.status が無い');
  if (metaStatus === 404) {
    return { status: 'out-of-period', ranking: null, entries: [], videos: {} };
  }
  if (metaStatus !== 200) throw new ParseError(`meta.status が想定外: ${metaStatus}`);

  const rankingRaw = body?.data?.ranking;
  if (!rankingRaw || typeof rankingRaw !== 'object') throw new ParseError('data.ranking が無い');

  const setting = rankingRaw.setting;
  if (!setting || typeof setting !== 'object') throw new ParseError('data.ranking.setting が無い');

  const ranking = {
    id: requireInteger(rankingRaw.id ?? setting.id, 'ranking.id'),
    tag: requireString(setting.tag, 'setting.tag'),
    term: requireString(setting.term, 'setting.term'),
    startDateTime: requireString(setting.startDateTime, 'setting.startDateTime'),
    endDateTime: requireString(setting.endDateTime, 'setting.endDateTime'),
  };

  const videosRaw = rankingRaw.videos;
  if (!Array.isArray(videosRaw)) throw new ParseError('data.ranking.videos が配列でない');
  if (videosRaw.length === 0) return { status: 'empty', ranking, entries: [], videos: {} };

  const entries = [];
  const videos = {};

  videosRaw.forEach((video, i) => {
    if (!video || typeof video !== 'object') throw new ParseError(`videos[${i}] がオブジェクトでない`);

    const rank = i + 1;
    const watchId = requireString(video.id, `videos[${i}].id`);
    const count = video.count;
    if (!count || typeof count !== 'object') throw new ParseError(`videos[${i}].count が無い`);

    entries.push([
      rank,
      watchId,
      ...METRICS.map((metric) => requireInteger(count[metric], `videos[${i}].count.${metric}`)),
    ]);

    const owner = video.owner;
    videos[watchId] = {
      title: requireString(video.title, `videos[${i}].title`),
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

  return { status: 'ok', ranking, entries, videos };
}
