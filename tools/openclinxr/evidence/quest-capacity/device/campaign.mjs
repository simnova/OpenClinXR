import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeSnapshot, gpuAggregateWindow } from './native.mjs';
import { observeCertificate, sealQuestCampaign, assertBuildMetadata, assertCampaignBuild } from './receipt.mjs';
import { createDeviceSession, parseDeviceArgs, validateDeviceRoute } from './session.mjs';

const args = parseDeviceArgs(process.argv.slice(2));
if (!args['--url'] || !args['--network-path']) throw new Error('Explicit --url and --network-path usb-reverse|wifi-lan are required');
const url = new URL(args['--url']);
const reversePorts = args['--reverse'] ? args['--reverse'].split(',').map(Number) : [];
validateDeviceRoute(url, args['--network-path'], reversePorts);
if (args['--network-path'] === 'wifi-lan' && reversePorts.length) throw new Error('LAN runs cannot create USB reverse mappings');
if (args['--network-path'] === 'usb-reverse' && !reversePorts.length) throw new Error('USB runs require explicit --reverse port list');
if (args['--network-path'] === 'wifi-lan' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('LAN runs need an actual LAN host address');
const out = resolve(args['--out'] || '.openclinxr/slices/quest3-capacity-transports-audio-v2/evidence');
await mkdir(out, { recursive: true });
const prefix = args['--network-path'] === 'wifi-lan' ? 'quest-lan' : 'quest-usb';
const report = { schema: 'quest-capacity-device-campaign.v1', at: new Date().toISOString(), path: args['--network-path'], controlPath:'adb-usb-cdp', dataPathRequested:args['--network-path'], url: url.href, automation: 'CDP owned page; no fake media', authenticationModes: {httpsWss:'owned-page exact-origin test-certificate exception; not a browser pin',webtransport:'serverCertificateHashes DER pin'}, worn: 'unobserved', notEvidenceFor: ['worn-headset', 'compositor-frame-rate', 'acoustic-latency', 'motion-to-photon', 'sustained-thermal-capacity'] };
let session;
const save = (file, value) => writeFile(resolve(out, file), `${JSON.stringify(value, null, 2)}\n`);
async function waitFor(expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await session.evaluate(expression);
    if (value) return value;
    await delay(200);
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms`);
}
try {
  session = await createDeviceSession({ serial: args['--serial'], reversePorts, allowCertificateOrigin: args['--allow-test-certificate-origin'] });
  report.device = session.envelope;
  url.searchParams.set('capacityNonce', session.envelope.nonce);
  report.url = url.href;
  if (args['--allow-test-certificate-origin']) report.certificate = await observeCertificate(new URL(args['--allow-test-certificate-origin']).origin);
  report.nativeBefore = nativeSnapshot(args['--serial']);
  if (args['--network-path'] === 'wifi-lan') {
    try { report.interfaceRoute = {at:new Date().toISOString(),wlan0:session.adb('shell','ip','-4','addr','show','wlan0'),routeToPageService:session.adb('shell','ip','route','get',url.hostname)}; }
    catch(error) { report.interfaceRoute = {status:'unavailable',reason:String(error)}; }
  }
  await session.navigate(url.href);
  await waitFor("document.querySelector('#capacity-secure-run') && !document.querySelector('#capacity-secure-run').disabled", 60000, 'Secure lab readiness');
  report.appMetadata = await session.evaluate("JSON.parse(document.querySelector('#capacity-app-metadata')?.textContent || 'null')");
  assertBuildMetadata(report.appMetadata, args['--expected-build-hash']);
  report.runtime = await session.evaluate(`(async () => ({url:location.href,userAgent:navigator.userAgent,platform:navigator.platform,secureContext:isSecureContext,visibility:document.visibilityState,webxr:!!navigator.xr,immersiveVrSupported:navigator.xr?await navigator.xr.isSessionSupported('immersive-vr'):false,webRTC:typeof RTCPeerConnection,webTransport:typeof WebTransport,audioContext:typeof AudioContext,mediaDevices:!!navigator.mediaDevices,hardwareConcurrencyHint:navigator.hardwareConcurrency,emulationApplied:false}))()`);
  await session.evaluate(`(() => { const duration=document.querySelector('#capacity-campaign-duration'); if(duration) duration.value='1000'; const level=document.querySelector('#capacity-campaign-level'); if(level) level.value='1'; const path=document.querySelector('#capacity-transport-path'); if(path) path.value=${JSON.stringify(args['--network-path'] === 'wifi-lan' ? 'LAN-Wi-Fi' : 'USB-reverse-TCP-LAN-UDP')}; document.querySelector('#capacity-secure-run').click(); })()`, { userGesture: true });
  report.terminalState = await waitFor("(() => { const state=document.querySelector('#capacity-campaign-status')?.textContent || ''; return /Completed|Stopped|Failed/i.test(state) ? state : null; })()", 140000, 'Bounded secure campaign');
  report.campaign = await session.evaluate('window.__capacityCampaignReport ?? null');
  if (!report.campaign) throw new Error('Campaign completed without an exported report');
  report.clientBuild = assertCampaignBuild(report.campaign, report.appMetadata, args['--expected-build-hash']);
  await save(`${prefix}-campaign-raw.json`, report.campaign);
  const sealed = sealQuestCampaign(report.campaign, { device: session.envelope, expectedUrl: url.href, runtime: report.runtime, buildIdentity: report.appMetadata, expectedBuildHash: args['--expected-build-hash'] });
  report.receipt = sealed.receipt;
  await save(`${prefix}-campaign.json`, sealed.campaign);
  await save(`${prefix}-receipt.json`, sealed.receipt);
  await session.evaluate("document.querySelector('#capacity-campaign-status')?.scrollIntoView({block:'start'})");
  await writeFile(resolve(out, `${prefix}-capacity-lab.png`), await session.screenshot());
  report.nativeAfter = nativeSnapshot(args['--serial']);
  // Exercise a fresh run's cancellation while the actual work is active.
  await session.evaluate("document.querySelector('#capacity-secure-run').click()", { userGesture: true });
  await delay(400);
  report.cancel = { before: await session.evaluate("document.querySelector('#capacity-campaign-status')?.textContent") };
  await session.evaluate("document.querySelector('#capacity-campaign-stop').click()", { userGesture: true });
  report.cancel.after = await waitFor("(() => { const state=document.querySelector('#capacity-campaign-status')?.textContent || ''; return /Stopped|Failed/i.test(state) ? state : null; })()", 12000, 'Campaign cancellation');
  report.cancel.report = await session.evaluate('window.__capacityCampaignReport ?? null');
  if (report.cancel.report?.runs?.length) report.cancel.clientBuild = assertCampaignBuild(report.cancel.report, report.appMetadata, args['--expected-build-hash']);
  if (args['--enter-xr']) {
    await session.evaluate("document.querySelector('#capacity-enter-xr')?.click()", { userGesture: true });
    try { report.immersive = await waitFor("(() => { const value=window.__capacityImmersiveObservation; return value && !['not-requested','requesting'].includes(value.state) ? value : null; })()", 12000, 'Immersive session observation'); }
    catch (error) { report.immersiveRequestTimeout = String(error); }
    report.immersive = await session.evaluate('window.__capacityImmersiveObservation ?? null');
    if (report.immersive?.state === 'active') report.gpuAggregate = await gpuAggregateWindow(args['--serial'], 6);
    report.immersive = await session.evaluate('window.__capacityImmersiveObservation ?? null');
    if (report.immersive?.state === 'active') await session.evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'End immersive session')?.click()", { userGesture: true });
  }
  report.status = 'measured';
} catch (error) {
  report.status = 'failed'; report.error = String(error); process.exitCode = 1;
  if (session) {
    try { report.failurePage = await session.evaluate("({url:location.href,title:document.title,body:document.body?.innerText?.slice(0,3000)})"); } catch { /* Navigation may have failed. */ }
  }
} finally {
  await session?.close();
  if (session) report.device = session.envelope;
  await save(`${prefix}-observation.json`, report);
  console.log(JSON.stringify({ status: report.status, path: report.path, error: report.error, terminalState: report.terminalState, cancel: report.cancel ? { before: report.cancel.before, after: report.cancel.after } : undefined, runtime: report.runtime, cleanup: report.device?.cleanup, report: resolve(out, `${prefix}-observation.json`) }, null, 2));
}
