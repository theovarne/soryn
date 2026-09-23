import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.SORYN_TEST_BASE || 'https://soryn.fun';
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-health-toggle]').waitFor();
  await page.locator('[data-health-toggle]').click();
  const health = await page.locator('.health-panel').innerText();
  for (const field of ['system', 'live', 'solana rpc', 'jupiter tokens', 'jupiter prices', 'external references', 'agent', 'execution', 'project token']) {
    assert.match(health, new RegExp(field, 'i'));
  }
  assert.match(health, /simulation/i);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await mobile.locator('[data-health-toggle]').click();
  assert.equal(await mobile.locator('.health-row').first().locator('span').last().evaluate(element => getComputedStyle(element).display !== 'none'), true);
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  for (const route of ['day', 'holdings', 'board', 'chain', 'brain']) {
    await mobile.goto(base + '/' + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await mobile.waitForTimeout(200);
    assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), route + ' overflows at 390px');
  }

  await page.goto(base + '/brain', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const tokenNode = page.locator('[data-network-node="tokens"]');
  await tokenNode.waitFor();
  await tokenNode.hover();
  assert.match(await page.locator('.network-detail').innerText(), /token universe/i);
  await page.locator('[data-network-node="context"]').click();
  assert.match(await page.locator('.network-detail').innerText(), /BTC \/ ETH \/ SOL/i);
  assert.deepEqual(errors, []);
  console.log('PASS System Health, interactive Brain network and mobile status visibility');
} finally {
  await browser.close();
}
