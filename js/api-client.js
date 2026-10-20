let origin = '';
const terminal = status => ['completed', 'failed', 'cancelled', 'interrupted'].includes(status);
export const apiURL = path => `${origin}/api/v1${path}`;
export const backendURL = path => `${origin}${path}`;

export async function connectBackend() {
  const candidates = [''];
  if (['localhost', '127.0.0.1'].includes(location.hostname) && location.port !== '8010') {
    candidates.push('http://127.0.0.1:8010');
  }
  for (const candidate of candidates) {
    try {
      const response = await fetch(`${candidate}/api/v1/health`, {signal: AbortSignal.timeout(3000)});
      const health = await response.json();
      if (response.ok && health.mode === 'local-single-user') { origin = candidate; return health; }
    } catch { /* Try the explicit local API. Never substitute mock data. */ }
  }
  throw new Error('Cannot reach the simulation backend. Start the CrisisSim backend on port 8010, then use Retry connection. No demo results are substituted.');
}

export async function api(path, options = {}) {
  const response = await fetch(apiURL(path), {
    ...options,
    headers: { ...(options.body ? {'Content-Type': 'application/json'} : {}), ...options.headers },
    signal: options.signal || AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    let body;
    try { body = await response.json(); } catch { body = { detail: response.statusText }; }
    const detail = typeof body.detail === 'string' ? body.detail :
      (Array.isArray(body.detail) ? body.detail : []).map(e => `${e.loc?.slice(1).join('.')}: ${e.msg}`).join('; ');
    throw new Error(`${response.status}: ${detail || 'Request failed. Try again.'}`);
  }
  return response.json();
}

export function mutate(path, data = {}, method = 'POST') {
  return api(path, { method, body: JSON.stringify(data) });
}

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export const number = (value, digits = 0) => Number.isFinite(value) ?
  new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(Math.abs(value)<.5*10**(-digits)?0:value) : '—';

export function observeResource(kind, id, onUpdate, onConnection = () => {}) {
  let stopped = false, socket, timer, reconnectTimer, fetching = false, again = false;
  let lastRevision = -1, delay = 1000, opened = false;
  const stop = () => {
    stopped = true; clearTimeout(timer); clearTimeout(reconnectTimer);
    if (socket) { socket.onclose = null; socket.close(); }
  };
  const poll = async () => {
    if (stopped) return;
    if (fetching) { again = true; return; }
    clearTimeout(timer); fetching = true;
    try {
      const record = await api(`/${kind}/${id}`);
      if (stopped) return;
      if (record.revision > lastRevision) {
        await onUpdate(record);
        if (stopped) return;
        lastRevision = record.revision;
      }
      if (terminal(record.status)) { onConnection('Saved results'); stop(); return; }
      if (!socket && !reconnectTimer) connect();
      if (!opened) onConnection('Connected · HTTP updates');
    } catch (error) {
      if (!stopped) onConnection(`Connection unavailable; retrying. ${error.message}`);
    } finally {
      fetching = false;
      if (!stopped) { timer = setTimeout(poll, again ? 0 : 2000); again = false; }
    }
  };
  const connect = () => {
    if (stopped) return;
    const url = new URL(apiURL(`/${kind}/${id}/stream`), location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    socket.onopen = () => { opened = true; delay = 1000; onConnection('Live connection'); };
    socket.onmessage = () => { void poll(); };
    socket.onerror = () => { if (!stopped) onConnection('WebSocket unavailable · HTTP updates remain active'); };
    socket.onclose = () => {
      socket = null; opened = false;
      if (!stopped) {
        onConnection('Reconnecting · HTTP updates remain active');
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
        delay = Math.min(15000, delay * 2);
      }
    };
  };
  void poll();
  return stop;
}
export const observeRun = (id, update, connection) => observeResource('runs', id, update, connection);
