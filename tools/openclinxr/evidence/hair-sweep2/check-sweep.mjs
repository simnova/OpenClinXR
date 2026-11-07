#!/usr/bin/env node
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const E=path.dirname(new URL(import.meta.url).pathname);
const expected={b1:{},h1:{hem_head_fraction:.5715},c1:{child_front_fill:true},f1:{front_comb_scale:.5},
  f2:{front_comb_scale:0,front_comb_ramp:true},l1:{root_lift_mm:6},l2:{root_lift_mm:12},
  k1:{part_same_side_ahead_only:true}};
const allowed=new Set(['hem_head_fraction','child_front_fill','front_comb_scale','front_comb_ramp','root_lift_mm','part_same_side_ahead_only']);
function changed(base,style){return Object.fromEntries(Object.keys(style).filter(k=>JSON.stringify(style[k])!==JSON.stringify(base[k])).map(k=>[k,style[k]]));}
function same(a,b){const norm=x=>JSON.stringify(Object.fromEntries(Object.entries(x).sort(([ka],[kb])=>ka.localeCompare(kb))));return norm(a)===norm(b);}
function validate(doc,styles){
 const errors=[],fixed=doc.fixed||{};
 if(fixed.cap!=='tools/openclinxr/evidence/hair-cap8/cap-v8.npz')errors.push('wrong cap');
 if(fixed.flow!=='tools/openclinxr/evidence/hair-cap8/flow-b-v10.npz')errors.push('wrong flow');
 if(fixed.root_seed!==16)errors.push('wrong seed');
 if(fixed.front_landmarks!=='55,595,512'||fixed.profile_landmarks!=='90,570,200'||fixed.back_landmarks!=='100,650,512')errors.push('mis-registered judge run');
 const base=styles.b1;
 for(const [tag,want]of Object.entries(expected)){if(!styles[tag]){errors.push(`missing ${tag}`);continue;}const got=changed(base,styles[tag]);if(!same(got,want))errors.push(`${tag} style diff ${JSON.stringify(got)} != ${JSON.stringify(want)}`);}
 if(!styles.x1)errors.push('missing x1');else {const got=changed(base,styles.x1);if(!Object.keys(got).length)errors.push('x1 has no change');for(const k of Object.keys(got))if(!allowed.has(k))errors.push(`x1 disallowed key ${k}`);}
 return errors;
}
if(process.argv.includes('--self-test')){
 const base={hem_head_fraction:.73,child_front_fill:false,front_comb_scale:1,front_comb_ramp:false,root_lift_mm:0,part_same_side_ahead_only:false};
 const styles={b1:base,h1:{...base,hem_head_fraction:.5715},c1:{...base,child_front_fill:true},f1:{...base,front_comb_scale:.5},f2:{...base,front_comb_scale:0,front_comb_ramp:true},l1:{...base,root_lift_mm:6},l2:{...base,root_lift_mm:12},k1:{...base,part_same_side_ahead_only:true},x1:{...base,hem_head_fraction:.5715}};
 const doc={fixed:{cap:'tools/openclinxr/evidence/hair-cap8/cap-v8.npz',flow:'tools/openclinxr/evidence/hair-cap8/flow-b-v10.npz',root_seed:16,front_landmarks:'55,595,512',profile_landmarks:'90,570,200',back_landmarks:'100,650,512'}};
 assert.equal(validate(doc,styles).length,0);const bad=structuredClone(styles);bad.h1.root_lift_mm=6;assert.match(validate(doc,bad).join('\n'),/h1 style diff/);
 const badJudge=structuredClone(doc);badJudge.fixed.front_landmarks='auto';assert.match(validate(badJudge,styles).join('\n'),/mis-registered/);
 console.log('SELFTEST PASS: planted style drift and judge mis-registration both rejected');process.exit(0);
}
const doc=JSON.parse(fs.readFileSync(path.join(E,'scoreboard.json'),'utf8')),styles={};
for(const r of doc.rows)styles[r.tag]=JSON.parse(fs.readFileSync(path.join(E,'cells',r.tag,'style.json'),'utf8'));
const errors=validate(doc,styles);if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`PASS ${doc.rows.length} cells: fixed cap/seed/cameras and exact stated style diffs`);
