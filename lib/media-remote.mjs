export async function forwardMediaRequest(videoId, audioOnly, req, res) {
  const base = process.env.MEDIA_BACKEND_URL?.replace(/\/$/, '');
  if (!base) return false;

  const url = `${base}/api/media?videoId=${encodeURIComponent(videoId)}&audio=${audioOnly ? 1 : 0}`;
  const headers = {
    'User-Agent': 'ClearStream-Vercel/1.0',
  };
  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = await fetch(url, { headers, redirect: 'follow' });
  if (!upstream.ok) return false;

  const out = {
    'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'X-Cache': 'REMOTE',
    'Cache-Control': 'public, max-age=3600',
  };

  const cl = upstream.headers.get('content-length');
  const cr = upstream.headers.get('content-range');
  if (cl) out['Content-Length'] = cl;
  if (cr) out['Content-Range'] = cr;

  res.writeHead(upstream.status, out);

  if (!upstream.body) {
    res.end();
    return true;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.writableEnded) res.write(Buffer.from(value));
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
  return true;
}
