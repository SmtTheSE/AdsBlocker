const SESSION_KEY = 'clearstream-session';
const SESSION_VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let saveTimer = null;

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  const data = safeParse(raw);
  if (!data || data.version !== SESSION_VERSION) return null;
  if (Date.now() - (data.savedAt || 0) > MAX_AGE_MS) {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  return data;
}

export function saveSession(snapshot) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        version: SESSION_VERSION,
        savedAt: Date.now(),
        ...snapshot,
      }));
    } catch {
      // Storage full — ignore.
    }
  }, 400);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function flushSession(snapshot) {
  if (saveTimer) clearTimeout(saveTimer);
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      version: SESSION_VERSION,
      savedAt: Date.now(),
      ...snapshot,
    }));
  } catch {
    // ignore
  }
}
