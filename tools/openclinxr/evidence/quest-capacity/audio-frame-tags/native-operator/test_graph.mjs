import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalOwned,cleanupOwned,detachNumericPayload,assertFreshGraphNonce,assertHumanReadinessFresh,validateAuthorityAndRaw,assertLiveStableBeforeGraph,resolveChildBudget,EXPECTED_GRAPH_NONCE} from './graph-ownership.mjs';
import {deadlineStep} from '@openclinxr/xr-capacity/audio-frame-tags';
function io(overrides={}){return {admit(){},record(){},step:make=>make(),error(){},...overrides};}
test('returned owned port survives result persistence failure and is cleaned',async()=>{
 let owned=null,removed=null;
 const fixture=io({record:label=>{if(label==='forward-result')throw Error('disk full');}});
 await assert.rejects(normalOwned('forward',async()=>45821,port=>{owned=port;},fixture),/disk full/);
 assert.equal(owned,45821);
 await cleanupOwned('forward',async()=>{removed=owned;owned=null;},fixture);
 assert.equal(removed,45821);assert.equal(owned,null);
});
test('ownership precedes exact deadlineStep post-result recheck',async()=>{
 let owned=null;const state={pending:0,stopped:false},deadline=performance.now()+5;
 const fixture=io({step:make=>deadlineStep(make,state,deadline)});
 await assert.rejects(normalOwned('forward',async()=>45821,port=>{owned=port;while(performance.now()<deadline+1){}},fixture),/deadline/);
 assert.equal(owned,45821);assert.equal(state.pending,0);
});
test('late result past setup deadline keeps local ownership but never admits use',async()=>{
 let owned=null;const state={pending:0,stopped:false},deadline=performance.now()+5;
 const fixture=io({step:make=>deadlineStep(make,state,deadline)});
 await new Promise(resolve=>setTimeout(resolve,10));
 await assert.rejects(normalOwned('page',async()=>'late-target',value=>{owned=value;},fixture),/deadline|admission/);
 assert.equal(owned,null);assert.equal(state.pending,0);
});
test('cleanup journal failure never suppresses proven owned release',async()=>{
 let removed=false,errors=[];
 await cleanupOwned('forward',async()=>{removed=true;},io({record(){throw Error('disk full');},error:value=>errors.push(value)}));
 assert.equal(removed,true);assert.deepEqual(errors,[]);
});
test('one cleanup release failure does not skip the next exact owner',async()=>{
 let second=false,errors=[];const fixture=io({error:value=>errors.push(value)});
 await cleanupOwned('page',async()=>{throw Error('close rejected');},fixture);
 await cleanupOwned('forward',async()=>{second=true;},fixture);
 assert.equal(second,true);assert.equal(errors.length,1);assert.match(errors[0],/close rejected/);
});
test('failed normal admission causes zero child operation',async()=>{
 let called=false;await assert.rejects(normalOwned('forward',async()=>{called=true;},null,io({admit(){throw Error('journal failed');}})),/journal failed/);assert.equal(called,false);
});
test('unproven allocation is refused without guessing owner and never claims restore',async()=>{
 let owner=null;await assert.rejects(normalOwned('forward',async()=>'',port=>{if(!/^\d+$/.test(port))throw Error('unproven');owner=port;},io()),/unproven/);assert.equal(owner,null);
});
test('sole numeric payload detaches before metadata stringify without wrapper copy',()=>{
 const result={numericPayload:'[[[1],[2]],null]',identity:'unchanged'};const text=detachNumericPayload(result);
 assert.equal(text,'[[[1],[2]],null]');assert.equal(Object.hasOwn(result,'numericPayload'),false);assert.equal(JSON.stringify(result),'{"identity":"unchanged"}');
});
test('numeric recording rejects oversize/nonASCII and leaves no raw property',()=>{
 for(const text of ['1'.repeat(4097),'é']){const result={numericPayload:text};assert.throws(()=>detachNumericPayload(result),/ASCII/);assert.equal(Object.hasOwn(result,'numericPayload'),false);}
});
test('failure without numeric payload remains partial and never classified',()=>{
 const result={numericPayload:null,cleanup:null,errors:['setup failed']};assert.throws(()=>detachNumericPayload(result),/absent/);assert.equal(result.cleanup,null);assert.deepEqual(result.errors,['setup failed']);
});
test('only future graph nonce is admitted',()=>{
 assert.equal(assertFreshGraphNonce(EXPECTED_GRAPH_NONCE),EXPECTED_GRAPH_NONCE);
 assert.throws(()=>assertFreshGraphNonce('stale-nonce-0000'),/Stale/);
});
test('human freshness false until exact actual post-release reply',()=>{
 const fresh={schema:'quest-human-direct-readiness.v1',actualQuote:'ACTUAL-ROOT-REPLY-FIXTURE-TEMP',firstRootObservedAt:'2026-10-17T04:35:00.000000+00:00'};
 assert.equal(assertHumanReadinessFresh(fresh),true);
 assert.throws(()=>assertHumanReadinessFresh({...fresh,firstRootObservedAt:'2026-10-17T04:34:07.757811+00:00'}),/HELD/);
 assert.throws(()=>assertHumanReadinessFresh({...fresh,actualQuote:''}),/HELD/);
 assert.throws(()=>assertHumanReadinessFresh(null),/HELD/);
});
// Actual supplied docs (checked projection; values verbatim from root inputs).
const AUTHORITY={schema:'quest-audio-frame-tags-observed-native-profile.v1',approved:true,phase:'observed-native-profile',profileComplete:true,cleanupQualified:true,metadataOnly:true,graphGo:false,newPageGraphCalls:0,profile:{serial:'2G0YC5ZGB5000J',model:'Quest 3',osBuild:'UP1A.231005.007.A1',androidPackage:'com.oculus.browser',packageUid:10107,product:'OculusBrowser/152.1.0.34.52.1079628208 Chrome/152.0.7977.83',vendorVersion:'152.1.0.34.52.1079628208',chromiumVersion:'152.0.7977.83',protocolVersion:'1.3',revision:'@79460ebecaa5625e57a5fb679a735659e73dc687',userAgent:'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/152.1.0.34.52.1079628208 Chrome/152.0.7977.83 VR Safari/537.36',jsVersion:'15.2.124.13'},profileObservation:{path:'/Volumes/files/src/openclinxr/.openclinxr/slices/quest3-stage1-duplex-immersive-baseline/evidence/audio-frame-tags/native-01/profile-actual-01/profile-observation.json',sha256:'4e3e4ec976b322385fb8500260311ed1989398dcc5941159a8fe9eda5deb2bdd'},planSha256:'600ff4f383a80a65a6a24fbc8653c44f01ae4bb390c2ba0f6711f47e103b7b26',sourceManifestSha256:'d666b359aae50e7d890ee6c3e7976832f8e77c27e1d80f9cf48d95f96772a13c',rawPackageVersionInventory:['versionCode=570601051 minSdk=29 targetSdk=36','versionName=152.1.0.34.52.1079628208','versionCode=570200642 minSdk=29 targetSdk=36','versionName=149.1.0.10.52.1018773393']};
const RAW={schema:'quest-audio-tags-native-profile-result.v1',serial:'2G0YC5ZGB5000J',phase:'profile',errors:[],success:true,newPageGraphCalls:0,model:'Quest 3',osBuild:'UP1A.231005.007.A1',browserPids:'7807',browserUid:'package:com.oculus.browser uid:10107',packageVersion:['versionCode=570601051 minSdk=29 targetSdk=36','versionName=152.1.0.34.52.1079628208','versionCode=570200642 minSdk=29 targetSdk=36','versionName=149.1.0.10.52.1018773393'],httpBrowserVersion:{'Android-Package':'com.oculus.browser',Browser:'OculusBrowser/152.1.0.34.52.1079628208 Chrome/152.0.7977.83','Protocol-Version':'1.3','User-Agent':'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/152.1.0.34.52.1079628208 Chrome/152.0.7977.83 VR Safari/537.36','V8-Version':'15.2.124.13','WebKit-Version':'537.36 (@79460ebecaa5625e57a5fb679a735659e73dc687)'},browserCdpVersion:{version:{protocolVersion:'1.3',product:'OculusBrowser/152.1.0.34.52.1079628208 Chrome/152.0.7977.83',revision:'@79460ebecaa5625e57a5fb679a735659e73dc687',userAgent:'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/152.1.0.34.52.1079628208 Chrome/152.0.7977.83 VR Safari/537.36',jsVersion:'15.2.124.13'},socketClosed:true}};
const REFS={rawProfileSha256:'4e3e4ec976b322385fb8500260311ed1989398dcc5941159a8fe9eda5deb2bdd',planSha256:'600ff4f383a80a65a6a24fbc8653c44f01ae4bb390c2ba0f6711f47e103b7b26',sourceManifestSha256:'d666b359aae50e7d890ee6c3e7976832f8e77c27e1d80f9cf48d95f96772a13c'};
test('actual authority and raw validate together with exact hash joins',()=>{
 assert.equal(validateAuthorityAndRaw(AUTHORITY,RAW,REFS),true);
});
test('changed raw hash is rejected',()=>{
 assert.throws(()=>validateAuthorityAndRaw(AUTHORITY,RAW,{...REFS,rawProfileSha256:'0'.repeat(64)}),/rawProfile/);
});
test('rejected approval is refused',()=>{
 assert.throws(()=>validateAuthorityAndRaw({...AUTHORITY,approved:false},RAW,REFS),/approved/);
});
test('mismatched product is rejected',()=>{
 const bad={...AUTHORITY,profile:{...AUTHORITY.profile,product:'Chrome/149.0.0000.00'}};
 assert.throws(()=>validateAuthorityAndRaw(bad,RAW,REFS),/product/);
});
test('mismatched plan hash is rejected',()=>{
 assert.throws(()=>validateAuthorityAndRaw(AUTHORITY,RAW,{...REFS,planSha256:'1'.repeat(64)}),/planSha256/);
});
test('child inherits min(original 45s, parent remaining minus 1s reserve)',()=>{
 assert.equal(resolveChildBudget(45000,0),44000);
 assert.equal(resolveChildBudget(21000,1000),19000);
});
test('missing parent deadline denies before any owned IO',()=>{
 assert.throws(()=>resolveChildBudget(undefined,0),/bounded/);
 assert.throws(()=>resolveChildBudget('not-a-number',0),/bounded/);
});
test('expired parent deadline denies before any owned IO',()=>{
 assert.throws(()=>resolveChildBudget(5000,5000),/xpired/);
 assert.throws(()=>resolveChildBudget(4000,5000),/xpired/);
});
test('unbounded parent deadline beyond original 45s denies; 46s rejected',()=>{
 assert.throws(()=>resolveChildBudget(46000,0),/beyond original 45s/);
 assert.throws(()=>resolveChildBudget(45001,0),/beyond original 45s/);
 assert.throws(()=>resolveChildBudget(1500,1000),/reserve exhausted/);
});
test('live gate accepts fresh PID without requiring old 7807, rejects absent PID',()=>{
 const live={model:'Quest 3',osBuild:'UP1A.231005.007.A1',uid:'package:com.oculus.browser uid:10107',httpBrowser:'OculusBrowser/152.1.0.34.52.1079628208 Chrome/152.0.7977.83',httpUA:AUTHORITY.profile.userAgent,cdpProduct:'OculusBrowser/152.1.0.34.52.1079628208 Chrome/152.0.7977.83',cdpUA:AUTHORITY.profile.userAgent,currentPid:'9999'};
 assert.equal(assertLiveStableBeforeGraph(live,AUTHORITY.profile),true);
 assert.throws(()=>assertLiveStableBeforeGraph({...live,currentPid:'  '},AUTHORITY.profile),/PID/);
 assert.throws(()=>assertLiveStableBeforeGraph({...live,cdpProduct:'Chrome/149.0.0000.00'},AUTHORITY.profile),/product/);
});
