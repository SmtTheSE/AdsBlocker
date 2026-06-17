import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canUseYtDlp } from './runtime.mjs';
import { ytDlpBaseArgs } from './media-formats.mjs';

const execFileAsync = promisify(execFile);

function ytDlp() {
  return process.env.YTDLP_PATH || 'yt-dlp';
}

export async function getMetaYtDlp(videoId) {
  if (!canUseYtDlp()) return null;
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const { stdout } = await execFileAsync(ytDlp(), [
    ...ytDlpBaseArgs(),
    '--print', '%(title)s|%(uploader)s|%(thumbnail)s',
    '--no-warnings',
    '--no-playlist',
    url,
  ], { timeout: 15000 });

  const [title, uploader, thumbnailUrl] = stdout.trim().split('|');
  if (!title) return null;

  return {
    source: 'yt-dlp',
    instance: 'yt-dlp',
    data: {
      title,
      uploader: uploader || '',
      thumbnailUrl: thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      useProxy: true,
      audioStreams: [],
      videoStreams: [],
    },
  };
}

export async function searchYtDlpMeta(query) {
  if (!canUseYtDlp()) return null;
  const { stdout } = await execFileAsync(ytDlp(), [
    ...ytDlpBaseArgs(),
    `ytsearch10:${query}`,
    '--print', '%(id)s|%(title)s|%(uploader)s|%(duration)s',
    '--no-warnings',
    '--flat-playlist',
  ], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });

  const items = stdout.trim().split('\n').filter(Boolean).map((line) => {
    const [id, title, uploaderName, duration] = line.split('|');
    return {
      url: `/watch?v=${id}`,
      title,
      uploaderName: uploaderName || '',
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      duration: Number(duration) || undefined,
    };
  }).filter((i) => i.url && i.title && idValid(i.url));

  if (!items.length) return null;

  return {
    source: 'yt-dlp',
    instance: 'yt-dlp',
    data: { items },
  };
}

function idValid(url) {
  const m = url.match(/v=([\w-]{11})/);
  return m && m[1].length === 11;
}
