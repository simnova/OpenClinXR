import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium,type Browser,type Page,type CDPSession} from 'playwright';
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import {startStatic} from './serve.js';
import {classify} from '@openclinxr/xr-capacity/audio-frame-tags';
import {decodeNodes,countMetadataScalars,NUMERIC_BOUNDS} from '@openclinxr/xr-capacity/audio-frame-tags';
import {CONFIG} from '@openclinxr/xr-capacity/audio-frame-tags';
import {deadlineStep,ownedCloseConfirmed,requireBrowserCommandIdentity,type OperationState} from '@openclinxr/xr-capacity/audio-frame-tags';
// Earliest driver module entry, before preflight or any owned I/O. Node/module
// bootstrap is NOT claimed measured here; the operator must bound child wall time.
const started=performance.now(),deadline=started+CONFIG.outerMs,setupDeadline=deadline-1500;
const state:OperationState={pending:0,stopped:false},errors:string[]=[];
const args=process.argv.slice(2),option=(key:string)=>{const i=args.indexOf(key);return i<0?null:args[i+1];};
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../../..');
const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
let out:string|null=null,directory:string|null=null,outputCreated=false,temp:string|null=null,tempRemoved=false,tmpChanged=false;
let server:Awaited<ReturnType<typeof startStatic>>|null=null,browser:Browser|null=null,page:Page|null=null,cdp:CDPSession|null=null;
let browserCloseFulfilled=false,serverCloseFulfilled=false,cdpDetached=false;
let browserClose:Promise<void>|null=null,serverClose:Promise<void>|null=null,pageClose:Promise<void>|null=null,cdpClose:Promise<void>|null=null,tempClose:Promise<void>|null=null;
const pending={output:false,temp:false,server:false,browser:false,page:false,cdp:false};
// A rejected constructor with no returned owner is UNKNOWN, never invented absent.
const unreturnedOwners=new Set<string>();
let result:Record<string,unknown>|null=null,actualFetch:Record<string,string>|null=null,numericPayload:string|null=null,version:string|null=null,rawCommand:unknown=null;
let configuredExecutable:string|null=null,effectiveExecutable:string|null=null;
interface Manifest {sourceFiles:Record<string,string>;served:Record<string,string>;bundleSha256:string;workletSha256:string;protocolSha256:string;clarificationsSha256:string}
interface HostGo {schema:string;authorized:boolean;maximumInvocations:number;maximumContexts:number;output:string;sourceManifestSha256:string;bundleSha256:string;workletSha256:string;protocolSha256:string;clarificationsSha256:string;browserExecutable:string;browserVersion:string;nonce:string}
let manifestBytes:Buffer|null=null,manifest:Manifest|null=null,go:HostGo|null=null;
const previousTmp=process.env['TMPDIR'];
const step=<T>(make:()=>Promise<T>,cleanup=false)=>deadlineStep(make,state,cleanup?deadline:setupDeadline,cleanup);
function syncBoundary(){if(state.stopped||performance.now()>=setupDeadline){state.stopped=true;throw Error('Original outer preflight deadline exceeded');}}
function closeBrowser(){if(!browser)return Promise.resolve();return browserClose??=step(async()=>{await browser!.close();browserCloseFulfilled=true;},true);}
function closeServer(){if(!server)return Promise.resolve();return serverClose??=step(async()=>{await server!.close();serverCloseFulfilled=true;},true);}
function closePage(){if(!page)return Promise.resolve();return pageClose??=step(()=>page!.close(),true);}
function detach(){if(!cdp)return Promise.resolve();return cdpClose??=step(async()=>{await cdp!.detach();cdpDetached=true;},state.stopped);}
function removeTemp(){
  if(!temp)return Promise.resolve();
  if(!out||dirname(temp)!==out||!/^owned-temp-[A-Za-z0-9]{6}$/.test(basename(temp)))return Promise.reject(Error('Refuse removal of unproven temp path'));
  return tempClose??=step(async()=>{await rm(temp!,{recursive:true});tempRemoved=true;},true);
}
try {
  const built=option('--built'),output=option('--out'),goPath=option('--go');
  if(!built||!output||!goPath)throw Error('Explicit --built --out --go required; no default actual run');
  directory=resolve(built);out=resolve(output);
  manifestBytes=await step(()=>readFile(join(directory!,'source-manifest.json')));
  manifest=JSON.parse(manifestBytes.toString());syncBoundary();
  go=JSON.parse(await step(()=>readFile(goPath,'utf8')));syncBoundary();
  if(go!.schema!=='quest-audio-frame-tags-host-go.v1'||go!.authorized!==true||go!.maximumInvocations!==1||go!.maximumContexts!==1||go!.output!==out||go!.sourceManifestSha256!==hash(manifestBytes)||go!.bundleSha256!==manifest!.bundleSha256||go!.workletSha256!==manifest!.workletSha256||go!.protocolSha256!==manifest!.protocolSha256||go!.clarificationsSha256!==manifest!.clarificationsSha256||go!.browserExecutable!==chromium.executablePath()||!/^[-a-zA-Z0-9]{8,80}$/.test(go!.nonce))throw Error('Missing exact independently reviewed root one-shot GO');
  for(const [file,expected]of Object.entries(manifest!.sourceFiles)){if(hash(await step(()=>readFile(join(root,file))))!==expected)throw Error(`Frozen source bytes changed:${file}`);syncBoundary();}
  for(const [file,expected]of Object.entries(manifest!.served)){if(hash(await step(()=>readFile(join(directory!,file))))!==expected)throw Error(`Frozen served bytes changed:${file}`);syncBoundary();}
  await step(()=>{pending.output=true;unreturnedOwners.add('output');return mkdir(out!,{recursive:false}).then(()=>{pending.output=false;unreturnedOwners.delete('output');outputCreated=true;},error=>{pending.output=false;throw error;});});
  await step(()=>writeFile(join(out!,'STARTED.json'),JSON.stringify({nonce:go!.nonce,sourceManifestSha256:hash(manifestBytes!)}),{flag:'wx',flush:true}));
  temp=await step(()=>{
    pending.temp=true;unreturnedOwners.add('temp');
    return mkdtemp(join(out!,'owned-temp-')).then(async value=>{pending.temp=false;unreturnedOwners.delete('temp');temp=value;if(state.stopped&&!browser&&!server&&!page)await removeTemp();return value;},error=>{pending.temp=false;throw error;});
  });
  process.env['TMPDIR']=temp;tmpChanged=true;
  server=await step(()=>{pending.server=true;unreturnedOwners.add('server');return startStatic(directory!).then(async value=>{pending.server=false;unreturnedOwners.delete('server');server=value;if(state.stopped)await closeServer();return value;},error=>{pending.server=false;throw error;});});
  const executablePath = go!.browserExecutable;
  configuredExecutable = executablePath;
  // Heavy-compute launch runs inside the compute-services facade (slot-gated,
  // labelled); browserLaunch keeps the exact pinned-executable headless flags.
  const completed = await step(()=>createLocalComputeServices({
    browserLaunch: chromium.launch.bind(chromium,{executablePath,headless:true,args:[],timeout:Math.max(1,setupDeadline-performance.now())}),
  }).sceneCapture.withBrowser("quest-capacity:audio-frame-tags",async(launched)=>{
    pending.browser=true;unreturnedOwners.add('browser');
    browser=launched as Browser;pending.browser=false;unreturnedOwners.delete('browser');
    if(state.stopped)await closeBrowser();
  version=browser.version();if(version!==go!.browserVersion)throw Error('Fixed browser version mismatch; no fallback');syncBoundary();
  cdp=await step(()=>{pending.cdp=true;unreturnedOwners.add('cdp');return browser!.newBrowserCDPSession().then(async value=>{pending.cdp=false;unreturnedOwners.delete('cdp');cdp=value;if(state.stopped)await detach();return value;},error=>{pending.cdp=false;throw error;});});
  const observedCommand=await step(()=>cdp!.send('Browser.getBrowserCommandLine'));
  rawCommand=observedCommand;effectiveExecutable=observedCommand.arguments[0]??null;
  requireBrowserCommandIdentity(observedCommand,go!.browserExecutable);syncBoundary();await detach();
  page=await step(()=>{pending.page=true;unreturnedOwners.add('page');return browser!.newPage().then(async value=>{pending.page=false;unreturnedOwners.delete('page');page=value;if(state.stopped)await closePage();return value;},error=>{pending.page=false;throw error;});});
  page.on('pageerror',error=>{if(errors.length<16)errors.push(String(error));});
  await step(()=>page!.goto(`${server!.url}/?nonce=${encodeURIComponent(go!.nonce)}`));
  actualFetch=await step(()=>page!.evaluate(async()=>{const fetched:Record<string,string>={};for(const name of ['audio-frame-tags.js','frame-tags-worklet.js']){const b=await(await fetch(name,{cache:'no-store'})).arrayBuffer();fetched[name]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');}return fetched;}));
  if(actualFetch['audio-frame-tags.js']!==manifest!.bundleSha256||actualFetch['frame-tags-worklet.js']!==manifest!.workletSha256)throw Error('Actual browser fetch hash mismatch');syncBoundary();
  await step(()=>page!.locator('#start').click());
  result=await step(()=>page!.evaluate(async()=>await(window as unknown as {audioFrameTags:{closed:Promise<Record<string,unknown>>}}).audioFrameTags.closed));
  if(typeof result['numericPayload']!=='string')throw Error('Complete numeric payload absent; diagnostic unexercised');
  numericPayload=result['numericPayload'];delete result['numericPayload'];
  if(numericPayload.length>CONFIG.numericJsonCharacters||!/^[\x00-\x7F]*$/.test(numericPayload))throw Error('Complete ASCII numeric export bound failed');
  // Sole numeric payload string/copy; no newline, wrapper stringify or reread.
  const diskCopy=Buffer.from(numericPayload,'utf8');
  await step(()=>writeFile(join(out!,'numeric-payload.json'),diskCopy,{flag:'wx',flush:true}));
  result['numericPayloadFile']='numeric-payload.json';result['numericPayloadSha256']=hash(diskCopy);
  return {browser, page, result};
  }));
  browser = completed.browser; page = completed.page; result = completed.result;
} catch(error){errors.push(String(error));}
finally {
  state.stopped=true;
  // Independent attempts: a failure here never skips a different owned branch.
  if(cdp&&!cdpDetached)try{await detach();}catch(error){errors.push(String(error));}
  if(page&&!page.isClosed())try{await closePage();}catch(error){errors.push(String(error));}
  if(browser)try{await closeBrowser();}catch(error){errors.push(String(error));}
  if(server)try{await closeServer();}catch(error){errors.push(String(error));}
  if(page)page.removeAllListeners('pageerror');
  if(tmpChanged){if(previousTmp===undefined)delete process.env['TMPDIR'];else process.env['TMPDIR']=previousTmp;}
  const birthsPending=Object.values(pending).some(Boolean);
  const ended=!birthsPending&&unreturnedOwners.size===0&&state.pending===0
    &&ownedCloseConfirmed(browser!==null,state.pending,browserCloseFulfilled,browser===null||!browser.isConnected())
    &&ownedCloseConfirmed(server!==null,state.pending,serverCloseFulfilled,server===null||!server.server.listening)
    &&(!page||page.isClosed());
  if(temp&&ended)try{await removeTemp();}catch(error){errors.push(String(error));}
}
const decisionAt=performance.now(),pendingConstructors=[...new Set([...Object.keys(pending).filter(key=>pending[key as keyof typeof pending]),...unreturnedOwners])];
const nativeOwnersClosed=pendingConstructors.length===0&&state.pending===0
  &&ownedCloseConfirmed(browser!==null,state.pending,browserCloseFulfilled,browser===null||!browser.isConnected())
  &&ownedCloseConfirmed(server!==null,state.pending,serverCloseFulfilled,server===null||!server.server.listening)
  &&(!page||page.isClosed());
const cleanupConfirmed=nativeOwnersClosed&&(!temp||tempRemoved)&&decisionAt-started<=CONFIG.outerMs;
if(decisionAt-started>CONFIG.outerMs)errors.push('Observed entire driver/cleanup exceeded original15s limit');
let classification:ReturnType<typeof classify>|null=null;
if(cleanupConfirmed&&numericPayload){const nodes=decodeNodes(numericPayload);classification=classify(nodes.producer,nodes.checker);}
if(!cleanupConfirmed)numericPayload=null;
// Browser closed before metadata serialization reuses the second string slot.
// Metadata excludes payload; <=68 scalars*32 numeral chars remain below4096.
const report={schema:'quest-audio-frame-tags-host-result.v1',nonce:go?.nonce??null,sourceManifestSha256:manifestBytes?hash(manifestBytes):null,
  browser:{plannedExecutable:go?.browserExecutable??null,playwrightApiExecutable:chromium.executablePath(),configuredExecutable,effectiveExecutable,version,headless:true,explicitLaunchFlags:[],rawCommand},actualFetch,started,decisionAt,nativeOwnersEndedAt:cleanupConfirmed?decisionAt:null,outerObservedMs:decisionAt-started,
  outerClockScope:'Driver module entry before any owned work; JSmodule/processbootstrap excluded here and must be bounded by independent operator spawn-to-exit receipt.',
  cleanup:{confirmed:cleanupConfirmed,tempRemoved:!temp||tempRemoved,browserCloseFulfilled:browser?browserCloseFulfilled:null,serverCloseFulfilled:server?serverCloseFulfilled:null,pendingOperations:state.pending,pendingConstructors},result,classification,errors,
  scope:'Host software observations only; no microphone/XR/RTC or physical delivery/capacity qualification.'};
if(countMetadataScalars(report)>NUMERIC_BOUNDS.scalarSlots.mainAndDriverMetadata)errors.push('Combined main/driver metadata scalar reservation exceeded');
let reportWriteFulfilled=false;
if(outputCreated)try{await step(()=>writeFile(join(out!,'report.json'),JSON.stringify(report),{flag:'wx',flush:true}),true);reportWriteFulfilled=true;}catch(error){errors.push(String(error));}
const outerFinishedMs=performance.now()-started;
process.stdout.write(`${JSON.stringify({output:out,cleanupConfirmed,reportWriteFulfilled,errors:errors.length,classification,outerFinishedMs})}\n`);
const pageCleanup=result?.['cleanup'] as {confirmed?:boolean}|undefined,pageErrors=result?.['errors'];
if(!cleanupConfirmed||!reportWriteFulfilled||outerFinishedMs>CONFIG.outerMs||errors.length||pageCleanup?.confirmed!==true||!Array.isArray(pageErrors)||pageErrors.length||classification?.globalTagContinuity!=='PASS'||classification.observedContentContinuity!=='PASS'||classification.callbackCoverage!=='EXERCISED')process.exitCode=1;
