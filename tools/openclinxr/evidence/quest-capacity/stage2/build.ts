import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STAGE2_CONFIG, STAGE2_PROTOCOL_SHA256 } from '@openclinxr/xr-capacity/stage2';
import { STAGE2_WORKLET_SOURCE } from '@openclinxr/xr-capacity/stage2';
import { serverSources, sha, sourceDigest } from './gateway.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..'), args = process.argv.slice(2);
const option = (name: string) => {const at = args.indexOf(name);return at < 0 ? null : args[at+1];};
const protocolPath = option('--protocol'); if (!protocolPath) throw new Error('--protocol <frozen Stage2 protocol> required');
const protocol = await readFile(resolve(protocolPath)); if (sha(protocol) !== STAGE2_PROTOCOL_SHA256) throw new Error('Frozen Stage2 protocol hash mismatch');
const files: Record<string,string> = {}, graderFiles: Record<string,string> = {};
for (const relative of ['tools/openclinxr/evidence/quest-capacity/stage2','packages/openclinxr/xr-capacity/src/stage2/media','packages/openclinxr/xr-capacity/src/stage2/grading']) {
  for (const name of (await readdir(join(root,relative))).sort()) if (/\.(ts|py|html)$/.test(name)) {const path = `${relative}/${name}`;const hash=sha(await readFile(join(root,path)));files[path]=hash;if (relative.endsWith('/grading') && !name.includes('.test')) graderFiles[path]=hash;}
}
const vite: typeof import('../../../../../apps/ui-xr/node_modules/vite/dist/node/index.js') = await import(pathToFileURL(join(root,'apps/ui-xr/node_modules/vite/dist/node/index.js')).href);
const result = await vite.build({configFile:false,root,logLevel:'error',build:{write:false,minify:false,target:'es2022',lib:{entry:join(root,'tools/openclinxr/evidence/quest-capacity/stage2/entry.ts'),formats:['es'],fileName:()=> 'stage2.js'},rollupOptions:{output:{inlineDynamicImports:true}}}}) as {output:Array<{type:string;fileName:string;code:string}>}|Array<{output:Array<{type:string;fileName:string;code:string}>}>;
const outputs=Array.isArray(result)?result.flatMap(item=>item.output):result.output;const chunks=outputs.filter(item=>item.type==='chunk');if(chunks.length!==1 || chunks[0]?.fileName!=='stage2.js') throw new Error('Expected one self-contained Stage2 app bundle');
const app=chunks[0].code, workletSha256=sha(STAGE2_WORKLET_SOURCE), fixtureConfigSha256=sha(JSON.stringify(STAGE2_CONFIG));
const identity={browserBundleSha256:sha(app),serverSourceSha256:sourceDigest(await serverSources()),protocolSha256:sha(protocol),fixtureConfigSha256,graderSourceSha256:sha(Object.entries(graderFiles).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,hash])=>`${path}:${hash}`).join('\n'))};
const metadata=JSON.stringify({identity,workletSha256,scope:'same-host-synthetic-only'}).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
const servedBodies:Record<string,string|Uint8Array>={'index.html':(await readFile(join(root,'tools/openclinxr/evidence/quest-capacity/stage2/index.html'),'utf8')).replace('__METADATA__',metadata),'stage2.js':app,'stage2-worklet.js':STAGE2_WORKLET_SOURCE,'protocol.json':protocol};
const outOption=option('--out');const out=outOption?resolve(outOption):await mkdtemp(join(tmpdir(),`quest-stage2-build-${process.pid}-`));if(outOption)await mkdir(out,{recursive:false});
for(const [name,bytes] of Object.entries(servedBodies)) await writeFile(join(out,name),bytes);
const manifest={schema:'quest-stage2-host-source-manifest.v1',createdAt:new Date().toISOString(),identity,workletSha256,graderHashAlgorithm:'SHA256 UTF8 newline-joined sorted relative-path:sha256 for runtime files; no trailing newline',serverHashAlgorithm:'SHA256 UTF8 compact JSON sorted basename:sha256 map of SERVER_FILES; independent Python readback',files,served:Object.fromEntries(Object.entries(servedBodies).map(([name,bytes])=>[name,sha(bytes)])),commands:{build:'node --import tsx tools/openclinxr/evidence/quest-capacity/stage2/build.ts --protocol <frozen-protocol> --out <new-dist>'},notEvidenceFor:['Physical microphone or speaker delivery','Acoustic or conversational RTT','Quest or immersive rendering','Stage1 qualification','Maximum capacity']};
await writeFile(join(out,'source-manifest.json'),`${JSON.stringify(manifest,null,2)}\n`);process.stdout.write(`${JSON.stringify({out,sourceManifestSha256:sha(await readFile(join(out,'source-manifest.json'))),...identity,workletSha256},null,2)}\n`);
