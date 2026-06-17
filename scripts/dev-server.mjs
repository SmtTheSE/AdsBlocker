#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStreams, resolveSearch } from '../lib/stream-sources.mjs';
import { pipeMedia } from '../lib/media-proxy.mjs';
import { warmCache, getCacheStats } from '../lib/media-cache.mjs';
import { runtimeLabel, isServerless, canUseDiskCache, canUseYtDlp } from '../lib/runtime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function serveStatic(req, res) {
  let reqPath = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, reqPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    const cache = canUseDiskCache() ? await getCacheStats() : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      backend: isServerless ? 'vercel-serverless' : 'youtube-direct+yt-dlp+cache',
      runtime: runtimeLabel(),
      version: 5,
      features: { diskCache: canUseDiskCache(), ytDlp: canUseYtDlp() },
      cache,
    }));
    return;
  }

  if (url.pathname === '/api/cache/warm' && req.method === 'GET') {
    const videoId = url.searchParams.get('videoId');
    const audio = url.searchParams.get('audio') === '1';
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid videoId' }));
      return;
    }
    try {
      const result = await warmCache(videoId, audio);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/media' && req.method === 'GET') {
    const videoId = url.searchParams.get('videoId');
    const audio = url.searchParams.get('audio') === '1';
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid videoId' }));
      return;
    }
    try {
      await pipeMedia(videoId, audio, req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    }
    return;
  }

  if (url.pathname === '/api/streams' && req.method === 'GET') {
    try {
      const videoId = url.searchParams.get('videoId');
      const q = url.searchParams.get('q');
      const filter = url.searchParams.get('filter') || 'videos';

      let result;
      if (videoId) {
        if (!/^[\w-]{11}$/.test(videoId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid video ID' }));
          return;
        }
        result = await resolveStreams(videoId);
      } else if (q) {
        result = await resolveSearch(q, filter);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Provide videoId or q' }));
        return;
      }

      if (!result) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'All stream sources unavailable. Try again shortly.',
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  ClearStream dev server (youtube-direct v2)\n`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → http://localhost:${PORT}/api/health\n`);
});
