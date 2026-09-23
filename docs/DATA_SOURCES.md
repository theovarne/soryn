# Data Sources and Provenance

The public observation is built by [`server/observation-v2.js`](../server/observation-v2.js) and served at `GET /api/agent`. Browser code in [`dist/services.js`](../dist/services.js) polls it about every 30 seconds. The API has a short in-process result cache (10 seconds) and a five-second shared-cache header. Jupiter token-universe and price requests also use per-process caches of 45 and 25 seconds respectively. These are cache ceilings, not promises of upstream freshness.

Every response includes a timestamp, `sourceStatus`, detailed `sourceHealth` (status, endpoint, checked time, latency, last success, error), and a `provenance` section. `live` means the relevant request succeeded, `stale` means a partial or saved observation is being shown, and `unavailable` means the value cannot be supplied. A display value should be interpreted with its source status and source timestamp.

## Field map

| UI field or group | Source and method | Refresh path | Missing or fallback behavior |
| --- | --- | --- | --- |
| Chain slot, block height, epoch | Solana mainnet-beta RPC: `getSlot`, `getBlockHeight`, `getEpochInfo` | Each uncached API build | Individual fields may be `null`; partial critical reads mark chain stale |
| Latest blockhash, last valid block height | Solana RPC: `getLatestBlockhash` | Each uncached API build | `null` if unavailable |
| Priority-fee sample | Solana RPC: `getRecentPrioritizationFees`; median of returned fees | Each uncached API build | `null` if no valid sample; not an execution fee quote |
| SOL balance | Solana RPC: `getBalance` for the configured public wallet | Each uncached API build | `null` if wallet read fails; never substituted with zero |
| SPL Token / Token-2022 accounts and balances | Solana RPC: `getTokenAccountsByOwner` for both programs | Each uncached API build | Wallet source unavailable on malformed or failed account reads |
| Recent wallet signatures | Solana RPC: `getSignaturesForAddress`, up to 20 | Each uncached API build | Unavailable with the wallet read; signatures are real wallet history, not paper actions |
| Latest transaction details | Solana RPC: `getTransaction` for the newest signature | Each uncached API build | Detail may be unavailable even when the signature list is present |
| Token universe and feed counts | Jupiter Tokens V2: top trending, top traded, top organic score, recent | Up to 45-second process cache | Partial feed failure is marked stale; total failure may reuse a stale cached result |
| Token symbol, name, icon, holder count, organic score, verification, holder concentration | Jupiter Tokens V2 metadata and audit fields | Up to 45-second process cache | Missing fields remain `null` or unavailable |
| Token USD price | Jupiter Price V3 by mint, in batches of at most 50; Tokens V2 `usdPrice` as attributed fallback | Up to 25-second process cache | Missing quote remains `null`; a V2 quote reports its own source |
| 24-hour token move, liquidity, buy/sell volume, trade counts, traders | Jupiter Tokens V2 stats and token metadata; a Price V3 field is considered for move/liquidity where available | Market observation | Missing numeric metrics remain `null` |
| SOL USD valuation | Jupiter Price V3 for wrapped SOL, then Tokens V2 quote if needed | Market observation | `null` when neither real quote is available |
| BTC and ETH reference USD price and 24-hour move | CoinGecko `simple/price` | Each uncached API build | Partial fields stale; saved browser fields can be retained and marked stale |
| SOL reference | Jupiter SOL USD quote plus CoinGecko SOL 24-hour move | Market and external observation | Partial or missing inputs mark the reference stale or unavailable |
| Wallet position USD values | RPC token balances × Jupiter mint prices | Each assembled observation | A missing price yields unknown value, not zero |
| Portfolio USD | Sum of SOL and token values only when valuation is complete | Each assembled observation | `null` if a nonzero holding lacks a quote; known partial value is separate |
| Project-token mint and tracking status | Vercel Global Config item `PROJECT_TOKEN_MINT`; Solana `getAccountInfo`; Jupiter mint metadata | Each observation, with short mint-validation cache | No configured mint means `awaiting mint`; invalid/unindexed mint is not shown as deployed |
| Day records, latest decision, snapshot history, paper positions | Current browser's `localStorage`, created by `dist/agent.js` | On browser wake and observation updates | Empty in a fresh browser; never inferred from chain signatures |

The configured public wallet is `CHJiv2s8QsaD3EbR8FrPt5hBPhKr77Rs85QFappXuPLf`. The project token is a separate concept and is not deployed. A local or hosted `PROJECT_TOKEN_MINT` **environment variable** is not read as the mint activation setting: the current server uses a Vercel Global Config item with that name when Global Config is connected, otherwise the static `null` in `dist/config.js`.

## Source and cache behavior

Solana RPC uses `SOLANA_RPC_URL` (defaulting to the public mainnet endpoint) and optional comma-separated `SOLANA_RPC_FALLBACK_URLS`. Jupiter uses `api.jup.ag` when a server-only `JUPITER_API_KEY` is configured; otherwise it uses `lite-api.jup.ag`. With a key, the lite API is a request fallback. External BTC, ETH, and SOL moves come from CoinGecko's Simple Price endpoint.

The server can reuse a previously successful Jupiter result inside the same process and mark it stale. The browser also saves its last observation and usable market data in localStorage. If an API request fails, that saved view is labeled stale; with no cache, the UI displays unavailable values. Critical chain, wallet, or market status other than `live` prevents a new local decision cycle. A stale display is therefore an observation aid, not permission to simulate an act.

The Chain page's latest signature describes historical activity at the observed public wallet. It is not evidence that SORYN signed or broadcast a trade. Simulated acts have `signature: null` in their local records.
