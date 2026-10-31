import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { digest, jsonBytes, PostCloseExport } from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/export.js';
import { DurableExport } from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/persist.js';
import { KnownBudget } from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/memory.js';
import {Stage2Budget} from '@openclinxr/xr-capacity/stage2';
const row=(i:number)=>({sequence:i,frames:24000,tone:{power400:.0002,power700:1e-20},source:'ASCII and é😀',health:{finite:true,n:null}});
const fixture=()=>({binding:{runNonce:'frozen-test-nonce'},identity:{nonce:'fixed-original'},decoded:{uplink:{bins:Array.from({length:35},(_,i)=>row(i))},downlink:{bins:Array.from({length:31},(_,i)=>row(i))}},sources:{uplink:{bins:Array.from({length:33},(_,i)=>row(i))},downlink:{bins:Array.from({length:30},(_,i)=>row(i))}},lifecycle:{closed:true}});
function owner(value:ReturnType<typeof fixture>){const budget=new Stage2Budget();budget.claim('record-base','metadata',8192);for(const [key,rows]of [['history:generator',value.sources.uplink.bins],['history:monitor',value.decoded.downlink.bins],['history:uplink-decoded',value.decoded.uplink.bins],['history:downlink-source',value.sources.downlink.bins]] as const)for(const entry of rows)budget.append(key,'history',entry);budget.close();return budget;}

test('bounded post-close export reconstructs ALL four immutable histories/identity/numbers and exact independent digest',async()=>{
  const job=await mkdtemp(join(tmpdir(),'stage2-export-')),path=join(job,'raw.json');const raw=fixture(),original=structuredClone(raw),exporter=new PostCloseExport(raw,owner(raw)),budget=new KnownBudget(65536),writer=await DurableExport.create(path,budget,{runNonce:raw.binding.runNonce,identitySha256:await digest(JSON.stringify(raw.identity))});
  try{for(;;){const unit=await exporter.next();assert.ok(unit.length<=4096);const ack=await writer.accept(unit);exporter.ack(ack);if(unit.final)break;}const bytes=await readFile(path,'utf8');assert.deepEqual(JSON.parse(bytes),original);const independentCanonical=JSON.stringify(original).split('').map(character=>character.charCodeAt(0)>127?`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`:character).join('');assert.equal(writer.snapshot().canonicalSha256,createHash('sha256').update(independentCanonical).digest('hex'));assert.equal(writer.snapshot().bytes,Buffer.byteLength(bytes));assert.deepEqual(Object.values(exporter.snapshot().counts).sort(),[30,31,33,35]);assert.equal(exporter.snapshot().chainSha256,writer.snapshot().chainSha256);assert.equal(exporter.snapshot().complete,true);assert.equal(raw.decoded.uplink.bins.filter(v=>v!==null).length,0);assert.ok(exporter.snapshot().reservation.peakBytes>=owner(original).audit().peakBytes);}
  finally{await writer.close();await rm(job,{recursive:true,force:true});}
});
test('missing/mismatched ACK preserves pending rows; duplicate/out-of-order receipt cannot consume or advance',async()=>{
  const raw=fixture(),exporter=new PostCloseExport(raw,owner(raw)),first=await exporter.next();const counts=raw.decoded.uplink.bins.filter(v=>v!==null).length;
  await assert.rejects(exporter.next(),/ACK/);assert.throws(()=>exporter.ack({...first,offset:1}),/mismatch/);assert.equal(raw.decoded.uplink.bins.filter(v=>v!==null).length,counts);exporter.ack(first);assert.throws(()=>exporter.ack(first),/mismatch/);assert.equal(exporter.snapshot().sequence,1);
});
test('durable prefix survives interruption and later malformed or duplicate unit cannot replace persisted bytes',async()=>{
  const job=await mkdtemp(join(tmpdir(),'stage2-interrupt-')),path=join(job,'raw.json'),raw=fixture(),exporter=new PostCloseExport(raw,owner(raw)),writer=await DurableExport.create(path,new KnownBudget(65536),{runNonce:raw.binding.runNonce,identitySha256:await digest(JSON.stringify(raw.identity))});
  try{const unit=await exporter.next(),ack=await writer.accept(unit);const before=await readFile(path);await assert.rejects(writer.accept(unit),/sequence/);assert.deepEqual(await readFile(path),before);assert.equal(exporter.snapshot().sequence,0);assert.ok(raw.decoded.uplink.bins.some(v=>v!==null));exporter.ack(ack);const next=await exporter.next();await assert.rejects(writer.accept({...next,sha256:'0'.repeat(64)}),/digest/);assert.deepEqual(await readFile(path),before);assert.equal(exporter.snapshot().complete,false);}
  finally{await writer.close();await rm(job,{recursive:true,force:true});}
});
test('owner exact fit/one-over, concurrent categories, sealed append and final temporary lease are enforced',()=>{
  const budget=new KnownBudget(10),a=budget.reserve('archive',6,true),b=budget.reserve('body',4);assert.throws(()=>budget.reserve('other',1),/rejected/);budget.release(b);budget.seal();assert.throws(()=>budget.reserve('archive',1,true),/rejected/);const c=budget.reserve('final-page',4);budget.release(c);budget.resize(a,3);assert.equal(budget.audit().peakBytes,10);assert.equal(budget.audit().heldBytesAtClose,6);
});
