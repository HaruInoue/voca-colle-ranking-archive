import { parseHourKey, formatNumber } from './format.js';
import { METRIC_KEYS, METRIC_LABELS, toEntries, rankDelta, rankMapOf } from './ranking.js';
import { videoHref } from './urls.js';

/** 時刻列のHTMLを生成する。 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const DELTA_PRESENTATION = {
  none: { className: 'delta-none', text: '-', label: '比較できる前の時刻がありません' },
  rankin: { className: 'delta-rankin', text: 'Rank in', label: '前の時刻は100位圏外' },
  same: { className: 'delta-same', text: '→ 0', label: '順位変わらず' },
  up: { className: 'delta-up', text: '▲', label: '順位上昇' },
  down: { className: 'delta-down', text: '▼', label: '順位下降' },
};

function deltaHtml(delta) {
  const presentation = DELTA_PRESENTATION[delta.kind];
  const text =
    delta.kind === 'up' || delta.kind === 'down' ? `${presentation.text} ${delta.value}` : presentation.text;
  return `<span class="delta ${presentation.className}"><span aria-hidden="true">${escapeHtml(
    text
  )}</span><span class="visually-hidden">${escapeHtml(presentation.label)}${
    delta.kind === 'up' || delta.kind === 'down' ? ` ${delta.value}位` : ''
  }</span></span>`;
}

function rowHtml({ entry, delta, video, eventId, showDelta }) {
  const title = video.title;
  const metrics = METRIC_KEYS.map(
    (key) =>
      `<div class="metric metric-${key}"><dt>${escapeHtml(METRIC_LABELS[key])}</dt><dd>${escapeHtml(
        formatNumber(entry[key])
      )}</dd></div>`
  ).join('');

  const medalClass = entry.rank <= 3 ? ` rank-num-medal rank-num-${entry.rank}` : '';

  return `<li class="rank-row">
<div class="rank-head"><span class="rank-num${medalClass}">${entry.rank}</span>${
    showDelta ? deltaHtml(delta) : ''
  }</div>
<a class="rank-song" href="${escapeHtml(videoHref(eventId, entry.watchId))}">
<img class="rank-thumb" src="${escapeHtml(video.thumbnailUrl)}" alt="${escapeHtml(
    `${title} のサムネイル`
  )}" loading="lazy" decoding="async" width="130" height="100">
<span class="rank-title">${escapeHtml(title)}</span>
</a>
<div class="rank-owner">${escapeHtml(video.owner?.name ?? '')}</div>
<dl class="rank-metrics">${metrics}</dl>
</li>`;
}

/** 列の本文を生成する。 */
export function columnBodyHtml({ snapshot, previousSnapshot, videos, eventId, isFinal = false }) {
  const entries = toEntries(snapshot);
  const showDelta = !isFinal;
  const previousRanks = previousSnapshot ? rankMapOf(toEntries(previousSnapshot)) : null;

  const rows = entries
    .map((entry) => {
      const video = videos[entry.watchId];
      if (!video) {
        throw new Error(
          `曲情報が見つかりません: ${eventId} / ${snapshot.division} / ${
            snapshot.hourKey ?? 'final'
          } の ${entry.watchId}`
        );
      }
      return rowHtml({
        entry,
        delta: showDelta ? rankDelta(entry.rank, entry.watchId, previousRanks) : { kind: 'none' },
        video,
        eventId,
        showDelta,
      });
    })
    .join('\n');

  return `<ol class="col-rows">\n${rows}\n</ol>`;
}

/** 列見出しを生成する。 */
function headingHtml(columnId) {
  if (columnId === 'final') return '<span class="col-final">最終ランキング</span>';
  const { date, time } = parseHourKey(columnId);
  return `<span class="col-date">${escapeHtml(date)}</span><span class="col-time">${escapeHtml(
    time
  )}</span>`;
}

/** 列の枠を生成する。 */
export function columnShellHtml(columnId, body = null) {
  const isFinal = columnId === 'final';
  const safeId = escapeHtml(columnId);
  const loaded = body !== null;

  const bodyContent = loaded
    ? body
    : '<div class="col-skeleton" aria-hidden="true"></div><p class="visually-hidden">読み込み待ちです</p>';

  return `<section class="rank-col${isFinal ? ' rank-col-final' : ''}" data-column="${safeId}" aria-labelledby="col-head-${safeId}">
<div class="col-top">
<h3 class="col-head" id="col-head-${safeId}" tabindex="-1">${headingHtml(columnId)}</h3>
</div>
<div class="col-body" data-state="${loaded ? 'loaded' : 'placeholder'}"${
    isFinal ? '' : ` data-hour="${safeId}"`
  }${loaded ? '' : ' aria-busy="true"'}>${bodyContent}</div>
</section>`;
}
