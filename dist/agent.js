import { AGENT_WALLET, EXECUTION_MODE, GENESIS_CONFIG, PERSISTENCE_MODE } from './config.js';
import { weigh } from './weigh.js';

// Cycles, decisions, and paper positions are local to this browser profile.
const KEYS = Object.freeze({
  state: 'soryn.solana.v1.agent-state',
  records: 'soryn.solana.v1.agent-record',
  snapshots: 'soryn.solana.v1.agent-snapshots',
  history: 'soryn.solana.v1.observation-history',
  cycles: 'soryn.solana.v1.agent-cycles',
  paper: 'soryn.solana.v1.paper-positions',
  lock: 'soryn.solana.v1.agent-cycle-lock',
  lastWakeAt: 'soryn.solana.v1.lastWakeAt'
});
const MAX_RECORDS = 1000;
const MAX_SNAPSHOTS = 2;
const MAX_HISTORY = 40;
const MAX_CYCLES = 100;
const MAX_PAPER_POSITIONS = 100;
const MAX_STORED_CANDIDATES = 24;
const MIN_WAKE_MS = GENESIS_CONFIG.minMinutesBetweenActs * 60 * 1000;
const STAGE_DELAY_MS = 180;
const SOFTWARE_VERSION = 'soryn-browser 1.0.0';

const read = (key,fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
};
const write = (key,value) => {
  try { localStorage.setItem(key,JSON.stringify(value)); } catch {}
};
const list = (key) => {
  const value = read(key,[]);
  return Array.isArray(value) ? value : [];
};
const clone = value => JSON.parse(JSON.stringify(value));
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
const randomId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

function compactCandidate(candidate) {
  if (!candidate) return candidate;
  return {
    mint:candidate.mint ?? null,
    symbol:candidate.symbol ?? null,
    action:candidate.action,
    score:candidate.score,
    noise:candidate.noise,
    price:candidate.price,
    change24h:candidate.change24h,
    buyVolume:candidate.buyVolume,
    sellVolume:candidate.sellVolume,
    traders:candidate.traders,
    quoteAt:candidate.quoteAt || null,
    liquidityUsd:candidate.liquidityUsd,
    held:Boolean(candidate.held),
    halted:Boolean(candidate.halted),
    eligible:Boolean(candidate.eligible),
    reason:candidate.reason,
    components:candidate.components || {}
  };
}

function decisionForStorage(decision,includeCandidates = true,candidateLimit = MAX_STORED_CANDIDATES) {
  if (!decision) return null;
  const stored = {
    ...decision,
    chosen:compactCandidate(decision.chosen),
    bestCandidate:compactCandidate(decision.bestCandidate),
    runnerUp:compactCandidate(decision.runnerUp),
    candidateCount:decision.candidateCount ?? decision.candidates?.length ?? 0
  };
  if (includeCandidates) stored.candidates=(decision.candidates || []).slice(0,candidateLimit).map(compactCandidate);
  else delete stored.candidates;
  return stored;
}

function compactAsset(asset) {
  return {
    mint:asset.mint,
    symbol:asset.symbol,
    name:asset.name,
    tokenProgram:asset.tokenProgram,
    price:asset.price,
    change24h:asset.change24h ?? asset.dailyMovePct,
    liquidityUsd:asset.liquidityUsd,
    marketCap:asset.marketCap,
    fdv:asset.fdv,
    holderCount:asset.holderCount,
    holderConcentration:asset.holderConcentration,
    organicScore:asset.organicScore,
    verified:asset.verified == null ? null : Boolean(asset.verified),
    buyVolume:asset.buyVolume,
    sellVolume:asset.sellVolume,
    buys:asset.buys,
    sells:asset.sells,
    traders:asset.traders,
    feeds:Array.isArray(asset.feeds) ? asset.feeds : [],
    lastUpdate:asset.lastUpdate,
    halted:Boolean(asset.halted),
    status:asset.status,
    quoteAt:asset.quoteAt,
    source:asset.source
  };
}

function easternParts(value = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-US',{
    timeZone:'America/New_York',
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    second:'2-digit',
    hourCycle:'h23'
  }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value || '00';
  return {year:get('year'),month:get('month'),day:get('day'),hour:get('hour'),minute:get('minute'),second:get('second')};
}

function easternDay(value = Date.now()) {
  const part = easternParts(value);
  return `${part.year}-${part.month}-${part.day}`;
}

function makeCycleId(now = Date.now()) {
  const part = easternParts(now);
  return `sor_${part.year}${part.month}${part.day}_${part.hour}${part.minute}${part.second}_${randomId().replaceAll('-','').slice(0,8).toLowerCase()}`;
}

function makeSnapshotId(now = Date.now()) {
  return `snap_${now.toString(36)}_${randomId().replaceAll('-','').slice(0,8).toLowerCase()}`;
}

let records = list(KEYS.records).slice(0,MAX_RECORDS);
let fullSnapshots = list(KEYS.snapshots).slice(0,MAX_SNAPSHOTS);
let observationHistory = list(KEYS.history).slice(0,MAX_HISTORY);
let cycles = list(KEYS.cycles).slice(0,MAX_CYCLES);
let paperPositions = list(KEYS.paper).slice(0,MAX_PAPER_POSITIONS);
let listeners = [];
let latestObservation = null;
let activeCycle = null;

const savedState = read(KEYS.state,{});
const storedWake = savedState.lastWakeAt || localStorage.getItem(KEYS.lastWakeAt) || null;
const genesisAt = savedState.genesisAt || new Date().toISOString();
let runtime = {
  agent:'soryn',
  agentNumber:'01',
  wallet:AGENT_WALLET,
  currentState:'rest',
  agentState:'rest',
  cycleId:savedState.cycleId || null,
  lastWakeAt:storedWake,
  lastActAt:savedState.lastActAt || null,
  updatedAt:savedState.updatedAt || genesisAt,
  nextAllowedWake:storedWake ? new Date(new Date(storedWake).getTime()+MIN_WAKE_MS).toISOString() : null,
  actionsToday:0,
  actsToday:0,
  totalActs:0,
  executionMode:EXECUTION_MODE,
  latestDecision:savedState.latestDecision || null,
  latestSnapshotId:savedState.latestSnapshotId || null,
  runtime:'local',
  schedulerStatus:'browser',
  persistenceMode:PERSISTENCE_MODE,
  stale:true,
  genesisAt,
  genesisHash:savedState.genesisHash || null,
  genesisConfig:GENESIS_CONFIG,
  softwareVersion:SOFTWARE_VERSION
};

function countActs(day = easternDay()) {
  return records.filter(record => record.type === 'act' && easternDay(record.timestamp) === day).length;
}

function refreshCounts() {
  runtime.actionsToday = countActs();
  runtime.actsToday = runtime.actionsToday;
  runtime.totalActs = records.filter(record => record.type === 'act').length;
}

function persistRuntime() {
  refreshCounts();
  write(KEYS.state,{
    cycleId:runtime.cycleId,
    lastWakeAt:runtime.lastWakeAt,
    lastActAt:runtime.lastActAt,
    updatedAt:runtime.updatedAt,
    latestDecision:decisionForStorage(runtime.latestDecision,true,Number.POSITIVE_INFINITY),
    latestSnapshotId:runtime.latestSnapshotId,
    genesisAt:runtime.genesisAt,
    genesisHash:runtime.genesisHash
  });
  if (runtime.lastWakeAt) {
    try { localStorage.setItem(KEYS.lastWakeAt,runtime.lastWakeAt); } catch {}
  }
}

function persistCollections() {
  records = records.slice(0,MAX_RECORDS);
  fullSnapshots = fullSnapshots.slice(0,MAX_SNAPSHOTS);
  observationHistory = observationHistory.slice(0,MAX_HISTORY);
  cycles = cycles.slice(0,MAX_CYCLES);
  paperPositions = paperPositions.slice(0,MAX_PAPER_POSITIONS);
  write(KEYS.records,records);
  write(KEYS.snapshots,fullSnapshots);
  write(KEYS.history,observationHistory);
  write(KEYS.cycles,cycles);
  write(KEYS.paper,paperPositions);
  persistRuntime();
}

function notify() {
  const value = getRuntime();
  for (const listener of listeners) {
    try { listener(value); } catch {}
  }
}

function addRecord(type,text,fields = {}) {
  const timestamp = fields.timestamp || new Date().toISOString();
  const record = {
    id:`local_${Date.now().toString(36)}_${randomId().slice(0,6)}`,
    timestamp,
    cycleId:runtime.cycleId,
    type,
    state:fields.state || type,
    text,
    symbol:fields.symbol || null,
    venue:fields.venue || null,
    usd:fields.usd ?? null,
    score:fields.score ?? null,
    result:fields.result ?? null,
    reason:fields.reason ?? null,
    snapshotId:fields.snapshotId || runtime.latestSnapshotId || null,
    executionMode:EXECUTION_MODE,
    signature:null,
    metadata:fields.metadata || {}
  };
  records.unshift(record);
  persistCollections();
  return record;
}

async function setPhase(phase,text,fields = {}) {
  runtime.currentState = phase;
  runtime.agentState = phase;
  runtime.updatedAt = new Date().toISOString();
  const record = addRecord(fields.type || phase,text,{...fields,state:phase});
  notify();
  await delay(STAGE_DELAY_MS);
  return record;
}

function sourceCounts(observation) {
  const sources = Object.values(observation?.sourceHealth || {});
  return {healthy:sources.filter(source => source.status === 'live').length,total:sources.length};
}

function claimCycle(now) {
  const existing = read(KEYS.lock,null);
  if (existing?.expiresAt > now) return null;
  const token = randomId();
  write(KEYS.lock,{token,expiresAt:now+30000});
  return read(KEYS.lock,null)?.token === token ? token : null;
}

function releaseCycle(token) {
  const existing = read(KEYS.lock,null);
  if (existing?.token !== token) return;
  try { localStorage.removeItem(KEYS.lock); } catch {}
}

function cycleDue(now = Date.now()) {
  const last = runtime.lastWakeAt ? new Date(runtime.lastWakeAt).getTime() : 0;
  return !last || !Number.isFinite(last) || now-last >= MIN_WAKE_MS;
}

// Capture one received public observation for a cycle before weighing candidates.
function snapshotFromObservation(observation,snapshotId,cycleId) {
  const value = observation || {};
  const market = value.market || {};
  return {
    id:snapshotId,
    cycleId,
    createdAt:value.timestamp || new Date().toISOString(),
    timestamp:value.timestamp || new Date().toISOString(),
    fetchStartedAt:value.fetchStartedAt || null,
    fetchCompletedAt:value.fetchCompletedAt || null,
    latencyMs:value.latencyMs ?? null,
    executionMode:'simulation',
    stale:Boolean(value.stale),
    chain:clone(value.chain || {}),
    wallet:clone(value.wallet || {}),
    market:{
      assets:(market.assets || []).map(compactAsset),
      external:clone(value.externalSignals || market.external || []),
      quoteCount:market.quoteCount ?? market.assets?.length ?? 0,
      universeSize:market.universeSize ?? market.assets?.length ?? 0,
      counts:clone(market.counts || {}),
      endpoints:clone(market.endpoints || []),
      sourceTimestamp:market.sourceTimestamp || value.timestamp || null
    },
    tokenUniverse:(market.assets || []).map(compactAsset),
    prices:(market.assets || []).map(asset => ({ mint:asset.mint, symbol:asset.symbol, price:asset.price, change24h:asset.change24h ?? asset.dailyMovePct, quoteAt:asset.quoteAt || null })),
    liquidity:(market.assets || []).map(asset => ({ mint:asset.mint, symbol:asset.symbol, liquidityUsd:asset.liquidityUsd })),
    marketActivity:(market.assets || []).map(asset => ({ mint:asset.mint, symbol:asset.symbol, buyVolume:asset.buyVolume, sellVolume:asset.sellVolume, buys:asset.buys, sells:asset.sells, traders:asset.traders })),
    decisionInputs:{ externalSignals:clone(value.externalSignals || []), wallet:clone(value.wallet || {}), chain:clone(value.chain || {}), sourceStatus:clone(value.sourceStatus || {}), rules:clone(GENESIS_CONFIG) },
    lastTransaction:clone(value.lastTransaction || null),
    sourceStatus:clone(value.sourceStatus || {}),
    sourceHealth:clone(value.sourceHealth || {}),
    externalSignals:clone(value.externalSignals || market.external || []),
    metadata:{
      sourceHealth:clone(value.sourceHealth || {}),
      sourceStatus:clone(value.sourceStatus || {}),
      capturedBy:'browser',
      persistence:'local'
    }
  };
}

function historyFromSnapshot(snapshot,decision) {
  const compactHistoryAsset = asset => {
    const candidate = (decision?.candidates || []).find(value => asset.mint && value.mint
      ? value.mint === asset.mint
      : !asset.mint && !value.mint && value.symbol === asset.symbol);
    return {
      mint:asset.mint,
      symbol:asset.symbol,
      price:asset.price,
      change24h:asset.change24h ?? asset.dailyMovePct,
      liquidityUsd:asset.liquidityUsd,
      buyVolume:asset.buyVolume,
      sellVolume:asset.sellVolume,
      traders:asset.traders,
      feeds:Array.isArray(asset.feeds) ? asset.feeds : [],
      candidateScore:candidate?.score ?? null,
      candidateEligible:candidate?.eligible ?? null,
      candidateReason:candidate?.reason ?? null
    };
  };
  return {
    id:snapshot.id,
    cycleId:snapshot.cycleId,
    createdAt:snapshot.createdAt,
    timestamp:snapshot.timestamp,
    chain:{slot:snapshot.chain?.slot ?? null,blockHeight:snapshot.chain?.blockHeight ?? null},
    wallet:{
      solBalance:snapshot.wallet?.solBalance ?? snapshot.wallet?.nativeBalance ?? null,
      nativeBalance:snapshot.wallet?.nativeBalance ?? snapshot.wallet?.solBalance ?? null,
      nativeValueUsd:snapshot.wallet?.nativeValueUsd ?? null,
      portfolioUsd:snapshot.wallet?.portfolioUsd ?? null,
      positions:(snapshot.wallet?.positions || []).map(position => ({
        mint:position.mint,
        symbol:position.symbol,
        balance:position.balance,
        valueUsd:position.valueUsd
      }))
    },
    market:{
      assets:(snapshot.market?.assets || []).map(compactHistoryAsset),
      universeSize:snapshot.market?.universeSize ?? snapshot.market?.assets?.length ?? 0,
      counts:clone(snapshot.market?.counts || {})
    },
    decision:decisionForStorage(decision,true,MAX_STORED_CANDIDATES)
  };
}

function updatePaperMarks(observation) {
  const prices = new Map((observation?.market?.assets || []).map(asset => [asset.mint || asset.symbol,Number(asset.price)]));
  let changed = false;
  paperPositions = paperPositions.map(position => {
    const price = prices.get(position.mint || position.symbol);
    if (!Number.isFinite(price) || price === position.currentPrice) return position;
    changed = true;
    return {...position,currentPrice:price,updatedAt:observation.timestamp || new Date().toISOString()};
  });
  if (changed) write(KEYS.paper,paperPositions);
}

// Paper positions use observed quotes; they never alter the RPC wallet holdings.
function openPaperPosition(decision,snapshotId) {
  const chosen = decision.chosen;
  const price = Number(chosen?.price);
  const usdValue = Number(decision.notionalUsd);
  if (!chosen?.symbol || !['buy','sell'].includes(chosen.action) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(usdValue) || usdValue <= 0) return null;
  const position = {
    id:`paper_${randomId()}`,
    mint:chosen.mint || null,
    symbol:chosen.symbol,
    side:chosen.action,
    entryPrice:price,
    currentPrice:price,
    quantity:usdValue/price,
    usdValue,
    openedAt:new Date().toISOString(),
    cycleId:runtime.cycleId,
    snapshotId,
    executionMode:'simulation'
  };
  paperPositions.unshift(position);
  return position;
}

// A guarded wake records each phase and at most one simulated act, then returns to rest.
async function runCycle(observation,token) {
  const started = Date.now();
  const cycleId = makeCycleId(started);
  const snapshotId = makeSnapshotId(started);
  runtime.cycleId = cycleId;
  runtime.lastWakeAt = new Date(started).toISOString();
  runtime.nextAllowedWake = new Date(started+MIN_WAKE_MS).toISOString();
  await setPhase('wake','wake stage entered',{result:'started',source:'browser timer'});
  await setPhase('look','look stage entered',{result:'public observation received'});

  const snapshot = snapshotFromObservation(observation,snapshotId,cycleId);
  fullSnapshots.unshift(snapshot);
  runtime.latestSnapshotId = snapshotId;
  addRecord('snapshot','unified observation saved',{state:'look',snapshotId,result:'saved locally',metadata:{snapshotId,sourceStatus:observation.sourceStatus || {}}});
  notify();
  await delay(STAGE_DELAY_MS);

  await setPhase('weigh','weigh stage entered',{snapshotId,result:'candidates scored'});
  let decision = weigh(snapshot);
  if (decision.chosen?.action !== 'do nothing' && countActs() >= GENESIS_CONFIG.maxActsPerDay) {
    decision = {...decision,chosen:{symbol:null,action:'do nothing',score:0,eligible:true},reason:'daily act cap reached'};
  }
  decision = {...decision,cycleId,snapshotId};
  runtime.latestDecision = decision;
  snapshot.decision = decisionForStorage(decision,true,Number.POSITIVE_INFINITY);
  observationHistory.unshift(historyFromSnapshot(snapshot,decision));
  const chosenText = decision.chosen.action === 'do nothing' ? 'do nothing chosen' : `${decision.chosen.action} ${decision.chosen.symbol} chosen`;
  addRecord('decision',chosenText,{
    state:'weigh',
    snapshotId,
    symbol:decision.chosen.symbol,
    score:decision.chosen.score,
    result:decision.chosen.action,
    reason:decision.reason,
    metadata:decisionForStorage(decision,false)
  });
  notify();
  await delay(STAGE_DELAY_MS);

  let paperPosition = null;
  if (decision.chosen.action !== 'do nothing') {
    paperPosition = openPaperPosition(decision,snapshotId);
    if (paperPosition) {
      runtime.lastActAt = paperPosition.openedAt;
      await setPhase('act',`${paperPosition.side} ${paperPosition.symbol} simulated`,{
        snapshotId,
        symbol:paperPosition.symbol,
        venue:'paper',
        usd:paperPosition.usdValue,
        result:'simulation',
        reason:decision.reason,
        metadata:{paperPositionId:paperPosition.id}
      });
    }
  }

  const rest = await setPhase('rest','went back to sleep',{
    result:'completed',
    reason:paperPosition ? 'simulated paper position recorded' : decision.reason,
    snapshotId
  });
  const counts = sourceCounts(observation);
  const cycleRecords = records.filter(record => record.cycleId === cycleId).sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
  cycles.unshift({
    id:cycleId,
    startedAt:runtime.lastWakeAt,
    completedAt:rest.timestamp,
    durationMs:Date.now()-started,
    status:'completed',
    trigger:'browser',
    executionMode:'simulation',
    snapshotId,
    result:decision.chosen.action,
    recordCount:cycleRecords.length,
    sourcesHealthy:counts.healthy,
    sourcesTotal:counts.total,
    decision:decisionForStorage(decision),
    records:cycleRecords
  });
  persistCollections();
  notify();
  releaseCycle(token);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}

async function ensureGenesisHash() {
  if (!globalThis.crypto?.subtle) return;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(canonical(GENESIS_CONFIG)));
    const digest = await crypto.subtle.digest('SHA-256',bytes);
    const nextHash = '0x' + [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2,'0')).join('');
    if (runtime.genesisHash !== nextHash) {
      runtime.genesisHash = nextHash;
      persistRuntime();
      notify();
    }
  } catch {}
}

function reloadLocalState() {
  records = list(KEYS.records).slice(0,MAX_RECORDS);
  fullSnapshots = list(KEYS.snapshots).slice(0,MAX_SNAPSHOTS);
  observationHistory = list(KEYS.history).slice(0,MAX_HISTORY);
  cycles = list(KEYS.cycles).slice(0,MAX_CYCLES);
  paperPositions = list(KEYS.paper).slice(0,MAX_PAPER_POSITIONS);
  const state = read(KEYS.state,{});
  runtime = {
    ...runtime,
    cycleId:state.cycleId || runtime.cycleId,
    lastWakeAt:state.lastWakeAt || runtime.lastWakeAt,
    lastActAt:state.lastActAt || runtime.lastActAt,
    updatedAt:state.updatedAt || runtime.updatedAt,
    latestDecision:state.latestDecision || runtime.latestDecision,
    latestSnapshotId:state.latestSnapshotId || runtime.latestSnapshotId,
    genesisAt:state.genesisAt || runtime.genesisAt,
    genesisHash:state.genesisHash || runtime.genesisHash,
    currentState:'rest',
    agentState:'rest'
  };
  runtime.nextAllowedWake = runtime.lastWakeAt ? new Date(new Date(runtime.lastWakeAt).getTime()+MIN_WAKE_MS).toISOString() : null;
  refreshCounts();
}

export function getRecord() { return records; }
export function getSnapshots() { return observationHistory.length ? observationHistory : fullSnapshots; }
export function getCycles() { return cycles; }
export function getWalletSnapshots() {
  const source = observationHistory.length ? observationHistory : fullSnapshots;
  return source.map(snapshot => ({
    id:snapshot.id,
    timestamp:snapshot.createdAt,
    solBalance:snapshot.wallet?.solBalance ?? snapshot.wallet?.nativeBalance ?? null,
    nativeBalance:snapshot.wallet?.solBalance ?? snapshot.wallet?.nativeBalance ?? null,
    nativeValueUsd:snapshot.wallet?.nativeValueUsd ?? null,
    portfolioUsd:snapshot.wallet?.portfolioUsd ?? null,
    positions:snapshot.wallet?.positions || []
  }));
}

function periodStats(days) {
  const cutoff = Date.now()-days*86400000;
  const periodCycles = cycles.filter(cycle => new Date(cycle.startedAt).getTime() >= cutoff);
  const positions = paperPositions.filter(position => new Date(position.openedAt).getTime() >= cutoff);
  const pnl = positions.reduce((sum,position) => {
    const current = Number(position.currentPrice),entry = Number(position.entryPrice),quantity = Number(position.quantity);
    if (![current,entry,quantity].every(Number.isFinite)) return sum;
    return sum + (position.side === 'sell' ? entry-current : current-entry)*quantity;
  },0);
  const simulatedActs = periodCycles.filter(cycle => cycle.result !== 'do nothing').length;
  return {
    cycles:periodCycles.length,
    simulatedActs,
    doNothing:periodCycles.filter(cycle => cycle.result === 'do nothing').length,
    actionRate:periodCycles.length ? simulatedActs/periodCycles.length*100 : null,
    paperPnlUsd:positions.length ? pnl : null
  };
}

export function getPaper() {
  return {
    positions:paperPositions.map(position => {
      const current = Number(position.currentPrice),entry = Number(position.entryPrice),quantity = Number(position.quantity);
      const pnlUsd = [current,entry,quantity].every(Number.isFinite) ? (position.side === 'sell' ? entry-current : current-entry)*quantity : null;
      return {...position,pnlUsd,pnlPct:pnlUsd == null || !position.usdValue ? null : pnlUsd/position.usdValue*100};
    }),
    periods:{'7d':periodStats(7),'30d':periodStats(30)},
    executionMode:'simulation'
  };
}

export function getMemory() {
  const days = new Map();
  for (const record of records) {
    const day = easternDay(record.timestamp);
    const value = days.get(day) || {day,cycles:new Set(),records:0,snapshots:0,actions:0,failures:0,paperPositions:0,decisions:[]};
    if (record.cycleId) value.cycles.add(record.cycleId);
    value.records++;
    if (record.type === 'snapshot') value.snapshots++;
    if (record.type === 'act') value.actions++;
    if (record.type === 'failure') value.failures++;
    if (record.type === 'decision') value.decisions.push(record.result || 'unavailable');
    days.set(day,value);
  }
  for (const position of paperPositions) {
    const value = days.get(easternDay(position.openedAt));
    if (value) value.paperPositions++;
  }
  return [...days.values()].sort((a,b) => b.day.localeCompare(a.day)).map(value => {
    const counts = value.decisions.reduce((map,item) => map.set(item,(map.get(item)||0)+1),new Map());
    const dominantDecision = [...counts.entries()].sort((a,b) => b[1]-a[1])[0]?.[0] || 'unavailable';
    return {...value,cycles:value.cycles.size,dominantDecision,decisions:undefined};
  });
}

export function getCounterfactuals() {
  const chronological = [...(observationHistory.length ? observationHistory : fullSnapshots)].sort((a,b) => new Date(a.createdAt)-new Date(b.createdAt));
  const items = records.filter(record => record.type === 'decision' && record.result === 'do nothing' && record.metadata?.runnerUp && Number.isFinite(Number(record.metadata.runnerUpPrice)) && Number(record.metadata.runnerUpPrice) > 0).map(record => {
    const baseline = Number(record.metadata.runnerUpPrice);
    const at = new Date(record.timestamp).getTime();
    const symbol = record.metadata.runnerUp.symbol;
    const mint = record.metadata.runnerUp.mint || null;
    const results = {};
    for (const [label,hours] of [['1h',1],['6h',6],['24h',24]]) {
      const future = chronological.find(snapshot => new Date(snapshot.createdAt).getTime() >= at+hours*3600000);
      const price = Number(future?.market?.assets?.find(asset => mint ? asset.mint === mint : !asset.mint && asset.symbol === symbol)?.price);
      results[label] = Number.isFinite(price) && price > 0 ? {price,changePct:(price-baseline)/baseline*100,snapshotId:future.id} : {price:null,changePct:null,snapshotId:null};
    }
    return {
      cycleId:record.cycleId,
      runnerUp:record.metadata.runnerUp.action,
      runnerUpScore:record.metadata.runnerUp.score,
      symbol,
      mint,
      baselinePrice:baseline,
      results
    };
  });
  return {
    items,
    summary:{
      evaluated:items.length,
      missedUpside:items.filter(item => Object.values(item.results).some(result => result.changePct > 0)).length,
      avoidedDownside:items.filter(item => Object.values(item.results).some(result => result.changePct < 0)).length
    }
  };
}

export function getRuntime() {
  refreshCounts();
  return {...runtime};
}

export function onStateChange(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(listener => listener !== fn); };
}

export function startAgentFeed() {
  let stopped = false;
  reloadLocalState();
  runtime.stale = latestObservation ? Boolean(latestObservation.stale) : true;
  ensureGenesisHash();
  notify();
  const storageListener = event => {
    if (stopped || !event.key?.startsWith('soryn.')) return;
    reloadLocalState();
    notify();
  };
  addEventListener('storage',storageListener);
  return () => { stopped = true; removeEventListener('storage',storageListener); };
}

// Stale observations can update the display and paper marks, but cannot start a cycle.
export function ingestObservation(observation) {
  latestObservation = observation;
  runtime.stale = Boolean(observation?.stale);
  runtime.wallet = observation?.wallet?.address || AGENT_WALLET;
  updatePaperMarks(observation);
  persistRuntime();
  notify();
  if (!observation || observation.stale || activeCycle || !cycleDue()) return false;
  const token = claimCycle(Date.now());
  if (!token) return false;
  activeCycle = runCycle(observation,token).catch(() => {
    runtime.currentState = 'rest';
    runtime.agentState = 'rest';
    runtime.updatedAt = new Date().toISOString();
    addRecord('failure','browser cycle failed',{state:'rest',result:'failed locally'});
    releaseCycle(token);
    notify();
  }).finally(() => { activeCycle = null; });
  return true;
}

globalThis.__sorynLocalRuntime = {keys:KEYS,persistenceMode:PERSISTENCE_MODE,executionMode:EXECUTION_MODE};
