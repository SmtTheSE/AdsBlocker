import { extractVideoId } from './config.js';

const INSTALL_KEY = 'clearstream-install-dismissed';
const SETUP_KEY = 'clearstream-setup-seen';

let deferredPrompt = null;

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    document.referrer.includes('android-app://')
  );
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

export function initInstallUI({ onInstallSuccess } = {}) {
  const setupModal = document.getElementById('setup-modal');
  const btnInstall = document.getElementById('btn-install');
  const btnDismiss = document.getElementById('install-dismiss');
  const btnSetupClose = document.getElementById('setup-close');
  const btnOpenSetup = document.getElementById('btn-open-setup');

  if (!setupModal && !btnOpenSetup) return;

  const banner = document.getElementById('install-banner');

  function showBanner() {
    if (!banner || isStandalone() || localStorage.getItem(INSTALL_KEY)) return;
    banner.hidden = false;
  }

  function hideBanner() {
    if (banner) banner.hidden = true;
    localStorage.setItem(INSTALL_KEY, '1');
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showBanner();
  });

  if (banner && !isStandalone() && !localStorage.getItem(INSTALL_KEY)) {
    setTimeout(showBanner, 1500);
  }

  btnInstall?.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      hideBanner();
      if (outcome === 'accepted') {
        onInstallSuccess?.();
        toast('Installed! Open ClearStream from your home screen.');
      }
      return;
    }
    openSetupModal();
  });

  btnOpenSetup?.addEventListener('click', openSetupModal);

  function openSetupModal() {
    setupModal.hidden = false;
    if (isIOS()) {
      document.getElementById('setup-ios')?.removeAttribute('hidden');
      document.getElementById('setup-android')?.setAttribute('hidden', '');
    } else {
      document.getElementById('setup-android')?.removeAttribute('hidden');
      document.getElementById('setup-ios')?.setAttribute('hidden', '');
    }
  }

  btnDismiss?.addEventListener('click', hideBanner);
  btnSetupClose?.addEventListener('click', closeSetup);
  document.getElementById('setup-done')?.addEventListener('click', closeSetup);

  function closeSetup() {
    setupModal.hidden = true;
    localStorage.setItem(SETUP_KEY, '1');
  }

  if (!isStandalone() && !localStorage.getItem(SETUP_KEY) && !localStorage.getItem('clearstream-shield')) {
    setTimeout(openSetupModal, 2000);
  }

  if (isStandalone()) {
    document.body.classList.add('is-standalone');
  }
}

export function parseIncomingLink() {
  const params = new URLSearchParams(location.search);
  const candidates = [
    params.get('url'),
    params.get('text'),
    params.get('v'),
    params.get('link'),
  ].filter(Boolean);

  if (params.get('title') || params.get('text') || params.get('url')) {
    const shared = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
    candidates.unshift(shared);
  }

  for (const raw of candidates) {
    const id = extractVideoId(raw);
    if (id) return { videoId: id, mode: params.get('mode') };
  }

  return {
    videoId: null,
    mode: params.get('mode'),
    focusSearch: params.get('focus') === 'search',
  };
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3000);
}

function safeMediaAction(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Action not supported on this platform.
  }
}

export function initMediaSession(player, getMeta) {
  if (!('mediaSession' in navigator)) return;

  const update = () => {
    const meta = getMeta();
    if (!meta) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.uploader || 'ClearStream',
      album: 'ClearStream',
      artwork: meta.thumbnail
        ? [{ src: meta.thumbnail, sizes: '512x512', type: 'image/jpeg' }]
        : [],
    });
  };

  safeMediaAction('play', () => { player.play(); });
  safeMediaAction('pause', () => { player.pause(); });
  safeMediaAction('previoustrack', () => {
    document.getElementById('btn-prev')?.click();
  });
  safeMediaAction('nexttrack', () => {
    document.getElementById('btn-next')?.click();
  });
  safeMediaAction('seekto', (details) => {
    if (details.seekTime != null) player.seek(details.seekTime);
  });
  safeMediaAction('seekbackward', (details) => {
    player.skipBy(-(details.seekOffset || 10));
  });
  safeMediaAction('seekforward', (details) => {
    player.skipBy(details.seekOffset || 10);
  });

  return { update };
}
