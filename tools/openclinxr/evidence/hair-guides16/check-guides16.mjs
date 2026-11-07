import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const DIR=dirname(fileURLToPath(import.meta.url));
function arg(k){const i=process.argv.indexOf(k);return i<0?null:process.argv[i+1];}
function check(r){const f=[];
 if((r.g1?.p95_mm??999)>.5||(r.g1?.max_mm??999)>2)f.push("G1");
 if((r.count??0)<.95*(r.n_roots??1)||!r.g2?.pts32||(r.g2?.nan??1)!==0||(r.g2?.short??1)!==0)f.push("G2");
 if((r.g3?.behind_viol??1)!==0||(r.g3?.front??1)!==0)f.push("G3");
 if((r.g4?.inside??99)>5||(r.g4?.deep_mm??99)>1)f.push("G4");
 if((r.g5?.nape_edge_frac??1)>.10||(r.g5?.front_lo??99)>.02*(r.count??0)||(r.g5?.back_band_mm??0)<25)f.push("G5");
 if((r.g6?.backfill_ratio??0)<.90||(r.g6?.travel_viol??1)!==0)f.push("G6");
 if((r.g7?.horiz??99)>.01*(r.count??0))f.push("G7");
 if((r.g8?.cover?.L??0)<.90||(r.g8?.cover?.R??0)<.90||(r.g8?.face??1)!==0)f.push("G8");
 if((r.g9?.hem_bad??1)!==0)f.push("G9"); return [...new Set(f)];}
function honest(){return {count:590,n_roots:600,g1:{p95_mm:0,max_mm:0},g2:{pts32:true,nan:0,short:0},g3:{behind_viol:0,front:0},g4:{inside:0,deep_mm:0},g5:{nape_edge_frac:.01,front_lo:1,back_band_mm:40},g6:{backfill_ratio:1,travel_viol:0},g7:{horiz:0},g8:{cover:{L:.95,R:.95},face:0},g9:{hem_bad:0}};}
if(process.argv.includes("--self-test")){const cases=[["G1",r=>r.g1.max_mm=3],["G2",r=>r.count=400],["G3",r=>r.g3.front=1],["G4",r=>r.g4.inside=6],["G5",r=>r.g5.back_band_mm=2],["G6",r=>r.g6.backfill_ratio=.2],["G7",r=>r.g7.horiz=20],["G8",r=>r.g8.cover.L=.2],["G9",r=>r.g9.hem_bad=1]];let bad=check(honest()).length;for(const [g,mut] of cases){const r=honest();mut(r);const got=check(r);console.log(`${g} ${got.includes(g)?"CAUGHT":"MISSED"}`);if(!got.includes(g))bad++;}if(bad)process.exit(1);console.log("SELF-TEST honest row passes; every planted gate violation fails");process.exit(0);}
const p=arg("--row")||join(DIR,"row-guides16.json");const doc=JSON.parse(readFileSync(p));let any=[];for(const r of doc.runs){const f=check(r);console.log(`${r.name}: ${f.length?"MISS "+f.join(","):"PASS"}`);any.push(...f);}if(any.length)process.exit(1);
