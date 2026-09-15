const MAX_CONCURRENT_LOADS = 3;
const MAX_LOADED_COLUMNS = 40;

interface StripConfig {
  hourKeys: string[];
  fragmentUrlTemplate: string;
}

/** data-hour が付いた要素からしか呼ばないので、値は必ずある。 */
const hourOf = (element: HTMLElement): string => element.dataset.hour as string;

function whenIdle(callback: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(callback, { timeout: 300 });
  else setTimeout(callback, 0);
}

export function setupHourNavigation(): void {
  const configElement = document.getElementById('strip-config');
  const strip = document.getElementById('rank-strip');
  if (!configElement || !strip) return;

  const stripElement = strip;

  const { hourKeys, fragmentUrlTemplate } = JSON.parse(
    configElement.textContent ?? ''
  ) as StripConfig;

  const previousLink = document.querySelector<HTMLElement>('[data-hour-nav="prev"]');
  const nextLink = document.querySelector<HTMLElement>('[data-hour-nav="next"]');
  const select = document.querySelector<HTMLSelectElement>('[data-hour-nav="select"]');

  // 端に来たボタンは消さずに無効表示にする。消すと行の幅が変わってしまう
  function setDisabled(link: HTMLElement | null, disabled: boolean): void {
    if (!link) return;
    link.hidden = false;
    link.classList.toggle('is-disabled', disabled);
    if (disabled) link.setAttribute('aria-disabled', 'true');
    else link.removeAttribute('aria-disabled');
  }

  const columnOf = (hourKey: string): HTMLElement | null =>
    strip.querySelector<HTMLElement>(`[data-column="${hourKey}"]`);
  const bodyOf = (hourKey: string): HTMLElement | null | undefined =>
    columnOf(hourKey)?.querySelector<HTMLElement>('.col-body');

  const htmlCache = new Map<string, string>();
  const visibleHours = new Set<string>();
  const pendingQueue: string[] = [];
  let activeLoads = 0;

  for (const body of strip.querySelectorAll<HTMLElement>(
    '.col-body[data-hour][data-state="loaded"]'
  )) {
    htmlCache.set(hourOf(body), body.innerHTML);
  }

  function setPlaceholder(body: HTMLElement): void {
    body.dataset.state = 'placeholder';
    body.setAttribute('aria-busy', 'true');
    body.replaceChildren();
    const skeleton = document.createElement('div');
    skeleton.className = 'col-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    body.append(skeleton);
  }

  function setLoaded(body: HTMLElement, html: string): void {
    const template = document.createElement('template');
    template.innerHTML = html;
    body.replaceChildren(template.content);
    body.dataset.state = 'loaded';
    body.removeAttribute('aria-busy');
  }

  function setError(body: HTMLElement, hourKey: string): void {
    body.dataset.state = 'error';
    body.removeAttribute('aria-busy');
    body.replaceChildren();
    const message = document.createElement('p');
    message.className = 'col-error';
    message.setAttribute('role', 'alert');
    message.textContent = 'この時刻のランキングを読み込めませんでした。';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'col-retry';
    retry.dataset.retry = hourKey;
    retry.textContent = '再読み込み';
    message.append(retry);
    body.append(message);
  }

  function trimLoadedColumns(): void {
    const loaded = [
      ...stripElement.querySelectorAll<HTMLElement>('.col-body[data-hour][data-state="loaded"]'),
    ];
    if (loaded.length <= MAX_LOADED_COLUMNS) return;

    const visibleIndexes = [...visibleHours].map((hourKey) => hourKeys.indexOf(hourKey));
    if (visibleIndexes.length === 0) return;
    const center = (Math.min(...visibleIndexes) + Math.max(...visibleIndexes)) / 2;

    loaded
      .map((body) => ({ body, distance: Math.abs(hourKeys.indexOf(hourOf(body)) - center) }))
      .sort((a, b) => b.distance - a.distance)
      .slice(0, loaded.length - MAX_LOADED_COLUMNS)
      .forEach(({ body }) => setPlaceholder(body));
  }

  function runQueue(): void {
    while (activeLoads < MAX_CONCURRENT_LOADS && pendingQueue.length > 0) {
      const hourKey = pendingQueue.shift() as string;
      activeLoads += 1;
      fetchColumn(hourKey).finally(() => {
        activeLoads -= 1;
        runQueue();
      });
    }
  }

  async function fetchColumn(hourKey: string): Promise<void> {
    const body = bodyOf(hourKey);
    if (!body) return;
    try {
      const response = await fetch(fragmentUrlTemplate.replace('__HOUR__', encodeURIComponent(hourKey)));
      if (!response.ok) throw new Error(`${response.status}`);
      const html = await response.text();
      htmlCache.set(hourKey, html);
      whenIdle(() => {
        const current = bodyOf(hourKey);
        if (current?.dataset.state === 'loading') setLoaded(current, html);
      });
    } catch (error) {
      console.error(`時刻列の取得に失敗しました: ${hourKey}`, error);
      const current = bodyOf(hourKey);
      if (current?.dataset.state === 'loading') setError(current, hourKey);
    }
  }

  function load(hourKey: string): void {
    const body = bodyOf(hourKey);
    if (!body || body.dataset.state === 'loading' || body.dataset.state === 'loaded') return;

    const cachedHtml = htmlCache.get(hourKey);
    if (cachedHtml) {
      body.dataset.state = 'loading';
      whenIdle(() => {
        const current = bodyOf(hourKey);
        if (current?.dataset.state === 'loading') setLoaded(current, cachedHtml);
      });
      return;
    }

    body.dataset.state = 'loading';
    body.setAttribute('aria-busy', 'true');
    pendingQueue.push(hourKey);
    runQueue();
  }

  function reflectVisibleRange(): void {
    if (visibleHours.size === 0) return;
    const sorted = [...visibleHours].sort();
    const rightEdge = sorted.at(-1);
    if (rightEdge === undefined) return;

    if (select && select.value !== rightEdge) select.value = rightEdge;

    const position = hourKeys.indexOf(rightEdge);
    setDisabled(previousLink, position <= 0);
    setDisabled(nextLink, position >= hourKeys.length - 1);

    const url = new URL(window.location.href);
    if (url.searchParams.get('hour') !== rightEdge) {
      url.searchParams.set('hour', rightEdge);
      history.replaceState({ hour: rightEdge }, '', url);
    }
  }

  const loader = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) load(hourOf(entry.target as HTMLElement));
      }
    },
    { root: strip, rootMargin: '0px 60%' }
  );

  const tracker = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visibleHours.add(hourOf(entry.target as HTMLElement));
        else visibleHours.delete(hourOf(entry.target as HTMLElement));
      }
      onScrollSettled();
    },
    { root: strip, threshold: 0 }
  );

  for (const body of strip.querySelectorAll<HTMLElement>('.col-body[data-hour]')) {
    loader.observe(body);
    tracker.observe(body);
  }

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  function onScrollSettled(): void {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      reflectVisibleRange();
      whenIdle(trimLoadedColumns);
    }, 120);
  }
  strip.addEventListener('scrollend', onScrollSettled);
  strip.addEventListener('scroll', onScrollSettled, { passive: true });

  strip.addEventListener('click', (event) => {
    const retry = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-retry]');
    if (!retry) return;
    const hourKey = retry.dataset.retry as string;
    const body = bodyOf(hourKey);
    if (body) setPlaceholder(body);
    load(hourKey);
  });

  function scrollToHour(hourKey: string, { focus = false }: { focus?: boolean } = {}): void {
    const column = columnOf(hourKey);
    if (!column) return;
    load(hourKey);
    column.scrollIntoView({ inline: 'end', block: 'nearest' });
    if (focus) column.querySelector<HTMLElement>('.col-head')?.focus();
  }

  function step(offset: number): void {
    const sorted = [...visibleHours].sort();
    const base = sorted.length ? hourKeys.indexOf(sorted.at(-1) as string) : hourKeys.length - 1;
    const target = hourKeys[base + offset];
    if (target) scrollToHour(target);
  }

  previousLink?.addEventListener('click', (event) => {
    event.preventDefault();
    step(-1);
  });

  nextLink?.addEventListener('click', (event) => {
    event.preventDefault();
    step(1);
  });

  select?.addEventListener('change', (event) => {
    scrollToHour((event.target as HTMLSelectElement).value, { focus: true });
  });

  const requested = new URL(window.location.href).searchParams.get('hour');
  if (requested && hourKeys.includes(requested)) scrollToHour(requested);
}
