const SHIELD_KEY = 'clearstream-shield';
const DNS_KEY = 'clearstream-dns-shield';
const AUTOPLAY_KEY = 'clearstream-autoplay';

export const DNS_PROVIDERS = [
  { id: 'adguard', name: 'AdGuard DNS', host: 'dns.adguard.com', note: 'Blocks ads & trackers system-wide' },
  { id: 'nextdns', name: 'NextDNS', host: 'your-id.dns.nextdns.io', note: 'Free tier — sign up at nextdns.io' },
];

export function isShieldConnected() {
  return localStorage.getItem(SHIELD_KEY) === 'connected';
}

export function isDnsShieldEnabled() {
  return localStorage.getItem(DNS_KEY) === '1';
}

export function isAutoplayOn() {
  return localStorage.getItem(AUTOPLAY_KEY) !== 'off';
}

export function setAutoplay(on) {
  localStorage.setItem(AUTOPLAY_KEY, on ? 'on' : 'off');
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

export function initShield({ onConnect, onDisconnect }) {
  const screen = document.getElementById('shield-screen');
  const appShell = document.getElementById('app-shell');
  const btnConnect = document.getElementById('shield-connect');
  const btnDisconnect = document.getElementById('shield-disconnect');
  const shieldRing = document.getElementById('shield-ring');
  const shieldStatus = document.getElementById('shield-status-label');
  const dnsToggle = document.getElementById('dns-shield-toggle');
  const dnsPanel = document.getElementById('dns-panel');
  const dnsHost = document.getElementById('dns-host');
  const btnCopyDns = document.getElementById('dns-copy');
  const autoplayToggle = document.getElementById('autoplay-toggle');
  const platformDns = document.getElementById('dns-platform-steps');

  let connecting = false;

  function applyUI(connected) {
    document.body.dataset.shield = connected ? 'on' : 'off';
    if (screen) screen.hidden = connected;
    if (appShell) appShell.hidden = !connected;
    if (shieldStatus) {
      shieldStatus.textContent = connected ? 'Shield active' : 'Not connected';
    }
  }

  function connect() {
    if (connecting || isShieldConnected()) return;
    connecting = true;
    btnConnect?.setAttribute('disabled', '');
    btnConnect?.classList.add('is-connecting');
    shieldRing?.classList.add('is-connecting');

    setTimeout(() => {
      localStorage.setItem(SHIELD_KEY, 'connected');
      connecting = false;
      btnConnect?.removeAttribute('disabled');
      btnConnect?.classList.remove('is-connecting');
      shieldRing?.classList.remove('is-connecting');
      shieldRing?.classList.add('is-on');
      applyUI(true);
      onConnect?.();
      toast('Shield connected — ad-free stream ready');
    }, 1600);
  }

  function disconnect() {
    localStorage.removeItem(SHIELD_KEY);
    shieldRing?.classList.remove('is-on');
    applyUI(false);
    onDisconnect?.();
    toast('Shield disconnected');
  }

  btnConnect?.addEventListener('click', connect);
  btnDisconnect?.addEventListener('click', disconnect);

  dnsToggle?.addEventListener('change', () => {
    const on = dnsToggle.checked;
    localStorage.setItem(DNS_KEY, on ? '1' : '0');
    if (dnsPanel) dnsPanel.hidden = !on;
  });

  autoplayToggle?.addEventListener('change', () => {
    setAutoplay(autoplayToggle.checked);
  });

  document.querySelectorAll('[data-dns]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const provider = DNS_PROVIDERS.find((p) => p.id === btn.dataset.dns);
      if (provider && dnsHost) dnsHost.textContent = provider.host;
      document.querySelectorAll('[data-dns]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  btnCopyDns?.addEventListener('click', async () => {
    const host = dnsHost?.textContent || 'dns.adguard.com';
    try {
      await navigator.clipboard.writeText(host);
      toast(`Copied: ${host}`);
    } catch {
      toast(host);
    }
  });

  if (platformDns) {
    if (isAndroid()) {
      platformDns.innerHTML = `
        <h4>Android — block ads in all apps</h4>
        <ol>
          <li>Copy the DNS hostname above</li>
          <li>Open <strong>Settings → Network → Private DNS</strong></li>
          <li>Choose <strong>Private DNS provider hostname</strong></li>
          <li>Paste <strong>dns.adguard.com</strong> → Save</li>
          <li>Re-open YouTube / Music apps — many ads blocked</li>
        </ol>
        <p class="dns-note">YouTube may still show some ads. For 100% ad-free, play music here in Shield mode.</p>
      `;
    } else if (isIOS()) {
      platformDns.innerHTML = `
        <h4>iPhone — reduce ads system-wide</h4>
        <ol>
          <li>Install <strong>AdGuard</strong> or <strong>NextDNS</strong> from the App Store</li>
          <li>Enable their DNS/VPN profile in the app</li>
          <li>Or: Settings → Wi-Fi → (i) → Configure DNS → Manual</li>
          <li>Add AdGuard DNS: <strong>94.140.14.14</strong> and <strong>94.140.15.15</strong></li>
        </ol>
        <p class="dns-note">For ad-free YouTube/Music playback, use ClearStream (connected) instead of those apps.</p>
      `;
    } else {
      platformDns.innerHTML = `
        <h4>Desktop / other</h4>
        <p>Set system DNS to AdGuard (<strong>94.140.14.14</strong>) or use ClearStream player when connected.</p>
      `;
    }
  }

  if (dnsToggle) {
    dnsToggle.checked = isDnsShieldEnabled();
    if (dnsPanel) dnsPanel.hidden = !dnsToggle.checked;
  }
  if (autoplayToggle) autoplayToggle.checked = isAutoplayOn();

  document.querySelector('[data-dns="adguard"]')?.classList.add('active');

  if (isShieldConnected()) {
    shieldRing?.classList.add('is-on');
    applyUI(true);
    onConnect?.();
  } else {
    applyUI(false);
  }

  return { connect, disconnect, isConnected: isShieldConnected };
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3000);
}
