"""Render c1 curtain/blend/rear children as unlit semantic regions."""
import importlib.util,json,sys
from pathlib import Path
import numpy as np
import bpy

HERE=Path(__file__).resolve().parent
def mod(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);sys.modules[name]=m;s.loader.exec_module(m);return m
child=mod('curtain3_child_facets',HERE/'children.py');bp=child.load_blend();c3=bp.import_children3();hs=c3.load_hair_scene();handle=hs.build_scene();canonical=handle.hair
groups=bp.load_groups_blend();uv=next((x for x in handle.head.data.uv_layers if x.active_render),None);uvn=uv.name if uv else handle.head.data.uv_layers[0].name
cap_obj,_=c3.build_cap_surface(handle,uvn);gd=np.load(HERE/'cells/c1/guides16.npz');cd=np.load(HERE.parent/'hair-cap8/cap-v8.npz');meta={}
override=child.front_fill_override(bp,cd,50000,bp.SEED,False)
bp._blend_children_base(gd,cd,len(override[0]),bp.SEED,meta,_roots_override=override,_closure_on=True,_same_side_ahead_only=True,_weight_jitter=False)
roots=np.asarray(meta['roots_cap']);kids,semantic=child.curtain_preserving_children(gd,cd,roots,12.,None,0.)
kids=child.apply_side_clearance(kids,roots,semantic,float(cd['cx']),8.)
kids,collision=child.repair_outside(kids,handle)
w=semantic['curtain_weight'];sets=(('rear',w<=.01,(0.1,0.35,1.,1.)),('blend',(w>.01)&(w<.99),(0.1,1.,0.2,1.)),('curtain',w>=.99,(1.,0.15,0.1,1.)))
objs=[];counts={}
for name,sel,color in sets:
 obj=bp.build_blend_curves(handle,cap_obj,kids[sel],'UVMap','facet_'+name);bp.add_profile(c3,obj,groups,.00007)
 mat=bpy.data.materials.new('OCLX_facet_'+name);mat.use_nodes=True;mat.node_tree.nodes.clear();out=mat.node_tree.nodes.new('ShaderNodeOutputMaterial');em=mat.node_tree.nodes.new('ShaderNodeEmission');em.inputs['Color'].default_value=color;mat.node_tree.links.new(em.outputs[0],out.inputs['Surface']);obj.data.materials.clear();obj.data.materials.append(mat);objs.append(obj);counts[name]=int(sel.sum())
for o in bpy.data.objects:o.hide_render=True
for o in objs:o.hide_render=False
handle.camera.hide_render=False
scene=bpy.context.scene;scene.render.resolution_x=scene.render.resolution_y=1024;scene.render.resolution_percentage=100;scene.cycles.samples=16;scene.render.film_transparent=False
world=bpy.data.worlds.new('OCLX_facet_world') if not bpy.data.worlds.get('OCLX_facet_world') else bpy.data.worlds['OCLX_facet_world'];world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Color'].default_value=(.01,.01,.01,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.05;scene.world=world
for view in ('front','crown_top'):
 c3.set_final_view(handle,view);scene.render.filepath=str(HERE/f'm5-region-{view}.png');bpy.ops.render.render(write_still=True)
(HERE/'m5-region.json').write_text(json.dumps({'regions':counts,'colors':{'rear':'blue','blend':'green','curtain':'red'},'collisionRepair':collision},indent=2)+'\n')
print('M5_REGIONS',json.dumps(counts,sort_keys=True))
