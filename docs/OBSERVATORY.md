# Observatory

[soryn.fun](https://soryn.fun/) is an observation interface. It combines a read-only public API response with the current browser's local simulation record. The five navigation views answer different questions:

| View | Question | What it shows |
| --- | --- | --- |
| [Day](https://soryn.fun/day) | What has SORYN done here? | Local wake, snapshot, decision, paper-act, rest, and failure records; a 24-hour event timeline and Eastern-day counts |
| [Holdings](https://soryn.fun/holdings) | What does the observed wallet hold? | Public SOL and token balances, USD valuation where quoted, recent real signatures, and local saved balance extrema |
| [Board](https://soryn.fun/board) | What market can SORYN see? | Jupiter token universe, prices, moves, feed counts, and BTC/ETH/SOL reference cards |
| [Chain](https://soryn.fun/chain) | What is Solana reporting? | RPC slot, block height, epoch, blockhash, priority-fee sample, wallet activity, and structured inspection JSON |
| [Brain](https://soryn.fun/brain) | How does the local loop decide? | Loop stages, genesis rules, and the most recent local decision |

The [home page](https://soryn.fun/) previews these views: public wallet valuation, local act counts, a sample of holdings, the board, chain values, and loop state. The observed wallet and project-token mint are separate identities; the project token currently awaits deployment.

## Reading the numbers

`live`, `stale`, and `unavailable` labels describe the observation source, not a promise that every field has a value. A tile can have a live market source and still lack a quote or liquidity field for that specific mint. The board's token counts describe the watched Jupiter feeds, not the number of tokens held by the wallet. Hover or focus a token tile for its mint, available metrics, and data completeness.

The wallet balance comes from Solana RPC. Dollar values use Jupiter quotes and become unavailable when a nonzero holding cannot be valued. Recent signatures and the latest transaction on Holdings or Chain describe actual historical activity at the public address. Day's `act` entries are paper actions in this browser and have no transaction signature.

The Day and Brain histories belong to the local browser. A fresh browser can show no acts or decisions even while the live wallet and market observation load normally. The page polls the read-only API about every 30 seconds; it can display a saved observation as stale during an upstream outage, but a stale observation cannot start a new decision cycle. Closing the page stops that local loop.

Times in the interface use America/New_York (ET), including the daily act cap. Chain and provider timestamps remain attached to the observation for provenance. For each displayed source, see [Data Sources](DATA_SOURCES.md); for paper actions, see [Simulation](SIMULATION.md).
