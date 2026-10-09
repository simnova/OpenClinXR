"""Owner plant. Actual stage branch with heavy upstream APIs stubbed; NOT Blender evidence."""
import importlib.util,json,pathlib,sys,tempfile,types,unittest,contextlib,io,ast,subprocess,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[4]
S=types.SimpleNamespace

def run_stage(failure=False, replace_failure=False, bookkeeping_failure=False):
    stage=ROOT/'tools/openclinxr/asset-pipeline/makeclothes/seated_clip_bind_stage.py'
    events=[];objects=[]
    class Obj:
        def __init__(self,name,kind):self.name=name;self.type=kind;self.pose=S(bones=list(range(9)));self.animation_data=S(action=S(name='old'))
        def select_set(self,*args):pass
    arm=Obj('actor','ARMATURE');mesh=Obj('skin','MESH')
    def imported(_):objects.extend([arm,mesh]);return arm
    def exported(**kw):events.append('export');pathlib.Path(kw['filepath']).write_bytes(b'EXPORTED')
    bpy=S(context=S(scene=S(objects=objects),view_layer=S(objects=S(active=None))),ops=S(object=S(select_all=lambda **kw:None),mcp=S(load_and_retarget=lambda **kw:None),export_scene=S(gltf=exported)),data=S(objects=S(remove=lambda *args,**kw:None)))
    saved={}
    for name,value in [('bpy',bpy),*[(n,types.ModuleType(n)) for n in ['bl_ext','bl_ext.user_default','bl_ext.user_default.retarget_bvh']]]:
        saved[name]=sys.modules.get(name);sys.modules[name]=value
    bs=types.ModuleType('bl_ext.user_default.retarget_bvh.bsettings');bs.BD=S(prefs=S());sys.modules[bs.__name__]=bs
    util=types.ModuleType('bl_ext.user_default.retarget_bvh.utils');util.getErrorMessage=lambda:'';util.setSilentMode=lambda *_:None;sys.modules[util.__name__]=util
    spec=importlib.util.spec_from_file_location('owner_seated_under_test',stage);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    mod._import_actor=imported;mod._enable_retarget_bvh=lambda:(True,'stubbed');mod._inject_maps=lambda *_:S(name='source',bones=list(range(9)));mod._driven_bones=lambda _:[{'bone':str(i),'keyframes':2,'totalRotationDeltaRad':1.0}for i in range(9)]
    def posture(filename,*_):events.append('posture');pathlib.Path(filename).write_bytes(b'FINAL_REST')
    mod._correct_held_posture=posture
    try:
        with tempfile.TemporaryDirectory(prefix='owner-skin-acceptance-') as td:
            root=pathlib.Path(td);attempt=root/'attempt';attempt.mkdir()
            for name in ['actor','clip','map','source_map']:(root/name).write_bytes(b'input')
            output=root/'accepted.glb';output.write_bytes(b'PRIOR_GLB');report=root/'accepted.json';report.write_bytes(b'PRIOR_RECEIPT')
            opts=S(actor=str(root/'actor'),clip=str(root/'clip'),map=str(root/'map'),source_map=str(root/'source_map'),output=str(output),report=str(report),skin_recipe_id='tara-cc0-final-rest-v1',skin_attempt_dir=str(attempt),skin_job_root=str(root))
            mod._parse_args=lambda _:opts
            def finish(source,*args,**kwargs):
                events.append('finish');assert pathlib.Path(source).read_bytes()==b'FINAL_REST','finish ran before final posture'
                if failure:raise RuntimeError('controlled source-conditioned bake refusal')
                finished=attempt/'finished.glb';finished.write_bytes(b'FINISHED_FINAL_REST');receipt=attempt/'receipt.json';receipt.write_text(json.dumps({'finishedSha256':hashlib.sha256(finished.read_bytes()).hexdigest()}));return S(finished_glb=finished,receipt_path=receipt,outcome='finished')
            mod.finalize_factory_skin=finish
            real_replace=mod.os.replace
            def replace(source,dest):
                if replace_failure and pathlib.Path(dest)==output:raise OSError('controlled precommit replace failure')
                return real_replace(source,dest)
            mod.os.replace=replace
            original_report=mod._write_report
            def write_report(path,payload):
                if bookkeeping_failure and pathlib.Path(path)==report and payload.get('verdict')=='ok':raise OSError('controlled postcommit bookkeeping failure')
                return original_report(path,payload)
            mod._write_report=write_report
            try:
                with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                    try:code=mod.main([])
                    except Exception:code=99
            finally:mod.os.replace=real_replace
            return {'code':code,'events':events,'output':output.read_bytes(),'acceptedReceipt':report.read_bytes(),'publication':json.loads((attempt/'publication.json').read_text()) if (attempt/'publication.json').exists() else None,'receiptExists':(attempt/'receipt.json').exists()}
    finally:
        for name,value in saved.items():
            if value is None:sys.modules.pop(name,None)
            else:sys.modules[name]=value

def replay_function():
    source=(ROOT/'tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py').read_text();tree=ast.parse(source);fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='replay_seated_rest_bind');namespace={'SEATED_REST_OUTPUT_STEMS':{'mpfb-peds-parent-aisha'},'REPO_ROOT':ROOT,'SEATED_REST_CLIP_REL':'unused','SEATED_REST_STAGE_REL':'unused','SEATED_REST_TARGET_MAP_REL':'unused','SEATED_REST_SOURCE_MAP_REL':'unused','MOTION_BIND_OUT_DIR_REL':'unused','_resolve_blender_binary':lambda:'blender'};exec(compile(ast.Module(body=[fn],type_ignores=[]),str(ROOT/'tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py'),'exec'),namespace);return namespace['replay_seated_rest_bind'],namespace

class PublicationAcceptance(unittest.TestCase):
    def test_explicit_unsupported_recipe_refuses_before_legacy_return(self):
        f,_=replay_function()
        with self.assertRaises(RuntimeError):f(pathlib.Path('unsupported.glb'),skin_recipe_id='tara-cc0-final-rest-v1',skin_job_root=pathlib.Path('/tmp/job'),skin_attempt_dir=pathlib.Path('/tmp/job/attempt'))
        self.assertIsNone(f(pathlib.Path('unsupported.glb')))
    def test_materializer_actual_main_forwards_explicit_private_config(self):
        tree=ast.parse((ROOT/'tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py').read_text());main=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='main');calls=[n for n in ast.walk(main) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='replay_seated_rest_bind'];self.assertEqual(len(calls),1)
        values={k.arg:ast.unparse(k.value) for k in calls[0].keywords};self.assertEqual(values.get('skin_recipe_id'),'args.skin_recipe_id');self.assertEqual(values.get('skin_job_root'),'args.skin_job_root');self.assertEqual(values.get('skin_attempt_dir'),'args.skin_attempt_dir')

    def test_postcommit_bookkeeping_failure_retains_discoverable_receipt(self):
        r=run_stage(bookkeeping_failure=True);self.assertNotEqual(r['code'],0);self.assertEqual(r['output'],b'FINISHED_FINAL_REST');self.assertEqual(r['acceptedReceipt'],b'PRIOR_RECEIPT');self.assertTrue(r['receiptExists']);self.assertIsNotNone(r['publication']);self.assertEqual(r['publication']['outcome'],'interrupted_recoverable');self.assertFalse(r['publication']['bookkeepingComplete'])
    def test_actual_stage_finishes_final_posture_before_publishing(self):
        r=run_stage();self.assertEqual(r['code'],0);self.assertEqual(r['events'],['export','posture','finish']);self.assertEqual(r['output'],b'FINISHED_FINAL_REST')
    def test_bake_refusal_preserves_prior_glb_and_accepted_receipt(self):
        r=run_stage(failure=True);self.assertNotEqual(r['code'],0);self.assertEqual(r['output'],b'PRIOR_GLB');self.assertEqual(r['acceptedReceipt'],b'PRIOR_RECEIPT')
    def test_precommit_replace_failure_preserves_prior_glb_and_receipt(self):
        r=run_stage(replace_failure=True);self.assertNotEqual(r['code'],0);self.assertEqual(r['output'],b'PRIOR_GLB');self.assertEqual(r['acceptedReceipt'],b'PRIOR_RECEIPT')

if __name__=='__main__':unittest.main()
