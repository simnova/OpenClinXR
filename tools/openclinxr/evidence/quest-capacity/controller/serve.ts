import {createServer,type Server} from 'node:http';import {readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
const closeOperations=new WeakMap<Server,Promise<void>>(),closedServers=new WeakSet<Server>();
/** Call only after the owned page/browser connection has closed. No process/global cleanup. */
export function closeControllerServer(server:Server):Promise<void>{
 const existing=closeOperations.get(server);if(existing)return existing;
 const operation=new Promise<void>((done,reject)=>{
  server.close(error=>{if(error){reject(error);return;}closedServers.add(server);done();});
  // Stop accepting first; then release this server's active/incomplete HTTP connections.
  server.closeAllConnections();
 });
 closeOperations.set(server,operation);return operation;
}
export function controllerServerClosed(server:Server):boolean{return closedServers.has(server)&&!server.listening;}
export function controllerServer(directory:string){const root=resolve(directory),allowed=new Set(['index.html','controller.js','source-manifest.json','inventory.json','protocol.json','clarifications.json','campaign-plan.json']);return createServer(async(req,res)=>{const url=new URL(req.url??'/','http://localhost'),name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(req.method!=='GET'||!allowed.has(name)){res.writeHead(404).end();return;}try{res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.json')?'application/json':'text/html','cache-control':'no-store','permissions-policy':'microphone=(), camera=()'}).end(await readFile(join(root,name)));}catch{res.writeHead(500).end();}});}
