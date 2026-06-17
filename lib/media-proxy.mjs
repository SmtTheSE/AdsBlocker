import { serveMedia } from './media-cache.mjs';

export async function pipeMedia(videoId, audioOnly, req, res) {
  await serveMedia(videoId, audioOnly, req, res);
}
