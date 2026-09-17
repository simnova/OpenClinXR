import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Served bytes plus Debugger.getScriptSource bytes and original-source map content.
 * This establishes executed-module identity, never physical speaker/perceptual sync. */
export function inspectExecutedModules(rows,root,repoRoot,requiredPaths){
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
  const original=resolve(repoRoot,sourcePath);
  let contents=[];
  try{const inline=bytes[0].toString().match(/\/\/# sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)\s*$/);const map=JSON.parse(Buffer.from(inline?.[1]??'', 'base64').toString());contents=map.sources.map((name,index)=>({name,content:map.sourcesContent[index]}));}catch{errors.push('executed-source-map-missing:'+sourcePath);}
  const candidates=contents.filter(item=>typeof item.name==='string'&&item.name.endsWith(sourcePath.split('/').at(-1)));
  if(!existsSync(original)||candidates.length!==1||typeof candidates[0]?.content!=='string'||hash(candidates[0].content)!==hash(readFileSync(original)))errors.push('executed-original-source-mismatch:'+sourcePath);
 }
 return errors;
}
