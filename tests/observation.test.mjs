import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JUPITER_MIN_INTERVAL_MS = '0';
const { buildSnapshot } = await import('../server/observation-v2.js');

const response = value => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  async json() { return value; }
});

test('unavailable wallet remains unavailable instead of becoming a fake zero portfolio', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline test'); };
  try {
    const snapshot = await buildSnapshot();
    assert.equal(snapshot.sourceStatus.wallet, 'unavailable');
    assert.equal(snapshot.sourceStatus.transactions, 'unavailable');
    assert.equal(snapshot.wallet.portfolioUsd, null);
    assert.equal(snapshot.wallet.valuationComplete, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('Price V3 omissions use attributed Tokens V2 price and cached source timestamps stay unchanged', async () => {
  const original = globalThis.fetch;
  const token = {
    id: 'Mint111111111111111111111111111111111111111',
    symbol: 'TRUTH',
    name: 'Truth Token',
    usdPrice: 999,
    liquidity: 50000,
    stats24h: { priceChange: 4, buyVolume: 20, sellVolume: 10, numTraders: 3 }
  };
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('coingecko.com')) return response({ bitcoin: { usd: 60000, usd_24h_change: 1 }, ethereum: { usd: 3000, usd_24h_change: -1 } });
    if (target.includes('/tokens/v2/')) return response([token]);
    if (target.includes('/price/v3')) {
      return response({ So11111111111111111111111111111111111111112: { usdPrice: 120, blockId: 123, priceChange24h: 1 } });
    }
    const request = JSON.parse(options.body);
    const result = {
      getSlot: 123,
      getBlockHeight: 100,
      getEpochInfo: { epoch: 5, slotIndex: 1, slotsInEpoch: 10 },
      getLatestBlockhash: { context: { slot: 123 }, value: { blockhash: 'real-blockhash', lastValidBlockHeight: 200 } },
      getRecentPrioritizationFees: [],
      getBalance: { context: { slot: 123 }, value: 99074033 },
      getTokenAccountsByOwner: { context: { slot: 123 }, value: [] },
      getSignaturesForAddress: [{ signature: 'real-signature', slot: 99, blockTime: 1700000000, confirmationStatus: 'finalized', err: null }],
      getTransaction: { slot: 99, blockTime: 1700000000, transaction: { message: { instructions: [] } }, meta: { fee: 5000, err: null, computeUnitsConsumed: 100, innerInstructions: [] } }
    }[request.method];
    return response({ jsonrpc: '2.0', id: request.id, result });
  };
  try {
    const first = await buildSnapshot();
    const second = await buildSnapshot();
    const asset = first.market.assets.find(item => item.mint === token.id);
    assert.equal(asset.price, 999);
    assert.equal(asset.metadataPrice, 999);
    assert.equal(asset.priceSource, 'jupiter tokens v2');
    assert.ok(asset.quoteAt);
    assert.equal(first.market.quoteCount, 1);
    assert.equal(first.sourceStatus.market, 'live');
    assert.equal(first.cycleCritical.ready, true);
    assert.equal(first.stale, false);
    assert.equal(first.sourceStatus.transactions, 'live');
    assert.equal(first.wallet.solBalance, 0.099074033);
    assert.equal(first.market.sourceTimestamps.tokens, second.market.sourceTimestamps.tokens);
    assert.equal(first.market.sourceTimestamps.prices, second.market.sourceTimestamps.prices);
  } finally {
    globalThis.fetch = original;
  }
});
