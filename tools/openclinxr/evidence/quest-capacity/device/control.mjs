import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDeviceSession, parseDeviceArgs } from './session.mjs';

const args = parseDeviceArgs(process.argv.slice(2));
const out = resolve(args['--out'] || '.openclinxr/slices/quest3-capacity-transports-audio-v2/evidence');
await mkdir(out, { recursive: true });
const report = { schema: 'quest-capacity-device-control.v1', at: new Date().toISOString(), control: 'adb-usb-cdp', worn: 'unobserved', nativeCompositor: 'unavailable', notEvidenceFor: ['worn-headset', 'immersive-stereo', 'compositor-frame-rate', 'acoustic-latency', 'Wi-Fi-capacity'] };
let session;
try {
  session = await createDeviceSession({ serial: args['--serial'] });
  Object.assign(report, session.envelope);
  report.packageVersions = session.adb('shell', 'dumpsys', 'package', 'com.oculus.browser').split('\n').filter((line) => /versionName=|versionCode=/.test(line)).map((line) => line.trim());
  report.runtimeProof = await session.evaluate(`(() => { document.title = 'OpenClinXR Quest control proof'; document.body.style.cssText='background:#101c2c;color:white;font:24px sans-serif;padding:32px'; document.body.textContent='OpenClinXR Quest 3 control verified — bounded CDP smoke'; return { nonce:${JSON.stringify(session.envelope.nonce)}, userAgent:navigator.userAgent, platform:navigator.platform, visibility:document.visibilityState, secureContext:isSecureContext, webxr:!!navigator.xr, webgl2:!!document.createElement('canvas').getContext('webgl2'), webRTC:typeof RTCPeerConnection, webTransport:typeof WebTransport, audioContext:typeof AudioContext, memory:navigator.deviceMemory, hardwareConcurrency:navigator.hardwareConcurrency, screen:{width:screen.width,height:screen.height}, actualDevice:true, emulationApplied:false }; })()`);
  report.runtimeProof.nonceMatched = report.runtimeProof.nonce === session.envelope.nonce;
  await writeFile(resolve(out, 'quest-control.png'), await session.screenshot());
  report.screenshot = 'quest-control.png';
  report.status = 'controlled';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  process.exitCode = 1;
} finally {
  await session?.close();
  if (session) Object.assign(report, session.envelope);
  await writeFile(resolve(out, 'quest-control.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, model: report.model, cdpVersion: report.cdpVersion, runtimeProof: report.runtimeProof, cleanup: report.cleanup, report: resolve(out, 'quest-control.json') }, null, 2));
}
