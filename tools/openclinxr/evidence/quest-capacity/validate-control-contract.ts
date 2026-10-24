/** Offline host validation of bounded Stage2 control and owned-port lifecycles. No network or physical media. */
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {Stage2Budget,Stage2Control,Stage2OwnerTransfer,Stage2Observer,STAGE2_WORKLET_SOURCE,STAGE2_PROTOCOL_SHA256,runStage2Media} from '@openclinxr/xr-capacity/stage2';
import type {Stage2RunRecord} from '@openclinxr/xr-capacity/stage2';
type Options=Parameters<typeof runStage2Media>[0];
type Source=Stage2RunRecord['sources']['uplink'];
type OwnedPort=ConstructorParameters<typeof Stage2Observer>[0]['port'];
const url='http://127.0.0.1:55555';
export async function validateStage2ControlContract(){
 const originalFetch=globalThis.fetch,checks:string[]=[];
 try{
  const waiting:Array<(response:Response)=>void>=[];
  globalThis.fetch=()=>new Promise<Response>(resolve=>waiting.push(resolve));
  const concurrent=new Stage2Control(url);const pending=Array.from({length:4},()=>concurrent.post('/stage2/control',{},new AbortController().signal));
  await assert.rejects(concurrent.post('/stage2/control',{},new AbortController().signal),/budget/);assert.equal(concurrent.active,4);
  waiting.forEach(resolve=>resolve(new Response('{}')));const replies=await Promise.all(pending);replies.forEach(reply=>reply.release());assert.equal(concurrent.maximumConcurrent,4);assert.equal(concurrent.active,0);assert.equal(concurrent.queuedBytes,0);assert.equal(concurrent.rejected,1);checks.push('four concurrent requests and rejected fifth retain exact ownership');
  const text=JSON.stringify({x:'😀'}),size=new TextEncoder().encode(text).byteLength;
  globalThis.fetch=async()=>new Response(text,{headers:{'Content-Length':String(size)}});
  const exact=new Stage2Budget(2+4*size,0),client=new Stage2Control(url,exact),reply=await client.post('/stage2/stats',{},new AbortController().signal);
  assert.deepEqual(reply.body,{x:'😀'});assert.equal(exact.audit().peakBytes,2+4*size);assert.equal(exact.temporaryHeldBytes,size);reply.release();reply.release();assert.equal(exact.close().heldBytesAtClose,0);checks.push('UTF-8 raw decode parse ownership exact fit and idempotent release');
  const short=new Stage2Budget(1+4*size,0),shortClient=new Stage2Control(url,short);await assert.rejects(shortClient.post('/stage2/stats',{},new AbortController().signal),/budget-exhausted/);assert.equal(short.audit().rejectedReservations,1);assert.equal(short.close().heldBytesAtClose,0);assert.equal(shortClient.active,0);checks.push('one-byte-short refuses before retaining parsed reply');
  const sealed=new Stage2Budget(100,0);sealed.claim('history','history',40);sealed.close();let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('{}',{headers:{'Content-Length':'2'}});};const reader=new Stage2Control(url,sealed);
  await assert.rejects(reader.post('/stage2/control',{},new AbortController().signal),/budget-exhausted/);assert.equal(calls,0);
  const final=await reader.post('/stage2/stats',{},new AbortController().signal);final.release();assert.equal(sealed.audit().heldBytesAtClose,40);assert.equal(sealed.temporaryHeldBytes,0);checks.push('sealed histories reject writes and admit bounded final read-only stats');
  const identity={browserBundleSha256:'a'.repeat(64),serverSourceSha256:'b'.repeat(64),protocolSha256:STAGE2_PROTOCOL_SHA256,fixtureConfigSha256:'c'.repeat(64),graderSourceSha256:'d'.repeat(64)},binding={runNonce:'offline-contract',peerTicket:'offline-ticket',uplinkSourceId:'up',downlinkSourceId:'down'};
  const options:Options={gatewayOrigin:url,workletUrl:'/worklet.js',expectedWorkletSha256:'e'.repeat(64),driverStartedMs:0,signal:new AbortController().signal,release:{schema:'quest-stage2-host-release.v1',identity,binding,mode:'positive',expectedEnvironment:{browser:{executablePath:'none',version:'offline-contract',launchFlags:[],timeOriginMs:performance.timeOrigin},driver:{processId:process.pid,clockId:'node-offline',timeOriginMs:performance.timeOrigin},runtime:{nodeVersion:process.version,pythonVersion:'not-run',aiortcVersion:'not-run',avVersion:'not-run',aiohttpVersion:'not-run',serverProcessId:0,serverClockId:'offline-server'},signalingOrigins:[url],iceServers:[],localInterfaces:[]}}};
  globalThis.fetch=async(input)=>new URL(String(input)).pathname==='/stage2/close'?Response.json({identity,binding,closed:true,serverClockId:'offline-server',atServerMs:1,activePeers:0,closingPeers:0,ownedTasks:0,queuedControlBytes:0,pendingControls:0}):new Response('no physical media allocated',{status:409});
  const record=await runStage2Media(options);assert.equal(record.outcome,'failed');assert.equal(record.cleanup.serverClose?.closed,true);assert.ok(Object.values(record.cleanup.browserRemaining).every(n=>n===0));
  const owner=new Stage2Budget(100,0);owner.claim('history:monitor','history',40);let transfers=0;const gate=new Stage2OwnerTransfer(actual=>{transfers++;assert.equal(actual,owner);assert.equal(gate.complete(owner,record,true),false);});
  assert.equal(gate.complete(owner,record,true),false);owner.close();owner.lease('working','control',20);assert.equal(gate.complete(owner,record,true),false);owner.release('working');assert.equal(gate.complete(owner,record,false),false);assert.equal(gate.complete(owner,record,true),true);assert.equal(gate.complete(owner,record,true),false);assert.equal(transfers,1);assert.equal(owner.held('history:monitor'),40);checks.push('sealed settled owner transfers exactly once with reentrant rejection and failed prefix preserved');
  const source:Source={...record.sources.uplink,bins:[],origin:null,final:null,total:{...record.sources.uplink.total},initialQuantum:null,targetBinFrames:null,stopped:false};
  const faults:string[]=[],commands:unknown[]=[];const port:OwnedPort={onmessage:null,postMessage(value:unknown){commands.push(value);},close(){}};
  const node={port,onprocessorerror:null as AudioWorkletNode['onprocessorerror']};const observer=new Stage2Observer(node,source,'generator',reason=>faults.push(reason),()=>{});
  const deliver=(data:unknown)=>port.onmessage?.(new MessageEvent('message',{data}));
  deliver({type:'imagined-success'});deliver({type:'mark',markerId:'not-sent',command:'start',phase:'qualified',position:{}});assert.equal(observer.rejected,2);assert.equal(faults.length,2);
  const marker=observer.mark('pending','start');observer.close();await assert.rejects(marker,/media stopped/);assert.equal(observer.pendingCount,0);assert.equal(port.onmessage,null);checks.push('owned port rejects forged messages and cancels pending markers on close');
  interface Processor{process(inputs:Float32Array[][],outputs:Float32Array[][]):boolean;port:{onmessage:((e:{data:unknown})=>void)|null}}
  let Type:(new(options:{processorOptions:{mode:string}})=>Processor)|undefined,frame=12037;const messages:unknown[]=[];
  class Base{port={onmessage:null as Processor['port']['onmessage'],postMessage(message:unknown){messages.push(structuredClone(message));}};}
  runInNewContext(STAGE2_WORKLET_SOURCE,{AudioWorkletProcessor:Base,Float64Array,Float32Array,get currentFrame(){return frame;},get currentTime(){return frame/48000;},sampleRate:48000,registerProcessor(_name:string,constructor:new(options:{processorOptions:{mode:string}})=>Processor){Type=constructor;}});
  assert.ok(Type);const processor=new Type({processorOptions:{mode:'generator'}});const retained:Source={...source,total:{...source.total},bins:[]};let cursor=0;const binBytes=new Stage2Budget(1,0),numericFaults:string[]=[];
  const actualPort:OwnedPort={onmessage:null,postMessage(data:unknown){processor.port.onmessage?.({data});},close(){}};const observed=new Stage2Observer({port:actualPort,onprocessorerror:null},retained,'generator',reason=>numericFaults.push(reason),()=>{},binBytes);
  for(let i=0;i<188;i++){processor.process([],[[new Float32Array(128)]]);frame+=128;while(cursor<messages.length)actualPort.onmessage?.(new MessageEvent('message',{data:messages[cursor++]}));}
  assert.equal(retained.bins.length,0);assert.equal(binBytes.audit().rejectedReservations,1);assert.ok(numericFaults.some(reason=>reason.includes('budget-exhausted')));
  const invalid={type:'first',total:{...retained.total,frames:127.5},position:retained.final};actualPort.onmessage?.(new MessageEvent('message',{data:invalid}));assert.ok(numericFaults.some(reason=>reason.includes('cumulative counter/position')));observed.close();checks.push('actual public processor messages obey history reservation and fractional-counter validation');
  return {schema:'openclinxr-stage2-control-validation.v1',scope:'offline-host-contract-only',passed:checks.length,checks,notEvidenceFor:['Quest readiness','physical audio','network performance','clinical validity']};
 }finally{globalThis.fetch=originalFetch;}
}
if(process.argv[1]&&realpathSync(fileURLToPath(import.meta.url))===realpathSync(process.argv[1])){console.log(JSON.stringify(await validateStage2ControlContract(),null,2));}
