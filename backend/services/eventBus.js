const streams = new Map();
const history = new Map();

function emit(fileId, event) {
  if (!fileId) return;
  const listeners = streams.get(String(fileId)) || [];
  const payload = {
    step: event.step,
    timestamp: event.timestamp || new Date().toISOString(),
    progressPercentage: Math.max(0, Math.min(100, Number(event.progressPercentage) || 0)),
    statusMessage: event.statusMessage || '',
    details: event.details || {}
  };
  const previous = history.get(String(fileId)) || [];
  history.set(String(fileId), [...previous, payload].slice(-30));
  listeners.forEach(listener => listener(payload));
}

function subscribe(fileId, listener) {
  const key = String(fileId);
  const listeners = streams.get(key) || [];
  listeners.push(listener);
  streams.set(key, listeners);
  (history.get(key) || []).forEach(listener);
  return () => {
    const remaining = (streams.get(key) || []).filter(item => item !== listener);
    if (remaining.length) streams.set(key, remaining);
    else streams.delete(key);
  };
}

module.exports = { emit, subscribe };