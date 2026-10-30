import assert from 'node:assert/strict';
import test from 'node:test';
import {chainInput,digest} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/export.js';
import {KnownBudget} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/memory.js';
import {DurableExport,type ExportFile} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/persist.js';

const binding={runNonce:'writer-test',identitySha256:'a'.repeat(64)};
async function unit(){const value={...binding,sequence:0,offset:0,length:7,data:'{"a":1}',sha256:await digest('{"a":1}'),final:true};return{...value,chainSha256:await digest(chainInput('0'.repeat(64),value))};}
class File implements ExportFile {
  bytes:number[]=[];writes=0;syncs=0;closes=0;progress:number|null=null;syncError=false;closeError=false;
  async write(bytes:Uint8Array,offset:number,length:number,_position:number|null){this.writes++;const count=this.progress??Math.min(3,length);if(Number.isSafeInteger(count)&&count>0&&count<=length)this.bytes.push(...bytes.subarray(offset,offset+count));return{bytesWritten:count};}
  async sync(){this.syncs++;if(this.syncError)throw new Error('injected fsync rejection');}
  async close(){this.closes++;if(this.closeError)throw new Error('injected close rejection');}
}
const setup=async(file=new File(),ledger=new File())=>({file,ledger,writer:await DurableExport.create('fixture',new KnownBudget(65536),binding,{openFile:async path=>path.endsWith('.acks')?ledger:file})});

test('short payload AND journal writes complete exactly and sync before one ACK',async()=>{
  const {writer,file,ledger}=await setup();const value=await unit(),ack=await writer.accept(value);
  assert.equal(ack.sequence,0);assert.equal(Buffer.from(file.bytes).toString(),value.data);const journal=JSON.parse(Buffer.from(ledger.bytes).toString());assert.equal(journal.sha256,value.sha256);assert.equal(journal.final,true);assert.ok(ledger.writes>1);assert.equal(file.syncs,1);assert.equal(ledger.syncs,1);assert.equal(writer.snapshot().sequence,1);await writer.close();
});
for(const target of ['payload','journal'] as const)for(const progress of [0,-1,.5,Number.NaN,9999])test(`${target} invalid progress ${progress} refuses ACK and preserves only actual prefix`,async()=>{
  const {writer,file,ledger}=await setup();(target==='payload'?file:ledger).progress=progress;
  await assert.rejects(writer.accept(await unit()),/Invalid progress/);assert.equal(writer.snapshot().sequence,0);assert.equal(ledger.syncs,0);if(target==='journal')assert.equal(Buffer.from(file.bytes).toString(),'{"a":1}');await writer.close();
});
test('journal fsync rejection never ACKs completed payload/journal',async()=>{
  const {writer,ledger}=await setup();ledger.syncError=true;await assert.rejects(writer.accept(await unit()),/fsync/);assert.equal(writer.snapshot().sequence,0);assert.ok(ledger.bytes.length>0);await writer.close();
});
test('both handle closes are attempted and ALL errors retained; repeated close coalesces',async()=>{
  const {writer,file,ledger}=await setup();file.closeError=ledger.closeError=true;const first=writer.close();assert.equal(writer.close(),first);await assert.rejects(first,error=>error instanceof AggregateError&&error.errors.length===2);assert.equal(file.closes,1);assert.equal(ledger.closes,1);assert.deepEqual(writer.snapshot().handles,{file:'failed',ledger:'failed'});
});
test('journal open failure still attempts partial payload close and preserves both failures',async()=>{
  const file=new File();file.closeError=true;await assert.rejects(DurableExport.create('fixture',new KnownBudget(65536),binding,{openFile:async path=>{if(path.endsWith('.acks'))throw new Error('open failure');return file;}}),error=>error instanceof AggregateError&&error.errors.length===2);assert.equal(file.closes,1);
});

