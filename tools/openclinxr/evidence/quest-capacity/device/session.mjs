import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { connectCdp } from './cdp.mjs';
import { setTimeout as delay } from 'node:timers/promises';

export const QUEST_SERIAL = '2G0YC5ZGB5000J';
export function certificateRequestAllowed(expectedOrigin, requestUrl) {
  try { const expected = new URL(expectedOrigin); const request = new URL(requestUrl);
    return expected.protocol === 'https:' && ['https:', 'wss:'].includes(request.protocol) && request.host === expected.host && !request.username && !request.password;
  } catch { return false; }
}
export function makeAdb(serial, executable = process.env.ADB_PATH || '/opt/homebrew/bin/adb') {
  if (!/^[A-Za-z0-9._:-]{4,100}$/.test(serial)) throw new Error('An explicit ADB serial is required');
  return (...args) => execFileSync(executable, ['-s', serial, ...args], { timeout: 15000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }).trim();
}
export function tabSnapshot(targets) {
  return targets.map(({ id, type, url }) => ({ id, type, urlSha256: createHash('sha256').update(url || '').digest('hex') }));
}
export function validateDeviceRoute(url, networkPath, reversePorts = []) {
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (networkPath === 'wifi-lan' && (loopback || reversePorts.length)) throw new Error('LAN route requires a real host and no USB reverse');
  if (networkPath === 'usb-reverse' && (!loopback || !reversePorts.includes(Number(url.port || (url.protocol === 'https:' ? 443 : 80))))) throw new Error('USB page route requires loopback and explicit matching owned reverse');
}
export function parseDeviceArgs(argv) {
  const allowed = new Set(['--serial', '--out', '--url', '--network-path', '--reverse', '--allow-test-certificate-origin', '--enter-xr', '--expected-build-hash']);
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!allowed.has(key)) throw new Error(`Unknown argument ${key}`);
    if (key === '--enter-xr') { result[key] = true; continue; }
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key in result) throw new Error(`Duplicate argument ${key}`);
    result[key] = argv[++i];
  }
  result['--serial'] ??= QUEST_SERIAL;
  if (result['--expected-build-hash'] && !/^sha256:[a-f0-9]{64}$/.test(result['--expected-build-hash'])) throw new Error('Expected build must be sha256:<64 lowercase hex>');
  if (result['--network-path'] && !['usb-reverse', 'wifi-lan'].includes(result['--network-path'])) throw new Error('Network path must be usb-reverse or wifi-lan');
  if (result['--url']) {
    const url = new URL(result['--url']);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Lab URL must be HTTP(S), without credentials');
  }
  return result;
}
export async function createDeviceSession({ serial = QUEST_SERIAL, reversePorts = [], allowCertificateOrigin } = {}) {
  const adb = makeAdb(serial);
  const envelope = { serial, at: new Date().toISOString(), transport: 'adb-usb-cdp', worn: 'unobserved', emulationApplied: false, ownedMappings: [], cleanup: {} };
  let port, browser, page, targetId;
  const reverse = [];
  const get = async (path) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
    return response.json();
  };
  const close = async () => {
    if (page && envelope.testCertificateException) {
      try { await page.send('Security.setOverrideCertificateErrors', { override: false }); envelope.cleanup.targetCertificateOverrideReset = true; }
      catch (error) { envelope.cleanup.certificateResetError = String(error); }
    }
    page?.close();
    if (targetId && browser) {
      try { envelope.cleanup.ownedTabClosed = (await browser.send('Target.closeTarget', { targetId })).success; }
      catch (error) { envelope.cleanup.tabError = String(error); }
    }
    if (port) {
      try {
        for (let attempt = 0; attempt < 30; attempt++) {
          envelope.tabsAfter = tabSnapshot(await get('/json/list'));
          if (!targetId || !envelope.tabsAfter.some((target) => target.id === targetId)) break;
          await delay(100);
        }
        envelope.cleanup.ownedTargetAbsent = !targetId || !envelope.tabsAfter.some((target) => target.id === targetId);
        envelope.cleanup.originalTargetsPreserved = envelope.tabsBefore.every((original) => envelope.tabsAfter.some((target) => target.id === original.id && target.urlSha256 === original.urlSha256));
      } catch (error) { envelope.cleanup.tabsError = String(error); }
    }
    browser?.close();
    for (const number of reverse) {
      try { adb('reverse', '--remove', `tcp:${number}`); }
      catch (error) { (envelope.cleanup.reverseErrors ??= []).push(String(error)); }
    }
    if (port) {
      try { adb('forward', '--remove', `tcp:${port}`); envelope.cleanup.ownedForwardRemoved = true; }
      catch (error) { envelope.cleanup.forwardError = String(error); }
    }
    envelope.forwardsAfter = adb('forward', '--list');
    envelope.reversesAfter = adb('reverse', '--list');
    envelope.cleanup.ownedReversesRemoved = !envelope.cleanup.reverseErrors;
  };
  try {
    envelope.state = adb('get-state');
    if (envelope.state !== 'device') throw new Error('Selected Quest is not authorized');
    envelope.model = adb('shell', 'getprop', 'ro.product.model');
    if (!envelope.model.includes('Quest')) throw new Error('Selected serial is not a Quest');
    envelope.os = adb('shell', 'getprop', 'ro.build.version.release');
    envelope.build = adb('shell', 'getprop', 'ro.build.display.id');
    envelope.browserPids = adb('shell', 'pidof', 'com.oculus.browser');
    envelope.battery = adb('shell', 'dumpsys', 'battery');
    envelope.forwardsBefore = adb('forward', '--list');
    envelope.reversesBefore = adb('reverse', '--list');
    for (const number of reversePorts) {
      if (!Number.isInteger(number) || number < 1024 || number > 65535) throw new Error('Invalid reverse port');
      adb('reverse', '--no-rebind', `tcp:${number}`, `tcp:${number}`);
      reverse.push(number);
      envelope.ownedMappings.push({ kind: 'reverse', remote: `tcp:${number}`, local: `tcp:${number}`, path: 'usb-reverse-tcp' });
    }
    port = Number(adb('forward', 'tcp:0', 'localabstract:chrome_devtools_remote'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid allocated CDP port');
    envelope.ownedMappings.push({ kind: 'forward', local: `tcp:${port}`, remote: 'localabstract:chrome_devtools_remote' });
    const version = await get('/json/version');
    envelope.cdpVersion = { browser: version.Browser, protocol: version['Protocol-Version'], userAgent: version['User-Agent'] };
    envelope.tabsBefore = tabSnapshot(await get('/json/list'));
    browser = await connectCdp(version.webSocketDebuggerUrl);
    const nonce = randomUUID();
    ({ targetId } = await browser.send('Target.createTarget', { url: `about:blank#quest-capacity-${nonce}` }));
    envelope.ownedTargetId = targetId;
    envelope.nonce = nonce;
    const target = (await get('/json/list')).find((item) => item.id === targetId);
    if (!target) throw new Error('Owned target was not enumerated');
    page = await connectCdp(target.webSocketDebuggerUrl);
    await page.send('Page.enable');
    if (allowCertificateOrigin) {
      const origin = new URL(allowCertificateOrigin).origin;
      if (!origin.startsWith('https://')) throw new Error('Only an exact HTTPS test origin may bypass its certificate');
      envelope.testCertificateException = { origin, scope: 'owned-CDP-page-target', globalTrustChanged: false, events: [] };
      page.on('Security.certificateError', async (event) => {
        let allowed = false;
        allowed = certificateRequestAllowed(origin, event.requestURL);
        envelope.testCertificateException.events.push({ expectedOrigin: origin, requestOrigin: (() => { try { return new URL(event.requestURL).origin; } catch { return 'invalid'; } })(), errorType: event.errorType, allowed });
        await page.send('Security.handleCertificateError', { eventId: event.eventId, action: allowed ? 'continue' : 'cancel' });
      });
      await page.send('Security.enable');
      await page.send('Security.setOverrideCertificateErrors', { override: true });
    }
    const evaluate = async (expression, { userGesture = false, awaitPromise = true, timeoutMs = 10000 } = {}) => {
      const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, userGesture, awaitPromise, timeout: timeoutMs }, timeoutMs);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    return { adb, page, envelope, close, evaluate, navigate: (url) => page.send('Page.navigate', { url }), screenshot: async () => Buffer.from((await page.send('Page.captureScreenshot', { format: 'png' })).data, 'base64') };
  } catch (error) {
    await close();
    throw error;
  }
}
