import { EXECUTION_MODE, GENESIS_CONFIG, NETWORK_CONFIG, PROJECT_TOKEN_MINT, SORYN_SOL_WALLET } from '../dist/config.js';

const configuredWallet = String(process.env.SORYN_SOL_WALLET || SORYN_SOL_WALLET).trim();

export const RULES = GENESIS_CONFIG;
export const NETWORK = NETWORK_CONFIG;
export const SOL_WALLET = configuredWallet;
export const PROJECT_MINT = PROJECT_TOKEN_MINT;

export function agentAddress() {
  return SOL_WALLET;
}

export function requireSimulation() {
  if ((process.env.EXECUTION_MODE || EXECUTION_MODE) !== 'simulation') {
    throw new Error('simulation mode required');
  }
}

export function rpcUrl() {
  return process.env.SOLANA_RPC_URL || NETWORK_CONFIG.rpc;
}

export function jupiterApiKey() {
  return process.env.JUPITER_API_KEY || '';
}
