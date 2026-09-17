import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {inspectExecutedModules} from './executed-module-integrity.mjs';
function fixture(){const root=mkdtempSync(join(tmpdir(),'executed-module-control-'));const original='export const source = 1;';const map=Buffer.from(JSON.stringify({version:3,sources:['module.ts'],sourcesContent:[original],names:[],mappings:''})).toString('base64');const code=original+'\n//# sourceMappingURL=data:application/json;base64,'+map;
 writeFileSync(join(root,'module.ts'),original);writeFileSync(join(root,'served.js'),code);writeFileSync(join(root,'executed.js'),code);
 const sha256=createHash('sha256').update(code).digest('hex');
 return {root,rows:[{sourcePath:'module.ts',url:'http://localhost:5173/src/module.ts',scriptId:'14',scriptParsedEvent:'Debugger.scriptParsed',sourceMapSource:'module.ts',originalSourceContent:original,served:{path:'served.js',sha256},executed:{path:'executed.js',sha256}}]};}
it('identical retained served/executed source with current original map content is allowed',()=>{const {root,rows}=fixture();expect(inspectExecutedModules(rows,root,root,['module.ts'])).toEqual([]);});
it('source bindings alone cannot substitute for observed executed scripts',()=>{const {root,rows}=fixture();delete rows[0].scriptId;expect(inspectExecutedModules(rows,root,root,['module.ts'])).toContain('executed-module-observation:module.ts');});
it('stale executed module refuses even if the new served file hash is truthful',()=>{const {root,rows}=fixture();const next='export const source = 2;';writeFileSync(join(root,'served.js'),next);rows[0].served.sha256=createHash('sha256').update(next).digest('hex');expect(inspectExecutedModules(rows,root,root,['module.ts'])).toContain('served-executed-module-mismatch:module.ts');});
it('an old original source map cannot attest current checkout bytes',()=>{const {root,rows}=fixture();writeFileSync(join(root,'module.ts'),'export const source = 3;');expect(inspectExecutedModules(rows,root,root,['module.ts'])).toContain('executed-original-source-mismatch:module.ts');});
it('omitting an actual host module fails closed',()=>{const {root,rows}=fixture();expect(inspectExecutedModules(rows,root,root,['module.ts','main.ts'])).toContain('executed-module-required:main.ts');});
