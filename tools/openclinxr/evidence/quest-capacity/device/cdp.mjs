/** Bounded CDP client. Every socket is scoped to an explicitly selected target. */
export async function connectCdp(url, timeoutMs = 10000) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  const events = [];
  const listeners = new Map();
  socket.addEventListener('message', ({ data }) => {
    if (typeof data !== 'string' || data.length > 24 * 1024 * 1024) return;
    let message;
    try { message = JSON.parse(data); } catch { return; }
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (message.error) item.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else item.resolve(message.result);
    } else {
      events.push(message);
      if (events.length > 256) events.shift();
      for (const listener of listeners.get(message.method) || []) {
        Promise.resolve().then(() => listener(message.params)).catch(() => {});
      }
    }
  });
  const rejectPending = () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('CDP connection closed'));
    }
    pending.clear();
  };
  socket.addEventListener('close', rejectPending);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('CDP connect timed out')); }, timeoutMs);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connect failed')); }, { once: true });
  });
  return {
    events,
    on(method, listener) {
      const group = listeners.get(method) || new Set();
      group.add(listener); listeners.set(method, group);
      return () => group.delete(listener);
    },
    send(method, params = {}, requestTimeoutMs = timeoutMs) {
      if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 150000) return Promise.reject(new Error('Invalid bounded CDP request timeout'));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, requestTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    close() { rejectPending(); listeners.clear(); socket.close(); },
  };
}
