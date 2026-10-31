import assert from 'node:assert/strict';
import test from 'node:test';
import {InvocationDeadline} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/deadline.js';
import {ExportOwner} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/export-owner.js';
import {chainInput,digest} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/export.js';
import {KnownBudget} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/memory.js';
import type {ExportFile} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/persist.js';
const binding={runNonce:'owner-test',identitySha256:'b'.repeat(64)};
const deferred=()=>{let resolve:()=>void=()=>undefined;const promise=new Promise<void>(yes=>{resolve=yes;});return{promise,resolve};};
const tick=()=>new Promise<void>(yes=>setImmediate(yes));
async function unit(){const value={...binding,sequence:0,offset:0,length:2,data:'{}',sha256:await digest('{}'),final:true};return{...value,chainSha256:await digest(chainInput('0'.repeat(64),value))};}
class File implements ExportFile {
  writes=0;closes=0;syncStarted=false;pendingSync:Promise<void>|null=null;pendingClose:Promise<void>|null=null;
  async write(_bytes:Uint8Array,_offset:number,length:number,_position:number|null){this.writes++;return{bytesWritten:length};}
  async sync(){this.syncStarted=true;if(this.pendingSync)await this.pendingSync;}
  async close(){this.closes++;if(this.pendingClose)await this.pendingClose;}
}
test('pending fsync stays outer-owned at cutoff; late completion cannot journal/ACK/close after expiry',async()=>{
  let now=0;const deadline=new InvocationDeadline(0,1000,()=>now),owner=new ExportOwner(deadline),gate=deferred(),file=new File(),ledger=new File(),budget=new KnownBudget(65536);file.pendingSync=gate.promise;
  await owner.create('fixture',budget,binding,{openFile:async path=>path.endsWith('.acks')?ledger:file});const accept=owner.accept(await unit());while(!file.syncStarted)await tick();
  deadline.cancelWork('work cutoff');owner.stop();const closing=owner.close();assert.equal(owner.close(),closing);assert.equal(owner.snapshot().pendingAccept,1);assert.equal(owner.snapshot().pendingClose,1);assert.equal(owner.snapshot().confirmed,false);
  now=1000;const cutoff=owner.snapshot();assert.equal(cutoff.confirmed,false);assert.ok(budget.audit().peakBytes>0);assert.equal(file.closes+ledger.closes,0);gate.resolve();await assert.rejects(accept,/deadline|stopped/);await assert.rejects(closing,/closure/);assert.equal(ledger.writes,0);assert.equal(file.closes+ledger.closes,0);assert.equal(owner.snapshot().confirmed,false);assert.equal(deadline.finish().expired,true);
});
test('stop during payload fsync prevents journal continuation; close completes within original remaining clock',async()=>{
  const deadline=new InvocationDeadline(performance.now(),1000),owner=new ExportOwner(deadline),gate=deferred(),file=new File(),ledger=new File();file.pendingSync=gate.promise;
  await owner.create('fixture',new KnownBudget(65536),binding,{openFile:async path=>path.endsWith('.acks')?ledger:file});const accept=owner.accept(await unit());while(!file.syncStarted)await tick();owner.stop();const closing=owner.close();gate.resolve();await assert.rejects(accept,/stopped/);await closing;assert.equal(ledger.writes,0);assert.equal(file.closes,1);assert.equal(ledger.closes,1);assert.equal(owner.snapshot().confirmed,true);deadline.finish();
});
test('late first file construction after stop cannot open journal and its disposal remains tracked',async()=>{
  const deadline=new InvocationDeadline(performance.now(),1000),owner=new ExportOwner(deadline),gate=deferred(),file=new File();let opens=0;
  const creation=owner.create('fixture',new KnownBudget(65536),binding,{openFile:async()=>{opens++;await gate.promise;return file;}});await tick();owner.stop();const close=owner.close();assert.equal(owner.snapshot().pendingCreate,1);assert.equal(owner.snapshot().confirmed,false);gate.resolve();await assert.rejects(creation,/creation/);await assert.rejects(close,/creation/);assert.equal(opens,1);assert.equal(file.closes,1);assert.equal(owner.snapshot().confirmed,false);deadline.finish();
});
test('stalled actual handle close cannot become cleanup-confirmed at a decision timestamp',async()=>{
  let now=0;const deadline=new InvocationDeadline(0,1000,()=>now),owner=new ExportOwner(deadline),gate=deferred(),file=new File(),ledger=new File();file.pendingClose=gate.promise;
  await owner.create('fixture',new KnownBudget(65536),binding,{openFile:async path=>path.endsWith('.acks')?ledger:file});const close=owner.close();await tick();assert.equal(file.closes,1);assert.equal(ledger.closes,1);assert.deepEqual(owner.snapshot().handles,{file:'open',ledger:'closed'});now=1000;assert.equal(owner.snapshot().confirmed,false);assert.equal(owner.snapshot().pendingClose,1);gate.resolve();await close;deadline.finish();
});
test('normal complete export closes both actual handles and leaves no pending owner tasks',async()=>{
  const deadline=new InvocationDeadline(performance.now(),1000),owner=new ExportOwner(deadline),file=new File(),ledger=new File();await owner.create('fixture',new KnownBudget(65536),binding,{openFile:async path=>path.endsWith('.acks')?ledger:file});await owner.accept(await unit());await owner.close();assert.equal(owner.snapshot().confirmed,true);assert.equal(owner.snapshot().pendingCreate+owner.snapshot().pendingAccept+owner.snapshot().pendingClose,0);assert.throws(()=>owner.accept({} as never),/stopped/);deadline.finish();
});
test('pending metadata persistence also prevents owner-end; stop prevents a detached next control',async()=>{
  const deadline=new InvocationDeadline(performance.now(),1000),owner=new ExportOwner(deadline),gate=deferred();let started=0;
  const pending=owner.control(async()=>{started++;await gate.promise;});await tick();owner.stop();const close=owner.close();assert.equal(owner.snapshot().pendingControl,1);assert.equal(owner.snapshot().confirmed,false);assert.throws(()=>owner.control(async()=>{started++;}),/stopped/);gate.resolve();await pending;await close;assert.equal(started,1);assert.equal(owner.snapshot().confirmed,true);deadline.finish();
});
