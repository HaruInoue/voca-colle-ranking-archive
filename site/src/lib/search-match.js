/** 検索語と索引の突き合わせ。ブラウザ側で動くが DOM に触らないのでここに置く。 */

/** 候補リストに並べる最大件数。あふれた分は「他◯件」として件数だけ伝える。 */
export const MAX_SUGGESTIONS = 5;

/** 照合に使う正規形。全角英数と大文字小文字の差を吸収するだけで、かなや読みの変換はしない。 */
export function normalize(text) {
  return text.normalize('NFKC').toLowerCase();
}

/**
 * 入力を検索条件にする。
 * sm+数字を含む入力は動画IDの検索として扱うので、動画URLや外部サイトのURLも貼れる。
 * それ以外は空白区切りの語すべてを含むもの（AND）を探す。
 */
export function parseQuery(input) {
  const normalized = normalize(input).trim();
  const watchId = normalized.match(/sm\d+/)?.[0] ?? null;
  if (watchId) return { watchId, terms: [] };
  return { watchId: null, terms: normalized.split(/\s+/).filter(Boolean) };
}

/** 配信された索引を照合しやすい形にする。正規化は行数ぶんかかるので読み込み時の1回だけにする。 */
export function prepareRows(index) {
  return index.videos.map(([watchId, title, owner, eventId]) => ({
    watchId,
    title,
    owner,
    eventId,
    id: normalize(watchId),
    haystack: normalize(`${title} ${owner}`),
  }));
}

/**
 * 候補を絞る。
 * 索引は最高順位の良い順に並んでいるので、先頭から limit 件取れば上位のものが残る。
 */
export function searchVideos(rows, input, limit = MAX_SUGGESTIONS) {
  const { watchId, terms } = parseQuery(input);
  if (!watchId && terms.length === 0) return { hits: [], total: 0 };
  const matches = watchId
    ? (row) => row.id.includes(watchId)
    : (row) => terms.every((term) => row.haystack.includes(term));

  const hits = [];
  let total = 0;
  for (const row of rows) {
    if (!matches(row)) continue;
    total += 1;
    if (hits.length < limit) hits.push(row);
  }
  return { hits, total };
}
