import { resolveStreams, resolveSearch } from '../lib/stream-sources.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=300');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const { videoId, q, filter } = req.query;

  try {
    if (videoId) {
      if (!/^[\w-]{11}$/.test(videoId)) {
        return res.status(400).json({ error: 'Invalid video ID' });
      }
      const result = await resolveStreams(videoId);
      if (!result) {
        return res.status(502).json({
          error: 'All stream sources unavailable. Try again in a moment.',
        });
      }
      return res.status(200).json(result);
    }

    if (q) {
      const result = await resolveSearch(q, filter || 'videos');
      if (!result) {
        return res.status(502).json({ error: 'Search unavailable right now.' });
      }
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Provide videoId or q parameter' });
  } catch (err) {
    console.error('streams API error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
