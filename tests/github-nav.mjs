import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const dist = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const mime = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const observation = {
  timestamp: new Date().toISOString(),
  sourceStatus: { chain: 'unavailable', wallet: 'unavailable', market: 'unavailable', external: 'unavailable' },
  chain: { network: 'solana', cluster: 'mainnet-beta' },
  wallet: { address: null, positions: [], recentSignatures: [] },
  market: { assets: [], quoteCount: 0 },
  externalSignals: [],
  projectTokenConfig: { status: 'not deployed', mint: null },
  lastTransaction: null
};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/agent') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(observation));
    return;
  }
  const requested = extname(pathname) ? pathname : '/index.html';
  const filename = resolve(dist, '.' + requested);
  if (!filename.startsWith(dist + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    response.setHeader('Content-Type', mime[extname(filename)] || 'application/octet-stream');
    response.end(await readFile(filename));
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('.nav-github').first().waitFor({ state: 'attached' });

    for (const selector of ['.nav', '.mobile-nav']) {
      const links = page.locator(`${selector} > a.nav-lnk`);
      const github = links.first();
      assert.equal(await links.nth(1).innerText(), 'day', `${selector}: GitHub is immediately before day`);
      assert.equal(await github.getAttribute('href'), 'https://github.com/theovarne/soryn');
      assert.equal(await github.getAttribute('target'), '_blank');
      assert.deepEqual((await github.getAttribute('rel')).split(' ').sort(), ['noopener', 'noreferrer']);
      assert.equal(await github.getAttribute('aria-label'), 'SORYN GitHub');
      assert.equal(await github.getAttribute('title'), 'GitHub');
      assert.equal(await github.locator('svg[aria-hidden="true"] path').count(), 1);
    }

    const activeNav = page.locator(width <= 720 ? '.mobile-nav' : '.nav');
    const githubBox = await activeNav.locator('.nav-github').boundingBox();
    const dayBox = await activeNav.locator('a[href="/day"]').boundingBox();
    assert.ok(githubBox && dayBox && githubBox.x + githubBox.width < dayBox.x, `visual order at ${width}px`);
    assert.equal(await activeNav.isVisible(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `document overflows at ${width}px`);
    assert.deepEqual(errors, [], `console errors at ${width}px`);
    await page.close();
  }
  console.log('PASS GitHub nav position, link attributes, mobile width and browser console');
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
