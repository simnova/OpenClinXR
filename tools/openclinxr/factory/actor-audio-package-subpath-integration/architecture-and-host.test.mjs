import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import { assertClock as assertClockShared, assertSyncNotMovedOutsideFrame } from '../actor-audio-app-owned-integration/source-contract.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const methods=['initPreparedActorAudioBridge','startPreparedActorTurnAudio','syncPreparedActorAudio','preparedActorTurnAudioAvailable','startActorTurnSpeech'];
const retired=['prepared-actor-audio.ts','prepared-actor-audio-data.ts','ordinary-actor-turn-speech.ts'];
const lines=s=>s===''?0:s.split(/\r?\n/).length-(/\r?\n$/.test(s)?1:0);
function sources(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(/^(node_modules|dist)$/.test(e.name)?[]:sources(resolve(dir,e.name))):/\.(ts|tsx)$/.test(e.name)&&!/(\.test\.|\.spec\.|\.d\.ts$)/.test(e.name)?[resolve(dir,e.name)]:[]);}
// Remove comments while preserving strings/import specifiers; a comment cannot satisfy wiring.
function uncomment(s){return s.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,(all,string)=>string??' ');}
// Shared causal-boundary contract: sync precedes fixed-clock dispatch in the
// same frame callback; simulate points at the named simulation callback.
const assertClock = assertClockShared;
function assertHost(s){
 let code=uncomment(s);
 assert.doesNotMatch(code,/from\s*["']\.\/(?:prepared-actor-audio|prepared-actor-audio-data|ordinary-actor-turn-speech)\.js["']/,'relative app business modules must be removed');
 const imports=[...code.matchAll(/^\s*import\s*\{([^}]+)\}\s*from\s*["']@openclinxr\/xr-dialogue\/actor-audio-runtime["']/gm)];
 assert.ok(imports.some(m=>m[1].split(',').some(n=>n.trim()==='createActorAudioRuntime')),'factory must be admitted subpath import');
 code=code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,"''");
 assert.equal([...code.matchAll(/\bcreateActorAudioRuntime\s*\(/g)].length,1,'exactly one runtime construction');
 const init=code.match(/const\s*\{([^}]+)\}\s*=\s*createActorAudioRuntime\s*\(\s*\{\s*developmentFixture\s*:\s*import\.meta\.env\.DEV\s*===\s*true\s*\}\s*\)/);
 assert.ok(init,'one explicit factory destructure with real development gate');
 assert.deepEqual(init[1].split(',').map(s=>s.trim()).sort(),[...methods,'caseAudio'].sort(),'closed exact bindings: five callables plus single-instance caseAudio facet; no exposed Maps');
 for(const m of methods)assert.ok(new RegExp('\\b'+m+'\\s*\\(').test(code),'method actually called: '+m);
 assert.doesNotMatch(code,/\bcaseAudio\s*\(/,'caseAudio is a non-callable single-instance facet, never invoked as a function');
 assert.ok(/\bcaseAudio\.(select|markGesture|start|bindPlan|snapshot)\s*\(/.test(code),'caseAudio facet methods actually consumed from the same factory instance');
 assertClock(code);
 assert.match(code,/speak\s*:\s*\(ctx\)\s*=>\s*startPreparedActorTurnAudio\s*\(/,'prepared branch still real direct consumer');
 assert.match(code,/!preparedActorTurnAudioAvailable\s*\(/,'ordinary override depends on prepared absence');
 assert.match(code,/startActorTurnSpeech\s*\([\s\S]*?readSpeech\s*:\s*\(c\)\s*=>\s*generatedHumanoidAnimationSlotsByActorId\.get\(c\.actorId\)\?\.activeSpeech/,'ordinary host uses actual slot speech');
 assert.match(code,/startDialogue\s*:\s*\(c\)\s*=>\s*triggerHumanoidDialogue\s*\(/,'ordinary host dialogue adapter retained');
 assert.match(code,/initPreparedActorAudioBridge\s*\(\s*\{\s*getSlot\s*:/,'host initializes actual slot access');
}
test('RED original app cap remains ten files and6038 logical lines',()=>{const files=sources(resolve(root,'apps/ui-xr/src'));const count=files.reduce((n,f)=>n+lines(readFileSync(f,'utf8')),0);assert.ok(files.length<=10&&count<=6038,`composition-root budget: actual ${files.length}/${count}, original10/6038`);});
test('RED original Main ceiling4837 retained',()=>assert.ok(lines(readFileSync(resolve(root,'apps/ui-xr/src/main.ts'),'utf8'))<=4837));
test('RED three app business modules actually deleted',()=>{for(const f of retired)assert.equal(existsSync(resolve(root,'apps/ui-xr/src',f)),false,f+' must move to package');});
test('RED actual Main uses one admitted closed subpath factory at existing host sites',()=>assertHost(readFileSync(resolve(root,'apps/ui-xr/src/main.ts'),'utf8')));
test('RED package runtime exists and all actor-audio implementation modules stay below500',()=>{const dir=resolve(root,'packages/openclinxr/xr-dialogue/src');assert.ok(existsSync(resolve(dir,'actor-audio-runtime.ts')),'named private runtime source required');for(const f of sources(dir).filter(f=>/actor-audio/.test(f)))assert.ok(lines(readFileSync(f,'utf8'))<500,f+' exceeds private module cap');});
const good=`import {createActorAudioRuntime} from '@openclinxr/xr-dialogue/actor-audio-runtime';
const {${[...methods,'caseAudio'].join(',')}}=createActorAudioRuntime({developmentFixture:import.meta.env.DEV===true});
const stepActorSimulation = (deltaSeconds: number, now: number): void => { updateGeneratedHumanoidAnimations(deltaSeconds, now, camera, genDriveForHumanoid, bundleLocomotionOrders()); };
function renderSceneFrame(timestamp?: number): void { syncPreparedActorAudio(frameNowMs); if (!fixedClockDisabled) { stepFixedClockFrame(fixedClockFrame, { frameDtSeconds: frameDtSeconds, nowMs: frameNowMs, simulate: stepActorSimulation }); } else { stepActorSimulation(frameDtSeconds, frameNowMs); } }
void caseAudio.select(bundle);
const options={speak:(ctx)=>startPreparedActorTurnAudio(ctx),...(!preparedActorTurnAudioAvailable({actorId:'a'})?{speak:ctx=>startActorTurnSpeech(ctx,{readSpeech:(c)=>generatedHumanoidAnimationSlotsByActorId.get(c.actorId)?.activeSpeech,startDialogue:(c)=>triggerHumanoidDialogue(c.actorId,c.spokenText)})}: {})};
initPreparedActorAudioBridge({getSlot:id=>slots.get(id)});`;
test('positive legitimate closed Main wiring passes same source oracle',()=>assertHost(good));
test('negative old relative business imports fail identical oracle',()=>assert.throws(()=>assertHost(good+"\nimport {old} from './prepared-actor-audio.js';"),/relative app/));
test('negative unused import and second runtime fail identical oracle',()=>{assert.throws(()=>assertHost("import {createActorAudioRuntime} from '@openclinxr/xr-dialogue/actor-audio-runtime';"),/runtime construction/);assert.throws(()=>assertHost(good+'\ncreateActorAudioRuntime({});'),/one runtime/);});
test('negative caseAudio as bare function or second facet fails identical oracle',()=>{assert.throws(()=>assertHost(good+'\ncaseAudio();'),/non-callable/);assert.throws(()=>assertHost(good.replace('caseAudio','caseAudio2')),/closed exact bindings/);});
test('negative comment-only host sites cannot green',()=>assert.throws(()=>assertHost('/*'+good+'*/'),/factory must/));
test('negative reordered or detached clock wiring fails the identical source oracle',()=>{
 const movedSync=good.replace('syncPreparedActorAudio(frameNowMs); ','');
 assert.throws(()=>assertHost(movedSync.replace('} else { stepActorSimulation(frameDtSeconds, frameNowMs); }','} else { stepActorSimulation(frameDtSeconds, frameNowMs); } syncPreparedActorAudio(frameNowMs);')),/precedes fixed-clock dispatch/);
 assert.throws(()=>assertHost(good.replace('simulate: stepActorSimulation','simulate: stepDetachedSimulation')),/points at the named simulation callback/);
 const elsewhere=good.replace('updateGeneratedHumanoidAnimations(deltaSeconds, now, camera, genDriveForHumanoid, bundleLocomotionOrders()); ','');
 assert.throws(()=>assertHost(elsewhere.replace('syncPreparedActorAudio(frameNowMs);','updateGeneratedHumanoidAnimations(deltaSeconds, now); syncPreparedActorAudio(frameNowMs);')),/drives the facial loop on the same tick/);
 assertSyncNotMovedOutsideFrame(good,assertHost);
});
test('positive factory fixture executes one instance and calls closed actual bindings',()=>{const events=[];const caseAudio={select:()=>{events.push('caseAudio.select');}};const mock={...Object.fromEntries(methods.map(m=>[m,()=>{events.push(m);return true;}])),caseAudio};let constructions=0;const createActorAudioRuntime=()=>{constructions++;return mock;};const created=createActorAudioRuntime();assert.equal(typeof created.caseAudio,'object');const {initPreparedActorAudioBridge,startPreparedActorTurnAudio,syncPreparedActorAudio,preparedActorTurnAudioAvailable,startActorTurnSpeech,caseAudio:ca}=created;initPreparedActorAudioBridge();syncPreparedActorAudio();startPreparedActorTurnAudio();preparedActorTurnAudioAvailable();startActorTurnSpeech();ca.select();assert.equal(constructions,1);assert.ok(ca===created.caseAudio,'single-instance facet');assert.deepEqual(events,[methods[0],methods[2],methods[1],methods[3],methods[4],'caseAudio.select']);});
