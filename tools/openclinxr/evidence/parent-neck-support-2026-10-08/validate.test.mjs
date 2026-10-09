import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
const awaitHash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
import os from 'node:os';
import path from 'node:path';
import {validateAsset,validateReport} from './validate.mjs';
const asset='apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb';
const helper='tools/openclinxr/asset-pipeline/skin/repair_exposed_skin_support.py';
const recipe=new URL('./support-recipe.json',import.meta.url).pathname;
test('same exact asset assertion fails genuine old source and passes reviewed candidate',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neck-owner-red-'));const baseline=path.join(dir,'source.glb');fs.writeFileSync(baseline,execFileSync('git',['show','cd355b723625e250fac96cbf841b4e7913152e3b:'+asset],{maxBuffer:32*1024*1024}));assert.throws(()=>validateAsset(baseline),/identity mismatch/);validateAsset(asset);});
test('actual helper replays exact reviewed candidate and fails unsafe inputs',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'neck-helper-controls-'));const source=path.join(dir,'source.glb');fs.writeFileSync(source,execFileSync('git',['show','cd355b723625e250fac96cbf841b4e7913152e3b:'+asset],{maxBuffer:32*1024*1024}));execFileSync('mise',['exec','--','python3','-c',String.raw`
import importlib.util,json,pathlib,sys,numpy as np
spec=importlib.util.spec_from_file_location('repair',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
source,recipe,root=map(pathlib.Path,sys.argv[2:5]);out=root/'valid';receipt=m.repair(source,recipe,out)
assert receipt['outputSha256']=='c2192d06115c940d17dee6614b6d23128806c54b340cea1a7a4f99a091e48d0e'
assert receipt['originalSourceBinaryBytesPreserved']==11942584 and receipt['changedTexels']==7453 and receipt['outsideSupportChanged']==0
for s,r,o in [(source,recipe,out),(out/'candidate.glb',recipe,root/'wrongsource')]:
 try:m.repair(s,r,o)
 except ValueError:pass
 else:raise AssertionError('unsafe identity/overwrite accepted')
a=np.full((24,24,3),[202,180,166],np.uint8);mask=np.zeros((24,24),bool);mask[5:19,5:19]=True;ring=~mask;a[10,10]=0;a[10,11]=[85,76,70];a[16,16]=[70,60,50]
c,*_=m.connected_contamination(a,mask,ring,np.array([202,180,166]));assert c[10,10] and c[10,11] and not c[16,16]
for color in [[0,0,0],[30,150,220]]:
 bad=a.copy();bad[ring]=color
 try:m.connected_contamination(bad,mask,ring,np.array([202,180,166]))
 except ValueError:pass
 else:raise AssertionError('polluted/no skin ring accepted')
`,helper,source,recipe,dir],{stdio:'inherit'});validateAsset(path.join(dir,'valid','candidate.glb'));
 const reportPath=path.join(dir,'valid','report.json');const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 report.toolSha256=(awaitHash(helper));fs.writeFileSync(reportPath,JSON.stringify(report));validateReport(reportPath);
 const originalSource=report.sourceSha256;report.sourceSha256='0'.repeat(64);fs.writeFileSync(reportPath,JSON.stringify(report));assert.throws(()=>validateReport(reportPath));report.sourceSha256=originalSource;
 report.toolSha256='0'.repeat(64);fs.writeFileSync(reportPath,JSON.stringify(report));assert.throws(()=>validateReport(reportPath));
});
