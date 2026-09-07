import { MAX_SUGGESTIONS, prepareRows, searchVideos } from '@/lib/search-match.js';

/** ヘッダーの動画検索。候補リストは combobox として組み立てる。 */
export function setupSiteSearch() {
  const root = document.querySelector('[data-site-search]');
  const configElement = document.getElementById('search-config');
  if (!root || !configElement) return;

  const { indexUrl, videoUrlTemplate } = JSON.parse(configElement.textContent);

  const input = root.querySelector('.search-input');
  const panel = root.querySelector('.search-panel');
  const listbox = root.querySelector('.search-listbox');
  const note = root.querySelector('.search-note');
  const status = root.querySelector('[data-search-status]');

  let events = {};
  let rows = null;
  let loading = null;
  let options = [];
  let activeIndex = -1;

  const eventLabel = (eventId) => events[eventId]?.label ?? eventId;
  const eventAccent = (eventId) => events[eventId]?.accent ?? 'transparent';

  function videoUrl(row) {
    return videoUrlTemplate.replace('{eventId}', row.eventId).replace('{watchId}', row.watchId);
  }

  function setNote(text) {
    note.textContent = text;
    note.hidden = text === '';
    status.textContent = text;
  }

  function openPanel() {
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closePanel() {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  }

  function setActive(index, { scroll = false } = {}) {
    activeIndex = index;
    options.forEach((option, i) => {
      option.setAttribute('aria-selected', String(i === index));
    });
    const active = options[index];
    if (active) {
      input.setAttribute('aria-activedescendant', active.id);
      if (scroll) active.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function renderOptions(hits) {
    listbox.replaceChildren(
      ...hits.map((row, i) => {
        const option = document.createElement('a');
        option.className = 'search-option';
        option.id = `search-option-${i}`;
        option.setAttribute('role', 'option');
        option.href = videoUrl(row);
        option.style.setProperty('--event-accent', eventAccent(row.eventId));

        const title = document.createElement('span');
        title.className = 'search-option-title';
        title.textContent = row.title;

        const meta = document.createElement('span');
        meta.className = 'search-option-meta';
        meta.textContent = `${row.owner} · ${eventLabel(row.eventId)}`;

        option.addEventListener('mousemove', () => {
          if (activeIndex !== i) setActive(i);
        });

        option.append(title, meta);
        return option;
      })
    );
    options = [...listbox.children];
    // 候補が1件のときも、常に先頭を選択済みにして Enter の挙動を揃える
    setActive(options.length > 0 ? 0 : -1);
  }

  function loadIndex() {
    if (loading) return loading;
    loading = fetch(indexUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`検索索引の取得に失敗しました: ${response.status}`);
        return response.json();
      })
      .then((index) => {
        events = index.events;
        rows = prepareRows(index);
      })
      .catch((error) => {
        rows = [];
        console.error(error);
      });
    return loading;
  }

  function render() {
    const query = input.value.trim();
    if (query === '') {
      listbox.replaceChildren();
      options = [];
      setNote('');
      closePanel();
      return;
    }

    openPanel();

    if (rows === null) {
      listbox.replaceChildren();
      options = [];
      setActive(-1);
      setNote('読み込み中…');
      loadIndex().then(render);
      return;
    }

    const { hits, total } = searchVideos(rows, query, MAX_SUGGESTIONS);
    renderOptions(hits);
    if (total === 0) setNote(`「${query}」に一致する動画はありません`);
    else if (total > hits.length) setNote(`他 ${total - hits.length} 件（語を足すと絞り込めます）`);
    else setNote('');
  }

  input.addEventListener('focus', () => {
    loadIndex();
    if (input.value.trim() !== '') render();
  });
  input.addEventListener('input', render);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePanel();
      return;
    }
    if (event.key === 'Enter') {
      const active = options[activeIndex];
      if (!active) return;
      event.preventDefault();
      active.click();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (options.length === 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    setActive((activeIndex + step + options.length) % options.length, { scroll: true });
  });

  document.addEventListener('click', (event) => {
    if (!root.contains(event.target)) closePanel();
  });
}
