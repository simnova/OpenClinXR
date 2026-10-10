/** Used-row gather proof: spawns the production python unittest, fails unless it passes. */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const test = resolve(root, 'tools/openclinxr/asset-pipeline/skin/factory-finish/used_row_gather_test.py');
const r = spawnSync('python3', [test, '-v'], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) { console.error('used-row gather proof FAILED'); process.exit(r.status ?? 1); }
console.log('used-row gather proof passed');
