import { GENESIS_CONFIG } from './config.js';

const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function deterministicNoise(seed, timestamp) {
  // The mint (or symbol) and UTC hour produce the same bounded tie-breaker on replay.
  let hash = 2166136261;
  const text = String(seed || '') + ':' + String(timestamp || '').slice(0, 13);
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((((hash >>> 0) % 10001) / 10000) * 2 - 1) * GENESIS_CONFIG.noise;
}

function externalBias(observation) {
  const values = observation.externalSignals || observation.market?.external || [];
  const moves = values.map(item => number(item.dailyMovePct)).filter(value => value !== null);
  return moves.length ? clamp(moves.reduce((sum, value) => sum + value, 0) / moves.length / 100, -1, 1) : null;
}

export function weigh(observation) {
  const rules = GENESIS_CONFIG;
  // Only live critical reads can produce an eligible paper-action candidate.
  const sourcesReady = observation.sourceStatus?.chain === 'live' &&
    observation.sourceStatus?.market === 'live' &&
    observation.sourceStatus?.wallet === 'live';
  const capital = number(observation.wallet?.portfolioUsd);
  const capitalReady = capital !== null && capital > 0;
  const context = externalBias(observation);
  const candidates = (observation.market?.assets || []).map(asset => {
    const movement = number(asset.change24h ?? asset.dailyMovePct);
    const liquidity = number(asset.liquidityUsd);
    const buyVolume = number(asset.buyVolume);
    const sellVolume = number(asset.sellVolume);
    const traders = number(asset.traders);
    const organic = number(asset.organicScore);
    const holderConcentration = number(asset.holderConcentration);
    const verified = asset.verified === true ? true : asset.verified === false ? false : null;
    const held = (observation.wallet?.positions || []).some(position => {
      if (asset.mint && position.mint) return position.mint === asset.mint;
      return !asset.mint && !position.mint && Boolean(asset.symbol) && position.symbol === asset.symbol;
    });
    const noise = deterministicNoise(asset.mint || asset.symbol, observation.timestamp);
    const imbalance = buyVolume !== null && sellVolume !== null && buyVolume + sellVolume > 0
      ? clamp((buyVolume - sellVolume) / (buyVolume + sellVolume), -1, 1) : null;
    // Unknown metrics stay null in the trace and do not contribute to the sum.
    const components = {
      priceMomentum: movement === null ? null : clamp(movement / 100 * 0.35, -0.35, 0.35),
      liquidityQuality: liquidity === null ? null : clamp(Math.log10(Math.max(liquidity, 1) / rules.minimumLiquidityUsd) * 0.08, -0.16, 0.16),
      buySellImbalance: imbalance === null ? null : imbalance * 0.2,
      traderActivity: traders === null ? null : clamp(Math.log10(Math.max(traders, 1)) / 10 * 0.08, 0, 0.08),
      organicQuality: organic === null ? null : clamp(organic / 100 * 0.08, -0.08, 0.08),
      externalContext: context === null ? null : context * 0.05,
      walletExposure: held ? -0.04 : 0,
      holderPenalty: holderConcentration === null ? null : -clamp(holderConcentration / 100 * 0.08, 0, 0.08),
      verifiedAdjustment: verified === null ? null : (verified ? 0.01 : -0.01),
      noise
    };
    const score = Object.values(components).filter(value => value !== null).reduce((sum, value) => sum + value, 0);
    const quoteReady = number(asset.price) !== null && number(asset.price) > 0;
    const liquidityOk = liquidity !== null && liquidity >= rules.minimumLiquidityUsd;
    // Eligibility is independent of score: missing valuation, liquidity, or quote blocks action.
    const eligible = sourcesReady && capitalReady && liquidityOk && !asset.halted && quoteReady;
    const reason = !sourcesReady ? 'insufficient execution data' :
      !capitalReady ? 'wallet value unavailable' :
      liquidity === null ? 'liquidity unavailable' :
      !liquidityOk ? 'minimum liquidity not met' :
      asset.halted ? 'token unavailable' :
      !quoteReady ? 'quote unavailable' : 'eligible';
    const action = movement !== null && movement < 0 && held ? 'sell' : 'buy';
    return {
      mint: asset.mint || null,
      symbol: asset.symbol || null,
      action,
      score,
      noise,
      price: number(asset.price),
      change24h: movement,
      liquidityUsd: liquidity,
      buyVolume,
      sellVolume,
      traders,
      holderConcentration,
      verified,
      held,
      halted: Boolean(asset.halted),
      eligible,
      reason,
      components,
      inputs: {
        mint: asset.mint || null,
        movement,
        liquidityUsd: liquidity,
        buyVolume,
        sellVolume,
        traders,
        organicScore: organic,
        holderConcentration,
        verified,
        externalContext: context,
        held,
        price: number(asset.price),
        source: asset.source || 'jupiter token and price api'
      }
    };
  }).sort((a, b) => b.score - a.score);
  const eligible = candidates.filter(candidate => candidate.eligible);
  const best = eligible[0] || null;
  // Doing nothing is a real zero-score candidate, not an omitted decision.
  const rest = {
    mint: null,
    symbol: 'DO NOTHING',
    action: 'do nothing',
    score: 0,
    price: null,
    liquidityUsd: null,
    held: false,
    eligible: true,
    reason: 'formal inactivity baseline',
    components: {
      priceMomentum: null,
      liquidityQuality: null,
      buySellImbalance: null,
      traderActivity: null,
      organicQuality: null,
      holderPenalty: null,
      walletExposure: 0,
      verifiedAdjustment: null,
      externalContext: null,
      noise: 0
    },
    inputs: { requiredEdge: rules.doNothingMargin }
  };
  // Compare only the best eligible candidate with the configured inactivity edge.
  const chosen = best && best.score >= rules.doNothingMargin ? best : rest;
  const reason = !sourcesReady ? 'insufficient execution data' :
    !candidates.some(candidate => candidate.liquidityUsd !== null) ? 'liquidity unavailable' :
    !best ? 'no eligible candidate' :
    chosen === rest ? 'best candidate did not clear inactivity margin' : 'best eligible candidate cleared inactivity margin';
  const runnerUp = chosen === rest ? (best || candidates[0] || null) : (eligible.find(candidate => candidate !== chosen) || rest);
  return {
    chosen,
    reason,
    bestCandidate: best || candidates[0] || null,
    bestScore: (best || candidates[0])?.score ?? null,
    doNothingScore: 0,
    margin: best ? best.score : 0,
    requiredMargin: rules.doNothingMargin,
    noise: rules.noise,
    eligibleCount: eligible.length,
    liquidityStatus: candidates.some(candidate => candidate.liquidityUsd !== null) ? 'available' : 'unavailable',
    runnerUp,
    runnerUpPrice: runnerUp?.price ?? null,
    runnerUpTimestamp: observation.timestamp,
    notionalUsd: capitalReady ? capital * rules.walletSlice : null,
    formulaVersion: 'soryn-solana-weigh-v2',
    formula: 'momentum*0.35 + liquidity quality + buy/sell imbalance*0.20 + trader activity + organic quality + holder concentration penalty + external context + exposure + verified adjustment + deterministic noise',
    candidates: candidates.concat(rest)
  };
}
