import ytdl from '@distube/ytdl-core';
import { Innertube } from 'youtubei.js';

let innertube = null;

async function getInnertube() {
  if (!innertube) innertube = await Innertube.create();
  return innertube;
}

function mapYtdlInfo(info) {
  const thumb =
    info.videoDetails.thumbnails?.at(-1)?.url ||
    `https://i.ytimg.com/vi/${info.videoDetails.videoId}/hqdefault.jpg`;

  const videoStreams = info.formats
    .filter((f) => f.hasVideo && f.hasAudio && f.url)
    .map((f) => ({
      url: f.url,
      mimeType: f.mimeType || 'video/mp4',
      quality: f.qualityLabel || String(f.height || ''),
      videoOnly: false,
    }));

  const audioStreams = info.formats
    .filter((f) => f.hasAudio && !f.hasVideo && f.url)
    .map((f) => ({
      url: f.url,
      mimeType: f.mimeType || 'audio/mp4',
      quality: String(f.audioBitrate || f.audioQuality || ''),
    }));

  if (!videoStreams.length && !audioStreams.length) {
    const fallback = info.formats.find((f) => f.url);
    if (fallback) {
      videoStreams.push({
        url: fallback.url,
        mimeType: fallback.mimeType || 'video/mp4',
        quality: fallback.qualityLabel || 'auto',
        videoOnly: !fallback.hasAudio,
      });
    }
  }

  return {
    title: info.videoDetails.title,
    uploader: info.videoDetails.author?.name || info.videoDetails.ownerChannelName || '',
    thumbnailUrl: thumb,
    videoStreams,
    audioStreams,
  };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}

export async function getStreamsDirect(videoId) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  try {
    const info = await withTimeout(
      ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`),
      7000,
    );
    const data = mapYtdlInfo(info);
    if (!data.videoStreams.length && !data.audioStreams.length) return null;

    return {
      source: 'youtube-direct',
      instance: 'ytdl-core',
      data: { ...data, useProxy: true },
    };
  } catch {
    return null;
  }
}

export async function searchDirect(query, filter = 'videos') {
  try {
    const yt = await withTimeout(getInnertube(), 8000);
    const searchType = filter === 'music_songs' ? 'video' : 'video';
    const results = await withTimeout(yt.search(query, { type: searchType }), 12000);

    const videos = results.videos || results.results || [];
    const items = videos
      .filter((v) => v.id || v.video_id)
      .slice(0, 20)
      .map((v) => {
        const id = v.id || v.video_id;
        return {
          url: `/watch?v=${id}`,
          title: v.title?.text ?? v.title ?? 'Unknown',
          uploaderName: v.author?.name ?? v.author ?? '',
          thumbnail: v.thumbnails?.[0]?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          duration: v.duration?.seconds ?? v.duration,
        };
      });

    if (!items.length) return null;

    return {
      source: 'youtube-direct',
      instance: 'youtubei.js',
      data: { items },
    };
  } catch {
    return null;
  }
}
