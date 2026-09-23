import assert from 'node:assert/strict';
import { PERSISTENCE_MODE, EXECUTION_MODE, SORYN_SOL_WALLET } from '../dist/config.js';
assert.equal(PERSISTENCE_MODE, 'local');
assert.equal(EXECUTION_MODE, 'simulation');
assert.match(SORYN_SOL_WALLET, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
console.log('PASS server database and scheduler paths are disabled; browser localStorage is the persistence boundary');
