// HTTPテキストを取得する。

const USER_AGENT =
  'voca-colle-ranking-archive/1.0 (+https://github.com/HaruInoue/voca-colle-ranking-archive)';

const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 2000;

/** 再試行可能な取得失敗。 */
export class FetchError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

let lastRequestAt = 0;

async function waitForSlot() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/** 本文をテキストとして取得する。 */
export async function fetchText(url: string): Promise<{ status: number; text: string }> {
  let lastError: FetchError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 2));
    await waitForSlot();

    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await response.text();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      lastError = new FetchError(`取得に失敗: ${detail}`);
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

/** ステータスコードだけをHEADで調べる。取得できなければ null を返す。 */
export async function fetchStatus(url: string): Promise<number | null> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 2));

    let status: number;
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
    } catch {
      continue;
    }

    if (status < 500) return status;
  }
  return null;
}
