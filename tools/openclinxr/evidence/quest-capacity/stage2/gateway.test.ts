import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { STAGE2_CONFIG } from '@openclinxr/xr-capacity/stage2';
import { GatewayStartError, serverSources, sha, sourceDigest, startStage2Gateway } from './gateway.js';
const python = process.env['STAGE2_PYTHON'];
const identity = {browserBundleSha256:'0'.repeat(64),serverSourceSha256:'',protocolSha256:'0'.repeat(64),fixtureConfigSha256:sha(JSON.stringify(STAGE2_CONFIG)),graderSourceSha256:'0'.repeat(64)};
const binding = {runNonce:'pure-http-no-media',peerTicket:'ticket',uplinkSourceId:'up',downlinkSourceId:'down'};
async function fixture() {
  const job = await mkdtemp(join(tmpdir(), `stage2-gateway-test-${process.pid}-`)), dist = join(job, 'dist'); await mkdir(dist);
  const sources = await serverSources(); identity.serverSourceSha256 = sourceDigest(sources);
  await writeFile(join(dist, 'index.html'), 'HOST SYNTHETIC ONLY: no media test');
  await writeFile(join(dist, 'source-manifest.json'), JSON.stringify({identity, served:{'index.html':sha('HOST SYNTHETIC ONLY: no media test')}}));
  return {job, dist};
}
test('actual owned child+127 gateway tombstone controls close without any RTC allocation', {skip: !python}, async () => {
  const f = await fixture(); const gateway = await startStage2Gateway({python:python!,jobDirectory:f.job,dist:f.dist});
  try {
    assert.match(gateway.origin, /^http:\/\/127\.0\.0\.1:/);
    assert.match(await (await fetch(gateway.origin)).text(), /no media test/);
    const envelope = {identity,binding};
    const closed = await (await fetch(`${gateway.origin}/stage2/close`, {method:'POST',body:JSON.stringify(envelope)})).json() as {closed:boolean;activePeers:number};
    assert.equal(closed.closed, true); assert.equal(closed.activePeers, 0);
    const rejected = await fetch(`${gateway.origin}/stage2/offer`, {method:'POST',body:JSON.stringify({...envelope,mode:'positive',description:{type:'offer',sdp:'never parsed'}})});
    assert.equal(rejected.status, 409);
    assert.equal((await fetch(`${gateway.origin}/stage2/offer`, {method:'POST',body:'a'.repeat(65537)})).status, 400);
  } finally { const receipt = await gateway.close(); assert.equal(receipt.confirmed, true, JSON.stringify(receipt)); assert.equal(receipt.ownedProcesses, 0); assert.equal(receipt.ownedListeners, 0);const finalPython=(receipt.childReceipt as {reservation:{closed:boolean;categoryPeaks:Record<string,number>}}).reservation;assert.equal(finalPython.closed,true);assert.equal(finalPython.categoryPeaks['shutdown-log-text-and-bytes'],4096); await rm(f.job,{recursive:true,force:true}); }
});
test('occupied port rejects and closes only newly owned child; sentinel remains', {skip: !python}, async () => {
  const f = await fixture(), sentinel = createServer((_,res)=>res.end('sentinel'));
  await new Promise<void>(yes=>sentinel.listen(0,'127.0.0.1',yes)); const address = sentinel.address(); assert.ok(address && typeof address !== 'string');
  try {
    await assert.rejects(startStage2Gateway({python:python!,jobDirectory:f.job,dist:f.dist,port:address.port}), error => error instanceof GatewayStartError && error.cleanup.confirmed && error.cleanup.ownedProcesses === 0 && /EADDRINUSE/.test(error.message));
    assert.equal(await (await fetch(`http://127.0.0.1:${address.port}`)).text(),'sentinel');
  } finally { await new Promise<void>(yes=>sentinel.close(()=>yes())); await rm(f.job,{recursive:true,force:true}); }
});
test('reserved Quest port fails before allocating a child', async () => {
  await assert.rejects(startStage2Gateway({dist:'unused',python:'unused',jobDirectory:'unused',port:54245}), /reserved/);
});
test('large static asset streams without retaining its full body under64KiB owner limit', {skip:!python}, async()=>{
  const f=await fixture(),bytes=Buffer.alloc(180000,0x5a);await writeFile(join(f.dist,'large.bin'),bytes);
  const sources=await serverSources(),fixed={...identity,serverSourceSha256:sourceDigest(sources)};
  await writeFile(join(f.dist,'source-manifest.json'),JSON.stringify({identity:fixed,served:{'large.bin':sha(bytes),'index.html':sha('HOST SYNTHETIC ONLY: no media test')}}));
  const gateway=await startStage2Gateway({python:python!,jobDirectory:f.job,dist:f.dist});
  try{const response=await fetch(`${gateway.origin}/large.bin`);assert.equal(Number(response.headers.get('content-length')),bytes.length);assert.equal(response.headers.get('x-stage2-sha256'),sha(bytes));assert.equal(sha(new Uint8Array(await response.arrayBuffer())),sha(bytes));}
  finally{const result=await gateway.close();assert.equal(result.confirmed,true);assert.equal(result.reservation.closed,true);assert.equal(result.reservation.limitBytes,65536);assert.ok(result.reservation.peakBytes<=65536);assert.equal(result.reservation.rejectedReservations,0);await rm(f.job,{recursive:true,force:true});}
});
