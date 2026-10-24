// Small host-only ownership boundary; used by the native graph runner and fault fixtures.
// Pure Phase2 preflight validators stay here so node --test covers them without device IO.
// ROOT absolute /Volumes/files/src/openclinxr is intentional in graph.mjs: browser bytes,
// lease/output/Playwright live there. Never derive a worktree ROOT.
export const EXPECTED_GRAPH_NONCE='fa298a26-f127-4b8e-a331-2e0599e965f2';
export const EXPECTED_NATIVE_PRODUCT='OculusBrowser/152.1.0.34.52.1079628208 Chrome/152.0.7977.83';
export const HUMAN_RELEASED_AT='2026-10-17T04:34:07.757811Z';
// Whole original external 45s is fixed; 46s expansion rejected. The parent shares its absolute
// wall deadline via QUEST_NATIVE_PARENT_DEADLINE_UNIX_MS; the child derives every internal
// budget from it and keeps a 1s reserve for the parent receipt/final-clock fsync.
export const WHOLE_MAX_MS=45000;
export const PARENT_RESERVE_MS=1000;
export function resolveChildBudget(parentDeadlineUnixMs,nowUnixMs=Date.now()){
  const parentMs=Number(parentDeadlineUnixMs);
  if(!Number.isFinite(parentMs))throw Error('Child --execute requires bounded QUEST_NATIVE_PARENT_DEADLINE_UNIX_MS; deny before owned IO');
  const nowMs=Number(nowUnixMs);
  if(!Number.isFinite(nowMs))throw Error('Unusable wall clock; deny before owned IO');
  const remainingMs=parentMs-nowMs;
  if(!(remainingMs>0))throw Error('Missing/expired parent deadline; deny before owned IO');
  if(remainingMs>WHOLE_MAX_MS)throw Error('Unbounded parent deadline beyond original 45s; deny before owned IO');
  const wholeMs=Math.min(WHOLE_MAX_MS,remainingMs-PARENT_RESERVE_MS);
  if(!(wholeMs>0))throw Error('Parent wall remaining minus 1s reserve exhausted; deny before owned IO');
  return wholeMs;
}
export function assertFreshGraphNonce(nonce){
  if(nonce!==EXPECTED_GRAPH_NONCE)throw Error('Stale/superseded graph nonce; only fa298a26-f127-4b8e-a331-2e0599e965f2 permitted');
  return nonce;
}
// Human freshness stays false until the exact actual new reply arrives after ALL source
// reviews/preparation. The bound actual release is human-release-during-preparation-01.json
// at HUMAN_RELEASED_AT; a vague nonempty quote never suffices — firstRootObservedAt must
// follow that release and Root issues the actual readiness doc.
export function assertHumanReadinessFresh(doc){
  if(!doc||doc.schema!=='quest-human-direct-readiness.v1')throw Error('HELD: exact fresh human-readiness schema required');
  if(typeof doc.actualQuote!=='string'||doc.actualQuote.length===0)throw Error('HELD: actual human quote absent; freshness false until exact actual new reply');
  const observed=Date.parse(doc.firstRootObservedAt);
  if(!(observed>Date.parse(HUMAN_RELEASED_AT)))throw Error('HELD: firstRootObservedAt must follow bound release 2026-10-17T04:34:07.757811Z');
  return true;
}
// Exact authority-vs-raw validator. observedProfile is the approved independent authority doc
// (nested profile); rawProfile is the successful profile-observation.json. All live comparison
// fields come from rawProfile. Raw package lines are preserved as evidence (exact array
// equality); no substring '152'/'149' logic and no causal claim.
export function validateAuthorityAndRaw(authority,raw,refs){
  const fail=why=>{throw Error(why);};
  if(!authority||authority.schema!=='quest-audio-frame-tags-observed-native-profile.v1')fail('Authority schema');
  if(authority.approved!==true)fail('Authority not approved');
  if(authority.phase!=='observed-native-profile')fail('Authority phase');
  if(authority.profileComplete!==true)fail('Authority profileComplete');
  if(authority.cleanupQualified!==true)fail('Authority cleanupQualified');
  if(authority.metadataOnly!==true)fail('Authority metadataOnly');
  if(authority.graphGo!==false)fail('Profile metadata authority does not authorize graph; graphGo must be false');
  if(authority.newPageGraphCalls!==0)fail('Authority newPageGraphCalls');
  if(!refs||authority.profileObservation?.sha256!==refs.rawProfileSha256)fail('Authority profileObservation sha256 must equal config rawProfile sha256');
  if(authority.planSha256!==refs.planSha256)fail('Authority planSha256 must equal config plan sha256');
  if(authority.sourceManifestSha256!==refs.sourceManifestSha256)fail('Authority sourceManifestSha256 must equal config sourceManifest sha256');
  if(!raw||raw.schema!=='quest-audio-tags-native-profile-result.v1')fail('Raw schema');
  if(raw.success!==true)fail('Raw not successful');
  if(raw.phase!=='profile')fail('Raw phase');
  if(raw.serial!=='2G0YC5ZGB5000J')fail('Raw serial');
  if(raw.newPageGraphCalls!==0)fail('Raw newPageGraphCalls');
  if(!Array.isArray(raw.errors)||raw.errors.length!==0)fail('Raw errors');
  const p=authority.profile;
  if(!p)fail('Authority nested profile absent');
  if(p.serial!==raw.serial)fail('Authority nested serial must equal raw serial');
  if(p.model!==raw.model)fail('Authority model must equal raw model');
  if(p.osBuild!==raw.osBuild)fail('Authority osBuild must equal raw osBuild');
  if(p.androidPackage!==raw.httpBrowserVersion?.['Android-Package'])fail('Authority androidPackage must equal raw Android-Package');
  if(typeof p.packageUid!=='number'||typeof raw.browserUid!=='string'||!raw.browserUid.includes('uid:'+String(p.packageUid)))fail('Authority packageUid must bind raw browserUid');
  if(p.product!==raw.httpBrowserVersion?.Browser)fail('Authority product must equal raw HTTP Browser');
  if(p.product!==raw.browserCdpVersion?.version?.product)fail('Authority product must equal raw CDP product');
  if(p.protocolVersion!==raw.httpBrowserVersion?.['Protocol-Version'])fail('Authority protocol must equal raw Protocol-Version');
  if(p.protocolVersion!==raw.browserCdpVersion?.version?.protocolVersion)fail('Authority protocol must equal raw CDP protocolVersion');
  if(p.revision!==raw.browserCdpVersion?.version?.revision)fail('Authority revision must equal raw CDP revision');
  if(p.userAgent!==raw.httpBrowserVersion?.['User-Agent'])fail('Authority UA must equal raw User-Agent');
  if(p.userAgent!==raw.browserCdpVersion?.version?.userAgent)fail('Authority UA must equal raw CDP userAgent');
  if(p.jsVersion!==raw.httpBrowserVersion?.['V8-Version'])fail('Authority jsVersion must equal raw V8-Version');
  if(p.jsVersion!==raw.browserCdpVersion?.version?.jsVersion)fail('Authority jsVersion must equal raw CDP jsVersion');
  if(JSON.stringify(authority.rawPackageVersionInventory)!==JSON.stringify(raw.packageVersion))fail('Raw package lines must be preserved exactly as evidence');
  return true;
}
// Live re-observation gate before graph: model/build/UID stable match plus BOTH fresh HTTP
// Browser and CDP product+UA against the approved nested profile. currentPID is observed
// nonempty metadata only; old PID 7807 is never required to persist.
export function assertLiveStableBeforeGraph(live,nested){
  if(!live||typeof live.model!=='string'||live.model!==nested.model)throw Error('Live model changed');
  if(live.osBuild!==nested.osBuild)throw Error('Live build changed');
  if(typeof live.uid!=='string'||!live.uid.includes('uid:'+String(nested.packageUid)))throw Error('Live package UID changed');
  if(live.httpBrowser!==nested.product||live.cdpProduct!==nested.product)throw Error('Live HTTP/CDP product changed');
  if(live.httpUA!==nested.userAgent||live.cdpUA!==nested.userAgent)throw Error('Live HTTP/CDP UA changed');
  if(typeof live.currentPid!=='string'||live.currentPid.trim().length===0)throw Error('Current PID observation absent; metadata only');
  return true;
}
export async function normalOwned(label, make, register, io) {
  io.admit();
  io.record(label+'-begin',{});
  const value=await io.step(async()=>{
    const result=await make();
    // Birth is recorded locally before deadline recheck or fallible result persistence.
    if(register)register(result);
    return result;
  });
  io.record(label+'-result',value);
  return value;
}
export async function cleanupOwned(label, make, io) {
  try {
    try{io.record(label+'-cleanup-begin',{});}catch{}
    await io.step(make,true);
    try{io.record(label+'-cleanup-done',{});}catch{}
  }catch(error){io.error(label+' cleanup:'+String(error));}
}
export function detachNumericPayload(result) {
  if(typeof result?.numericPayload!=='string')throw Error('Complete numeric payload absent; preserve partial/unexercised result');
  const payload=result.numericPayload;
  delete result.numericPayload;
  if(payload.length>4096||!/^[\x00-\x7f]*$/.test(payload))throw Error('Sole ASCII numeric payload bound');
  return payload;
}
