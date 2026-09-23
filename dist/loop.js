import { getRuntime, getRecord } from './agent.js';
import { GENESIS_CONFIG } from './config.js';
import { formatEasternDateTime, formatEasternRelativeTime, countdown } from './time.js';

const stages = ['wake', 'look', 'weigh', 'act', 'rest'];
const hints = {
  wake: 'starts one local cycle',
  look: 'reads one Solana snapshot',
  weigh: 'scores token candidates',
  act: 'records a simulation only',
  rest: 'waits for the next local wake'
};
const stageFlow = {
  wake: ['local clock, last wake and daily act count', 'a new local cycle and wake record'],
  look: ['Solana RPC, wallet, Jupiter and market context', 'one coherent observation with source status'],
  weigh: ['observation, holdings and genesis rules', 'scored candidates and the do nothing baseline'],
  act: ['the winning decision and simulation limits', 'a paper action or a recorded decision to do nothing'],
  rest: ['the cycle result and minimum interval', 'a rest record and the next eligible local wake']
};
let selected = new URLSearchParams(location.search).get('stage');
if (!stages.includes(selected)) selected = null;
let replay = false;
const esc = value => String(value ?? '—').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function lastEntered(stage) {
  const runtime = getRuntime();
  return getRecord().find(record => record.type === stage)?.timestamp || (stage === 'wake' ? runtime.lastWakeAt : stage === runtime.agentState ? runtime.updatedAt : null);
}

function latestCycle() {
  const record = getRecord().find(item => item.cycleId);
  return record ? record.cycleId : null;
}

export function latestCycleStages(records = getRecord()) {
  const id = latestCycle();
  return id ? records.filter(record => record.cycleId === id && ['wake', 'look', 'snapshot', 'weigh', 'decision', 'act', 'rest'].includes(record.type)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)) : [];
}

function activeStage() {
  return getRuntime().agentState || 'rest';
}

export function renderLoop(large = false) {
  const width = large ? 588 : 576;
  const height = large ? 360 : 240;
  const cx = width / 2;
  const cy = height / 2;
  const radius = large ? 145 : 88;
  const points = stages.map((label, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / stages.length;
    return { label, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
  const edge = (from, to) => '<line class="loop-edge" data-loop-edge="' + from.label + '-' + to.label + '" data-from="' + from.label + '" data-to="' + to.label + '" x1="' + from.x + '" y1="' + from.y + '" x2="' + to.x + '" y2="' + to.y + '" marker-end="url(#loop-arrow-' + large + ')" /><line class="loop-edge-signal" data-from="' + from.label + '" data-to="' + to.label + '" x1="' + from.x + '" y1="' + from.y + '" x2="' + to.x + '" y2="' + to.y + '" />';
  const edges = points.map((point, index) => edge(point, points[(index + 1) % points.length])).join('');
  const nodes = points.map(point => {
    const anchor = point.x < cx - 20 ? 'end' : point.x > cx + 20 ? 'start' : 'middle';
    const tx = anchor === 'end' ? point.x - 17 : anchor === 'start' ? point.x + 17 : point.x;
    const ty = anchor === 'middle' ? point.y - 18 : point.y - 5;
    return '<g class="loop-node" data-loop-node="' + point.label + '" tabindex="0" role="button" aria-pressed="false" aria-label="' + point.label + ': ' + esc(hints[point.label]) + '"><circle class="loop-hit" cx="' + point.x + '" cy="' + point.y + '" r="18"/><circle class="loop-ring" cx="' + point.x + '" cy="' + point.y + '" r="11"/><circle class="loop-dot" cx="' + point.x + '" cy="' + point.y + '" r="4"/><text x="' + tx + '" y="' + ty + '" font-size="9" text-anchor="' + anchor + '" dominant-baseline="middle">' + point.label + '</text></g>';
  }).join('');
  return '<div class="loop-viewer" data-loop-large="' + large + '"><svg class="loop-svg interactive-loop" viewBox="0 0 ' + width + ' ' + height + '" role="group" aria-label="soryn loop"><defs><marker id="loop-arrow-' + large + '" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5" fill="none" stroke="var(--faint)"/></marker></defs>' + edges + nodes + '<g class="loop-center" tabindex="0" role="note"><rect x="' + (cx - 70) + '" y="' + (cy - 24) + '" width="140" height="52" fill="transparent"/><text x="' + cx + '" y="' + (cy - 12) + '" font-size="9" text-anchor="middle" fill="var(--label)">one thing per wake</text><text data-loop-count x="' + cx + '" y="' + (cy + 2) + '" font-size="9" text-anchor="middle" fill="var(--dim)"></text><text data-loop-duration x="' + cx + '" y="' + (cy + 16) + '" font-size="9" text-anchor="middle" fill="var(--dim)"></text></g></svg><div class="loop-tools t-meta"><button type="button" class="tiny-control" data-loop-replay>replay last cycle</button><span class="c-dim" data-replay-label></span></div>' + (large ? '<div class="loop-detail t-meta" hidden aria-live="polite"></div>' : '') + '</div>';
}

function detail(stage) {
  const runtime = getRuntime();
  const time = lastEntered(stage);
  const decision = runtime.latestDecision;
  const decisionRows = stage === 'weigh' && decision ? [
    ['chosen', decision.chosen?.action === 'do nothing' ? 'do nothing' : (decision.chosen?.action || 'unavailable') + ' ' + (decision.chosen?.symbol || 'unavailable')],
    ['chosen score', decision.chosen?.score == null ? 'unavailable' : Number(decision.chosen.score).toFixed(5)],
    ['eligible candidates', decision.eligibleCount == null ? 'unavailable' : decision.eligibleCount],
    ['required edge', decision.requiredMargin == null ? GENESIS_CONFIG.doNothingMargin : decision.requiredMargin],
    ['reason', decision.reason || 'unavailable']
  ] : [];
  const values = {
    wake: [['role', 'starts one local cycle'], ['minimum interval', GENESIS_CONFIG.minMinutesBetweenActs + ' minutes'], ['daily act cap', GENESIS_CONFIG.maxActsPerDay]],
    look: [['role', 'reads one coherent Solana snapshot'], ['sources', 'Solana RPC / Jupiter / BTC, ETH and SOL context']],
    weigh: [['role', 'scores all token candidates'], ['minimum liquidity', GENESIS_CONFIG.minimumLiquidityUsd], ['do nothing margin', GENESIS_CONFIG.doNothingMargin], ['noise', GENESIS_CONFIG.noise], ...decisionRows],
    act: [['role', 'at most one simulation'], ['signing', 'disabled']],
    rest: [['role', 'closes the loop'], ['next eligible wake', formatEasternDateTime(runtime.nextAllowedWake)], ['remaining', countdown(runtime.nextAllowedWake)]]
  };
  const recent = stage === activeStage() ? 'active now' : time ? formatEasternRelativeTime(time) : 'not entered yet';
  return [['stage', stage], ['description', hints[stage]], ['input', stageFlow[stage][0]], ['output', stageFlow[stage][1]], ['recent status', recent], ...(values[stage] || [])].concat([['last entered', formatEasternDateTime(time)]]).map(item => '<div><span class="c-dim">' + esc(item[0]) + '</span><span class="c-text2">' + esc(item[1]) + '</span></div>').join('');
}

function linkedTable(root) {
  const owner = root.dataset.loopLarge === 'true' ? root.closest('section') : root.closest('.two');
  return owner?.querySelector('.table-scroll') || null;
}

function paintLinkedTable(root, stage) {
  const table = linkedTable(root);
  if (!table) return;
  table.querySelectorAll('.row').forEach(row => {
    const rowStage = row.querySelector('.cell')?.textContent?.trim();
    row.classList.toggle('loop-row-selected', rowStage === selected);
    row.classList.toggle('loop-row-hover', rowStage === root.dataset.loopHover);
  });
  if (root.dataset.loopLarge === 'true') return;
  let summary = table.querySelector('.loop-linked-detail');
  if (!summary) {
    summary = document.createElement('div');
    summary.className = 'loop-linked-detail t-meta';
    summary.setAttribute('aria-live', 'polite');
    table.firstElementChild.append(summary);
  }
  if (!stage) { summary.textContent = ''; return; }
  const isHover = stage === root.dataset.loopHover;
  const recent = lastEntered(stage);
  summary.textContent = isHover ? stage + ' · ' + hints[stage] : stage + ' · input: ' + stageFlow[stage][0] + ' · output: ' + stageFlow[stage][1] + ' · last: ' + (recent ? formatEasternRelativeTime(recent) : 'not entered yet');
}

function paint(root) {
  const runtime = getRuntime();
  const active = replay || activeStage();
  const hovered = root.dataset.loopHover || null;
  root.querySelectorAll('[data-loop-node]').forEach(node => {
    const stage = node.dataset.loopNode;
    node.classList.toggle('is-current', stage === active);
    node.classList.toggle('is-inspected', stage === selected);
    node.classList.toggle('is-hovered', stage === hovered);
    node.setAttribute('aria-current', stage === active ? 'step' : 'false');
    node.setAttribute('aria-pressed', stage === selected ? 'true' : 'false');
  });
  root.querySelectorAll('[data-loop-edge]').forEach(edge => {
    edge.classList.toggle('is-current', edge.dataset.from === active || edge.dataset.to === active);
    edge.classList.toggle('is-inspected', Boolean(hovered && (edge.dataset.from === hovered || edge.dataset.to === hovered)));
  });
  root.querySelectorAll('.loop-edge-signal').forEach(edge => edge.classList.toggle('is-leading', edge.dataset.from === active));
  const count = root.querySelector('[data-loop-count]');
  const duration = root.querySelector('[data-loop-duration]');
  if (count) count.textContent = String(runtime.actionsToday || 0) + ' acts today';
  if (duration) {
    duration.textContent = active === 'rest'
      ? 'next wake ' + (runtime.nextAllowedWake ? countdown(runtime.nextAllowedWake) : 'starting locally')
      : active + ' · ' + (runtime.stale ? 'waiting for data' : formatEasternRelativeTime(lastEntered(active)));
  }
  const button = root.querySelector('[data-loop-replay]');
  if (button) button.disabled = !latestCycleStages().length || replay;
  const label = root.querySelector('[data-replay-label]');
  if (label) label.textContent = replay ? 'visual replay' : '';
  const hint = root.querySelector('.loop-hover');
  if (hint) {
    hint.hidden = !hovered;
    if (hovered) hint.textContent = hovered + ' · ' + hints[hovered];
  }
  const panel = root.querySelector('.loop-detail');
  if (panel) {
    panel.hidden = !selected;
    if (selected) panel.innerHTML = detail(selected);
  }
  paintLinkedTable(root, hovered || selected);
}

function replayLast() {
  const stageFor = type => type === 'snapshot' ? 'look' : type === 'decision' ? 'weigh' : type;
  const sequence = latestCycleStages().map(record => stageFor(record.type)).filter(stage => stages.includes(stage)).filter((stage,index,list) => index === 0 || list[index-1] !== stage);
  if (!sequence.length || replay) return;
  let index = 0;
  const advance = () => {
    replay = sequence[index];
    document.querySelectorAll('.loop-viewer').forEach(paint);
    index += 1;
    if (index < sequence.length) setTimeout(advance, 450);
    else setTimeout(() => { replay = false; document.querySelectorAll('.loop-viewer').forEach(paint); }, 450);
  };
  advance();
}

export function bindLoops() {
  document.querySelectorAll('.loop-viewer').forEach(root => {
    if (root.dataset.loopLarge === 'true' && !root.querySelector('.loop-hover')) {
      const hint = document.createElement('div');
      hint.className = 'loop-hover t-meta';
      hint.hidden = true;
      root.append(hint);
    }
    root.querySelectorAll('[data-loop-node]').forEach(node => {
      const stage = node.dataset.loopNode;
      const hover = () => { root.dataset.loopHover = stage; paint(root); };
      const leave = () => { delete root.dataset.loopHover; paint(root); };
      node.addEventListener('mouseenter', hover);
      node.addEventListener('mouseleave', leave);
      node.addEventListener('focus', hover);
      node.addEventListener('blur', leave);
      const select = () => {
        selected = stage;
        delete root.dataset.loopHover;
        paint(root);
      };
      node.addEventListener('click', select);
      node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
    });
    root.querySelector('[data-loop-replay]')?.addEventListener('click', replayLast);
    paint(root);
  });
}

setInterval(() => document.querySelectorAll('.loop-viewer').forEach(paint), 1000);
