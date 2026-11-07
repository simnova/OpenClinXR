#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
function readRows(){return readFileSync(join(here,'lineage.jsonl'),'utf8').trim().split(/\n+/).filter(Boolean).map(JSON.parse)}
function validate(rows,best){
  assert.ok(rows.length>=40,`lineage has ${rows.length} evaluations; need at least 40`);
  assert.equal(new Set(rows.map(r=>r.index)).size,rows.length,'duplicate lineage indices');
  assert.ok(rows.every(r=>Number(r.renderSeconds)>0),'every renderSeconds must be > 0');
  const min=Math.min(...rows.map(r=>r.fitness)); assert.ok(Math.abs(best.fitness-min)<1e-12,'best.json fitness is not lineage minimum');
}
function recompute(beauty,id,chinPx){const py=String.raw`
import json,sys,numpy as np
from PIL import Image
rgb=np.asarray(Image.open(sys.argv[1]).convert('RGB'),dtype=np.float64)/255.; a=np.asarray(Image.open(sys.argv[2]).convert('RGBA'),dtype=np.float64)[...,3]/255.; m=a>=.9
px=rgb[m]; lum=.2126*px[:,0]+.7152*px[:,1]+.0722*px[:,2]; p=np.percentile(lum,[10,50,90]); ys=np.nonzero(m)[0]; top,bottom=int(ys.min()),int(ys.max()); chin=float(sys.argv[3]); length=max(0.,(bottom-chin)/max(1.,chin-top))
print(json.dumps({'p10':float(p[0]),'p50':float(p[1]),'p90':float(p[2]),'lengthBelowChinFrac':length,'maskPxNative':int(m.sum())}))`;
 const run=spawnSync('python3',['-c',py,beauty,id,String(chinPx)],{encoding:'utf8'}); assert.equal(run.status,0,run.stderr); return JSON.parse(run.stdout)}
if(process.argv.includes('--self-test')){
 const ft=spawnSync(process.execPath,[join(here,'test_fitness.mjs')],{encoding:'utf8'}); assert.equal(ft.status,0,ft.stderr||ft.stdout);
 const fake=Array.from({length:40},(_,i)=>({index:i,fitness:40-i,renderSeconds:.1})); validate(fake,{fitness:1});
 assert.throws(()=>validate(fake.slice(0,39),{fitness:2}),/at least 40/); assert.throws(()=>validate([...fake.slice(0,39),{...fake[39],index:38}],{fitness:1}),/duplicate/); assert.throws(()=>validate(fake.map((r,i)=>i?r:{...r,renderSeconds:0}),{fitness:1}),/> 0/); assert.throws(()=>validate(fake,{fitness:2}),/not lineage minimum/);
 console.log(JSON.stringify({ok:true,fitnessTests:JSON.parse(ft.stdout),checkerTests:5})); process.exit(0)}
const bestPath=process.argv[2]; assert.ok(bestPath,'usage: check-search2.mjs <best.json>'); const best=JSON.parse(readFileSync(bestPath,'utf8')); const rows=readRows(); validate(rows,best);
const measured=recompute(join(here,best.best1024Png),join(here,best.best1024IdPng),best.metrics.chinPx);
for(const key of ['p10','p50','p90','lengthBelowChinFrac']) assert.ok(Math.abs(measured[key]-best.metrics[key])<=.005,`${key} differs: image=${measured[key]} best=${best.metrics[key]}`);
const row={ok:Boolean(best.ok),evaluations:rows.length,fitness:best.fitness,baselineFitness:best.baselineFitness,acceptanceMargin:best.acceptanceMargin,params:best.params,metrics:best.metrics,recomputed:measured,error:best.error||''}; console.log(JSON.stringify(row)); if(!row.ok)process.exitCode=1;
