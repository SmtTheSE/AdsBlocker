import { pickBestStream } from './config.js';
import { getMediaBackendUrl } from './api.js';

function isGoogleCdn(url) {
  return url && (url.includes('googlevideo.com') || url.includes('youtube.com/videoplayback'));
}

function mediaProxyUrl(videoId, musicMode) {
  const base = getMediaBackendUrl() || '';
  return `${base}/api/media?videoId=${encodeURIComponent(videoId)}&audio=${musicMode ? 1 : 0}`;
}

let activeObjectUrl = null;

function revokeObjectUrl() {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

async function fetchMediaBlob(src) {
  const res = await fetch(src, { signal: AbortSignal.timeout(300000) });
  const ct = res.headers.get('content-type') || '';

  if (!res.ok || ct.includes('application/json')) {
    let msg = `Media server error (${res.status})`;
    try {
      const json = await res.json();
      if (json.error) msg = json.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  if (!blob.size || blob.type.includes('json')) {
    throw new Error('Media server returned invalid data');
  }
  return blob;
}

async function loadAsBlob(el, src) {
  revokeObjectUrl();
  const blob = await fetchMediaBlob(src);
  activeObjectUrl = URL.createObjectURL(blob);
  el.removeAttribute('src');
  el.src = activeObjectUrl;
  el.load();
  await waitForMedia(el);
}

function waitForMedia(el, timeoutMs = 120000) {
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
        ? 'Could not decode stream — try Video mode or another track'
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

export function createPlayer(videoEl, audioEl) {
  let onEnded = null;
  let onTimeUpdate = null;
  let musicMode = false;
  let currentVideoId = null;

  function activeEl() {
    return musicMode ? audioEl : videoEl;
  }

  function idleEl() {
    return musicMode ? videoEl : audioEl;
  }

  function bindMediaEvents(el) {
    el.addEventListener('ended', () => {
      if (el === activeEl() && onEnded) onEnded();
    });
    el.addEventListener('timeupdate', () => {
      if (el === activeEl() && onTimeUpdate) onTimeUpdate();
    });
    el.addEventListener('loadedmetadata', () => {
      if (el === activeEl() && onTimeUpdate) onTimeUpdate();
    });
    el.addEventListener('durationchange', () => {
      if (el === activeEl() && onTimeUpdate) onTimeUpdate();
    });
    el.addEventListener('error', () => {
      if (el !== activeEl()) return;
      const err = el.error;
      if (err) console.warn('Playback error', err.code, err.message);
    });
  }

  bindMediaEvents(videoEl);
  bindMediaEvents(audioEl);

  return {
    getActive() {
      return activeEl();
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

      const other = idleEl();
      other.pause();
      other.removeAttribute('src');
      other.load();

      const el = activeEl();
      el.crossOrigin = 'anonymous';

      const streams = music
        ? streamData.audioStreams || []
        : [...(streamData.videoStreams || []), ...(streamData.audioStreams || [])];

      const stream = pickBestStream(streams, music);

      const mustProxy =
        streamData.useProxy ||
        videoId ||
        isGoogleCdn(stream?.url);

      if (mustProxy && videoId) {
        const src = mediaProxyUrl(videoId, music);
        if (music) {
          await loadAsBlob(el, src);
        } else {
          revokeObjectUrl();
          el.src = src;
          el.poster = streamData.thumbnailUrl || '';
          el.load();
          await waitForMedia(el);
        }
        return { proxied: true };
      }

      if (!stream?.url) {
        throw new Error('No playable stream found');
      }

      revokeObjectUrl();
      el.src = stream.url;
      if (!music) el.poster = streamData.thumbnailUrl || '';
      el.load();
      await waitForMedia(el);
      return stream;
    },

    async play() {
      const el = activeEl();
      try {
        await el.play();
      } catch (err) {
        if (err?.name === 'NotSupportedError') {
          throw new Error('Playback not supported — try another track or switch to Video mode');
        }
        throw err;
      }
    },

    pause() {
      activeEl().pause();
    },

    toggle() {
      if (activeEl().paused) return this.play();
      this.pause();
    },

    seek(seconds) {
      const el = activeEl();
      if (!Number.isFinite(seconds)) return false;
      const duration = el.duration;
      const max = Number.isFinite(duration) && duration > 0 ? duration : seconds;
      const next = Math.max(0, Math.min(seconds, max));

      if (el.seekable?.length) {
        const start = el.seekable.start(0);
        const end = el.seekable.end(el.seekable.length - 1);
        if (next < start || next > end) return false;
      }

      el.currentTime = next;
      return true;
    },

    skipBy(deltaSeconds) {
      return this.seek((activeEl().currentTime || 0) + deltaSeconds);
    },

    getDuration() {
      const d = activeEl().duration;
      return Number.isFinite(d) ? d : 0;
    },

    getCurrentTime() {
      return activeEl().currentTime || 0;
    },

    getSeekableEnd() {
      const el = activeEl();
      if (!el.seekable?.length) return this.getDuration();
      return el.seekable.end(el.seekable.length - 1);
    },

    isPaused() {
      return activeEl().paused;
    },

    isMusicMode() {
      return musicMode;
    },

    getVideoId() {
      return currentVideoId;
    },

    destroy() {
      revokeObjectUrl();
      for (const el of [videoEl, audioEl]) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
    },
  };
}
