import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const baseline=JSON.parse(readFileSync(new URL('./baseline.json',import.meta.url),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function canonicalJson(v){if(v===null||typeof v!=='object')return JSON.stringify(v)??'null';if(Array.isArray(v))return `[${v.map(canonicalJson).join(',')}]`;return `{${Object.entries(v).filter(([,x])=>x!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>`${JSON.stringify(k)}:${canonicalJson(x)}`).join(',')}}`;}
export function revision(r){const keys=['planId','run','case','bundle','instances','revisions','variation','resolvedLayout','arrival','eventOrder','dialogueTurnIds'];return `plan-v1-${hash(canonicalJson(Object.fromEntries(keys.map(k=>[k,r[k]])))).slice(0,32)}`;}
export function parseRecords(text){const m=text.match(/Object\.freeze\(([\s\S]*) as Record/);assert(m,'generated record syntax absent');return JSON.parse(m[1]);}
export function validate(records,readBytes){
 assert.deepEqual(Object.keys(records).sort(),Object.keys(baseline.records).sort(),'case set changed');
 for(const [id,old] of Object.entries(baseline.records)){
  if(id!==baseline.caseId){assert.deepEqual(records[id],old,'other case record changed');continue;}
  const r=structuredClone(records[id]);assert(r,'required case absent');
  for(const i of r.instances.filter(i=>i.kind==='actor')){
   const b=readBytes(i.assetPath);const approved=baseline.actualAssets[i.assetPath];assert(approved,'unapproved actor path');
   assert.equal(hash(b),approved.sha256,'asset bytes changed during requalification');assert.equal(b.length,approved.bytes,'asset byte count changed');
   assert.equal(i.assetSha256,approved.sha256,`${i.instanceId}: stale asset digest`);assert.equal(i.byteCount,approved.bytes,'frozen byte count stale');
  }
  // Mirror the pinned production revision algorithm; existing consumer separately checks replay.
  assert.equal(r.planRevision,revision(r),'plan revision does not derive from decisions');
  assert.equal(r.acknowledgment.acknowledgedPlanRevision,r.planRevision,'acknowledgment does not bind new plan revision');
  r.planRevision=old.planRevision;r.acknowledgment.acknowledgedPlanRevision=old.acknowledgment.acknowledgedPlanRevision;
  for(const i of r.instances){if(i.kind==='actor'){const prior=old.instances.find(x=>x.instanceId===i.instanceId);assert(prior,'new actor');i.assetSha256=prior.assetSha256;i.byteCount=prior.byteCount;}}
  assert.deepEqual(r,old,'unrelated target-case semantics changed (including seed, geometry, route and historical dates)');
 }
}
export function verifyTree(root){
 for(const [p,expected] of Object.entries(baseline.pins))assert.equal(hash(readFileSync(path.join(root,p))),expected,`protected source changed: ${p}`);
 validate(parseRecords(readFileSync(path.join(root,baseline.recordPath),'utf8')),p=>readFileSync(path.join(root,p)));
 return {ok:true,caseId:baseline.caseId,actors:Object.keys(baseline.actualAssets).length,pins:Object.keys(baseline.pins).length,scope:'disk identity and unchanged freeze semantics; actual producer provenance reviewed separately'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){console.log(JSON.stringify(verifyTree(path.resolve(process.argv[2]??'.')),null,2));}
