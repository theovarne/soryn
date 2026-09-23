import { PROJECT_TOKEN_MINT, NETWORK_CONFIG } from './config.js';
import { getObservation } from './services.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const usd = value => '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Math.abs(Number(value)) < 0.01 ? 12 : 6 });
const compactUsd = value => {
  const amount = Number(value), magnitude = Math.abs(amount);
  if (magnitude < 1000) return usd(amount);
  const scale = magnitude >= 1e9 ? [1e9, 'B'] : magnitude >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  return '$' + (amount / scale[0]).toFixed(magnitude / scale[0] < 10 ? 2 : 1).replace(/\.0+$/, '') + scale[1];
};
const pct = value => (Number(value) >= 0 ? '+' : '') + Number(value).toFixed(2) + '%';
const metric = (label, value) => '<div class="record-detail-field"><span class="c-dim">' + esc(label) + '</span><span class="c-text2">' + value + '</span></div>';

export function tokenCaMarkup(config = PROJECT_TOKEN_MINT) {
  const value = typeof config === 'string' ? config : config?.mint;
  const status = typeof config === 'object' && config ? config.status : (value ? 'indexing' : 'awaiting mint');
  if (status === 'invalid mint') {
    return '<span class="project-ca t-meta c-dim" tabindex="0" data-tooltip="project token mint\\ninvalid Solana Mint">ca: invalid mint</span>';
  }
  if (status === 'unavailable') {
    return '<span class="project-ca t-meta c-dim" tabindex="0" data-tooltip="project token config temporarily unavailable">ca: unavailable</span>';
  }
  if (!value || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    return '<span class="project-ca t-meta c-dim" tabindex="0" data-tooltip="project token mint\\nnot deployed">ca: not deployed</span>';
  }
  const href = NETWORK_CONFIG.accountExplorer + '/' + encodeURIComponent(value);
  const visibleStatus = status === 'tracking' ? 'live' : status === 'indexing' ? 'indexing' : 'stale';
  return '<span class="project-ca t-meta"><button type="button" class="tiny-control" data-ca-copy="' + esc(value) + '" data-tooltip="project token mint\\n' + esc(value) + '\\n' + esc(visibleStatus) + '\\nclick to inspect and copy">ca: ' + esc(value.slice(0, 5) + '…' + value.slice(-4)) + '</button><span class="c-dim">' + esc(visibleStatus) + '</span><a class="tiny-control" href="' + esc(href) + '" target="_blank" rel="noreferrer" aria-label="project token mint explorer">↗</a></span>';
}

export function bindTokenCa(root = document) {
  root.querySelectorAll('[data-ca-copy]').forEach(button => button.addEventListener('click', async () => {
    const mint = button.dataset.caCopy;
    try { await navigator.clipboard.writeText(mint); } catch {}
    let panel = root.querySelector('[data-token-ca-inspector]');
    if (!panel) {
      panel = document.createElement('section');
      panel.dataset.tokenCaInspector = 'true';
      panel.className = 'depth-panel ca-inspector';
      root.querySelector('header')?.after(panel);
    }
    const observation = getObservation() || {};
    const token = observation.market?.projectToken?.mint === mint
      ? observation.market.projectToken
      : (observation.market?.assets || []).find(asset => asset.mint === mint);
    const config = observation.projectTokenConfig || {};
    const buy = number(token?.buyVolume), sell = number(token?.sellVolume);
    const volume = number(token?.volume24h) ?? (buy != null && sell != null ? buy + sell : null);
    const hasMarketData = [token?.price, token?.liquidityUsd, token?.marketCap, volume].some(value => number(value) != null);
    const marketLabel = config.status === 'tracking' && hasMarketData
      ? 'tracking · live Jupiter market observation · mint copied'
      : 'indexing · waiting for market data · mint copied';
    const href = NETWORK_CONFIG.accountExplorer + '/' + encodeURIComponent(mint);
    const values = [
      ['price', token?.price, usd],
      ['24h', token?.change24h ?? token?.dailyMovePct, pct],
      ['liquidity', token?.liquidityUsd, compactUsd],
      ['market cap', token?.marketCap, compactUsd],
      ['fdv', token?.fdv, compactUsd],
      ['volume', volume, compactUsd],
      ['holders', token?.holderCount, value => Number(value).toLocaleString('en-US')],
      ['buy volume', buy, compactUsd],
      ['sell volume', sell, compactUsd],
      ['buys', token?.buys ?? token?.numBuys, value => Number(value).toLocaleString('en-US')],
      ['sells', token?.sells ?? token?.numSells, value => Number(value).toLocaleString('en-US')],
      ['organic score', token?.organicScore, value => String(value)]
    ];
    const available = values.filter(([, value]) => number(value) != null);
    const missing = values.filter(([, value]) => number(value) == null).map(([label]) => label);
    panel.innerHTML = '<div class="depth-head"><span class="t-strong c-text">SORYN token</span><button type="button" class="tiny-control" data-ca-close>close</button></div>' +
      '<div class="t-meta c-dim">' + marketLabel + '</div>' +
      '<div class="depth-grid">' +
      metric('mint', '<span title="' + esc(mint) + '">' + esc(mint) + '</span>') +
      metric('status', esc(config.status || 'indexing')) +
      available.map(([label, value, format]) => metric(label, esc(format(value)))).join('') +
      '</div>' + (missing.length ? '<div class="t-meta c-dim">missing data: ' + esc(missing.join(', ')) + '</div>' : '') +
      '<div class="depth-foot"><button type="button" class="tiny-control" data-ca-copy-again>copy mint</button> · <a class="lnk" href="' + esc(href) + '" target="_blank" rel="noreferrer">open in Solscan ↗</a></div>';
    panel.hidden = false;
    panel.querySelector('[data-ca-close]')?.addEventListener('click', () => { panel.hidden = true; });
    panel.querySelector('[data-ca-copy-again]')?.addEventListener('click', async event => {
      const original = event.currentTarget.textContent;
      try { await navigator.clipboard.writeText(mint); event.currentTarget.textContent = 'copied'; }
      catch { event.currentTarget.textContent = 'copy unavailable'; }
      setTimeout(() => { event.currentTarget.textContent = original; }, 1000);
    });
  }));
}
