export const PROXY_STREAMS = '/api/streams';

/** Render media backend — used when Vercel env is missing. */
export const DEFAULT_MEDIA_BACKEND = 'https://adsblocker-cqaa.onrender.com';

export const YT_ID_RE =
  /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/|watch\?v=|watch\?.+&v=)|music\.youtube\.com\/watch\?v=)([\w-]{11})/;

export function extractVideoId(input) {
  const trimmed = input.trim();
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(YT_ID_RE);
  return match ? match[1] : null;
}

export function pickBestStream(streams, preferAudio) {
  if (!streams?.length) return null;

  const sorted = [...streams].sort((a, b) => {
    const qa = parseInt(a.quality, 10) || 0;
    const qb = parseInt(b.quality, 10) || 0;
    return qb - qa;
  });

  if (preferAudio) {
    const m4a = streams.find((s) => s.mimeType?.includes('audio/mp4'));
    if (m4a) return m4a;
    const audio = streams.find((s) => s.mimeType?.startsWith('audio/'));
    if (audio) return audio;
  }

  const video = sorted.find((s) => s.mimeType?.startsWith('video/') && !s.videoOnly);
  if (video) return video;

  return sorted.find((s) => s.mimeType?.startsWith('video/')) || sorted[0];
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
