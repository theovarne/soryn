import { get as getGlobalConfig } from '@vercel/global-config';
import { NETWORK_CONFIG, PROJECT_TOKEN_MINT } from '../dist/config.js';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);
const VALIDATION_TTL_MS = 60_000;
const accountChecks = new Map();
let lastGoodConfig = null;

// Regex alone accepts keys that do not decode to a Solana 32-byte public key.
export function isSolanaPublicKey(value) {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  let decoded = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let byteLength = 0;
  while (decoded > 0n) {
    byteLength += 1;
    decoded >>= 8n;
  }
  byteLength += value.match(/^1*/)?.[0].length || 0;
  return byteLength === 32;
}

export async function validateMintAccount(mint, options = {}) {
  if (!isSolanaPublicKey(mint)) return { status: 'invalid', reason: 'not a Solana public key' };
  const now = Date.now();
  const cached = accountChecks.get(mint);
  const ttl = cached?.value?.status === 'valid' ? VALIDATION_TTL_MS : 10_000;
  if (!options.fetchImpl && cached && now - cached.at < ttl) return cached.value;

  const fetchImpl = options.fetchImpl || fetch;
  const rpc = options.rpcUrl || process.env.SOLANA_RPC_URL || NETWORK_CONFIG.rpc;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 6_000);
  let result;
  try {
    const response = await fetchImpl(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 'soryn-project-mint', method: 'getAccountInfo',
        params: [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('rpc status ' + response.status);
    const body = await response.json();
    if (body.error) throw new Error('rpc error');
    const account = body?.result?.value;
    if (!account) result = { status: 'invalid', reason: 'mint account does not exist' };
    else if (!TOKEN_PROGRAMS.has(account.owner) || account.data?.parsed?.type !== 'mint') {
      result = { status: 'invalid', reason: 'account is not an SPL Token mint' };
    } else {
      result = {
        status: 'valid', reason: null, program: account.owner,
        decimals: Number.isInteger(account.data.parsed.info?.decimals) ? account.data.parsed.info.decimals : null
      };
    }
  } catch {
    // A public RPC outage is not evidence that a newly created mint is invalid.
    result = { status: 'unavailable', reason: 'mint account check temporarily unavailable' };
  } finally {
    clearTimeout(timeout);
  }
  if (!options.fetchImpl) accountChecks.set(mint, { at: now, value: result });
  return result;
}

function makeResult(mint, source, checkedAt, account) {
  if (mint == null || mint === '') {
    return {
      mint: null, status: 'awaiting mint', checkedAt, source,
      validation: { publicKey: 'not set', mintAccount: 'not checked', metadata: 'not checked' }, error: null
    };
  }
  if (!isSolanaPublicKey(mint)) {
    return {
      mint: null, status: 'invalid mint', checkedAt, source,
      validation: { publicKey: 'invalid', mintAccount: 'not checked', metadata: 'not checked' },
      error: 'PROJECT_TOKEN_MINT is not a Solana public key'
    };
  }
  return {
    mint,
    status: account?.status === 'invalid' ? 'invalid mint' : 'indexing',
    checkedAt, source,
    validation: {
      publicKey: 'valid', mintAccount: account?.status || 'unavailable', metadata: 'pending'
    },
    error: account?.reason || null
  };
}

// Store exactly one value: PROJECT_TOKEN_MINT. An empty/missing item means
// the system stays live while only the project token awaits deployment.
export async function readProjectTokenMint(options = {}) {
  const checkedAt = new Date().toISOString();
  const connected = Boolean(options.getConfig || process.env.GLOBAL_CONFIG || process.env.EDGE_CONFIG);
  const source = connected ? 'global-config' : 'static';
  let rawMint;
  try {
    rawMint = connected
      ? await (options.getConfig || getGlobalConfig)('PROJECT_TOKEN_MINT')
      : (options.fallbackMint !== undefined ? options.fallbackMint : PROJECT_TOKEN_MINT);
  } catch {
    if (lastGoodConfig) {
      return { ...lastGoodConfig, checkedAt, source: 'global-config-stale', error: 'remote mint config temporarily unavailable' };
    }
    return {
      mint: null, status: 'unavailable', checkedAt, source: 'unavailable',
      validation: { publicKey: 'unknown', mintAccount: 'not checked', metadata: 'not checked' },
      error: 'remote mint config temporarily unavailable'
    };
  }
  const mint = rawMint == null ? null : String(rawMint).trim();
  const account = mint && isSolanaPublicKey(mint)
    ? await validateMintAccount(mint, { fetchImpl: options.fetchImpl, rpcUrl: options.rpcUrl, timeoutMs: options.timeoutMs })
    : null;
  const result = makeResult(mint, source, checkedAt, account);
  lastGoodConfig = result;
  return result;
}
