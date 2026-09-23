import test from 'node:test';
import assert from 'node:assert/strict';
import { genesisHash, publicCycleId } from '../server/identity.js';

test('genesis hash is canonical, stable and changes with rules',()=>{
  const a={noise:0.03,maxActsPerDay:6,nested:{b:2,a:1}};
  const b={nested:{a:1,b:2},maxActsPerDay:6,noise:0.03};
  assert.equal(genesisHash(a),genesisHash(b));
  assert.notEqual(genesisHash(a),genesisHash({...a,noise:0.02}));
  assert.match(genesisHash(a),/^0x[0-9a-f]{64}$/);
});

test('public cycle id is readable, stable and keeps a UUID uniqueness suffix',()=>{
  const id='123e4567-e89b-12d3-a456-426614174000';
  const value=publicCycleId(id,'2026-09-20T16:45:00.000Z');
  assert.equal(value,publicCycleId(id,'2026-09-20T16:45:00.000Z'));
  assert.match(value,/^sor_20260920_124500_123e4567$/);
});
