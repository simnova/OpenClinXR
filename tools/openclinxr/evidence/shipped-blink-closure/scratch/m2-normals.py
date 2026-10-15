"""h1/M2c: SHADING normals (base NORMAL + closure/slit NORMAL deltas, what three.js
actually lights with) on the lid-band verts at closure 1.0 + slit 1.0.
Run: mise exec -- python3 tools/openclinxr/evidence/shipped-blink-closure/scratch/m2-normals.py
"""
import struct, json, os
import numpy as np
SHIPPED='/Users/patrick/.grok/worktrees/src-openclinxr/blinkgap/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb'
REALISM='/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/compateyes/aisha-realism.glb'
OUT='/Users/patrick/.grok/worktrees/src-openclinxr/blinkgap/tools/openclinxr/evidence/shipped-blink-closure/scratch'
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
KEY=np.array([0.6,1.9,1.4]);KEY/=np.linalg.norm(KEY)  # capture key light dir
res={}
for label,path in [('shipped',SHIPPED),('realism',REALISM)]:
    j,acc=load(path)
    m=[x for x in j['meshes'] if 'body' in (x.get('name') or '') and 'eye-left-closure' in (x.get('extras') or {}).get('targetNames',[])][0]
    tns=m['extras']['targetNames']
    ci=[tns.index('eye-left-closure'),tns.index('eye-right-closure')]
    si=[tns.index('eye-left-slit'),tns.index('eye-right-slit')]
    NB=[];DN=[];SN=[];PB=[];DP=[]
    for prim in m['primitives']:
        NB.append(acc(prim['attributes']['NORMAL']))
        DN.append(acc(prim['targets'][ci[0]]['NORMAL'])+acc(prim['targets'][ci[1]]['NORMAL']))
        SN.append(acc(prim['targets'][si[0]]['NORMAL'])+acc(prim['targets'][si[1]]['NORMAL']))
        P=acc(prim['attributes']['POSITION'])
        D=acc(prim['targets'][ci[0]]['POSITION'])+acc(prim['targets'][ci[1]]['POSITION'])
        PB.append(P);DP.append(D)
    N=np.concatenate(NB);DNC=np.concatenate(DN);DNS=np.concatenate(SN)
    P=np.concatenate(PB);DP=np.concatenate(DP)
    NM=N+DNC+DNS
    NM/=np.linalg.norm(NM,axis=1,keepdims=True)+1e-18
    band=np.abs(DP).max(axis=1)>1e-9  # lid band = closure POSITION moving pool
    camAway=(NM[:,2]<=0)   # shading normal points away from camera (+Z)
    keyDot=NM@KEY
    res[label]={'nband':int(band.sum()),
      'bandCamAway':int((band&camAway).sum()),
      'bandKeyDotMean':round(float(keyDot[band].mean()),3),
      'bandKeyDotNeg':int(((keyDot<0)&band).sum()),
      'allCamAwayFrac':round(float(camAway.mean()),4)}
    print(label,'band verts',res[label]['nband'],
      'band shading-normal away-from-camera:',res[label]['bandCamAway'],
      'band keyDot mean:',res[label]['bandKeyDotMean'],
      'band keyDot<0:',res[label]['bandKeyDotNeg'])
json.dump(res,open(os.path.join(OUT,'m2-shading-normals.json'),'w'),indent=2)
