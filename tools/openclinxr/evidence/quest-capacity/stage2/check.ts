/// <reference lib="dom" />
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { chromium, type Browser, type Page } from 'playwright';
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import { gradeStage2Run } from '@openclinxr/xr-capacity/stage2';
import type { Stage2RunRecord, Stage2RunRelease, Stage2Environment } from '@openclinxr/xr-capacity/stage2';
import type { Stage2HostApi } from './entry.js';
import { loadCampaign, claimCampaign, claimSlot, LAUNCH_FLAGS, type CampaignGo, type CampaignSlot, type Stage2Manifest } from './campaign-policy.js';
import { startStage2Gateway, fileHash, sha, type Stage2Gateway, type GatewayClose } from './gateway.js';
import { InvocationDeadline } from './deadline.js';
import { KnownBudget } from './memory.js';
import { jsonBytes } from './export.js';
import { ExportOwner } from './export-owner.js';
const root=resolve(fileURLToPath(new URL('../../../../..',import.meta.url)));
const alive=(pid:number|null)=>{if(pid===null)return true;try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}};
const write=async(path:string,value:unknown)=>writeFile(path,`${JSON.stringify(value,null,2)}\n`);
async function writeLive(path:string,value:unknown,budget:KnownBudget){const lease=budget.reserve('driver-metadata-serialization-and-file-copy',jsonBytes(value)*5+512);try{await writeFile(path,`${JSON.stringify(value)}\n`);}finally{budget.release(lease);}}
async function fixedSources(manifest:Stage2Manifest,dist:string,budget?:KnownBudget){for(const [path,expected]of Object.entries(manifest.files))if(await fileHash(join(root,path),budget)!==expected)throw new Error(`Frozen source changed: ${path}`);for(const [name,expected]of Object.entries(manifest.served))if(await fileHash(join(dist,name),budget)!==expected)throw new Error(`Frozen served bytes changed: ${name}`);}
async function runSlot(slot:CampaignSlot,go:CampaignGo,manifest:Stage2Manifest,dist:string,python:string,out:string){
  const started=performance.now(),deadline=new InvocationDeadline(started,165000),budget=new KnownBudget(65536),exportOwner=new ExportOwner(deadline);
  const owned:{gateway:Stage2Gateway|null;browser:Browser|null;page:Page|null;release:Stage2RunRelease|null}={gateway:null,browser:null,page:null,release:null};
  const cleanupState:{gatewayClose:GatewayClose|null}={gatewayClose:null};let browserPid:number|null=null,browserCloseCompleted=false,exportComplete=false,exportProof:unknown=null,browserExportAudit:unknown=null;const phases:{precontextStatic:ReturnType<KnownBudget['audit']>|null;audioAndExport:ReturnType<KnownBudget['audit']>|null;overallKnownPeakBytes:number|null}={precontextStatic:null,audioAndExport:null,overallKnownPeakBytes:null};
  const errors:string[]=[],commandLine:string[]=[];let observedBrowserVersion:string|null=null,fetched:Record<string,string>|null=null;const rawPath=join(out,'browser-raw.json');budget.reserve('frozen-driver-control-metadata',jsonBytes({go,manifest,slot}),true);budget.reserve('bounded-driver-errors-and-brackets',5120,true);
  const closeBrowser=async(browser:Browser)=>{try{deadline.assert();await deadline.wait(browser.close(),Math.min(1500,deadline.remaining()));browserCloseCompleted=!browser.isConnected();}catch(error){errors.push(`browser close:${String(error)}`);if(browserPid!==null&&alive(browserPid)){try{process.kill(browserPid,'SIGKILL');}catch{}}}
    while(browserPid!==null&&alive(browserPid)&&deadline.remaining()>1)await new Promise(yes=>setTimeout(yes,10));
  };
  try{
    // All acquisition/export work must finish with five seconds still on the SAME absolute clock.
    await deadline.wait((async()=>{
      await fixedSources(manifest,dist,budget);deadline.assertWork();
      owned.gateway=await deadline.acquire(startStage2Gateway({dist,python,jobDirectory:out,signal:deadline.workSignal,budget}),async lateGateway=>{await lateGateway.close();});const gateway=owned.gateway;
      const runtime={nodeVersion:process.version,pythonVersion:gateway.ready.pythonVersion,aiortcVersion:gateway.ready.aiortcVersion,avVersion:gateway.ready.avVersion,aiohttpVersion:gateway.ready.aiohttpVersion};
      if(!isDeepStrictEqual(runtime,go.environment.runtime))throw new Error('Actual Node/Python media runtime differs from GO');
      // Heavy-compute launch runs inside the compute-services facade (slot-gated,
      // labelled); browserLaunch keeps the exact pinned-executable launch flags.
      deadline.assertWork();await deadline.wait(createLocalComputeServices({signal: deadline.workSignal,browserLaunch:()=>deadline.acquire(chromium.launch.bind(chromium,{headless:true,executablePath:go.environment.browser.executablePath,args:LAUNCH_FLAGS,timeout:Math.max(1,Math.min(10000,deadline.remaining()-5000))})(),closeBrowser)}).sceneCapture.withBrowser("quest-capacity:stage2",async(launched)=>{owned.browser=launched as Browser;const browser=owned.browser;deadline.assertWork();
      observedBrowserVersion=browser.version();if(observedBrowserVersion!==go.environment.browser.version)throw new Error('Actual browser version differs from GO');
      deadline.assertWork();const cdp=await browser.newBrowserCDPSession();deadline.assertWork();const processes=await cdp.send('SystemInfo.getProcessInfo') as {processInfo:Array<{type:string;id:number}>};deadline.assertWork();browserPid=processes.processInfo.find(item=>item.type==='browser')?.id??null;
      deadline.assertWork();const argv=await cdp.send('Browser.getBrowserCommandLine') as {arguments:string[]};deadline.assertWork();if(jsonBytes(argv.arguments)>4096)throw new Error('Bounded browser argv metadata');budget.reserve('actual-browser-command-line-utf16',jsonBytes(argv.arguments)*2,true);commandLine.push(...argv.arguments);deadline.assertWork();await cdp.detach();deadline.assertWork();if(browserPid===null)throw new Error('Missing actual owned browser PID');
      deadline.assertWork();owned.page=await deadline.acquire(browser.newPage({viewport:{width:1100,height:900}}),latePage=>latePage.close());const page=owned.page;deadline.assertWork();page.on('pageerror',error=>{if(errors.length<8)errors.push(String(error).slice(0,256));});
      deadline.assertWork();await page.goto(gateway.origin,{waitUntil:'load',timeout:10000});deadline.assertWork();await page.waitForFunction(()=>!!(window as unknown as {stage2Host?:unknown}).stage2Host,{},{timeout:5000});deadline.assertWork();
      deadline.assertWork();const timeOriginMs=await page.evaluate(()=>performance.timeOrigin);deadline.assertWork();
      const environment:Stage2Environment={browser:{...go.environment.browser,timeOriginMs},driver:{processId:process.pid,clockId:`node-performance:${process.pid}:${performance.timeOrigin}`,timeOriginMs:performance.timeOrigin},runtime:{...runtime,serverProcessId:gateway.ready.pid,serverClockId:gateway.ready.clockId},signalingOrigins:[gateway.origin,gateway.ready.origin],iceServers:[],localInterfaces:gateway.interfaces};
      const release:Stage2RunRelease={schema:'quest-stage2-host-release.v1',identity:manifest.identity,binding:{runNonce:slot.nonce,peerTicket:`${slot.nonce}:peer`,uplinkSourceId:`${slot.nonce}:uplink-400`,downlinkSourceId:`${slot.nonce}:return-700`},mode:slot.mode,expectedEnvironment:environment};owned.release=release;
      const metadataLease=budget.reserve('release-and-driver-metadata',jsonBytes(release),true);void metadataLease;await exportOwner.control(()=>writeLive(join(out,'release.json'),release,budget));deadline.assertWork();
      deadline.assertWork();fetched=await page.evaluate(expected=>(window as unknown as {stage2Host:Stage2HostApi}).stage2Host.verifySources(expected),manifest.served);deadline.assertWork();
      if(Object.entries(manifest.served).some(([name,hash])=>fetched?.[name]!==hash))throw new Error('Actual browser fetched byte identities differ');
      deadline.assertWork();await page.evaluate(({released,driverStartedMs})=>(window as unknown as {stage2Host:Stage2HostApi}).stage2Host.configure(released,driverStartedMs),{released:release,driverStartedMs:started});deadline.assertWork();
      deadline.assertWork();await page.locator('#stage2-start').click();deadline.assertWork();const closed=await page.evaluate(async()=>await(window as unknown as {stage2Host:Stage2HostApi}).stage2Host.closed);deadline.assertWork();if(closed.nonce!==slot.nonce)throw new Error('Closed nonce mismatch');deadline.assertWork();
      deadline.assertWork();await page.evaluate(()=>(window as unknown as {stage2Host:Stage2HostApi}).stage2Host.beginExport());deadline.assertWork();
      const writer=await exportOwner.create(rawPath,budget,{runNonce:release.binding.runNonce,identitySha256:sha(JSON.stringify(release.identity))});deadline.assertWork();
      try{
        for(;;){
          deadline.assertWork();const unit=await page.evaluate(()=>(window as unknown as {stage2Host:Stage2HostApi}).stage2Host.nextExport());deadline.assertWork();
          const ack=await exportOwner.accept(unit);deadline.assertWork();
          await page.evaluate(value=>(window as unknown as {stage2Host:Stage2HostApi}).stage2Host.ackExport(value),ack);deadline.assertWork();if(unit.final)break;
        }
        exportProof=writer.snapshot();deadline.assertWork();const summary=await page.evaluate(()=>(window as unknown as {stage2Host:Stage2HostApi}).stage2Host.exportSnapshot());deadline.assertWork();
        browserExportAudit=summary.reservation;phases.precontextStatic=summary.precontextStatic;phases.audioAndExport=summary.reservation;phases.overallKnownPeakBytes=Math.max(summary.precontextStatic.peakBytes,summary.reservation.peakBytes);
        if(!summary.precontextStatic.closed||summary.precontextStatic.heldBytesAtClose!==0)throw new Error('Pre-context phase overlap was not zero');
        exportComplete=summary.complete&&writer.snapshot().complete&&summary.chainSha256===writer.snapshot().chainSha256;budget.reserve('retained-export-receipt',jsonBytes({summary,writer:exportProof}),true);
        deadline.assertWork();await exportOwner.control(()=>writeLive(join(out,'export-receipt.json'),{...summary,writer:exportProof},budget));deadline.assertWork();
      }finally{await exportOwner.close();}await closeBrowser(browser);}));

    })(),Math.max(1,deadline.remaining()-5000));
  }catch(error){errors.push(String(error));}
  finally{
    // No new acquisition is allowed after this point. The absolute165s timer remains armed.
    deadline.cancelWork('Acquisition/export ended; cleanup only');exportOwner.stop();
    const {page,browser,gateway}=owned;
    if(page&&!page.isClosed()&&deadline.remaining()>0)try{deadline.assert();await deadline.wait(page.evaluate(()=>(window as unknown as {stage2Host?:Stage2HostApi}).stage2Host?.stop('driver-finally')),250);}catch{}
    const closed=await Promise.allSettled([deadline.wait(exportOwner.close()),browser&&deadline.remaining()>0?closeBrowser(browser):Promise.resolve(),gateway&&deadline.remaining()>0?deadline.wait(gateway.close(),Math.min(3000,deadline.remaining())).then(value=>{cleanupState.gatewayClose=value;}):Promise.resolve()]);
    for(const result of closed)if(result.status==='rejected')errors.push(`owned cleanup:${String(result.reason)}`);
    try{await deadline.drainLate();}catch(error){errors.push(`late resource cleanup:${String(error)}`);}
  }
  const gatewayClose=cleanupState.gatewayClose,bound=deadline.finish();
  const exportOwnership=exportOwner.snapshot();const cleanup={ownedProcesses:(browserPid!==null&&alive(browserPid)?1:0)+(gatewayClose?.ownedProcesses??0),ownedListeners:gatewayClose?.ownedListeners??0,confirmed:browserCloseCompleted&&browserPid!==null&&!alive(browserPid)&&gatewayClose?.confirmed===true&&exportOwnership.confirmed&&bound.pendingLateConstructors===0};
  const ownerDecisionAtMs=performance.now(),driverEnded=cleanup.confirmed?ownerDecisionAtMs:null;if(bound.expired||bound.pendingLateConstructors!==0||ownerDecisionAtMs-started>165000||!exportOwnership.confirmed)errors.push('Absolute acquisition/cleanup bound failed');
  let grade:ReturnType<typeof gradeStage2Run>|null=null;
  // OFFLINE ONLY after all live owners are confirmed closed. Its full JSON/grade
  // working set is not part of the live1MiB fixture, and remains inside825s campaign.
  if(exportComplete&&cleanup.confirmed&&!bound.expired&&driverEnded!==null&&driverEnded-started<=165000&&owned.release){const record=JSON.parse(await readFile(rawPath,'utf8')) as Stage2RunRecord;record.lifecycle.driverEndedMs=driverEnded;record.cleanup.driver=cleanup;if(record.resources.ownerReservations.browser!==null)record.resources.ownerReservations.browser=browserExportAudit as NonNullable<Stage2RunRecord['resources']['ownerReservations']['browser']>;record.resources.ownerReservations.gateway=gatewayClose?.reservation??null;const finalPython=(gatewayClose?.childReceipt as {reservation?:Stage2RunRecord['resources']['ownerReservations']['python']}|null)?.reservation;if(finalPython)record.resources.ownerReservations.python=finalPython;
    const knownGateway=jsonBytes({go,manifest,slot,release:owned.release,commandLine,errors,phases,exportProof,gatewayClose});record.resources.ledger.push({owner:'gateway-driver',description:'Compact UTF8 logical payload of retained scalar/control records; excludes object/native heap and is not reservation capacity',count:1,itemBytes:knownGateway,kind:'known-payload'});record.resources.knownPendingPayloadBytes+=knownGateway;await write(join(out,'run.json'),record);grade=gradeStage2Run(record,owned.release);}
  const passed=errors.length===0&&cleanup.confirmed&&exportComplete&&!!grade&&(slot.mode==='positive'?grade.functionalPass:grade.negative?.exercised===true&&grade.negative.rejectedAsIntended===true);
  const result={slot,state:passed?'CONTROL_PASS':'FAILED',passed,scope:'headless muted same-host synthetic software proof only',driverStartedMs:started,driverEndedMs:driverEnded,ownerDecisionAtMs,exportOwnership,deadline:bound,browser:{executablePath:go.environment.browser.executablePath,version:observedBrowserVersion,explicitLaunchFlags:LAUNCH_FLAGS,actualCommandLine:commandLine,normalizedCommandLine:commandLine.map(arg=>arg.startsWith('--user-data-dir=')?'--user-data-dir=<owned-ephemeral-profile>':arg),ownedPid:browserPid,ownedProfileArgument:commandLine.find(argument=>argument.startsWith('--user-data-dir='))??null,launchFlagScope:'Exact explicit Playwright args; full generated argv retained separately'},streamedByteDeclarations:fetched,pythonExecutablePath:python,grade,errors,cleanup,gatewayClose,exportProof,browserKnownBytePhases:phases,knownByteScope:'mutually exclusive pre-context and actual audio/export phases, each within655360; max is an overall phase peak, not heap or category-maxima sum'};if(cleanup.confirmed)await write(join(out,'slot-result.json'),result);else if(deadline.remaining()>0)await writeLive(join(out,'slot-result.json'),result,budget);return result;
}
export async function campaign(args:string[]){
  const campaignStarted=performance.now();const option=(name:string)=>{const at=args.indexOf(name);return at<0?null:args[at+1];};const distOption=option('--dist'),outOption=option('--out'),python=option('--python'),plan=option('--plan'),goPath=option('--campaign-go');
  if(!distOption||!outOption||!python||!plan||!goPath)throw new Error('Required: --dist --out --python --plan --campaign-go; explicit ROOT media GO only');
  const dist=resolve(distOption),out=resolve(outOption),bytes=await readFile(join(dist,'source-manifest.json'));const {go,manifest,slots}=await loadCampaign(plan,goPath,bytes,out);await fixedSources(manifest,dist);await mkdir(out,{recursive:true});await claimCampaign(out,{at:new Date().toISOString(),plan,goPath,sourceManifestSha256:sha(bytes),slots});
  const states:Array<{slot:CampaignSlot;state:string;passed?:boolean;path?:string}>=slots.map(slot=>({slot,state:'UNSTARTED'}));
  for(const [index,slot]of slots.entries()){
    if(825000-(performance.now()-campaignStarted)<165000)break;const directory=join(out,`slot-${slot.ordinal}-${slot.mode}`);await mkdir(directory);await claimSlot(out,slot);states[index]={slot,state:'STARTED',path:directory};await write(join(out,'campaign-result.json'),{schema:'quest-stage2-finite-campaign-result.v1',states,complete:false});
    const result=await runSlot(slot,go,manifest,dist,python,directory);states[index]={slot,state:result.state,passed:result.passed,path:directory};await fixedSources(manifest,dist);await write(join(out,'campaign-result.json'),{schema:'quest-stage2-finite-campaign-result.v1',states,complete:states.every(s=>s.state==='CONTROL_PASS')});if(!result.passed||performance.now()-campaignStarted>=825000)break;
  }
  const passed=states.every(state=>state.state==='CONTROL_PASS')&&performance.now()-campaignStarted<=825000;process.stdout.write(`${JSON.stringify({out,passed,states},null,2)}\n`);if(!passed)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void campaign(process.argv.slice(2)).catch(error=>{process.stderr.write(`${String(error)}\n`);process.exitCode=1;});
