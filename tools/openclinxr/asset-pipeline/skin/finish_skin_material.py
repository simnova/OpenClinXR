"""Explicit, hash-bound post-bind material finish; never rebuilds the actor.

Recipe declares source identity and one skin material, plus PNG normal and optional
CC0 albedo identities. This is not an automatic factory dispatch/refresh policy.
"""
import argparse,copy,hashlib,json,struct
from pathlib import Path

APPROVED_CC0_ALBEDOS={'8d8b7dac34f97ebdd8605b51d527ac6863685054b33e1004b3e309599542beaf':('https://static.makehumancommunity.org/assets/assetpacks/skins01.html','toigo_light_skin_female_freckles')}

def sha(data):return hashlib.sha256(data).hexdigest()
def parse(raw):
 assert len(raw)>=28 and raw[:4]==b'glTF' and struct.unpack_from('<I',raw,4)[0]==2,'invalid GLB'
 assert struct.unpack_from('<I',raw,8)[0]==len(raw),'GLB length mismatch'
 n,kind=struct.unpack_from('<I4s',raw,12);assert kind==b'JSON'
 j=json.loads(raw[20:20+n]);m,kind=struct.unpack_from('<I4s',raw,20+n);assert kind==b'BIN\0'
 assert 28+n+m==len(raw),'unexpected GLB chunks'
 return j,raw[28+n:]
def pack(j,b):
 b+=b'\0'*((-len(b))%4);j=copy.deepcopy(j);j['buffers'][0]['byteLength']=len(b)
 a=json.dumps(j,separators=(',',':')).encode();a+=b' '*((-len(a))%4)
 return struct.pack('<4sII',b'glTF',2,28+len(a)+len(b))+struct.pack('<I4s',len(a),b'JSON')+a+struct.pack('<I4s',len(b),b'BIN\0')+b

def validate(source,candidate,material_name,normal_bytes,albedo_bytes=None):
 old,ob=parse(source);new,nb=parse(candidate);assert nb[:len(ob)]==ob,'source BIN changed'
 for key in old:
  if key not in {'materials','buffers','bufferViews','images','textures'}:assert new.get(key)==old[key],f'payload changed: {key}'
 assert set(new)==set(old),'unexpected top-level keys'
 assert len(new['buffers'])==len(old['buffers'])==1,'buffer count changed'
 expected_buffer=copy.deepcopy(old['buffers']);expected_buffer[0]['byteLength']=len(nb);assert new['buffers']==expected_buffer,'buffer metadata changed'
 count=1+(albedo_bytes is not None)
 for key in ['bufferViews','images','textures']:
  assert new[key][:len(old[key])]==old[key] and len(new[key])==len(old[key])+count,f'original {key} changed'
 assert len(new['materials'])==len(old['materials']),'material count changed'
 indices=[i for i,m in enumerate(old['materials']) if m.get('name')==material_name];assert len(indices)==1,'ambiguous skin material'
 index=indices[0];a=copy.deepcopy(new['materials']);b=old['materials'][index]
 def image_payload(texture_index):
  tex=new['textures'][texture_index];image=new['images'][tex['source']];view=new['bufferViews'][image['bufferView']]
  assert image['mimeType']=='image/png' and view['buffer']==0,'invalid appended PNG'
  offset=view.get('byteOffset',0);return nb[offset:offset+view['byteLength']]
 assert image_payload(a[index]['normalTexture']['index'])==normal_bytes,'normal not actually bound'
 a[index]['normalTexture']['index']=b['normalTexture']['index']
 if albedo_bytes is not None:
  assert image_payload(a[index]['pbrMetallicRoughness']['baseColorTexture']['index'])==albedo_bytes,'albedo not actually bound'
  a[index]['pbrMetallicRoughness']['baseColorTexture']['index']=b['pbrMetallicRoughness']['baseColorTexture']['index']
 assert a==old['materials'],'unauthorized material change'
 # Every existing masked primitive/material remains exact via mesh/material equality.
 return {'sourceBINPrefixBytes':len(ob),'payloadRecordsUnchanged':True,'originalImagesUnchanged':True,'nonSkinMaterialsUnchanged':True,'requestedMapsActuallyBound':True}

def finish(source,recipe,normal,albedo=None):
 assert sha(source)==recipe['sourceSha256'],'source identity mismatch'
 assert sha(normal)==recipe['normal']['sha256'],'normal identity mismatch'
 assert recipe['normal']['conditionedOnSourceSha256']==recipe['sourceSha256'],'normal conditioned on another actor'
 assert normal[:8]==b'\x89PNG\r\n\x1a\n','normal must be PNG'
 if recipe.get('albedo'):
  assert albedo is not None and sha(albedo)==recipe['albedo']['sha256'],'albedo identity mismatch'
  assert recipe['albedo']['license']=='CC0-1.0','albedo license unapproved'
  assert APPROVED_CC0_ALBEDOS.get(sha(albedo))==(recipe['albedo'].get('sourceUrl'),recipe['albedo'].get('assetId')),'albedo not in owner-reviewed CC0 source allowlist'
  assert albedo[:8]==b'\x89PNG\r\n\x1a\n','albedo must be PNG'
 else:assert albedo is None,'undeclared albedo'
 j,binary=parse(source);j=copy.deepcopy(j);b=bytearray(binary)
 skin=[m for m in j['materials'] if m.get('name')==recipe['materialName']];assert len(skin)==1,'ambiguous skin material';skin=skin[0]
 def append(data,old_index,role):
  b.extend(b'\0'*((-len(b))%4));offset=len(b);b.extend(data)
  j['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(data)})
  j['images'].append({'name':role,'mimeType':'image/png','bufferView':len(j['bufferViews'])-1})
  tex={'source':len(j['images'])-1};prior=j['textures'][old_index]
  if 'sampler' in prior:tex['sampler']=prior['sampler']
  j['textures'].append(tex);return len(j['textures'])-1
 if albedo is not None:skin['pbrMetallicRoughness']['baseColorTexture']['index']=append(albedo,skin['pbrMetallicRoughness']['baseColorTexture']['index'],recipe['albedo'].get('imageName','CC0-original-pack-albedo'))
 skin['normalTexture']['index']=append(normal,skin['normalTexture']['index'],recipe['normal'].get('imageName','current-MPFB-REST-normal'))
 result=pack(j,bytes(b));checks=validate(source,result,recipe['materialName'],normal,albedo)
 return result,checks

def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--recipe',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 assert not a.output.exists() and not a.output.with_suffix('.finish.json').exists(),'output already exists; preserve attempts'
 recipe=json.loads(a.recipe.read_text());bake_path=Path(recipe['normal']['bakeManifest']);bake_raw=bake_path.read_bytes();assert sha(bake_raw)==recipe['normal']['bakeManifestSha256'],'bake receipt identity mismatch';bake=json.loads(bake_raw);assert bake['assetSha256']==recipe['sourceSha256'] and bake['normalSha256']==recipe['normal']['sha256'],'bake source/map mismatch';normal=Path(recipe['normal']['path']).read_bytes();albedo=Path(recipe['albedo']['path']).read_bytes() if recipe.get('albedo') else None
 result,checks=finish(a.source.read_bytes(),recipe,normal,albedo);a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(result)
 receipt={'schema':'openclinxr.explicit-skin-finish.v1','sourceSha256':recipe['sourceSha256'],'candidateSha256':sha(result),'recipeSha256':sha(a.recipe.read_bytes()),'checks':checks,'notClaimed':['automatic dispatch','allcast quality','physical PBR validation','better than original CC0 pack']};a.output.with_suffix('.finish.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
if __name__=='__main__':main()
