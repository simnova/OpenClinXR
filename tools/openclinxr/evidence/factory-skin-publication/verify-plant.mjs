/** Owner-frozen assertions; checks integrity, not implementation success. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root=new URL('./',import.meta.url);
const rows=JSON.parse(readFileSync(new URL('plant-manifest.json',root),'utf8'));
for(const [name,expected] of Object.entries(rows)){
 const actual=createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex');
 if(actual!==expected)throw Error('owner plant changed: '+name);
}
console.log(JSON.stringify({ok:true,assertionFiles:Object.keys(rows).length,scope:'owner assertions unchanged; no functional or visual acceptance inferred'}));
