import { PROXY_STREAMS, DEFAULT_MEDIA_BACKEND } from './config.js';

let activeInstance = null;
let activeSource = null;
let serverlessMode = null;
let mediaBackendUrl = null;

async function fetchProxy(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${PROXY_STREAMS}?${qs}`, {
    signal: AbortSignal.timeout(45000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Stream API error (${res.status})`);
  }
  activeInstance = body.instance;
  activeSource = body.source;
  return body.data;
}

export async function detectServerless() {
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    const data = await res.json();
    serverlessMode = !data?.features?.diskCache;
    mediaBackendUrl = data?.mediaBackendUrl
      || (serverlessMode ? DEFAULT_MEDIA_BACKEND : null);
    return serverlessMode;
  } catch {
    serverlessMode = location.hostname.includes('vercel.app');
    mediaBackendUrl = serverlessMode ? DEFAULT_MEDIA_BACKEND : null;
    return serverlessMode;
  }
}

export function isServerlessMode() {
  return serverlessMode === true;
}

export function getMediaBackendUrl() {
  return mediaBackendUrl;
}

export async function wakeMediaBackend() {
  const base = mediaBackendUrl?.replace(/\/$/, '');
  if (!base) return false;
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(90000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function cacheTrackOnBackend(videoId, musicMode = true) {
  const base = mediaBackendUrl?.replace(/\/$/, '');
  if (!base) return;
  const url = `${base}/api/cache/warm?videoId=${encodeURIComponent(videoId)}&audio=${musicMode ? 1 : 0}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Cache failed (${res.status})`);
  }
}

export function getActiveInstance() {
  return activeInstance;
}

export function getActiveSource() {
  return activeSource;
}

/** Always use local/Vercel proxy — direct Piped/Invidious calls are blocked by CORS in browsers. */
export async function getStreams(videoId) {
  return fetchProxy({ videoId });
}

export async function searchVideos(query) {
  return fetchProxy({ q: query, filter: 'videos' });
}

export async function searchMusic(query) {
  return fetchProxy({ q: query, filter: 'music_songs' });
}
