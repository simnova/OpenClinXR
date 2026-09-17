import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
export async function reproduceViteModules(repoRoot,rows,metadata){
 if(!/^[a-f0-9]{40}$/.test(metadata?.gitCommit??'')||!Number.isFinite(Date.parse(metadata?.buildTime??'')))throw Error('invalid-observed-build-metadata');
 const app=resolve(repoRoot,'apps/ui-xr');
 const child=spawn(resolve(app,'node_modules/.bin/vite'),['--host','127.0.0.1','--port','0'],{cwd:app,env:{...process.env,NO_COLOR:'1',OPENCLINXR_BUILD_COMMIT:metadata.gitCommit,OPENCLINXR_BUILD_TIME:metadata.buildTime},stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{errors+=b;});
 try{
  const deadline=Date.now()+20000;let base;
  while(Date.now()<deadline){base=output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];if(base)break;if(child.exitCode!==null)throw Error('current-vite-exited:'+errors);await new Promise(r=>setTimeout(r,50));}
  if(!base)throw Error('current-vite-start-timeout:'+errors);
  const expected={};
  for(const row of rows){
   const url=new URL(row.url);
   if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('nonlocal-observed-module');
   const path=decodeURIComponent(url.pathname);
   const actual=path.startsWith('/@fs/')?resolve(path.slice(4)):resolve(app,'.'+path);
   if(actual!==resolve(repoRoot,row.sourcePath))throw Error('observed-module-path-mismatch:'+row.sourcePath);
   for(const key of url.searchParams.keys())if(!['t','v'].includes(key))throw Error('unrecognized-module-transform-input');
   // Cold dependency discovery can replace import-version URLs. Require an exact
   // consecutive-response fixed point before using current transformed bytes.
   let previous,stable;
   for(let attempt=0;attempt<4;attempt++){
    const response=await fetch(new URL(url.pathname+url.search,base),{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('current-vite-module-refused:'+response.status);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(previous?.equals(bytes)){stable=bytes;break;}previous=bytes;
   }
   if(!stable)throw Error('unstable-current-vite-transform:'+row.sourcePath);
   expected[row.sourcePath]=stable.toString('base64');
  }
  return expected;
 }finally{child.kill('SIGTERM');await new Promise(resolveExit=>{if(child.exitCode!==null)resolveExit();else child.once('exit',resolveExit);});}
}
if(process.argv[2]){try{const input=JSON.parse(readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(await reproduceViteModules(input.repoRoot,input.rows,input.metadata)));}catch(e){console.error(e.message);process.exitCode=1;}}
