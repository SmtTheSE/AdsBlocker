import { resolveStreams } from './stream-sources.mjs';

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function pickStreamUrl(data, audioOnly) {
  const streams = audioOnly
    ? (data.audioStreams || [])
    : [...(data.videoStreams || []), ...(data.audioStreams || [])];

  if (!streams.length) return null;

  if (audioOnly) {
    const m4a = streams.find((s) => s.mimeType?.includes('audio/mp4') && s.url);
    if (m4a) return m4a;
    const audio = streams.find((s) => s.mimeType?.startsWith('audio/') && s.url);
    if (audio) return audio;
  }

  const combined = streams.find((s) => s.url && s.mimeType?.startsWith('video/') && !s.videoOnly);
  if (combined) return combined;

  return streams.find((s) => s.url) || null;
}

async function pipeFetch(url, req, res, mimeHint) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.youtube.com/',
    'Origin': 'https://www.youtube.com',
  };
  if (req.headers.range) headers.Range = req.headers.range;

  const upstream = await fetch(url, { headers, redirect: 'follow' });
  if (!upstream.ok) {
    sendJson(res, 502, { error: `Stream upstream error (${upstream.status})` });
    return false;
  }

  const out = {
    'Content-Type': mimeHint || upstream.headers.get('content-type') || 'video/mp4',
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'X-Cache': 'STREAM',
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

function pipeYtdl(videoId, audioOnly, req, res) {
  return new Promise(async (resolve) => {
    let ytdl;
    try {
      const mod = await import('@distube/ytdl-core');
      ytdl = mod.default;
    } catch (err) {
      sendJson(res, 502, { error: err.message || 'ytdl unavailable' });
      resolve(false);
      return;
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const filter = audioOnly ? 'audioonly' : 'audioandvideo';
    const stream = ytdl(url, { filter, quality: audioOnly ? 'highestaudio' : 'highest' });

    let started = false;
    const fail = (message) => {
      if (!started) sendJson(res, 502, { error: message });
      else if (!res.writableEnded) res.end();
      resolve(false);
    };

    stream.on('response', (_, upstreamRes) => {
      if (started) return;
      started = true;
      res.writeHead(200, {
        'Content-Type': audioOnly ? 'audio/mp4' : 'video/mp4',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'X-Cache': 'YTDLP',
        'Cache-Control': 'public, max-age=3600',
      });
    });

    stream.on('data', (chunk) => {
      if (!started) {
        started = true;
        res.writeHead(200, {
          'Content-Type': audioOnly ? 'audio/mp4' : 'video/mp4',
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          'X-Cache': 'YTDLP',
          'Cache-Control': 'public, max-age=3600',
        });
      }
      if (!res.writableEnded) res.write(chunk);
    });

    stream.on('end', () => {
      if (!res.writableEnded) res.end();
      resolve(true);
    });

    stream.on('error', (err) => fail(err.message));
    req.on('close', () => stream.destroy());
  });
}

export async function serveMediaServerless(videoId, audioOnly, req, res) {
  const result = await resolveStreams(videoId);
  const stream = result?.data ? pickStreamUrl(result.data, audioOnly) : null;

  if (stream?.url) {
    const mime = stream.mimeType?.split(';')[0]
      || (audioOnly ? 'audio/mp4' : 'video/mp4');
    const ok = await pipeFetch(stream.url, req, res, mime);
    if (ok) return;
  }

  await pipeYtdl(videoId, audioOnly, req, res);
}
