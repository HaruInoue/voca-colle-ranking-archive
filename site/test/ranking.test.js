import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toEntries,
  rankDelta,
  rankMapOf,
  resolveHourWindow,
  buildVideoSeries,
  metricDiffs,
  divisionLabel,
  canonicalDivision,
} from '../src/lib/ranking.js';
import { noticesForEventPage, noticesForDivisionPage } from '../src/lib/notices.js';
import {
  parseHourKey,
  formatIsoDateTime,
  hourKeyToPlotSeconds,
  isoToPlotSeconds,
  niceCeil,
} from '../src/lib/format.js';
import { escapeHtml } from '../src/lib/render-column.js';

const snapshot = {
  columns: ['rank', 'watchId', 'view', 'comment', 'mylist', 'like'],
  entries: [
    [1, 'sm1', 100, 10, 5, 20],
    [2, 'sm2', 90, 9, 4, 18],
  ],
};

test('列指向の entries を列名で引ける形に変換する', () => {
  assert.deepEqual(toEntries(snapshot), [
    { rank: 1, watchId: 'sm1', view: 100, comment: 10, mylist: 5, like: 20 },
    { rank: 2, watchId: 'sm2', view: 90, comment: 9, mylist: 4, like: 18 },
  ]);
});

test('比較できる前の時刻が無い場合の順位変動は none', () => {
  assert.deepEqual(rankDelta(1, 'sm1', null), { kind: 'none' });
});

test('前の時刻に 100 位圏内にいなかった曲は rankin（101 位として扱わない）', () => {
  const previous = rankMapOf(toEntries(snapshot));
  assert.deepEqual(rankDelta(5, 'sm-new', previous), { kind: 'rankin' });
});

test('順位の上昇・下降・変わらずを判定する', () => {
  const previous = new Map([
    ['sm1', 5],
    ['sm2', 2],
    ['sm3', 10],
  ]);
  assert.deepEqual(rankDelta(1, 'sm1', previous), { kind: 'up', value: 4 });
  assert.deepEqual(rankDelta(2, 'sm2', previous), { kind: 'same', value: 0 });
  assert.deepEqual(rankDelta(30, 'sm3', previous), { kind: 'down', value: 20 });
});

const hours = ['2026-08-22-0100', '2026-08-22-0200', '2026-08-22-0300', '2026-08-22-0400'];

test('hour 未指定なら最新の利用可能な時刻を範囲の右端にする', () => {
  const resolved = resolveHourWindow(hours, null, 2);
  assert.deepEqual(resolved.hourKeys, ['2026-08-22-0300', '2026-08-22-0400']);
  assert.equal(resolved.rightEdge, '2026-08-22-0400');
});

test('利用できない時刻や解釈できない値が指定された場合も最新の時刻を右端にする', () => {
  for (const requested of ['2026-08-22-0500', 'not-an-hour', '']) {
    const resolved = resolveHourWindow(hours, requested, 2);
    assert.equal(resolved.rightEdge, '2026-08-22-0400', `${requested} は最新時刻に解決される`);
  }
});

test('利用できる時刻が指定された場合はその時刻を範囲の右端にする', () => {
  const resolved = resolveHourWindow(hours, '2026-08-22-0200', 3);
  assert.deepEqual(resolved.hourKeys, ['2026-08-22-0100', '2026-08-22-0200']);
  assert.equal(resolved.rightEdge, '2026-08-22-0200');
});

test('利用できる時刻が無い場合は空の範囲を返す', () => {
  assert.deepEqual(resolveHourWindow([], null, 6), { hourKeys: [], rightEdge: null });
});

test('100 位圏外の時刻は順位を作らず null にする', () => {
  const entriesByHour = new Map([
    ['h1', new Map([['sm1', { rank: 3, view: 10, comment: 1, mylist: 1, like: 2 }]])],
    ['h2', new Map()],
    ['h3', new Map([['sm1', { rank: 1, view: 30, comment: 3, mylist: 2, like: 5 }]])],
  ]);
  const series = buildVideoSeries(['h1', 'h2', 'h3'], entriesByHour, 'sm1');
  assert.deepEqual(
    series.points.map((point) => point.rank),
    [3, null, 1]
  );
  assert.equal(series.bestRank, 1);
  assert.equal(series.rankedHourCount, 2);
  assert.equal(series.bestRankHourKey, 'h3');
  assert.equal(series.lastRankedHourKey, 'h3');
});

test('同率の最高順位が複数あるときは最も新しい時刻を採る', () => {
  const entriesByHour = new Map([
    ['h1', new Map([['sm1', { rank: 1 }]])],
    ['h2', new Map([['sm1', { rank: 4 }]])],
    ['h3', new Map([['sm1', { rank: 1 }]])],
    ['h4', new Map([['sm1', { rank: 9 }]])],
  ]);
  const series = buildVideoSeries(['h1', 'h2', 'h3', 'h4'], entriesByHour, 'sm1');
  assert.equal(series.bestRankHourKey, 'h3');
  assert.equal(series.lastRankedHourKey, 'h4');
});

test('一度もランクインしていない部門では最高順位の時刻が null になる', () => {
  const series = buildVideoSeries(['h1'], new Map([['h1', new Map()]]), 'sm1');
  assert.equal(series.bestRank, null);
  assert.equal(series.bestRankHourKey, null);
  assert.equal(series.lastRankedHourKey, null);
});

test('代表部門は最終ランキングに載っている部門を優先する', () => {
  const seriesList = [
    { division: 'top100', finalEntry: null, lastRankedHourKey: '2026-08-24-2300' },
    { division: 'rookie', finalEntry: { rank: 5 }, lastRankedHourKey: '2026-08-24-1000' },
  ];
  assert.equal(canonicalDivision(seriesList), 'rookie');
});

test('最終ランキングがどこにも無い場合は最後にランクインした時刻が新しい部門を採る', () => {
  const seriesList = [
    { division: 'top100', finalEntry: null, lastRankedHourKey: '2026-08-24-1000' },
    { division: 'remix', finalEntry: null, lastRankedHourKey: '2026-08-24-2300' },
  ];
  assert.equal(canonicalDivision(seriesList), 'remix');
});

test('最終ランキングと最終時刻が並ぶ場合は seriesList の順で先頭を採る', () => {
  const seriesList = [
    { division: 'top100', finalEntry: { rank: 40 }, lastRankedHourKey: '2026-08-24-2300' },
    { division: 'rookie', finalEntry: { rank: 3 }, lastRankedHourKey: '2026-08-24-2300' },
  ];
  assert.equal(canonicalDivision(seriesList), 'top100');
});

test('どの部門にも登場しない場合の代表部門は null', () => {
  assert.equal(canonicalDivision([]), null);
});

test('指標の差分は比較できる点がある場合だけ計算し、値を補わない', () => {
  const points = [
    { rank: 3, view: 10, comment: 1, mylist: 1, like: 2 },
    { rank: null, view: null, comment: null, mylist: null, like: null },
    { rank: 1, view: 30, comment: 3, mylist: 2, like: 5 },
  ];
  const diffs = metricDiffs(points);
  assert.equal(diffs[0].view, null, '最初の点には差分が無い');
  assert.equal(diffs[1].view, null, 'データのない時刻には差分を作らない');
  assert.equal(diffs[2].view, 20, '直前に比較できる点との差を計算する');
});

test('部門の表示名は未知の部門でも識別子をそのまま返す', () => {
  assert.equal(divisionLabel('top100'), 'TOP100');
  assert.equal(divisionLabel('newcomer2027'), 'newcomer2027');
});

const eventWithNotices = {
  website: {
    notices: [
      { title: '全体の注記', body: '<p>全体</p>' },
      { title: '部門の注記', body: '<p>部門</p>', division: 'top100' },
    ],
  },
};

test('開催回ページには全ての注記を表示する', () => {
  assert.equal(noticesForEventPage(eventWithNotices).length, 2);
});

test('部門ページには全体の注記とその部門の注記を表示する', () => {
  assert.deepEqual(
    noticesForDivisionPage(eventWithNotices, 'top100').map((notice) => notice.title),
    ['全体の注記', '部門の注記']
  );
  assert.deepEqual(
    noticesForDivisionPage(eventWithNotices, 'rookie').map((notice) => notice.title),
    ['全体の注記']
  );
});

test('注記が無い開催回では空を返す', () => {
  assert.deepEqual(noticesForEventPage({}), []);
  assert.deepEqual(noticesForDivisionPage({}, 'top100'), []);
});

test('時刻キーはローカル時刻へ変換せず文字列として整形する', () => {
  assert.deepEqual(parseHourKey('2026-08-23-0300'), {
    date: '2026/08/23',
    time: '03:00',
    full: '2026/08/23 03:00',
  });
  assert.equal(formatIsoDateTime('2026-08-24T17:00:00+09:00'), '2026/08/24 17:00');
});

test('不正な時刻キーはエラーにする', () => {
  assert.throws(() => parseHourKey('2026-08-23T03:00'), /時刻キーの形式が不正/);
});

test('グラフの x 値は JST の壁時計をそのまま表す', () => {
  assert.equal(hourKeyToPlotSeconds('2026-08-23-0300'), Date.UTC(2026, 7, 23, 3, 0) / 1000);
});

test('集計期間の境界も時刻キーと同じ x 値になる', () => {
  // 集計終了 17:00 の縦線が、17 時の時刻キーの点と同じ位置に来る必要がある
  assert.equal(
    isoToPlotSeconds('2026-08-24T17:00:00+09:00'),
    hourKeyToPlotSeconds('2026-08-24-1700')
  );
});

test('集計期間が無い開催回では境界を持たない', () => {
  assert.equal(isoToPlotSeconds(undefined), null);
});

test('縦軸の上限は実測値以上の切りの良い値になり、半分も切りの良い数になる', () => {
  for (const [max, expected] of [
    [1686, 2000],
    [18855, 20000],
    [1039, 1500],
    [2218, 3000],
    [9, 10],
    [1000, 1000],
  ]) {
    const top = niceCeil(max);
    assert.equal(top, expected, `${max} の上限`);
    assert.ok(top >= max, `${max} を下回らない`);
    assert.equal((top / 2) % 1, 0, `${max} の半分が整数`);
  }
});

test('値がすべて 0 の指標でも縦軸の上限を作れる', () => {
  assert.equal(niceCeil(0), 1);
});

test('曲名の HTML は必ずエスケープする', () => {
  assert.equal(
    escapeHtml('<script>alert("x")</script>&\'"'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;&quot;'
  );
});
