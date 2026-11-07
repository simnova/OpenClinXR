#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));

function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
function hardcoded(files){
  const forbidden=[[55, 595, 512],[90, 570, 200],[100, 650, 512]].map(x=>x.join(','));
  for(const f of files){if(!/\.(py|mjs|json|txt)$/.test(f))continue;const s=fs.readFileSync(f,'utf8');for(const x of forbidden)if(s.includes(x))throw new Error(`hardcoded landmark ${x} in ${path.relative(here,f)}`)}
}
function checkParents(d){
  const mask=d.guideMask,region=d.curtainRegion,weight=d.weight,parents=d.parents;
  for(let i=0;i<region.length;i++)if(region[i]&&weight[i]>=.99)for(const p of parents[i])if(p>=0&&!mask[p])throw new Error(`curtain child ${i} interpolated rear guide ${p}`);
}
function checkStyles(cells){
  const fixed=['seed','roots','points','hem_head_fraction','head_height','front_flow_g1','face_curtain_c0_mm','face_curtain_c1_mm','curtain_blend_band_mm'];
  for(const k of fixed){const v=JSON.stringify(cells[0][k]);for(const c of cells.slice(1))if(JSON.stringify(c[k])!==v)throw new Error(`style drift ${k}`)}
}
function honest(){
  const s=JSON.parse(fs.readFileSync(path.join(here,'scoreboard.json'),'utf8'));const b=s.rows.find(x=>x.tag===s.best);if(!b)throw new Error('missing best row');
  if(b.inside!==0||b.over_eye!==0||b.face_opening!==0)throw new Error('best safety row nonzero');
  if(b.curtain_guides!==148)throw new Error(`curtain guides ${b.curtain_guides}`);
  for(const k of ['front_iou','eroded','width_rms_head','profile','back','ear_cover','stripe_contrast'])if(!Number.isFinite(b[k]))throw new Error(`nonfinite ${k}`);
}
function fixture(){
  const d=JSON.parse(fs.readFileSync(path.join(here,'parent-audit.json'),'utf8'));return d;
}
function selfTest(){
  hardcoded(walk(here));checkParents(fixture());
  const styles=['c1','c2','c3','c4'].map(t=>JSON.parse(fs.readFileSync(path.join(here,'cells',t,'style.json'),'utf8')));checkStyles(styles);honest();let caught=0;
  try{hardcoded([(()=>{const p=path.join(here,'.self-test-landmark.txt');fs.writeFileSync(p,[55, 595, 512].join(','));return p})()])}catch{caught++}finally{fs.rmSync(path.join(here,'.self-test-landmark.txt'),{force:true})}
  try{const x=structuredClone(fixture());const i=x.curtainRegion.findIndex((v,j)=>v&&x.weight[j]>=.99);const rear=x.guideMask.findIndex(v=>!v);x.parents[i][0]=rear;checkParents(x)}catch{caught++}
  try{const x=structuredClone(styles);x[1].seed+=1;checkStyles(x)}catch{caught++}
  if(caught!==3)throw new Error(`planted failures caught ${caught}/3`);
  console.log('SELF_TEST PASS: planted hardcoded landmark, curtain/rear parent leak, and style drift fail; honest best row passes');
}
if(process.argv.includes('--self-test'))selfTest();else{hardcoded(walk(here));checkParents(fixture());honest();console.log('PASS hair-curtain3 honest artifacts');}
