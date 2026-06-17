import { extractVideoId, formatDuration } from './config.js';
import { getStreams, searchVideos, searchMusic, getActiveInstance, getActiveSource } from './api.js';
import * as queue from './queue.js';
import { createPlayer } from './player.js';
import { initInstallUI, parseIncomingLink, initMediaSession, isStandalone } from './install.js';
import { initShield, isAutoplayOn, isShieldConnected } from './shield.js';
import { prefetchQueue, prefetchItemList } from './cache.js';
import { loadSession, saveSession, flushSession } from './persist.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  app: $('.app'),
  searchForm: $('#search-form'),
  searchInput: $('#search-input'),
  modeToggle: $('#mode-toggle'),
  queueToggle: $('#queue-toggle'),
  queueCount: $('#queue-count'),
  queueRemaining: $('#queue-remaining'),
  queuePanel: $('#queue-panel'),
  queueList: $('#queue-list'),
  queueEmpty: $('#queue-empty'),
  queueClear: $('#queue-clear'),
  queueAll: $('#queue-all'),
  emptyState: $('#empty-state'),
  activePlayer: $('#active-player'),
  video: $('#video-el'),
  musicVisual: $('#music-visual'),
  musicArt: $('#music-art'),
  trackTitle: $('#track-title'),
  trackAuthor: $('#track-author'),
  btnPrev: $('#btn-prev'),
  btnPlay: $('#btn-play'),
  btnNext: $('#btn-next'),
  btnQueueAdd: $('#btn-queue-add'),
  seekRange: $('#seek-range'),
  timeCurrent: $('#time-current'),
  timeDuration: $('#time-duration'),
  resultsSection: $('#results-section'),
  resultsTitle: $('#results-title'),
  resultsCount: $('#results-count'),
  resultsList: $('#results-list'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
  instanceText: $('#instance-text'),
  toast: $('#toast'),
};

const player = createPlayer(els.video);
let musicMode = true;
let currentMeta = null;
let loading = false;
let mediaSessionCtl = null;
let lastSearchItems = [];
let seekDragging = false;
let positionSaveTimer = null;
let sessionRestored = false;

function sessionSnapshot(wasPlaying = null) {
  return {
    musicMode,
    queue: queue.snapshot(),
    currentMeta,
    lastSearchItems,
    searchInput: els.searchInput?.value || '',
    position: player.getCurrentTime(),
    wasPlaying: wasPlaying ?? !player.isPaused(),
  };
}

function persistSession(wasPlaying = null) {
  if (!currentMeta && !queue.getQueue().length) return;
  saveSession(sessionSnapshot(wasPlaying));
}

function updateSeekBar() {
  if (!els.seekRange || seekDragging) return;

  const current = player.getCurrentTime();
  const duration = player.getDuration();
  const seekableEnd = player.getSeekableEnd();
  const max = duration > 0 ? duration : seekableEnd;

  els.timeCurrent.textContent = formatDuration(current);
  els.timeDuration.textContent = formatDuration(max);
  els.seekRange.max = String(max || 0);
  els.seekRange.value = String(current);
  els.seekRange.disabled = max <= 0;

  if (!positionSaveTimer && currentMeta) {
    positionSaveTimer = setTimeout(() => {
      positionSaveTimer = null;
      persistSession();
    }, 3000);
  }
}

function setStatus(state, text) {
  els.statusDot.dataset.state = state;
  els.statusText.textContent = text;
  const inst = getActiveInstance();
  const src = getActiveSource();
  els.instanceText.textContent = inst
    ? `${src || 'api'} · ${inst.replace('https://', '')}`
    : '—';
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { els.toast.hidden = true; }, 2800);
}

function setMusicMode(on) {
  musicMode = on;
  els.app.dataset.mode = on ? 'music' : 'video';
  els.modeToggle.setAttribute('aria-pressed', String(on));
  els.musicVisual.hidden = !on;
  persistSession();
}

function updateTransport() {
  const idx = queue.getCurrentIndex();
  const active = player.getActive();
  els.btnPrev.disabled = idx <= 0;
  els.btnNext.disabled = !queue.hasNext();
  els.btnPlay.textContent = active.paused ? '▶' : '⏸';
  if (els.queueRemaining) {
    els.queueRemaining.textContent = String(queue.queueRemaining());
  }
}

function renderQueue() {
  const items = queue.getQueue();
  const idx = queue.getCurrentIndex();
  els.queueCount.textContent = String(items.length);
  els.queueEmpty.hidden = items.length > 0;
  els.queueList.innerHTML = '';

  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'queue-item' + (i === idx ? ' is-active' : '');
    li.innerHTML = `
      <button type="button" class="queue-item__play" data-id="${item.id}">
        <img src="${item.thumbnail}" alt="" width="48" height="48" loading="lazy">
        <span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.uploader || '')}</small>
        </span>
      </button>
      <button type="button" class="queue-item__remove" data-remove="${item.id}" aria-label="Remove">×</button>
    `;
    els.queueList.appendChild(li);
  });
  updateTransport();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showPlayer(show) {
  els.emptyState.hidden = show;
  els.activePlayer.hidden = !show;
}

function mapSearchItem(item) {
  const url = item.url || '';
  const id =
    extractVideoId(url.startsWith('http') ? url : `https://youtube.com${url}`) ||
    extractVideoId(item.id) || null;
  return {
    id,
    title: item.title,
    uploader: item.uploaderName || item.uploader || '',
    thumbnail: item.thumbnail || '',
    duration: item.duration,
  };
}

function renderResults(items, title) {
  const mapped = items.map(mapSearchItem).filter((i) => i.id?.length === 11);
  lastSearchItems = mapped;

  if (!mapped.length) {
    els.resultsSection.hidden = true;
    return;
  }

  els.resultsTitle.textContent = title;
  els.resultsCount.textContent = `${mapped.length} tracks`;
  els.resultsList.innerHTML = '';

  mapped.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'result-item';
    li.innerHTML = `
      <img src="${item.thumbnail}" alt="" width="120" height="68" loading="lazy">
      <div class="result-item__body">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.uploader)} · ${formatDuration(item.duration)}</span>
      </div>
      <div class="result-item__actions">
        <button type="button" data-play="${item.id}">Play</button>
        <button type="button" data-add="${item.id}" class="ghost">+ Queue</button>
      </div>
    `;
    li.dataset.item = JSON.stringify(item);
    els.resultsList.appendChild(li);
  });

  els.resultsSection.hidden = false;
  if (musicMode) prefetchItemList(mapped);
  persistSession();
}

function queueSearchResults(startItem) {
  const items = lastSearchItems.filter((i) => i.id !== startItem?.id);
  const added = queue.addMany(items);
  renderQueue();
  return added;
}

async function refillQueueFromSearch() {
  if (!currentMeta || !isAutoplayOn()) return false;
  const query = currentMeta.uploader || currentMeta.title || 'music';
  setStatus('loading', 'Finding next songs…');
  try {
    const results = musicMode ? await searchMusic(query) : await searchVideos(query);
    const items = (results.items || results || []).map(mapSearchItem).filter((i) => i.id?.length === 11);
    const filtered = items.filter((i) => !queue.getQueue().some((q) => q.id === i.id));
    const added = queue.addMany(filtered.slice(0, 15));
    renderQueue();
    setStatus('playing', 'Continuous play');
    return added > 0;
  } catch {
    return false;
  }
}

async function loadAndPlay(item, { addToQueueFirst = false, queueRest = false, resumePosition = null } = {}) {
  if (loading) return;
  loading = true;
  setStatus('loading', 'Loading stream…');

  try {
    if (addToQueueFirst) queue.addToQueue(item);
    else queue.playNow(item);

    if (queueRest && lastSearchItems.length) {
      queueSearchResults(item);
    }

    let data;
    try {
      data = await getStreams(item.id);
    } catch (err) {
      console.warn('Metadata fetch failed, using proxy playback:', err);
      data = {
        title: item.title,
        uploader: item.uploader,
        thumbnailUrl: item.thumbnail,
        useProxy: true,
        audioStreams: [],
        videoStreams: [],
      };
    }

    if (!data) {
      data = {
        title: item.title,
        uploader: item.uploader,
        thumbnailUrl: item.thumbnail,
        useProxy: true,
        audioStreams: [],
        videoStreams: [],
      };
    }

    currentMeta = {
      ...item,
      title: data.title || item.title,
      uploader: data.uploader || item.uploader,
      thumbnail: data.thumbnailUrl || item.thumbnail,
    };

    await player.load(data, { musicMode, videoId: item.id });
    els.trackTitle.textContent = currentMeta.title;
    els.trackAuthor.textContent = currentMeta.uploader;
    els.musicArt.src = currentMeta.thumbnail;
    els.musicArt.alt = currentMeta.title;

    showPlayer(true);
    renderQueue();
    if (resumePosition != null && resumePosition > 0) {
      player.seek(resumePosition);
    }
    await player.play();
    updateTransport();
    updateSeekBar();
    mediaSessionCtl?.update();
    prefetchQueue(queue.getQueue(), queue.getCurrentIndex(), musicMode);
    persistSession(true);
    setStatus('playing', musicMode ? 'Playing · auto-queue on' : 'Playing video');
  } catch (err) {
    setStatus('error', 'Failed to load');
    toast(err.message || 'Could not play — try another track');
    console.error('Playback failed:', err);
    persistSession(false);
  } finally {
    loading = false;
  }
}

async function handleSearchInput(raw) {
  const value = raw.trim();
  if (!value) return;

  const videoId = extractVideoId(value);
  if (videoId) {
    els.resultsSection.hidden = true;
    await loadAndPlay({
      id: videoId,
      title: 'Loading…',
      uploader: '',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
    return;
  }

  setStatus('loading', 'Searching…');
  try {
    const results = musicMode ? await searchMusic(value) : await searchVideos(value);
    const items = results.items || results || [];
    renderResults(items, musicMode ? 'Music' : 'Videos');
    setStatus('idle', 'Shield active');

    if (musicMode && isAutoplayOn() && items.length) {
      const first = mapSearchItem(items[0]);
      if (first.id) {
        toast('Auto-playing — songs queued one after another');
        await loadAndPlay(first, { queueRest: true });
      }
    }
  } catch (err) {
    setStatus('error', 'Search failed');
    toast(err.message || 'Search failed');
  }
}

player.onEnded = async () => {
  let nextItem = queue.next();
  if (!nextItem && isAutoplayOn()) {
    const refilled = await refillQueueFromSearch();
    if (refilled) nextItem = queue.next();
  }
  if (nextItem) {
    await loadAndPlay(nextItem);
    toast('Next track ▶');
  } else {
    updateTransport();
    setStatus('idle', 'Queue ended');
  }
};

async function restoreSession() {
  if (sessionRestored) return;
  sessionRestored = true;

  const session = loadSession();
  if (!session) return;

  if (typeof session.musicMode === 'boolean') setMusicMode(session.musicMode);
  if (session.queue?.items?.length) {
    queue.restoreQueue(session.queue.items, session.queue.currentIndex ?? 0);
    renderQueue();
  }
  if (session.lastSearchItems?.length) {
    lastSearchItems = session.lastSearchItems;
  }
  if (session.searchInput && els.searchInput) {
    els.searchInput.value = session.searchInput;
  }

  const meta = session.currentMeta;
  if (!meta?.id || meta.id.length !== 11) return;

  currentMeta = meta;
  els.trackTitle.textContent = meta.title || '—';
  els.trackAuthor.textContent = meta.uploader || '';
  if (meta.thumbnail) {
    els.musicArt.src = meta.thumbnail;
    els.musicArt.alt = meta.title || '';
  }
  showPlayer(true);

  toast('Restoring your session…');
  await loadAndPlay(meta, {
    resumePosition: session.position > 0 ? session.position : null,
  });
  if (!session.wasPlaying) {
    player.pause();
    updateTransport();
  }
}

els.searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  handleSearchInput(els.searchInput.value);
});

els.modeToggle.addEventListener('click', () => {
  setMusicMode(!musicMode);
  toast(musicMode ? 'Music mode' : 'Video mode');
  if (currentMeta) loadAndPlay({ ...currentMeta, id: currentMeta.id }, { queueRest: false });
});

els.queueToggle.addEventListener('click', () => {
  const open = els.queuePanel.hidden;
  els.queuePanel.hidden = !open;
  els.queueToggle.setAttribute('aria-expanded', String(open));
});

els.queueClear.addEventListener('click', () => {
  queue.clearQueue();
  renderQueue();
});

els.queueAll?.addEventListener('click', async () => {
  if (!lastSearchItems.length) return;
  queue.clearQueue();
  await loadAndPlay(lastSearchItems[0], { queueRest: true });
});

els.queueList.addEventListener('click', (e) => {
  const remove = e.target.closest('[data-remove]');
  if (remove) {
    queue.removeFromQueue(remove.dataset.remove);
    renderQueue();
    return;
  }
  const play = e.target.closest('[data-play]');
  if (play) {
    const item = queue.getQueue().find((q) => q.id === play.dataset.id);
    if (item) {
      queue.setCurrentIndex(queue.getQueue().findIndex((q) => q.id === item.id));
      loadAndPlay(item);
    }
  }
});

els.resultsList.addEventListener('click', async (e) => {
  const li = e.target.closest('.result-item');
  if (!li) return;
  const item = JSON.parse(li.dataset.item);
  if (e.target.matches('[data-add]')) {
    if (queue.addToQueue(item)) toast('Added to queue');
    renderQueue();
    return;
  }
  if (e.target.matches('[data-play]')) {
    await loadAndPlay(item, { queueRest: musicMode && isAutoplayOn() });
  }
});

els.btnPlay.addEventListener('click', () => { player.toggle(); updateTransport(); });
els.btnPrev.addEventListener('click', () => { const i = queue.prev(); if (i) loadAndPlay(i); });
els.btnNext.addEventListener('click', () => { const i = queue.next(); if (i) loadAndPlay(i); });
els.btnQueueAdd.addEventListener('click', () => {
  if (!currentMeta) return;
  if (queue.addToQueue(currentMeta)) toast('Added to queue');
  renderQueue();
});

els.video.addEventListener('play', () => { updateTransport(); persistSession(true); });
els.video.addEventListener('pause', () => { updateTransport(); persistSession(false); });

player.onTimeUpdate = updateSeekBar;

els.seekRange?.addEventListener('pointerdown', () => { seekDragging = true; });
els.seekRange?.addEventListener('pointerup', () => {
  seekDragging = false;
  player.seek(Number(els.seekRange.value));
  updateSeekBar();
});
els.seekRange?.addEventListener('input', () => {
  if (!seekDragging) return;
  els.timeCurrent.textContent = formatDuration(Number(els.seekRange.value));
});
els.seekRange?.addEventListener('change', () => {
  seekDragging = false;
  player.seek(Number(els.seekRange.value));
  updateSeekBar();
});

document.querySelectorAll('[data-search]').forEach((btn) => {
  btn.addEventListener('click', () => {
    els.searchInput.value = btn.dataset.search;
    handleSearchInput(btn.dataset.search);
  });
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

initInstallUI();
mediaSessionCtl = initMediaSession(player, () => currentMeta);

initShield({
  onConnect: async () => {
    const incoming = parseIncomingLink();
    if (!incoming.videoId) {
      await restoreSession();
    }
    if (!currentMeta) {
      setMusicMode(loadSession()?.musicMode ?? true);
      setStatus('idle', 'Shield active — search music');
    }
    if (incoming.videoId) handleSearchInput(incoming.videoId);
    else if (incoming.focusSearch) els.searchInput.focus();
  },
});

window.addEventListener('beforeunload', () => {
  flushSession(sessionSnapshot());
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSession(sessionSnapshot());
});

const incoming = parseIncomingLink();
if (incoming.mode === 'video') setMusicMode(false);
else setMusicMode(loadSession()?.musicMode ?? true);

renderQueue();
