import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { InvocationDeadline } from '../../../../../../../tools/openclinxr/evidence/quest-capacity/stage2/deadline.js';
test('late constructor cannot start another stage and its owned late resource is actually disposed',async()=>{
  const bound=new InvocationDeadline(performance.now(),80);let disposed=0,opened=false;
  const construction=new Promise<{close():Promise<void>}>(yes=>setTimeout(()=>{opened=true;yes({close:async()=>{opened=false;disposed++;}});},30));
  const job=bound.acquire(construction,resource=>resource.close());bound.stop('cancel before constructor return');await assert.rejects(job);await new Promise(yes=>setTimeout(yes,50));assert.equal(disposed,1);assert.equal(opened,false);assert.throws(()=>bound.assert());assert.equal(bound.finish().pendingLateConstructors,0);
});
test('stalled graceful child close uses same deadline and confirms actual owned child exit/listener closure',async()=>{
  const bound=new InvocationDeadline(performance.now(),300),child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);
  const server=createServer((_,res)=>res.end('owned'));await new Promise<void>(yes=>server.listen(0,'127.0.0.1',yes));const exit=once(child,'exit');
  const close=bound.wait(new Promise<never>(()=>undefined),40);await assert.rejects(close,/bound/);child.kill('SIGKILL');await bound.wait(exit);await bound.wait(new Promise<void>(yes=>server.close(()=>yes())));assert.equal(server.listening,false);assert.notEqual(child.signalCode,null);assert.ok(bound.remaining()>0);bound.finish();
});
test('cleanup cannot get a fresh budget after the original clock has expired',async()=>{
  let now=10;const bound=new InvocationDeadline(10,100,()=>now);now=111;await assert.rejects(bound.wait(Promise.resolve('closed')),/deadline/);assert.equal(bound.finish().expired,true);
});

test('operation cutoff cancels late acquisition while preserving original cleanup time',async()=>{
  const bound=new InvocationDeadline(performance.now(),300);let disposed=0;
  const pending=bound.acquire(new Promise<{id:number}>(yes=>setTimeout(()=>yes({id:1}),40)),async()=>{disposed++;});
  await assert.rejects(bound.wait(pending,10),/bound/);bound.cancelWork('acquisition cutoff');await bound.drainLate();await assert.rejects(pending,/Late/);assert.equal(disposed,1);assert.ok(bound.remaining()>0);assert.equal(bound.finish().pendingLateConstructors,0);
});
