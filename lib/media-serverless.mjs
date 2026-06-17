import { resolveStreams } from './stream-sources.mjs';
import { forwardMediaRequest } from './media-remote.mjs';

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

  const withUrl = streams.filter((s) => s?.url);
  if (!withUrl.length) return null;

  if (audioOnly) {
    const m4a = withUrl.find((s) => s.mimeType?.includes('audio/mp4'));
    if (m4a) return m4a;
    const audio = withUrl.find((s) => s.mimeType?.startsWith('audio/'));
    if (audio) return audio;
  }

  const combined = withUrl.find((s) => s.mimeType?.startsWith('video/') && !s.videoOnly);
  if (combined) return combined;

  return withUrl.find((s) => !s.url.includes('googlevideo.com')) || withUrl[0];
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

async function pipeYtdl(videoId, audioOnly, req, res) {
  let ytdl;
  try {
    const mod = await import('@distube/ytdl-core');
    ytdl = mod.default;
  } catch (err) {
    sendJson(res, 502, { error: err.message || 'ytdl unavailable' });
    return false;
  }

  const url = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const info = await ytdl.getInfo(url);
    const formats = info.formats.filter((f) => f.url);
    const pick = audioOnly
      ? formats.find((f) => f.hasAudio && !f.hasVideo)
      : formats.find((f) => f.hasAudio && f.hasVideo) || formats[0];

    if (!pick) {
      sendJson(res, 502, { error: 'No playable format found' });
      return false;
    }

    return new Promise((resolve) => {
      const stream = ytdl.downloadFromInfo(info, { format: pick });
      let started = false;

      const fail = (message) => {
        if (!started) sendJson(res, 502, { error: message });
        else if (!res.writableEnded) res.end();
        resolve(false);
      };

      stream.on('data', (chunk) => {
        if (!started) {
          started = true;
          res.writeHead(200, {
            'Content-Type': pick.mimeType?.split(';')[0] || (audioOnly ? 'audio/mp4' : 'video/mp4'),
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
  } catch (err) {
    sendJson(res, 502, { error: err.message || 'ytdl failed' });
    return false;
  }
}

export async function serveMediaServerless(videoId, audioOnly, req, res) {
  if (process.env.MEDIA_BACKEND_URL) {
    const ok = await forwardMediaRequest(videoId, audioOnly, req, res);
    if (ok) return;
  }

  const result = await resolveStreams(videoId);
  const stream = result?.data ? pickStreamUrl(result.data, audioOnly) : null;

  if (stream?.url && !stream.url.includes('googlevideo.com')) {
    const mime = stream.mimeType?.split(';')[0] || (audioOnly ? 'audio/mp4' : 'video/mp4');
    const ok = await pipeFetch(stream.url, req, res, mime);
    if (ok) return;
  }

  const ytdlOk = await pipeYtdl(videoId, audioOnly, req, res);
  if (!ytdlOk && !res.headersSent) {
    sendJson(res, 502, {
      error: process.env.MEDIA_BACKEND_URL
        ? 'Media backend unavailable'
        : 'Playback requires MEDIA_BACKEND_URL — deploy the Docker backend (see DEPLOY.md)',
    });
  }
}
