import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCampaignGo, claimCampaign, claimSlot, LAUNCH_FLAGS, PLAN_SHA256, type CampaignGo, type Stage2Manifest } from './campaign-policy.js';
import { STAGE2_PROTOCOL_SHA256 } from '@openclinxr/xr-capacity/stage2';
const identity={browserBundleSha256:'1'.repeat(64),serverSourceSha256:'2'.repeat(64),protocolSha256:STAGE2_PROTOCOL_SHA256,fixtureConfigSha256:'3'.repeat(64),graderSourceSha256:'4'.repeat(64)};
const manifest:Stage2Manifest={schema:'quest-stage2-host-source-manifest.v1',identity,workletSha256:'5'.repeat(64),files:{},served:{}};
const good:CampaignGo={schema:'quest-stage2-host-campaign-go.v1',authorized:true,review:{path:'review.json',sha256:'6'.repeat(64)},campaignPlanSha256:PLAN_SHA256,protocolSha256:STAGE2_PROTOCOL_SHA256,sourceManifestSha256:'7'.repeat(64),identity,workletSha256:manifest.workletSha256,evidenceDirectory:'/owned/new-evidence',environment:{browser:{executablePath:'/owned/existing/chromium',version:'147.0.7727.15',launchFlags:LAUNCH_FLAGS},runtime:{nodeVersion:process.version,pythonVersion:'3.13.15',aiortcVersion:'1.15.0',avVersion:'17.1.0',aiohttpVersion:'3.14.5'}}};
test('exact root media GO matches source/plan/environment/evidence',()=>assert.doesNotThrow(()=>assertCampaignGo(good,manifest,'7'.repeat(64),'/owned/new-evidence')));
test('implementation-only or unapproved GO cannot launch',()=>{for(const bad of [{...good,authorized:false},{...good,schema:'quest-stage2-implementation-release.v1'}])assert.throws(()=>assertCampaignGo(bad as CampaignGo,manifest,'7'.repeat(64),'/owned/new-evidence'),/campaign GO/);});
test('wrong source/worklet/plan/flags/output/review fails before children',()=>{
  for(const bad of [{...good,campaignPlanSha256:'bad'},{...good,sourceManifestSha256:'bad'},{...good,identity:{...identity,serverSourceSha256:'f'.repeat(64)}},{...good,workletSha256:'bad'},{...good,evidenceDirectory:'/different'},{...good,review:{path:'',sha256:''}},{...good,environment:{...good.environment,browser:{...good.environment.browser,launchFlags:[]}}}])assert.throws(()=>assertCampaignGo(bad as CampaignGo,manifest,'7'.repeat(64),'/owned/new-evidence'));
});

test('atomic invocation and nonce claims refuse reuse or concurrent second claim',async()=>{
  const out=await mkdtemp(join(tmpdir(),`stage2-claim-test-${process.pid}-`));
  try{
    const first=await Promise.allSettled([claimCampaign(out,{source:'pure-fixture'}),claimCampaign(out,{source:'pure-fixture'})]);
    assert.equal(first.filter(result=>result.status==='fulfilled').length,1);
    const slot={ordinal:1,mode:'uplink-only',nonce:'11111111-1111-4111-8111-111111111111',state:'UNSTARTED'} as const;
    const claims=await Promise.allSettled([claimSlot(out,slot),claimSlot(out,slot)]);
    assert.equal(claims.filter(result=>result.status==='fulfilled').length,1);
    await assert.rejects(claimSlot(out,slot),/EEXIST/);
  }finally{await rm(out,{recursive:true,force:true});}
});
