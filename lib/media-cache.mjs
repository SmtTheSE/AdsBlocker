import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { probeStream, ytDlp, ytDlpBaseArgs, ytDlpError } from './media-formats.mjs';
import { canUseDiskCache } from './runtime.mjs';
import { serveMediaServerless } from './media-serverless.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = process.env.MEDIA_CACHE_DIR || path.join(__dirname, '..', '.cache', 'media');
const MAX_CACHE_BYTES = Number(process.env.MEDIA_CACHE_MAX_MB || 512) * 1024 * 1024;

const inflight = new Map();

function cacheKey(videoId, audioOnly) {
  return `${videoId}_${audioOnly ? 'a' : 'v'}`;
}

function cachePaths(key) {
  const dir = CACHE_DIR;
  return {
    media: path.join(dir, `${key}.bin`),
    part: path.join(dir, `${key}.bin.part`),
    meta: path.join(dir, `${key}.json`),
  };
}

async function ensureCacheDir() {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
}

async function readMeta(key) {
  try {
    const raw = await fsp.readFile(cachePaths(key).meta, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function isCached(key) {
  const { media, meta } = cachePaths(key);
  try {
    const [stat] = await Promise.all([fsp.stat(media), fsp.access(meta)]);
    return stat.size > 0;
  } catch {
    return false;
  }
}

async function touchCache(key) {
  const { media } = cachePaths(key);
  const now = new Date();
  await fsp.utimes(media, now, now).catch(() => {});
}

async function evictIfNeeded() {
  let entries;
  try {
    entries = await fsp.readdir(CACHE_DIR);
  } catch {
    return;
  }

  const files = [];
  for (const name of entries) {
    if (!name.endsWith('.bin')) continue;
    const filePath = path.join(CACHE_DIR, name);
    const stat = await fsp.stat(filePath).catch(() => null);
    if (stat) files.push({ filePath, size: stat.size, mtime: stat.mtimeMs });
  }

  let total = files.reduce((sum, f) => sum + f.size, 0);
  if (total <= MAX_CACHE_BYTES) return;

  files.sort((a, b) => a.mtime - b.mtime);
  for (const file of files) {
    if (total <= MAX_CACHE_BYTES) break;
    const key = path.basename(file.filePath, '.bin');
    const { meta } = cachePaths(key);
    await fsp.unlink(file.filePath).catch(() => {});
    await fsp.unlink(meta).catch(() => {});
    total -= file.size;
  }
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function cacheHeaders(meta, immutable = true) {
  return {
    'Content-Type': meta.mime,
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'X-Cache': immutable ? 'HIT' : 'MISS',
    'Cache-Control': immutable
      ? 'public, max-age=31536000, immutable'
      : 'no-store',
  };
}

function serveFile(req, res, filePath, meta) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const range = req.headers.range;
  const base = cacheHeaders(meta, true);

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : size - 1;

    if (Number.isNaN(start) || start >= size || end >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      ...base,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...base,
    'Content-Length': String(size),
  });
  fs.createReadStream(filePath).pipe(res);
}

function downloadToFile(videoId, audioOnly, meta, key) {
  const { part, media, meta: metaPath } = cachePaths(key);
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  return new Promise((resolve, reject) => {
    const args = [
      ...ytDlpBaseArgs(),
      '-f', meta.format,
      '-o', '-',
      '--no-warnings',
      '--no-playlist',
      '--quiet',
      url,
    ];

    const proc = spawn(ytDlp(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const writeStream = fs.createWriteStream(part);
    const pass = new PassThrough();
    let stderr = '';
    let bytes = 0;

    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.stdout.pipe(pass);
    pass.pipe(writeStream);

    pass.on('data', (chunk) => { bytes += chunk.length; });

    const fail = (message) => {
      writeStream.destroy();
      proc.kill('SIGTERM');
      fsp.unlink(part).catch(() => {});
      reject(new Error(message));
    };

    proc.on('error', (err) => {
      fail(err.code === 'ENOENT' ? 'yt-dlp not installed (brew install yt-dlp)' : err.message);
    });

    writeStream.on('error', (err) => fail(err.message));

    proc.on('close', (code) => {
      if (code !== 0) {
        const match = stderr.match(/ERROR: \[youtube\][^\n]+/);
        fail(match ? match[0].replace(/^ERROR: /, '') : (stderr.trim() || `yt-dlp failed (${code})`));
      }
    });

    writeStream.on('finish', async () => {
      try {
        const saved = {
          ...meta,
          videoId,
          audioOnly,
          bytes,
          filesize: bytes,
          cachedAt: Date.now(),
        };
        await fsp.rename(part, media);
        await fsp.writeFile(metaPath, JSON.stringify(saved));
        await evictIfNeeded();
        resolve(saved);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function streamToClientAndCache(videoId, audioOnly, meta, key, req, res) {
  const { part, media, meta: metaPath } = cachePaths(key);
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  return new Promise((resolve, reject) => {
    const args = [
      ...ytDlpBaseArgs(),
      '-f', meta.format,
      '-o', '-',
      '--no-warnings',
      '--no-playlist',
      '--quiet',
      url,
    ];

    const proc = spawn(ytDlp(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const writeStream = fs.createWriteStream(part);
    const pass = new PassThrough();
    let stderr = '';
    let bytes = 0;

    const fail = (message) => {
      if (!res.headersSent) sendJson(res, 502, { error: message });
      else if (!res.writableEnded) res.destroy();
      writeStream.destroy();
      proc.kill('SIGTERM');
      fsp.unlink(part).catch(() => {});
      reject(new Error(message));
    };

    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.stdout.pipe(pass);

    pass.on('data', (chunk) => {
      bytes += chunk.length;
      if (!writeStream.write(chunk)) pass.pause();
      if (!res.headersSent) {
        res.writeHead(200, cacheHeaders(meta, false));
      }
      if (!res.writableEnded) res.write(chunk);
    });

    writeStream.on('drain', () => pass.resume());

    proc.on('error', (err) => {
      fail(err.code === 'ENOENT' ? 'yt-dlp not installed (brew install yt-dlp)' : err.message);
    });

    proc.on('close', (code) => {
      if (code !== 0 && !res.headersSent) {
        const match = stderr.match(/ERROR: \[youtube\][^\n]+/);
        fail(match ? match[0].replace(/^ERROR: /, '') : (stderr.trim() || `yt-dlp failed (${code})`));
      }
    });

    writeStream.on('finish', async () => {
      try {
        const saved = {
          ...meta,
          videoId,
          audioOnly,
          bytes,
          filesize: bytes,
          cachedAt: Date.now(),
        };
        await fsp.rename(part, media);
        await fsp.writeFile(metaPath, JSON.stringify(saved));
        await evictIfNeeded();
        if (!res.writableEnded) res.end();
        resolve(saved);
      } catch (err) {
        reject(err);
      }
    });

    pass.on('end', () => writeStream.end());
    req.on('close', () => {
      if (!res.writableEnded) proc.kill('SIGTERM');
    });
  });
}

async function ensureDownloaded(videoId, audioOnly, meta, key, req, res) {
  if (inflight.has(key)) {
    await inflight.get(key);
    return readMeta(key);
  }

  const task = streamToClientAndCache(videoId, audioOnly, meta, key, req, res);
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

export async function warmCache(videoId, audioOnly) {
  if (!canUseDiskCache()) {
    return { cached: false, key: cacheKey(videoId, audioOnly), serverless: true };
  }
  const key = cacheKey(videoId, audioOnly);
  if (await isCached(key)) return { cached: true, key };

  if (inflight.has(key)) {
    await inflight.get(key);
    return { cached: true, key };
  }

  await ensureCacheDir();
  const meta = await probeStream(videoId, audioOnly);
  const task = downloadToFile(videoId, audioOnly, meta, key);
  inflight.set(key, task);
  try {
    await task;
    return { cached: true, key };
  } finally {
    inflight.delete(key);
  }
}

export async function serveMedia(videoId, audioOnly, req, res) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    throw new Error('Invalid video ID');
  }

  if (!canUseDiskCache()) {
    await serveMediaServerless(videoId, audioOnly, req, res);
    return;
  }

  await ensureCacheDir();
  const key = cacheKey(videoId, audioOnly);

  if (await isCached(key)) {
    const meta = await readMeta(key);
    const { media } = cachePaths(key);
    touchCache(key).catch(() => {});
    serveFile(req, res, media, meta);
    return;
  }

  if (inflight.has(key)) {
    try {
      await inflight.get(key);
    } catch (err) {
      sendJson(res, 502, { error: err.message });
      return;
    }
    if (await isCached(key)) {
      const meta = await readMeta(key);
      serveFile(req, res, cachePaths(key).media, meta);
    } else {
      sendJson(res, 502, { error: 'Cache build failed' });
    }
    return;
  }

  let meta;
  try {
    meta = await probeStream(videoId, audioOnly);
  } catch (err) {
    sendJson(res, 502, { error: ytDlpError(err) });
    return;
  }

  try {
    await ensureDownloaded(videoId, audioOnly, meta, key, req, res);
  } catch (err) {
    if (!res.headersSent) sendJson(res, 502, { error: err.message });
  }
}

export async function getCacheStats() {
  await ensureCacheDir();
  let entries = [];
  try {
    const names = await fsp.readdir(CACHE_DIR);
    for (const name of names) {
      if (!name.endsWith('.bin')) continue;
      const filePath = path.join(CACHE_DIR, name);
      const stat = await fsp.stat(filePath);
      const meta = await readMeta(path.basename(name, '.bin'));
      entries.push({
        key: path.basename(name, '.bin'),
        bytes: stat.size,
        title: meta?.videoId,
        cachedAt: meta?.cachedAt,
      });
    }
  } catch {
    entries = [];
  }
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0);
  return { count: entries.length, totalBytes, maxBytes: MAX_CACHE_BYTES };
}
