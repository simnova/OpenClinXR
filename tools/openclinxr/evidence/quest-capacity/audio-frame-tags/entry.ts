/// <reference lib="dom" />
import {CONFIG, type NodeRecord, type Role} from '@openclinxr/xr-capacity/audio-frame-tags';
import {encodeNodes, NUMERIC_BOUNDS, countMetadataScalars} from '@openclinxr/xr-capacity/audio-frame-tags';
import {closeGraph} from '@openclinxr/xr-capacity/audio-frame-tags';

interface Metadata {bundleSha256:string;workletSha256:string;protocolSha256:string;clarificationsSha256:string}
const metadata: Metadata = JSON.parse(document.querySelector('#audio-tags-metadata')!.textContent!);
const status = document.querySelector('#status')!, start = document.querySelector<HTMLButtonElement>('#start')!;
const nonce = new URL(location.href).searchParams.get('nonce');
if (!nonce || !/^[a-zA-Z0-9-]{8,80}$/.test(nonce)) throw Error('Explicit bounded external nonce required');
let resolveClosed: (value: unknown) => void;
const closed = new Promise(resolve => {resolveClosed=resolve;});
const api = {identity:{...metadata,nonce},closed};
Object.assign(window,{audioFrameTags:api});
function deferred<T>() {let resolve!: (value:T)=>void;return {promise:new Promise<T>(done=>{resolve=done;}),resolve};}
async function until<T>(promise:Promise<T>,deadline:number):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Bounded setup/drain deadline exceeded')),Math.max(0,deadline-performance.now()));})]);}
  finally {if(timer)clearTimeout(timer);}
}
async function run() {
  const requestedAt=performance.now(), errors:string[]=[], events:Array<{kind:string;at:number}>=[];
  let context:AudioContext|null=null,url:string|null=null,graphTimer:ReturnType<typeof setTimeout>|undefined;
  let enabledAt:number|null=null,stopRequestedAt:number|null=null,preludeAt:number|null=null;
  let producerCreatedAt:number|null=null,producerConnectedAt:number|null=null,preludeCallbacks:number|null=null;
  let stopTag:number|null=null,stopping=false,numericPayload:string|null=null;
  const nodes:AudioWorkletNode[]=[],finals:Partial<Record<Role,NodeRecord>>={};
  const checkerFinal=deferred<void>(),producerFinal=deferred<void>(),prelude=deferred<void>(),stopped=deferred<void>();
  const event=(kind:string)=>{if(events.length<16)events.push({kind,at:performance.now()});else if(!errors.includes('Event bound exceeded'))errors.push('Event bound exceeded');};
  const stop=()=>{if(stopping)return;stopping=true;stopRequestedAt=performance.now();stopped.resolve();};
  const visibility=()=>event(`visibility:${document.visibilityState}`);
  let contextFacts:unknown=null,cleanup:Awaited<ReturnType<typeof closeGraph>>|null=null;
  document.addEventListener('visibilitychange',visibility);
  try {
    const fetched=await fetch('./frame-tags-worklet.js',{cache:'no-store'}),bytes=await fetched.arrayBuffer();
    if(!fetched.ok||bytes.byteLength>16384)throw Error('Bounded worklet fetch failed');
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
    if(actual!==metadata.workletSha256)throw Error('Actual fetched worklet hash mismatch');
    context=new AudioContext({sampleRate:CONFIG.sampleRate,latencyHint:'interactive'});
    context.onstatechange=()=>event(`context:${context?.state}`);
    await until(context.suspend(),requestedAt+5000);
    url=URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));
    await until(context.audioWorklet.addModule(url),requestedAt+5000);URL.revokeObjectURL(url);url=null;
    contextFacts={requestedSampleRate:CONFIG.sampleRate,actualSampleRate:context.sampleRate,latencyHintRequested:'interactive',baseLatency:context.baseLatency,outputLatency:context.outputLatency??null,backend:'Actual browser backend not independently identified; headless output is software evidence only.'};
    function make(role:Role) {
      const node=new AudioWorkletNode(context!,`quest-frame-tags-${role}-v1`,{numberOfInputs:role==='checker'?1:0,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit',processorOptions:{role,stopTag}});
      nodes.push(node);
      node.onprocessorerror=()=>{errors.push(`${role} processorerror`);stop();};
      node.port.onmessage=e=>{
        const data=e.data;
        if(data.kind==='prelude'&&role==='checker'&&!stopping){preludeAt=performance.now();preludeCallbacks=data.callbacks;stopTag=data.stopTag;prelude.resolve();}
        if(data.kind==='final'){
          const r=data.record as NodeRecord;
          const view=new Float64Array(data.buffer as ArrayBuffer);
          if(view.byteLength!==(role==='checker'?CONFIG.checkerTuples:CONFIG.producerTuples)*CONFIG.tupleWidth*8||r.tupleRows>r.tupleLimit){errors.push('Tuple buffer/cap mismatch');stop();return;}
          r.tuples=Array.from(view.subarray(0,r.tupleRows*CONFIG.tupleWidth));finals[role]=r;
          (role==='checker'?checkerFinal:producerFinal).resolve();
        }
      };
      return node;
    }
    const checker=make('checker');
    // This is the first action that can enable checker processing; the timer is not reset later.
    enabledAt=performance.now();graphTimer=setTimeout(stop,CONFIG.acquisitionTargetMs);checker.connect(context.destination);
    event('resume-request');await until(context.resume(),enabledAt+CONFIG.acquisitionMs);event('resume-resolved');
    await Promise.race([prelude.promise,stopped.promise]);
    if(!stopping){
      if(preludeCallbacks!==CONFIG.preludeCallbacks)throw Error('Actual32-callback prelude missing');
      checker.port.postMessage('activate');producerCreatedAt=performance.now();const producer=make('producer');
      producer.connect(checker);producerConnectedAt=performance.now();event('producer-connected-only-to-checker');
    }
    await stopped.promise;
    for(const node of nodes)node.port.postMessage('stop');
    await until(Promise.all([checkerFinal.promise,...(nodes.length===2?[producerFinal.promise]:[])]),stopRequestedAt!+CONFIG.drainMs);
  } catch(error) {errors.push(String(error));stop();for(const node of nodes)try{node.port.postMessage('stop');}catch{errors.push('Stop send failed');}}
  finally {
    if(graphTimer)clearTimeout(graphTimer);document.removeEventListener('visibilitychange',visibility);
    if(context)context.onstatechange=null;
    cleanup=await closeGraph(nodes,context,(stopRequestedAt??performance.now())+CONFIG.drainMs);
    if(url)URL.revokeObjectURL(url);
  }
  try {numericPayload=encodeNodes(finals.producer??null,finals.checker??null);}catch(error){errors.push(String(error));}
  const drainObservedMs=stopRequestedAt===null?null:performance.now()-stopRequestedAt;
  if(enabledAt!==null&&stopRequestedAt!==null&&stopRequestedAt-enabledAt>CONFIG.acquisitionMs)errors.push('Observed acquisition exceeded2s maximum');
  if(drainObservedMs!==null&&drainObservedMs>CONFIG.drainMs)errors.push('Observed drain exceeded1s maximum');
  const final={schema:'quest-audio-frame-tags-browser.v1',identity:api.identity,scope:'Standalone HOST SYNTHETIC ONLY; no physical latency/delivery/capacity or old-source qualification.',context:contextFacts,
    environment:{userAgent:navigator.userAgent,platform:navigator.platform,secureContext:window.isSecureContext,timeOriginMs:performance.timeOrigin},
    requestedAt,enabledAt,stopRequestedAt,preludeAt,preludeCallbacks,producerCreatedAt,producerConnectedAt,events,
    mainClock:'performance.now asynchronous brackets, distinct from shared Worklet currentFrame/currentTime timeline',
    graphObservedMs:enabledAt===null||stopRequestedAt===null?null:stopRequestedAt-enabledAt,drainObservedMs,
    numericBoundsRef:'source-manifest.json#numericBounds',cleanup,errors,numericPayload};
  if(countMetadataScalars(final)>NUMERIC_BOUNDS.scalarSlots.mainAndDriverMetadata){errors.push('Main metadata scalar reservation exceeded');final.numericPayload=null;}
  // Drop application-owned raw tuple references before the sole bounded final handoff; no heap/GC claim.
  delete finals.producer;delete finals.checker;nodes.length=0;
  status.textContent=errors.length?'Diagnostic closed with retained failures.':'Diagnostic closed. Offline review required.';
  resolveClosed!(final);
}
start.addEventListener('click',()=>{start.disabled=true;status.textContent='Running silent diagnostic…';void run().catch(error=>{status.textContent='Diagnostic failed';resolveClosed!({schema:'quest-audio-frame-tags-browser.v1',identity:api.identity,errors:[String(error)],numericPayload:null,cleanup:null});});},{once:true});
