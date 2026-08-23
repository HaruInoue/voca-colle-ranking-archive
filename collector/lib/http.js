// HTTP 取得。直列・1 リクエストごとに間隔を空ける・連絡先付きの User-Agent。
// 5xx とタイムアウトだけ指数バックオフでリトライし、それ以外は呼び出し側に判定を任せる。

const USER_AGENT =
  'voca-colle-ranking-archive/1.0 (+https://github.com/HaruInoue/voca-colle-ranking-archive)';

const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 4; // 初回 + リトライ 3 回
const BACKOFF_BASE_MS = 2000;

/** 取得できなかった（= 次回の実行で再試行すべき）ことを表す。 */
export class FetchError extends Error {
  constructor(message, status = null) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// モジュール全体で 1 つ。直列前提なので、これだけで間隔が保たれる。
let lastRequestAt = 0;

async function waitForSlot() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/**
 * 本文をテキストとして取得する。毎時履歴（JSON）と最終ランキング（HTML）で共通に使う。
 * @returns {Promise<{ status: number, text: string }>}
 * @throws {FetchError} 5xx / タイムアウト / ネットワークエラーがリトライしても解消しない場合
 */
export async function fetchText(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 2));
    await waitForSlot();

    let response;
    let text;
    try {
      response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // 本文の読み出しも中断・切断で失敗する。ここを try の外に出すと
      // FetchError ではない例外が漏れ、呼び出し側の再試行に乗らない。
      text = await response.text();
    } catch (cause) {
      // タイムアウトとネットワークエラーはリトライ対象。
      lastError = new FetchError(`取得に失敗: ${cause.message ?? cause}`);
      continue;
    }

    if (response.status >= 500) {
      lastError = new FetchError(`upstream ${response.status}`, response.status);
      continue;
    }

    return { status: response.status, text };
  }

  throw lastError ?? new FetchError('取得に失敗');
}

