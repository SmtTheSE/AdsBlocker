const STATIC_PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://api.piped.yt',
  'https://pipedapi.nosebs.ru',
  'https://pipedapi.adminforge.de',
  'https://piped-api.garudalinux.org',
  'https://api.piped.privacydev.net',
  'https://pipedapi.ducks.party',
  'https://pipedapi.in.projectsegfau.lt',
];

const STATIC_INVIDIOUS = [
  'https://invidious.privacydev.net',
  'https://inv.tux.pizza',
  'https://invidious.protokolla.fi',
  'https://invidious.dhusch.de',
  'https://inv.nadeko.net',
  'https://yewtu.be',
];

let pipedCache = null;
let pipedCacheAt = 0;

export async function getPipedBases() {
  const now = Date.now();
  if (pipedCache && now - pipedCacheAt < 3600000) return pipedCache;

  const bases = [...STATIC_PIPED];
  try {
    const res = await fetch('https://piped-instances.kavin.rocks/', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const list = await res.json();
      for (const item of list) {
        if (item.api_url) bases.push(item.api_url.replace(/\/$/, ''));
      }
    }
  } catch {
    // use static list
  }

  pipedCache = [...new Set(bases)];
  pipedCacheAt = now;
  return pipedCache;
}

export function getInvidiousBases() {
  return STATIC_INVIDIOUS;
}
