import { runStage2Media } from '@openclinxr/xr-capacity/stage2';
import type {Stage2Budget} from '@openclinxr/xr-capacity/stage2';
import { KnownBudget } from './memory.js';
import { PostCloseExport, type ExportAck, type ExportUnit } from './export.js';
import type { Stage2RunRecord, Stage2RunRelease } from '@openclinxr/xr-capacity/stage2';
export interface Stage2HostApi {
  verifySources(expected:Record<string,string>):Promise<Record<string,string>>;
  configure(release: Stage2RunRelease, driverStartedMs: number): void;
  start(): void; stop(reason?: string): void;
  readonly closed: Promise<{outcome:string;reason:string|null;nonce:string}>;
  beginExport(): void; nextExport():Promise<ExportUnit>; ackExport(ack:ExportAck):void;
  exportSnapshot():ReturnType<PostCloseExport['snapshot']>&{precontextStatic:ReturnType<KnownBudget['audit']>};
  readonly state: string;
}
interface Metadata { identity: Stage2RunRelease['identity']; workletSha256: string }
const tag = document.querySelector('#stage2-metadata');
if (!tag?.textContent) throw new Error('Missing bounded source metadata');
const metadata = JSON.parse(tag.textContent) as Metadata;
const status = document.querySelector('#stage2-status'), start = document.querySelector<HTMLButtonElement>('#stage2-start');
const abort = new AbortController(); let release: Stage2RunRelease | null = null, driverStartedMs = 0, state = 'unconfigured', invoked = false;
let finalRecord:Stage2RunRecord|null=null, exporter:PostCloseExport|null=null, ownerBudget:Stage2Budget|null=null;
const staticBudget=new KnownBudget(655360);
let resolveClosed: (record: {outcome:string;reason:string|null;nonce:string}) => void, rejectClosed: (error: unknown) => void;
const closed = new Promise<{outcome:string;reason:string|null;nonce:string}>((yes, no) => { resolveClosed = yes; rejectClosed = no; });
void closed.catch(() => undefined);
function show(value: string) { state = value; if (status) status.textContent = value; }
const api: Stage2HostApi = {
  async verifySources(expected){
    if(invoked||state!=='unconfigured')throw new Error('Static byte verification is pre-workload only');const observed:Record<string,string>={};
    for(const [name,wanted]of Object.entries(expected)){if(!/^[a-z0-9.-]+$/.test(name))throw new Error('Static name');const response=await fetch(name,{cache:'no-store'});const size=Number(response.headers.get('content-length'));if(!response.ok||!Number.isSafeInteger(size)||size<=0||size>131072)throw new Error('Bounded static Content-Length required');
      const lease=staticBudget.reserve('precontext-static-bytes-and-digest-copies',size*3);const reader=response.body?.getReader();if(!reader)throw new Error('Static body required');
      try{const chunks:Uint8Array[]=[];let length=0;for(;;){const next=await reader.read();if(next.done)break;if(length+next.value.length>size)throw new Error('Static streamed byte cap');chunks.push(next.value);length+=next.value.length;}if(length!==size)throw new Error('Static byte length mismatch');const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}chunks.length=0;observed[name]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(observed[name]!==wanted)throw new Error('Actual fetched bytes mismatch');}
      finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();staticBudget.release(lease);}
    }staticBudget.seal();return observed;
  },
  configure(value, started) {
    if (state !== 'unconfigured' || JSON.stringify(value.identity) !== JSON.stringify(metadata.identity) || !Number.isFinite(started)) throw new Error('Single matching source-bound release required');
    if (value.expectedEnvironment.browser.timeOriginMs !== performance.timeOrigin || value.expectedEnvironment.signalingOrigins[0] !== location.origin) throw new Error('Release page/clock/origin mismatch');
    release = value; driverStartedMs = started; show(`Configured ${value.mode}; nonce ${value.binding.runNonce}; HOST SYNTHETIC ONLY`); if (start) start.disabled = false;
  },
  start() {
    if (!release || invoked || abort.signal.aborted) throw new Error('Configure once before trusted start');
    if(!staticBudget.audit().closed||staticBudget.audit().heldBytesAtClose!==0)throw new Error('Pre-context verification leases must be zero before factory birth');
    invoked = true; if (start) start.disabled = true; show(`Running ${release.mode}; nonce ${release.binding.runNonce}`);
    // Factory is invoked synchronously by the trusted click; it owns actual AudioContext admission.
    const job = runStage2Media({release,gatewayOrigin:location.origin,workletUrl:new URL('./stage2-worklet.js',location.href).href,expectedWorkletSha256:metadata.workletSha256,driverStartedMs,signal:abort.signal,onOwnerTransfer:budget=>{ownerBudget=budget;}});
    void job.then(record => { finalRecord=record; detach(); show(JSON.stringify({outcome:record.outcome,reason:record.reason,nonce:record.binding.runNonce,uplinkDecoded:{frames:record.decoded.uplink.total.frames,sampleRate:record.decoded.uplink.sampleRate},downlinkDecoded:{frames:record.decoded.downlink.total.frames,sampleRate:record.decoded.downlink.sampleRate},clientWindow:record.clientWindow,verdict:'Independent post-close grading pending'},null,2)); resolveClosed({outcome:record.outcome,reason:record.reason,nonce:record.binding.runNonce}); }, error => { detach(); show(`Failed: ${String(error)}`); rejectClosed(error); });
  },
  beginExport() {
    if(!finalRecord||exporter)throw new Error('Post-close export requires exactly one settled factory record');
    if(!ownerBudget)throw new Error('Actual completed browser allocator not transferred');
    exporter=new PostCloseExport(finalRecord,ownerBudget);
  },
  nextExport(){if(!exporter)throw new Error('Export not begun');return exporter.next();},
  ackExport(ack){if(!exporter)throw new Error('Export not begun');exporter.ack(ack);},
  exportSnapshot(){if(!exporter)throw new Error('Export not begun');return {...exporter.snapshot(),precontextStatic:staticBudget.audit()};},
  stop(reason = 'explicit stop') { abort.abort(reason); },
  get closed() { return closed; }, get state() { return state; },
};
(window as unknown as {stage2Host: Stage2HostApi}).stage2Host = api;
const stop = document.querySelector('#stage2-stop');
const startClick = () => api.start(), stopClick = () => api.stop();
function detach() { start?.removeEventListener('click', startClick); stop?.removeEventListener('click', stopClick); }
start?.addEventListener('click', startClick, {once:true});
stop?.addEventListener('click', stopClick);
