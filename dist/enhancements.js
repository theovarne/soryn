import { EXECUTION_MODE, GENESIS_CONFIG, NETWORK_CONFIG } from '/config.js';
import { getObservation } from '/services.js';
import { getRecord, getRuntime, getSnapshots, getCycles, getPaper, getMemory, getCounterfactuals } from '/agent.js';
import { formatEasternDateTime, formatEasternRelativeTime } from '/time.js';
import { mountRawInspector } from '/raw-inspector.js';

const route = location.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).pop() || 'home';
const state = { raw: { tab: 'raw', collapsed: false, wrapped: false, query: '', folds: new Map() }, asset: null, health: false, source: null };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const num = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const usd = value => num(value) == null ? 'unavailable' : '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const priceUsd = value => {
  const parsed = num(value);
  if (parsed == null) return 'unavailable';
  const digits = Math.abs(parsed) >= 1 ? 2 : Math.abs(parsed) >= 0.01 ? 4 : 8;
  return '$' + parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits });
};
const fixed = (value, digits = 2) => num(value) == null ? 'unavailable' : Number(value).toFixed(digits);
const observation = () => getObservation() || {};
const section = label => [...document.querySelectorAll('section')].find(item => item.querySelector('.sec .t-strong span')?.textContent.trim() === label);
const field = (label, value, wide = false) => '<div class="record-detail-field' + (wide ? ' is-wide' : '') + '"><span class="c-dim">' + esc(label) + '</span><span class="c-text2">' + value + '</span></div>';
const title = label => '<div class="sec"><div class="sec-rule"></div><div class="t-strong c-label"><span>' + esc(label) + '</span></div><div class="sec-rule"></div></div>';
const snapshots = () => getSnapshots().slice().sort((a, b) => new Date(b.createdAt || b.timestamp || 0) - new Date(a.createdAt || a.timestamp || 0));
const latestDecision = () => getRuntime().latestDecision || getRecord().find(item => item.type === 'decision')?.metadata || null;

function diffData() {
  const [current, previous] = snapshots();
  if (!current || !previous) return { available: false, reason: 'not enough observations', current: current || null, previous: previous || null, assets: [], tokenPositions: [] };
  const currentAssets = current.market?.assets || [];
  const previousAssets = previous.market?.assets || [];
  const oldMap = new Map(previousAssets.map(asset => [asset.mint || asset.symbol, asset]));
  const newMap = new Map(currentAssets.map(asset => [asset.mint || asset.symbol, asset]));
  const changes = [];
  for (const asset of currentAssets) {
    const key = asset.mint || asset.symbol;
    const old = oldMap.get(key);
    if (!old) changes.push({ symbol: asset.symbol, mint: asset.mint, status: (asset.feeds || []).includes('trending') ? 'entered trending' : 'entered universe', changePct: null, liquidityChangeUsd: null, activityChangeUsd: null });
    else {
      const price = num(asset.price), oldPrice = num(old.price);
      const liquidity = num(asset.liquidityUsd), oldLiquidity = num(old.liquidityUsd);
      const buy = num(asset.buyVolume), sell = num(asset.sellVolume), oldBuy = num(old.buyVolume), oldSell = num(old.sellVolume);
      const changePct = price != null && oldPrice != null && oldPrice !== 0 ? (price - oldPrice) / oldPrice * 100 : null;
      const liquidityChangeUsd = liquidity != null && oldLiquidity != null ? liquidity - oldLiquidity : null;
      const activityChangeUsd = buy != null && sell != null && oldBuy != null && oldSell != null ? (buy + sell) - (oldBuy + oldSell) : null;
      const enteredTrending = !(old.feeds || []).includes('trending') && (asset.feeds || []).includes('trending');
      const leftTrending = (old.feeds || []).includes('trending') && !(asset.feeds || []).includes('trending');
      changes.push({ symbol: asset.symbol, mint: asset.mint, status: enteredTrending ? 'entered trending' : leftTrending ? 'left trending' : 'observed', changePct, liquidityChangeUsd, activityChangeUsd });
    }
  }
  for (const asset of previousAssets) {
    const key = asset.mint || asset.symbol;
    if (!newMap.has(key)) changes.push({ symbol: asset.symbol, mint: asset.mint, status: (asset.feeds || []).includes('trending') ? 'left trending' : 'left universe', changePct: null, liquidityChangeUsd: null, activityChangeUsd: null });
  }
  const currentPositions = current.wallet?.positions || [];
  const previousPositions = previous.wallet?.positions || [];
  const currentPositionMap = new Map(currentPositions.map(position => [position.mint || position.symbol, position]));
  const previousPositionMap = new Map(previousPositions.map(position => [position.mint || position.symbol, position]));
  const positionKeys = new Set([...currentPositionMap.keys(), ...previousPositionMap.keys()]);
  const tokenPositions = [...positionKeys].map(key => {
    const next = currentPositionMap.get(key), before = previousPositionMap.get(key);
    const nextBalance = num(next?.balance), previousBalance = num(before?.balance);
    const nextValue = num(next?.valueUsd), previousValue = num(before?.valueUsd);
    return {
      symbol: next?.symbol || before?.symbol || key,
      mint: next?.mint || before?.mint || null,
      status: !before ? 'entered wallet' : !next ? 'left wallet' : 'observed',
      balanceChange: nextBalance != null && previousBalance != null ? nextBalance - previousBalance : null,
      valueChangeUsd: nextValue != null && previousValue != null ? nextValue - previousValue : null
    };
  });
  return {
    available: true,
    current: { id: current.id, timestamp: current.createdAt || current.timestamp, slot: current.chain?.slot ?? null, solBalance: current.wallet?.solBalance ?? current.wallet?.nativeBalance ?? null, positions:current.wallet?.positions?.length ?? null, universe: currentAssets.length, counts:current.market?.counts || {} },
    previous: { id: previous.id, timestamp: previous.createdAt || previous.timestamp, slot: previous.chain?.slot ?? null, solBalance: previous.wallet?.solBalance ?? previous.wallet?.nativeBalance ?? null, positions:previous.wallet?.positions?.length ?? null, universe: previousAssets.length, counts:previous.market?.counts || {} },
    assets: changes.sort((a, b) => {
      const eventA = a.status === 'observed' ? 0 : 1, eventB = b.status === 'observed' ? 0 : 1;
      return eventB - eventA || Math.abs(Number(b.changePct) || 0) - Math.abs(Number(a.changePct) || 0);
    }).slice(0, 24),
    tokenPositions
  };
}

function rawViewer() {
  if (route !== 'chain') return;
  const original = document.querySelector('.raw-code:not([data-enhanced])');
  if (!original) return;
  original.dataset.enhanced = 'true';
  let data;
  try { data = JSON.parse(original.textContent); } catch { data = { raw: original.textContent }; }
  original.replaceWith(mountRawInspector(data, diffData(), state.raw));
}

function recordTools() {
  if (route !== 'day') return;
  const target = section('the record');
  if (!target || target.querySelector('[data-record-tools]')) return;
  const tools = document.createElement('div');
  tools.dataset.recordTools = 'true';
  tools.className = 'record-controls t-meta';
  tools.innerHTML = '<span class="c-dim">local browser record · ' + getRecord().length + ' entries retained</span><span class="c-dim">simulation only</span>';
  target.querySelector('.sec')?.after(tools);
}

function boardInspector() {
  if (route !== 'board') return;
  const host = document.querySelector('.heatmap');
  if (!host || document.querySelector('[data-asset-inspector]')) return;
  const panel = document.createElement('div');
  panel.dataset.assetInspector = 'true';
  panel.className = 'depth-panel asset-panel asset-inspector';
  panel.hidden = true;
  host.after(panel);

  const compactUsd = value => {
    const number = num(value);
    if (number == null) return null;
    const absolute = Math.abs(number);
    const unit = absolute >= 1e9 ? [1e9, 'B'] : absolute >= 1e6 ? [1e6, 'M'] : absolute >= 1e3 ? [1e3, 'K'] : null;
    if (!unit) return priceUsd(number);
    return '$' + (number / unit[0]).toLocaleString('en-US', { maximumFractionDigits: 2 }) + unit[1];
  };
  const precisePrice = value => {
    const number = num(value);
    if (number == null) return null;
    if (number === 0 || Math.abs(number) >= 1) return usd(number);
    if (Math.abs(number) < 1e-12) return '$' + number.toExponential(2);
    const digits = Math.min(12, Math.max(2, 3 - Math.floor(Math.log10(Math.abs(number)))));
    return '$' + number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits });
  };
  const amount = value => {
    const number = num(value);
    if (number == null) return null;
    const full = '$' + number.toLocaleString('en-US', { maximumFractionDigits: 12 });
    return '<span title="' + esc(full) + '">' + esc(compactUsd(number)) + '</span>';
  };
  const decimal = (value, digits = 0) => num(value) == null ? null : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
  const percent = value => num(value) == null ? null : (Number(value) >= 0 ? '+' : '') + Number(value).toFixed(2) + '%';
  const metric = (label, value, wide = false) => value == null ? '' : field(label, value, wide);
  const group = (label, entries) => {
    const rendered = entries.map(([name, value, wide]) => metric(name, value, wide)).join('');
    return rendered ? '<div class="depth-subtitle t-meta c-label">' + esc(label) + '</div><div class="depth-grid">' + rendered + '</div>' : '';
  };

  const renderAsset = item => {
    const decision = latestDecision();
    const candidate = (decision?.candidates || []).find(value => item.mint && value.mint ? value.mint === item.mint : !item.mint && !value.mint && value.symbol === item.symbol);
    const held = (observation().wallet?.positions || []).some(position => position.mint === item.mint);
    const project = Boolean(item.project || item.feeds?.includes('project') || observation().market?.projectToken?.mint === item.mint);
    const projectStatus = item.marketDataStatus || observation().projectTokenConfig?.status || 'indexing';
    const activity = [item.buyVolume, item.sellVolume, item.buys, item.sells, item.traders].some(value => num(value) != null);
    const completeness = [
      ['price', num(item.price) != null],
      ['liquidity', num(item.liquidityUsd) != null],
      ['activity', activity],
      ['holders', num(item.holderCount) != null],
      ['organic', num(item.organicScore) != null]
    ];
    const missing = completeness.filter(([, present]) => !present).map(([name]) => name);
    const dataCount = completeness.length - missing.length;
    const candidateUnavailable = project && (!candidate || num(item.price) == null || num(item.liquidityUsd) == null || /unavailable/i.test(candidate.reason || ''));
    const history = snapshots().slice(0, 20).flatMap(snapshot => (snapshot.market?.assets || []).filter(asset => item.mint ? asset.mint === item.mint : !asset.mint && asset.symbol === item.symbol).map(asset => {
      const storedCandidate = (snapshot.decision?.candidates || []).find(value => asset.mint && value.mint ? value.mint === asset.mint : !asset.mint && !value.mint && value.symbol === asset.symbol);
      return { snapshot, asset, candidate: storedCandidate || (asset.candidateScore != null || asset.candidateEligible != null ? { score: asset.candidateScore, eligible: asset.candidateEligible } : null) };
    }));
    const historyRows = history.slice(0, 8).map(({ snapshot, asset, candidate: previous }) => {
      const buy = num(asset.buyVolume), sell = num(asset.sellVolume);
      const volume = buy != null && sell != null ? buy + sell : null;
      return '<div class="asset-history-row"><span>' + esc(formatEasternDateTime(snapshot.createdAt || snapshot.timestamp)) + '</span><span>' + esc(precisePrice(asset.price) || '—') + '</span><span>' + esc(compactUsd(asset.liquidityUsd) || '—') + '</span><span>' + esc(compactUsd(volume) || '—') + '</span><span>' + (num(previous?.score) == null ? '—' : Number(previous.score).toFixed(5)) + '</span><span>' + (previous?.eligible == null ? '—' : previous.eligible ? 'yes' : 'no') + '</span></div>';
    }).join('');
    const source = item.priceSource || item.source || 'jupiter tokens v2 / price v3';
    const lastUpdated = item.quoteAt || item.lastUpdate || (num(item.price) != null ? observation().market?.sourceTimestamp : null);
    panel.innerHTML = '<div class="depth-head"><span class="t-strong c-text">' + esc(item.symbol || item.mint) + (project ? ' <span class="t-meta c-up">project</span>' : '') + '</span><button class="tiny-control" data-close>close</button></div>' +
      group('token', [
        ['name', item.name ? esc(item.name) : null],
        ['symbol', item.symbol ? esc(item.symbol) : null],
        ['mint', item.mint ? esc(item.mint) : null, true],
        ['token program', item.tokenProgram ? esc(item.tokenProgram) : null, true],
        ['status', project ? esc(projectStatus) : null]
      ]) +
      group('market', [
        ['price', precisePrice(item.price)],
        ['24h', percent(item.change24h ?? item.dailyMovePct)],
        ['liquidity', amount(item.liquidityUsd)],
        ['market cap', amount(item.marketCap)],
        ['fdv', amount(item.fdv)]
      ]) +
      group('activity · 24h', [
        ['buy volume', amount(item.buyVolume)],
        ['sell volume', amount(item.sellVolume)],
        ['buys', decimal(item.buys)],
        ['sells', decimal(item.sells)],
        ['traders', decimal(item.traders)]
      ]) +
      group('quality', [
        ['holders', decimal(item.holderCount)],
        ['organic score', decimal(item.organicScore, 2)],
        ['organic label', item.organicScoreLabel ? esc(item.organicScoreLabel) : null],
        ['verified', item.verified == null ? null : item.verified ? 'yes' : 'no'],
        ['top holders', percent(item.topHoldersPercentage ?? item.holderConcentration)]
      ]) +
      group('SORYN', [
        ['held', held ? 'yes' : 'no'],
        ['candidate', candidateUnavailable ? 'unavailable' : candidate ? 'yes' : null],
        ['eligible', candidateUnavailable || !candidate ? null : candidate.eligible ? 'yes' : 'no'],
        ['score', candidateUnavailable || num(candidate?.score) == null ? null : Number(candidate.score).toFixed(5)],
        ['reason', candidate?.reason ? esc(candidate.reason) : null, true]
      ]) +
      '<div class="depth-subtitle t-meta c-label">recent observations</div><div class="asset-history"><div class="asset-history-row t-meta c-dim"><span>snapshot</span><span>price</span><span>liquidity</span><span>activity</span><span>score</span><span>eligible</span></div>' + (historyRows || '<div class="depth-empty">not enough observations</div>') + '</div>' +
      '<div class="depth-foot c-dim"><span>data ' + dataCount + ' / 5</span>' + (missing.length ? '<span> · missing data: ' + esc(missing.join(', ')) + '</span>' : '') + '<br><span>source ' + esc(source) + (lastUpdated ? ' · updated ' + esc(formatEasternDateTime(lastUpdated)) : '') + '</span></div>';
    panel.querySelector('[data-close]').addEventListener('click', () => { panel.hidden = true; });
  };

  document.querySelectorAll('.tile[data-symbol]').forEach(tile => tile.addEventListener('click', () => {
    const item = (observation().market?.assets || []).concat(observation().market?.projectToken || []).find(asset => tile.dataset.mint ? asset.mint === tile.dataset.mint : asset.symbol === tile.dataset.symbol);
    if (!item) return;
    state.asset = item;
    panel.hidden = false;
    renderAsset(item);
  }));
}

function health() {
  if (route !== 'home') return;
  const notes = document.querySelector('.status-notes');
  if (!notes || notes.querySelector('[data-health-toggle]')) return;
  const button = document.createElement('button');
  button.className = 'tiny-control';
  button.dataset.healthToggle = 'true';
  button.textContent = 'system health';
  const panel = document.createElement('div');
  panel.className = 'depth-panel health-panel';
  panel.hidden = true;
  notes.after(panel);
  const render = () => {
    const current = getObservation();
    const health = current?.sourceHealth || {};
    const statuses = current?.sourceStatus || {};
    const runtime = getRuntime();
    const agent = runtime.agentState === 'rest' ? 'resting' : runtime.agentState || 'resting';
    const source = (key, fallback) => current ? health[key]?.status || fallback || 'unavailable' : 'loading…';
    const group = (key, fallback) => current ? statuses[key] || fallback || 'unavailable' : 'loading…';
    const project = current ? current.projectTokenConfig?.status || 'awaiting mint' : 'loading…';
    const rows = [
      ['system', 'live'],
      ['solana rpc', group('chain')],
      ['jupiter tokens', source('jupiter-tokens', group('market'))],
      ['jupiter prices', source('jupiter-prices', group('market'))],
      ['external references', group('external')],
      ['agent', agent],
      ['execution', EXECUTION_MODE],
      ['project token', project]
    ];
    panel.innerHTML = '<div class="health-list">' + rows.map(([label, status]) => {
      const tone = status === 'live' || status === 'tracking' ? 'c-up' : status === 'unavailable' || status === 'invalid mint' ? 'c-label' : 'c-dim';
      return '<div class="health-row"><span class="c-text2">' + esc(label) + '</span><span class="' + tone + '">' + esc(status) + '</span></div>';
    }).join('') + '</div><div class="depth-foot c-dim">local browser loop · next wake ' +
      esc(runtime.nextAllowedWake ? formatEasternDateTime(runtime.nextAllowedWake) : 'pending') +
      ' · latest observation ' + esc(current?.timestamp ? formatEasternRelativeTime(current.timestamp) : 'loading…') + '</div>';
  };
  button.addEventListener('click', () => { panel.hidden = !panel.hidden; render(); });
  notes.append(button);
}

function identity() {
  const marker = document.querySelector('.brand-lockup .c-faint');
  if (!marker || marker.dataset.bound) return;
  marker.dataset.bound = 'true';
  marker.tabIndex = 0;
  const panel = document.createElement('div');
  panel.className = 'depth-panel identity-panel';
  panel.hidden = true;
  const render = () => {
    const config = observation().projectTokenConfig;
    panel.innerHTML = '<div class="depth-grid">' +
      field('agent', 'soryn 01') +
      field('wallet', esc(getRuntime().wallet || 'unavailable'), true) +
      field('network', esc(NETWORK_CONFIG.name)) +
      field('cluster', esc(NETWORK_CONFIG.cluster)) +
      field('execution', esc(EXECUTION_MODE)) +
      field('project token', esc(config?.status || 'awaiting mint')) +
      field('token mint', esc(config?.mint || 'not deployed'), true) +
      field('genesis', esc(formatEasternDateTime(getRuntime().genesisAt))) + '</div>';
  };
  render();
  document.querySelector('header')?.after(panel);
  const toggle = () => { render(); panel.hidden = !panel.hidden; };
  marker.addEventListener('click', toggle);
  marker.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } });
}

function localPanels() {
  if (route === 'holdings' && !document.querySelector('[data-local-paper]')) {
    const host = document.querySelector('.page-stack');
    if (host) {
      const paper = getPaper();
      const sectionNode = document.createElement('section');
      sectionNode.dataset.localPaper = 'true';
      sectionNode.innerHTML = '<div class="sec"><div class="sec-rule"></div><div class="t-strong c-label"><span>paper positions</span></div><div class="sec-rule"></div></div><div class="spacer-10"></div><div class="paper-label t-meta c-dim">simulation · separate from the real wallet</div><div class="depth-table t-meta">' + ((paper.positions || []).map(item => '<div class="paper-row"><span class="t-strong c-text">' + esc(item.symbol) + '</span><span>' + esc(item.side) + '</span><span>entry ' + usd(item.entryPrice) + '</span><span>current ' + usd(item.currentPrice) + '</span><span>' + (item.pnlPct == null ? 'pnl unavailable' : fixed(item.pnlPct, 2) + '%') + '</span></div>').join('') || '<div class="depth-empty">not enough history</div>') + '</div>';
      host.append(sectionNode);
    }
  }
  if (route === 'day' && !document.querySelector('[data-local-memory]')) {
    const host = document.querySelector('.page-stack');
    if (host) {
      const memory = getMemory();
      const sectionNode = document.createElement('section');
      sectionNode.dataset.localMemory = 'true';
      sectionNode.innerHTML = '<div class="sec"><div class="sec-rule"></div><div class="t-strong c-label"><span>memory · older records</span></div><div class="sec-rule"></div></div><div class="spacer-10"></div><div class="depth-table t-meta">' + (memory.map(item => '<div class="memory-row"><span>' + esc(item.day) + '</span><span>cycles ' + item.cycles + '</span><span>records ' + item.records + '</span><span>actions ' + item.actions + '</span></div>').join('') || '<div class="depth-empty">no local memory yet</div>') + '</div>';
      host.append(sectionNode);
    }
  }
}

function tracePanel() {
  if (route !== 'brain' || document.querySelector('[data-decision-trace]')) return;
  const anchor = section('last decision') || document.querySelector('.page-stack');
  if (!anchor) return;
  const decision = latestDecision();
  const sourceCandidates = decision?.candidates || [];
  const prioritized = [decision?.chosen, sourceCandidates.find(candidate => candidate.action === 'do nothing'), ...sourceCandidates].filter(Boolean);
  const seen = new Set();
  const candidates = prioritized.filter(candidate => {
    const key = [candidate.mint || '',candidate.symbol || '',candidate.action || ''].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 24);
  const node = document.createElement('section');
  node.dataset.decisionTrace = 'true';
  node.className = 'decision-trace';
  node.innerHTML = title('decision trace') + '<div class="t-meta c-dim">real inputs captured by the Solana weigh pass · click a candidate</div><div class="trace-table">' +
    (candidates.map((candidate, index) => '<button type="button" class="trace-row" data-trace-index="' + index + '"><span>' + esc(candidate.symbol || candidate.mint || 'do nothing') + ' · ' + esc(candidate.reason || 'unavailable') + '</span><span>' + (candidate.score == null ? 'unavailable' : Number(candidate.score).toFixed(4)) + '</span></button>').join('') || '<div class="depth-empty">not enough observations</div>') +
    '</div><div class="candidate-detail" data-trace-detail></div>';
  anchor.after(node);
  const detail = node.querySelector('[data-trace-detail]');
  const render = candidate => {
    if (!detail || !candidate) return;
    const components = Object.entries(candidate.components || {}).map(([key, value]) => field(key, value == null ? 'unavailable' : Number(value).toFixed(5))).join('');
    detail.innerHTML = title('candidate inputs') + field('symbol', esc(candidate.symbol || 'do nothing')) + field('mint', esc(candidate.mint || 'unavailable'), true) + field('score', candidate.score == null ? 'unavailable' : Number(candidate.score).toFixed(5)) + field('eligible', candidate.eligible ? 'yes' : 'no') + field('reason', esc(candidate.reason || 'unavailable'), true) + '<div class="depth-subtitle t-meta c-label">components</div>' + (components || '<div class="depth-empty">unavailable</div>');
    node.querySelectorAll('.trace-row').forEach(button => button.classList.toggle('is-active', Number(button.dataset.traceIndex) === candidates.indexOf(candidate)));
  };
  node.querySelectorAll('[data-trace-index]').forEach(button => button.addEventListener('click', () => render(candidates[Number(button.dataset.traceIndex)])));
  render(candidates[0] || decision?.chosen || null);
}

function cyclePanel() {
  if (route !== 'day' || document.querySelector('[data-cycle-inspector]')) return;
  const anchor = section('the record') || document.querySelector('.page-stack');
  if (!anchor) return;
  const cycles = getCycles();
  const node = document.createElement('section');
  node.dataset.cycleInspector = 'true';
  node.className = 'cycle-inspector';
  node.innerHTML = title('cycle inspector') + '<div class="t-meta c-dim">local cycle timeline · browser simulation</div><div class="trace-table">' +
    (cycles.slice(0, 8).map((cycle, index) => '<button type="button" class="trace-row" data-cycle-index="' + index + '"><span>' + esc(cycle.id || 'cycle') + ' · ' + esc(cycle.result || 'unavailable') + '</span><span>' + esc(cycle.status || 'unavailable') + '</span></button>').join('') || '<div class="depth-empty">not enough cycles</div>') +
    '</div><div class="cycle-timeline" data-cycle-detail></div>';
  anchor.after(node);
  const detail = node.querySelector('[data-cycle-detail]');
  const render = cycle => {
    if (!detail || !cycle) return;
    detail.innerHTML = (cycle.records || []).map(record => '<div class="cycle-step"><span>' + esc(record.type || 'event') + '</span><span>' + esc(formatEasternRelativeTime(record.timestamp)) + '</span><span>' + esc(record.text || 'unavailable') + '</span></div>').join('') || '<div class="depth-empty">no records in cycle</div>';
  };
  node.querySelectorAll('[data-cycle-index]').forEach(button => button.addEventListener('click', () => render(cycles[Number(button.dataset.cycleIndex)])));
  render(cycles[0] || null);
}

function snapshotPanel() {
  if (route !== 'day' || document.querySelector('[data-snapshot-diff]')) return;
  const anchor = document.querySelector('[data-cycle-inspector]') || section('a plain telling') || document.querySelector('.page-stack');
  if (!anchor) return;
  const diff = diffData();
  const node = document.createElement('section');
  node.dataset.snapshotDiff = 'true';
  node.className = 'snapshot-diff';
  const changeRows = diff.assets.map(item => '<div class="row t-base"><span class="cell t-strong c-text2">' + esc(item.symbol || item.mint || 'token') + '</span><span class="cell c-label">' + esc(item.status) + ' · liq ' + (item.liquidityChangeUsd == null ? 'unavailable' : usd(item.liquidityChangeUsd)) + ' · activity ' + (item.activityChangeUsd == null ? 'unavailable' : usd(item.activityChangeUsd)) + '</span><span class="cell c-text2">' + (item.changePct == null ? 'unavailable' : (item.changePct >= 0 ? '+' : '') + item.changePct.toFixed(2) + '%') + '</span></div>').join('');
  const positionRows = diff.tokenPositions.map(item => '<div class="row t-base"><span class="cell t-strong c-text2">' + esc(item.symbol || item.mint || 'token') + '</span><span class="cell c-label">' + esc(item.status) + ' · balance ' + (item.balanceChange == null ? 'unavailable' : Number(item.balanceChange).toLocaleString('en-US',{maximumFractionDigits:9})) + '</span><span class="cell c-text2">' + (item.valueChangeUsd == null ? 'unavailable' : usd(item.valueChangeUsd)) + '</span></div>').join('');
  node.innerHTML = title('snapshot diff') + '<div class="t-meta c-dim">latest two local Solana observations</div><div class="snapshot-diff-panel">' +
    (diff.available ? '<div class="depth-grid">' + field('current slot', diff.current.slot == null ? 'unavailable' : String(diff.current.slot)) + field('previous slot', diff.previous.slot == null ? 'unavailable' : String(diff.previous.slot)) + field('current SOL', diff.current.solBalance == null ? 'unavailable' : Number(diff.current.solBalance).toFixed(9)) + field('previous SOL', diff.previous.solBalance == null ? 'unavailable' : Number(diff.previous.solBalance).toFixed(9)) + field('token positions', String(diff.current.positions ?? 'unavailable') + ' / ' + String(diff.previous.positions ?? 'unavailable')) + field('universe size', String(diff.current.universe) + ' / ' + String(diff.previous.universe)) + field('trending feed', String(diff.current.counts?.trending ?? 'unavailable') + ' / ' + String(diff.previous.counts?.trending ?? 'unavailable')) + '</div><div class="depth-subtitle t-meta c-label">wallet position changes</div>' + (positionRows || '<div class="depth-empty">no token position changes</div>') + '<div class="depth-subtitle t-meta c-label">token price · liquidity · activity changes</div>' + (changeRows || '<div class="depth-empty">no token changes</div>') : '<div class="depth-empty">' + esc(diff.reason) + '</div>') + '</div>';
  anchor.after(node);
}

function counterfactualPanel() {
  if (route !== 'day' || document.querySelector('[data-counterfactual]')) return;
  const anchor = document.querySelector('[data-snapshot-diff]') || document.querySelector('.page-stack');
  if (!anchor) return;
  const result = getCounterfactuals();
  const node = document.createElement('section');
  node.dataset.counterfactual = 'true';
  node.className = 'counterfactual';
  node.innerHTML = title('counterfactual') + '<div class="t-meta c-dim">paper decisions are evaluated only when a later local snapshot exists</div><div class="depth-table">' +
    (result.items?.map(item => '<div class="counter-row"><span>' + esc(item.symbol || 'token') + '</span><span>score ' + (item.runnerUpScore == null ? 'unavailable' : Number(item.runnerUpScore).toFixed(4)) + '</span><span>baseline ' + (item.baselinePrice == null ? 'unavailable' : usd(item.baselinePrice)) + '</span><span>1h ' + (item.results?.['1h']?.changePct == null ? 'unavailable' : item.results['1h'].changePct.toFixed(2) + '%') + '</span><span>6h ' + (item.results?.['6h']?.changePct == null ? 'unavailable' : item.results['6h'].changePct.toFixed(2) + '%') + '</span><span>24h ' + (item.results?.['24h']?.changePct == null ? 'unavailable' : item.results['24h'].changePct.toFixed(2) + '%') + '</span></div>').join('') || '<div class="depth-empty">unavailable — waiting for future snapshots</div>') + '</div>';
  anchor.after(node);
}

function enhance() {
  rawViewer();
  recordTools();
  boardInspector();
  health();
  identity();
  localPanels();
  tracePanel();
  cyclePanel();
  snapshotPanel();
  counterfactualPanel();
}

const root = document.querySelector('#app');
if (root) {
  enhance();
  new MutationObserver(() => queueMicrotask(enhance)).observe(root, { childList: true, subtree: true });
}
