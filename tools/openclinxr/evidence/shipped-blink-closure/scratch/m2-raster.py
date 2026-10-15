"""h1/M2b: rasterize shipped lid-band faces into the M1 render; count dark px on
flagged faces (stretch > realism-max threshold OR back-facing closed normal).
Run: mise exec -- python3 tools/openclinxr/evidence/shipped-blink-closure/scratch/m2-raster.py
"""
import struct, json, os, math
import numpy as np
from PIL import Image

SHIPPED='/Users/patrick/.grok/worktrees/src-openclinxr/blinkgap/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb'
M1IMG='/Volumes/files/openclinxr-assets/store/shipped-blink-closure/h1/m1-shipped-blink-globe-shown-full.png'
OUT='/Users/patrick/.grok/worktrees/src-openclinxr/blinkgap/tools/openclinxr/evidence/shipped-blink-closure/scratch'
SIZE=1280
TSHAPE={'SCALAR':(),'VEC2':(2,),'VEC3':(3,),'VEC4':(4,),'MAT4':(4,4)}
CT={5120:'i1',5121:'u1',5122:'i2',5123:'u2',5125:'u4',5126:'f4'}
def load(path):
    import json as js
    with open(path,'rb') as f: data=f.read()
    jlen,jtype=struct.unpack('<II',data[12:20])
    j=js.loads(data[20:20+jlen])
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

j,acc=load(SHIPPED)
mesh=[m for m in j['meshes'] if 'body' in (m.get('name') or '') and 'eye-left-closure' in (m.get('extras') or {}).get('targetNames',[])][0]
tns=mesh['extras']['targetNames']
ci=[tns.index('eye-left-closure'),tns.index('eye-right-closure')]
si=[tns.index('eye-left-slit'),tns.index('eye-right-slit')]
Bs=[];Ds=[];Ss=[];Fs=[];off=0
for prim in mesh['primitives']:
    B=acc(prim['attributes']['POSITION'])
    D=acc(prim['targets'][ci[0]]['POSITION'])+acc(prim['targets'][ci[1]]['POSITION'])
    S=acc(prim['targets'][si[0]]['POSITION'])+acc(prim['targets'][si[1]]['POSITION'])
    IA=prim.get('indices')
    F=acc(IA).reshape(-1,3).astype(int) if IA is not None else np.arange(B.shape[0]).reshape(-1,3)
    Bs.append(B);Ds.append(D);Ss.append(S);Fs.append(F+off);off+=B.shape[0]
B=np.concatenate(Bs);D=np.concatenate(Ds);S=np.concatenate(Ss);F=np.concatenate(Fs)
C=B+D+S
moved=np.abs(D).max(axis=1)>1e-9
inband=np.any(moved[F],axis=1)
BF=F[inband]
P0=B[BF];P1=C[BF]
e1o=P0[:,1]-P0[:,0];e2o=P0[:,2]-P0[:,0]
e1c=P1[:,1]-P1[:,0];e2c=P1[:,2]-P1[:,0]
Ao=np.linalg.norm(np.cross(e1o,e2o),axis=1)/2
Ac=np.linalg.norm(np.cross(e1c,e2c),axis=1)/2
stretch=np.where(Ao>1e-12,Ac/np.maximum(Ao,1e-18),np.nan)
Nc=np.cross(e1c,e2c);Nc/=np.linalg.norm(Nc,axis=1,keepdims=True)+1e-18
THR=9.969  # realism bake max stretch in same band (m2-faces.json)
flagged=(stretch>THR)|(Nc[:,2]<=0)
print('band faces',len(BF),'flagged',int(flagged.sum()),'stretch>thr',int(np.nansum(stretch>THR)),'backface',int((Nc[:,2]<=0).sum()))

# camera (same code as capture; bind bbox approx, validated by margin overlay)
mn=np.min([p.min(axis=0) for p in Bs],axis=0);mx=np.max([p.max(axis=0) for p in Bs],axis=0)
# NOTE: capture frames from the whole SCENE bbox (clothes+hair extend it); use all meshes
amins=[];amaxs=[]
for m in j['meshes']:
    for prim in m['primitives']:
        if 'POSITION' not in prim.get('attributes',{}): continue
        try: P=acc(prim['attributes']['POSITION'])
        except Exception: continue
        amins.append(P.min(axis=0));amaxs.append(P.max(axis=0))
mn=np.min(amins,axis=0);mx=np.max(amaxs,axis=0)
headY=mx[1]-0.13;headZ=(mn[2]+mx[2])/2
cam=np.array([0,headY+0.01,headZ+0.62]);look=np.array([0,headY,headZ])
fov=28*math.pi/180;f=1/math.tan(fov/2)
fwd=(look-cam);fwd/=np.linalg.norm(fwd)
right=np.cross(fwd,[0,1,0]);right/=np.linalg.norm(right)
up=np.cross(right,fwd)
def project(P):
    d=P-cam;zc=d@fwd;return np.stack([((d@right)*f/np.maximum(zc,1e-6)*0.5+0.5)*SIZE,(0.5-(d@up)*f/np.maximum(zc,1e-6)*0.5)*SIZE],axis=1)
UV=project(P1.reshape(-1,3)).reshape(-1,3,2)  # per-face vertex pixels
# rasterize: 0 none, 1 unflagged band, 2 flagged; painter far-to-near by closed-centroid depth
lab=np.zeros((SIZE,SIZE),dtype=np.uint8)
ctr=P1.mean(axis=1)
depth=(ctr-cam)@fwd
order=np.argsort(-depth)  # far first, near paints last
for t in order:
    t=int(t)
    tri=UV[t]
    x0,y0=np.floor(tri.min(axis=0)).astype(int);x1,y1=np.ceil(tri.max(axis=0)).astype(int)
    x0=max(x0,0);y0=max(y0,0);x1=min(x1,SIZE-1);y1=min(y1,SIZE-1)
    if x1<x0 or y1<y0: continue
    xs=np.arange(x0,x1+1);ys=np.arange(y0,y1+1)
    xx,yy=np.meshgrid(xs,ys)
    v0,v1,v2=tri
    d=(v1[1]-v2[1])*(v0[0]-v2[0])+(v2[0]-v1[0])*(v0[1]-v2[1])
    if abs(d)<1e-12: continue
    l0=((v1[1]-v2[1])*(xx-v2[0])+(v2[0]-v1[0])*(yy-v2[1]))/d
    l1=((v2[1]-v0[1])*(xx-v2[0])+(v0[0]-v2[0])*(yy-v2[1]))/d
    l2=1-l0-l1
    inside=(l0>=-1e-9)&(l1>=-1e-9)&(l2>=-1e-9)
    if not inside.any(): continue
    lab[yy[inside].astype(int),xx[inside].astype(int)]=2 if flagged[t] else 1
img=np.asarray(Image.open(M1IMG).convert('RGB')).astype(float)
EYE=dict(x0=0.30,x1=0.70,y0=0.47,y1=0.60)
band=img[int(EYE['y0']*SIZE):int(EYE['y1']*SIZE),int(EYE['x0']*SIZE):int(EYE['x1']*SIZE)]
lum=band.mean(axis=2);med=float(np.median(lum))
from numpy.lib.stride_tricks import sliding_window_view
w=sliding_window_view(np.pad(lum,2),(5,5));m=w.mean(axis=(-2,-1));v=(w**2).mean(axis=(-2,-1))-m**2
dark=(lum<0.35*med)&(np.sqrt(np.maximum(v,0))<6.0)
labband=lab[int(EYE['y0']*SIZE):int(EYE['y1']*SIZE),int(EYE['x0']*SIZE):int(EYE['x1']*SIZE)]
darkTotal=int(dark.sum())
onFlag=int((dark&(labband==2)).sum())
onUnflag=int((dark&(labband==1)).sum())
flagPx=int((labband==2).sum())
print('darkTotal',darkTotal,'onFlagged',onFlag,'onUnflaggedBand',onUnflag,'flaggedScreenPx',flagPx)
json.dump({'thrRealismMaxStretch':THR,'nband':len(BF),'nflagged':int(flagged.sum()),
 'darkTotal':darkTotal,'darkOnFlagged':onFlag,'darkOnUnflaggedBand':onUnflag,'flaggedScreenPx':flagPx},
 open(os.path.join(OUT,'m2-raster.json'),'w'),indent=2)
