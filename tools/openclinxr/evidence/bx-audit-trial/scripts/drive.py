import sys, json, time
argv = sys.argv[sys.argv.index("--")+1:]
lib, glb, out = argv
sys.path.insert(0, lib)
import bpy, bx_audit
t=time.time()
bx_audit._import(glb)
objs=[o.name for o in bpy.context.scene.objects if o.type=="MESH" and o.visible_get()]
r = bx_audit.deliverable(objs, profile="game")
r["glb"]=glb; r["seconds"]=round(time.time()-t,1)
r["mesh_names"]=objs
json.dump(r, open(out,"w"), indent=1)
print("DONE", glb, r["pass"], len(r["errors"]), len(r["warnings"]), r["seconds"])
