import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.SORYN_TEST_BASE || 'http://127.0.0.1:4193';
const mint = 'So11111111111111111111111111111111111111112';
const quoted = {
  mint: 'QuotedMint1111111111111111111111111111111111', symbol: 'MICRO', name: 'Micro Asset',
  price: 0.00000831, change24h: 4.2, liquidityUsd: 3410000, marketCap: 1070000000,
  fdv: 1200000000, holderCount: 1500, organicScore: 88, organicScoreLabel: 'high',
  verified: true, holderConcentration: 12.5, buyVolume: 1200000, sellVolume: 3410000,
  buys: 125, sells: 81, traders: 300, priceSource: 'jupiter price v3'
};
const project = {
  mint, symbol: 'SORYN', name: 'SORYN', project: true, marketDataStatus: 'indexing',
  price: null, liquidityUsd: null, holderCount: 200, organicScore: null,
  buyVolume: null, sellVolume: null, buys: null, sells: null, traders: null
};
const observedAt = '2026-09-23T12:00:00.000Z';
const fixture = {
  timestamp: observedAt, stale: true,
  sourceStatus: { chain: 'live', wallet: 'live', market: 'live', external: 'live', transactions: 'live' },
  sourceHealth: { coingecko: { status: 'live', lastSuccess: observedAt } },
  chain: { network: 'solana', cluster: 'mainnet-beta', slot: 123 },
  wallet: { address: 'CHJiv2s8QsaD3EbR8FrPt5hBPhKr77Rs85QFappXuPLf', solBalance: 0, portfolioUsd: 0, nativeValueUsd: 0, positions: [], tokenAccountsCount: 0 },
  market: { assets: [project, quoted], projectToken: project, quoteCount: 1, universeSize: 2, sourceTimestamp: observedAt, counts: {} },
  externalSignals: [
    { symbol: 'BTC', price: 85968, dailyMovePct: 0.15, source: 'coingecko simple/price', status: 'live' },
    { symbol: 'ETH', price: 2670, dailyMovePct: -0.38, source: 'coingecko simple/price', status: 'live' },
    { symbol: 'SOL', price: 171, dailyMovePct: 1.22, source: 'jupiter price v3 / coingecko', status: 'live' }
  ],
  projectTokenConfig: { mint, status: 'indexing' }
};
const browser = await chromium.launch({ headless: true });
try {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/agent', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await page.goto(base + '/board', { waitUntil: 'domcontentloaded' });
  await page.locator('.external-tile').first().waitFor();
  assert.equal(await page.locator('.external-tile').count(), 3);
  const external = await page.locator('.external-tiles').innerText();
  for (const symbol of ['BTC', 'ETH', 'SOL']) assert.match(external, new RegExp(symbol));
  assert.match(external, /live.*ET/s);

  await page.locator('.external-tile').first().hover();
  const tooltip = await page.locator('#tooltip').innerText();
  for (const field of ['BTC', 'price', '24h', 'source', 'updated', 'status']) assert.match(tooltip, new RegExp(field, 'i'));
  assert.doesNotMatch(tooltip, /liquidity|holders|organic|candidate|eligible|score/i);
  const rect = await page.locator('#tooltip').boundingBox();
  assert.ok(rect && rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 1441 && rect.y + rect.height <= 901);

  await page.locator('.tile.project-token').first().click();
  let inspector = await page.locator('[data-asset-inspector]').innerText();
  assert.match(inspector, /project/);
  assert.match(inspector, /candidate\s+unavailable/);
  assert.match(inspector, /data 1 \/ 5/);
  assert.match(inspector, /missing data: price, liquidity, activity, organic/);

  await page.locator('.tile[data-symbol="MICRO"]').click();
  inspector = await page.locator('[data-asset-inspector]').innerText();
  assert.match(inspector, /\$0\.00000831/);
  assert.match(inspector, /\$1\.2M/);
  assert.match(inspector, /organic label\s+high/);
  assert.match(inspector, /data 5 \/ 5/);
  await page.locator('[data-ca-copy]').click();
  const caInspector = await page.locator('[data-token-ca-inspector]').innerText();
  assert.match(caInspector, /SORYN token/i);
  assert.match(caInspector, /indexing · waiting for market data/i);
  assert.match(caInspector, /copy mint/i);
  assert.match(caInspector, /open in Solscan/i);
  assert.deepEqual(errors, []);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('pageerror', error => errors.push(error.message));
  mobile.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await mobile.route('**/api/agent', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }));
  await mobile.goto(base + '/board', { waitUntil: 'domcontentloaded' });
  await mobile.locator('.external-tile').first().waitFor();
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log('PASS Board references, project pin, token data completeness and mobile layout');
} finally {
  await browser.close();
}
