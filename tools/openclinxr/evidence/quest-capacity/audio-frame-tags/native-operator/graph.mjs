// Native Phase2 only. The frozen browser app/worklet are served unchanged.
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync,readdirSync,existsSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {normalOwned,cleanupOwned,detachNumericPayload,assertFreshGraphNonce,assertHumanReadinessFresh,validateAuthorityAndRaw,assertLiveStableBeforeGraph,resolveChildBudget,EXPECTED_NATIVE_PRODUCT} from './graph-ownership.mjs';
import {createRequire} from 'node:module';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const ROOT='/Volumes/files/src/openclinxr', SERIAL='2G0YC5ZGB5000J', ORIGIN='http://localhost:54245';
const HERE=dirname(fileURLToPath(import.meta.url));
const {chromium}=createRequire(join(ROOT,'package.json'))('playwright');
const hash=x=>createHash('sha256').update(x).digest('hex');
const requireCondition=(ok,why)=>{if(!ok)throw Error(why);};
// Explicit durable IO: Node24 writeFileSync Buffer flush:true fsyncs, but the string fastpath
// may bypass it, so every durable child artifact (prefix/journal/payload/report) is written
// then fsynced explicitly with the output directory fsynced after creates. No extra copies
// of the full numeric payload are made; the sole UTF8 disk buffer is retained once.
const fsyncFile=path=>{const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
const fsyncDir=path=>{const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}};
const durableJson=(path,value)=>{writeFileSync(path,JSON.stringify(value),{flag:'wx'});fsyncFile(path);fsyncDir(dirname(path));};
const durableBytes=(path,buffer)=>{writeFileSync(path,buffer,{flag:'wx'});fsyncFile(path);fsyncDir(dirname(path));};
const durableAppend=(path,line)=>{appendFileSync(path,line);fsyncFile(path);};
const sha=path=>hash(readFileSync(path));
const bound=ref=>{const path=resolve(ref.path);requireCondition((path.startsWith(ROOT+'/')||path.startsWith(HERE+'/'))&&sha(path)===ref.sha256,'Bound native file changed');return path;};
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const configPath=option('--config');requireCondition(configPath,'Explicit native config required');
const config=json(configPath), execute=process.argv.includes('--execute');
requireCondition(config.schema==='quest-audio-tags-native-graph-config.v1'&&config.serial===SERIAL&&config.origin===ORIGIN,'Native graph tuple');
const paths=Object.fromEntries(['rootGo','independentRelease','plan','operatorManifest','sourceManifest','observedProfile','rawProfile','humanReadiness'].map(k=>[k,bound(config[k])]));
const go=json(paths.rootGo),review=json(paths.independentRelease),plan=json(paths.plan),manifest=json(paths.sourceManifest),profile=json(paths.observedProfile),rawProfile=json(paths.rawProfile),human=json(paths.humanReadiness),opManifest=json(paths.operatorManifest);
requireCondition(go.schema==='quest-audio-tags-native-graph-go.v1'&&go.authorized===true&&go.phase==='graph'&&go.maximumInvocations===1&&go.maximumContexts===1&&go.serial===SERIAL&&go.origin===ORIGIN,'Separate observed-profile root graph GO required');
for(const [field,key]of Object.entries({operatorManifestSha256:'operatorManifest',independentReleaseSha256:'independentRelease',planSha256:'plan',sourceManifestSha256:'sourceManifest',observedProfileSha256:'observedProfile',rawProfileSha256:'rawProfile',humanReadinessSha256:'humanReadiness'}))requireCondition(go[field]===config[key].sha256,'Native root identity '+field);
requireCondition(review.approved===true&&review.phase==='graph'&&review.operatorManifestSha256===config.operatorManifest.sha256,'Independent graph operator release');
// observedProfile = approved independent authority (nested profile). rawProfile = successful
// profile-observation.json. Authority graphGo is false: profile metadata never authorizes graph.
validateAuthorityAndRaw(profile,rawProfile,{rawProfileSha256:config.rawProfile.sha256,planSha256:config.plan.sha256,sourceManifestSha256:config.sourceManifest.sha256});
assertFreshGraphNonce(config.nonce);
requireCondition(config.nonce===plan.nonce&&go.nonce===config.nonce&&/^[-a-zA-Z0-9]{8,80}$/.test(config.nonce),'Fresh reviewed graph nonce');
// Fresh Phase2 targets/maps/port/PID baseline is taken below; old Phase1 tabs are evidence only.
assertHumanReadinessFresh(human);
requireCondition(plan.phase2.wholeControlMaxMs===45000&&plan.phase2.setupMaxMs===20000&&plan.phase2.closedAwaitMaxMs===12000&&plan.phase2.cleanupReserveMs===10000,'Native timing policy');
for(const [name,expected]of Object.entries(opManifest.files))requireCondition(!name.includes('/')&&sha(join(HERE,name))===expected,'Graph operator leaf changed');
const built=dirname(paths.sourceManifest);
requireCondition(JSON.stringify(readdirSync(built).sort())===JSON.stringify([...Object.keys(manifest.served),'source-manifest.json'].sort()),'Exact six-file native static delivery');
for(const [name,expected]of Object.entries(manifest.served))requireCondition(!name.includes('/')&&sha(join(built,name))===expected,'Frozen served bytes changed');
for(const [name,expected]of Object.entries(manifest.sourceFiles))requireCondition(sha(join(ROOT,name))===expected,'Frozen source closure changed');
requireCondition(manifest.numericBounds.peakBytes===31488&&manifest.config.numericJsonCharacters===4096,'Frozen numeric recording contract');
const out=resolve(config.output),expectedOut=join(ROOT,'.openclinxr/slices/quest3-stage1-duplex-immersive-baseline/evidence/audio-frame-tags/native-01/graph-actual-01');
requireCondition(out===expectedOut&&go.output===out&&!existsSync(out),'Fresh exact graph output');
const lease=json(join(ROOT,'.openclinxr/openclaw/automation-lease.json')).slots.filter(x=>x.owner==='codex-stage1'&&x.slice==='quest3-stage1-duplex-immersive-baseline'&&x.cwd===ROOT);
requireCondition(lease.length===1&&Date.parse(lease[0].expiresAt)-Date.now()>55000,'Active exact lease through native graph cleanup');
if(!execute){process.stdout.write(JSON.stringify({hostPreflightPassed:true,executed:false})+'\n');process.exit(0);}
// Parent-shared absolute wall deadline (set by run_graph.py before spawn). Missing/expired/
// unbounded values deny here, before any owned IO. All internal budgets derive from
// min(original 45s, parent wall remaining minus 1s reserve); whole 45s is never expanded.
const wholeMs=resolveChildBudget(process.env.QUEST_NATIVE_PARENT_DEADLINE_UNIX_MS,Date.now());
const {deadlineStep,ownedCloseConfirmed}=await import('@openclinxr/xr-capacity/audio-frame-tags');
const {decodeNodes,countMetadataScalars,NUMERIC_BOUNDS}=await import('@openclinxr/xr-capacity/audio-frame-tags');
const {classify}=await import('@openclinxr/xr-capacity/audio-frame-tags');
const started=performance.now(),deadline=started+wholeMs,setupDeadline=started+Math.min(20000,wholeMs);
const state={pending:0,stopped:false},errors=[],pending=new Set();
let forward=null,reverse=false,browser=null,page=null,pageCdp=null,server=null;
let browserClosed=false,pageClosed=false,cdpDetached=false,serverClosed=false,journalFailed=false;
let targetsBefore=null,targetsAfter=null,forwardBefore=null,reverseBefore=null,forwardAfter=null,reverseAfter=null,portBefore=null,portAfter=null,ownedTargetId=null;
let result=null,numericPayload=null,classification=null,nativeVersion=null,actualFetch=null;
const prefix={schema:'quest-native-audio-graph-prefix.v1',serial:SERIAL,nonce:config.nonce,configSha256:sha(configPath),rootGoSha256:config.rootGo.sha256,sourceManifestSha256:config.sourceManifest.sha256,beforeAnyOwnedIo:true};
mkdirSync(out,{recursive:false});fsyncDir(dirname(out));durableJson(join(out,'prefix.json'),prefix);
const record=(label,value)=>{try{durableAppend(join(out,'journal.jsonl'),JSON.stringify({at:new Date().toISOString(),label,value})+'\n');}catch(error){journalFailed=true;errors.push('Journal persistence:'+String(error));throw error;}};
const remaining=()=>Math.max(1,deadline-performance.now());
const step=(make,cleanup=false,limit=null)=>deadlineStep(make,state,limit??(cleanup?deadline:setupDeadline),cleanup);
const command=args=>execFileSync(args[0],args.slice(1),{encoding:'utf8',timeout:Math.min(3000,remaining()),maxBuffer:1024*1024}).trim();
const adb=(...args)=>command(['/opt/homebrew/bin/adb','-s',SERIAL,...args]);
const snapshot=rows=>rows.map(x=>({id:x.id,type:x.type,urlSha256:hash(x.url??'')})).sort((a,b)=>a.id.localeCompare(b.id));
const metadata=async path=>{const response=await fetch(`http://127.0.0.1:${forward}${path}`,{signal:AbortSignal.timeout(Math.min(2000,remaining()))});requireCondition(response.ok,'CDP HTTP metadata');const body=await response.text();requireCondition(body.length<=1024*1024,'CDP metadata bound');return JSON.parse(body);};
const ownerIo={admit:()=>requireCondition(!journalFailed&&!state.stopped,'Native normal work stopped'),record,step,error:value=>errors.push(value)};
const normal=(label,make,register)=>normalOwned(label,make,register,ownerIo);
const clean=(label,make)=>cleanupOwned(label,make,ownerIo);
const portInventory=()=>{try{return command(['/usr/sbin/lsof','-nP','-iTCP:54245','-sTCP:LISTEN','-Fp']);}catch(error){if(error.status===1)return '';throw error;}};
let browserClose=null,pageClose=null,cdpClose=null;
// Installed Playwright 1.59.1 connectOverCDP close calls transport.closeAndWait: it disconnects
// only this owned connection and never issues a remote Browser.close; other Meta Browser pages survive.
const closeBrowser=()=>browserClose??=step(async()=>{await browser.close();browserClosed=true;},true);
const closePage=()=>pageClose??=step(async()=>{await page.close();pageClosed=true;},true);
const detach=()=>cdpClose??=step(async()=>{await pageCdp.detach();cdpDetached=true;},true);
try {
  requireCondition(await normal('state-once',async()=>adb('get-state'))==='device','USB unauthorized; no retry');
  // Single live re-observation before graph: stable model/build/UID matched, currentPID kept as
  // nonempty metadata only (old PID 7807 need not persist). Package list stays frozen evidence.
  const liveModel=await normal('live-model',async()=>adb('shell','getprop','ro.product.model'));
  const liveBuild=await normal('live-build',async()=>adb('shell','getprop','ro.build.display.id'));
  const liveUid=await normal('live-uid',async()=>adb('shell','cmd','package','list','packages','-U','com.oculus.browser'));
  const livePid=await normal('live-pid',async()=>adb('shell','pidof','com.oculus.browser'));
  const packageVersion=await normal('package-version',async()=>adb('shell','dumpsys','package','com.oculus.browser').split('\n').filter(x=>/versionName=|versionCode=/.test(x)).map(x=>x.trim()));
  requireCondition(JSON.stringify(packageVersion)===JSON.stringify(rawProfile.packageVersion),'Frozen raw package evidence changed');
  forwardBefore=await normal('forward-before',async()=>adb('forward','--list'));
  reverseBefore=await normal('reverse-before',async()=>adb('reverse','--list'));
  requireCondition(!/\btcp:54245\b/.test(reverseBefore),'Reserved reverse already present; no replacement');
  portBefore=await normal('host-port-before',async()=>portInventory());
  requireCondition(portBefore==='','Stable origin has an existing listener; preserve it');
  // EADDRINUSE also preserves a listener racing the inventory; never choose a new origin.
  server=createServer(async(request,response)=>{const name=new URL(request.url??'/',ORIGIN).pathname.slice(1)||'index.html';if(request.method!=='GET'||!Object.hasOwn(manifest.served,name)&&name!=='source-manifest.json'){response.writeHead(404).end();return;}try{response.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html','cache-control':'no-store'}).end(readFileSync(join(built,name)));}catch{response.writeHead(500).end();}});
  await normal('owned-server-listen',()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(54245,'127.0.0.1',resolve);}));
  await normal('allocate-forward',async()=>adb('forward','tcp:0','localabstract:chrome_devtools_remote'),value=>{requireCondition(/^\d{1,5}$/.test(value)&&Number(value)>0&&Number(value)<=65535&&!new RegExp('\\btcp:'+value+'\\b').test(forwardBefore),'Unproven allocation; refuse guessed cleanup');forward=Number(value);});
  const version=await normal('http-version',()=>metadata('/json/version'));
  requireCondition(version.Browser===profile.profile.product&&version['User-Agent']===profile.profile.userAgent,'Fresh HTTP Browser/UA changed vs approved profile');
  targetsBefore=await normal('targets-before',async()=>snapshot(await metadata('/json/list')));
  await normal('owned-reverse',async()=>adb('reverse','--no-rebind','tcp:54245','tcp:54245'),()=>{reverse=true;});
  pending.add('browser');
  browser=await step(()=>chromium.connectOverCDP(`http://127.0.0.1:${forward}`,{timeout:Math.max(1,setupDeadline-performance.now())}).then(async value=>{browser=value;pending.delete('browser');if(state.stopped)await closeBrowser();return value;}));
  pending.add('cdp');pageCdp=await step(()=>browser.newBrowserCDPSession().then(async value=>{pageCdp=value;pending.delete('cdp');if(state.stopped)await detach();return value;}));
  nativeVersion=await step(()=>pageCdp.send('Browser.getVersion'));
  for(const key of ['protocolVersion','product','revision','userAgent','jsVersion'])requireCondition(nativeVersion[key]===rawProfile.browserCdpVersion.version[key],'Live Browser.getVersion changed vs raw:'+key);
  requireCondition(nativeVersion.product===profile.profile.product&&nativeVersion.product===EXPECTED_NATIVE_PRODUCT,'Live native FULL product changed vs approved profile');
  requireCondition(nativeVersion.userAgent===profile.profile.userAgent,'Live native UA changed vs approved profile');
  assertLiveStableBeforeGraph({model:liveModel,osBuild:liveBuild,uid:liveUid,httpBrowser:version.Browser,httpUA:version['User-Agent'],cdpProduct:nativeVersion.product,cdpUA:nativeVersion.userAgent,currentPid:livePid},profile.profile);
  await detach();pageCdp=null;cdpClose=null;cdpDetached=false;
  const context=browser.contexts()[0];requireCondition(context,'Existing native browser context unavailable');
  pending.add('page');page=await step(()=>context.newPage().then(async value=>{page=value;pending.delete('page');if(state.stopped)await closePage();return value;}));
  const url=ORIGIN+'/?nonce='+encodeURIComponent(config.nonce);await step(()=>page.goto(url,{timeout:Math.max(1,setupDeadline-performance.now())}));
  const identity=await step(()=>page.evaluate(()=>window.audioFrameTags.identity));
  requireCondition(identity.nonce===config.nonce&&identity.bundleSha256===manifest.bundleSha256&&identity.workletSha256===manifest.workletSha256&&identity.protocolSha256===manifest.protocolSha256&&identity.clarificationsSha256===manifest.clarificationsSha256,'Actual loaded page identity');
  actualFetch=await step(()=>page.evaluate(async()=>{const facts={userAgent:navigator.userAgent,platform:navigator.platform,secureContext:isSecureContext,assets:{}};for(const name of ['audio-frame-tags.js','frame-tags-worklet.js']){const response=await fetch(name,{cache:'no-store'});if(!response.ok)throw Error('Actual asset fetch failed');const bytes=await response.arrayBuffer();facts.assets[name]=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}return facts;}));
  requireCondition(actualFetch.secureContext===true&&/Quest 3/.test(actualFetch.userAgent)&&actualFetch.assets['audio-frame-tags.js']===manifest.bundleSha256&&actualFetch.assets['frame-tags-worklet.js']===manifest.workletSha256,'Actual native fetch/security identity');
  pending.add('cdp');pageCdp=await step(()=>context.newCDPSession(page).then(async value=>{pageCdp=value;pending.delete('cdp');if(state.stopped)await detach();return value;}));
  const target=(await step(()=>pageCdp.send('Target.getTargetInfo'))).targetInfo;
  requireCondition(target.type==='page'&&target.url===url&&page.url()===url&&!targetsBefore.some(x=>x.id===target.targetId),'Owned native target binding');ownedTargetId=target.targetId;await detach();pageCdp=null;
  durableJson(join(out,'source-admission.json'),{schema:'quest-native-audio-source-admission.v1',serial:SERIAL,nonce:config.nonce,ownedTargetId,ownedUrlSha256:hash(url),actualFetch,actualNativeBrowser:nativeVersion,observedProfileSha256:config.observedProfile.sha256,sourceManifestSha256:config.sourceManifest.sha256});
  record('sole-trusted-start-begin',{});await step(()=>page.locator('#start').click({timeout:Math.max(1,setupDeadline-performance.now())}));
  result=await step(()=>page.evaluate(async()=>await window.audioFrameTags.closed),false,Math.min(deadline-10000,performance.now()+12000));
  numericPayload=detachNumericPayload(result);
  let diskCopy=Buffer.from(numericPayload,'utf8');durableBytes(join(out,'numeric-payload.json'),diskCopy);result.numericPayloadFile='numeric-payload.json';result.numericPayloadSha256=hash(diskCopy);diskCopy=null;
} catch(error){errors.push(String(error));}
finally {
  state.stopped=true;
  if(pageCdp&&!cdpDetached)await clean('cdp',detach);
  if(page)await clean('owned-page',closePage);
  if(browser)await clean('browser-connection',closeBrowser);
  if(forward!==null&&!journalFailed&&pending.size===0&&state.pending===0&&(!page||pageClosed)&&(!browser||browserClosed))try{targetsAfter=snapshot(await metadata('/json/list'));}catch(error){errors.push('Final target metadata:'+String(error));}
  if(server)await clean('owned-server',()=>new Promise((resolve,reject)=>{server.close(error=>{if(error)reject(error);else{serverClosed=true;resolve();}});server.closeAllConnections();}));
  if(reverse)await clean('owned-reverse',async()=>{adb('reverse','--remove','tcp:54245');reverse=false;});
  if(forward!==null)await clean('owned-forward',async()=>{adb('forward','--remove','tcp:'+forward);forward=null;});
}
const originalTargetsPreserved=targetsBefore!==null&&targetsAfter!==null&&JSON.stringify(targetsBefore)===JSON.stringify(targetsAfter);
const ownedTargetAbsent=ownedTargetId!==null&&targetsAfter!==null&&!targetsAfter.some(x=>x.id===ownedTargetId);
let mappingsPreserved=false,portRestored=false;
if(!journalFailed&&pending.size===0&&state.pending===0&&(!page||pageClosed)&&(!browser||browserClosed)&&performance.now()<deadline)try{forwardAfter=adb('forward','--list');reverseAfter=adb('reverse','--list');portAfter=portInventory();mappingsPreserved=forwardAfter===forwardBefore&&reverseAfter===reverseBefore;portRestored=portAfter===portBefore;}catch(error){errors.push('Final maps/port:'+String(error));}
durableJson(join(out,'external-preservation.json'),{schema:'quest-native-audio-preservation.v1',serial:SERIAL,ownedTargetId,targetsBefore,targetsAfter,forwardBefore,forwardAfter,reverseBefore,reverseAfter,portBefore,portAfter,originalTargetsPreserved,ownedTargetAbsent,mappingsPreserved,portRestored,history:'Only this actual interval; no retroactive preservation claim.'});
const cleanupConfirmed=pending.size===0&&state.pending===0&&ownedCloseConfirmed(browser!==null,state.pending,browserClosed,browser===null||!browser.isConnected())&&(!page||pageClosed)&&(!server||serverClosed)&&forward===null&&!reverse&&originalTargetsPreserved&&ownedTargetAbsent&&mappingsPreserved&&portRestored;
if(cleanupConfirmed&&numericPayload){const nodes=decodeNodes(numericPayload);classification=classify(nodes.producer,nodes.checker);}
const report={schema:'quest-audio-frame-tags-native-result.v1',serial:SERIAL,nonce:config.nonce,sourceManifestSha256:config.sourceManifest.sha256,observedProfileSha256:config.observedProfile.sha256,actualFetch,actualNativeBrowser:nativeVersion,started,decisionAt:performance.now(),nativeWholeControlMaxMs:45000,inheritedDesktopOuterMs:15000,nativeOuterScope:'Native control/setup/cleanup separately declared; unchanged app graph2s/drain1s. No desktop launch/executable/headless fact inferred.',cleanup:{confirmed:cleanupConfirmed,browserConnectionClosed:browserClosed,ownedPageClosed:pageClosed,ownedServerClosed:serverClosed,pendingConstructors:[...pending],pendingOperations:state.pending,originalTargetsPreserved,ownedTargetAbsent,mappingsPreserved,portRestored},result,classification,errors,rawScopePreserved:'Inherited HOST/headless wording in browser result is unchanged; actual Quest execution is this external serial/CDP/source-bound envelope.'};
if(countMetadataScalars(report)>NUMERIC_BOUNDS.scalarSlots.mainAndDriverMetadata)errors.push('Combined native main/driver numeric scalar reservation exceeded');
if(performance.now()-started>wholeMs)errors.push('Native whole control/cleanup exceeded derived whole budget (<=45s)');
durableJson(join(out,'report.json'),report);
const diagnosticPass=cleanupConfirmed&&!journalFailed&&errors.length===0&&result?.cleanup?.confirmed===true&&Array.isArray(result?.errors)&&result.errors.length===0&&classification?.globalTagContinuity==='PASS'&&classification?.observedContentContinuity==='PASS'&&classification?.callbackCoverage==='EXERCISED';
process.stdout.write(JSON.stringify({output:out,cleanupConfirmed,diagnosticPass,errors:errors.length})+'\n');if(!diagnosticPass)process.exitCode=1;
