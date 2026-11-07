import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const code = String.raw`
import json,sys
sys.path.insert(0, sys.argv[1])
from fitness import fitness
baseline={"p10":.068,"p50":.192,"p90":.319,"rb":1.48,"face":.578,"bg":.462,"faceLR":.832,"volume":.225,"lengthBelowChinFrac":.26,"maskPx":120000,"meanRBSpread":.05}
# Reference metrics associated with the requested hand-picked set
# key=55, fill=60, melanin=.5, redness=.8, trim=1.15.
better={"p10":.050,"p50":.110,"p90":.200,"rb":1.52,"face":.59,"bg":.48,"faceLR":.83,"volume":.27,"lengthBelowChinFrac":.43,"maskPx":120000,"meanRBSpread":.05}
lowkey=dict(baseline,p50=.25,p90=.39,face=.48)
contaminated=dict(baseline,maskPx=99999)
target={"p10":.039,"p50":.078,"p90":.159,"rb":1.52,"face":.60,"bg":.50,"faceLR":.8,"volume":.294,"lengthBelowChinFrac":.51,"maskPx":120000,"meanRBSpread":.05}
print(json.dumps({"baseline":fitness(baseline),"better":fitness(better),"lowkey":fitness(lowkey),"contaminated":fitness(contaminated),"target":fitness(target)}))
`;
const run = spawnSync('python3', ['-c', code, here], {encoding: 'utf8'});
assert.equal(run.status, 0, run.stderr);
const scores = JSON.parse(run.stdout);
assert.ok(scores.baseline > scores.better, 'baseline must score worse than hand-picked better set');
assert.ok(scores.lowkey > scores.baseline, 'key elevation 20 reference must score worse than baseline');
assert.ok(scores.contaminated >= scores.baseline + 5, 'contaminated mask penalty must be at least 5');
assert.equal(scores.target, 0, 'exact target must score zero');
console.log(JSON.stringify({ok: true, tests: 4, scores}));
