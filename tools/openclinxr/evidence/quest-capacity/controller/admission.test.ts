import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'vitest';
import {persistControllerSourceAdmission,type ControllerAdmissionOptions,type ControllerSourceAdmission} from './admission.js';
const fixture=()=>{
 const calls:string[]=[],receipts:ControllerSourceAdmission[]=[],url='http://127.0.0.1:12345/?purpose=readiness&mode=ON&nonce=admission-fixture';
 const targetInfo={targetId:'actual-fixture-owned-target',type:'page',url};
 const session={async send(method:'Target.getTargetInfo'){calls.push(method);return{targetInfo};},async detach(){calls.push('detach');}};
 const options:ControllerAdmissionOptions={newSession:async()=>{calls.push('create');return session;},actualUrl:()=>url,expectedUrl:url,actualFetchedBundleSha256:'a'.repeat(64),expectedBundleSha256:'a'.repeat(64),sourceManifestSha256:'b'.repeat(64),nonce:'admission-fixture',purpose:'readiness',mode:'ON',slot:null,processId:process.pid,persist:async receipt=>{calls.push('persist');receipts.push(receipt);}};
 return{calls,receipts,url,targetInfo,session,options};
};
test('one owned target capture detaches before persisting exact source/URL/process bindings',async()=>{
 const f=fixture();await persistControllerSourceAdmission(f.options);assert.deepEqual(f.calls,['create','Target.getTargetInfo','detach','persist']);assert.equal(f.receipts.length,1);assert.equal(f.receipts[0]?.ownedTargetId,f.targetInfo.targetId);assert.equal(f.receipts[0]?.ownedUrlSha256,createHash('sha256').update(f.url).digest('hex'));assert.equal(f.receipts[0]?.processId,process.pid);assert.equal(f.receipts[0]?.actualFetchedBundleSha256,f.options.actualFetchedBundleSha256);
});
for(const mismatch of ['target-id','target-type','target-url','source-hash','owned-url','nonce'] as const)test(`pre-entry ${mismatch} mismatch cannot persist admission`,async()=>{
 const f=fixture();if(mismatch==='target-id')f.targetInfo.targetId='';if(mismatch==='target-type')f.targetInfo.type='iframe';if(mismatch==='target-url')f.targetInfo.url+='&wrong=target';if(mismatch==='source-hash')f.options.actualFetchedBundleSha256='c'.repeat(64);if(mismatch==='owned-url')f.options.expectedUrl+='&wrong=owned';if(mismatch==='nonce')f.options.nonce='different';
 await assert.rejects(persistControllerSourceAdmission(f.options),/mismatch|binding/);assert.equal(f.receipts.length,0);if(mismatch.startsWith('target-'))assert.equal(f.calls.at(-1),'detach');
});
test('CDP request rejection detaches and preserves fail-closed result',async()=>{
 const f=fixture();f.session.send=async()=>{throw Error('capture rejected');};await assert.rejects(persistControllerSourceAdmission(f.options),/capture rejected/);assert.deepEqual(f.calls,['create','detach']);assert.equal(f.receipts.length,0);
});
test('detach rejection prevents persistence',async()=>{
 const f=fixture();f.session.detach=async()=>{f.calls.push('detach');throw Error('detach rejected');};await assert.rejects(persistControllerSourceAdmission(f.options),/detach rejected/);assert.equal(f.calls.includes('persist'),false);
});
test('receipt write rejection remains failure after successful capture/detach',async()=>{
 const f=fixture();f.options.persist=async()=>{f.calls.push('write-attempt');throw Error('write rejected');};await assert.rejects(persistControllerSourceAdmission(f.options),/write rejected/);assert.deepEqual(f.calls,['create','Target.getTargetInfo','detach','write-attempt']);assert.equal(f.receipts.length,0);
});
test('bounded late CDP construction detaches without capture or persistence',async()=>{
 const f=fixture();let release:(value:typeof f.session)=>void=()=>undefined;f.options.newSession=()=>new Promise(done=>{release=done;});await assert.rejects(persistControllerSourceAdmission(f.options),/creation exceeded1500ms/);release(f.session);await new Promise<void>(done=>setImmediate(done));assert.deepEqual(f.calls,['detach']);assert.equal(f.receipts.length,0);
});
test('bounded pending target capture still detaches and cannot persist',async()=>{
 const f=fixture();f.session.send=()=>new Promise(()=>undefined);await assert.rejects(persistControllerSourceAdmission(f.options),/capture exceeded1500ms/);assert.deepEqual(f.calls,['create','detach']);assert.equal(f.receipts.length,0);
});
test('bounded pending detach prevents persistence',async()=>{
 const f=fixture();f.session.detach=()=>new Promise(()=>undefined);await assert.rejects(persistControllerSourceAdmission(f.options),/detach exceeded1500ms/);assert.equal(f.calls.includes('persist'),false);
});
