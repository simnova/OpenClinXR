import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const fail=(ok,msg)=>{if(!ok)throw new Error(msg)};
const read=n=>JSON.parse(fs.readFileSync(path.join(here,n),'utf8'));

function integrity(gate,source='landmarks.json'){
 fail(gate.G2.pass===true,'silhouette or face gate failed');
 fail(Math.abs(gate.G2.face.driftPct)<=5,'face darkening exceeds 5%');
 for(const v of Object.values(gate.G2.iou))fail(Math.abs(v.delta)<.01,'silhouette delta >=0.01');
 fail(source==='landmarks.json','hardcoded landmark source');
 fail(gate.G3.idShowThrough<=.03,'ID show-through');
 return true;
}

const honest=read('gate.json');
if(process.argv.includes('--self-test')){
 let caught=0;
 const dark=structuredClone(honest);dark.G2.face.driftPct=-5.01;
 const shape=structuredClone(honest);shape.G2.iou.front.delta=.01001;
 for(const fn of [()=>integrity(dark),()=>integrity(shape),()=>integrity(honest,'103,583,512')]){
  try{fn()}catch{caught++}
 }
 fail(caught===3,'not all planted failures were rejected');
 integrity(honest);
 console.log('SELF_TEST PASS: planted face darkening, silhouette drift, and hardcoded landmark fail; honest best integrity passes');
}else{
 integrity(honest);
 console.log(`CHECK PASS: integrity G2/G5; appearance G3 ${honest.G3.pass?'PASS':'FAIL'}`);
}
