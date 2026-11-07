#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const E=path.dirname(new URL(import.meta.url).pathname);
const expected={b0:{},s1:{liftoff_depth_gain:0.3},s2:{liftoff_depth_gain:0.0},
  s3:{side_hang:'vertical_then_taut'},s4:{side_hang:'vertical_then_taut',liftoff_depth_gain:0.3},
  s5:{repair_intersections:true}};

function changed(base,style){return Object.fromEntries(Object.keys(style).filter(k=>JSON.stringify(style[k])!==JSON.stringify(base[k])).map(k=>[k,style[k]]));}
function same(a,b){const norm=x=>JSON.stringify(Object.fromEntries(Object.entries(x).sort(([ka],[kb])=>ka.localeCompare(kb))));return norm(a)===norm(b);}
function validate(doc,styles){
  const errors=[];const fixed=doc.fixed||{};
  if(fixed.cap!=='tools/openclinxr/evidence/hair-cap8/cap-v8.npz')errors.push('wrong cap');
  if(fixed.flow!=='tools/openclinxr/evidence/hair-cap8/flow-b-v10.npz')errors.push('wrong flow');
  if(fixed.root_seed!==16)errors.push('wrong seed');
  if(fixed.front_landmarks!=='55,595,512'||fixed.profile_landmarks!=='90,570,200'||fixed.back_landmarks!=='100,650,512')errors.push('mis-registered judge run');
  const base=styles.b0;
  for(const [tag,want]of Object.entries(expected)){
    if(!styles[tag]){errors.push(`missing ${tag}`);continue;}
    const got=changed(base,styles[tag]);
    if(!same(got,want))errors.push(`${tag} style diff ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
  }
  if(styles.s6){
    const seed=doc.s6_seed;if(!['s1','s2','s3','s4'].includes(seed))errors.push('invalid s6 seed');
    else {const want={...changed(base,styles[seed]),repair_intersections:true};const got=changed(base,styles.s6);if(!same(got,want))errors.push(`s6 style diff ${JSON.stringify(got)} != ${JSON.stringify(want)}`);}
  }
  return errors;
}
if(process.argv.includes('--self-test')){
  const base={liftoff_depth_gain:.6,side_hang:'taut',repair_intersections:false};
  const styles={b0:base,s1:{...base,liftoff_depth_gain:.3},s2:{...base,liftoff_depth_gain:0},s3:{...base,side_hang:'vertical_then_taut'},s4:{...base,side_hang:'vertical_then_taut',liftoff_depth_gain:.3},s5:{...base,repair_intersections:true}};
  const doc={fixed:{cap:'tools/openclinxr/evidence/hair-cap8/cap-v8.npz',flow:'tools/openclinxr/evidence/hair-cap8/flow-b-v10.npz',root_seed:16,front_landmarks:'55,595,512',profile_landmarks:'90,570,200',back_landmarks:'100,650,512'}};
  assert.equal(validate(doc,styles).length,0);
  const badStyle=structuredClone(styles);badStyle.s1.side_hang='vertical_then_taut';assert.match(validate(doc,badStyle).join('\n'),/s1 style diff/);
  const badJudge=structuredClone(doc);badJudge.fixed.front_landmarks='auto';assert.match(validate(badJudge,styles).join('\n'),/mis-registered/);
  console.log('SELFTEST PASS: planted G2 style violation and judge mis-registration both rejected');process.exit(0);
}
const doc=JSON.parse(fs.readFileSync(path.join(E,'scoreboard.json'),'utf8'));const styles={};
for(const r of doc.rows)styles[r.tag]=JSON.parse(fs.readFileSync(path.join(E,'cells',r.tag,'style.json'),'utf8'));
const errors=validate(doc,styles);if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`PASS ${doc.rows.length} cells: fixed cap/flow/seed/cameras and exact style diffs`);
