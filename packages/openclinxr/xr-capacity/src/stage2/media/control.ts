import {STAGE2_CONFIG} from '../grading/config.js';
import {Stage2Budget,stage2JsonBytes} from './budget.js';
export interface Stage2ControlReply {body:unknown;release():void}
export interface Stage2AssetReply {bytes:ArrayBuffer;release():void}
export class Stage2Control {
 active=0;queuedBytes=0;maximumConcurrent=0;maximumQueuedBytes=0;rejected=0;private serial=0;
 constructor(readonly origin:string,readonly budget=new Stage2Budget()){}
 get maximumOwnedBytes():number {return this.budget.audit().categoryPeaks['control']??0;}
 async post(route:string,body:unknown,signal:AbortSignal):Promise<Stage2ControlReply>{
  if(this.budget.audit().closed&&route!==STAGE2_CONFIG.routes.stats&&route!==STAGE2_CONFIG.routes.close)this.budget.claim('post-seal-control','control',0);
  const closing=route===STAGE2_CONFIG.routes.close,cap=closing?4096:STAGE2_CONFIG.bounds.maximumControlBodyBytes,key=`request:${++this.serial}`;
  const size=stage2JsonBytes(body);if(size>cap||this.active>=4||this.queuedBytes+size>262144){this.rejected++;throw Error('control budget exceeded');}
  let counted=false,parsedHeld=false;
  try{
   this.budget.lease(`${key}:text`,'control',2*size,closing);this.budget.lease(`${key}:encoded`,'control',size,closing);
   let text:string|undefined=JSON.stringify(body);const encoded=new TextEncoder().encode(text);text=undefined;this.budget.release(`${key}:text`);
   this.active++;counted=true;this.queuedBytes+=size;this.maximumConcurrent=Math.max(this.maximumConcurrent,this.active);this.maximumQueuedBytes=Math.max(this.maximumQueuedBytes,this.queuedBytes);
   const response=await fetch(new URL(route,this.origin),{method:'POST',body:encoded,headers:{'Content-Type':'application/json'},signal});const bytes=await this.read(response,cap,key,closing);
   this.budget.lease(`${key}:decoded`,'control',bytes.byteLength*2,closing);let decoded:string|undefined=new TextDecoder().decode(bytes);
   if(!response.ok)throw Error(`control ${route} HTTP${response.status}: ${decoded.slice(0,256)}`);
   this.budget.lease(`${key}:parsed`,'control',bytes.byteLength,closing);parsedHeld=true;const value:unknown=JSON.parse(decoded);decoded=undefined;this.budget.release(`${key}:decoded`);
   let released=false;const reply:Stage2ControlReply={body:value,release:()=>{if(!released){released=true;reply.body=null;this.budget.release(`${key}:parsed`);}}};return reply;
  }catch(error){if(parsedHeld)this.budget.release(`${key}:parsed`);throw error;}
  finally{for(const part of ['text','encoded','decoded','store','chunk'])this.budget.release(`${key}:${part}`);if(counted){this.active--;this.queuedBytes-=size;}}
 }
 async asset(url:URL,signal:AbortSignal):Promise<Stage2AssetReply>{if(this.active>=4){this.rejected++;throw Error('control budget exceeded');}this.active++;this.maximumConcurrent=Math.max(this.maximumConcurrent,this.active);const key=`asset:${++this.serial}`;try{const response=await fetch(url,{signal});if(!response.ok)throw Error('worklet fetch failed');const bytes=await this.read(response,32768,key,false);this.budget.claim(`${key}:result`,'source-asset',bytes.byteLength);const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;let released=false;return {bytes:buffer,release:()=>{if(!released){released=true;this.budget.release(`${key}:result`);}}};}finally{this.budget.release(`${key}:store`);this.budget.release(`${key}:chunk`);this.active--;}}
 private async read(response:Response,cap:number,key:string,closing:boolean):Promise<Uint8Array>{
  const header=response.headers.get('Content-Length'),declared=header===null?null:Number(header);if(!response.body||(declared!==null&&(!Number.isSafeInteger(declared)||declared<0||declared>cap)))throw Error('control body exceeds bound');
  const capacity=declared??cap;this.budget.lease(`${key}:store`,'control',capacity,closing);this.budget.lease(`${key}:chunk`,'control',capacity,closing);const store=new Uint8Array(capacity);let used=0;const reader=response.body.getReader();
  try{for(;;){const part=await reader.read();if(part.done)break;if(used+part.value.byteLength>capacity){await reader.cancel();throw Error('control body exceeds bound');}store.set(part.value,used);used+=part.value.byteLength;}if(declared!==null&&used!==declared)throw Error('control body length mismatch');return store.subarray(0,used);}finally{this.budget.release(`${key}:chunk`);reader.releaseLock();}
 }
}
export async function stage2Sha256(bytes:ArrayBuffer):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
