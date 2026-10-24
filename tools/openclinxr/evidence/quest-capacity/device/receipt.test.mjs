import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sealQuestCampaign, assertBuildMetadata, assertCampaignBuild } from './receipt.mjs';
const buildIdentity={gitCommit:'a'.repeat(40),capacitySourceHash:'sha256:'+'b'.repeat(64)};
const raw = {schema:'quest-capacity-campaign.v1',runs:[{provenance:'browser-unverified',nativeSession:{forged:true},environment:{revision:buildIdentity.gitCommit,buildHash:buildIdentity.capacitySourceHash},configuration:{axes:{}}}]};
const evidence = {buildIdentity,expectedBuildHash:buildIdentity.capacitySourceHash,device:{state:'device',model:'Quest 3',serial:'exact',ownedTargetId:'target',nonce:'nonce',emulationApplied:false,cdpVersion:{browser:'OculusBrowser/152'}},expectedUrl:'https://localhost/?capacityNonce=nonce',runtime:{url:'https://localhost/?capacityNonce=nonce',userAgent:'Quest'}};
test('requires external device plus exact owned URL nonce; UA alone fails', () => {
  assert.throws(() => sealQuestCampaign(raw, {...evidence,device:{}}));
  assert.throws(() => sealQuestCampaign(raw, {...evidence,expectedUrl:'https://localhost/?capacityNonce=other'}));
  assert.throws(() => sealQuestCampaign(raw, {...evidence,runtime:{...evidence.runtime,url:'https://other/'}}));
});
test('sealed clone binds hash and strips native assertions without mutating raw input', () => {
  const {campaign,receipt}=sealQuestCampaign(raw,evidence);
  assert.equal(campaign.runs[0].provenance,'quest-browser');
  assert.equal(campaign.runs[0].nativeSession,null);
  assert.equal(raw.runs[0].provenance,'browser-unverified');
  assert.equal(receipt.rawCampaignSha256.length,64);
  assert.equal(receipt.worn,'unobserved');
});

test('rejects unknown or missing runtime source hashes',()=>{
  for(const metadata of [null,{gitCommit:'unknown',capacitySourceHash:'unknown'},{gitCommit:'a'.repeat(40),capacitySourceHash:'unavailable'}]) assert.throws(()=>assertBuildMetadata(metadata));
});
test('external expected build must exactly match served metadata',()=>{
  assert.throws(()=>assertBuildMetadata(buildIdentity,'sha256:'+'c'.repeat(64)));
  assert.equal(assertBuildMetadata(buildIdentity,buildIdentity.capacitySourceHash).capacitySourceHash,buildIdentity.capacitySourceHash);
});
test('rejects mixed stale run revisions or hashes before sealing',()=>{
  const mixed=structuredClone(raw);mixed.runs.push(structuredClone(raw.runs[0]));mixed.runs[1].environment.buildHash='unknown';
  assert.throws(()=>assertCampaignBuild(mixed,buildIdentity));
  mixed.runs[1].environment.buildHash=buildIdentity.capacitySourceHash;mixed.runs[1].environment.revision='c'.repeat(40);
  assert.throws(()=>assertCampaignBuild(mixed,buildIdentity));
  assert.throws(()=>assertCampaignBuild({runs:[]},buildIdentity));
});

test('accepts declared abbreviated Git revision while binding full source SHA256',()=>{
  assert.equal(assertBuildMetadata({...buildIdentity,gitCommit:'4ae790edda0f'},buildIdentity.capacitySourceHash).gitCommit,'4ae790edda0f');
  assert.throws(()=>assertBuildMetadata({...buildIdentity,gitCommit:'unknown'}));
});
