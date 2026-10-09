import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
for(const [binary,file]of [['python3','validate.test.py'],[process.execPath,'loader-normal-scale.test.mjs']]){const r=spawnSync(binary,[fileURLToPath(new URL('./'+file,import.meta.url))],{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);}
