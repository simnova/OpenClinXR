"""Regenerate one cell and perform exact BVH inside tests on scene colliders."""
import argparse,importlib.util,json,sys
from pathlib import Path
import numpy as np
from mathutils import Vector

HERE=Path(__file__).resolve().parent
def mod(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
ch=mod('curtain3_validate_child',HERE/'children.py');bp=ch.load_blend();c3=bp.import_children3();hs=c3.load_hair_scene();handle=hs.build_scene()
gg=mod('curtain3_validate_guides',HERE/'guides.py')
ap=argparse.ArgumentParser();ap.add_argument('--tag',required=True);a=ap.parse_args(sys.argv[sys.argv.index('--')+1:]);cell=HERE/'cells'/a.tag
gd=np.load(cell/'guides16.npz');cd=np.load(HERE.parent/'hair-cap8/cap-v8.npz');style=json.loads((cell/'style.json').read_text());meta={}
front=bool(style.get('child_front_fill'));ahead=bool(style.get('part_same_side_ahead_only'));pclose=bool(style.get('part_front_closure'));wj=bool(style.get('child_weight_jitter'))
if front:
 ov=ch.front_fill_override(bp,cd,50000,bp.SEED,pclose);kids=bp._blend_children_base(gd,cd,len(ov[0]),bp.SEED,meta,_roots_override=ov,_closure_on=True,_same_side_ahead_only=ahead,_weight_jitter=wj)
else:kids=bp.blend_children(gd,cd,50000,bp.SEED,meta,part_closure=True,part_fill=True,same_side_ahead_only=ahead,weight_jitter=wj)
roots=np.asarray(meta['roots_cap']);norm=np.asarray(meta['root_nor'])
if style.get('curtain_preserving_interpolation'):
 kids,sem=ch.curtain_preserving_children(gd,cd,roots,float(style.get('curtain_blend_band_mm',12)),style.get('curtain_inner_limit_mm'),float(style.get('curtain_root_inward_mm',0)));kids=ch.apply_side_clearance(kids,roots,sem,float(cd['cx']),float(style.get('curtain_clearance_max_mm',8)))
 if float(style.get('crown_thickness_mm',0))>0:kids,_=ch.apply_crown_thickness(kids,roots,norm,cd,float(style['crown_thickness_mm']))
if style.get('resample_smooth'):kids,_=ch.resample_smooth(kids,cd)
if style.get('curtain_preserving_interpolation'):kids,_=ch.repair_outside(kids,handle)
flat=kids.reshape(-1,3);total=0;detail={};objs,bvhs=gg.colliders(handle)
for obj in objs:
 bvh=bvhs[obj.name];count=0;deep=0.
 for p in flat:
  sd=gg.signed_distance(bvh,p)
  if sd is not None and sd<0:count+=1;deep=max(deep,-sd*1000.)
 detail[obj.name]={'tested':int(len(flat)),'inside':count,'deep_mm':deep};total+=count
out={'tag':a.tag,'points':int(len(flat)),'inside':total,'colliders':detail}
(cell/'inside-validation.json').write_text(json.dumps(out,indent=2)+'\n');print('INSIDE',json.dumps(out,sort_keys=True))
