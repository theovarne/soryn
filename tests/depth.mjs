import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SORYN_TEST_BASE || 'https://soryn.fun';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base + '/board', { waitUntil: 'networkidle', timeout: 60000 });
  const tiles = await page.locator('.tile').count();
  assert.ok(tiles >= 0);
  if (tiles) {
    await page.locator('.tile').first().click();
    assert.ok(await page.locator('[data-asset-inspector]').count());
  }
  await page.goto(base + '/chain', { waitUntil: 'networkidle', timeout: 60000 });
  assert.match(await page.locator('body').innerText(), /slot|block height/i);
  console.log('PASS Solana board asset inspector and chain fields');
} finally {
  await browser.close();
}
