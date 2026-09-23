import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { weigh, deterministicNoise } from '../server/weigh.js';
import wake from '../api/agent/wake.js';
const base={timestamp:'2026-09-17T12:00:00Z',sourceStatus:{chain:'live',market:'live',wallet:'live'},wallet:{portfolioUsd:100,positions:[]},externalSignals:[{symbol:'BTC',dailyMovePct:0},{symbol:'ETH',dailyMovePct:0}],market:{assets:[{mint:'Mint111111111111111111111111111111111111111',symbol:'SOLX',price:100,liquidityUsd:null,change24h:null}]}};
test('missing liquidity produces explicit do nothing and no eligible candidate',()=>{
  const d=weigh(base);assert.equal(d.chosen.action,'do nothing');assert.equal(d.reason,'liquidity unavailable');assert.equal(d.eligibleCount,0);
  const rest=d.candidates.find(candidate=>candidate.action==='do nothing');
  assert.ok(rest);assert.equal(rest.score,0);assert.equal(Object.values(rest.components).filter(value=>value!==null).reduce((sum,value)=>sum+value,0),0);
  const candidate=d.candidates[0],components=candidate.components;
  assert.equal(candidate.score,Object.values(components).filter(value=>value!==null).reduce((sum,value)=>sum+value,0));
  assert.equal(components.liquidityQuality,null);assert.equal(components.buySellImbalance,null);
  assert.equal(d.runnerUpPrice,100);assert.equal(d.formulaVersion,'soryn-solana-weigh-v2');
});
test('noise is stable and bounded and the 0.08 margin really selects',()=>{
  for(let i=0;i<100;i++){const n=deterministicNoise(`T${i}`,base.timestamp);assert.ok(Math.abs(n)<=0.03);assert.equal(n,deterministicNoise(`T${i}`,base.timestamp));}
  const low=structuredClone(base);low.market.assets[0].liquidityUsd=30000;
  assert.equal(weigh(low).reason,'best candidate did not clear inactivity margin');
  low.market.assets[0].change24h=30;assert.equal(weigh(low).chosen.action,'buy');
});
test('missing chain and empty capital cannot produce an act',()=>{
  const data=structuredClone(base);Object.assign(data.market.assets[0],{liquidityUsd:30000,change24h:50});
  data.sourceStatus.chain='unavailable';assert.equal(weigh(data).chosen.action,'do nothing');
  data.sourceStatus.chain='live';data.wallet.portfolioUsd=0;assert.equal(weigh(data).chosen.action,'do nothing');
});
test('wallet exposure is matched by mint, never by a duplicate symbol',()=>{
  const data=structuredClone(base);
  Object.assign(data.market.assets[0],{symbol:'DUP',liquidityUsd:30000,change24h:-50,price:1});
  data.wallet.positions=[{mint:'DifferentMint2222222222222222222222222222222222',symbol:'DUP',balance:10}];
  const candidate=weigh(data).candidates.find(item=>item.mint===data.market.assets[0].mint);
  assert.equal(candidate.held,false);
  assert.equal(candidate.action,'buy');
  assert.equal(candidate.components.walletExposure,0);
});
test('server wake endpoint is disabled in local runtime mode',async()=>{
  const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await wake({method:'GET',headers:{}},res);assert.equal(res.code,410);assert.equal(res.body.runtime,'local');
  await wake({method:'POST',headers:{}},res);assert.equal(res.code,405);
});
test('browser owns the simulation loop and never calls server wake or database state APIs',async()=>{
  const agent=await readFile(new URL('../dist/agent.js',import.meta.url),'utf8');
  const app=await readFile(new URL('../dist/app-v2.js',import.meta.url),'utf8');
  assert.match(agent,/soryn\.solana\.v1\.agent-record/);assert.match(agent,/localStorage\.setItem/);assert.match(agent,/weigh\(snapshot\)/);
  assert.match(app,/ingestObservation/);assert.doesNotMatch(agent,/\/api\/agent\/(state|records|wake)/);assert.doesNotMatch(app,/\/api\/agent\/(state|records|wake)/);
});
