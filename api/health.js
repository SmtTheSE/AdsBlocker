import { runtimeLabel, isServerless, canUseDiskCache, canUseYtDlp } from '../lib/runtime.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const backend = process.env.MEDIA_BACKEND_URL?.replace(/\/$/, '') || null;
  if (backend) {
    fetch(`${backend}/api/health`, { signal: AbortSignal.timeout(8000) }).catch(() => {});
  }

  return res.status(200).json({
    ok: true,
    backend: isServerless ? 'vercel-serverless' : 'youtube-direct+yt-dlp+cache',
    runtime: runtimeLabel(),
    version: 7,
    features: {
      diskCache: canUseDiskCache(),
      ytDlp: canUseYtDlp(),
      mediaBackend: Boolean(backend),
    },
    mediaBackendUrl: backend,
  });
}
