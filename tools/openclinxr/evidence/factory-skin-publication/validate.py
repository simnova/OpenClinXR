"""Owner integrity/REST/consumer checker. Never substitutes for visual realism grading."""
import argparse,hashlib,importlib.util,json,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[4]
def sha(b):return hashlib.sha256(b).hexdigest()
def require(ok,message):
    if not ok:raise AssertionError(message)
def artifact(row):
    p=(ROOT/row['path']).resolve();require(p.is_relative_to(ROOT),'artifact escapes tree');b=p.read_bytes();require(sha(b)==row['sha256'],'artifact hash mismatch');return b
def assert_basis(reference,evaluated):
    require(set(reference)==set(evaluated),'REST primitive roster mismatch')
    for key,points in reference.items():
        other=evaluated[key];require(len(points)==len(other),'REST vertex count mismatch')
        require(all(len(a)==len(b)==3 and all(abs(x-y)<=1e-6 for x,y in zip(a,b)) for a,b in zip(points,other)),'evaluated Blender import is posed or basis changed')
def positions(glb):
    jl=struct.unpack_from('<I',glb,12)[0];j=json.loads(glb[20:20+jl]);bin=glb[28+jl:];out={}
    for mi,m in enumerate(j['meshes']):
        for pi,p in enumerate(m['primitives']):
            a=j['accessors'][p['attributes']['POSITION']];require(a['componentType']==5126 and a['type']=='VEC3' and 'sparse' not in a,'unsupported POSITION layout');v=j['bufferViews'][a['bufferView']];offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',12);out[f'{mi}:{pi}']=[struct.unpack_from('<fff',bin,offset+i*stride)for i in range(a['count'])]
    return out

def assert_ui(ui,finished_sha):
    require(ui['probe']=='actual-ui-xr-loader' and ui['scenarioId']=='peds_asthma_parent_anxiety_v1' and ui['actorId']=='parent_tara_johnson_v1','wrong actual scenario/actor')
    require(ui['finishedSha256']==ui['networkBodySha256']==finished_sha,'runtime fetched wrong body')
    require(bool(ui['bindings']),'loaded skin binding missing')
    for b in ui['bindings']:
        for k in ['albedo','normal']:require(b[k]==ui['decoded'][k],'loaded map pixels do not match finished GLB')

def assert_receipt(receipt,source_sha,normal_sha,finished_sha,authored_sha):
    require(receipt['sourceSha256']==source_sha,'stale final source receipt')
    require(receipt['normalSha256']==normal_sha and receipt['conditionedOnSourceSha256']==source_sha,'map conditioned on another source')
    require(receipt['finishedSha256']==finished_sha and receipt['authoredRecipeSha256']==authored_sha,'recipe/output receipt mismatch')

def assert_publication(publication,finished_sha,receipt_sha):
    require(publication['actualOutputSha256']==finished_sha and publication['lookupReceiptSha256']==receipt_sha,'accepted lookup not joined to actual bytes')
    require(publication['outcome'] in ['committed','interrupted_recoverable'],'false publication outcome')
    require(publication['receiptPrewritten'] is True,'receipt must precede GLB commit')
    if publication['outcome']=='interrupted_recoverable':require(publication.get('bookkeepingComplete') is False,'interruption cannot claim bookkeeping complete')

def validate(path):
    r=json.loads(path.read_text());require(r['schema']=='openclinxr.factory-skin-publication.v1','wrong schema')
    source=artifact(r['source']);finished=artifact(r['finished']);normal=artifact(r['normal']);albedo=artifact(r['albedo']);authored=artifact(r['authoredRecipe']);execution=json.loads(artifact(r['executionRecipe']));receipt=json.loads(artifact(r['receipt']));basis=json.loads(artifact(r['basis']));ui=json.loads(artifact(r['ui']))
    require(r['attemptId']==receipt['attemptId'],'cross-attempt receipt');assert_receipt(receipt,sha(source),sha(normal),sha(finished),sha(authored))
    require(execution['sourceSha256']==sha(source) and execution['normal']['conditionedOnSourceSha256']==sha(source) and execution['normal']['sha256']==sha(normal),'strict execution recipe mismatch')
    require(basis['sourceSha256']==sha(source),'REST sample belongs to another source');assert_basis(positions(source),basis['evaluatedRestPositions'])
    require(basis['blenderVersion'].startswith('5.1') and basis['evaluationMode']=='REST','actual pinned Blender REST evaluation required')
    spec=importlib.util.spec_from_file_location('strict_finish',ROOT/'tools/openclinxr/asset-pipeline/skin/finish_skin_material.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);require(m.APPROVED_CC0_ALBEDOS.get(sha(albedo))==(execution['albedo']['sourceUrl'],execution['albedo']['assetId']),'unapproved albedo');m.validate(source,finished,execution['materialName'],normal,albedo)
    assert_ui(ui,sha(finished));require(ui['materialName']==execution['materialName'],'wrong loaded skin material')
    invocation=json.loads(artifact(r['materializerInvocation']));args=invocation['args'];require(invocation['exitCode']==0 and invocation['entrypoint']=='tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py','actual materializer completion missing');require('--skin-recipe-id' in args and '--skin-job-root' in args,'recipe/job-root forwarding absent')
    # Both initial body output and runtime candidate are confined, not merely the final receipt.
    job=pathlib.Path(invocation['jobRoot']).resolve();require(pathlib.Path(args[args.index('--output')+1]).resolve().is_relative_to(job),'initial body output outside job root');require(pathlib.Path(invocation['runtimeOutput']).resolve().is_relative_to(job),'runtime output outside job root')
    publication=json.loads(artifact(r['publication']));assert_publication(publication,sha(finished),r['receipt']['sha256']);require(publication['outcome']=='committed','successful run publication incomplete')
    require(r['toolLog']['sha256']==sha(artifact(r['toolLog'])),'tool log missing');require(r['frequencyUnits']=='authored-texture-frequency','unmeasured physical-frequency claim')
    return {'ok':True,'attemptId':r['attemptId'],'sourceSha256':sha(source),'finishedSha256':sha(finished),'notEvidenceFor':['visual realism superiority','all-cast integration','physical skin calibration']}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--report',type=pathlib.Path,required=True);a=p.parse_args();print(json.dumps(validate(a.report)))
