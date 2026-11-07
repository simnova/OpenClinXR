import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));const fail=(ok,msg)=>{if(!ok)throw new Error(msg)};
function checkLandmarks(text){for(const triple of ['103,583,512','131,561,209','155,651,512'])fail(!text.replaceAll(' ','').includes(triple),'hardcoded landmark '+triple)}
function checkStyle(a,b){for(const k of ['seed','roots','points','hem_head_fraction','head_height','front_flow_g1'])fail(JSON.stringify(a[k])===JSON.stringify(b[k]),'style drift '+k)}
function checkSeam(rows){fail(rows.length===4,'four seam heights required');for(const r of rows)fail(r.ratio>=.85,'seam density hole row '+r.row+' ratio '+r.ratio)}
const board=JSON.parse(fs.readFileSync(path.join(here,'scoreboard.json')));const best=board.rows.find(r=>r.tag===board.best);fail(best,'best row missing');
const s0=JSON.parse(fs.readFileSync(path.join(here,'cells/b5/style.json'))),s1=JSON.parse(fs.readFileSync(path.join(here,`cells/${board.best}/style.json`)));
for(const f of ['diagnose.py','children.py','analyze.py'])checkLandmarks(fs.readFileSync(path.join(here,f),'utf8'));
checkStyle(s0,s1);checkSeam(best.seamDensity);fail(best.guideDiffTotal===0,'guide geometry drift');fail(best.inside===0,'inside after final audit');fail(best.overEye===0&&best.faceOpening===0,'face opening violation');fail(best.standing===false,'standing hair');
let caught=0;for(const fn of [()=>checkSeam(best.seamDensity.map((r,i)=>i===2?{...r,ratio:.4}:r)),()=>checkLandmarks('camera = 103, 583, 512'),()=>checkStyle(s0,{...s1,seed:s1.seed+1})]){try{fn()}catch{caught++}}
fail(caught===3,'planted seam/hardcoded/style failures not all rejected');console.log(`SELF_TEST PASS: planted seam hole, hardcoded landmark, and style drift fail; honest ${board.best} passes`);
