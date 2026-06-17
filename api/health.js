import { runtimeLabel, isServerless, canUseDiskCache, canUseYtDlp } from '../lib/runtime.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  return res.status(200).json({
    ok: true,
    backend: isServerless ? 'vercel-serverless' : 'youtube-direct+yt-dlp+cache',
    runtime: runtimeLabel(),
    version: 7,
    features: {
      diskCache: canUseDiskCache(),
      ytDlp: canUseYtDlp(),
      mediaBackend: Boolean(process.env.MEDIA_BACKEND_URL),
    },
  });
}
