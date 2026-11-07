"""Run hair-part's own 50k child generator and five-view render path."""
import argparse, importlib.util, json, sys
from pathlib import Path
import numpy as np

HERE=Path(__file__).resolve().parent
BL=HERE.parent/"hair-part"/"blend_part.py"

def load_blend():
    s=importlib.util.spec_from_file_location("hair_part_blend16",BL)
    m=importlib.util.module_from_spec(s); sys.modules[s.name]=m; s.loader.exec_module(m); return m

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--guides",required=True); ap.add_argument("--cap",required=True); ap.add_argument("--out",required=True); ap.add_argument("--children",type=int,default=50000)
    a=ap.parse_args(sys.argv[sys.argv.index("--")+1:]); out=Path(a.out); out.mkdir(parents=True,exist_ok=True)
    bp=load_blend(); c3=bp.import_children3(); hs=c3.load_hair_scene(); handle=hs.build_scene(); canonical=handle.hair
    groups=bp.load_groups_blend(); uv=next((x for x in handle.head.data.uv_layers if x.active_render),None); uvn=uv.name if uv else handle.head.data.uv_layers[0].name
    cap_obj,cap_info=c3.build_cap_surface(handle,uvn); gd=np.load(a.guides); cd=np.load(a.cap); meta={}
    kids=bp.blend_children(gd,cd,a.children,bp.SEED,meta,part_closure=True,part_fill=True)
    obj=bp.build_blend_curves(handle,cap_obj,kids,"UVMap","guides16_children")
    _,profile=bp.add_profile(c3,obj,groups,0.00005); visible=bp.apply_r4_visibility(handle,obj)
    renders=bp.render_views_blend(c3,hs,handle,canonical,cap_obj,obj,out,"children",size=1024,samples=64)
    row={"requested":a.children,"generated":int(len(kids)),"partClosure":True,"partFill":True,
         "nan":int(np.isnan(kids).sum()),"generatorMeta":{"poisson":meta.get("poisson"),"fallback_count":meta.get("fallback_count"),"part_n_extra":meta.get("part_n_extra")},
         "capInfo":cap_info,"profileReadback":sorted(profile),"visible":visible,"renders":renders}
    (out/"children-meta.json").write_text(json.dumps(row,indent=2,default=str)+"\n")
    print("CHILDREN16_DONE",len(kids))

if __name__=="__main__": main()
