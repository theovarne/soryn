import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SORYN_TEST_BASE || 'https://soryn.fun';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base + '/chain', { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('.code-viewer').waitFor();
  assert.equal(await page.locator('[data-tab]').count(), 4);
  assert.equal(await page.locator('[data-copy-raw]').count(), 1);
  assert.ok(await page.locator('.debug-line').count() > 5);
  assert.ok(await page.locator('.json-key').count() > 0);
  const beforeFold = await page.locator('.debug-line').count();
  await page.locator('[data-fold-path]').first().click();
  assert.ok(await page.locator('.debug-line').count() < beforeFold);
  await page.locator('[data-raw-search]').fill('getBalance');
  await page.waitForTimeout(200);
  assert.match(await page.locator('.inspection-body').innerText(), /getBalance/i);
  await page.locator('[data-reset-raw]').click();
  assert.equal(await page.locator('[data-raw-search]').inputValue(), '');
  await page.locator('[data-collapse-raw]').click();
  assert.equal(await page.locator('.code-viewer').evaluate(node=>node.classList.contains('is-collapsed')), true);
  await page.locator('[data-wrap-raw]').click();
  assert.equal(await page.locator('.code-viewer').evaluate(node=>node.classList.contains('is-wrapped')), true);
  await page.locator('[data-tab="sources"]').click();
  const sources = await page.locator('.inspection-body').innerText();
  assert.match(sources, /sourceHealth|solana/i);
  assert.match(sources, /getBalance|getSlot|jupiter/i);
  await page.locator('[data-tab="parsed"]').click();
  assert.match(await page.locator('.inspection-body').innerText(), /externalSignals/);
  assert.deepEqual(errors, []);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  console.log('PASS raw response, parsed response, diff and source inspection');
} finally {
  await browser.close();
}
