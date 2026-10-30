import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {Agent,get,type Server} from 'node:http';
import {createConnection,type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'vitest';
import {closeControllerResources,controllerDeadline} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/controller/cleanup.js';
import {closeControllerServer,controllerServer,controllerServerClosed} from '../../../../../../../tools/openclinxr/evidence/quest-capacity/controller/serve.js';

const pause=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms));
const connections=(server:Server)=>new Promise<number>((done,reject)=>server.getConnections((error,count)=>error?reject(error):done(count)));
async function fixture(body='owned-static-response'){
 const directory=await mkdtemp(join(tmpdir(),'controller-owned-http-')),server=controllerServer(directory);
 await writeFile(join(directory,'index.html'),body);
 await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 return{server,port:address.port,directory,async dispose(){server.closeAllConnections();if(server.listening)await controllerDeadline(closeControllerServer(server),1500,'Fixture server close');await rm(directory,{recursive:true,force:true});}};
}
function request(port:number,agent:Agent){return new Promise<{body:string;socket:Socket|null;headers:Record<string,unknown>}>((done,reject)=>{
 const req=get({host:'127.0.0.1',port,path:'/',agent},res=>{const socket=res.socket,chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('end',()=>done({body:Buffer.concat(chunks).toString(),socket,headers:res.headers}));res.on('error',reject);});req.on('error',reject);
});}
async function incomplete(port:number){const socket=createConnection({host:'127.0.0.1',port});await once(socket,'connect');socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n');await pause(20);return socket;}

test('real completed HTTP keepalive drains by actual callback; repeated close coalesces',async()=>{
 const f=await fixture(),agent=new Agent({keepAlive:true,maxSockets:1});
 try{
  const response=await request(f.port,agent);assert.equal(response.body,'owned-static-response');assert.equal(response.headers['permissions-policy'],'microphone=(), camera=()');await pause(0);assert.equal(await connections(f.server),1);assert.equal(controllerServerClosed(f.server),false);
  const close=closeControllerServer(f.server);assert.equal(closeControllerServer(f.server),close);await controllerDeadline(close,1500,'Owned HTTP close');assert.equal(controllerServerClosed(f.server),true);assert.equal(await connections(f.server),0);assert.equal(f.server.address(),null);
 }finally{agent.destroy();await f.dispose();}
});

test('raw close baseline remains pending on real incomplete headers despite !listening',async()=>{
 const f=await fixture();let socket:Socket|undefined,closed:Promise<void>|undefined,callbackObserved=false;
 try{
  socket=await incomplete(f.port);assert.equal(await connections(f.server),1);
  closed=new Promise<void>((done,reject)=>f.server.close(error=>{if(error)reject(error);else{callbackObserved=true;done();}}));
  await pause(80);assert.equal(f.server.listening,false);assert.equal(callbackObserved,false);assert.equal(socket.destroyed,false);
  socket.destroy();await controllerDeadline(closed,1500,'Baseline fixture cleanup');assert.equal(callbackObserved,true);assert.equal(await connections(f.server),0);
 }finally{socket?.destroy();f.server.closeAllConnections();if(closed)await controllerDeadline(closed,1500,'Baseline close finally');await f.dispose();}
});

test('owned closeAllConnections releases real incomplete headers without a SocketSet',async()=>{
 const f=await fixture();let socket:Socket|undefined;
 try{
  socket=await incomplete(f.port);assert.equal(await connections(f.server),1);const socketClosed=once(socket,'close');
  await controllerDeadline(closeControllerServer(f.server),1500,'Owned incomplete HTTP close');await socketClosed;
  assert.equal(controllerServerClosed(f.server),true);assert.equal(await connections(f.server),0);assert.equal(socket.destroyed,true);
 }finally{socket?.destroy();await f.dispose();}
});

test('closing one owned server preserves an unrelated real keepalive server/socket',async()=>{
 const primary=await fixture('primary'),sentinel=await fixture('sentinel'),agent=new Agent({keepAlive:true,maxSockets:1});
 try{
  const before=await request(sentinel.port,agent);assert.equal(before.body,'sentinel');await pause(0);
  await controllerDeadline(closeControllerServer(primary.server),1500,'Primary close');assert.equal(sentinel.server.listening,true);assert.equal(before.socket?.destroyed,false);
  const after=await request(sentinel.port,agent);assert.equal(after.body,'sentinel');assert.equal(after.socket,before.socket);
 }finally{agent.destroy();await primary.dispose();await sentinel.dispose();}
});

test('actual pending server close exceeds existing1500ms and retained failed receipt never becomes pass',async()=>{
 const f=await fixture();let socket:Socket|undefined,release:()=>void=()=>undefined,operation:Promise<void>|undefined;
 const gate=new Promise<void>(done=>{release=done;});
 try{
  socket=await incomplete(f.port);
  const receipt=await closeControllerResources({server:{close:()=>{operation=gate.then(()=>closeControllerServer(f.server));return operation;},confirmedClosed:()=>controllerServerClosed(f.server)}});
  assert.equal(receipt.confirmed,false);assert.equal(receipt.pendingCloseOperations,1);assert.equal(receipt.ownedServerClosed,false);assert.ok(receipt.errors.some(error=>error.reason.includes('exceeded1500ms')));assert.equal(f.server.listening,true);assert.equal(await connections(f.server),1);
  release();assert.ok(operation);await controllerDeadline(operation,1500,'Delayed fixture close');assert.equal(controllerServerClosed(f.server),true);
  assert.equal(receipt.confirmed,false);assert.equal(receipt.pendingCloseOperations,1);assert.equal(receipt.ownedServerClosed,false);
 }finally{release();socket?.destroy();if(operation)await controllerDeadline(operation,1500,'Timeout fixture cleanup');await f.dispose();}
});

test('actual Node close callback error is rejected rather than confirmed from !listening',async()=>{
 const server=controllerServer(tmpdir());assert.equal(server.listening,false);const close=closeControllerServer(server);assert.equal(closeControllerServer(server),close);await assert.rejects(close,{code:'ERR_SERVER_NOT_RUNNING'});assert.equal(controllerServerClosed(server),false);
});
