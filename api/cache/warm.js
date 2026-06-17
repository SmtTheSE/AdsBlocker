import { warmCache } from '../lib/media-cache.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const { videoId, audio } = req.query;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId' });
  }

  try {
    const result = await warmCache(videoId, audio === '1');
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
