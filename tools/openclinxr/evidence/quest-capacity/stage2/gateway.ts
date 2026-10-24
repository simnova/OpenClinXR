import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { open, stat, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { createConnection } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGE2_CONFIG } from '@openclinxr/xr-capacity/stage2';
import type { ReservationAudit, Stage2Identity } from '@openclinxr/xr-capacity/stage2';
import { KnownBudget } from './memory.js';
const here=dirname(fileURLToPath(import.meta.url));
export const SERVER_FILES=['bindings.py','gateway.ts','health.py','memory.py','memory.ts','peer.py','peer_media.py','server.py'] as const;
export const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const sourceDigest=(files:Record<string,string>)=>sha(JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0))));
export interface ServerReady {origin:string;pid:number;clockId:string;pythonVersion:string;aiortcVersion:string;avVersion:string;aiohttpVersion:string;serverSourceSha256:string}
export interface GatewayClose {ownedProcesses:number;ownedListeners:number;pendingRequests:number;childExitCode:number|null;childSignal:string|null;childReceipt:unknown;confirmed:boolean;gatewayPortClosed:boolean|null;pythonPortClosed:boolean;stderr:string;reservation:ReservationAudit}
export class GatewayStartError extends Error {constructor(message:string,readonly cleanup:GatewayClose){super(message);this.name='GatewayStartError';}}
export interface Stage2Gateway {origin:string;ready:ServerReady;interfaces:Array<{name:string;address:string;family:string}>;budget:KnownBudget;close():Promise<GatewayClose>}
export async function fileHash(path:string,budget=new KnownBudget(65536)) {
  const lease=budget.reserve('file-hash-chunk',4096),file=await open(path,'r');
  try {const bytes=Buffer.alloc(4096),hash=createHash('sha256');for(;;){const {bytesRead}=await file.read(bytes,0,bytes.length,null);if(!bytesRead)break;hash.update(bytes.subarray(0,bytesRead));}return hash.digest('hex');}
  finally {await file.close();budget.release(lease);}
}
export async function serverSources(budget?:KnownBudget){const result:Record<string,string>={};for(const name of SERVER_FILES)result[name]=await fileHash(join(here,name),budget);return result;}
async function boundedText(path:string,budget:KnownBudget){const size=(await stat(path)).size;if(size>24576)throw new Error('Metadata cap');const lease=budget.reserve('metadata-read-text-parse',size*3),file=await open(path,'r');try{const bytes=Buffer.alloc(size);let at=0;while(at<size){const {bytesRead}=await file.read(bytes,at,size-at,at);if(!bytesRead)throw new Error('Short metadata read');at+=bytesRead;}return {value:JSON.parse(bytes.toString('utf8')) as {identity:Stage2Identity;served:Record<string,string>},lease};}catch(error){budget.release(lease);throw error;}finally{await file.close();}}
async function body(request:IncomingMessage,budget:KnownBudget){
  const chunks:Buffer[]=[],leases:symbol[]=[];let size=0;
  try {for await(const part of request){const bytes=part as Buffer;if(size+bytes.length>65536)throw new Error('control body cap');leases.push(budget.reserve('request-chunk',bytes.length));chunks.push(bytes);size+=bytes.length;}
    const joined=budget.reserve('request-joined',size);let bytes:Buffer;try{bytes=Buffer.concat(chunks,size);}catch(error){budget.release(joined);throw error;}chunks.length=0;return {bytes,lease:joined};
  }finally{for(const lease of leases)budget.release(lease);}
}
async function streamFile(path:string,response:ServerResponse,budget:KnownBudget){
  const lease=budget.reserve('static-disk-chunk',4096),file=await open(path,'r');
  try{const bytes=Buffer.alloc(4096);for(;;){const {bytesRead}=await file.read(bytes,0,bytes.length,null);if(!bytesRead)break;await new Promise<void>((yes,no)=>response.write(bytes.subarray(0,bytesRead),error=>error?no(error):yes()));}response.end();}
  finally{await file.close();budget.release(lease);}
}
async function forwardBackend(response:ServerResponse,origin:string,path:string,bodyBytes:Buffer,budget:KnownBudget,signal:AbortSignal){
  // node:http owns its transport buffering; this application adopts at most4096B
  // with read(4096), after reserving that working set. No full response buffer.
  const readLease=budget.reserve('backend-response-chunk',4096);
  try{await new Promise<void>((yes,no)=>{
    const backend=httpRequest(`${origin}${path}`,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':bodyBytes.length},signal},incoming=>{
      const job=(async()=>{let seen=0;const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store'};const length=incoming.headers['content-length'];if(typeof length==='string')headers['Content-Length']=length;response.writeHead(incoming.statusCode??502,headers);
        for(;;){if(signal.aborted)throw signal.reason;const bytes=incoming.read(4096) as Buffer|null;if(bytes===null){if(incoming.readableEnded)break;await new Promise<void>((ready,failed)=>{const clean=()=>{incoming.removeListener('readable',onReady);incoming.removeListener('end',onReady);incoming.removeListener('error',onError);};const onReady=()=>{clean();ready();};const onError=(error:Error)=>{clean();failed(error);};incoming.once('readable',onReady);incoming.once('end',onReady);incoming.once('error',onError);});continue;}
          seen+=bytes.length;if(seen>65536)throw new Error('backend response body cap');await new Promise<void>((done,failed)=>response.write(bytes,error=>error?failed(error):done()));
        }response.end();})();void job.then(yes,error=>{incoming.destroy();no(error);});
    });backend.once('error',no);backend.end(bodyBytes);
  });}finally{budget.release(readLease);}
}
async function portClosed(origin:string){const port=Number(new URL(origin).port);return new Promise<boolean>(done=>{const socket=createConnection({host:'127.0.0.1',port});let settled=false;const finish=(closed:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);socket.removeAllListeners();socket.destroy();done(closed);};const timer=setTimeout(()=>finish(false),250);socket.once('connect',()=>finish(false));socket.once('error',(error:NodeJS.ErrnoException)=>finish(error.code==='ECONNREFUSED'));});}
async function childStart(python:string,specification:string,budget:KnownBudget,signal?:AbortSignal){
  if(signal?.aborted)throw signal.reason;const child=spawn(python,[join(here,'server.py'),'--specification',specification],{cwd:here,env:{...process.env,OPENCLINXR_WORKER:'1',PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});
  const logs=budget.reserve('child-log-buffers',8192);let stdout=Buffer.alloc(4096),stderr=Buffer.alloc(4096);let stdoutAt=0,stderrAt=0,receipt:unknown=null,overflow=false;
  const exit=new Promise<{code:number|null;signal:string|null}>(yes=>child.once('exit',(code,term)=>yes({code,signal:term})));
  let settle:(value:ServerReady)=>void=()=>undefined,reject:(error:Error)=>void=()=>undefined;const ready=new Promise<ServerReady>((yes,no)=>{settle=yes;reject=no;});
  const parse=(line:Buffer)=>{const lease=budget.reserve('child-log-text-and-parsed',line.length*2);try{const data=JSON.parse(line.toString('utf8')) as ServerReady&{closed?:boolean};if(data.closed){budget.reserve('retained-child-close-metadata',line.length,true);receipt=data;}else if(data.origin&&data.pid&&data.clockId){budget.reserve('retained-child-ready-metadata',line.length,true);settle(data);}}finally{budget.release(lease);}};
  const data=(bytes:Buffer,output:boolean)=>{let lease:symbol|undefined;try{lease=budget.reserve('child-log-incoming',bytes.length);if((output?stdoutAt:stderrAt)+bytes.length>4096)throw new Error('child log cap');if(output){bytes.copy(stdout,stdoutAt);stdoutAt+=bytes.length;for(;;){const end=stdout.subarray(0,stdoutAt).indexOf(10);if(end<0)break;parse(stdout.subarray(0,end));stdout.copyWithin(0,end+1,stdoutAt);stdoutAt-=end+1;}}else{bytes.copy(stderr,stderrAt);stderrAt+=bytes.length;}}catch(error){overflow=true;reject(new Error(String(error)));child.kill('SIGTERM');}finally{if(lease)budget.release(lease);}};
  child.stdout.on('data',bytes=>data(bytes,true));child.stderr.on('data',bytes=>data(bytes,false));child.once('error',reject);child.once('exit',()=>reject(new Error('child exited before ready; bounded stderr retained')));
  const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{reject(new Error('child ready deadline'));child.kill('SIGTERM');},5000);
  const dispose=()=>{signal?.removeEventListener('abort',abort);child.stdout.removeAllListeners();child.stderr.removeAllListeners();stdout=Buffer.alloc(0);stderr=Buffer.alloc(0);budget.release(logs);};
  try{return {child,ready:await ready,exit,stderr:()=>stderr.subarray(0,stderrAt).toString('utf8'),receipt:()=>receipt,overflow:()=>overflow,dispose};}
  catch(error){child.kill('SIGTERM');await childExit(child,exit,2000);dispose();throw error;}finally{clearTimeout(timer);}
}
async function childExit(child:ChildProcessWithoutNullStreams,exit:Promise<{code:number|null;signal:string|null}>,ms:number){let timer:ReturnType<typeof setTimeout>|undefined;const force=setTimeout(()=>child.kill('SIGKILL'),Math.max(1,ms-250));try{return await Promise.race([exit,new Promise<never>((_,no)=>{timer=setTimeout(()=>no(new Error('owned child exit unconfirmed')),ms);})]);}finally{clearTimeout(force);if(timer)clearTimeout(timer);}}
export async function startStage2Gateway(options:{dist:string;python:string;jobDirectory:string;port?:number;signal?:AbortSignal;budget?:KnownBudget}):Promise<Stage2Gateway>{
  if(options.port===54245)throw new Error('54245 reserved for Quest');if(options.signal?.aborted)throw options.signal.reason;
  const budget=options.budget??new KnownBudget(65536),dist=resolve(options.dist);const parsed=await boundedText(join(dist,'source-manifest.json'),budget);const {identity,served}=parsed.value;parsed.value={identity,served};
  const metadata=budget.reserve('static-hash-metadata',Buffer.byteLength(JSON.stringify({identity,served})),true);budget.release(parsed.lease);
  if(sha(JSON.stringify(STAGE2_CONFIG))!==identity.fixtureConfigSha256)throw new Error('fixture config identity mismatch');const actualSources=await serverSources(budget);if(sourceDigest(actualSources)!==identity.serverSourceSha256)throw new Error('server source identity mismatch');
  for(const [name,expected]of Object.entries(served)){if(name.includes('/')||name.includes('..'))throw new Error('invalid static file name');if(await fileHash(join(dist,name),budget)!==expected)throw new Error(`served hash mismatch: ${name}`);}
  const interfaces=Object.entries(networkInterfaces()).flatMap(([name,values])=>(values??[]).map(value=>({name,address:value.address,family:value.family})));
  const specification=join(options.jobDirectory,'server-specification.json'),spec={identity,config:STAGE2_CONFIG,serverSourceFiles:actualSources,inventoryAddresses:interfaces.map(item=>item.address)};
  const specSize=Buffer.byteLength(JSON.stringify(spec)),specLease=budget.reserve('specification-text-write',specSize*2);try{await writeFile(specification,JSON.stringify(spec),{mode:0o600});}finally{budget.release(specLease);}
  const runtime=await childStart(options.python,specification,budget,options.signal);let pending=0,queued=0,closing:Promise<GatewayClose>|null=null,ownedOrigin:string|null=null;const requests=new Set<AbortController>();
  const handlers=new Set<Promise<void>>();
  const handle=async(request:IncomingMessage,response:ServerResponse)=>{
    try{const path=new URL(request.url??'/','http://127.0.0.1').pathname;
      if(request.method==='GET'){const name=path==='/'?'index.html':path.slice(1);if(!Object.hasOwn(served,name)){response.writeHead(404).end();return;}response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html');response.setHeader('Cache-Control','no-store');response.setHeader('x-stage2-sha256',served[name]??'');response.setHeader('Content-Length',(await stat(join(dist,name))).size);await streamFile(join(dist,name),response,budget);return;}
      if(request.method!=='POST'||!Object.values(STAGE2_CONFIG.routes).some(value=>value===path)){response.writeHead(404).end();return;}
      // Serial controls are a tighter admission policy, not a claim that cap4 means four large bodies fit.
      if(pending>0){response.writeHead(429).end('serial control admission');return;}
      pending++;let bodyLease:symbol|undefined,length=0;const abort=new AbortController();requests.add(abort);const timer=setTimeout(()=>abort.abort(new Error('control deadline')),22000);
      try{const read=await body(request,budget);bodyLease=read.lease;length=read.bytes.length;queued+=length;if(queued>262144)throw new Error('control queue cap');const fetchCopy=budget.reserve('fetch-request-copy',length);
        try{await forwardBackend(response,runtime.ready.origin,path,read.bytes,budget,abort.signal);}finally{budget.release(fetchCopy);}
      }finally{clearTimeout(timer);requests.delete(abort);pending--;queued-=length;if(bodyLease)budget.release(bodyLease);}
    }catch(error){if(response.headersSent){response.destroy(new Error(String(error)));}else response.writeHead(400).end(String(error).slice(0,256));}
  };
  const server=createServer((request,response)=>{const job=handle(request,response);handlers.add(job);void job.then(()=>handlers.delete(job),()=>handlers.delete(job));});
  const close=()=>closing??=(async()=>{let listenerClosed=false,forced=false;for(const request of requests)request.abort(new Error('gateway closing'));const listener=new Promise<void>(done=>server.close(()=>{listenerClosed=true;done();}));server.closeAllConnections();
    runtime.child.kill('SIGTERM');let code:number|null=null,signal:string|null=null;try{const result=await childExit(runtime.child,runtime.exit,2500);code=result.code;signal=result.signal;}catch{forced=true;}
    await Promise.allSettled([listener,...handlers]);server.removeAllListeners();
    const receipt=runtime.receipt() as {closed?:boolean;ownedPeers?:number;ownedTasks?:number;ownedListeners?:number;pendingControls?:number;queuedControlBytes?:number}|null;
    const gatewayPortClosed=ownedOrigin===null?null:await portClosed(ownedOrigin),pythonPortClosed=await portClosed(runtime.ready.origin);const logCopy=budget.reserve('close-log-text-copy',8192,true);const stderr=runtime.stderr();budget.resize(logCopy,stderr.length*2);runtime.dispose();budget.release(metadata);budget.seal();
    const confirmed=gatewayPortClosed!==false&&pythonPortClosed&&!forced&&!runtime.overflow()&&listenerClosed&&code===0&&receipt?.closed===true&&receipt.ownedPeers===0&&receipt.ownedTasks===0&&receipt.ownedListeners===0&&receipt.pendingControls===0&&receipt.queuedControlBytes===0&&pending===0&&queued===0;
    const result={ownedProcesses:runtime.child.exitCode===null&&runtime.child.signalCode===null?1:0,ownedListeners:server.listening?1:0,pendingRequests:pending,childExitCode:code,childSignal:signal,childReceipt:receipt,confirmed,gatewayPortClosed,pythonPortClosed,stderr,reservation:budget.audit()};void logCopy;return result;
  })();
  const abort=()=>{void close();};options.signal?.addEventListener('abort',abort,{once:true});
  try{if(options.signal?.aborted)throw options.signal.reason;await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(options.port??0,'127.0.0.1',()=>{server.removeListener('error',no);yes();});});}
  catch(error){const cleanup=await close();throw new GatewayStartError(String(error),cleanup);}
  const address=server.address();if(!address||typeof address==='string'){await close();throw new Error('expected owned TCP address');}ownedOrigin=`http://127.0.0.1:${address.port}`;
  return {origin:ownedOrigin,ready:runtime.ready,interfaces,budget,close:async()=>{options.signal?.removeEventListener('abort',abort);return await close();}};
}
