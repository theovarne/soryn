export const PROJECT_NAME = "soryn";
export const PROJECT_SYMBOL = "SORYN";
export const PROJECT_TAGLINE = "a small autonomous program living on solana.";
export const PROJECT_NUMBER = "01";
// The project token is intentionally not deployed yet. Set this mint only after deployment.
export const PROJECT_TOKEN_MINT = null;
export const PROJECT_TOKEN_CA = PROJECT_TOKEN_MINT;
export const SORYN_SOL_WALLET = "CHJiv2s8QsaD3EbR8FrPt5hBPhKr77Rs85QFappXuPLf";
// Compatibility alias for the browser runtime; this is the configured Solana address.
export const AGENT_WALLET = SORYN_SOL_WALLET;
export const PERSISTENCE_MODE = "local";
export const EXECUTION_MODE = "simulation";
export const NETWORK_CONFIG = Object.freeze({
  name: "solana",
  cluster: "mainnet-beta",
  nativeSymbol: "SOL",
  rpc: "https://api.mainnet.solana.com",
  explorer: "https://explorer.solana.com",
  accountExplorer: "https://solscan.io/account",
  transactionExplorer: "https://solscan.io/tx",
  commitment: "confirmed"
});
export const GENESIS_CONFIG = Object.freeze({
  maxActsPerDay: 6,
  minMinutesBetweenActs: 45,
  walletSlice: 0.04,
  minimumLiquidityUsd: 25000,
  doNothingMargin: 0.08,
  noise: 0.03
});
export const REFRESH_CONFIG = Object.freeze({
  chainMs: 15000,
  walletMs: 20000,
  marketMs: 30000
});
