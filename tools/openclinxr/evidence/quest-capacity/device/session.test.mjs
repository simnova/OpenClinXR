import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeAdb, parseDeviceArgs, tabSnapshot, certificateRequestAllowed, validateDeviceRoute } from './session.mjs';

test('requires explicit serial shape and no shell executable fragments', () => {
  for (const serial of ['', 'a;b', '$(secret)']) assert.throws(() => makeAdb(serial));
});
test('arguments reject unknowns, missing values and credentials', () => {
  for (const args of [['--all-devices'], ['--url'], ['--url', 'https://user:pass@localhost'], ['--network-path', 'internet'], ['--url', 'file:///secret']]) assert.throws(() => parseDeviceArgs(args));
});
test('arguments explicitly distinguish USB and LAN; no implicit microphone', () => {
  const args = parseDeviceArgs(['--url', 'https://localhost:4444/?capacity=1', '--network-path', 'usb-reverse', '--enter-xr']);
  assert.equal(args['--network-path'], 'usb-reverse');
  assert.equal(args['--enter-xr'], true);
  assert.throws(() => parseDeviceArgs(['--microphone']));
});
test('tab snapshots preserve identity without copying private URLs', () => {
  const [tab] = tabSnapshot([{ id: 'abc', type: 'page', url: 'https://private.test/account?token=secret' }]);
  assert.deepEqual(Object.keys(tab), ['id', 'type', 'urlSha256']);
  assert.equal(tab.urlSha256.length, 64);
});

test('certificate exception admits HTTPS/WSS only for identical explicit authority', () => {
  assert.equal(certificateRequestAllowed('https://192.168.1.249:56137','wss://192.168.1.249:56137/capacity/ws'),true);
  for(const value of ['ws://192.168.1.249:56137','https://192.168.1.249:56138','https://other.test:56137','https://user:pass@192.168.1.249:56137','invalid']) assert.equal(certificateRequestAllowed('https://192.168.1.249:56137',value),false);
});

test('route labels reject LAN passed as USB and unsupported UDP reverse assumptions',()=>{
  assert.throws(()=>validateDeviceRoute(new URL('https://192.168.1.249:4444'),'usb-reverse',[4444]));
  assert.throws(()=>validateDeviceRoute(new URL('https://localhost:4444'),'wifi-lan',[]));
  assert.throws(()=>validateDeviceRoute(new URL('https://localhost:4444'),'usb-reverse',[4445]));
  assert.doesNotThrow(()=>validateDeviceRoute(new URL('https://localhost:4444'),'usb-reverse',[4444]));
});

test('expected build option requires explicit SHA256 identity',()=>{
  assert.throws(()=>parseDeviceArgs(['--expected-build-hash','unknown']));
  assert.equal(parseDeviceArgs(['--expected-build-hash','sha256:'+'a'.repeat(64)])['--expected-build-hash'],'sha256:'+'a'.repeat(64));
});
