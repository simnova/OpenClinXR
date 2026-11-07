import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const fail=(ok,msg)=>{if(!ok)throw new Error(msg)};
function checkLandmarks(text){
 for(const triple of ['103,583,512','131,561,209','155,651,512'])fail(!text.replaceAll(' ','').includes(triple),'hardcoded landmark '+triple);
}
function checkStyle(a,b){for(const k of ['seed','roots','points','hem_head_fraction','head_height','front_flow_g1'])fail(JSON.stringify(a[k])===JSON.stringify(b[k]),'style drift '+k)}
function checkStrand(points,skinDistanceMm=3){
 const eye=points.some(p=>Math.abs(p.x)<44.5&&p.z>=1.449&&p.z<=1.572&&p.y<-.039);
 fail(!eye,'strand through eye/brow box');fail(skinDistanceMm<=8,'forehead strand floating >8mm');
}
const d1=JSON.parse(fs.readFileSync(path.join(here,'cells/d1/guide-report.json')));
const s0=JSON.parse(fs.readFileSync(path.join(here,'cells/b4/style.json'))),s1=JSON.parse(fs.readFileSync(path.join(here,'cells/d1/style.json')));
for(const f of ['diagnose.py','face_curtain.py','children.py'])checkLandmarks(fs.readFileSync(path.join(here,f),'utf8'));
checkStyle(s0,s1);fail(d1.inside===0&&d1.overEye===0&&d1.faceOpening===0&&d1.horizontal===0,'honest guide gate');
for(const row of d1.table.filter(r=>r.row===244||r.row===298))fail(row.deltaMm>=0&&row.deltaMm<=5,'honest relative target row '+row.row);
fail(d1.table.find(r=>r.row===190).guideInnerMm*2<=6,'part gap');
let caught=0;for(const fn of [
 ()=>checkStrand([{x:0.01,y:-.14,z:1.55}],3),
 ()=>checkStrand([{x:0.06,y:-.14,z:1.60}],9),
 ()=>checkLandmarks('x=103, 583, 512'),
 ()=>checkStyle(s0,{...s1,seed:s1.seed+1})]){try{fn()}catch{caught++}}
fail(caught===4,'planted failures not all rejected');checkStrand([{x:.06,y:-.14,z:1.60}],3);
console.log('SELF_TEST PASS: planted eye-box strand, floating forehead strand, hardcoded landmark, and style drift fail; honest d1 rows pass');
