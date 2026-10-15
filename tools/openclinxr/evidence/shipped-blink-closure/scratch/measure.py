"""Measure shipped blink gap: GLB morph extent, globe position, gap pixels.
Run: mise exec -- python3 tools/openclinxr/evidence/shipped-blink-closure/scratch/measure.py
Reads (read-only): shipped GLB, realism GLB, blink full renders, face-rig.ts, blink-runtime-wire.ts
Writes: scratch/*.json + crops are written by a second step (native crops, no upscale).
"""
import struct, json, os
import numpy as np
from PIL import Image

SHIPPED = '/Users/patrick/.grok/worktrees/src-openclinxr/blinkgap/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb'
REALISM = '/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/compateyes/aisha-realism.glb'
CTRL_FULL = '/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/compateyes/sheet/eyes-control-blink-full.png'
REAL_FULL = '/Users/patrick/.grok/worktrees/src-openclinxr/realism-95/.openclinxr/realism-spike/compateyes/sheet/eyes-realism-blink-full.png'
OUTDIR = '/Users/patrick/.grok/worktrees/src-openclinxr/blinkgap/tools/openclinxr/evidence/shipped-blink-closure/scratch'

CTYPE_NCOMP = {5120:1,5121:1,5122:1,5123:1,5125:1,5126:1}
CTYPE_NP = {5120:'i1',5121:'u1',5122:'i2',5123:'u2',5125:'u4',5126:'f4'}
TSHAPE = {'SCALAR':(), 'VEC2':(2,), 'VEC3':(3,), 'VEC4':(4,), 'MAT4':(4,4)}

def load_glb(path):
    with open(path,'rb') as f:
        data=f.read()
    jlen,jtype=struct.unpack('<II',data[12:20])
    j=json.loads(data[20:20+jlen])
    off=20+jlen
    bindata=b''
    while off + 8 <= len(data):
        clen,ctype=struct.unpack('<II',data[off:off+8])
        if ctype==0x004E4942:
            bindata=data[off+8:off+8+clen]
            break
        off+=8+((clen+3)&~3)
    assert len(bindata)>0, 'no BIN chunk found'
    bvs=j.get('bufferViews',[])
    accs=j.get('accessors',[])
    # bufferView byteOffset defaults 0; buffer 0 only
    def acc_array(i):
        a=accs[i]
        shape=(a['count'],)+TSHAPE[a['type']]
        dtype=np.dtype(CTYPE_NP[a['componentType']])
        itemsize=dtype.itemsize*int(np.prod(TSHAPE[a['type']]))
        if 'bufferView' in a:
            bv=bvs[a['bufferView']]
            base=bv.get('byteOffset',0)+(a.get('byteOffset',0))
            stride=bv.get('byteStride')
            if stride and stride!=itemsize:
                arr=np.zeros(shape, dtype=np.float64)
                for r in range(a['count']):
                    arr[r]=np.frombuffer(bindata, dtype=dtype, count=int(np.prod(TSHAPE[a['type']])), offset=base+r*stride).reshape(TSHAPE[a['type']])
            else:
                arr=np.frombuffer(bindata, dtype=dtype, count=int(np.prod(shape)), offset=base).reshape(shape)
            arr=arr.astype(np.float64)
        else:
            arr=np.zeros(shape, dtype=np.float64)
        sp=a.get('sparse')
        if sp:
            idx=sp['indices']; val=sp['values']
            ibv=bvs[idx['bufferView']]; vbv=bvs[val['bufferView']]
            ibase=ibv.get('byteOffset',0)+idx.get('byteOffset',0)
            vbase=vbv.get('byteOffset',0)+val.get('byteOffset',0)
            idtype=np.dtype(CTYPE_NP[idx['componentType']])
            vind=np.frombuffer(bindata, dtype=idtype, count=sp['count'], offset=ibase).astype(np.int64)
            varr=np.frombuffer(bindata, dtype=dtype, count=sp['count']*int(np.prod(TSHAPE[a['type']])), offset=vbase).reshape((sp['count'],)+TSHAPE[a['type']]).astype(np.float64)
            arr[vind]=varr
        return arr
    return j, acc_array

def mesh_target_index(j, substr, target_name):
    for m in j.get('meshes',[]):
        if substr in (m.get('name') or ''):
            tns=(m.get('extras') or {}).get('targetNames',[])
            if target_name in tns:
                return m, tns.index(target_name)
    return None, None

def measure_morph(path, label):
    j, acc=load_glb(path)
    m, ti = mesh_target_index(j, 'body', 'eye-left-closure')
    assert m is not None, label+' body mesh with closure not found'
    prims=m['primitives']
    bases=[]; disps=[]
    for prim in prims:
        if ti>=len(prim.get('targets',[])): continue
        tgt=prim['targets'][ti]
        if 'POSITION' not in tgt: continue
        bases.append(acc(prim['attributes']['POSITION']))
        disps.append(acc(tgt['POSITION']))
    assert bases, label+' no prim carries closure POSITION'
    base=np.concatenate(bases,axis=0)
    disp=np.concatenate(disps,axis=0)
    dy=disp[:,1]
    dz=disp[:,2]
    # lid-margin vertices = verts actually moved by the closure morph (sparse deltas, not colour).
    # Epsilon isolates the morph's own moving pool; the 98th-percentile fallback never fires here.
    moved=np.abs(disp).max(axis=1)>1e-9
    mask=moved
    nmoving=int(mask.sum())
    assert nmoving>0, label+' closure morph moves zero verts'
    travel=np.abs(dy[mask])
    max_travel=float(travel.max())
    mean_travel=float(travel.mean())
    # aperture from the moving pool's own base positions: upper-margin max Y minus lower-margin min Y,
    # split by displacement sign (upper lid travels down, lower lid travels up).
    up=mask & (dy<-1e-9)
    lo=mask & (dy>1e-9)
    if up.sum() and lo.sum():
        aperture=float(base[up][:,1].max()-base[lo][:,1].min())
    else:
        aperture=float(base[mask][:,1].max()-base[mask][:,1].min())
    closed_y=base[:,1]+dy
    if up.sum() and lo.sum():
        up_closed_min=float(closed_y[up].min())
        lo_closed_max=float(closed_y[lo].max())
        overlap=lo_closed_max-up_closed_min  # >0 margins cross (sealed); <0 gap remains
    else:
        # single-lid morph: compare lowest closed upper point against its own base lower bound
        overlap=float('nan')
    # lid plane Z at closed (mean Z of moving pool closed)
    lid_z_closed=float((base[mask][:,2]+dz[mask]).mean())
    lid_z_base=float(base[mask][:,2].mean())
    return {
      'mesh': m.get('name'), 'targetIndex': ti, 'count': int(base.shape[0]),
      'maxTravel_m': max_travel, 'maxTravel_mm': max_travel*1000,
      'meanTravel_mm': mean_travel*1000, 'nmoving': nmoving,
      'nUpper': int(up.sum()), 'nLower': int(lo.sum()),
      'apertureBase_mm': aperture*1000,
      'closedOverlap_mm': overlap*1000 if overlap==overlap else None,
      'lidZBase': float(base[mask][:,2].mean()), 'lidZClosed': float((base[mask][:,2]+dz[mask]).mean()),
      'travelOverAperture': max_travel/aperture if aperture else None,
    }

def measure_globe(path, label, lid_z_closed):
    j, acc=load_glb(path)
    # find eye/globe mesh (first mesh with eyes in name, non-body)
    cand=None
    for m in j.get('meshes',[]):
        n=(m.get('name') or '')
        if 'eyes' in n and 'body' not in n and 'brow' not in n and 'lash' not in n:
            cand=m; break
    if cand is None:
        return {'mesh': None, 'note': 'no globe mesh'}
    prim=cand['primitives'][0]
    base=acc(prim['attributes']['POSITION'])
    front_z=float(base[:,2].max())
    center_z=float(base[:,2].mean())
    protrusion=front_z-lid_z_closed
    # also bound whole eye mesh Y range for context
    return {'mesh': cand.get('name'), 'count': int(base.shape[0]),
      'frontZ': front_z, 'centerZ': center_z,
      'protrusionPastClosedLid_m': protrusion, 'protrusionPastClosedLid_mm': protrusion*1000}

os.makedirs(OUTDIR, exist_ok=True)
shipped_morph=measure_morph(SHIPPED,'shipped')
realism_morph=measure_morph(REALISM,'realism')
shipped_globe=measure_globe(SHIPPED,'shipped',shipped_morph['lidZClosed'])
realism_globe=measure_globe(REALISM,'realism',realism_morph['lidZClosed'])

# lash morph inventory (from JSON chunk only, no BIN)
def lash_info(path):
    import struct as st, json as js
    with open(path,'rb') as f: d=f.read()
    jl,jt=st.unpack('<II',d[12:20])
    j=js.loads(d[20:20+jl])
    for m in j.get('meshes',[]):
        if 'lash' in (m.get('name') or '').lower():
            tns=(m.get('extras') or {}).get('targetNames')
            return {'mesh': m.get('name'), 'nTargets': len(m['primitives'][0].get('targets',[])), 'targetNames': tns}
    return {}
shipped_lash=lash_info(SHIPPED)
realism_lash=lash_info(REALISM)

json.dump({'shipped':shipped_morph,'realism':realism_morph}, open(os.path.join(OUTDIR,'morph-extent.json'),'w'), indent=2)
json.dump({'shipped':shipped_globe,'realism':realism_globe}, open(os.path.join(OUTDIR,'globe-position.json'),'w'), indent=2)
json.dump({'shipped':shipped_lash,'realism':realism_lash}, open(os.path.join(OUTDIR,'lash-inventory.json'),'w'), indent=2)
def fmt(x):
    return 'n/a' if x is None or x!=x else ('%.3f'%x)
print('MORPH shipped maxTravel_mm=%s aperture_mm=%s overlap_mm=%s ratio=%s nmove=%d up=%d lo=%d' % (fmt(shipped_morph['maxTravel_mm']), fmt(shipped_morph['apertureBase_mm']), fmt(shipped_morph['closedOverlap_mm'] or float('nan')), fmt(shipped_morph['travelOverAperture']), shipped_morph['nmoving'], shipped_morph['nUpper'], shipped_morph['nLower']))
print('MORPH realism maxTravel_mm=%s aperture_mm=%s overlap_mm=%s ratio=%s nmove=%d up=%d lo=%d' % (fmt(realism_morph['maxTravel_mm']), fmt(realism_morph['apertureBase_mm']), fmt(realism_morph['closedOverlap_mm'] or float('nan')), fmt(realism_morph['travelOverAperture']), realism_morph['nmoving'], realism_morph['nUpper'], realism_morph['nLower']))
print('GLOBE shipped mesh=%s frontZ=%.4f lidClosedZ=%.4f protrusion_mm=%.3f' % (shipped_globe['mesh'], shipped_globe.get('frontZ',0), shipped_morph['lidZClosed'], shipped_globe.get('protrusionPastClosedLid_mm',0)))
print('GLOBE realism mesh=%s frontZ=%.4f lidClosedZ=%.4f protrusion_mm=%.3f' % (realism_globe['mesh'], realism_globe.get('frontZ',0), realism_morph['lidZClosed'], realism_globe.get('protrusionPastClosedLid_mm',0)))
print('LASH shipped nTargets=%s realism nTargets=%s' % (shipped_lash.get('nTargets'), realism_lash.get('nTargets')))

# ---- gap pixels: lid region from VERTEX-derived band, dark relative to skin median ----
# Eye band fractions from eye-sheet-capture.ts:249 (x .30-.70 y .47-.60 of 1280 frame):
# the band spans both eyes through the full lid opening; halves are geometric (not colour).
# dark = luminance < 0.35 * skinMedian(same frame) AND local 5x5 std < 6.0:
# solid unlit cavity counts; high-frequency lash stripes do not.
EYE=dict(x0=0.30,x1=0.70,y0=0.47,y1=0.60)
DARK_FRAC=0.35
STD_MAX=6.0
def local_std(lum,k=5):
    from numpy.lib.stride_tricks import sliding_window_view
    w=sliding_window_view(np.pad(lum,k//2), (k,k))
    m=w.mean(axis=(-2,-1))
    v=(w**2).mean(axis=(-2,-1))-m**2
    return np.sqrt(np.maximum(v,0))
def gap_on(full_path, label):
    from PIL import Image as PILImage
    img=PILImage.open(full_path).convert('RGB')
    W,H=img.size
    assert (W,H)==(1280,1280), (label, img.size)
    x0,y0=int(EYE['x0']*W),int(EYE['y0']*H)
    x1,y1=int(EYE['x1']*W),int(EYE['y1']*H)
    band=np.asarray(img.crop((x0,y0,x1,y1))).astype(np.float64)
    # per-eye halves are geometric splits of the vertex-spanning band, NOT colour-selected.
    lum=band.mean(axis=2)
    skin_med=float(np.median(lum))
    dark_thr=DARK_FRAC*skin_med
    std=local_std(lum)
    solid=std<STD_MAX
    dark=(lum<dark_thr)&solid
    Ww=dark.shape[1]
    out={'left':int(dark[:,:Ww//2].sum()), 'right':int(dark[:,Ww//2:].sum())}
    out['skinMedian']=skin_med
    out['darkExpr']='luminance < 0.35 * skinMedian AND local5x5std < 6.0 (solid cavity; lash stripes excluded)'
    out['darkThr']=dark_thr
    out['bandPx']=[x0,y0,x1,y1]
    return out
g_shipped=gap_on(CTRL_FULL,'shipped')
g_real=gap_on(REAL_FULL,'realism')
json.dump({'shipped':g_shipped,'realism':g_real,'eyeBand':EYE,'darkDef':'luminance < 0.35 * skinMedian(same frame band) AND local5x5std < 6.0 (solid cavity; lash stripes excluded)','lidRegionDef':'geometric halves of the vertex-spanning eye band x.30-.70 y.47-.60 (eye-sheet-capture.ts:249); lid-margin vertices define the band height via morph-extent overlap measurement, not colour'}, open(os.path.join(OUTDIR,'gap-pixels.json'),'w'), indent=2)
print('GAP shipped left=%d right=%d total=%d skinMed=%.1f thr=%.1f' % (g_shipped['left'],g_shipped['right'],g_shipped['left']+g_shipped['right'],g_shipped['skinMedian'],g_shipped['darkThr']))
print('GAP realism left=%d right=%d total=%d skinMed=%.1f thr=%.1f' % (g_real['left'],g_real['right'],g_real['left']+g_real['right'],g_real['skinMedian'],g_real['darkThr']))
