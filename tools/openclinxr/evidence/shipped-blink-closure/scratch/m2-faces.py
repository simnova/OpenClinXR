"""h1/M2: per-face lid-band analysis at closure 1.0 + slit 1.0 (vertex space),
then projection of lid-band faces into the M1 render for the dark-pixel count.
Run: mise exec -- python3 tools/openclinxr/evidence/shipped-blink-closure/scratch/m2-faces.py
"""
import struct, json, os, math
import numpy as np
from PIL import Image, ImageDraw

SHIPPED='/Users/patrick/.grok/worktrees/src-openclinxr/blinkgap/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb'
REALISM='/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/compateyes/aisha-realism.glb'
M1IMG='/Volumes/files/openclinxr-assets/store/shipped-blink-closure/h1/m1-shipped-blink-globe-shown-full.png'
H1='/Volumes/files/openclinxr-assets/store/shipped-blink-closure/h1'
OUT='/Users/patrick/.grok/worktrees/src-openclinxr/blinkgap/tools/openclinxr/evidence/shipped-blink-closure/scratch'
SIZE=1280

TSHAPE={'SCALAR':(),'VEC2':(2,),'VEC3':(3,),'VEC4':(4,),'MAT4':(4,4)}
CT={5120:'i1',5121:'u1',5122:'i2',5123:'u2',5125:'u4',5126:'f4'}

def load(path):
    with open(path,'rb') as f: data=f.read()
    jlen,jtype=struct.unpack('<II',data[12:20])
    j=json.loads(data[20:20+jlen])
    off=20+jlen
    while off+8<=len(data):
        clen,ctype=struct.unpack('<II',data[off:off+8])
        if ctype==0x004E4942:
            bindata=data[off+8:off+8+clen]; break
        off+=8+((clen+3)&~3)
    bvs=j['bufferViews']; accs=j['accessors']
    def acc(i):
        a=accs[i]
        shape=(a['count'],)+TSHAPE[a['type']]
        dt=np.dtype(CT[a['componentType']])
        isz=dt.itemsize*int(np.prod(TSHAPE[a['type']]))
        if 'bufferView' in a:
            bv=bvs[a['bufferView']]
            base=bv.get('byteOffset',0)+a.get('byteOffset',0)
            st=bv.get('byteStride')
            if st and st!=isz:
                r=np.zeros(shape)
                for k in range(a['count']):
                    r[k]=np.frombuffer(bindata,dtype=dt,count=int(np.prod(TSHAPE[a['type']])),offset=base+k*st).reshape(TSHAPE[a['type']])
                arr=r.astype(float)
            else:
                arr=np.frombuffer(bindata,dtype=dt,count=int(np.prod(shape)),offset=base).reshape(shape).astype(float)
        else:
            arr=np.zeros(shape)
        sp=a.get('sparse')
        if sp:
            ib=sp['indices']; vb=sp['values']
            vi=np.frombuffer(bindata,dtype=np.dtype(CT[ib['componentType']]),count=sp['count'],offset=bvs[ib['bufferView']].get('byteOffset',0)+ib.get('byteOffset',0)).astype(int)
            va=np.frombuffer(bindata,dtype=dt,count=sp['count']*int(np.prod(TSHAPE[a['type']])),offset=bvs[vb['bufferView']].get('byteOffset',0)+vb.get('byteOffset',0)).reshape((sp['count'],)+TSHAPE[a['type']]).astype(float)
            arr[vi]=va
        return arr
    return j,acc

def analyze(path, label):
    j,acc=load(path)
    mesh=None
    for m in j.get('meshes',[]):
        if 'body' in (m.get('name') or '') and (m.get('extras') or {}).get('targetNames'):
            if 'eye-left-closure' in m['extras']['targetNames']:
                mesh=m; break
    tns=mesh['extras']['targetNames']
    ciL=tns.index('eye-left-closure'); ciR=tns.index('eye-right-closure')
    siL=tns.index('eye-left-slit'); siR=tns.index('eye-right-slit')
    # gather per-prim; keep global index offsets
    prims=[]
    for prim in mesh['primitives']:
        B=acc(prim['attributes']['POSITION'])
        CL=acc(prim['targets'][ciL]['POSITION']); CR=acc(prim['targets'][ciR]['POSITION'])
        SL=acc(prim['targets'][siL]['POSITION']); SR=acc(prim['targets'][siR]['POSITION'])
        IA=prim.get('indices')
        F=acc(IA).reshape(-1,3).astype(int) if IA is not None else np.arange(B.shape[0]).reshape(-1,3)
        prims.append((B,CL+CR,SL+SR,F))
    B=np.concatenate([p[0] for p in prims]); D=np.concatenate([p[1] for p in prims]); S=np.concatenate([p[2] for p in prims])
    offs=np.cumsum([0]+[p[0].shape[0] for p in prims])
    F=np.concatenate([p[3]+offs[k] for k,p in enumerate(prims)])
    C=B+D+S  # closed positions at closure 1.0 + slit 1.0
    moved=np.abs(D).max(axis=1)>1e-9
    # lid-band faces: any face touching the closure moving pool
    inband=np.any(moved[F], axis=1)
    BF=F[inband]
    P0=B[BF]; P1=C[BF]
    e1o=P0[:,1]-P0[:,0]; e2o=P0[:,2]-P0[:,0]
    e1c=P1[:,1]-P1[:,0]; e2c=P1[:,2]-P1[:,0]
    Ao=np.linalg.norm(np.cross(e1o,e2o),axis=1)/2
    Ac=np.linalg.norm(np.cross(e1c,e2c),axis=1)/2
    valid=Ao>1e-12
    stretch=np.full(len(BF), np.nan); stretch[valid]=Ac[valid]/Ao[valid]
    No=np.cross(e1o,e2o); Nc=np.cross(e1c,e2c)
    No/=np.linalg.norm(No,axis=1,keepdims=True)+1e-18
    Nc/=np.linalg.norm(Nc,axis=1,keepdims=True)+1e-18
    # view dir +Z (camera sits at +Z of the face); facing = closed normal z > 0
    facez=Nc[:,2]
    return {'B':B,'C':C,'F':F,'BF':BF,'stretch':stretch,'facez':facez,
      'nband':int(inband.sum()),'nfaces':len(F),'maxStretch':float(np.nanmax(stretch)),
      'nBack':int((facez<=0).sum()),'j':j,'acc':acc}

sh=analyze(SHIPPED,'shipped')
re=analyze(REALISM,'realism')
print('shipped lid-band faces:',sh['nband'],'maxStretch:',round(sh['maxStretch'],3),'backfacing:',sh['nBack'])
print('realism lid-band faces:',re['nband'],'maxStretch:',round(re['maxStretch'],3),'backfacing:',re['nBack'])
print('shipped stretch pct:', np.round(np.nanpercentile(sh['stretch'],[0,50,90,99,100]),3))
print('realism stretch pct:', np.round(np.nanpercentile(re['stretch'],[0,50,90,99,100]),3))

# ---- projection into the M1 render (same camera code as the capture) ----
# whole-body bbox from bind POSITIONs across all meshes (Box3.setFromObject approx)
_,accS=sh['j'],sh['acc']
def whole_bbox(path):
    j,acc=load(path)
    mins=[];maxs=[]
    for m in j.get('meshes',[]):
        for prim in m['primitives']:
            if 'POSITION' not in prim.get('attributes',{}): continue
            try: P=acc(prim['attributes']['POSITION'])
            except Exception: continue
            mins.append(P.min(axis=0));maxs.append(P.max(axis=0))
    return np.min(mins,axis=0),np.max(maxs,axis=0)
mn,mx=whole_bbox(SHIPPED)
crownY=mx[1]; headY=crownY-0.13; headZ=(mn[2]+mx[2])/2
cam=np.array([0,headY+0.01,headZ+0.62]); look=np.array([0,headY,headZ])
fov=28*math.pi/180; f=1/math.tan(fov/2)
fwd=(look-cam); fwd/=np.linalg.norm(fwd)
right=np.cross(fwd,[0,1,0]); right/=np.linalg.norm(right)
up=np.cross(right,fwd)
def project(P):
    d=P-cam
    zc=d@fwd; xc=d@right; yc=d@up
    ndcx=(xc*f/zc); ndcy=(yc*f/zc)
    return np.stack([(ndcx*0.5+0.5)*SIZE,(0.5-ndcy*0.5)*SIZE],axis=1),zc
# overlay validation: project closure moving-pool verts
Dpool=np.abs((sh['C']-sh['B'])).max(axis=1)>1e-9
uv,_=project(sh['C'][Dpool])
img=Image.open(M1IMG).convert('RGB')
ov=img.copy(); dr=ImageDraw.Draw(ov)
for x,y in uv:
    dr.ellipse([x-4,y-4,x+4,y+4],fill=(255,0,0))
ov.save(os.path.join(H1,'m2-shipped-margin-projection-overlay.png'))
print('margin verts projected:',len(uv),'x range',round(float(uv[:,0].min()),1),round(float(uv[:,0].max()),1),'y range',round(float(uv[:,1].min()),1),round(float(uv[:,1].max()),1))
json.dump({'thrRealismMaxStretch':re['maxStretch'],
 'shipped':{'nband':sh['nband'],'maxStretch':sh['maxStretch'],'nBack':sh['nBack']},
 'realism':{'nband':re['nband'],'maxStretch':re['maxStretch'],'nBack':re['nBack']}},
 open(os.path.join(OUT,'m2-faces.json'),'w'),indent=2)
