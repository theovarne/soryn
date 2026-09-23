import { getRuntime, getRecord, getSnapshots } from '/agent.js';
import { getObservation } from '/services.js';
import { NETWORK_CONFIG, EXECUTION_MODE } from '/config.js';
import { formatEasternDateTime, formatEasternRelativeTime } from '/time.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

// Small, dependency-free inspection helpers used by the Solana pages.
export function sourceSummary() {
  const observation = getObservation() || {};
  return Object.values(observation.sourceHealth || {}).map(item => ({
    id: item.id,
    label: item.label || item.id,
    status: item.status || 'unavailable',
    endpoint: item.endpoint || 'unavailable',
    latencyMs: item.latencyMs ?? null,
    lastSuccess: item.lastSuccess || null
  }));
}

const networkNodes = [
  { id:'tokens', label:'token universe', x:180, y:50, role:'observed Solana token universe' },
  { id:'liquidity', label:'liquidity', x:180, y:220, role:'filters thin or unknown markets' },
  { id:'wallet', label:'wallet', x:600, y:130, role:'public agent wallet and its holdings' },
  { id:'context', label:'market context', x:1020, y:50, role:'external BTC / ETH / SOL references' },
  { id:'sleep', label:'sleep', x:1020, y:220, role:'closes the local loop until next wake' }
];
const networkEdges = [
  { from:'tokens', to:'wallet', label:'reads', x1:250, y1:62, x2:530, y2:118, tx:390, ty:82 },
  { from:'liquidity', to:'wallet', label:'checks', x1:250, y1:208, x2:530, y2:142, tx:390, ty:181 },
  { from:'context', to:'wallet', label:'signals', x1:950, y1:62, x2:670, y2:118, tx:810, ty:82 },
  { from:'wallet', to:'sleep', label:'waits', x1:670, y1:142, x2:950, y2:208, tx:810, ty:181 }
];

function networkDetail(id) {
  const item = networkNodes.find(node => node.id === id);
  const observation = getObservation() || {};
  const runtime = getRuntime();
  if (!item) return '<div class="network-detail-empty">hover a node or line · click to keep details</div>';
  const assets = observation.market?.assets || [];
  const facts = {
    tokens: ['source', 'Jupiter Tokens V2', 'observed', String(assets.length) + ' tokens'],
    liquidity: ['known', String(assets.filter(asset => asset.liquidityUsd != null).length) + ' tokens', 'rule', 'minimum ' + (runtime.genesisConfig?.minimumLiquidityUsd || 25000) + ' USD'],
    wallet: ['address', runtime.wallet || 'unavailable', 'SOL', observation.wallet?.solBalance == null ? 'unavailable' : String(observation.wallet.solBalance)],
    context: ['source', 'public BTC / ETH / SOL references', 'status', observation.sourceStatus?.external || 'loading…'],
    sleep: ['agent', runtime.agentState === 'rest' ? 'resting · system live' : runtime.agentState || 'resting', 'next wake', runtime.nextAllowedWake ? formatEasternDateTime(runtime.nextAllowedWake) : 'starting locally']
  }[id];
  return '<div class="network-detail-title t-strong c-text">' + esc(item.label) + '</div><div class="network-detail-grid t-meta"><div><span class="c-dim">role </span><span class="c-text2">' + esc(item.role) + '</span></div><div><span class="c-dim">' + esc(facts[0]) + ' </span><span class="c-text2">' + esc(facts[1]) + '</span></div><div><span class="c-dim">' + esc(facts[2]) + ' </span><span class="c-text2">' + esc(facts[3]) + '</span></div></div>';
}

function bindNetworkMap() {
  document.querySelectorAll('.network-map:not([data-enhanced])').forEach(svg => {
    svg.dataset.enhanced = 'true';
    svg.classList.add('interactive-network');
    const shell = document.createElement('div');
    shell.className = 'network-shell';
    svg.parentNode.insertBefore(shell, svg);
    shell.append(svg);
    const detail = document.createElement('div');
    detail.className = 'network-detail';
    detail.setAttribute('aria-live', 'polite');
    detail.innerHTML = networkDetail(null);
    shell.append(detail);
    svg.innerHTML = '<defs><marker id="interactive-arrow" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5"/></marker></defs>' +
      networkEdges.map(edge => '<g class="network-edge" data-network-edge="' + edge.from + ':' + edge.to + '" tabindex="0" role="button" aria-label="' + edge.label + '"><line class="edge-line" x1="' + edge.x1 + '" y1="' + edge.y1 + '" x2="' + edge.x2 + '" y2="' + edge.y2 + '" marker-end="url(#interactive-arrow)"/><line class="edge-hit" x1="' + edge.x1 + '" y1="' + edge.y1 + '" x2="' + edge.x2 + '" y2="' + edge.y2 + '"/><text x="' + edge.tx + '" y="' + edge.ty + '" text-anchor="middle">' + edge.label + '</text></g>').join('') +
      networkNodes.map(node => '<g class="network-node" data-network-node="' + node.id + '" tabindex="0" role="button" aria-label="' + node.label + '"><rect x="' + (node.x - 70) + '" y="' + (node.y - 17) + '" width="140" height="34"/><text x="' + node.x + '" y="' + (node.y + 4) + '" text-anchor="middle">' + node.label + '</text></g>').join('');
    let selected = null;
    let hovered = null;
    const paint = () => {
      const active = hovered || selected;
      shell.classList.toggle('is-inspecting', Boolean(active));
      svg.querySelectorAll('[data-network-node]').forEach(node => {
        const id = node.dataset.networkNode;
        node.classList.toggle('is-selected', id === selected);
        node.classList.toggle('is-related', id === active);
        node.classList.toggle('is-state', id === 'sleep' && getRuntime().agentState === 'rest');
      });
      svg.querySelectorAll('[data-network-edge]').forEach(edge => {
        const [from, to] = edge.dataset.networkEdge.split(':');
        edge.classList.toggle('is-inspected', active === from || active === to);
      });
      detail.innerHTML = networkDetail(active);
    };
    svg.querySelectorAll('[data-network-node], [data-network-edge]').forEach(element => {
      const id = element.dataset.networkNode || element.dataset.networkEdge.split(':')[0];
      element.addEventListener('mouseenter', () => { hovered = id; paint(); });
      element.addEventListener('mouseleave', () => { hovered = null; paint(); });
      element.addEventListener('focus', () => { hovered = id; paint(); });
      element.addEventListener('blur', () => { hovered = null; paint(); });
      const choose = () => { selected = id; hovered = null; paint(); };
      element.addEventListener('click', choose);
      element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); } });
    });
    paint();
  });
}

function identityDetails() {
  const runtime = getRuntime();
  return {
    agent: 'soryn 01',
    wallet: runtime.wallet || 'unavailable',
    network: NETWORK_CONFIG.name,
    cluster: NETWORK_CONFIG.cluster,
    execution: runtime.executionMode || EXECUTION_MODE,
    genesis: runtime.genesisAt ? formatEasternDateTime(runtime.genesisAt) : 'unavailable',
    records: getRecord().length,
    snapshots: getSnapshots().length,
    lastWake: runtime.lastWakeAt ? formatEasternRelativeTime(runtime.lastWakeAt) : 'never'
  };
}

function exposeInspection() {
  globalThis.__sorynInspection = {
    identity: identityDetails,
    sources: sourceSummary
  };
}

exposeInspection();
bindNetworkMap();
const app = document.querySelector('#app');
if (app) new MutationObserver(() => queueMicrotask(bindNetworkMap)).observe(app, { childList: true, subtree: true });
