import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function startStatic(directory:string) {
  const allowed=new Set(['index.html','audio-frame-tags.js','frame-tags-worklet.js','protocol.json','protocol-clarifications-01.json','source-manifest.json']);
  const server=createServer(async(request,response)=>{
    const file=new URL(request.url??'/','http://127.0.0.1').pathname.slice(1)||'index.html';
    if(request.method!=='GET'||!allowed.has(file)){response.writeHead(404).end();return;}
    try {const body=await readFile(join(directory,file));response.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'text/html','cache-control':'no-store'}).end(body);}
    catch {response.writeHead(500).end();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();if(!address||typeof address==='string')throw Error('Owned ephemeral address missing');
  let closing:Promise<void>|null=null;
  return {server,url:`http://127.0.0.1:${address.port}`,close(){return closing??=new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});}};
}
