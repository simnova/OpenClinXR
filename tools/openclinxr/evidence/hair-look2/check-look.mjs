#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
export function validate(row){
  const bad=[];
  for(const v of ["front","profile","back"])if(Math.abs(row.deltaIoU[v])>0.01+1e-12)bad.push(`silhouette:${v}`);
  if(row.endP95Deg>10)bad.push("end-tangent");
  if(row.landmarkSource!=="projected:landmarks.json")bad.push("hardcoded-landmark");
  if((row.clumpWeight??0)>=1)bad.push("rope-clump");
  if(row.inside!==0||row.overEye!==0||row.faceOpening!==0||row.standing!==false)bad.push("safety");
  if(row.showThrough>0.03)bad.push("show-through");
  return {ok:bad.length===0,bad};
}
function selfTest(){
  const honest={deltaIoU:{front:-.0042,profile:-.0048,back:-.0029},endP95Deg:3.59,landmarkSource:"projected:landmarks.json",clumpWeight:0,inside:0,overEye:0,faceOpening:0,standing:false,showThrough:.0184};
  if(!validate(honest).ok)throw new Error("honest row rejected");
  const plants=[{name:"silhouette",patch:r=>r.deltaIoU.front=.011},{name:"flipped-end",patch:r=>r.endP95Deg=21},{name:"hardcoded",patch:r=>r.landmarkSource="hardcoded:103,583,512"},{name:"rope",patch:r=>r.clumpWeight=1}];
  for(const p of plants){const r=structuredClone(honest);p.patch(r);if(validate(r).ok)throw new Error(`plant passed:${p.name}`);}
  console.log("CHECK_LOOK_SELF_TEST PASS honest=1 plantedFailures=4");
}
if(process.argv.includes("--self-test"))selfTest();
else{const d=JSON.parse(fs.readFileSync(path.join(here,"scoreboard.json"),"utf8"));let bad=0;for(const r of d.cells.filter(x=>x.decision==="KEPT")){const q=validate(r);console.log(r.tag,q.ok?"PASS":"FAIL",q.bad.join(","));if(!q.ok)bad++;}process.exitCode=bad?1:0;}
