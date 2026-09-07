import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_SUGGESTIONS, normalize, parseQuery, prepareRows, searchVideos } from '../src/lib/search-match.js';

const index = {
  events: {},
  videos: [
    ['sm1001', 'メルト', 'ryo', '2025-summer'],
    ['sm1002', '初音ミクの消失', 'cosMo', '2025-summer'],
    ['sm1003', 'ミクの恋', 'ryo', '2026-winter'],
    ['sm1004', 'ODDS&ENDS', 'ryo', '2026-summer'],
    ['sm1005', '恋は戦争', 'ryo', '2026-summer'],
    ['sm1006', 'ワールドイズマイン', 'ryo', '2026-summer'],
    ['sm1007', 'ブラック★ロックシューター', 'ryo', '2026-winter'],
  ],
};
const rows = prepareRows(index);
const titlesOf = (result) => result.hits.map((hit) => hit.title);

test('normalize は全角英数と大文字小文字の差を吸収する', () => {
  assert.equal(normalize('ＯＤＤＳ'), 'odds');
  assert.equal(normalize('CosMo'), 'cosmo');
});

test('normalize はひらがなとカタカナを相互変換しない', () => {
  assert.notEqual(normalize('みく'), normalize('ミク'));
});

test('parseQuery は入力から動画IDを取り出す', () => {
  assert.deepEqual(parseQuery('https://www.nicovideo.jp/watch/sm1002'), {
    watchId: 'sm1002',
    terms: [],
  });
  assert.deepEqual(parseQuery('sm100'), { watchId: 'sm100', terms: [] });
});

test('parseQuery は動画IDを含まない入力を空白区切りの語にする', () => {
  assert.deepEqual(parseQuery('  ミク　恋  '), { watchId: null, terms: ['ミク', '恋'] });
  assert.deepEqual(parseQuery('sm'), { watchId: null, terms: ['sm'] });
});

test('動画IDでの検索は外部サイトのURLからでも1件に絞れる', () => {
  const result = searchVideos(rows, 'https://www.nicolog.jp/watch/sm1002');
  assert.deepEqual(titlesOf(result), ['初音ミクの消失']);
  assert.equal(result.total, 1);
});

test('索引にない動画IDは0件になる', () => {
  assert.deepEqual(searchVideos(rows, 'sm9999'), { hits: [], total: 0 });
});

test('空白区切りの語はAND扱いになる', () => {
  assert.deepEqual(titlesOf(searchVideos(rows, 'ミク 恋')), ['ミクの恋']);
  assert.equal(searchVideos(rows, 'ミク').total, 2);
});

test('タイトルと投稿者名の両方を部分一致で探す', () => {
  assert.deepEqual(titlesOf(searchVideos(rows, 'cosmo')), ['初音ミクの消失']);
  assert.equal(searchVideos(rows, 'ryo').total, 6);
});

test('全角入力でも半角のタイトルに一致する', () => {
  assert.deepEqual(titlesOf(searchVideos(rows, 'ｏｄｄｓ')), ['ODDS&ENDS']);
});

test('候補は上限件数までで、total にはあふれた分も数える', () => {
  const result = searchVideos(rows, 'ryo');
  assert.equal(result.hits.length, MAX_SUGGESTIONS);
  assert.equal(result.total, 6);
  // 索引の並び順（最高順位の良い順）のまま先頭から採る
  assert.deepEqual(titlesOf(result), ['メルト', 'ミクの恋', 'ODDS&ENDS', '恋は戦争', 'ワールドイズマイン']);
});

test('空の入力では検索しない', () => {
  assert.deepEqual(searchVideos(rows, '   '), { hits: [], total: 0 });
});
