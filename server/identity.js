import { createHash } from 'node:crypto';
import { RULES } from './settings.js';

export const SOFTWARE_VERSION = 'soryn-core 0.4.2';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

export function canonicalGenesisConfig() {
  return canonical(RULES);
}

export function genesisHash(config = canonicalGenesisConfig()) {
  return `0x${createHash('sha256').update(JSON.stringify(canonical(config))).digest('hex')}`;
}

export function publicCycleId(cycleId, timestamp = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(timestamp));
  const value = type => parts.find(part => part.type === type)?.value || '00';
  const date = `${value('year')}${value('month')}${value('day')}`;
  const time = `${value('hour')}${value('minute')}${value('second')}`;
  const suffix = String(cycleId).replaceAll('-', '').slice(0, 8).toLowerCase();
  return `sor_${date}_${time}_${suffix}`;
}
