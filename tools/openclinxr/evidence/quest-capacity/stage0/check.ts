/// <reference lib="dom" />
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { Stage0Record } from '@openclinxr/xr-capacity/stage0';
import { chromium, type Browser } from 'playwright';
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
const directory = process.argv[2]; const evidence = process.argv[3]; if (!directory || !evidence) throw new Error('Usage: check.ts <built-dist> <owned-evidence-dir>');
const root = resolve(directory); const out = resolve(evidence); await mkdir(out, { recursive: true }); const manifest = JSON.parse(await readFile(join(root, 'source-manifest.json'), 'utf8'));
const server = createServer(async (request, response) => { const url = new URL(request.url ?? '/', 'http://localhost'); const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); if (!['index.html', 'stage0.js', 'source-manifest.json', 'scene-manifest.json', 'protocol.json'].includes(file)) { response.writeHead(404).end(); return; } try { response.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : 'text/html', 'cache-control': 'no-store' }); response.end(await readFile(join(root, file))); } catch { response.writeHead(500).end(); } });
await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address(); if (!address || typeof address !== 'object') throw new Error('Missing owned server address');
const errors: string[] = []; let report: Record<string, unknown> = {};
// Heavy-compute launch runs inside the compute-services facade (slot-gated,
// labelled); browserLaunch keeps the exact headless launch flags.
await createLocalComputeServices({
  browserLaunch: chromium.launch.bind(chromium, { headless: true }),
}).sceneCapture.withBrowser("quest-capacity:stage0", async (launched) => {
  const browser = launched as Browser;
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } }); page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://localhost:${address.port}/?purpose=readiness&nonce=host-stage0-readiness-smoke-0001`); await page.locator('#stage0-status').filter({ hasText: 'Readiness only' }).waitFor();
  const initial = await page.evaluate(async () => {
    const api = (window as unknown as { stage0: { identity: unknown } }).stage0; const image = document.querySelector<HTMLImageElement>('#stage0-proof')!; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; let palettePixels = 0;
    for (let at = 0; at < pixels.length; at += 4) for (const color of [0x264638, 0x586878, 0xe33939, 0x36c66a, 0x397de3]) if (Math.abs(pixels[at]! - ((color >> 16) & 255)) <= 12 && Math.abs(pixels[at + 1]! - ((color >> 8) & 255)) <= 12 && Math.abs(pixels[at + 2]! - (color & 255)) <= 12 && pixels[at + 3] === 255) { palettePixels++; break; }
    const body = new Uint8Array(await (await fetch('./stage0.js', { cache: 'no-store' })).arrayBuffer()); const hash = await crypto.subtle.digest('SHA-256', body); const fetchedBundleSha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''); return { identity: api.identity, palettePixels, width: image.naturalWidth, height: image.naturalHeight, fetchedBundleSha256 };
  });
  await page.screenshot({ path: join(out, 'stage0-desktop-preview.png'), fullPage: true }); await page.locator('#stage0-start').click();
  const admission = await page.evaluate(async () => await (window as unknown as { stage0: { admission: Promise<unknown> } }).stage0.admission);
  const raw = await page.evaluate(() => (window as unknown as { stage0: { snapshot(): Stage0Record } }).stage0.snapshot());
  await writeFile(join(out, 'desktop-no-xr-record.json'), `${JSON.stringify(raw, null, 2)}\n`);
  const cleanup = raw.cleanup; const ok = errors.length === 0 && initial.palettePixels > 1000 && initial.fetchedBundleSha256 === manifest.bundleSha256 && ['unsupported', 'failed'].includes(String(raw.status)) && (raw.frames as unknown[]).length === 0 && cleanup.controlListeners === 0 && cleanup.controlTimers === 0 && cleanup.animationCallbacks === 0;
  report = { schema: 'quest-stage0-host-check.v1', ok, browser: browser.version(), initial, admission, status: raw.status, failures: raw.failureReasons, cleanup, pageErrors: errors, sourceManifestSha256: createHash('sha256').update(await readFile(join(root, 'source-manifest.json'))).digest('hex'), scope: 'Actual desktop WebGL preview/source fetch and actual unsupported immersive entry; no emulation, no physical baseline' };
  if (!ok) process.exitCode = 1;
} finally { await browser.close(); await new Promise<void>(done => server.close(() => done())); report["ownedBrowserClosed"] = true; report["ownedServerClosed"] = true; await writeFile(join(out, 'host-check.json'), `${JSON.stringify(report, null, 2)}\n`); }
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
