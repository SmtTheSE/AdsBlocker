import { pipeMedia } from '../lib/media-proxy.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { videoId, audio } = req.query;

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    res.status(400).json({ error: 'Invalid videoId' });
    return;
  }

  try {
    await pipeMedia(videoId, audio === '1', req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: err.message || 'Media error' });
    }
  }
}
