import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { connectCdp } from './cdp.mjs';
const NativeWebSocket = globalThis.WebSocket;
let latest;
class FakeSocket extends EventTarget {
  sent = [];
  constructor() { super(); latest = this; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.dispatchEvent(new Event('close')); }
  message(data) { this.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) })); }
}
afterEach(() => { globalThis.WebSocket = NativeWebSocket; });
test('matches responses, handles malformed JSON, and bounds retained events', async () => {
  globalThis.WebSocket = FakeSocket;
  const client = await connectCdp('ws://test');
  const response = client.send('Runtime.evaluate');
  latest.message('invalid');
  latest.message({ id: latest.sent[0].id, result: { value: 1 } });
  assert.deepEqual(await response, { value: 1 });
  for (let i = 0; i < 400; i++) latest.message({ method: 'event', params: { i } });
  assert.equal(client.events.length, 256);
  client.close();
});
test('rejects pending operations when connection closes', async () => {
  globalThis.WebSocket = FakeSocket;
  const client = await connectCdp('ws://test');
  const response = client.send('Page.navigate');
  client.close();
  await assert.rejects(response, /closed/);
});
test('bounds unanswered request lifetime', async () => {
  globalThis.WebSocket = FakeSocket;
  const client = await connectCdp('ws://test', 20);
  await assert.rejects(client.send('Never.replies'), /timed out/);
  client.close();
});
test('delivers certificate events only to explicit subscription', async () => {
  globalThis.WebSocket = FakeSocket;
  const client = await connectCdp('ws://test');
  let called = 0;
  const off = client.on('Security.certificateError', () => { called++; });
  latest.message({ method: 'Unrelated.event' });
  latest.message({ method: 'Security.certificateError', params: { eventId: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(called, 1);
  off(); client.close();
});
