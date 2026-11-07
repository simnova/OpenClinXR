import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const code=String.raw`
import json,sys
sys.path.insert(0,sys.argv[1]); from fitness import fitness
base={"p10":.031,"p50":.075,"p90":.275,"rb":1.50,"face":.649,"bg":.50,"faceLR":1.,"volume":.294,"lengthBelowChinFrac":.273,"maskPx":120000,"meanRBSpread":.05,"sheenTopFrac":.6}
long=dict(base,lengthBelowChinFrac=.525)
contaminated=dict(base,maskPx=99999); uniform=dict(base,sheenTopFrac=0.); crown=dict(base,sheenTopFrac=1.)
target={"p10":.039,"p50":.078,"p90":.159,"rb":1.52,"face":.65,"bg":.5,"faceLR":1.,"volume":.294,"lengthBelowChinFrac":.51,"maskPx":120000,"meanRBSpread":.05,"sheenTopFrac":1.}
print(json.dumps({k:fitness(v) for k,v in {"baseline":base,"length15":long,"contaminated":contaminated,"uniform":uniform,"crown":crown,"target":target}.items()}))`;
const run=spawnSync('python3',['-c',code,here],{encoding:'utf8'}); assert.equal(run.status,0,run.stderr);
const s=JSON.parse(run.stdout);
assert.ok(s.baseline>s.length15,'length 1.0 baseline must score worse than length 1.5');
assert.ok(s.contaminated>=s.baseline+5,'contaminated mask must add at least 5');
assert.ok(s.uniform>=s.crown+.6,'uniform darkening must violate sheen while crown band satisfies it');
assert.ok(Math.abs(s.target)<1e-12,'target triple must score approximately zero');
console.log(JSON.stringify({ok:true,tests:4,scores:s}));
