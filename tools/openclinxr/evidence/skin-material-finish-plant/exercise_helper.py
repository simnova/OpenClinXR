"""Drive actual admitted helper against protected fixtures and exact source."""
import argparse,hashlib,importlib.util,json,subprocess,unittest,tempfile,sys,copy
from pathlib import Path
import control_tests
p=argparse.ArgumentParser();p.add_argument('--helper',type=Path,required=True);p.add_argument('--plant-sha',required=True);p.add_argument('--tree-root',type=Path,required=True);a=p.parse_args()
spec=importlib.util.spec_from_file_location('worker_finish',a.helper);helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
# Frozen parse/pack/validate and fixtures remain the oracle; only actual worker
# finish() changes. A helper that copies one keeper fails synthetic fixtures.
control_tests.finish=helper.finish
result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(control_tests.FinishControls))
assert result.wasSuccessful(),'actual helper failed protected controls'
base=Path(__file__).parent;r=json.loads((base/'recipe.json').read_text());raw=subprocess.check_output(['git','show',a.plant_sha+':apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb'],cwd=a.tree_root);out,checks=helper.finish(raw,r,(base/'normal.png').read_bytes(),(base/'albedo.png').read_bytes());assert hashlib.sha256(out).hexdigest()=='538c29ecc7a38a416079e4c0f567083a3078189ce12ba4936ea3478be5f53561','actual helper not byte-exact accepted recipe'
print(json.dumps({'helperControls':result.testsRun,'acceptedRecipeByteExact':True,'checks':checks}))

# Exercise actual CLI including its guarded side effects, rather than imports alone.
with tempfile.TemporaryDirectory(prefix='skin-finish-protected-') as directory:
 d=Path(directory);source=d/'source.glb';source.write_bytes(raw)
 cli_recipe=copy.deepcopy(r)
 for key,name in [('normal','normal.png'),('albedo','albedo.png')]:cli_recipe[key]['path']=str((base/name).resolve())
 cli_recipe['normal']['bakeManifest']=str((base/'bake-receipt.json').resolve())
 recipe=d/'recipe.json';recipe.write_text(json.dumps(cli_recipe));output=d/'actual-cli.glb'
 def call(src,recipe_path,out):return subprocess.run([sys.executable,str(a.helper.resolve()),'--source',str(src),'--recipe',str(recipe_path),'--output',str(out)],capture_output=True,text=True)
 actual=call(source,recipe,output);assert actual.returncode==0,actual.stderr
 assert hashlib.sha256(output.read_bytes()).hexdigest()=='538c29ecc7a38a416079e4c0f567083a3078189ce12ba4936ea3478be5f53561','CLI did not produce accepted candidate'
 control_tests.validate(raw,output.read_bytes(),r['materialName'],(base/'normal.png').read_bytes(),(base/'albedo.png').read_bytes())
 receipt=output.with_suffix('.finish.json');before=(output.read_bytes(),receipt.read_bytes())
 refused=call(source,recipe,output);assert refused.returncode!=0,'CLI overwrote prior attempt'
 assert before==(output.read_bytes(),receipt.read_bytes()),'overwrite refusal changed retained bytes'
 bad=d/'wrong-source.glb';bad.write_bytes(b'BAD!'+raw[4:]);badout=d/'wrong-source-output.glb';refused=call(bad,recipe,badout);assert refused.returncode!=0 and not badout.exists() and not badout.with_suffix('.finish.json').exists(),'wrong source admitted or wrote output'
 for label,mutation in [('wrong-actor',lambda q:q['normal'].update(conditionedOnSourceSha256='0'*64)),('unapproved-provenance',lambda q:q['albedo'].update(license='unknown')),('forged-CC0-URL',lambda q:q['albedo'].update(sourceUrl='https://example.com/fabricated')),('forged-CC0-bytes',lambda q:q['albedo'].update(path=q['normal']['path'],sha256=q['normal']['sha256']))]:
  q=copy.deepcopy(cli_recipe);mutation(q);qp=d/(label+'.json');qp.write_text(json.dumps(q));out=d/(label+'.glb');refused=call(source,qp,out);assert refused.returncode!=0 and not out.exists() and not out.with_suffix('.finish.json').exists(),label+' admitted or wrote output'
 print(json.dumps({'actualCLIReplayByteExact':True,'actualCLIRefusals':['wrong-source','wrong-actor','unapproved-provenance','forged-CC0-URL','forged-CC0-bytes','existing-output'],'refusalsPreserveOutputs':True}))
