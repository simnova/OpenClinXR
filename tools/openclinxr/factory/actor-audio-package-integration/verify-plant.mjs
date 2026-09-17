import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../../../..');
const pins={"public-admission.test.ts": "82c9e54a49da1c5c9ed46db2fcbcf0a5e360018766f5be244762d0c834b1353f", "historical-test-compatibility.test.ts": "8efb3aded3e26efd3eccf2be810c9261adc7657b3fc9a155316a3e78eb00def3", "original-evidence-manifest.json": "d2a668938a960c395a8fc1f7216eb7f5e50b4d93c450610b34b1e436e3d4d0b6", "runtime-lifecycle.test.ts": "dea37801a236d84602b73fc8fdbc0f012e544e7819cd199c0e49708c72d55160", "architecture-and-host.test.mjs": "c3ef2a195fed10c7ef948cfb507263c3a0acd7ad58680c7256629b3c178cb713", "ordinary-host-adapter.test.ts": "da6b108daba5cc60fee7d60f8a2362d8c730dcbd069b9852e4e7a381ffa3b97f", "typed-prepared-failure-cleanup.test.mjs": "b7a92a53b7a81d75a2e072ac48cbcfa2f19e045495f3701d79a017eaa680e318"};
const sha=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
const fixed=value('--fixed');
for(const [f,h] of Object.entries(pins)){const b=readFileSync(resolve(here,f));if(sha(b)!==h)throw Error('owner-plant-byte-mismatch:'+f);if(fixed){const committed=execFileSync('git',['show',fixed+':tools/openclinxr/factory/actor-audio-package-integration/'+f],{cwd:root});if(sha(committed)!==h)throw Error('fixed-plant-byte-mismatch:'+f);}}
const m=JSON.parse(readFileSync(resolve(here,'original-evidence-manifest.json'),'utf8'));
for(const [f,h]of Object.entries(m.originalProtectedAssertions)){if(sha(readFileSync(resolve(root,f)))!==h)throw Error('original-assertion-or-checker-mutated:'+f);}
const evidenceRoot=value('--evidence-root')??m.evidenceRoot;
for(const row of m.files){const f=resolve(evidenceRoot,row.path);if(!existsSync(f))throw Error('retained-evidence-missing:'+row.path);const b=readFileSync(f);if(b.length!==row.bytes||sha(b)!==row.sha256)throw Error('retained-evidence-mutated:'+row.path);}
console.log(JSON.stringify({ok:true,scope:'owner-plant-and-original-evidence-integrity-only',files:m.files.length,originalAssertions:Object.keys(m.originalProtectedAssertions).length,fixed:fixed??null}));
