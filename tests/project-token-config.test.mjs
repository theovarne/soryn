import assert from 'node:assert/strict';
import test from 'node:test';
import { isSolanaPublicKey, readProjectTokenMint, validateMintAccount } from '../server/project-token-config.js';

const MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const response = account => ({
  ok: true,
  json: async () => ({ result: { value: account } })
});
const account = { owner: TOKEN_PROGRAM, data: { parsed: { type: 'mint', info: { decimals: 9 } } } };

test('first remote read failure is unavailable, not falsely awaiting launch', async () => {
  const result = await readProjectTokenMint({ getConfig: async () => { throw new Error('secret detail'); } });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.source, 'unavailable');
  assert.doesNotMatch(result.error, /secret detail/);
});

test('requires a true 32-byte base58 Solana public key', () => {
  assert.equal(isSolanaPublicKey(MINT), true);
  assert.equal(isSolanaPublicKey('0x1234567890abcdef'), false);
  assert.equal(isSolanaPublicKey('1'.repeat(31)), false);
  assert.equal(isSolanaPublicKey('1'.repeat(33)), false);
  assert.equal(isSolanaPublicKey('O'.repeat(44)), false);
});

test('checks that the on-chain account is an SPL mint', async () => {
  const valid = await validateMintAccount(MINT, { fetchImpl: async () => response(account) });
  assert.equal(valid.status, 'valid');
  assert.equal(valid.decimals, 9);
  const missing = await validateMintAccount(MINT, { fetchImpl: async () => response(null) });
  assert.equal(missing.status, 'invalid');
  const wrongType = await validateMintAccount(MINT, { fetchImpl: async () => response({ ...account, data: { parsed: { type: 'account' } } }) });
  assert.equal(wrongType.status, 'invalid');
  const outage = await validateMintAccount(MINT, { fetchImpl: async () => { throw new Error('RPC down'); } });
  assert.equal(outage.status, 'unavailable');
});

test('empty config awaits mint; valid account indexes; bad config cannot crash observation', async () => {
  const empty = await readProjectTokenMint({ getConfig: async () => null });
  assert.equal(empty.status, 'awaiting mint');
  assert.equal(empty.mint, null);
  const invalid = await readProjectTokenMint({ getConfig: async () => 'not-a-mint' });
  assert.equal(invalid.status, 'invalid mint');
  assert.equal(invalid.mint, null);
  const active = await readProjectTokenMint({ getConfig: async () => MINT, fetchImpl: async () => response(account) });
  assert.equal(active.status, 'indexing');
  assert.equal(active.validation.mintAccount, 'valid');
  assert.equal(active.validation.metadata, 'pending');
  const stale = await readProjectTokenMint({ getConfig: async () => { throw new Error('token should not leak'); } });
  assert.equal(stale.mint, MINT);
  assert.equal(stale.source, 'global-config-stale');
  assert.doesNotMatch(stale.error, /token should not leak/);
});
