// 最終ランキングのパーサ（アーカイブページの __NEXT_DATA__、構造 A）。
//
// https://vocaloid-collection.jp/{year}-{season}/ranking/{division}/
// props.pageProps.localRankingData.data.items[].video
//
// 対応する開催回: 2025 夏 / 2026 冬 / 2026 夏
// 構造 B（mylist 形式）と構造 C（__NEXT_DATA__ なし）は別の版が要る。
//
// HTTP も保存も知らない純関数として保つ。
//
// **動画情報の正規化は sds-history-v1.js と重複しているが、共通化しない。**
// パーサは開催回ごとに版を固定して凍結する（06-decisions.md D-13）。
// 共通化すると、片方の版のために手を入れたときにもう片方の出力まで変わり、
// raw/ からの再解析で過去と同じ結果を得られなくなる。

import { ParseError } from './parse-error.js';

export const name = 'archive-page-v1';

/** 毎時スナップショットと同じ列。閲覧側が同じ描画処理を使えるようにする。 */
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

/**
 * @param {string} rawHtml アーカイブページの HTML
 * @param {object} _context event.json の値（この版では使わない）
 * @returns {{ pageId: string|null, entries: Array<Array<number|string>>, videos: Record<string, object> }}
 * @throws {ParseError} 想定の構造で読めない場合
 */
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
    // 構造 B は data.mylist.items[] にある。別の版で扱う。
    const shape = Object.keys(pageProps.localRankingData?.data ?? {}).join(', ') || '（なし）';
    throw new ParseError(`localRankingData.data.items が配列でない（data のキー: ${shape}）`);
  }
  if (items.length === 0) throw new ParseError('items が空');

  const entries = [];
  const videos = {};

  items.forEach((item, i) => {
    const video = item?.video;
    if (!video || typeof video !== 'object') throw new ParseError(`items[${i}].video が無い`);

    // ページはこの配列から描画される。順位番号は持たないため掲載順から採番する。
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

  // 部門の識別子。取得したページが目的の部門のものかの検証に使う
  // （毎時履歴の setting.tag に相当するものがアーカイブページには無い）。
  return { pageId: optionalString(pageProps.pageId), entries, videos };
}
