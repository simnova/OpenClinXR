import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDeviceSession, parseDeviceArgs } from './session.mjs';

const args = parseDeviceArgs(process.argv.slice(2));
const out = resolve(args['--out'] || '.openclinxr/slices/quest3-capacity-transports-audio-v2/evidence');
await mkdir(out, { recursive: true });
const report = { schema: 'quest-capacity-secure-device-survey.v1', at: new Date().toISOString(), path: 'usb-reverse-tcp-localhost', actualDevice: true, worn: 'unobserved', notEvidenceFor: ['worn-headset', 'maximum-capacity', 'Wi-Fi', 'HTTPS-certificate-trust', 'compositor-frame-rate', 'acoustic-latency'] };
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end('<!doctype html><title>Quest secure capability survey</title><body style="background:#101c2c;color:white;font:18px sans-serif;padding:30px"><h1>Quest capability survey</h1><pre id="result">Loading bounded device survey…</pre></body>');
});
let session;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  session = await createDeviceSession({ serial: args['--serial'], reversePorts: [port] });
  report.device = session.envelope;
  await session.navigate(`http://localhost:${port}/?quest-capacity=${session.envelope.nonce}`);
  for (let count = 0; count < 30; count++) {
    if (await session.evaluate("!!document.querySelector('#result')")) break;
    await delay(100);
  }
  report.survey = await session.evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    const result = {userAgent:navigator.userAgent,platform:navigator.platform,url:location.href,secureContext:isSecureContext,visibility:document.visibilityState,performanceMemoryProxy:performance.memory?{jsHeapSizeLimit:performance.memory.jsHeapSizeLimit,usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null,hardwareConcurrencyHint:navigator.hardwareConcurrency,deviceMemoryGiBHint:navigator.deviceMemory??null,webxrApi:!!navigator.xr,immersiveVrSupported:navigator.xr?await navigator.xr.isSessionSupported('immersive-vr'):null,webRTC:typeof RTCPeerConnection,webTransport:typeof WebTransport,webSocket:typeof WebSocket,audioContext:typeof AudioContext,audioWorklet:typeof AudioWorkletNode,offlineAudioContext:typeof OfflineAudioContext,microphoneApi:!!navigator.mediaDevices?.getUserMedia,microphoneRequested:false,emulationApplied:false,gl:gl?{version:gl.getParameter(gl.VERSION),renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),maxRenderbufferSize:gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),maxSamples:gl.getParameter(gl.MAX_SAMPLES),maxTextureUnits:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),timerQueryExtension:!!gl.getExtension('EXT_disjoint_timer_query_webgl2'),multiviewExtension:!!gl.getExtension('OVR_multiview2'),textureCompressionExtensions:['WEBGL_compressed_texture_astc','WEBGL_compressed_texture_etc','WEBGL_compressed_texture_etc1','WEBGL_compressed_texture_s3tc'].filter(name=>!!gl.getExtension(name)),supportedExtensions:gl.getSupportedExtensions()}:null};
    try { result.microphonePermissionState=(await navigator.permissions.query({name:'microphone'})).state; } catch { result.microphonePermissionState='unavailable'; }
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    document.querySelector('#result').textContent=JSON.stringify(result,null,2);
    return result;
  })()`);
  await writeFile(resolve(out, 'quest-secure-survey.png'), await session.screenshot());
  report.status = 'surveyed';
} catch (error) { report.status = 'failed'; report.error = String(error); process.exitCode = 1; }
finally {
  await session?.close();
  if (session) report.device = session.envelope;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(resolve(out, 'quest-secure-survey.json'), JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify({ status: report.status, survey: report.survey, error: report.error, cleanup: report.device?.cleanup }, null, 2));
}
