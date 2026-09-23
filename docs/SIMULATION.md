# Simulation Boundary

SORYN currently runs in `simulation` mode. The site reads a public Solana wallet and live market sources when available, but a chosen `act` is a browser-local paper event. It does **not** sign a transaction, broadcast to Solana, consume wallet funds, call a swap endpoint, or invent a transaction signature.

## What a paper act records

After a browser wake and a successful weigh, [`dist/agent.js`](../dist/agent.js) can open at most one paper position for the selected candidate. It requires a `buy` or `sell` label, positive quote, and positive notional. The notional is `wallet.portfolioUsd × 0.04`, based on the observed wallet valuation at that cycle. The stored row contains a mint and symbol, side, entry/current price, notional, derived quantity, time, cycle ID, snapshot ID, and `executionMode: simulation`.

A `sell` label means the asset was held by the observed wallet and had a negative 24-hour move when scored. It still opens a separate paper side; it does not sell or reduce the real holding. Paper positions are marked with later observed market prices. Their displayed P&L is `(current - entry) × quantity` for buys and the reverse for sells. This is a simple marked simulation without a filled order, fees, slippage, or realized cash accounting.

The decision trace and `act` record are saved in browser localStorage. `act` records have `signature: null`; real wallet signatures shown on Holdings and Chain come only from Solana RPC. Paper positions and observed wallet holdings are held in different structures and never merged into a chain balance.

## Guardrails in the current code

- A new local cycle needs a fresh observation with chain, wallet, and market all marked `live`.
- Wakes are separated by at least 45 minutes in that browser profile.
- The local record permits no more than six simulated `act` events per America/New_York day.
- A candidate needs a valid quote, at least $25,000 of reported liquidity, a positive complete wallet valuation, and a score of at least `0.08` after eligibility filtering.
- A selected action still becomes no paper position if the entry price or notional is unusable.

These are simulation rules, not execution risk controls for a real trading system. There is no signer or transaction-submission path to enable through an environment flag.

## Persistence and interpretation

Records, snapshots, cycles, and paper positions are local to the browser's `localStorage` and have bounded retention. They are not a shared ledger, server database, wallet transaction log, or independently running 24/7 agent history. Clearing local storage or opening another browser changes what the interface can show. Closing the page stops observation polling and the local wake loop.

The site's observed wallet balance can change because of independent on-chain activity. Such activity must not be attributed to a SORYN paper decision without separate evidence. Conversely, a paper decision must not be described as a transaction on Solana.
