import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const methods=['initPreparedActorAudioBridge','startPreparedActorTurnAudio','syncPreparedActorAudio','preparedActorTurnAudioAvailable','startActorTurnSpeech','caseAudio'];
const retired=['prepared-actor-audio.ts','prepared-actor-audio-data.ts','ordinary-actor-turn-speech.ts'];
const lines=s=>s===''?0:s.split(/\r?\n/).length-(/\r?\n$/.test(s)?1:0);
function sources(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(/^(node_modules|dist)$/.test(e.name)?[]:sources(resolve(dir,e.name))):/\.(ts|tsx)$/.test(e.name)&&!/(\.test\.|\.spec\.|\.d\.ts$)/.test(e.name)?[resolve(dir,e.name)]:[]);}
// Remove comments while preserving strings/import specifiers; a comment cannot satisfy wiring.
function uncomment(s){return s.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,(all,string)=>string??' ');}
function assertHost(s){
 let code=uncomment(s);
 assert.doesNotMatch(code,/from\s*["']\.\/(?:prepared-actor-audio|prepared-actor-audio-data|ordinary-actor-turn-speech)\.js["']/,'relative app business modules must be removed');
 const imports=[...code.matchAll(/^\s*import\s*\{([^}]+)\}\s*from\s*["']@openclinxr\/xr-dialogue\/actor-audio-runtime["']/gm)];
 assert.ok(imports.some(m=>m[1].split(',').some(n=>n.trim()==='createActorAudioRuntime')),'factory must be admitted subpath import');
 code=code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,"''");
 assert.equal([...code.matchAll(/\bcreateActorAudioRuntime\s*\(/g)].length,1,'exactly one runtime construction');
 const init=code.match(/const\s*\{([^}]+)\}(?:\s*:\s*ReturnType\s*<\s*typeof\s+createActorAudioRuntime\s*>)?\s*=\s*createActorAudioRuntime\s*\(\s*\{\s*developmentFixture\s*:\s*import\.meta\.env\.DEV\s*===\s*true\s*\}\s*\)/);
 assert.ok(init,'one explicit factory destructure with real development gate');
 assert.deepEqual(init[1].split(',').map(s=>s.trim()).sort(),[...methods].sort(),'closed exact method bindings; no exposed Maps');
 for(const m of methods.filter(m=>m!=='caseAudio'))assert.ok(new RegExp('\\b'+m+'\\s*\\(').test(code),'method actually called: '+m);
 assert.match(code,/syncPreparedActorAudio\s*\(now\)\s*;\s*updateGeneratedHumanoidAnimations\s*\(/,'clock sync before admitted facial loop');
 assert.match(code,/speak\s*:\s*\(ctx\)\s*=>\s*startPreparedActorTurnAudio\s*\(/,'prepared branch still real direct consumer');
 assert.match(code,/!preparedActorTurnAudioAvailable\s*\(/,'ordinary override depends on prepared absence');
 assert.match(code,/startActorTurnSpeech\s*\([\s\S]*?readSpeech\s*:\s*\(c\)\s*=>\s*generatedHumanoidAnimationSlotsByActorId\.get\(c\.actorId\)\?\.activeSpeech/,'ordinary host uses actual slot speech');
 assert.match(code,/startDialogue\s*:\s*\(c\)\s*=>\s*triggerHumanoidDialogue\s*\(/,'ordinary host dialogue adapter retained');
 assert.match(code,/encounterRuntimeAssetBundle\s*=\s*caseAudio\.select\(bundle\)/,'selected bundle actually consumed preserving reference');
 assert.match(code,/void\s+caseAudio\.markGesture\(tag\)/,'normal input boundary invokes gesture');
 assert.match(code,/caseAudio\.start\(plan,\s*execution,\s*\{\s*gazeTarget,\s*req:\s*requirement\s*\}\)\s*\?\?\s*playLiveFrozenActorTurn/,'selected failure cannot ordinary fallback');
 assert.match(code,/return\s+caseAudio\.bindPlan\(consumed,\s*tag\)/,'exact payload plan is bound');
 assert.doesNotMatch(code,/\b(?:getHost|getSessions|getContext|getDestination|getUserActivated)\s*\(/,'host must not expose mutable manager internals');
 assert.match(code,/initPreparedActorAudioBridge\s*\(\s*\{\s*getSlot\s*:/,'host initializes actual slot access');
}
test('RED original app cap remains ten files and6038 logical lines',()=>{const files=sources(resolve(root,'apps/ui-xr/src'));const count=files.reduce((n,f)=>n+lines(readFileSync(f,'utf8')),0);assert.ok(files.length<=10&&count<=6038,`composition-root budget: actual ${files.length}/${count}, original10/6038`);});
test('RED original Main ceiling4837 retained',()=>assert.ok(lines(readFileSync(resolve(root,'apps/ui-xr/src/main.ts'),'utf8'))<=4837));
test('RED three app business modules actually deleted',()=>{for(const f of retired)assert.equal(existsSync(resolve(root,'apps/ui-xr/src',f)),false,f+' must move to package');});
test('RED actual Main uses one admitted closed subpath factory at existing host sites',()=>assertHost(readFileSync(resolve(root,'apps/ui-xr/src/main.ts'),'utf8')));
test('RED package runtime exists and all actor-audio implementation modules stay below500',()=>{const dir=resolve(root,'packages/openclinxr/xr-dialogue/src');assert.ok(existsSync(resolve(dir,'actor-audio-runtime.ts')),'named private runtime source required');for(const f of sources(dir).filter(f=>/actor-audio/.test(f)))assert.ok(lines(readFileSync(f,'utf8'))<500,f+' exceeds private module cap');});
const good=`import {createActorAudioRuntime} from '@openclinxr/xr-dialogue/actor-audio-runtime';
const {${methods.join(',')}}=createActorAudioRuntime({developmentFixture:import.meta.env.DEV===true});
function step(now){syncPreparedActorAudio(now);updateGeneratedHumanoidAnimations(0,now);}
const options={speak:(ctx)=>startPreparedActorTurnAudio(ctx),...(!preparedActorTurnAudioAvailable({actorId:'a'})?{speak:ctx=>startActorTurnSpeech(ctx,{readSpeech:(c)=>generatedHumanoidAnimationSlotsByActorId.get(c.actorId)?.activeSpeech,startDialogue:(c)=>triggerHumanoidDialogue(c.actorId,c.spokenText)})}: {})};
initPreparedActorAudioBridge({getSlot:id=>slots.get(id)});
encounterRuntimeAssetBundle=caseAudio.select(bundle);
void caseAudio.markGesture(tag);
const playFrozenTurn=(plan,execution,gazeTarget,requirement)=>caseAudio.start(plan,execution,{gazeTarget,req:requirement})??playLiveFrozenActorTurn(plan,execution,gazeTarget,requirement);
function remember(consumed,tag){return caseAudio.bindPlan(consumed,tag);}`;
test('positive legitimate closed Main wiring passes same source oracle',()=>assertHost(good));
test('negative old relative business imports fail identical oracle',()=>assert.throws(()=>assertHost(good+"\nimport {old} from './prepared-actor-audio.js';"),/relative app/));
test('negative unused import and second runtime fail identical oracle',()=>{assert.throws(()=>assertHost("import {createActorAudioRuntime} from '@openclinxr/xr-dialogue/actor-audio-runtime';"),/runtime construction/);assert.throws(()=>assertHost(good+'\ncreateActorAudioRuntime({});'),/one runtime/);});
test('negative comment-only host sites cannot green',()=>assert.throws(()=>assertHost('/*'+good+'*/'),/factory must/));
test('positive factory fixture executes one instance and calls closed actual bindings',()=>{const events=[];const mock=Object.fromEntries(methods.map(m=>[m,()=>{events.push(m);return true;}]));let constructions=0;const createActorAudioRuntime=()=>{constructions++;return mock;};const {initPreparedActorAudioBridge,startPreparedActorTurnAudio,syncPreparedActorAudio,preparedActorTurnAudioAvailable,startActorTurnSpeech}=createActorAudioRuntime();initPreparedActorAudioBridge();syncPreparedActorAudio();startPreparedActorTurnAudio();preparedActorTurnAudioAvailable();startActorTurnSpeech();assert.equal(constructions,1);assert.deepEqual(events,[methods[0],methods[2],methods[1],methods[3],methods[4]]);});

test('negative each new host seam unwired fails the identical source oracle',()=>{
 for(const token of ['caseAudio.select(bundle)','caseAudio.markGesture(tag)','caseAudio.start(plan,execution,{gazeTarget,req:requirement})','caseAudio.bindPlan(consumed,tag)'])
  assert.throws(()=>assertHost(good.replace(token,'unwired()')));
 assert.throws(()=>assertHost(good+"\ngetSessions();"),/mutable manager/);
});
test('actual selected store callback returns refusal without running ordinary fallback',()=>{
 const src=readFileSync(resolve(root,'apps/ui-xr/src/main.ts'),'utf8');
 const m=uncomment(src).match(/playFrozenTurn:\s*(\(plan, execution, gazeTarget, requirement\)\s*=>\s*[^\n]+)/);
 assert.ok(m,'actual callback source required');
 const expression=m[1].trim().replace(/,$/,'');
 let fallback=0;const refused={kind:'refused',reason:'approval_missing'};
 const make=new Function('caseAudio','playLiveFrozenActorTurn','return ('+expression+');');
 const callback=make({start:()=>refused},()=>{fallback++;return {legacy:true};});
 assert.equal(callback({},null,{},null),refused);assert.equal(fallback,0);
 const ordinary=make({start:()=>null},()=>{fallback++;return {legacy:true};});
 assert.deepEqual(ordinary({},null,{},null),{legacy:true});assert.equal(fallback,1);
});

test('negative actual pre-bridge334 Main is refused by identical new consumed-host oracle',()=>{
 const old=execFileSync('git',['show','3345167e003f5239e9396f42cfeb3ddd634d5438:apps/ui-xr/src/main.ts'],{cwd:root,encoding:'utf8'});
 assert.throws(()=>assertHost(old),/closed exact method bindings|selected bundle/);
});
