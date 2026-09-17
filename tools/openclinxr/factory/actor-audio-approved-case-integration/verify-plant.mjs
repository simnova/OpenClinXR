import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2),fixed=args.includes('--fixed')?args[args.indexOf('--fixed')+1]:undefined;
const mb=readFileSync(resolve(here,'owner-manifest.json'));
assert.equal(sha(mb),'ad85ffb0bec87582a89b801391009f129073844a8acb1164ee4deade69057f21','owner manifest bytes unchanged');
const m=JSON.parse(mb);
const test=readFileSync(resolve(root,m.test),'utf8');
assert.equal(sha(test.replaceAll('it.fails','it')),m.normalizedTestSha256,'only expected-failure marker conversion allowed; all assertions/header/fixtures unchanged');
assert.equal(sha(readFileSync(resolve(root,m.sourceOracle))),m.sourceOracleSha256,'new stricter consumed-host oracle unchanged');
if(args.includes('--complete'))assert.doesNotMatch(test,/\bit\.fails\b/,'semantic owner RED must convert to real passing assertions');
const main=readFileSync(resolve(root,'apps/ui-xr/src/main.ts'),'utf8'),start=main.indexOf('function playLiveFrozenActorTurn('),end=main.indexOf('\nfunction ',start+1);
assert.ok(start>=0&&end>start,'actual existing playback body required');
assert.equal(sha(main.slice(start,end)),m.originalMainPlaybackBodySha256,'original ordinary/prepared host body preserved verbatim');
if(fixed){
 for(const path of ['tools/openclinxr/factory/actor-audio-approved-case-integration/verify-plant.mjs','tools/openclinxr/factory/actor-audio-approved-case-integration/owner-manifest.json',m.sourceOracle])
  assert.equal(sha(execFileSync('git',['show',fixed+':'+path],{cwd:root})),sha(readFileSync(resolve(root,path))),'committed protected plant unchanged:'+path);
 const originalTest=execFileSync('git',['show',fixed+':'+m.test],{cwd:root,encoding:'utf8'});
 assert.equal(sha(originalTest.replaceAll('it.fails','it')),m.normalizedTestSha256,'committed original assertion bytes');
}
for(const path of ['tools/openclinxr/factory/actor-audio-package-integration/verify-plant.mjs','tools/openclinxr/factory/actor-audio-package-subpath-integration/verify-plant.mjs'])
 execFileSync(process.execPath,[resolve(root,path)],{cwd:root,stdio:'pipe'});
console.log(JSON.stringify({ok:true,scope:m.scope,fixed:fixed??null,assertionBytesUnchanged:true,historicalIntegrityVerified:true}));
