import { pickBestStream } from './config.js';

function isGoogleCdn(url) {
  return url && (url.includes('googlevideo.com') || url.includes('youtube.com/videoplayback'));
}

function mediaProxyUrl(videoId, musicMode) {
  return `/api/media?videoId=${encodeURIComponent(videoId)}&audio=${musicMode ? 1 : 0}`;
}

function waitForMedia(el, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Stream took too long to start'));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      const code = el.error?.code;
      const msg = code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        ? 'Format not supported by your browser'
        : (el.error?.message || 'Could not load stream');
      reject(new Error(msg));
    };

    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener('loadeddata', onReady);
      el.removeEventListener('canplay', onReady);
      el.removeEventListener('error', onError);
    };

    el.addEventListener('loadeddata', onReady, { once: true });
    el.addEventListener('canplay', onReady, { once: true });
    el.addEventListener('error', onError, { once: true });
  });
}

export function createPlayer(videoEl) {
  let onEnded = null;
  let onTimeUpdate = null;
  let musicMode = false;
  let currentVideoId = null;

  videoEl.addEventListener('ended', () => {
    if (onEnded) onEnded();
  });

  videoEl.addEventListener('timeupdate', () => {
    if (onTimeUpdate) onTimeUpdate();
  });

  videoEl.addEventListener('loadedmetadata', () => {
    if (onTimeUpdate) onTimeUpdate();
  });

  videoEl.addEventListener('durationchange', () => {
    if (onTimeUpdate) onTimeUpdate();
  });

  videoEl.addEventListener('error', () => {
    const err = videoEl.error;
    if (err) console.warn('Playback error', err.code, err.message);
  });

  return {
    getActive() {
      return videoEl;
    },

    set onEnded(cb) {
      onEnded = cb;
    },

    set onTimeUpdate(cb) {
      onTimeUpdate = cb;
    },

    async load(streamData, { musicMode: music = false, videoId = null } = {}) {
      musicMode = music;
      currentVideoId = videoId;

      const streams = music
        ? streamData.audioStreams || []
        : [...(streamData.videoStreams || []), ...(streamData.audioStreams || [])];

      const stream = pickBestStream(streams, music);

      const mustProxy =
        streamData.useProxy ||
        videoId ||
        isGoogleCdn(stream?.url);

      if (mustProxy && videoId) {
        videoEl.src = mediaProxyUrl(videoId, music);
        videoEl.poster = streamData.thumbnailUrl || '';
        videoEl.load();
        await waitForMedia(videoEl);
        return { proxied: true };
      }

      if (!stream?.url) {
        throw new Error('No playable stream found');
      }

      videoEl.src = stream.url;
      videoEl.poster = streamData.thumbnailUrl || '';
      videoEl.load();
      await waitForMedia(videoEl);
      return stream;
    },

    async play() {
      try {
        await videoEl.play();
      } catch (err) {
        if (err?.name === 'NotSupportedError') {
          throw new Error('Playback not supported — try another track or switch to Video mode');
        }
        throw err;
      }
    },

    pause() {
      videoEl.pause();
    },

    toggle() {
      if (videoEl.paused) return this.play();
      this.pause();
    },

    seek(seconds) {
      if (!Number.isFinite(seconds)) return false;
      const duration = videoEl.duration;
      const max = Number.isFinite(duration) && duration > 0 ? duration : seconds;
      const next = Math.max(0, Math.min(seconds, max));

      if (videoEl.seekable?.length) {
        const start = videoEl.seekable.start(0);
        const end = videoEl.seekable.end(videoEl.seekable.length - 1);
        if (next < start || next > end) return false;
      }

      videoEl.currentTime = next;
      return true;
    },

    skipBy(deltaSeconds) {
      return this.seek((videoEl.currentTime || 0) + deltaSeconds);
    },

    getDuration() {
      const d = videoEl.duration;
      return Number.isFinite(d) ? d : 0;
    },

    getCurrentTime() {
      return videoEl.currentTime || 0;
    },

    getSeekableEnd() {
      if (!videoEl.seekable?.length) return this.getDuration();
      return videoEl.seekable.end(videoEl.seekable.length - 1);
    },

    isPaused() {
      return videoEl.paused;
    },

    isMusicMode() {
      return musicMode;
    },

    getVideoId() {
      return currentVideoId;
    },

    destroy() {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
    },
  };
}
