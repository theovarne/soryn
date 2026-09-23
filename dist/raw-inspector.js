const TAB_NAMES = ['raw', 'parsed', 'diff', 'sources'];
const MAX_SEARCH_RESULTS = 80;

const isContainer = value => value !== null && typeof value === 'object';
const childrenOf = value => Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value);
const summaryOf = value => Array.isArray(value) ? '[ ' + value.length + ' items ]' : '{ ' + Object.keys(value).length + ' fields }';
const valueText = value => value === undefined ? 'undefined' : JSON.stringify(value);

function tabData(tab, data, diff) {
  if (tab === 'parsed') return {
    chain: data.chain ?? null,
    wallet: data.wallet ?? null,
    market: data.market ?? null,
    externalSignals: data.externalSignals ?? data.external ?? null,
    lastTransaction: data.lastTransaction ?? null
  };
  if (tab === 'diff') return diff;
  if (tab === 'sources') return {
    sourceStatus: data.sourceStatus ?? {},
    sourceHealth: data.sourceHealth ?? {},
    provenance: data.provenance ?? {},
    observedAt: data.timestamp ?? data.createdAt ?? null
  };
  return data;
}

function provenanceFor(path, data) {
  const root = path.split('.')[1] || '';
  const supplied = data.provenance?.[root];
  if (typeof supplied === 'string') return supplied;
  if (supplied && typeof supplied === 'object') {
    const label = supplied.source || supplied.provider || supplied.endpoint;
    if (label) return String(label);
  }
  if (root === 'chain' || root === 'wallet' || root === 'lastTransaction') return 'Solana RPC observation';
  if (root === 'market') return 'Jupiter market observation';
  if (root === 'externalSignals' || root === 'external') return 'public external reference';
  return '';
}

function typedValue(value) {
  const span = document.createElement('span');
  span.className = value === null ? 'json-null' : typeof value === 'string' ? 'json-string' : typeof value === 'number' ? 'json-number' : typeof value === 'boolean' ? 'json-boolean' : 'c-dim';
  span.textContent = valueText(value);
  return span;
}

function highlightText(node, value, query) {
  const text = String(value);
  const start = text.toLowerCase().indexOf(query.toLowerCase());
  if (start < 0) { node.textContent = text; return; }
  node.append(document.createTextNode(text.slice(0, start)));
  const mark = document.createElement('mark');
  mark.className = 'debug-match';
  mark.textContent = text.slice(start, start + query.length);
  node.append(mark, document.createTextNode(text.slice(start + query.length)));
}

export function mountRawInspector(data, diff, state) {
  state.folds ||= new Map();
  if (!TAB_NAMES.includes(state.tab)) state.tab = 'raw';
  const viewer = document.createElement('div');
  viewer.className = 'code-viewer debug-viewer';
  viewer.innerHTML = '<div class="code-toolbar"><span class="t-meta c-label">raw response <span class="debug-readonly">/ read only</span></span><div class="code-actions"><button class="tiny-control" type="button" data-copy-raw>copy</button><button class="tiny-control" type="button" data-collapse-raw>collapse</button><button class="tiny-control" type="button" data-wrap-raw>nowrap</button><button class="tiny-control" type="button" data-reset-raw>reset view</button></div></div><div class="debug-subbar"><div class="inspection-tabs t-meta"><button class="tiny-control" type="button" data-tab="raw">raw</button><button class="tiny-control" type="button" data-tab="parsed">parsed</button><button class="tiny-control" type="button" data-tab="diff">diff</button><button class="tiny-control" type="button" data-tab="sources">sources</button></div><label class="debug-find t-meta"><span class="c-dim">find</span><input data-raw-search type="search" placeholder="field / value" autocomplete="off" aria-label="Find in current response"></label></div><div class="code-scroll inspection-body t-meta" role="region" aria-label="Read-only response inspector" tabindex="0"></div><div class="inspection-status t-meta" data-raw-status></div>';
  const body = viewer.querySelector('.inspection-body');
  const status = viewer.querySelector('[data-raw-status]');
  const search = viewer.querySelector('[data-raw-search]');
  search.value = state.query || '';
  viewer.classList.toggle('is-collapsed', !!state.collapsed);
  viewer.classList.toggle('is-wrapped', !!state.wrapped);

  function render() {
    const current = tabData(state.tab, data, diff);
    const query = (state.query || '').trim();
    const oldScroll = body.scrollTop;
    const fragment = document.createDocumentFragment();
    let line = 0;
    const makeRow = (depth, path) => {
      const row = document.createElement('div');
      row.className = 'debug-line';
      row.style.setProperty('--debug-depth', String(depth));
      row.title = provenanceFor(path, data);
      const number = document.createElement('span');
      number.className = 'debug-number';
      number.textContent = String(++line).padStart(3, '0');
      row.append(number);
      return row;
    };
    const addNode = (host, key, value, depth, path) => {
      const row = makeRow(depth, path);
      const code = document.createElement('code');
      code.className = 'debug-content';
      if (isContainer(value)) {
        const foldKey = state.tab + ':' + path;
        const defaultOpen = depth < (state.tab === 'sources' ? 2 : 1);
        const open = state.folds.has(foldKey) ? state.folds.get(foldKey) : defaultOpen;
        const button = document.createElement('button');
        button.className = 'debug-fold';
        button.type = 'button';
        button.dataset.foldPath = foldKey;
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-label', (open ? 'Collapse ' : 'Expand ') + key);
        button.textContent = open ? '▾' : '▸';
        row.append(button);
        const name = document.createElement('span');
        name.className = 'json-key';
        name.textContent = JSON.stringify(key);
        const brace = document.createElement('span');
        brace.className = 'c-dim';
        brace.textContent = ': ' + (Array.isArray(value) ? '[' : '{');
        const count = document.createElement('span');
        count.className = 'debug-summary';
        count.textContent = open ? '' : ' ' + summaryOf(value);
        code.append(name, brace, count);
        row.append(code);
        host.append(row);
        if (open) {
          for (const [childKey, childValue] of childrenOf(value)) addNode(host, childKey, childValue, depth + 1, path + '.' + childKey);
          const end = makeRow(depth, path);
          const spacer = document.createElement('span');
          spacer.className = 'debug-fold-spacer';
          const endCode = document.createElement('code');
          endCode.className = 'debug-content c-dim';
          endCode.textContent = Array.isArray(value) ? ']' : '}';
          end.append(spacer, endCode);
          host.append(end);
        }
      } else {
        const spacer = document.createElement('span');
        spacer.className = 'debug-fold-spacer';
        const name = document.createElement('span');
        name.className = 'json-key';
        name.textContent = JSON.stringify(key);
        const colon = document.createElement('span');
        colon.className = 'c-dim';
        colon.textContent = ': ';
        code.append(name, colon, typedValue(value));
        row.append(spacer, code);
        host.append(row);
      }
    };
    if (query) {
      let visited = 0;
      const matches = [];
      const walk = (value, path) => {
        if (++visited > 12000 || matches.length >= MAX_SEARCH_RESULTS) return;
        if (path.toLowerCase().includes(query.toLowerCase()) || (!isContainer(value) && valueText(value).toLowerCase().includes(query.toLowerCase()))) {
          matches.push([path, value]);
        }
        if (isContainer(value)) for (const [key, child] of childrenOf(value)) walk(child, path ? path + '.' + key : key);
      };
      walk(current, '');
      for (const [path, value] of matches) {
        const row = makeRow(0, '$.' + path);
        const spacer = document.createElement('span');
        spacer.className = 'debug-fold-spacer';
        const code = document.createElement('code');
        code.className = 'debug-content debug-result';
        const name = document.createElement('span');
        name.className = 'json-key';
        highlightText(name, path || '$', query);
        const details = document.createElement('span');
        details.className = 'c-dim';
        details.textContent = '  ' + (isContainer(value) ? summaryOf(value) : valueText(value));
        code.append(name, details);
        row.append(spacer, code);
        fragment.append(row);
      }
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'debug-empty c-dim';
        empty.textContent = 'no fields match · ' + query;
        fragment.append(empty);
      }
      status.textContent = state.tab + ' · ' + matches.length + (matches.length === MAX_SEARCH_RESULTS ? '+' : '') + ' matches · current panel only';
    } else {
      for (const [key, value] of childrenOf(current)) addNode(fragment, key, value, 0, '$.' + key);
      status.textContent = state.tab + ' · ' + line + ' visible lines · ' + (data.timestamp || data.createdAt || 'observation time unavailable') + ' · read only';
    }
    body.replaceChildren(fragment);
    body.scrollTop = query ? 0 : oldScroll;
    viewer.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.tab === state.tab));
    viewer.querySelector('[data-collapse-raw]').textContent = state.collapsed ? 'expand' : 'collapse';
    viewer.querySelector('[data-wrap-raw]').textContent = state.wrapped ? 'wrap' : 'nowrap';
    viewer.classList.toggle('is-collapsed', !!state.collapsed);
    viewer.classList.toggle('is-wrapped', !!state.wrapped);
    body.classList.remove('debug-enter');
    requestAnimationFrame(() => body.classList.add('debug-enter'));
  }

  viewer.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    state.tab = button.dataset.tab;
    render();
  }));
  body.addEventListener('click', event => {
    const button = event.target.closest('[data-fold-path]');
    if (!button) return;
    const key = button.dataset.foldPath;
    state.folds.set(key, button.getAttribute('aria-expanded') !== 'true');
    render();
  });
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    state.query = search.value;
    searchTimer = setTimeout(render, 110);
  });
  viewer.querySelector('[data-copy-raw]').addEventListener('click', async event => {
    const button = event.currentTarget;
    try { await navigator.clipboard.writeText(JSON.stringify(tabData(state.tab, data, diff), null, 2)); button.textContent = 'copied'; }
    catch { button.textContent = 'unavailable'; }
    setTimeout(() => { button.textContent = 'copy'; }, 1100);
  });
  viewer.querySelector('[data-collapse-raw]').addEventListener('click', () => { state.collapsed = !state.collapsed; render(); });
  viewer.querySelector('[data-wrap-raw]').addEventListener('click', () => { state.wrapped = !state.wrapped; render(); });
  viewer.querySelector('[data-reset-raw]').addEventListener('click', () => {
    state.tab = 'raw'; state.collapsed = false; state.wrapped = false; state.query = ''; state.folds.clear();
    search.value = '';
    body.scrollTop = 0;
    render();
  });
  render();
  return viewer;
}
