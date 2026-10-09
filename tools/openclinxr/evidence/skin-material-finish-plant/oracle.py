"""Explicit, hash-bound post-bind material finish; never rebuilds the actor.

Recipe declares source identity and one skin material, plus PNG normal and optional
CC0 albedo identities. This is not an automatic factory dispatch/refresh policy.
"""
import argparse,copy,hashlib,json,struct
from pathlib import Path

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
