const MEDIA_CACHE = 'clearstream-media-v1';
const prefetching = new Set();
const PREFETCH_AHEAD = 3;

function mediaUrl(videoId, musicMode) {
  return `/api/media?videoId=${encodeURIComponent(videoId)}&audio=${musicMode ? 1 : 0}`;
}

function warmUrl(videoId, musicMode) {
  return `/api/cache/warm?videoId=${encodeURIComponent(videoId)}&audio=${musicMode ? 1 : 0}`;
}

export async function prefetchMedia(videoId, musicMode = true) {
  if (!videoId || videoId.length !== 11) return false;
  const key = `${videoId}:${musicMode ? 1 : 0}`;
  if (prefetching.has(key)) return false;

  prefetching.add(key);
  try {
    const { isServerlessMode, detectServerless } = await import('./api.js');
    await detectServerless();
    if (isServerlessMode()) return false;

    const res = await fetch(warmUrl(videoId, musicMode));
    return res.ok;
  } catch {
    return false;
  } finally {
    prefetching.delete(key);
  }
}

export function prefetchQueue(queueItems, currentIndex, musicMode = true, ahead = PREFETCH_AHEAD) {
  if (!queueItems?.length || currentIndex < 0) return;

  for (let i = 1; i <= ahead; i += 1) {
    const item = queueItems[currentIndex + i];
    if (item?.id) prefetchMedia(item.id, musicMode);
  }
}

export function prefetchItemList(items, musicMode = true, limit = PREFETCH_AHEAD) {
  items.slice(0, limit).forEach((item) => {
    if (item?.id) prefetchMedia(item.id, musicMode);
  });
}

export async function getCachedMediaUrl(videoId, musicMode = true) {
  if (!('caches' in window)) return null;
  const request = new Request(mediaUrl(videoId, musicMode));
  const hit = await caches.match(request);
  if (!hit) return null;
  const blob = await hit.blob();
  return URL.createObjectURL(blob);
}

export function revokeBlobUrl(url) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
}
