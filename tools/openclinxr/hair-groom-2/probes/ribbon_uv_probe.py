import bpy, sys
print("VERSION", bpy.app.version_string)
p=bpy.utils.resource_path('LOCAL')+"/datafiles/assets/nodes/procedural_hair_node_assets.blend"
with bpy.data.libraries.load(p) as (src,dst): names=list(src.node_groups); dst.node_groups=names
print("HAIR_GROUPS", len(names), sorted(n.name for n in bpy.data.node_groups))
# ribbon test: curve line -> Curve to Mesh with line profile; check UV
bpy.ops.wm.read_factory_settings(use_empty=True)
me=bpy.data.meshes.new("m"); ob=bpy.data.objects.new("o",me); bpy.context.scene.collection.objects.link(ob)
ng=bpy.data.node_groups.new("ribbon","GeometryNodeTree")
ng.interface.new_socket("Geometry",in_out="OUTPUT",socket_type="NodeSocketGeometry")
N=ng.nodes; L=ng.links
cl=N.new("GeometryNodeCurvePrimitiveLine"); res=N.new("GeometryNodeResampleCurve"); res.inputs["Count"].default_value=8
prof=N.new("GeometryNodeCurvePrimitiveLine"); prof.inputs["Start"].default_value=(-0.01,0,0); prof.inputs["End"].default_value=(0.01,0,0)
c2m=N.new("GeometryNodeCurveToMesh"); out=N.new("NodeGroupOutput")
L.new(cl.outputs[0],res.inputs[0]); L.new(res.outputs[0],c2m.inputs["Curve"]); L.new(prof.outputs[0],c2m.inputs["Profile Curve"])
# explicit UV: u = profile factor via Spline Parameter evaluated... store spline parameter on curve before c2m
sp=N.new("GeometryNodeSplineParameter"); st=N.new("GeometryNodeStoreNamedAttribute"); st.data_type='FLOAT2'; st.domain='CORNER'; st.inputs["Name"].default_value="UVMap"
cmb=N.new("ShaderNodeCombineXYZ"); L.new(sp.outputs["Factor"],cmb.inputs["Y"])
L.new(c2m.outputs[0],st.inputs["Geometry"]); L.new(cmb.outputs[0],st.inputs["Value"]); L.new(st.outputs[0],out.inputs[0])
print("C2M_INPUTS",[s.name for s in c2m.inputs])
m=ob.modifiers.new("gn","NODES"); m.node_group=ng
dg=bpy.context.evaluated_depsgraph_get(); ev=ob.evaluated_get(dg).to_mesh()
print("FACES",len(ev.polygons),"ATTRS",[(a.name,a.data_type,a.domain) for a in ev.attributes],"UVLAYERS",[u.name for u in ev.uv_layers])
bpy.ops.object.select_all(action='SELECT'); bpy.context.view_layer.objects.active=ob
bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format='GLB', use_selection=True, export_apply=True)
import os; print("GLB_BYTES", os.path.getsize(sys.argv[-1]))
