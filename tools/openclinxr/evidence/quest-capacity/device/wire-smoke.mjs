import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createDeviceSession, parseDeviceArgs, validateDeviceRoute } from './session.mjs';
import { jsonSha256, observeCertificate } from './receipt.mjs';
import { isIP } from 'node:net';
import { audioSmokeExpression } from './audio-smoke.mjs';
const args = parseDeviceArgs(process.argv.slice(2));
if (!args['--url'] || !args['--network-path']) throw new Error('Explicit manifest --url and --network-path required');
const url = new URL(args['--url']);
validateDeviceRoute(url, args['--network-path'], args['--reverse'] ? args['--reverse'].split(',').map(Number) : []);
const out = resolve(args['--out'] || '.openclinxr/slices/quest3-capacity-transports-audio-v2/evidence');
await mkdir(out, { recursive: true });
const wireModule = process.env.QUEST_CAPACITY_WIRE_MODULE || resolve('tools/openclinxr/evidence/quest-capacity/secure-wire-client.ts');
const { checkSecureWires } = await import(pathToFileURL(wireModule).href);
const report = { schema: 'quest-capacity-device-wire-smoke.v1', at: new Date().toISOString(), path: args['--network-path'], controlPath: 'adb-usb-cdp', dataPathRequested: args['--network-path'], notEvidenceFor: ['maximum-capacity', 'worn-headset', 'compositor-frame-rate', 'acoustic-latency'], microphoneCaptured: false, authenticationModes: {https:'owned-page exact-origin certificate exception; matching host TLS fingerprint observed separately',wss:'owned-page exact-origin certificate exception; not a browser certificate pin',webtransport:'browser serverCertificateHashes SHA-256 DER pin',webrtc:'actual DTLS/SRTP negotiated through HTTPS-signalled SDP; no acoustic claim'} };
let session;
try {
  session = await createDeviceSession({ serial: args['--serial'], allowCertificateOrigin: args['--allow-test-certificate-origin'], reversePorts: args['--reverse'] ? args['--reverse'].split(',').map(Number) : [] });
  report.device = session.envelope;
  url.searchParams.set('capacityNonce', session.envelope.nonce);
  report.certificate = await observeCertificate(url.origin);
  report.networkInterfaceBefore = {at:new Date().toISOString(),wlan0:session.adb('shell','ip','-4','addr','show','wlan0'),routeToService:session.adb('shell','ip',isIP(url.hostname)===6?'-6':'-4','route','get',url.hostname)};
  await session.navigate(url.href);
  for (let count = 0; count < 50; count++) {
    if (await session.evaluate(`location.origin === ${JSON.stringify(url.origin)} && document.readyState !== 'loading'`)) break;
    await delay(100);
  }
  report.runtime = await session.evaluate(`({url:location.href,userAgent:navigator.userAgent,platform:navigator.platform,secureContext:isSecureContext,visibility:document.visibilityState,webTransport:typeof WebTransport,webRTC:typeof RTCPeerConnection,emulationApplied:false})`);
  const manifest = await session.evaluate(`fetch(${JSON.stringify(url.href)}, {signal:AbortSignal.timeout(5000)}).then(response => response.json())`);
  report.manifest = manifest;
  report.certificate.manifestDerFingerprintMatched = manifest.certificateHashes?.some((item) => item.algorithm === 'sha-256' && item.value.map((value) => value.toString(16).padStart(2,'0')).join('').toUpperCase() === report.certificate.fingerprint256?.replaceAll(':',''));
  if (!report.certificate.manifestDerFingerprintMatched) throw new Error('Manifest DER certificate pin mismatched host TLS certificate');
  report.observations = await checkSecureWires({ evaluate: (expression) => session.evaluate(expression, { userGesture: true, timeoutMs: 140000 }) }, manifest);
  report.observedIceRoutes = [];
  const addresses = [...new Set(report.observations.flatMap(item => (item.detail.pairs || []).map(pair => pair.remote?.address)).filter(address => isIP(address)))];
  for (const address of addresses) { try { report.observedIceRoutes.push({remoteAddress:address,route:session.adb('shell','ip',isIP(address)===6?'-6':'-4','route','get',address)}); } catch { report.observedIceRoutes.push({remoteAddress:address,route:'unavailable'}); } }
  report.audioSmoke = await session.evaluate(audioSmokeExpression, { userGesture: true });
  report.peerStats = await session.evaluate(`fetch(${JSON.stringify(`${manifest.httpsOrigin}/capacity/peer-stats?token=${manifest.token}`)}, {signal:AbortSignal.timeout(5000)}).then(response => response.json())`);
  report.receipt = { serial: session.envelope.serial, targetId: session.envelope.ownedTargetId, nonce: session.envelope.nonce, expectedUrl: url.href, observedUrl: report.runtime.url, observationsSha256: jsonSha256(report.observations), emulationApplied: false, nativeSession: null, worn: 'unobserved' };
  const summary = ['Physical Quest browser · bounded secure wire tests', 'Actual Wi-Fi/LAN peers · synthetic audio · no microphone capture', `AudioWorklet: ${report.audioSmoke.workletMessages.at(-1).frames} processed frames; 8 voices + HRTF + convolution`, ...report.observations.map((item) => `${item.ok ? 'PASS' : 'UNAVAILABLE'}  ${item.id}${item.detail.rttMs ? `  ${item.detail.rttMs.toFixed(1)} ms` : ''}${item.error ? `  ${item.error}` : ''}`), 'Smoke observations only · no maximum-capacity or worn-headset claim'].join('\n\n');
  await session.evaluate(`(() => { document.body.style.cssText='background:#101c2c;color:white;font:17px sans-serif;padding:28px;white-space:pre-wrap';document.body.textContent=${JSON.stringify(summary)}; })()`);
  await writeFile(resolve(out, 'quest-wire-smoke.png'), await session.screenshot());
  report.status = report.observations.every((observation) => observation.ok) ? 'passed' : 'partial';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  await session?.close();
  if (session) report.device = session.envelope;
  await writeFile(resolve(out,'quest-wire-smoke.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,error:report.error,runtime:report.runtime,observations:report.observations,audioSmoke: report.audioSmoke ? {state:report.audioSmoke.state,sampleRate:report.audioSmoke.sampleRate,processedFrames:report.audioSmoke.workletMessages.at(-1).frames} : undefined,peerStats:report.peerStats,cleanup:report.device?.cleanup},null,2));
}
