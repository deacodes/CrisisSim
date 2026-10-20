const BASE = '/api/v1';

export async function api(path, options = {}) {
  const response = await fetch(BASE + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    signal: options.signal || AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    let body;
    try { body = await response.json(); } catch { body = { detail: response.statusText }; }
    const detail = typeof body.detail === 'string' ? body.detail :
      (body.detail || []).map(e => `${e.loc?.slice(1).join('.')}: ${e.msg}`).join('; ');
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
  new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value) : '—';

export function observeRun(id, onUpdate, onError) {
  let stopped = false, socket, timer, pollTimer, polling = false, lastKey = '';
  const deliver = message => {
    const key = `${message.sequence}/${message.status}/${message.error || ''}`;
    if (key !== lastKey) { lastKey = key; onUpdate(message); }
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(message.status)) {
      stopped = true; clearTimeout(timer); clearTimeout(pollTimer); socket?.close();
    }
  };
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try { deliver(await api(`/runs/${id}`)); }
    catch (error) { onError(`Status unavailable: ${error.message}. Retrying…`); }
    finally { polling = false; if (!stopped) pollTimer = setTimeout(poll, 2000); }
  };
  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${BASE}/runs/${id}/stream`);
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      deliver(message);
    };
    socket.onerror = () => onError('Live connection interrupted. Reconnecting…');
    socket.onclose = () => { if (!stopped) timer = setTimeout(connect, 2000); };
  };
  connect();
  poll();
  return () => { stopped = true; clearTimeout(timer); clearTimeout(pollTimer); socket?.close(); };
}
