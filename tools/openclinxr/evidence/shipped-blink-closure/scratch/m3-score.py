import json, os
import numpy as np
from PIL import Image
H1='/Volumes/files/openclinxr-assets/store/shipped-blink-closure/h1'
EYE=dict(x0=0.30,x1=0.70,y0=0.47,y1=0.60)
def local_std(lum,k=5):
    from numpy.lib.stride_tricks import sliding_window_view
    w=sliding_window_view(np.pad(lum,k//2),(k,k))
    m=w.mean(axis=(-2,-1))
    v=(w**2).mean(axis=(-2,-1))-m**2
    return np.sqrt(np.maximum(v,0))
def gap(path):
    img=Image.open(path).convert('RGB')
    W,H=img.size
    band=np.asarray(img.crop((int(EYE['x0']*W),int(EYE['y0']*H),int(EYE['x1']*W),int(EYE['y1']*H)))).astype(float)
    lum=band.mean(axis=2)
    med=float(np.median(lum))
    dark=(lum<0.35*med)&(local_std(lum)<6.0)
    Ww=dark.shape[1]
    return {'left':int(dark[:,:Ww//2].sum()),'right':int(dark[:,Ww//2:].sum()),
      'total':int(dark.sum()),'skinMedian':round(med,1)}
out={}
for f in ['m3-shipped-blink-baseline-full.png','m3-shipped-blink-recomputed-normals-full.png']:
    out[f]=gap(os.path.join(H1,f))
    img=Image.open(os.path.join(H1,f)).convert('RGB')
    W,H=img.size
    band=img.crop((int(EYE['x0']*W),int(EYE['y0']*H),int(EYE['x1']*W),int(EYE['y1']*H)))
    bw,bh=band.size
    base=f.replace('-full.png','')
    band.crop((0,0,bw//2,bh)).save(os.path.join(H1,base+'-left-native.png'))
    band.crop((bw//2,0,bw,bh)).save(os.path.join(H1,base+'-right-native.png'))
    print(f,out[f])
json.dump(out,open('/Users/patrick/.grok/worktrees/src-openclinxr/blinkgap/tools/openclinxr/evidence/shipped-blink-closure/scratch/m3-gap.json','w'),indent=2)
