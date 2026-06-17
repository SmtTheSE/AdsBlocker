export async function getOEmbedMeta(videoId) {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const data = await res.json();

    return {
      source: 'oembed',
      instance: 'youtube.com',
      data: {
        title: data.title,
        uploader: data.author_name || '',
        thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        useProxy: true,
        audioStreams: [],
        videoStreams: [],
      },
    };
  } catch {
    return null;
  }
}
