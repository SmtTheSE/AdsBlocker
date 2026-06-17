import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ytDlpBaseArgs } from './media-formats.mjs';

const execFileAsync = promisify(execFile);

export async function searchYtDlp(query, limit = 20) {
  try {
    const { stdout } = await execFileAsync(
      'yt-dlp',
      [...ytDlpBaseArgs(), `ytsearch${limit}:${query}`, '-j', '--flat-playlist', '--no-warnings'],
      { timeout: 35000, maxBuffer: 15 * 1024 * 1024 },
    );

    const items = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((e) => e.id)
      .map((e) => ({
        url: `/watch?v=${e.id}`,
        title: e.title || 'Unknown',
        uploaderName: e.uploader || e.channel || '',
        thumbnail: e.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
        duration: e.duration,
      }));

    if (!items.length) return null;

    return {
      source: 'youtube-direct',
      instance: 'yt-dlp',
      data: { items },
    };
  } catch {
    return null;
  }
}
