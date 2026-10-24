import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DUPLEX_WORKLET_SOURCE } from '@openclinxr/xr-capacity/stage1';
import { WITNESS_WORKLET_SOURCE } from '@openclinxr/xr-capacity/stage1-witnessed';
import { WITNESSED_AUDIO_CONFIG } from '@openclinxr/xr-capacity/stage1-witnessed';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..'), args = process.argv.slice(2);
const option = (name: string) => { const at = args.indexOf(name); return at < 0 ? null : args[at + 1]; };
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const protocolPath = option('--protocol'), original = option('--stage1-dist'), stage0 = option('--stage0-dist');
if (!protocolPath || !original || !stage0) throw new Error('--protocol <witnessed protocol> --stage1-dist <original fa67 distribution> --stage0-dist <postcapture tooling dist> required');
const protocol = await readFile(resolve(protocolPath)), protocolSha256 = sha(protocol);
if (protocolSha256 !== 'efc633be9fa8d8fb86e65951b7cd89be08498b7331d7c23eb2d8f37319a83245') throw new Error('Frozen witnessed protocol mismatch');
const originalBytes = await readFile(join(resolve(original), 'source-manifest.json'));
if (sha(originalBytes) !== 'fa67a20828f06e6bd387ea5c3c60fd9f6a5f156009bcc18ff37d8b36ef4b3116') throw new Error('Original Stage1 source manifest mismatch');
const oldStage1 = JSON.parse(originalBytes.toString('utf8')), oldStage0 = JSON.parse(await readFile(join(resolve(stage0), 'source-manifest.json'), 'utf8'));
if (Object.keys(oldStage1.files).length !== 40 || Object.keys(oldStage0.files).length !== 16 || oldStage0.bundleSha256 !== 'ca5aabcc997f2309822e59a1dc77013d63766f5ffd74ccbf87b1fc2c5c55cf54') throw new Error('Original source boundary mismatch');
const files: Record<string,string> = {}, inheritedStage1SourceFiles: Record<string,string> = {}, inheritedStage0SourceFiles: Record<string,string> = {};
for (const [prior, inherited] of [[oldStage1.files, inheritedStage1SourceFiles], [oldStage0.files, inheritedStage0SourceFiles]] as const) for (const [path, expected] of Object.entries(prior)) {
  const actual = sha(await readFile(join(root, path))); if (actual !== expected) throw new Error(`Immutable source drift: ${path}`); files[path] = actual; inherited[path] = actual;
}
for (const dir of ['packages/openclinxr/xr-capacity/src/stage1-witnessed/audio','packages/openclinxr/xr-capacity/src/stage1-witnessed/grading','packages/openclinxr/xr-capacity/src/stage1-witnessed/shell','tools/openclinxr/evidence/quest-capacity/stage1-witnessed']) for (const name of (await readdir(join(root, dir))).sort()) if (/\.(ts|mjs|html)$/.test(name)) { const path = `${dir}/${name}`; files[path] = sha(await readFile(join(root, path))); }
const vite: typeof import('../../../../../apps/ui-xr/node_modules/vite/dist/node/index.js') = await import(pathToFileURL(join(root, 'apps/ui-xr/node_modules/vite/dist/node/index.js')).href);
async function bundle(entry: string, name: string) {
  const result = await vite.build({ configFile: false, root, logLevel: 'error', build: { write: false, minify: false, target: 'es2022', lib: { entry: join(root, entry), formats: ['es'], fileName: () => name }, rollupOptions: { output: { inlineDynamicImports: true } } } }) as { output: Array<{ type: string; fileName: string; code: string }> } | Array<{ output: Array<{ type: string; fileName: string; code: string }> }>;
  const output = Array.isArray(result) ? result.flatMap(item => item.output) : result.output, chunks = output.filter(item => item.type === 'chunk');
  if (chunks.length !== 1 || chunks[0]?.fileName !== name) throw new Error('Expected one self-contained bundle'); return chunks[0].code;
}
const app = await bundle('packages/openclinxr/xr-capacity/src/stage1-witnessed/shell/entry.ts', 'stage1-witnessed.js');
const out = option('--out') ? resolve(option('--out')!) : await mkdtemp(join(tmpdir(), `quest-stage1-witnessed-${process.pid}-`)); await mkdir(out, { recursive: true });
const bundleSha256 = sha(app), scene = await readFile(join(resolve(original), 'scene-manifest.json')), sceneManifestSha256 = sha(scene), workletSha256 = sha(DUPLEX_WORKLET_SOURCE), witnessWorkletSha256 = sha(WITNESS_WORKLET_SOURCE), audioConfigSha256 = sha(JSON.stringify(WITNESSED_AUDIO_CONFIG));
if (sceneManifestSha256 !== oldStage1.sceneManifestSha256 || workletSha256 !== 'bcfdec6d19b9b794e7915e21b79601e3f03e4124308192ec774c03c0949aebf4') throw new Error('Scene or immutable target worklet drift');
const rendererVersion = JSON.parse(await readFile(join(root, 'node_modules/three/package.json'), 'utf8')).version, inputClass = args.includes('--host-synthetic') ? 'synthetic-host' : 'actual-microphone';
const metadata = { bundleSha256, protocolSha256, sceneManifestSha256, workletSha256, witnessWorkletSha256, audioConfigSha256, workletFile: './duplex-worklet.js', witnessWorkletFile: './witness-worklet.js', inputClass, nonce: '', protocol: JSON.parse(protocol.toString('utf8')), rendererVersion, foveationRequested: 1, sourceFiles: files };
const escaped = JSON.stringify(metadata).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const bodies: Record<string, string | Uint8Array> = { 'index.html': (await readFile(join(root, 'tools/openclinxr/evidence/quest-capacity/stage1-witnessed/index.html'), 'utf8')).replace('__METADATA__', escaped), 'stage1-witnessed.js': app, 'duplex-worklet.js': DUPLEX_WORKLET_SOURCE, 'witness-worklet.js': WITNESS_WORKLET_SOURCE, 'protocol.json': protocol, 'scene-manifest.json': scene };
if (inputClass === 'synthetic-host') { bodies['host-fixture.js'] = await bundle('tools/openclinxr/evidence/quest-capacity/stage1-witnessed/host-fixture.ts', 'host-fixture.js'); bodies['host-fixture.html'] = `<html><body><h1>Explicit synthetic XR-row host fixture; never actual XR</h1><button id="host-start">Start finite 75s fixture</button><canvas id="host-canvas" hidden></canvas><pre id="host-status">Ready</pre><script id="stage1-witnessed-metadata" type="application/json">${escaped}</script><script type="module" src="./host-fixture.js"></script></body></html>`; }
for (const [name, body] of Object.entries(bodies)) await writeFile(join(out, name), body);
const manifest = { schema: 'quest-stage1-witnessed-source-manifest.v1', createdAt: new Date().toISOString(), bundleSha256, protocolSha256, sceneManifestSha256, workletSha256, witnessWorkletSha256, audioConfigSha256, rendererVersion, inputClass, files, inheritedStage1SourceFiles, inheritedStage0SourceFiles, served: Object.fromEntries(Object.entries(bodies).map(([name, body]) => [name, sha(body)])), commands: { build: 'node --import tsx tools/openclinxr/evidence/quest-capacity/stage1-witnessed/build.ts --protocol <witnessed protocol> --stage1-dist <original fa67 distribution> --stage0-dist <postcapture tooling dist>' }, notEvidenceFor: ['Host synthetic XR rows as actual XR', 'Host synthetic capture as actual microphone', 'Acoustic RTT or physical speaker delivery', 'Original failed source qualification', 'Maximum capacity'] };
await writeFile(join(out, 'source-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ out, sourceManifestSha256: sha(await readFile(join(out, 'source-manifest.json'))), bundleSha256, protocolSha256, sceneManifestSha256, workletSha256, witnessWorkletSha256, audioConfigSha256 }, null, 2)}\n`);
