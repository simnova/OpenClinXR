import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const methods=['initPreparedActorAudioBridge','startPreparedActorTurnAudio','syncPreparedActorAudio','preparedActorTurnAudioAvailable','startActorTurnSpeech'];
const retired=['prepared-actor-audio.ts','prepared-actor-audio-data.ts','ordinary-actor-turn-speech.ts'];
const lines=s=>s===''?0:s.split(/\r?\n/).length-(/\r?\n$/.test(s)?1:0);
function sources(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(/^(node_modules|dist)$/.test(e.name)?[]:sources(resolve(dir,e.name))):/\.(ts|tsx)$/.test(e.name)&&!/(\.test\.|\.spec\.|\.d\.ts$)/.test(e.name)?[resolve(dir,e.name)]:[]);}
// Remove comments while preserving strings/import specifiers; a comment cannot satisfy wiring.
function uncomment(s){return s.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g,(all,string)=>string??' ');}
function assertHost(s){
 let code=uncomment(s);
 assert.doesNotMatch(code,/from\s*["']\.\/(?:prepared-actor-audio|prepared-actor-audio-data|ordinary-actor-turn-speech)\.js["']/,'relative app business modules must be removed');
 const imports=[...code.matchAll(/^\s*import\s*\{([^}]+)\}\s*from\s*["']@openclinxr\/xr-dialogue["']/gm)];
 assert.ok(imports.some(m=>m[1].split(',').some(n=>n.trim()==='createActorAudioRuntime')),'factory must be admitted root import');
 code=code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g,"''");
 assert.equal([...code.matchAll(/\bcreateActorAudioRuntime\s*\(/g)].length,1,'exactly one runtime construction');
 const init=code.match(/const\s*\{([^}]+)\}\s*=\s*createActorAudioRuntime\s*\(\s*\{\s*developmentFixture\s*:\s*import\.meta\.env\.DEV\s*===\s*true\s*\}\s*\)/);
 assert.ok(init,'one explicit factory destructure with real development gate');
 assert.deepEqual(init[1].split(',').map(s=>s.trim()).sort(),[...methods].sort(),'closed exact method bindings; no exposed Maps');
 for(const m of methods)assert.ok(new RegExp('\\b'+m+'\\s*\\(').test(code),'method actually called: '+m);
 assert.match(code,/syncPreparedActorAudio\s*\(now\)\s*;\s*updateGeneratedHumanoidAnimations\s*\(/,'clock sync before admitted facial loop');
 assert.match(code,/speak\s*:\s*\(ctx\)\s*=>\s*startPreparedActorTurnAudio\s*\(/,'prepared branch still real direct consumer');
 assert.match(code,/!preparedActorTurnAudioAvailable\s*\(/,'ordinary override depends on prepared absence');
 assert.match(code,/startActorTurnSpeech\s*\([\s\S]*?readSpeech\s*:\s*\(c\)\s*=>\s*generatedHumanoidAnimationSlotsByActorId\.get\(c\.actorId\)\?\.activeSpeech/,'ordinary host uses actual slot speech');
 assert.match(code,/startDialogue\s*:\s*\(c\)\s*=>\s*triggerHumanoidDialogue\s*\(/,'ordinary host dialogue adapter retained');
 assert.match(code,/initPreparedActorAudioBridge\s*\(\s*\{\s*getSlot\s*:/,'host initializes actual slot access');
}
test('RED original app cap remains ten files and6038 logical lines',()=>{const files=sources(resolve(root,'apps/ui-xr/src'));const count=files.reduce((n,f)=>n+lines(readFileSync(f,'utf8')),0);assert.ok(files.length<=10&&count<=6038,`composition-root budget: actual ${files.length}/${count}, original10/6038`);});
test('RED original Main ceiling4837 retained',()=>assert.ok(lines(readFileSync(resolve(root,'apps/ui-xr/src/main.ts'),'utf8'))<=4837));
test('RED three app business modules actually deleted',()=>{for(const f of retired)assert.equal(existsSync(resolve(root,'apps/ui-xr/src',f)),false,f+' must move to package');});
test('RED actual Main uses one admitted closed factory at existing host sites',()=>assertHost(readFileSync(resolve(root,'apps/ui-xr/src/main.ts'),'utf8')));
test('RED package runtime exists and all actor-audio implementation modules stay below500',()=>{const dir=resolve(root,'packages/openclinxr/xr-dialogue/src');assert.ok(existsSync(resolve(dir,'actor-audio-runtime.ts')),'named private runtime source required');for(const f of sources(dir).filter(f=>/actor-audio/.test(f)))assert.ok(lines(readFileSync(f,'utf8'))<500,f+' exceeds private module cap');});
const good=`import {createActorAudioRuntime} from '@openclinxr/xr-dialogue';
const {${methods.join(',')}}=createActorAudioRuntime({developmentFixture:import.meta.env.DEV===true});
function step(now){syncPreparedActorAudio(now);updateGeneratedHumanoidAnimations(0,now);}
const options={speak:(ctx)=>startPreparedActorTurnAudio(ctx),...(!preparedActorTurnAudioAvailable({actorId:'a'})?{speak:ctx=>startActorTurnSpeech(ctx,{readSpeech:(c)=>generatedHumanoidAnimationSlotsByActorId.get(c.actorId)?.activeSpeech,startDialogue:(c)=>triggerHumanoidDialogue(c.actorId,c.spokenText)})}: {})};
initPreparedActorAudioBridge({getSlot:id=>slots.get(id)});`;
test('positive legitimate closed Main wiring passes same source oracle',()=>assertHost(good));
test('negative old relative business imports fail identical oracle',()=>assert.throws(()=>assertHost(good+"\nimport {old} from './prepared-actor-audio.js';"),/relative app/));
test('negative unused import and second runtime fail identical oracle',()=>{assert.throws(()=>assertHost("import {createActorAudioRuntime} from '@openclinxr/xr-dialogue';"),/runtime construction/);assert.throws(()=>assertHost(good+'\ncreateActorAudioRuntime({});'),/one runtime/);});
test('negative comment-only host sites cannot green',()=>assert.throws(()=>assertHost('/*'+good+'*/'),/factory must/));
test('positive factory fixture executes one instance and calls closed actual bindings',()=>{const events=[];const mock=Object.fromEntries(methods.map(m=>[m,()=>{events.push(m);return true;}]));let constructions=0;const createActorAudioRuntime=()=>{constructions++;return mock;};const {initPreparedActorAudioBridge,startPreparedActorTurnAudio,syncPreparedActorAudio,preparedActorTurnAudioAvailable,startActorTurnSpeech}=createActorAudioRuntime();initPreparedActorAudioBridge();syncPreparedActorAudio();startPreparedActorTurnAudio();preparedActorTurnAudioAvailable();startActorTurnSpeech();assert.equal(constructions,1);assert.deepEqual(events,[methods[0],methods[2],methods[1],methods[3],methods[4]]);});
