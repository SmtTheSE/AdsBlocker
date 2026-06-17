import { canUseDiskCache } from '../lib/runtime.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const { videoId, audio } = req.query;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId' });
  }

  if (!canUseDiskCache()) {
    return res.status(200).json({
      ok: true,
      cached: false,
      serverless: true,
      key: `${videoId}_${audio === '1' ? 'a' : 'v'}`,
    });
  }

  try {
    const { warmCache } = await import('../lib/media-cache.mjs');
    const result = await warmCache(videoId, audio === '1');
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(200).json({ ok: true, cached: false, error: err.message });
  }
}
