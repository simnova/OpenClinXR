import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..');
const pins={"historical-test-compatibility.test.ts": "3b1a1c227da6f9bb1fdf75857654e9bddf797230e8d1a9811b47626aa341c0a2", "original-evidence-manifest.json": "f65ba741b61fef8635bf15c4cd2869d17286a97ed02f10d6447a650ccbc8a82a", "architecture-and-host.test.mjs": "4226990900f9c13fb67d9c89002ddee4ea033d8cd07cb44c728270f83e879be9", "public-subpath.test.ts": "1317d5d0103ab721826c6e737b32828226b51dc7b16ac3097c3a905a7e27e9b1"};
const sha=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
const fixed=value('--fixed');
for(const [f,h] of Object.entries(pins)){const b=readFileSync(resolve(here,f));if(sha(b)!==h)throw Error('owner-plant-byte-mismatch:'+f);if(fixed){const committed=execFileSync('git',['show',fixed+':tools/openclinxr/factory/actor-audio-package-subpath-integration/'+f],{cwd:root});if(sha(committed)!==h)throw Error('fixed-plant-byte-mismatch:'+f);}}
const m=JSON.parse(readFileSync(resolve(here,'original-evidence-manifest.json'),'utf8'));
for(const [f,h]of Object.entries(m.originalProtectedAssertions)){if(sha(readFileSync(resolve(root,f)))!==h)throw Error('original-assertion-or-checker-mutated:'+f);}
const evidenceRoot=value('--evidence-root')??m.evidenceRoot;
for(const row of m.files){const f=resolve(evidenceRoot,row.path);if(!existsSync(f))throw Error('retained-evidence-missing:'+row.path);const b=readFileSync(f);if(b.length!==row.bytes||sha(b)!==row.sha256)throw Error('retained-evidence-mutated:'+row.path);}
console.log(JSON.stringify({ok:true,scope:'owner-plant-and-original-evidence-integrity-only',files:m.files.length,originalAssertions:Object.keys(m.originalProtectedAssertions).length,fixed:fixed??null}));
