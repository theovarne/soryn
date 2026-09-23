import { agentAddress, jupiterApiKey, rpcUrl, NETWORK } from './settings.js';
import { readProjectTokenMint } from './project-token-config.js';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const NATIVE_SOL_PRICE_MINT = 'So11111111111111111111111111111111111111112';
const SOLANA_EXPLORER = 'https://explorer.solana.com';
const SOLSCAN = 'https://solscan.io';
const JUPITER_BASE = process.env.JUPITER_API_BASE || (jupiterApiKey() ? 'https://api.jup.ag' : 'https://lite-api.jup.ag');
const JUPITER_FALLBACK = JUPITER_BASE === 'https://api.jup.ag' && jupiterApiKey() ? 'https://lite-api.jup.ag' : null;
const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true';
const JUPITER_REQUEST_BUDGET_MS = 7000;
const requestCache = new Map();
let activeRpcEndpoint = null;
let jupiterGate = Promise.resolve();
let jupiterNextRequestAt = 0;
const asNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const firstNumber = (...values) => {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
};
const nowIso = () => new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const earlierTimestamp = (first, second) => {
  if (!first) return second || null;
  if (!second) return first;
  const left = new Date(first).getTime();
  const right = new Date(second).getTime();
  return Number.isFinite(left) && Number.isFinite(right) ? (left <= right ? first : second) : first;
};

async function reserveJupiterRequest() {
  const configured = asNumber(process.env.JUPITER_MIN_INTERVAL_MS);
  const intervalMs = configured === null ? (jupiterApiKey() ? 1050 : 2100) : Math.max(0, configured);
  let release;
  const previous = jupiterGate;
  jupiterGate = new Promise(resolve => { release = resolve; });
  await previous;
  const waitMs = Math.max(0, jupiterNextRequestAt - Date.now());
  if (waitMs) await sleep(waitMs);
  jupiterNextRequestAt = Date.now() + intervalMs;
  release();
}

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 8000);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function getJson(url, options, ms) {
  const timeout = timeoutSignal(ms || 8000);
  try {
    const opts = options || {};
    const response = await fetch(url, {
      ...opts,
      headers: { accept: 'application/json', 'user-agent': 'soryn-solana/1.0', ...(opts.headers || {}) },
      signal: timeout.signal
    });
    if (!response.ok) throw new Error(String(response.status) + ' ' + response.statusText);
    return await response.json();
  } finally {
    timeout.cancel();
  }
}

// Read-only RPC calls try configured endpoints in order; failures do not invent results.
async function rpcCall(method, params) {
  const endpoints = [rpcUrl()].concat(String(process.env.SOLANA_RPC_FALLBACK_URLS || '').split(',')).map(value => value.trim()).filter((value, index, list) => value && list.indexOf(value) === index);
  let lastError;
  for (const endpoint of endpoints) {
    try {
      const body = await getJson(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: String(Date.now()) + '-' + method, method, params: params || [] })
      }, 9000);
      if (body && body.error) throw new Error(method + ': ' + (body.error.message || 'rpc error'));
      if (!body || !Object.prototype.hasOwnProperty.call(body, 'result')) throw new Error(method + ': missing result');
      activeRpcEndpoint = endpoint;
      return body.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(method + ': rpc unavailable');
}

async function observed(id, label, endpoint, usedBy, operation) {
  const started = performance.now();
  const checkedAt = nowIso();
  try {
    const value = await operation();
    const completedAt = nowIso();
    return { value, health: { id, label, endpoint, usedBy, status: 'live', latencyMs: Math.round(performance.now() - started), checkedAt: completedAt, lastSuccess: completedAt, error: null } };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    return { value: null, error: message, health: { id, label, endpoint, usedBy, status: 'unavailable', latencyMs: Math.round(performance.now() - started), checkedAt, lastSuccess: null, error: message } };
  }
}

const commitment = { commitment: NETWORK.commitment || 'confirmed' };

async function chainData() {
  const methods = [
    ['slot', 'getSlot', [commitment]],
    ['blockHeight', 'getBlockHeight', [commitment]],
    ['epoch', 'getEpochInfo', [commitment]],
    ['latestBlockhash', 'getLatestBlockhash', [commitment]],
    ['priorityFees', 'getRecentPrioritizationFees', []]
  ];
  const results = await Promise.all(methods.map(async item => {
    try { return [item[0], await rpcCall(item[1], item[2]), null]; }
    catch (error) { return [item[0], null, error && error.message ? error.message : String(error)]; }
  }));
  const map = Object.fromEntries(results.map(item => [item[0], item[1]]));
  const errors = results.filter(item => item[1] == null);
  const requiredKeys = new Set(['slot', 'blockHeight', 'epoch', 'latestBlockhash']);
  const requiredErrors = errors.filter(item => requiredKeys.has(item[0]));
  if (requiredErrors.length === requiredKeys.size) throw new Error(requiredErrors.map(item => item[2]).join('; '));
  const priorityFees = Array.isArray(map.priorityFees) ? map.priorityFees.map(item => asNumber(item && item.prioritizationFee)).filter(Number.isFinite).sort((a, b) => a - b) : [];
  return {
    network: 'solana',
    cluster: NETWORK.cluster,
    nativeSymbol: 'SOL',
    slot: asNumber(map.slot),
    blockHeight: asNumber(map.blockHeight),
    epoch: map.epoch || null,
    latestBlockhash: map.latestBlockhash && map.latestBlockhash.value ? map.latestBlockhash.value.blockhash : null,
    lastValidBlockHeight: asNumber(map.latestBlockhash && map.latestBlockhash.value ? map.latestBlockhash.value.lastValidBlockHeight : null),
    commitment: NETWORK.commitment,
    status: requiredErrors.length ? 'degraded' : 'live',
    rpc: activeRpcEndpoint || rpcUrl(),
    explorer: SOLANA_EXPLORER,
    priorityFeeSampleLamports: priorityFees.length ? priorityFees[Math.floor(priorityFees.length / 2)] : null,
    observedAt: nowIso(),
    errors: results.filter(item => item[2]).map(item => ({ method: item[0], error: item[2] }))
  };
}

function parsedTokenAccount(item, program) {
  const info = item && item.account && item.account.data && item.account.data.parsed && item.account.data.parsed.info;
  const tokenAmount = info && info.tokenAmount;
  const decimals = asNumber(tokenAmount && tokenAmount.decimals);
  const balance = asNumber(tokenAmount && (tokenAmount.uiAmountString != null ? tokenAmount.uiAmountString : tokenAmount.uiAmount));
  if (!info || !info.mint || !tokenAmount || tokenAmount.amount == null || decimals === null || balance === null) {
    throw new Error('malformed ' + program + ' token account response');
  }
  return {
    account: item.pubkey,
    mint: info.mint,
    owner: info.owner || null,
    amount: String(tokenAmount.amount),
    decimals,
    balance,
    program,
    state: info.state || null,
    isNative: Boolean(tokenAmount.isNative)
  };
}

async function walletData() {
  const [balance, spl, token2022, signatures] = await Promise.all([
    rpcCall('getBalance', [agentAddress(), commitment]),
    rpcCall('getTokenAccountsByOwner', [agentAddress(), { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed', ...commitment }]),
    rpcCall('getTokenAccountsByOwner', [agentAddress(), { programId: TOKEN_2022_PROGRAM }, { encoding: 'jsonParsed', ...commitment }]),
    rpcCall('getSignaturesForAddress', [agentAddress(), { limit: 20, ...commitment }])
  ]);
  const balanceLamports = asNumber(balance && balance.value);
  if (balanceLamports === null || balanceLamports < 0) throw new Error('getBalance returned an invalid balance');
  if (!Array.isArray(spl && spl.value)) throw new Error('SPL token accounts response is invalid');
  if (!Array.isArray(token2022 && token2022.value)) throw new Error('Token-2022 accounts response is invalid');
  if (!Array.isArray(signatures)) throw new Error('recent signatures response is invalid');
  const splAccounts = spl.value.map(item => parsedTokenAccount(item, 'spl-token'));
  const token2022Accounts = token2022.value.map(item => parsedTokenAccount(item, 'token-2022'));
  const recentSignatures = signatures;
  let latestTransactionData = null;
  let transactionDetailStatus = 'live';
  let transactionDetailError = null;
  const latestSignature = recentSignatures[0] && recentSignatures[0].signature;
  if (latestSignature) {
    try {
      latestTransactionData = await rpcCall('getTransaction', [latestSignature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, ...commitment }]);
      if (!latestTransactionData) {
        transactionDetailStatus = 'unavailable';
        transactionDetailError = 'getTransaction returned no transaction detail';
      }
    } catch (error) {
      transactionDetailStatus = 'unavailable';
      transactionDetailError = error && error.message ? error.message : String(error);
    }
  }
  return {
    address: agentAddress(),
    explorerUrl: SOLSCAN + '/account/' + agentAddress(),
    solBalance: balanceLamports / 1e9,
    nativeBalance: balanceLamports / 1e9,
    nativeBalanceLamports: String(balanceLamports),
    nativeSymbol: 'SOL',
    tokenAccounts: splAccounts.concat(token2022Accounts),
    splTokenAccounts: splAccounts.length,
    token2022Accounts: token2022Accounts.length,
    tokenAccountsCount: splAccounts.length + token2022Accounts.length,
    recentSignatures,
    latestTransactionData,
    transactionDetailStatus,
    transactionDetailError,
    latestActivity: recentSignatures[0] || null,
    privateKeyExposed: false,
    observedAt: nowIso()
  };
}

async function jupiter(path, ms) {
  const headers = jupiterApiKey() ? { 'x-api-key': jupiterApiKey() } : {};
  const attempts = [JUPITER_BASE, JUPITER_FALLBACK].filter((value, index, list) => value && list.indexOf(value) === index);
  const deadline = Date.now() + (ms || 7000);
  let lastError;
  for (const base of attempts) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      await reserveJupiterRequest();
      const afterThrottle = deadline - Date.now();
      if (afterThrottle <= 0) throw new Error('jupiter request budget exceeded while rate limited');
      const value = await getJson(base + path, { headers }, Math.min(3500, afterThrottle));
      if (value && (value.status === 400 || value.status === 401 || value.status === 403 || value.error)) {
        throw new Error('jupiter api error');
      }
      return value;
    }
    catch (error) { lastError = error; }
  }
  throw lastError || new Error('jupiter unavailable');
}

async function cached(key, ttlMs, operation) {
  const previous = requestCache.get(key);
  if (previous && Date.now() - previous.at < ttlMs) return previous.value;
  if (previous && previous.inFlight) return previous.inFlight;
  const inFlight = Promise.resolve().then(operation).then(value => {
    requestCache.set(key, { at: Date.now(), value, inFlight: null });
    return value;
  }).catch(error => {
    const current = requestCache.get(key);
    if (current && current.inFlight === inFlight) {
      if (previous && previous.value) requestCache.set(key, previous);
      else requestCache.delete(key);
    }
    // An upstream outage must not erase the last observed values. Preserve
    // their original sourceTimestamp and mark the returned view stale.
    if (previous?.value?.health && previous.value.health.status !== 'unavailable') {
      return {
        ...previous.value,
        health: {
          ...previous.value.health,
          status: 'stale',
          checkedAt: nowIso(),
          error: error && error.message ? error.message : String(error)
        }
      };
    }
    throw error;
  });
  requestCache.set(key, { at: previous?.at || 0, value: previous?.value, inFlight });
  return inFlight;
}

// Merge real Jupiter category feeds by mint while retaining feed membership and health.
async function tokenUniverse() {
  return cached('jupiter-universe', 45000, async () => {
    const endpoints = [
      ['trending', '/tokens/v2/toptrending/24h?limit=40', 40],
      ['traded', '/tokens/v2/toptraded/24h?limit=30', 30],
      ['organic', '/tokens/v2/toporganicscore/24h?limit=20', 20],
      ['recent', '/tokens/v2/recent?limit=20', 20]
    ];
    const started = performance.now();
    const results = [];
    for (const [kind, endpoint, limit] of endpoints) {
      try {
        const value = await jupiter(endpoint, JUPITER_REQUEST_BUDGET_MS);
        results.push({ kind, endpoint, values: Array.isArray(value) ? value.slice(0, limit) : [], error: null });
      } catch (error) {
        results.push({ kind, endpoint, values: [], error: error && error.message ? error.message : String(error) });
      }
    }
    const counts = {};
    const byMint = new Map();
    for (const result of results) {
      counts[result.kind] = result.values.length;
      for (const token of result.values) {
        const mint = token && (token.id || token.address || token.mint);
        if (!mint) continue;
        const previous = byMint.get(mint) || {};
        const feeds = Array.from(new Set([...(previous.feeds || []), result.kind]));
        byMint.set(mint, { ...previous, ...token, feeds });
      }
    }
    const successful = results.filter(result => !result.error);
    if (!successful.length) throw new Error('all Jupiter token endpoints failed');
    if (!byMint.size) throw new Error('Jupiter token endpoints returned no tokens');
    const status = successful.length === results.length ? 'live' : 'stale';
    const completedAt = nowIso();
    return {
      tokens: Array.from(byMint.values()).slice(0, 150),
      counts,
      endpoints: endpoints.map(item => item[1]),
      sourceTimestamp: completedAt,
      health: {
        id: 'jupiter-tokens',
        label: 'jupiter token feeds',
        endpoint: JUPITER_BASE + '/tokens/v2/*',
        usedBy: ['market', 'look', 'snapshot', 'weigh', 'board'],
        status,
        checkedAt: completedAt,
        lastSuccess: completedAt,
        latencyMs: Math.round(performance.now() - started),
        error: status === 'live' ? null : results.filter(result => result.error).map(result => result.kind + ': ' + result.error).join('; '),
        successfulEndpoints: successful.length,
        totalEndpoints: results.length
      }
    };
  });
}

// Batch Price V3 requests; a prior quote is reused only with stale provenance.
async function pricesFor(mints) {
  const unique = Array.from(new Set((mints || []).filter(Boolean)));
  const cacheKey = 'jupiter-prices:' + unique.join(',');
  return cached(cacheKey, 25000, async () => {
    const started = performance.now();
    const checkedAt = nowIso();
    const previous = requestCache.get(cacheKey)?.value;
    const batches = [];
    for (let index = 0; index < unique.length; index += 50) batches.push(unique.slice(index, index + 50));
    if (!batches.length) {
      return {
        prices: {},
        health: {
          id: 'jupiter-prices', label: 'jupiter price v3', endpoint: JUPITER_BASE + '/price/v3',
          usedBy: ['market', 'look', 'snapshot', 'weigh', 'board'], status: 'unavailable',
          checkedAt, lastSuccess: null, error: 'no mints available for pricing',
          successfulBatches: 0, totalBatches: 0
        }
      };
    }
    const result = {};
    const errors = [];
    const staleMints = new Set();
    let successfulBatches = 0;
    for (let index = 0; index < batches.length; index += 1) {
      try {
        const data = await jupiter('/price/v3?ids=' + encodeURIComponent(batches[index].join(',')), JUPITER_REQUEST_BUDGET_MS);
        Object.assign(result, data || {});
        successfulBatches += 1;
      } catch (error) {
        errors.push('batch ' + index + ': ' + (error && error.message ? error.message : String(error)));
        for (const mint of batches[index]) {
          if (Object.prototype.hasOwnProperty.call(previous?.prices || {}, mint)) {
            result[mint] = previous.prices[mint];
            staleMints.add(mint);
          }
        }
      }
    }
    if (successfulBatches === 0) throw new Error(errors.join('; ') || 'all Jupiter price batches failed');
    const quotedMints = Object.keys(result).length;
    const status = successfulBatches === 0 || quotedMints === 0 ? 'unavailable' : successfulBatches === batches.length ? 'live' : 'stale';
    if (successfulBatches > 0 && quotedMints === 0) errors.push('price batches returned no quotes');
    const completedAt = nowIso();
    const quoteAtByMint = Object.fromEntries(Object.keys(result).map(mint => [
      mint,
      staleMints.has(mint) ? previous?.quoteAtByMint?.[mint] || previous?.sourceTimestamp || null : completedAt
    ]));
    return {
      prices: result,
      quoteAtByMint,
      staleMints: Array.from(staleMints),
      sourceTimestamp: completedAt,
      health: {
        id: 'jupiter-prices',
        label: 'jupiter price v3',
        endpoint: JUPITER_BASE + '/price/v3',
        usedBy: ['market', 'look', 'snapshot', 'weigh', 'board'],
        status,
        checkedAt: completedAt,
        lastSuccess: status === 'unavailable' ? null : completedAt,
        latencyMs: Math.round(performance.now() - started),
        error: errors.length ? errors.join('; ') : null,
        successfulBatches,
        totalBatches: batches.length
      }
    };
  });
}

function normalizeStatsWindow(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.fromEntries([
    'priceChange', 'holderChange', 'liquidityChange', 'volumeChange',
    'buyVolume', 'sellVolume', 'buyOrganicVolume', 'sellOrganicVolume',
    'numBuys', 'numSells', 'numTraders', 'numOrganicBuyers', 'numNetBuyers'
  ].map(key => [key, asNumber(value[key])]));
}

function tokenStats(token, price) {
  const stats5m = normalizeStatsWindow(token && token.stats5m);
  const stats1h = normalizeStatsWindow(token && token.stats1h);
  const stats6h = normalizeStatsWindow(token && token.stats6h);
  const stats24h = normalizeStatsWindow(token && (token.stats24h || token.stats24hUsd));
  const stats = stats24h || {};
  const audit = token && token.audit || {};
  return {
    stats5m,
    stats1h,
    stats6h,
    stats24h,
    change24h: firstNumber(token && token.priceChange24h, stats.priceChange, stats.priceChange24h, price && price.priceChange24h),
    buyVolume: firstNumber(stats.buyVolume, stats.buyVolumeUsd, token && token.buyVolume),
    sellVolume: firstNumber(stats.sellVolume, stats.sellVolumeUsd, token && token.sellVolume),
    buys: firstNumber(stats.numBuys, token && token.buys),
    sells: firstNumber(stats.numSells, token && token.sells),
    traders: firstNumber(stats.numTraders, stats.traders, token && token.traders),
    liquidityUsd: firstNumber(token && token.liquidity, token && token.liquidityUsd, price && price.liquidity),
    marketCap: firstNumber(token && token.mcap, token && token.marketCap),
    fdv: asNumber(token && token.fdv),
    holderCount: asNumber(token && token.holderCount),
    holderConcentration: firstNumber(audit.topHoldersPercentage, token && token.holderConcentration),
    organicScore: asNumber(token && token.organicScore),
    organicScoreLabel: typeof token?.organicScoreLabel === 'string' ? token.organicScoreLabel : null,
    verified: token && (token.isVerified === true || token.verified === true) ? true : token && (token.isVerified === false || token.verified === false) ? false : null,
    lastUpdate: token && (token.updatedAt || token.createdAt) || null
  };
}

function hasJupiterMetadata(token, mint) {
  return Boolean(
    token && (token.id || token.address || token.mint) === mint &&
    typeof token.name === 'string' && token.name.trim() &&
    typeof token.symbol === 'string' && token.symbol.trim()
  );
}

// Map token metadata and quotes into the market view without synthesizing missing fields.
async function marketData(wallet, projectMint = null, projectMintValidated = false) {
  let universeResult;
  try {
    universeResult = await tokenUniverse();
  } catch (error) {
    universeResult = {
      tokens: [], counts: {}, endpoints: [],
      health: {
        id: 'jupiter-tokens', label: 'jupiter token feeds', endpoint: JUPITER_BASE + '/tokens/v2/*',
        usedBy: ['market', 'look', 'snapshot', 'weigh', 'board'], status: 'unavailable',
        checkedAt: nowIso(), lastSuccess: null, error: error && error.message ? error.message : String(error),
        successfulEndpoints: 0, totalEndpoints: 4
      }
    };
  }
  const universe = [...(universeResult.tokens || [])];
  let projectMetadata = null;
  let projectSearchError = null;
  if (projectMint) {
    projectMetadata = universe.find(item => hasJupiterMetadata(item, projectMint)) || null;
    if (!projectMetadata) {
      try {
        const search = await jupiter('/tokens/v2/search?query=' + encodeURIComponent(projectMint), 5000);
        projectMetadata = (Array.isArray(search) ? search : []).find(item => hasJupiterMetadata(item, projectMint)) || null;
      } catch (error) {
        projectSearchError = error && error.message ? error.message : String(error);
      }
    }
  }
  const accountMints = (wallet && wallet.tokenAccounts || []).map(item => item.mint);
  const universeMints = Array.from(new Set(universe.map(item => item && (item.id || item.address || item.mint)).filter(Boolean)));
  const pricedMints = Array.from(new Set(accountMints.concat(universeMints).filter(Boolean)));
  const priceMints = Array.from(new Set([NATIVE_SOL_PRICE_MINT, ...pricedMints, ...(projectMint ? [projectMint] : [])]));
  const priceResult = await pricesFor(priceMints);
  const priceMap = priceResult.prices || {};
  const metadata = new Map(universe.map(item => [item && (item.id || item.address || item.mint), item]));
  if (projectMint && projectMetadata) metadata.set(projectMint, { ...projectMetadata, feeds: Array.from(new Set([...(projectMetadata.feeds || []), 'project'])) });
  // Category feeds filter generic assets such as SOL. If Price V3 omits
  // wrapped SOL, resolve its real Tokens V2 quote by mint for valuation.
  if (asNumber(priceMap[NATIVE_SOL_PRICE_MINT]?.usdPrice) === null && !metadata.has(NATIVE_SOL_PRICE_MINT)) {
    try {
      const search = await jupiter('/tokens/v2/search?query=' + NATIVE_SOL_PRICE_MINT, 5000);
      const nativeToken = (Array.isArray(search) ? search : []).find(item => (item.id || item.address || item.mint) === NATIVE_SOL_PRICE_MINT);
      if (nativeToken) metadata.set(NATIVE_SOL_PRICE_MINT, nativeToken);
    } catch {
      // Price and valuation remain unavailable if both real sources fail.
    }
  }
  const buildAsset = (mint, includeProjectStatus = false) => {
    const token = metadata.get(mint) || {};
    const price = priceMap[mint] || {};
    const stats = tokenStats(token, price);
    const move = stats.change24h;
    // Price V3 is preferred, but Tokens V2's own usdPrice is a real, separately
    // attributed quote when V3 omits this mint. A missing value remains null.
    const v3Price = asNumber(price.usdPrice);
    const v2Price = asNumber(token.usdPrice);
    const resolvedPrice = firstNumber(v3Price, v2Price);
    const priceSource = v3Price !== null ? 'jupiter price v3' : v2Price !== null ? 'jupiter tokens v2' : null;
    const hasMarketData = [
      resolvedPrice,
      stats.liquidityUsd,
      stats.marketCap,
      stats.fdv,
      stats.buyVolume,
      stats.sellVolume
    ].some(value => value !== null);
    return {
      mint,
      symbol: token.symbol || (mint === projectMint ? 'SORYN' : mint === NATIVE_SOL_PRICE_MINT ? 'SOL' : mint.slice(0, 4) + '…'),
      name: token.name || (mint === projectMint ? 'SORYN token' : 'Solana token'),
      icon: token.icon || null,
      decimals: firstNumber(token.decimals, price.decimals) ?? 0,
      tokenProgram: token.tokenProgram || null,
      price: resolvedPrice,
      metadataPrice: v2Price,
      priceSource,
      change24h: move,
      dailyMovePct: move,
      liquidityUsd: stats.liquidityUsd,
      marketCap: stats.marketCap,
      fdv: stats.fdv,
      holderCount: stats.holderCount,
      holderConcentration: stats.holderConcentration,
      topHoldersPercentage: stats.holderConcentration,
      organicScore: stats.organicScore,
      organicScoreLabel: stats.organicScoreLabel,
      verified: stats.verified,
      buyVolume: stats.buyVolume,
      sellVolume: stats.sellVolume,
      buys: stats.buys,
      sells: stats.sells,
      traders: stats.traders,
      stats5m: stats.stats5m,
      stats1h: stats.stats1h,
      stats6h: stats.stats6h,
      stats24h: stats.stats24h,
      feeds: Array.from(new Set([...(Array.isArray(token.feeds) ? token.feeds : []), ...(includeProjectStatus ? ['project'] : [])])),
      lastUpdate: stats.lastUpdate,
      quoteAt: priceSource === 'jupiter price v3' ? priceResult.quoteAtByMint?.[mint] || priceResult.sourceTimestamp || null : priceSource === 'jupiter tokens v2' ? stats.lastUpdate || universeResult.sourceTimestamp || null : null,
      source: priceSource || 'jupiter tokens v2 metadata; price unavailable',
      project: includeProjectStatus,
      ...(includeProjectStatus ? {
        indexed: Boolean(projectMetadata),
        marketDataStatus: projectMintValidated && projectMetadata && hasMarketData ? 'tracking' : 'indexing',
        halted: !projectMintValidated || !projectMetadata,
        searchError: projectSearchError
      } : {})
    };
  };
  const assets = projectMint ? [buildAsset(projectMint, true), ...universeMints.filter(mint => mint !== projectMint).map(mint => buildAsset(mint))] : universeMints.map(mint => buildAsset(mint));
  const holdingAssets = accountMints.map(mint => buildAsset(mint));
  const projectToken = projectMint ? assets[0] : null;
  const nativeSolV3 = asNumber(priceMap[NATIVE_SOL_PRICE_MINT]?.usdPrice);
  const nativeSolV2 = asNumber(metadata.get(NATIVE_SOL_PRICE_MINT)?.usdPrice);
  const nativeSolPrice = firstNumber(nativeSolV3, nativeSolV2);
  const nativeSolPriceSource = nativeSolV3 !== null ? 'jupiter price v3' : nativeSolV2 !== null ? 'jupiter tokens v2' : null;
  const nativeSolPriceAt = nativeSolV3 !== null ? priceResult.quoteAtByMint?.[NATIVE_SOL_PRICE_MINT] || priceResult.sourceTimestamp || null : nativeSolV2 !== null ? metadata.get(NATIVE_SOL_PRICE_MINT)?.updatedAt || universeResult.sourceTimestamp || null : null;
  const health = { tokens: universeResult.health, prices: priceResult.health };
  const statuses = [health.tokens.status, health.prices.status];
  const quoteCount = assets.filter(item => item.price != null).length;
  const noUsableUniverseQuotes = assets.length > 0 && quoteCount === 0;
  const status = !assets.length || noUsableUniverseQuotes ? 'unavailable' : statuses.includes('unavailable') || statuses.includes('stale') ? 'stale' : 'live';
  return {
    assets,
    holdingAssets,
    projectToken,
    nativeSolPrice,
    nativeSolPriceSource,
    nativeSolPriceAt,
    quoteCount,
    universeSize: assets.length,
    sourceTimestamp: priceResult.sourceTimestamp || universeResult.sourceTimestamp || null,
    sourceTimestamps: {
      tokens: universeResult.sourceTimestamp || null,
      prices: priceResult.sourceTimestamp || null
    },
    source: 'jupiter',
    counts: universeResult.counts,
    endpoints: universeResult.endpoints.concat(projectMint ? ['/tokens/v2/search?query=<project-mint>'] : []),
    status,
    error: noUsableUniverseQuotes ? 'Jupiter Price V3 returned no reliable quotes for the watched universe' : null,
    health
  };
}

async function externalReferences() {
  const result = await observed('coingecko', 'external references', COINGECKO, ['look', 'snapshot', 'weigh'], () => getJson(COINGECKO, {}, 5000));
  const values = [['BTC', 'bitcoin'], ['ETH', 'ethereum'], ['SOL', 'solana']].map(item => {
    const point = result.value?.[item[1]];
    const sourceUpdatedSeconds = asNumber(point?.last_updated_at);
    const updatedAt = sourceUpdatedSeconds && sourceUpdatedSeconds > 0
      ? new Date(sourceUpdatedSeconds * 1000).toISOString()
      : result.health.lastSuccess;
    return {
      symbol: item[0],
      price: asNumber(point?.usd),
      dailyMovePct: asNumber(point?.usd_24h_change),
      source: 'coingecko simple/price',
      priceUpdatedAt: updatedAt,
      moveUpdatedAt: updatedAt,
      updatedAt,
      heldByAgent: false
    };
  });
  result.health.items = values.filter(item => item.price != null).length;
  if (result.health.items === 0) {
    result.health.status = 'unavailable';
    result.health.lastSuccess = null;
    result.health.error = result.health.error || 'external market context returned no valid prices';
  } else if (result.health.items < values.length && result.health.status === 'live') {
    result.health.status = 'stale';
    result.health.error = 'external market context is partial';
  }
  return { values, health: result.health };
}

function positionRows(wallet, assets) {
  const metadata = new Map((assets || []).map(asset => [asset.mint, asset]));
  const grouped = new Map();
  for (const account of wallet && wallet.tokenAccounts || []) {
    const current = grouped.get(account.mint) || { ...account, balance: 0, accounts: [] };
    current.balance += Number(account.balance) || 0;
    current.accounts.push(account.account);
    grouped.set(account.mint, current);
  }
  return Array.from(grouped.values()).map(account => {
    const asset = metadata.get(account.mint) || {};
    const price = asNumber(asset.price);
    return {
      mint: account.mint,
      symbol: asset.symbol || account.mint.slice(0, 4) + '…',
      name: asset.name || 'Solana token',
      tokenProgram: account.program,
      balance: account.balance,
      decimals: account.decimals,
      price,
      valueUsd: account.balance === 0 ? 0 : price == null ? null : account.balance * price,
      account: account.accounts[0] || account.account,
      accounts: account.accounts
    };
  });
}

function latestTransaction(wallet) {
  const item = wallet && wallet.latestActivity;
  if (!item || !item.signature) return null;
  const detail = wallet.latestTransactionData || {};
  const tx = detail.transaction || {};
  const message = tx.message || {};
  const meta = detail.meta || {};
  const instructions = Array.isArray(message.instructions) ? message.instructions.map(instruction => ({
    program: instruction.program || null,
    programId: instruction.programId || null,
    parsed: instruction.parsed || null,
    accounts: instruction.accounts || null,
    data: instruction.data || null,
    inner: false
  })) : [];
  const innerInstructions = Array.isArray(meta.innerInstructions) ? meta.innerInstructions.flatMap(group =>
    (group.instructions || []).map(instruction => ({
      program: instruction.program || null,
      programId: instruction.programId || null,
      parsed: instruction.parsed || null,
      accounts: instruction.accounts || null,
      data: instruction.data || null,
      inner: true,
      parentIndex: group.index
    }))
  ) : [];
  instructions.push(...innerInstructions);
  const programs = Array.from(new Set(instructions.map(instruction => instruction.programId || instruction.program).filter(Boolean)));
  return {
    signature: item.signature,
    slot: detail.slot == null ? (item.slot == null ? null : item.slot) : detail.slot,
    blockTime: detail.blockTime == null ? (item.blockTime == null ? null : item.blockTime) : detail.blockTime,
    status: meta.err || item.err ? 'failed' : (item.confirmationStatus || 'confirmed'),
    error: meta.err || item.err || null,
    explorerUrl: SOLSCAN + '/tx/' + item.signature,
    feeLamports: meta.fee == null ? null : meta.fee,
    programs,
    instructions,
    computeUnits: meta.computeUnitsConsumed == null ? null : meta.computeUnitsConsumed,
    logMessages: Array.isArray(meta.logMessages) ? meta.logMessages : null
  };
}

// Assemble one API observation from independent reads; sources are not atomic in time.
export async function buildSnapshot(options = {}) {
  const startedAt = nowIso();
  const [chainResult, walletResult, externalResult, configuredProjectToken] = await Promise.all([
    observed('solana-rpc', 'solana mainnet rpc', rpcUrl(), ['chain', 'wallet', 'look', 'snapshot'], chainData),
    observed('solana-wallet', 'solana wallet rpc', rpcUrl(), ['wallet', 'look', 'snapshot'], walletData),
    externalReferences(),
    (options.projectTokenConfig ? Promise.resolve(options.projectTokenConfig) : readProjectTokenMint()).catch(error => ({
      mint: null,
      status: 'unavailable',
      source: 'unavailable',
      checkedAt: nowIso(),
      validation: null,
      error: error && error.message ? error.message : String(error)
    }))
  ]);
  const projectMint = configuredProjectToken.status === 'indexing' ? configuredProjectToken.mint : null;
  const projectMintValidated = configuredProjectToken.validation?.mintAccount === 'valid';
  const wallet = walletResult.value || {
    address: agentAddress(),
    explorerUrl: SOLSCAN + '/account/' + agentAddress(),
    solBalance: null, nativeBalance: null, nativeSymbol: 'SOL',
    tokenAccounts: [], tokenAccountsCount: null, recentSignatures: [], latestActivity: null,
    privateKeyExposed: false
  };
  const marketResult = await observed('jupiter', 'jupiter token universe and prices', JUPITER_BASE, ['market', 'look', 'snapshot', 'weigh', 'board'], () => marketData(wallet, projectMint, projectMintValidated));
  const projectIndexed = Boolean(projectMint && marketResult.value?.projectToken?.indexed);
  const projectTracking = projectIndexed && marketResult.value?.projectToken?.marketDataStatus === 'tracking';
  const projectTokenConfig = projectMint
    ? {
        ...configuredProjectToken,
        status: projectTracking ? 'tracking' : configuredProjectToken.status,
        validation: {
          ...configuredProjectToken.validation,
          metadata: projectIndexed ? 'valid' : 'pending',
          metadataSource: projectIndexed ? 'jupiter tokens v2' : null
        }
      }
    : configuredProjectToken;
  if (chainResult.value?.status === 'degraded') chainResult.health.status = 'stale';
  if (marketResult.value?.status) {
    marketResult.health.status = marketResult.value.status;
    marketResult.health.error = [marketResult.value.error, marketResult.value.health?.tokens?.error, marketResult.value.health?.prices?.error].filter(Boolean).join('; ') || null;
    if (marketResult.value.status === 'unavailable') marketResult.health.lastSuccess = null;
    else marketResult.health.lastSuccess = [
      marketResult.value.health?.tokens?.lastSuccess,
      marketResult.value.health?.prices?.lastSuccess
    ].filter(Boolean).sort().at(-1) || marketResult.health.lastSuccess;
  }
  const assets = marketResult.value && marketResult.value.assets || [];
  const holdingAssets = marketResult.value && marketResult.value.holdingAssets || [];
  for (const reference of externalResult.values) {
    if (reference.symbol !== 'SOL') {
      reference.status = reference.price == null ? 'unavailable' : reference.dailyMovePct == null || externalResult.health.status !== 'live' ? 'stale' : 'live';
      continue;
    }
    reference.price = asNumber(marketResult.value?.nativeSolPrice);
    reference.source = (marketResult.value?.nativeSolPriceSource || 'jupiter price unavailable') + ' (USD) / coingecko simple/price (24h)';
    reference.priceUpdatedAt = marketResult.value?.nativeSolPriceAt || null;
    reference.updatedAt = earlierTimestamp(reference.priceUpdatedAt, reference.moveUpdatedAt);
    const priceStatus = marketResult.value?.health?.prices?.status || 'unavailable';
    reference.status = reference.price == null ? 'unavailable' : priceStatus !== 'live' || externalResult.health.status !== 'live' || reference.dailyMovePct == null ? 'stale' : 'live';
  }
  const referenceStatuses = externalResult.values.map(item => item.status);
  const externalStatus = referenceStatuses.every(item => item === 'live') ? 'live' : referenceStatuses.some(item => item === 'live' || item === 'stale') ? 'stale' : 'unavailable';
  wallet.positions = positionRows(wallet, assets.concat(holdingAssets));
  const nativeSolPrice = firstNumber(marketResult.value && marketResult.value.nativeSolPrice, assets.find(asset => asset.mint === NATIVE_SOL_PRICE_MINT || asset.symbol === 'SOL')?.price);
  wallet.nativeValueUsd = wallet.solBalance === 0 ? 0 : wallet.solBalance == null || nativeSolPrice == null ? null : wallet.solBalance * nativeSolPrice;
  const portfolioValues = [wallet.nativeValueUsd].concat(wallet.positions.map(item => item.valueUsd)).filter(Number.isFinite);
  const walletObserved = Boolean(walletResult.value);
  const missingNativeValue = !walletObserved || wallet.solBalance == null || (wallet.solBalance !== 0 && wallet.nativeValueUsd == null);
  const missingTokenValue = wallet.positions.some(item => Number(item.balance) !== 0 && item.valueUsd == null);
  wallet.valuationComplete = walletObserved && !missingNativeValue && !missingTokenValue;
  wallet.knownPortfolioUsd = walletObserved && portfolioValues.length ? portfolioValues.reduce((sum, value) => sum + value, 0) : null;
  wallet.portfolioUsd = wallet.valuationComplete ? (wallet.knownPortfolioUsd ?? 0) : null;
  const sourceHealth = {};
  [chainResult, walletResult, marketResult, externalResult].forEach(result => { sourceHealth[result.health.id] = result.health; });
  sourceHealth['jupiter-tokens'] = marketResult.value?.health?.tokens || {
    id: 'jupiter-tokens', label: 'jupiter token feeds', endpoint: JUPITER_BASE + '/tokens/v2/*',
    usedBy: ['market', 'look', 'snapshot', 'weigh', 'board'], status: 'unavailable',
    checkedAt: nowIso(), lastSuccess: null, error: marketResult.error || 'market observation unavailable'
  };
  sourceHealth['jupiter-prices'] = marketResult.value?.health?.prices || {
    id: 'jupiter-prices', label: 'jupiter price v3', endpoint: JUPITER_BASE + '/price/v3',
    usedBy: ['market', 'look', 'snapshot', 'weigh', 'board'], status: 'unavailable',
    checkedAt: nowIso(), lastSuccess: null, error: marketResult.error || 'market observation unavailable'
  };
  const transactionStatus = walletResult.value ? (wallet.transactionDetailStatus || 'live') : 'unavailable';
  const transactionCheckedAt = wallet.observedAt || nowIso();
  sourceHealth['solana-transactions'] = {
    id: 'solana-transactions',
    label: 'solana transaction detail',
    endpoint: activeRpcEndpoint || rpcUrl(),
    usedBy: ['chain', 'wallet', 'snapshot'],
    status: transactionStatus,
    checkedAt: transactionCheckedAt,
    lastSuccess: transactionStatus === 'live' ? transactionCheckedAt : null,
    error: wallet.transactionDetailError || (walletResult.value ? null : walletResult.error || 'wallet observation unavailable')
  };
  const sourceStatus = {
    chain: chainResult.health.status,
    wallet: walletResult.health.status,
    market: marketResult.health.status,
    external: externalStatus,
    transactions: transactionStatus
  };
  const cycleCritical = {
    chain: sourceStatus.chain,
    wallet: sourceStatus.wallet,
    market: sourceStatus.market
  };
  cycleCritical.ready = ['chain', 'wallet', 'market'].every(key => cycleCritical[key] === 'live');
  const finishedAt = nowIso();
  return {
    version: 'solana-1',
    timestamp: finishedAt,
    fetchStartedAt: startedAt,
    fetchCompletedAt: finishedAt,
    latencyMs: Math.max(0, new Date(finishedAt) - new Date(startedAt)),
    stale: !cycleCritical.ready,
    executionMode: 'simulation',
    chain: chainResult.value,
    wallet,
    market: {
      assets,
      projectToken: marketResult.value?.projectToken || null,
      nativeSolPrice,
      nativeSolPriceSource: marketResult.value?.nativeSolPriceSource || null,
      nativeSolPriceAt: marketResult.value?.nativeSolPriceAt || null,
      quoteCount: marketResult.value?.quoteCount || 0,
      quotedTokens: marketResult.value?.quoteCount || 0,
      universeSize: marketResult.value?.universeSize || assets.length,
      trendingCount: marketResult.value?.counts?.trending || 0,
      topTradedCount: marketResult.value?.counts?.traded || 0,
      topOrganicCount: marketResult.value?.counts?.organic || 0,
      recentCount: marketResult.value?.counts?.recent || 0,
      counts: marketResult.value?.counts || {},
      endpoints: marketResult.value?.endpoints || [],
      sourceTimestamp: marketResult.value?.sourceTimestamp || null,
      sourceTimestamps: marketResult.value?.sourceTimestamps || {},
      source: 'jupiter tokens v2 / price v3'
    },
    projectTokenConfig,
    externalSignals: externalResult.values,
    lastTransaction: latestTransaction(wallet),
    sourceStatus,
    sourceHealth,
    cycleCritical,
    provenance: {
      chain: { rpc: activeRpcEndpoint || rpcUrl(), methods: ['getSlot', 'getBlockHeight', 'getEpochInfo', 'getLatestBlockhash', 'getRecentPrioritizationFees'] },
      wallet: { rpc: activeRpcEndpoint || rpcUrl(), methods: ['getBalance', 'getTokenAccountsByOwner', 'getSignaturesForAddress', 'getTransaction'], programs: [TOKEN_PROGRAM, TOKEN_2022_PROGRAM] },
      market: { jupiter: (marketResult.value && marketResult.value.endpoints || []).concat(['/price/v3']) },
      external: { coingecko: COINGECKO, solPrice: JUPITER_BASE + '/price/v3?ids=' + NATIVE_SOL_PRICE_MINT }
    },
    notes: ['all chain and wallet fields are read from Solana mainnet-beta RPC', 'token universe and prices are fetched from Jupiter when available', 'SORYN remains simulation-only; no signer or transaction submission exists']
  };
}

export { TOKEN_PROGRAM, TOKEN_2022_PROGRAM };
