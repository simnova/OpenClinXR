import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {inspectExecutedModules} from './executed-module-integrity.mjs';
import {reproduceViteModules} from './reproduce-vite-modules.mjs';
import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
function fixture(){const root=mkdtempSync(join(tmpdir(),'executed-module-control-'));const original='export const source = 1;';const map=Buffer.from(JSON.stringify({version:3,sources:['module.ts'],sourcesContent:[original],names:[],mappings:''})).toString('base64');const code=original+'\n//# sourceMappingURL=data:application/json;base64,'+map;
 writeFileSync(join(root,'module.ts'),original);writeFileSync(join(root,'served.js'),code);writeFileSync(join(root,'executed.js'),code);
 const sha256=createHash('sha256').update(code).digest('hex');
 return {root,reproduced:{'module.ts':Buffer.from(code).toString('base64')},rows:[{sourcePath:'module.ts',url:'http://localhost:5173/src/module.ts',scriptId:'14',scriptParsedEvent:'Debugger.scriptParsed',sourceMapSource:'module.ts',originalSourceContent:original,served:{path:'served.js',sha256},executed:{path:'executed.js',sha256}}]};}
it('identical retained served/executed source with independently reproduced transform is allowed',()=>{const {root,rows,reproduced}=fixture();expect(inspectExecutedModules(rows,root,root,['module.ts'],reproduced)).toEqual([]);});
it('source bindings alone cannot substitute for observed executed scripts',()=>{const {root,rows,reproduced}=fixture();delete rows[0].scriptId;expect(inspectExecutedModules(rows,root,root,['module.ts'],reproduced)).toContain('executed-module-observation:module.ts');});
it('stale executed module refuses even if the new served file hash is truthful',()=>{const {root,rows,reproduced}=fixture();const next='export const source = 2;';writeFileSync(join(root,'served.js'),next);rows[0].served.sha256=createHash('sha256').update(next).digest('hex');expect(inspectExecutedModules(rows,root,root,['module.ts'],reproduced)).toContain('served-executed-module-mismatch:module.ts');});
it('a truthful old source map cannot substitute for freshly transformed current code',()=>{const {root,rows,reproduced}=fixture();reproduced['module.ts']=Buffer.from('export const source = 3;').toString('base64');expect(inspectExecutedModules(rows,root,root,['module.ts'],reproduced)).toContain('executed-current-transform-mismatch:module.ts');});
it('omitting an actual host module fails closed',()=>{const {root,rows,reproduced}=fixture();expect(inspectExecutedModules(rows,root,root,['module.ts','main.ts'],reproduced)).toContain('executed-module-required:main.ts');});
it('real current Vite transforms are reproducible and changed code cannot hide behind a truthful map',async()=>{
 const repoRoot=fileURLToPath(new URL('../../../../',import.meta.url)),root=mkdtempSync(join(tmpdir(),'actual-vite-transform-control-'));
 const paths=['apps/ui-xr/src/main.ts','apps/ui-xr/src/prepared-actor-audio.ts','packages/openclinxr/xr-dialogue/dist/viseme-runtime-wire.js','packages/openclinxr/xr-dialogue/dist/viseme-baked-cues.js'];
 const rows=paths.map(sourcePath=>({sourcePath,url:'http://127.0.0.1:1/@fs'+repoRoot+sourcePath,scriptId:'unit-control-not-browser-observation',scriptParsedEvent:'Debugger.scriptParsed'}));
 const metadata={gitCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:repoRoot,encoding:'utf8'}).trim(),buildTime:'2026-09-17T02:55:00Z'};
 const first=await reproduceViteModules(repoRoot,rows,metadata),current=await reproduceViteModules(repoRoot,rows,metadata);
 writeFileSync(join(root,'first-current-vite.json'),JSON.stringify(first));writeFileSync(join(root,'second-current-vite.json'),JSON.stringify(current));
 for(const [index,row] of rows.entries()){const bytes=Buffer.from(first[row.sourcePath],'base64'),sha256=createHash('sha256').update(bytes).digest('hex');writeFileSync(join(root,index+'-served.js'),bytes);writeFileSync(join(root,index+'-executed.js'),bytes);row.served={path:index+'-served.js',sha256};row.executed={path:index+'-executed.js',sha256};}
 expect(inspectExecutedModules(rows,root,repoRoot,paths,current)).toEqual([]);
 const forged=Buffer.concat([Buffer.from(first[paths[2]],'base64'),Buffer.from('\nthrow Error("changed actual code with original map retained");')]);
 writeFileSync(join(root,'2-served.js'),forged);writeFileSync(join(root,'2-executed.js'),forged);
 rows[2].served.sha256=rows[2].executed.sha256=createHash('sha256').update(forged).digest('hex');
 expect(inspectExecutedModules(rows,root,repoRoot,paths,current)).toContain('executed-current-transform-mismatch:'+paths[2]);
},60000);

it('retained actual browser CDP and network responses agree; modifying executed bytes refuses',()=>{
 const root='/Users/patrick/Documents/Codex/2026-09-08/referenced-chatgpt-conversation-this-is-an/openclinxr-lip-sync-consultation-2026-09-16/execution-packet/browser-cdp-module-probe-1789613971918';
 const reportBytes=readFileSync(join(root,'report.json')); expect(createHash('sha256').update(reportBytes).digest('hex')).toBe('49804827a9de4c4ca4b7e08867a24865cdd0343bbb656cbb00f051c58e8da4ce'); const report=JSON.parse(reportBytes.toString('utf8'));
 expect(report.scope).toBe('browser-CDP-module-source-identity-only');
 const paths=['apps/ui-xr/src/main.ts','packages/openclinxr/xr-dialogue/dist/viseme-baked-cues.js','packages/openclinxr/xr-dialogue/dist/viseme-runtime-wire.js','apps/ui-xr/src/prepared-actor-audio.ts'];
 const reproduced={},rows=report.scripts.map((script,index)=>{const network=report.network.find(row=>row.url===script.url);reproduced[paths[index]]=readFileSync(join(root,network.file)).toString('base64');return {sourcePath:paths[index],url:script.url,scriptId:script.scriptId,scriptParsedEvent:'Debugger.scriptParsed',served:{path:network.file,sha256:network.sha256},executed:{path:script.file,sha256:script.sha256}};});
 // Reproduced here means retained independent network bytes, NOT a current-build or product-consumption claim.
 expect(inspectExecutedModules(rows,root,root,paths,reproduced)).toEqual([]);
 const altered=mkdtempSync(join(tmpdir(),'actual-cdp-tamper-control-'));
 for(const row of rows)for(const ref of [row.served,row.executed])writeFileSync(join(altered,ref.path),readFileSync(join(root,ref.path)));
 writeFileSync(join(altered,rows[2].executed.path),'changed executed script');
 expect(inspectExecutedModules(rows,altered,root,paths,reproduced)).toContain('served-executed-module-mismatch:'+paths[2]);
});
