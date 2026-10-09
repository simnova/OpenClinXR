// Protected no-shell entry point for BothyBoard's node allowlisted proof runner.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [mode,...args]=process.argv.slice(2);
const script={verify:'verify.py',exercise:'exercise_helper.py'}[mode];
if(!script) throw new Error('Expected verify or exercise mode');
const result=spawnSync('python3',[fileURLToPath(new URL(script,import.meta.url)),...args],{stdio:'inherit',shell:false});
if(result.error) throw result.error;
if(result.signal) throw new Error(`Protected Python control terminated by ${result.signal}`);
if(result.status!==0) process.exit(result.status??1);
