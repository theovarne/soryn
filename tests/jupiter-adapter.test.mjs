import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JUPITER_MIN_INTERVAL_MS = '0';

const projectMint = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const feedMint = 'So11111111111111111111111111111111111111112';
const response = value => ({
  ok: true, status: 200, statusText: 'OK',
  async json() { return value; }
});

const projectToken = {
  id: projectMint, name: 'SORYN', symbol: 'SORYN', decimals: 6,
  usdPrice: 0.00000831, holderCount: 321, liquidity: 83000,
  mcap: 410000, fdv: 490000, organicScore: 52.5,
  organicScoreLabel: 'medium', isVerified: false,
  audit: { topHoldersPercentage: 12.25 },
  stats5m: { buyVolume: 7, sellVolume: 3, numBuys: 4, numSells: 2, numTraders: 5 },
  stats1h: { buyVolume: 70, sellVolume: 30, numBuys: 40, numSells: 20, numTraders: 50 },
  stats6h: { buyVolume: 700, sellVolume: 300, numBuys: 400, numSells: 200, numTraders: 500 },
  stats24h: { priceChange: 1.25, buyVolume: 7000, sellVolume: 3000, numBuys: 4000, numSells: 2000, numTraders: 5000 },
  updatedAt: '2026-09-23T00:00:00Z'
};
const feedToken = { id: feedMint, name: 'Wrapped SOL', symbol: 'SOL', usdPrice: 100, liquidity: 1000000 };
const categoryToken = { id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USD Coin', symbol: 'USDC', usdPrice: 1, liquidity: 1000000 };

function rpcResult(method) {
  return {
    getSlot: 123,
    getBlockHeight: 100,
    getEpochInfo: { epoch: 5, slotIndex: 1, slotsInEpoch: 10 },
    getLatestBlockhash: { context: { slot: 123 }, value: { blockhash: 'real-blockhash', lastValidBlockHeight: 200 } },
    getRecentPrioritizationFees: [],
    getBalance: { context: { slot: 123 }, value: 0 },
    getTokenAccountsByOwner: { context: { slot: 123 }, value: [] },
    getSignaturesForAddress: []
  }[method];
}

test('Jupiter V2 stats and project token map to first-priority observation without score boost', async () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let fakeNow = originalNow();
  let failJupiter = false;
  Date.now = () => fakeNow;
  const { buildSnapshot } = await import('../server/observation-v2.js?jupiter-rich');
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('coingecko.com')) return response({
      bitcoin: { usd: 60000, usd_24h_change: 1 },
      ethereum: { usd: 3000, usd_24h_change: -1 },
      solana: { usd: 100, usd_24h_change: 2 }
    });
    if (failJupiter && (target.includes('/tokens/v2/') || target.includes('/price/v3'))) throw new Error('temporary Jupiter outage');
    if (target.includes('/tokens/v2/search')) return response([projectToken]);
    if (target.includes('/tokens/v2/')) return response([feedToken]);
    if (target.includes('/price/v3')) return response({
      [feedMint]: { usdPrice: 100, priceChange24h: 2 },
      [projectMint]: { usdPrice: 0.00000832, priceChange24h: 1.3 }
    });
    const request = JSON.parse(options.body);
    return response({ jsonrpc: '2.0', id: request.id, result: rpcResult(request.method) });
  };
  try {
    const snapshot = await buildSnapshot({
      projectTokenConfig: { mint: projectMint, status: 'indexing', source: 'test', validation: { publicKey: 'valid', mintAccount: 'valid', metadata: 'pending' } }
    });
    const project = snapshot.market.assets[0];
    assert.equal(project.mint, projectMint);
    assert.equal(project.project, true);
    assert.equal(project.marketDataStatus, 'tracking');
    assert.equal(snapshot.market.projectToken, project);
    assert.equal(snapshot.projectTokenConfig.status, 'tracking');
    assert.equal(snapshot.projectTokenConfig.validation.metadata, 'valid');
    assert.equal(project.price, 0.00000832);
    assert.equal(project.priceSource, 'jupiter price v3');
    assert.equal(project.metadataPrice, 0.00000831);
    assert.equal(project.holderCount, 321);
    assert.equal(project.marketCap, 410000);
    assert.equal(project.fdv, 490000);
    assert.equal(project.liquidityUsd, 83000);
    assert.equal(project.organicScore, 52.5);
    assert.equal(project.organicScoreLabel, 'medium');
    assert.equal(project.verified, false);
    assert.equal(project.topHoldersPercentage, 12.25);
    assert.equal(project.buyVolume, 7000);
    assert.equal(project.sellVolume, 3000);
    assert.equal(project.buys, 4000);
    assert.equal(project.sells, 2000);
    assert.equal(project.traders, 5000);
    assert.equal(project.stats5m.buyVolume, 7);
    assert.equal(project.stats1h.numTraders, 50);
    assert.equal(project.stats6h.numBuys, 400);
    assert.equal(project.stats24h.numSells, 2000);
    assert.equal(snapshot.externalSignals.length, 3);
    assert.ok(snapshot.externalSignals.every(item => item.updatedAt));

    failJupiter = true;
    fakeNow += 60_000;
    const stale = await buildSnapshot({
      projectTokenConfig: { mint: projectMint, status: 'indexing', source: 'test', validation: { publicKey: 'valid', mintAccount: 'valid', metadata: 'pending' } }
    });
    assert.equal(stale.sourceStatus.market, 'stale');
    assert.equal(stale.market.assets[0].price, project.price);
    assert.equal(stale.market.sourceTimestamps.tokens, snapshot.market.sourceTimestamps.tokens);
    assert.equal(stale.market.sourceTimestamps.prices, snapshot.market.sourceTimestamps.prices);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});

test('bare exact-mint record with a V3 price stays indexing and cannot become a candidate', async () => {
  const originalFetch = globalThis.fetch;
  const { buildSnapshot } = await import('../server/observation-v2.js?jupiter-unindexed');
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('coingecko.com')) return response({ bitcoin: { usd: 60000, usd_24h_change: 1 }, ethereum: { usd: 3000, usd_24h_change: -1 }, solana: { usd: 100, usd_24h_change: 2 } });
    if (target.includes('/tokens/v2/search')) return response(target.includes(feedMint) ? [feedToken] : [{ id: projectMint }]);
    if (target.includes('/tokens/v2/')) return response([categoryToken]);
    if (target.includes('/price/v3')) return response({ [projectMint]: { usdPrice: 0.00000832 } });
    const request = JSON.parse(options.body);
    return response({ jsonrpc: '2.0', id: request.id, result: rpcResult(request.method) });
  };
  try {
    const snapshot = await buildSnapshot({
      projectTokenConfig: { mint: projectMint, status: 'indexing', source: 'test', validation: { publicKey: 'valid', mintAccount: 'valid', metadata: 'pending' } }
    });
    const project = snapshot.market.assets[0];
    assert.equal(project.project, true);
    assert.equal(project.indexed, false);
    assert.equal(project.marketDataStatus, 'indexing');
    assert.equal(project.price, 0.00000832);
    assert.equal(project.halted, true);
    assert.equal(snapshot.projectTokenConfig.status, 'indexing');
    assert.equal(snapshot.projectTokenConfig.validation.metadata, 'pending');
    assert.equal(snapshot.market.nativeSolPrice, 100);
    assert.equal(snapshot.market.nativeSolPriceSource, 'jupiter tokens v2');
    assert.equal(snapshot.externalSignals.find(item => item.symbol === 'SOL').price, 100);
    assert.match(snapshot.externalSignals.find(item => item.symbol === 'SOL').source, /jupiter tokens v2/);
    assert.equal(snapshot.sourceStatus.market, 'live');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('complete Jupiter identity without market metrics validates metadata but remains indexing', async () => {
  const originalFetch = globalThis.fetch;
  const { buildSnapshot } = await import('../server/observation-v2.js?jupiter-identity-only');
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('coingecko.com')) return response({
      bitcoin: { usd: 60000, usd_24h_change: 1 },
      ethereum: { usd: 3000, usd_24h_change: -1 },
      solana: { usd: 100, usd_24h_change: 2 }
    });
    if (target.includes('/tokens/v2/search')) return response([{ id: projectMint, name: 'SORYN', symbol: 'SORYN' }]);
    if (target.includes('/tokens/v2/')) return response([feedToken]);
    if (target.includes('/price/v3')) return response({ [feedMint]: { usdPrice: 100 } });
    const request = JSON.parse(options.body);
    return response({ jsonrpc: '2.0', id: request.id, result: rpcResult(request.method) });
  };
  try {
    const snapshot = await buildSnapshot({
      projectTokenConfig: { mint: projectMint, status: 'indexing', source: 'test', validation: { publicKey: 'valid', mintAccount: 'valid', metadata: 'pending' } }
    });
    assert.equal(snapshot.market.projectToken.indexed, true);
    assert.equal(snapshot.market.projectToken.marketDataStatus, 'indexing');
    assert.equal(snapshot.market.projectToken.price, null);
    assert.equal(snapshot.projectTokenConfig.status, 'indexing');
    assert.equal(snapshot.projectTokenConfig.validation.metadata, 'valid');
    assert.equal(snapshot.projectTokenConfig.validation.metadataSource, 'jupiter tokens v2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
