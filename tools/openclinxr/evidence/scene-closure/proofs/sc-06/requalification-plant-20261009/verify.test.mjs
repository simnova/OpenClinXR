import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';import {baseline,validate,verifyTree,revision} from './verify.mjs';
const root=process.env.SC06_TREE_ROOT??process.cwd();
const readActual=p=>readFileSync(`${root}/${p}`);
// Deterministic historical asset objects: the exact bytes pinned by baseline.actualAssets,
// recovered read-only from the frozen sourceHead. The live tree has since been rebaked, so
// semantics tests must not read live-disk bytes (they would mask the intended gate with
// 'asset bytes changed'). Production staleness stays RED outside unit tests.
const historicalHead='a83246b4a2d0efae62843aaaad6a614675946746';
const historicalCache=new Map();
const readHistorical=p=>{let b=historicalCache.get(p);if(!b){b=Buffer.from(execFileSync('git',['show',`${historicalHead}:${p}`],{cwd:root,maxBuffer:64*1024*1024}));const approved=baseline.actualAssets[p];assert(approved,`unapproved actor path in historical fixture: ${p}`);assert.equal(b.length,approved.bytes,`historical byte count drift: ${p} @ ${historicalHead}`);assert.equal(createHash('sha256').update(b).digest('hex'),approved.sha256,`historical bytes do not match pinned digest: ${p} @ ${historicalHead}`);historicalCache.set(p,b);}return b;};
const good=()=>{const rs=structuredClone(baseline.records);for(const i of rs[baseline.caseId].instances.filter(i=>i.kind==='actor')){const a=baseline.actualAssets[i.assetPath];i.assetSha256=a.sha256;i.byteCount=a.bytes;}rs[baseline.caseId].planRevision=revision(rs[baseline.caseId]);rs[baseline.caseId].acknowledgment.acknowledgedPlanRevision=rs[baseline.caseId].planRevision;return rs;};
test('unchanged actual source is RED for stale gown identity',()=>assert.throws(()=>validate(baseline.records,readHistorical),/stale asset digest/));
test('corrected identity fixture passes same validator (not producer or actual acceptance)',()=>assert.doesNotThrow(()=>validate(good(),readHistorical)));
test('same-size changed asset bytes fail',()=>assert.throws(()=>validate(good(),p=>{const b=Buffer.from(readHistorical(p));b[0]^=1;return b;}),/asset bytes changed/));
test('live disk bytes are refused by the frozen proof (production staleness, not unit acceptance)',()=>assert.throws(()=>validate(good(),readActual),/asset bytes changed/));
test('seed change fails',()=>{const r=good();r[baseline.caseId].variation.seed='f'.repeat(64);r[baseline.caseId].planRevision=revision(r[baseline.caseId]);r[baseline.caseId].acknowledgment.acknowledgedPlanRevision=r[baseline.caseId].planRevision;assert.throws(()=>validate(r,readHistorical),/semantics changed/);});
test('historical dates cannot be redated',()=>{const r=good();r[baseline.caseId].acknowledgment.acknowledgedAtIso='2026-10-09T00:00:00.000Z';r[baseline.caseId].planRevision=revision(r[baseline.caseId]);r[baseline.caseId].acknowledgment.acknowledgedPlanRevision=r[baseline.caseId].planRevision;assert.throws(()=>validate(r,readHistorical),/semantics changed/);});
test('extra case cannot be silently added',()=>{const r=good();r.fake=structuredClone(r[baseline.caseId]);assert.throws(()=>validate(r,readHistorical),/case set changed/);});
test('other actor hash cannot be dropped',()=>{const r=good();delete r[baseline.caseId].instances.find(i=>i.contentId==='ward_nurse_patel_v1').assetSha256;assert.throws(()=>validate(r,readHistorical),/stale asset digest/);});

test('stale acknowledgment fails after new plan revision',()=>{const r=good();r[baseline.caseId].acknowledgment.acknowledgedPlanRevision=baseline.records[baseline.caseId].planRevision;assert.throws(()=>validate(r,readHistorical),/acknowledgment does not bind/);});

test('forged revision with matching acknowledgment fails',()=>{const r=good();r[baseline.caseId].planRevision='plan-v1-forged';r[baseline.caseId].acknowledgment.acknowledgedPlanRevision='plan-v1-forged';assert.throws(()=>validate(r,readHistorical),/plan revision does not derive/);});
