const queue = [];
let currentIndex = -1;

export function getQueue() {
  return [...queue];
}

export function getCurrentIndex() {
  return currentIndex;
}

export function addToQueue(item) {
  const exists = queue.some((q) => q.id === item.id);
  if (exists) return false;
  queue.push(item);
  if (currentIndex === -1 && queue.length === 1) {
    currentIndex = 0;
  }
  return true;
}

export function addMany(items) {
  let added = 0;
  for (const item of items) {
    if (addToQueue(item)) added += 1;
  }
  return added;
}

export function removeFromQueue(id) {
  const idx = queue.findIndex((q) => q.id === id);
  if (idx === -1) return;
  queue.splice(idx, 1);
  if (currentIndex >= queue.length) {
    currentIndex = queue.length - 1;
  }
  if (queue.length === 0) currentIndex = -1;
}

export function clearQueue() {
  queue.length = 0;
  currentIndex = -1;
}

export function setCurrentIndex(idx) {
  if (idx < 0 || idx >= queue.length) return null;
  currentIndex = idx;
  return queue[currentIndex];
}

export function getCurrent() {
  if (currentIndex < 0 || currentIndex >= queue.length) return null;
  return queue[currentIndex];
}

export function next() {
  if (currentIndex < queue.length - 1) {
    currentIndex += 1;
    return queue[currentIndex];
  }
  return null;
}

export function prev() {
  if (currentIndex > 0) {
    currentIndex -= 1;
    return queue[currentIndex];
  }
  return null;
}

export function playNow(item) {
  const existing = queue.findIndex((q) => q.id === item.id);
  if (existing >= 0) {
    currentIndex = existing;
  } else {
    queue.unshift(item);
    currentIndex = 0;
  }
  return queue[currentIndex];
}

export function queueRemaining() {
  if (currentIndex < 0) return 0;
  return Math.max(0, queue.length - currentIndex - 1);
}

export function hasNext() {
  return currentIndex < queue.length - 1;
}

export function restoreQueue(items, index = -1) {
  queue.length = 0;
  if (!Array.isArray(items)) {
    currentIndex = -1;
    return;
  }
  for (const item of items) {
    if (item?.id?.length === 11) queue.push(item);
  }
  currentIndex = index >= 0 && index < queue.length ? index : (queue.length ? 0 : -1);
}

export function snapshot() {
  return { items: getQueue(), currentIndex };
}
