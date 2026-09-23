# Decision Engine

The current engine is the deterministic `weigh(observation)` function in [`dist/weigh.js`](../dist/weigh.js). It uses the assembled observation from [`server/observation-v2.js`](../server/observation-v2.js). It is an additive ruleset, with no external AI-model call.

## From observation to candidates

Each `observation.market.assets` row becomes one scored candidate. The row keeps its mint, symbol, quote, liquidity, activity, audit fields, score components, and an eligibility reason. A separate `DO NOTHING` candidate is always included with score `0` and is always eligible. Candidates are sorted by score, but the chosen market candidate must also pass every eligibility gate.

The engine marks an asset eligible only when all of these hold:

1. `sourceStatus.chain`, `.wallet`, and `.market` are all `live`.
2. The observed `wallet.portfolioUsd` is finite and greater than zero.
3. The asset has a numeric `liquidityUsd` of at least **$25,000**.
4. The asset is not marked `halted`.
5. The asset has a positive numeric price quote.

An absent field is not replaced with an invented value. For example, missing liquidity yields `liquidity unavailable`, and incomplete wallet valuation yields `wallet value unavailable`. External reference data is a score input but is not one of the three critical source gates.

## Score components

The score is the sum of the non-`null` components below. `clamp(x, a, b)` limits `x` to the interval `[a,b]`. The constants come from `GENESIS_CONFIG` in [`dist/config.js`](../dist/config.js).

| Component | Current calculation | If input is missing |
| --- | --- | --- |
| Price momentum | `clamp(change24h / 100 × 0.35, -0.35, 0.35)` | `null` |
| Liquidity quality | `clamp(log10(max(liquidityUsd, 1) / 25000) × 0.08, -0.16, 0.16)` | `null` |
| Buy/sell imbalance | `(buyVolume - sellVolume) / (buyVolume + sellVolume) × 0.20`, when sum is positive | `null` |
| Trader activity | `clamp(log10(max(traders, 1)) / 10 × 0.08, 0, 0.08)` | `null` |
| Organic quality | `clamp(organicScore / 100 × 0.08, -0.08, 0.08)` | `null` |
| Holder penalty | `-clamp(holderConcentration / 100 × 0.08, 0, 0.08)` | `null` |
| Wallet exposure | `-0.04` if the same mint is held; otherwise `0` | `0` |
| Verification adjustment | `+0.01` when true; `-0.01` when false | `null` |
| External context | Average available BTC, ETH, and SOL 24-hour percentage moves, divided by 100 and clamped to `[-1,1]`, then multiplied by `0.05` | `null` |
| Deterministic noise | Hash-derived value in `[-0.03,+0.03]` | Always present |

Wallet exposure matches by mint when both sides have a mint; a duplicate symbol is not enough to count as a holding. The external component uses available `externalSignals` moves; absent moves are omitted from its average.

Noise uses an FNV-style 32-bit hash of the candidate mint (or symbol) and the observation timestamp truncated to its UTC hour. The same candidate and timestamp hour produce the same noise value. This introduces bounded tie-breaking variation, not an independent random draw on every render.

## Choice and trace

The engine selects the highest-scoring **eligible** candidate only if its score is at least the configured `0.08` do-nothing margin. Otherwise it chooses `DO NOTHING`. The zero baseline itself never opens a position. If the browser has already recorded six `act` events on the current Eastern day, `dist/agent.js` changes an otherwise active choice to do nothing before recording the decision.

Illustrative decision, **not a current market quote or live trace**:

```text
candidate       score    eligible    outcome
TOKEN_A         0.075    yes         below 0.080 margin
TOKEN_B         0.042    yes         lower score
DO NOTHING      0.000    yes         chosen
```

The trace retains the chosen candidate, reason, eligible count, runner-up, component values, noise, formula version, required margin, and a paper notional equal to 4% of the observed portfolio USD value when that value is available. Candidate action is `sell` only when the asset has a negative 24-hour move **and** the wallet already holds the mint; otherwise it is `buy`. This action label is a simulated direction, not a Solana order.

When a market candidate clears the margin, [`dist/agent.js`](../dist/agent.js) opens a separate paper position only if the selected side, positive price, and positive notional are present. The position and decision are saved in browser localStorage. The real wallet and chain remain untouched. See [Simulation](SIMULATION.md).
