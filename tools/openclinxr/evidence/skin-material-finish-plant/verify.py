"""Owner-frozen exact-asset material acceptance; source via real plant Git object."""
from pathlib import Path
import argparse,json,subprocess,hashlib
from oracle import validate
ASSET='apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb'
SOURCE_SHA='c2192d06115c940d17dee6614b6d23128806c54b340cea1a7a4f99a091e48d0e'
CANDIDATE_SHA='538c29ecc7a38a416079e4c0f567083a3078189ce12ba4936ea3478be5f53561'
p=argparse.ArgumentParser();p.add_argument('--plant-sha',required=True);p.add_argument('--tree-root',type=Path,required=True);p.add_argument('--candidate',type=Path);a=p.parse_args();assert len(a.plant_sha)==40 and all(c in '0123456789abcdef' for c in a.plant_sha),'real plant SHA required'
source=subprocess.check_output(['git','show',a.plant_sha+':'+ASSET],cwd=a.tree_root);assert hashlib.sha256(source).hexdigest()==SOURCE_SHA,'plant source changed'
base=Path(__file__).parent;normal=(base/'normal.png').read_bytes();albedo=(base/'albedo.png').read_bytes();recipe=json.loads((base/'recipe.json').read_text());assert hashlib.sha256(normal).hexdigest()==recipe['normal']['sha256'];assert hashlib.sha256(albedo).hexdigest()==recipe['albedo']['sha256'];assert recipe['sourceSha256']==SOURCE_SHA
candidate=(a.candidate or a.tree_root/ASSET).read_bytes();assert hashlib.sha256(candidate).hexdigest()==CANDIDATE_SHA,'accepted candidate identity mismatch';checks=validate(source,candidate,recipe['materialName'],normal,albedo)
# Same assertion intentionally rejects the original active asset: no refreshed maps.
try:validate(source,source,recipe['materialName'],normal,albedo)
except AssertionError:pass
else:raise AssertionError('old source unexpectedly accepted')
print(json.dumps({'passed':True,'sourceSha256':SOURCE_SHA,'candidateSha256':CANDIDATE_SHA,'checks':checks,'sourceCounterweightRejected':True}))
