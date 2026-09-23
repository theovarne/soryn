import { readProjectTokenMint } from '../server/project-token-config.js';

const config = await readProjectTokenMint();
const mint = config.mint ? config.mint.slice(0, 5) + '…' + config.mint.slice(-4) : null;
console.log(JSON.stringify({
  mint, status: config.status, source: config.source,
  validation: config.validation, checkedAt: config.checkedAt, error: config.error
}, null, 2));
if (config.source === 'unavailable') process.exitCode = 1;
