import { WebGLRenderer } from 'three';
import { createStage0 } from './shell.js';
import { createRoom, previewCamera, RENDER_OPTIONS } from './scene.js';
import type { Stage0Metadata } from './types.js';
const node = document.querySelector('#stage0-metadata'); if (!node?.textContent) throw new Error('Missing source metadata');
const metadata = JSON.parse(node.textContent) as Stage0Metadata; const query = new URLSearchParams(location.search); const purpose = query.get('purpose');
if (purpose !== 'readiness' && purpose !== 'cohort') throw new Error('Explicit ?purpose=readiness|cohort is required');
const nonce = query.get('nonce'); if (!nonce || !/^[a-zA-Z0-9-]{16,128}$/.test(nonce)) throw new Error('Explicit bounded external run nonce is required'); metadata.nonce = nonce;
const canvas = document.querySelector<HTMLCanvasElement>('#stage0-canvas')!; const status = document.querySelector<HTMLElement>('#stage0-status')!; const start = document.querySelector<HTMLButtonElement>('#stage0-start')!; const stop = document.querySelector<HTMLButtonElement>('#stage0-stop')!; const image = document.querySelector<HTMLImageElement>('#stage0-proof')!;
const preview = new WebGLRenderer({ ...RENDER_OPTIONS, canvas }); preview.setSize(960, 540, false); const room = createRoom(); preview.render(room.scene, previewCamera()); const previewPng = canvas.toDataURL('image/png'); room.dispose(); preview.dispose(); preview.forceContextLoss(); image.src = previewPng; canvas.hidden = true;
// Actual XR uses a fresh canvas/context. Preview resources never enter the warmed XR baseline.
const xrCanvas = document.createElement('canvas'); xrCanvas.id = 'stage0-xr-canvas'; canvas.replaceWith(xrCanvas); xrCanvas.hidden = true;
const api = createStage0(metadata, purpose, xrCanvas, () => { const report = api.snapshot(); status.textContent = `${report.status}: resources released; ${report.failureReasons.join('; ') || 'report ready'}`; stop.disabled = true; const proof = report.proofs.afterSample ?? report.proofs.preview; if (proof?.image) image.src = proof.image; document.querySelector<HTMLButtonElement>('#stage0-export')!.disabled = false; });
Object.defineProperty(window, 'stage0', { value: api, writable: false });
status.textContent = `${purpose === 'cohort' ? 'Cohort: requires released profile configuration' : 'Readiness only: no cohort acceptance'} · Three ${metadata.rendererVersion} · primitive room`;
start.onclick = () => { start.disabled = true; stop.disabled = false; status.textContent = 'Entering actual immersive XR…'; void api.start({ purpose }); };
stop.onclick = () => { void api.stop(); };
document.querySelector<HTMLButtonElement>('#stage0-export')!.onclick = () => { const blob = new Blob([JSON.stringify(api.snapshot(), null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `stage0-${purpose}-${nonce}.json`; link.click(); URL.revokeObjectURL(url); };
