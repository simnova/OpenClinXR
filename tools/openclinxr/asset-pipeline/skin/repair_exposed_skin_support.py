import sys,pathlib,json,struct,copy,hashlib,io
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
from collections import deque
def glb(path):
 b=pathlib.Path(path).read_bytes();n=struct.unpack_from('<I',b,12)[0];return json.loads(b[20:20+n]),b[28+n:]

def accessor(d,b,i):
 a=d['accessors'][i];dt={5126:'<f4',5125:'<u4',5123:'<u2',5121:'u1'}[a['componentType']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];view=d['bufferViews'][a['bufferView']];offset=view.get('byteOffset',0)+a.get('byteOffset',0);stride=view.get('byteStride',np.dtype(dt).itemsize*width)
 if 'sparse' in a:raise ValueError('Sparse accessor not supported by prototype; explicit refusal')
 return np.ndarray((a['count'],width),dtype=dt,buffer=b,offset=offset,strides=(stride,np.dtype(dt).itemsize)).copy()

def sha(data):return hashlib.sha256(data).hexdigest()

def read(data):
 if data[:4]!=b'glTF' or struct.unpack_from('<I',data,4)[0]!=2:raise ValueError('GLB2 required')
 n=struct.unpack_from('<I',data,12)[0];return json.loads(data[20:20+n]),data[28+n:]

def encode(d,b):
 j=json.dumps(d,separators=(',',':')).encode();j+=b' '*((-len(j))%4);b+=b'\0'*((-len(b))%4);return struct.pack('<4sII',b'glTF',2,28+len(j)+len(b))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(b),b'BIN\0')+b

def patch(source,albedo,out,expected,normal_strength=None):
 source,albedo,out=map(pathlib.Path,[source,albedo,out]);data=source.read_bytes()
 if sha(data)!=expected:raise ValueError('source identity mismatch')
 if out.exists() or out.resolve()==source.resolve():raise ValueError('immutable output already exists or overwrites source')
 image=albedo.read_bytes()
 if not image.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('PNG albedo required')
 d,b=read(data)
 if len(d.get('buffers',[]))!=1 or d['buffers'][0].get('uri'):raise ValueError('single embedded binary buffer required')
 before=copy.deepcopy(d);skin_indices=[i for i,m in enumerate(d['materials']) if m.get('name','').startswith('mpfb_skin_')]
 if len(skin_indices)!=1:raise ValueError('prototype requires exact one identified skin material')
 si=skin_indices[0];m=d['materials'][si];tex=m['pbrMetallicRoughness'].get('baseColorTexture')
 if tex is None:raise ValueError('existing target albedo binding required')
 if normal_strength is not None and not 0<=normal_strength<=1:raise ValueError('normal strength outside bounded attenuation range')
 original_texture=d['textures'][tex['index']];offset=len(b);b+=b'\0'*((-offset)%4);offset=len(b);b+=image
 d['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(image)});d['images'].append({'name':'candidate-albedo-'+sha(image)[:12],'mimeType':'image/png','bufferView':len(d['bufferViews'])-1});newtex={k:copy.deepcopy(v) for k,v in original_texture.items() if k!='source'};newtex['source']=len(d['images'])-1;d['textures'].append(newtex);m['pbrMetallicRoughness']['baseColorTexture']['index']=len(d['textures'])-1
 if normal_strength is not None:
  if 'normalTexture' not in m:raise ValueError('no existing normal to attenuate')
  m['normalTexture']['scale']=normal_strength
 d['buffers'][0]['byteLength']=len(b)
 result=encode(d,b);after,ab=read(result)
 verify_preservation(data,result,normal_strength)
 out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(result)
 return {'sourceSha256':sha(data),'outputSha256':sha(result),'albedoSha256':sha(image),'normalScale':normal_strength,'originalBinaryBytesPreserved':len(read(data)[1]),'protectedDocumentKeys':[k for k in before if k not in {'materials','bufferViews','images','textures','buffers'}],'existingImageRecordsUnchanged':True,'nonSkinMaterialsUnchanged':True,'noGeometryRebuild':True,'output':str(out)}

def verify_preservation(data,result,normal_strength=None):
 before,original=read(data);after,ab=read(result);si=next(i for i,m in enumerate(before['materials']) if m.get('name','').startswith('mpfb_skin_'))
 if ab[:len(original)]!=original:raise AssertionError('original binary changed')
 for key in before:
  if key not in {'materials','bufferViews','images','textures','buffers'} and before[key]!=after[key]:raise AssertionError('protected document changed: '+key)
 for key in ['bufferViews','images','textures']:
  if before[key]!=after[key][:len(before[key])]:raise AssertionError('original records changed: '+key)
 for i,mat in enumerate(before['materials']):
  if i!=si and mat!=after['materials'][i]:raise AssertionError('non-skin material changed')
 expected_skin=copy.deepcopy(before['materials'][si]);expected_skin['pbrMetallicRoughness']['baseColorTexture']['index']=len(after['textures'])-1
 if normal_strength is not None:expected_skin['normalTexture']['scale']=normal_strength
 if expected_skin!=after['materials'][si]:raise AssertionError('unapproved skin mutation')
 return True


def exposed_face_ids(origins,directions,skin_triangles,garment_triangles,ray_first,ray_distance):
 dist,ids=ray_first(origins,directions,skin_triangles,10)
 cover=ray_distance(origins,directions,garment_triangles,10) if len(garment_triangles) else np.full(len(origins),np.inf)
 visible=np.isfinite(dist)&(dist<cover)
 return np.unique(ids[visible & (ids>=0)]),visible,cover,dist

def connected_contamination(a,mask,ring,reference):
 admitted=ring & (np.linalg.norm(a.astype(float)-reference,axis=2)<40)
 if int(admitted.sum())<128:raise ValueError('insufficient measured neighboring original skin cluster')
 center=np.median(a[admitted],axis=0);mad=np.median(abs(a[admitted]-center),axis=0);tol=np.maximum(6*1.4826*mad,20)
 black=a.max(2)<16;dark=mask&np.all(a.astype(float)<center-tol,axis=2)
 contamination=np.zeros_like(mask);queue=deque(map(tuple,np.argwhere(mask&black)));contamination[mask&black]=True;h,w=mask.shape
 while queue:
  y,x=queue.popleft()
  for yy in range(max(0,y-1),min(h,y+2)):
   for xx in range(max(0,x-1),min(w,x+2)):
    if dark[yy,xx] and not contamination[yy,xx]:contamination[yy,xx]=True;queue.append((yy,xx))
 return contamination,admitted,center,mad,tol

def repair(source,recipe_path,output_dir):
 source=pathlib.Path(source);recipe=json.loads(pathlib.Path(recipe_path).read_text());out=pathlib.Path(output_dir)
 if out.exists():raise ValueError('immutable attempt output already exists')
 if sha(source.read_bytes())!=recipe['sourceSha256']:raise ValueError('source identity mismatch')
 d,b=glb(source);before=copy.deepcopy(d);original=b;body=d['meshes'][recipe['bodyMeshIndex']];skin=recipe['skinMaterialIndex'];texture=d['textures'][d['materials'][skin]['pbrMetallicRoughness']['baseColorTexture']['index']];image=d['images'][texture['source']];view=d['bufferViews'][image['bufferView']];imagebytes=b[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
 if sha(imagebytes)!=recipe['sourceAtlasSha256']:raise ValueError('source atlas identity mismatch')
 a=np.asarray(Image.open(io.BytesIO(imagebytes)).convert('RGB'));h,w=a.shape[:2];supportim=Image.new('1',(w,h));draw=ImageDraw.Draw(supportim)
 def raster(pi,picks):
  p=before['meshes'][recipe['bodyMeshIndex']]['primitives'][int(pi)];ix=accessor(before,original,p['indices']).reshape(-1,3);uv=accessor(before,original,p['attributes']['TEXCOORD_0'])
  if len(set(picks))!=len(picks) or not picks or min(picks)<0 or max(picks)>=len(ix):raise ValueError('invalid explicit triangle support')
  for tri in ix[picks]:draw.polygon([tuple(q) for q in uv[tri]*[w-1,h-1]],fill=1)
 for pi,picks in recipe['restoredByPrimitive'].items():raster(pi,picks)
 for pi,picks in recipe['existingSkinUvSupportByPrimitive'].items():
  if picks:raster(pi,picks)
 mask=np.asarray(supportim).astype(bool);black=a.max(2)<16;ring=np.asarray(supportim.convert('L').filter(ImageFilter.MaxFilter(33)))>0;ring=ring&~mask&~black;contamination,ring,center,mad,tol=connected_contamination(a,mask,ring,np.array(recipe['ringReferenceRgb']))
 candidate=a.copy();known=np.argwhere(ring);unknown=np.argwhere(contamination)
 for start in range(0,len(unknown),64):
  q=unknown[start:start+64];dist=((q[:,None,:]-known[None,:,:])**2).sum(2);nearest=known[dist.argmin(1)];candidate[q[:,0],q[:,1]]=a[nearest[:,0],nearest[:,1]]
 def append_indices(ix):
  nonlocal b
  aa=np.asarray(ix,dtype='<u4').reshape(-1);b+=b'\0'*((-len(b))%4);start=len(b);b+=aa.tobytes();d['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':aa.nbytes,'target':34963});d['accessors'].append({'bufferView':len(d['bufferViews'])-1,'componentType':5125,'count':len(aa),'type':'SCALAR','min':[int(aa.min())],'max':[int(aa.max())]});return len(d['accessors'])-1
 for pi,picks in recipe['restoredByPrimitive'].items():
  p=body['primitives'][int(pi)];ix=accessor(before,original,p['indices']).reshape(-1,3);selected=np.zeros(len(ix),bool);selected[picks]=True
  if p['material']==skin:raise ValueError('support already skin, refusing restamp')
  p['indices']=append_indices(ix[~selected]);new=copy.deepcopy(p);new['indices']=append_indices(ix[selected]);new['material']=skin;body['primitives'].append(new)
 d['buffers'][0]['byteLength']=len(b);out.mkdir(parents=True);intermediate=out/'support.glb';intermediate.write_bytes(encode(d,b));png=out/'atlas.png';Image.fromarray(candidate).save(png);receipt=patch(intermediate,png,out/'candidate.glb',sha(intermediate.read_bytes()))
 if receipt['outputSha256']!=recipe['expectedCandidateSha256']:raise ValueError('reviewed candidate identity mismatch (attempt retained)')
 receipt.update({'sourceSha256':recipe['sourceSha256'],'recipeSha256':sha(pathlib.Path(recipe_path).read_bytes()),'originalSourceBinaryBytesPreserved':len(original),'changedTexels':int(np.any(candidate!=a,2).sum()),'outsideSupportChanged':int(np.any(candidate!=a,2)[~mask].sum()),'claimScope':recipe['claimScope']});(out/'report.json').write_text(json.dumps(receipt,indent=2));return receipt

if __name__=='__main__':print(json.dumps(repair(*sys.argv[1:4]),indent=2))
