import { getStreamsDirect, searchDirect } from './youtube-direct.mjs';
import { searchYtDlp } from './ytdlp-search.mjs';
import { getMetaYtDlp, searchYtDlpMeta } from './ytdlp-meta.mjs';
import { canUseYtDlp, isServerless } from './runtime.mjs';

const PIPED_STATIC = [
  'https://pipedapi.ducks.party',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.in.projectsegfau.lt',
  'https://pipedapi.adminforge.de',
  'https://piped-api.garudalinux.org',
  'https://api.piped.privacydev.net',
  'https://pipedapi.kavin.rocks',
];

const INVIDIOUS_STATIC = [
  'https://vid.puffyan.us',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.protokolla.fi',
];

const UA = 'ClearStream/1.0';
const JSON_HEADERS = { Accept: 'application/json', 'User-Agent': UA };
const TRY_MS = 6000;

export function mapInvidious(data) {
  const thumb =
    data.videoThumbnails?.find((t) => t.quality === 'medium')?.url ||
    data.videoThumbnails?.[0]?.url ||
    '';

  return {
    title: data.title,
    uploader: data.author,
    thumbnailUrl: thumb,
    videoStreams: (data.formatStreams || []).map((f) => ({
      url: f.url,
      mimeType: f.type,
      quality: f.qualityLabel || f.quality,
      videoOnly: false,
    })),
    audioStreams: (data.adaptiveFormats || [])
      .filter((f) => f.type?.startsWith('audio/'))
      .map((f) => ({
        url: f.url,
        mimeType: f.type,
        quality: String(f.bitrate || ''),
      })),
  };
}

async function fetchOne(url) {
  const res = await fetch(url, {
    headers: JSON_HEADERS,
    signal: AbortSignal.timeout(TRY_MS),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function racePiped(videoId) {
  const tasks = PIPED_STATIC.map(async (base) => {
    const data = await fetchOne(`${base}/streams/${videoId}`);
    if (data.error || !data.title) throw new Error('bad payload');
    return { source: 'piped', instance: base, data };
  });
  return Promise.any(tasks).catch(() => null);
}

async function raceInvidious(videoId) {
  const tasks = INVIDIOUS_STATIC.map(async (base) => {
    const raw = await fetchOne(`${base}/api/v1/videos/${videoId}`);
    if (raw.error || !raw.title) throw new Error('bad payload');
    return { source: 'invidious', instance: base, data: mapInvidious(raw) };
  });
  return Promise.any(tasks).catch(() => null);
}

async function racePipedSearch(query, filter) {
  const q = encodeURIComponent(query);
  const tasks = PIPED_STATIC.map(async (base) => {
    const data = await fetchOne(`${base}/search?q=${q}&filter=${filter}`);
    if (!data?.items?.length) throw new Error('empty');
    return { source: 'piped', instance: base, data };
  });
  return Promise.any(tasks).catch(() => null);
}

async function raceInvidiousSearch(query) {
  const q = encodeURIComponent(query);
  const tasks = INVIDIOUS_STATIC.map(async (base) => {
    const items = await fetchOne(`${base}/api/v1/search?q=${q}&type=video`);
    if (!Array.isArray(items) || !items.length) throw new Error('empty');
    const mapped = items.map((item) => ({
      url: `/watch?v=${item.videoId}`,
      title: item.title,
      uploaderName: item.author,
      thumbnail: item.videoThumbnails?.[0]?.url || '',
      duration: item.lengthSeconds,
    }));
    return { source: 'invidious', instance: base, data: { items: mapped } };
  });
  return Promise.any(tasks).catch(() => null);
}

async function raceSources(sources, timeoutMs = 18000) {
  return new Promise((resolve) => {
    let settled = false;
    let remaining = sources.length;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    for (const source of sources) {
      Promise.resolve(source())
        .then((result) => {
          if (!settled && result) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        })
        .catch(() => {})
        .finally(() => {
          remaining -= 1;
          if (remaining === 0 && !settled) {
            clearTimeout(timer);
            settled = true;
            resolve(null);
          }
        });
    }
  });
}

export async function resolveStreams(videoId) {
  const sources = isServerless
    ? [
        () => racePiped(videoId),
        () => raceInvidious(videoId),
        () => getStreamsDirect(videoId),
      ]
    : [
        () => getStreamsDirect(videoId),
        () => racePiped(videoId),
        () => raceInvidious(videoId),
      ];
  if (canUseYtDlp()) {
    sources.splice(isServerless ? 2 : 1, 0, () => getMetaYtDlp(videoId));
  }
  return raceSources(sources);
}

export async function resolveSearch(query, filter = 'videos') {
  const sources = [
    () => searchDirect(query, filter),
    () => racePipedSearch(query, filter),
    () => raceInvidiousSearch(query),
  ];
  if (canUseYtDlp()) {
    sources.splice(1, 0, () => searchYtDlpMeta(query), () => searchYtDlp(query));
  }
  return raceSources(sources, 25000);
}
