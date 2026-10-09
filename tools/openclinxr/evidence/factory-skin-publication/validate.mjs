import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const r=spawnSync('python3',[fileURLToPath(new URL('./validate.py',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit'});if(r.error)throw r.error;process.exit(r.status??1);
