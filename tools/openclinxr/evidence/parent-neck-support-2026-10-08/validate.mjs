import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const asset='apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb';
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const expected='c2192d06115c940d17dee6614b6d23128806c54b340cea1a7a4f99a091e48d0e';
export function validateAsset(p=asset){assert.equal(sha(p),expected,'reviewed exposed-neck asset identity mismatch');return {asset:p,sha256:expected,scope:'exact reviewed current-asset repair; not allpose/factory automation'};}
export function validateReport(reportPath='tools/openclinxr/evidence/parent-neck-support-2026-10-08/retained/report.json'){
 const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
 assert.equal(report.sourceSha256,'1c94d737877d9cc2a9fb1e9fe9d1b7a7f49702ec0129d630c420140bf0597333');assert.equal(report.outputSha256,expected);
 assert.equal(report.recipeSha256,sha(new URL('./support-recipe.json',import.meta.url)));
 assert.equal(report.toolSha256,sha('tools/openclinxr/asset-pipeline/skin/repair_exposed_skin_support.py'));
 assert.equal(report.originalSourceBinaryBytesPreserved,11942584);assert.equal(report.changedTexels,7453);assert.equal(report.outsideSupportChanged,0);
 return {reportPath,sourceSha256:report.sourceSha256,candidateSha256:report.outputSha256,recipeSha256:report.recipeSha256,toolSha256:report.toolSha256};
}
if(process.argv[1]?.endsWith('validate.mjs'))console.log(JSON.stringify({asset:validateAsset(),report:validateReport()}));
