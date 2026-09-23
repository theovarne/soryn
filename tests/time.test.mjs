import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEasternTime, easternDateKey, isEasternToday, last24Hours, easternHour } from '../dist/time.js';
test('ET automatically uses winter and summer offsets',()=>{
  assert.equal(formatEasternTime('2026-01-15T17:00:00Z'),'12:00:00 ET');
  assert.equal(formatEasternTime('2026-07-15T17:00:00Z'),'13:00:00 ET');
});
test('ET midnight differs from UTC midnight',()=>{
  assert.equal(easternDateKey('2026-09-17T03:59:59Z'),'2026-09-16');
  assert.equal(easternDateKey('2026-09-17T04:00:00Z'),'2026-09-17');
  assert.equal(isEasternToday('2026-09-17T01:00:00Z','2026-09-17T05:00:00Z'),false);
});
test('DST fall-back day includes records older than 24 hours',()=>{
  assert.ok(isEasternToday('2026-11-01T04:05:00Z','2026-11-02T04:30:00Z'));
  const hours=last24Hours('2026-11-01T08:30:00Z').map(easternHour);
  assert.equal(hours.filter(h=>h==='01').length,2);
});
test('spring-forward skips nonexistent ET hour',()=>{
  const hours=last24Hours('2026-03-08T09:30:00Z').slice(-6).map(easternHour);
  assert.ok(!hours.includes('02'));assert.ok(hours.includes('03'));
  assert.equal(formatEasternTime(null),'—');
});
