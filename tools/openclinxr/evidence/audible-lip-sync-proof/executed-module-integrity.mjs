import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Served bytes plus Debugger.getScriptSource bytes plus independently rebuilt/current Vite bytes.
 * This establishes executed-module identity, never physical speaker/perceptual sync. */
export function inspectExecutedModules(rows,root,repoRoot,requiredPaths,reproduced={}){
 const errors=[];
 for(const sourcePath of requiredPaths){
  const matches=(rows??[]).filter(row=>row.sourcePath===sourcePath);
  if(matches.length!==1){errors.push('executed-module-required:'+sourcePath);continue;}
  const row=matches[0];
  if(!row.scriptId||!/^https?:\/\//.test(row.url??'')||row.scriptParsedEvent!=='Debugger.scriptParsed')errors.push('executed-module-observation:'+sourcePath);
  const refs=[row.served,row.executed];
  if(refs.some(ref=>typeof ref?.path!=='string'||!/^[a-f0-9]{64}$/.test(ref?.sha256??''))){errors.push('executed-module-binding:'+sourcePath);continue;}
  const paths=refs.map(ref=>resolve(root,ref.path));
  if(paths.some(path=>!existsSync(path))){errors.push('executed-module-missing:'+sourcePath);continue;}
  const bytes=paths.map(path=>readFileSync(path));
  if(bytes.some((data,index)=>hash(data)!==refs[index].sha256)||!bytes[0].equals(bytes[1]))errors.push('served-executed-module-mismatch:'+sourcePath);
  if(typeof reproduced[sourcePath]!=='string'||!bytes[0].equals(Buffer.from(reproduced[sourcePath],'base64')))errors.push('executed-current-transform-mismatch:'+sourcePath);
 }
 return errors;
}
