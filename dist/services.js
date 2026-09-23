import { REFRESH_CONFIG } from "/config.js";

const CACHE_KEY = "soryn.solana-snapshot.v1";
const MARKET_CACHE_KEY = "soryn.solana-market.v1";
let latestObservation = null;

export function getObservation() { return globalThis.__sorynObservation || latestObservation; }

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); }
  catch { return null; }
}

function writeCache(value) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)); } catch {}
}

function readMarketCache() {
  try { return JSON.parse(localStorage.getItem(MARKET_CACHE_KEY) || "null"); }
  catch { return null; }
}

function writeMarketCache(value) {
  try { localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(value)); } catch {}
}

function usableMarket(value) {
  return Boolean(value && Array.isArray(value.assets) && value.assets.length && Number(value.quoteCount ?? value.quotedTokens ?? 0) > 0);
}

function usableNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function retainExternalReferences(current, saved) {
  const fresh = Array.isArray(current) ? current : [];
  const old = Array.isArray(saved?.externalSignals) ? saved.externalSignals : [];
  const freshBySymbol = new Map(fresh.map(item => [item.symbol, item]));
  const oldBySymbol = new Map(old.map(item => [item.symbol, item]));
  let usedSaved = false;
  const values = ["BTC", "ETH", "SOL"].map(symbol => {
    const next = freshBySymbol.get(symbol);
    const previous = oldBySymbol.get(symbol);
    if (!previous) return next || null;
    const priceMissing = !usableNumber(next?.price);
    const moveMissing = !usableNumber(next?.dailyMovePct);
    if (!priceMissing && !moveMissing) return next;
    if (!usableNumber(previous.price) && !usableNumber(previous.dailyMovePct)) return next || null;
    usedSaved = true;
    return {
      ...previous,
      ...next,
      price: priceMissing ? previous.price : next.price,
      dailyMovePct: moveMissing ? previous.dailyMovePct : next.dailyMovePct,
      lastUpdated: priceMissing || moveMissing ? (previous.lastUpdated || saved?.timestamp || null) : next.lastUpdated,
      status: "stale",
      source: [next?.source || previous.source, "saved browser observation"].filter(Boolean).join(" · ")
    };
  }).filter(Boolean);
  return { values, usedSaved };
}

function pinConfiguredProject(market, incoming) {
  const config = incoming?.projectTokenConfig;
  const mint = config?.mint;
  if (!market || !config) return market;
  const assets = Array.isArray(market.assets) ? market.assets : [];
  if (!mint) {
    const withoutOldProject = assets.filter(item => !item.project);
    return { ...market, projectToken: null, assets: withoutOldProject, universeSize: withoutOldProject.length };
  }
  const project = incoming.market?.projectToken ||
    assets.find(item => item.mint === mint) ||
    { mint, symbol: "SORYN", project: true, marketDataStatus: "indexing", price: null, liquidityUsd: null };
  const remaining = assets.filter(item => item.mint !== mint && !item.project);
  return {
    ...market,
    projectToken: { ...project, project: true },
    assets: [{ ...project, project: true }, ...remaining],
    universeSize: Math.max(Number(market.universeSize) || 0, remaining.length + 1)
  };
}

function walletValuedWithMarket(wallet, market, previousWallet, walletObserved) {
  if (!wallet) return wallet;
  const finite = value => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  const prices = new Map((market?.assets || []).filter(item => item?.mint).map(item => [item.mint, finite(item.price)]));
  for (const item of previousWallet?.positions || []) {
    if (item?.mint && !prices.has(item.mint)) prices.set(item.mint, finite(item.price));
  }
  const positions = (wallet.positions || []).map(item => {
    const price = prices.has(item.mint) ? prices.get(item.mint) : finite(item.price);
    const balance = finite(item.balance);
    return {
      ...item,
      price,
      valueUsd: balance === 0 ? 0 : balance === null || price === null ? null : balance * price
    };
  });
  const solBalance = finite(wallet.solBalance);
  const solPrice = finite(market?.nativeSolPrice);
  const nativeValueUsd = solBalance === 0 ? 0 : solBalance === null || solPrice === null ? null : solBalance * solPrice;
  const values = [nativeValueUsd, ...positions.map(item => item.valueUsd)].filter(Number.isFinite);
  const complete = Boolean(walletObserved) && solBalance !== null &&
    !(solBalance !== 0 && nativeValueUsd === null) &&
    !positions.some(item => finite(item.balance) !== 0 && item.valueUsd === null);
  const knownPortfolioUsd = walletObserved && values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  return {
    ...wallet,
    positions,
    nativeValueUsd,
    knownPortfolioUsd,
    portfolioUsd: complete ? (knownPortfolioUsd ?? 0) : null,
    valuationComplete: complete,
    valuationSource: "stale market fallback",
    valuationSourceTimestamp: market?.sourceTimestamp || null
  };
}

// The API is read-only; saved browser values are display fallbacks with stale status.
export async function fetchObservation() {
  const saved = readCache();
  try {
    const fetchStartedAt = new Date().toISOString();
    const fetchStarted = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try { response = await fetch("/api/agent", { signal: controller.signal, cache: "no-store" }); }
    finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`api ${response.status}`);
    const data = await response.json();
    const fetchCompletedAt = new Date().toISOString();
    const sourceStatus = { ...(data.sourceStatus || {}) };
    let market = data.market;
    let marketFallback = false;
    const marketFailed = sourceStatus.market === "unavailable" || !usableMarket(market);
    // Reuse a previously quoted market only with its stale source status intact.
    if (marketFailed) {
      const cachedMarket = readMarketCache();
      const lastGoodMarket = usableMarket(cachedMarket) ? cachedMarket : (saved?.sourceStatus?.market === "live" && usableMarket(saved.market) ? saved.market : null);
      if (lastGoodMarket) {
        market = lastGoodMarket;
        sourceStatus.market = "stale";
        marketFallback = true;
      } else {
        sourceStatus.market = "unavailable";
      }
    } else if (sourceStatus.market === "live") {
      writeMarketCache(market);
    }
    market = pinConfiguredProject(market, data);
    const external = retainExternalReferences(data.externalSignals, saved);
    if (external.usedSaved) sourceStatus.external = "stale";
    const wallet = marketFallback ? walletValuedWithMarket(data.wallet, market, saved?.wallet, sourceStatus.wallet === "live") : data.wallet;
    const sourceHealth = { ...(data.sourceHealth || {}) };
    if (marketFallback) {
      for (const key of ["jupiter", "jupiter-tokens", "jupiter-prices"]) {
        if (!sourceHealth[key]) continue;
        sourceHealth[key] = {
          ...sourceHealth[key],
          status: "stale",
          error: [sourceHealth[key].error, "using last saved market snapshot"].filter(Boolean).join(" · ")
        };
      }
    } else if (sourceStatus.market === "unavailable" && sourceHealth.jupiter) {
      sourceHealth.jupiter = {
        ...sourceHealth.jupiter,
        status: "unavailable",
        lastSuccess: null,
        error: [sourceHealth.jupiter.error, "no usable current or saved market snapshot"].filter(Boolean).join(" · ")
      };
    }
    const criticalStale = ["chain", "wallet", "market"].some(key => sourceStatus[key] !== "live");
    const cycleCritical = {
      ...(data.cycleCritical || {}),
      chain: sourceStatus.chain,
      wallet: sourceStatus.wallet,
      market: sourceStatus.market,
      ready: !criticalStale
    };
    const fresh = {
      ...data,
      market,
      wallet,
      externalSignals: external.values,
      sourceStatus,
      sourceHealth,
      cycleCritical,
      stale: Boolean(data.stale) || criticalStale || marketFallback,
      marketFallback,
      externalFallback: external.usedSaved,
      receivedAt: fetchCompletedAt,
      clientFetchStartedAt: fetchStartedAt,
      clientFetchCompletedAt: fetchCompletedAt,
      clientLatencyMs: Math.round(performance.now() - fetchStarted)
    };
    writeCache(fresh);
    latestObservation = fresh;
    globalThis.__sorynObservation = fresh;
    return fresh;
  } catch (error) {
    if (saved) {
      const sourceStatus = Object.fromEntries(Object.entries(saved.sourceStatus || {}).map(([key,status]) => [key,status === "unavailable" ? "unavailable" : "stale"]));
      const sourceHealth = Object.fromEntries(Object.entries(saved.sourceHealth || {}).map(([key,value]) => [key,{
        ...value,
        status:value?.status === "unavailable" ? "unavailable" : "stale",
        error:["saved snapshot",error.message].filter(Boolean).join(" · ")
      }]));
      const cycleCritical = {
        ...(saved.cycleCritical || {}),
        chain: sourceStatus.chain,
        wallet: sourceStatus.wallet,
        market: sourceStatus.market,
        ready: false
      };
      latestObservation = { ...saved, stale: true, sourceStatus, sourceHealth, cycleCritical, error: error.message, fallback: "saved snapshot" };
      globalThis.__sorynObservation = latestObservation;
      return latestObservation;
    }
    latestObservation = {
      timestamp: new Date().toISOString(), stale: true, error: error.message,
      sourceStatus: { chain: "unavailable", market: "unavailable", wallet: "unavailable", external: "unavailable", transactions: "unavailable" },
      chain: null, wallet: null, market: { assets: [], quoteCount: 0 }, externalSignals: [], lastTransaction: null
    };
    globalThis.__sorynObservation = latestObservation;
    return latestObservation;
  }
}

// Polling runs only while a page keeps this feed active.
export function startObservationFeed(onData) {
  let stopped = false;
  let busy = false;
  const run = async () => {
    if (stopped || busy) return;
    busy = true;
    try { const data = await fetchObservation(); if (!stopped) onData(data); }
    finally { busy = false; }
  };
  run();
  const refreshMs = Math.max(25000, Number(REFRESH_CONFIG.marketMs) || 25000);
  const timer = setInterval(run, refreshMs);
  return () => { stopped = true; clearInterval(timer); };
}
