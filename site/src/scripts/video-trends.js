import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { METRIC_LABELS } from '@/lib/ranking.js';
import { niceCeil } from '@/lib/format.js';

/** 曲詳細ページの推移グラフを初期化する。 */
const RANK_RANGE = [1, 100];
const RANK_SPLITS = [1, 20, 40, 60, 80, 100];

const BAR_HEADROOM = 2.6;

const HOUR = 3600;

function readCssColor(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** CSSから解決済みの色を読む。 */
function readPaintColor(className, fallback) {
  const probe = document.createElement('span');
  probe.className = className;
  probe.hidden = true;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || fallback;
}

/** グラフに使う色を今のテーマから読む。色は uPlot に関数で渡し、描画のたびに読み直させる。 */
function readColors() {
  const text = readCssColor('--muted-text', '#5f5f6b');
  return {
    accent: readCssColor('--accent-ink', '#0B5C4A'),
    grid: readCssColor('--border', '#dcdce3'),
    text,
    // キャンバスに塗る色は CSS 側で決める（global.css の .chart-*-color）
    bar: readPaintColor('chart-bar-color', '#c9c6e8'),
    band: readPaintColor('chart-band-color', '#eeeef1'),
    day: readPaintColor('chart-day-color', '#a5a0d5'),
    line: `${text}99`,
  };
}

const pad = (value) => String(value).padStart(2, '0');

/** グラフのx値をJST表記に整形する。 */
function jstDateTime(seconds) {
  const date = new Date(seconds * 1000);
  return {
    date: `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`,
    time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
  };
}

const axisTimeLabels = (splits) => splits.map((seconds) => jstDateTime(seconds).time);

const formatNumber = (value) => value.toLocaleString('ja-JP');
const formatSigned = (value) => (value > 0 ? `+${formatNumber(value)}` : formatNumber(value));

const DAY = 86400;

/** 集計期間外と日付境界を描画する。 */
function underlayHook(tally, colors) {
  return (self) => {
    const { left, top, width, height } = self.bbox;
    const right = left + width;
    const ctx = self.ctx;
    const posX = (seconds) => self.valToPos(seconds, 'x', true);

    const stroke = (x, color, dash) => {
      if (x <= left || x >= right) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, Math.round(uPlot.pxRatio));
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + height);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.clip();

    const edges = [];
    for (const [from, to] of tally
      ? [
          [left, tally.from === null ? left : posX(tally.from)],
          [tally.until === null ? right : posX(tally.until), right],
        ]
      : []) {
      if (to <= from) continue;
      ctx.fillStyle = colors.band;
      ctx.fillRect(from, top, to - from, height);
      edges.push(to === right ? from : to);
    }

    const { min, max } = self.scales.x;
    for (let midnight = Math.ceil(min / DAY) * DAY; midnight <= max; midnight += DAY) {
      stroke(posX(midnight), colors.day, []);
    }

    for (const edge of edges) stroke(edge, colors.line, [4 * uPlot.pxRatio, 3 * uPlot.pxRatio]);

    ctx.restore();
  };
}

/** カーソル位置の値を表示する。 */
function tooltipHook(element, { label, isRank, group }) {
  const tip = element.querySelector('.chart-tip');
  const timeText = tip.querySelector('.chart-tip-time');
  const valueText = tip.querySelector('.chart-tip-value');
  const diffText = tip.querySelector('.chart-tip-diff');
  let placed = false;

  return (self) => {
    // プロット領域の中に置くと、カーソルの座標をそのまま位置に使える
    if (!placed) {
      self.over.append(tip);
      self.over.addEventListener('pointerenter', () => {
        group.hovered = self;
      });
      placed = true;
    }

    const { idx, left } = self.cursor;
    if (idx === null || idx === undefined || left < 0 || group.hovered !== self) {
      tip.hidden = true;
      return;
    }

    // 順位のグラフは 1 系列、指標のグラフは 1 が毎時の伸びの棒、2 が累計の線
    const value = isRank ? self.data[1][idx] : self.data[2][idx];
    const diff = isRank ? null : self.data[1][idx];
    const { date, time } = jstDateTime(self.data[0][idx]);
    timeText.textContent = `${date} ${time}`;
    valueText.textContent =
      value === null
        ? `${label} 圏外`
        : `${label} ${isRank ? `${value}位` : formatNumber(value)}`;
    diffText.textContent = diff === null ? '' : formatSigned(diff);
    diffText.hidden = diff === null;
    tip.hidden = false;

    // 値が無い時刻は点が無いので、プロット領域の上端に寄せる
    const top = value === null ? 0 : self.valToPos(value, 'y');
    // 上端に近いと吹き出しが見切れるため、その場合だけ点の下に出す
    if (top < tip.offsetHeight + 12) tip.dataset.below = '';
    else delete tip.dataset.below;

    const half = tip.offsetWidth / 2;
    const limit = self.over.clientWidth - half;
    tip.style.left = `${Math.min(Math.max(left, half), Math.max(half, limit))}px`;
    tip.style.top = `${top}px`;
  };
}

function baseOptions(element, options) {
  const { label, values, diffs, isRank, tally, colors, group, index, onZoom } = options;
  const width = element.clientWidth || 320;
  const height = element.classList.contains('chart-small') ? 120 : 200;

  const known = values.filter((value) => value !== null);
  const min = known.length ? Math.min(...known) : 0;
  const max = known.length ? Math.max(...known) : 1;
  const metricTop = niceCeil(max);
  const knownDiffs = (diffs ?? []).filter((value) => value !== null);
  const diffMax = knownDiffs.length ? Math.max(...knownDiffs) : 1;
  const diffMin = knownDiffs.length ? Math.min(...knownDiffs) : 0;

  const line = {
    label,
    stroke: () => colors.accent,
    width: 2,
    points: { show: known.length < 40, size: 4 },
  };
  /* 半透明の塗りに枠線が重なると縁だけ濃くなるので、棒はベタ塗りで枠線を出さない */
  const bars = {
    label: `${label}の伸び`,
    scale: 'd',
    fill: () => colors.bar,
    width: 0,
    paths: uPlot.paths.bars({ size: [0.9, 20], align: 0 }),
    points: { show: false },
  };

  return {
    width,
    height,
    // 100 位圏外の時刻は null。既定で線はつながらない
    series: [{ label: '集計日時' }, ...(isRank ? [line] : [bars, line])],
    scales: {
      y: isRank
        ? // 順位は 1 位を上に表示する
          { dir: -1, range: RANK_RANGE }
        : { range: [Math.min(0, min), metricTop] },
      // 棒は下側だけを使う。拡大しても高さの意味が変わらないよう全期間の値で固定する
      d: { range: [Math.min(0, diffMin), Math.max(1, diffMax) * BAR_HEADROOM] },
    },
    // 1 位と 100 位のラベルが枠に接して欠けないよう、順位のグラフだけ上下に余白を取る
    padding: isRank ? [8, null, 8, null] : [null, null, null, null],
    axes: [
      {
        stroke: () => colors.text,
        grid: { stroke: () => colors.grid },
        ticks: { stroke: () => colors.grid },
        // 既定の英語 12 時間表記ではなく、JST の 24 時間表記で表示する
        values: (self, splits) => axisTimeLabels(splits),
      },
      {
        stroke: () => colors.text,
        grid: { stroke: () => colors.grid },
        ticks: { stroke: () => colors.grid },
        size: 52,
        // 目盛りは自分で決める。ラベルが出ない目盛りを作らない
        splits: isRank ? RANK_SPLITS : [Math.min(0, min), metricTop / 2, metricTop],
        values: (self, ticks) =>
          ticks.map((tick) => (isRank ? `${tick}位` : formatNumber(tick))),
      },
    ],
    legend: { show: false },
    /* 順位が動いた時刻の 4 指標を同じ縦線の位置で読めるよう、カーソル位置を連動させる */
    cursor: { y: false, sync: { key: `trend-${index}`, scales: ['x', null], setSeries: false } },
    hooks: {
      drawClear: [underlayHook(tally, colors)],
      setCursor: [tooltipHook(element, { label, isRank, group })],
      setScale: [(self, key) => key === 'x' && onZoom(self)],
    },
  };
}

/** 表示期間のボタンの押下状態を、実際の横軸の範囲から決める */
function markZoomButtons(group) {
  const [first] = group.charts;
  const { min, max } = first.scales.x;
  const full = first.data[0];
  const last = full[full.length - 1];
  const isFull = min <= full[0] && max >= last;

  for (const button of group.buttons) {
    const hours = Number(button.dataset.zoomHours);
    const pressed = hours
      ? !isFull && max >= last && Math.round((max - min) / HOUR) === hours
      : isFull;
    button.setAttribute('aria-pressed', String(pressed));
    button.classList.toggle('pill-current', pressed);
  }
}

export function setupVideoTrends() {
  const dataElement = document.getElementById('trend-data');
  if (!dataElement) return;

  const { series: seriesList, tally } = JSON.parse(dataElement.textContent);
  const colors = readColors();

  const charts = [];
  /* 同じ部門のグラフは横軸が同じなので、表示期間も連動させる */
  const groups = new Map();
  let syncing = false;

  const onZoom = (index) => (source) => {
    const group = groups.get(index);
    if (!group?.buttons || syncing) return;
    const { min, max } = source.scales.x;
    syncing = true;
    for (const chart of group.charts) {
      if (chart !== source) chart.setScale('x', { min, max });
    }
    syncing = false;
    markZoomButtons(group);
  };

  for (const element of document.querySelectorAll('[data-chart]')) {
    const index = Number(element.dataset.series);
    const series = seriesList[index];
    if (!series) continue;
    const kind = element.dataset.chart;
    const isRank = kind === 'rank';
    const values = isRank ? series.rank : series.metrics[kind];
    const diffs = isRank ? null : series.diffs[kind];
    const label = isRank ? '順位' : METRIC_LABELS[kind];

    if (!groups.has(index)) groups.set(index, { charts: [], hovered: null });
    const group = groups.get(index);

    const chart = new uPlot(
      baseOptions(element, {
        label,
        values,
        diffs,
        isRank,
        tally,
        colors,
        group,
        index,
        onZoom: onZoom(index),
      }),
      isRank ? [series.x, values] : [series.x, diffs, values],
      element
    );
    charts.push({ chart, element });
    group.charts.push(chart);
  }

  for (const [index, group] of groups) {
    const tools = document.querySelector(`[data-chart-tools="${index}"]`);
    const [first] = group.charts;
    const full = first.data[0];
    const span = full[full.length - 1] - full[0];

    group.buttons = [...tools.querySelectorAll('[data-zoom-hours]')].filter((button) => {
      const hours = Number(button.dataset.zoomHours);
      // 全期間より長い窓は選ぶ意味がない
      if (hours && hours * HOUR >= span) {
        button.remove();
        return false;
      }
      button.addEventListener('click', () => {
        const last = full[full.length - 1];
        const min = hours ? Math.max(full[0], last - hours * HOUR) : full[0];
        for (const chart of group.charts) chart.setScale('x', { min, max: last });
      });
      return true;
    });

    markZoomButtons(group);
    // 操作 UI はグラフが描けたときだけ出す
    tools.hidden = false;
  }

  if (charts.length > 0) {
    // キャンバスの色は CSS では変わらないので、テーマが切り替わったら読み直して描き直す
    const applyColors = () => {
      Object.assign(colors, readColors());
      for (const { chart } of charts) chart.redraw(false);
    };
    new MutationObserver(applyColors).observe(document.documentElement, {
      attributeFilter: ['data-color-scheme'],
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyColors);

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        for (const { chart, element } of charts) {
          const width = element.clientWidth;
          if (width > 0 && width !== chart.width) chart.setSize({ width, height: chart.height });
        }
      });
    });
    observer.observe(document.body);
  }
}
