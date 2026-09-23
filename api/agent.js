import { buildSnapshot } from '../server/observation-v2.js';
let cached, cachedAt = 0;
let inFlight = null;

async function currentObservation() {
  if (cached && Date.now() - cachedAt <= 10000) return cached;
  if (!inFlight) {
    inFlight = buildSnapshot().then(value => {
      cached = value;
      cachedAt = Date.now();
      return value;
    }).finally(() => { inFlight = null; });
  }
  return inFlight;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  try {
    const value = await currentObservation();
    // A mint change in Global Config must not be held behind a long stale CDN response.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5');
    return res.status(200).json(value);
  } catch {
    return res.status(503).json({ error: 'public observation unavailable' });
  }
}
