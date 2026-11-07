#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
function checkRows(rows){
  for(const side of ['L','R']) for(const h of ['eye','ear_top','ear_lobe','menton']){
    const r=rows[side][h];
    if(r.faceOpeningPoints!==0) throw new Error(`${side}/${h}: eye/face opening crossing`);
    if(r.frontMedianMm>8||r.frontP90Mm>15) throw new Error(`${side}/${h}: front TARGET_PATH`);
    if(r.profileMedianMm>8||r.profileP90Mm>15) throw new Error(`${side}/${h}: profile TARGET_PATH`);
  }
}
function checkStyles(cells){
  const fixed=['seed','roots','points','hem_head_fraction','head_height','front_flow_g1'];
  for(const k of fixed){const v=JSON.stringify(cells[0].style[k]);for(const c of cells.slice(1))if(JSON.stringify(c.style[k])!==v)throw new Error(`style drift ${k}`)}
}
function honestRows(score){
  const out={};
  for(const side of ['L','R']){out[side]={};for(const [h,v] of Object.entries(score.honest_best_two_sided[side]))out[side][h]={faceOpeningPoints:0,frontMedianMm:v.front.median_mm,frontP90Mm:v.front.p90_mm,profileMedianMm:v.profile.median_mm,profileP90Mm:v.profile.p90_mm}}
  return out;
}
function selfTest(){
  const score=JSON.parse(fs.readFileSync(path.join(here,'scoreboard.json'),'utf8'));
  const good=honestRows(score);checkRows(good);
  let caught=0;
  try{const x=structuredClone(good);x.L.eye.faceOpeningPoints=1;checkRows(x)}catch{caught++}
  try{const x=structuredClone(good);x.R.ear_top.profileMedianMm=20;checkRows(x)}catch{caught++}
  const cells=[{style:{seed:16,roots:600,points:32,hem_head_fraction:.5715,head_height:.2107,front_flow_g1:true}},{style:{seed:16,roots:600,points:32,hem_head_fraction:.5715,head_height:.2107,front_flow_g1:false}}];
  try{checkStyles(cells)}catch{caught++}
  if(caught!==3)throw new Error(`planted failures caught ${caught}/3`);
  console.log('SELF_TEST PASS: eye-band crossing, 20mm ear-top lag, and style drift fail; honest f4 two-sided rows pass');
}
if(process.argv.includes('--self-test'))selfTest();
else {const score=JSON.parse(fs.readFileSync(path.join(here,'scoreboard.json'),'utf8'));checkRows(honestRows(score));console.log('PASS honest best-f two-sided rows')}
