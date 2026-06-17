import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function ytDlp() {
  return process.env.YTDLP_PATH || 'yt-dlp';
}

export const AUDIO_FORMAT = [
  'bestaudio[ext=m4a]',
  'bestaudio[acodec^=mp4a]',
  'bestaudio',
  'best[acodec^=mp4a][protocol=https][ext=mp4]',
  'best[protocol=https][ext=mp4]',
  'best',
].join('/');

export const VIDEO_FORMAT = [
  'best[ext=mp4][height<=720][protocol=https]',
  'best[height<=720][protocol=https]',
  'best[protocol=https][ext=mp4]',
  'best',
].join('/');

const MIME = {
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'audio/webm',
  mka: 'audio/x-matroska',
};

export function pickMime({ ext, acodec, vcodec, audioOnly }) {
  if (ext === 'webm') return audioOnly ? 'audio/webm' : 'video/webm';
  if (ext === 'mp4' || ext === 'm4a' || acodec?.startsWith('mp4a')) {
    const hasVideo = vcodec && vcodec !== 'none';
    if (hasVideo) return 'video/mp4';
    return 'audio/mp4';
  }
  return MIME[ext] || 'application/octet-stream';
}

export function ytDlpError(err) {
  const msg = err.stderr || err.message || '';
  const match = msg.match(/ERROR: \[youtube\][^\n]+/);
  return match ? match[0].replace(/^ERROR: /, '') : (err.message || 'Could not probe stream');
}

export async function probeStream(videoId, audioOnly) {
  const format = audioOnly ? AUDIO_FORMAT : VIDEO_FORMAT;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const { stdout } = await execFileAsync(ytDlp(), [
    '-f', format,
    '--print', '%(ext)s|%(filesize)s|%(acodec)s|%(vcodec)s',
    '--no-warnings',
    '--no-playlist',
    url,
  ], { timeout: 30000 });

  const [ext, filesize, acodec, vcodec] = stdout.trim().split('|');

  return {
    format,
    ext,
    acodec,
    vcodec,
    mime: pickMime({ ext, acodec, vcodec, audioOnly }),
    filesize: parseInt(filesize, 10) || null,
  };
}
