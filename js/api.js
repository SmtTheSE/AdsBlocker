import { PROXY_STREAMS } from './config.js';

let activeInstance = null;
let activeSource = null;
let serverlessMode = null;

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
  if (serverlessMode != null) return serverlessMode;
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    serverlessMode = !data?.features?.diskCache;
    return serverlessMode;
  } catch {
    serverlessMode = false;
    return false;
  }
}

export function isServerlessMode() {
  return serverlessMode === true;
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
