import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SORYN_TEST_BASE || 'https://soryn.fun';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base + '/brain', { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('[data-loop-node="weigh"]').click();
  assert.match(await page.locator('.loop-detail').innerText(), /weigh/i);
  await page.goto(base + '/chain', { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('.code-viewer').waitFor();
  assert.equal(await page.locator('[data-tab]').count(), 4);
  await page.locator('[data-tab="parsed"]').click();
  assert.match(await page.locator('.inspection-body').innerText(), /solana/i);
  await page.locator('[data-tab="diff"]').click();
  assert.match(await page.locator('.inspection-body').innerText(), /available|not enough observations/i);
  console.log('PASS loop interaction and chain inspection tabs');
} finally {
  await browser.close();
}
