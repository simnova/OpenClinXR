import bpy
world = bpy.data.worlds.get("World") or bpy.data.worlds.new("World")
print("world.cycles attrs:", [a for a in dir(world.cycles) if "ao" in a.lower() or "occlu" in a.lower() or "dist" in a.lower()])
scene = bpy.context.scene
print("scene.cycles attrs:", [a for a in dir(scene.cycles) if "ao" in a.lower() or "occlu" in a.lower() or "dist" in a.lower()])
print("scene.render.bake attrs:", [a for a in dir(scene.render.bake) if "ao" in a.lower() or "occlu" in a.lower() or "dist" in a.lower() or "cage" in a.lower()])
