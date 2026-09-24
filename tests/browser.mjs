import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.SORYN_TEST_BASE || 'https://soryn.fun';
const browser = await chromium.launch({ headless: true });
try {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // The app intentionally polls live Solana data, so networkidle never settles.
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  assert.match(await page.locator('body').innerText(), /soryn lives on solana/i);
  assert.equal(await page.locator('a.nav-lnk').filter({ hasText: 'x' }).first().getAttribute('href'), 'https://x.com/soryn_day');
  const api = await page.evaluate(async () => fetch('/api/agent').then(response => response.json()));
  assert.equal(api.chain.network, 'solana');
  assert.equal(api.chain.cluster, 'mainnet-beta');
  assert.equal(api.wallet.address, 'CHJiv2s8QsaD3EbR8FrPt5hBPhKr77Rs85QFappXuPLf');
  assert.equal(api.executionMode, 'simulation');
  await page.close();
  for (const route of ['day', 'holdings', 'board', 'chain', 'brain']) {
    const routeErrors = [];
    const routePage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    routePage.on('pageerror', error => routeErrors.push(error.message));
    routePage.on('console', message => { if (message.type() === 'error') routeErrors.push(message.text()); });
    await routePage.goto(base + '/' + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await routePage.waitForTimeout(1500);
    assert.ok(await routePage.locator('footer').count());
    assert.ok(await routePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(routeErrors, []);
    await routePage.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS Solana production routes, API identity, X link and responsive width');
} finally {
  await browser.close();
}
