# Anny rest skeleton → OpenClinXR runtime subset

## Proven path

1. **Anny** (MakeHuman-style) authors rest pose in model space (~**163** bones, LBS).
2. `generate_mesh.py` exports mesh (Y-up) + **`*.anny_rest_skeleton.json`** (163 + collapsed **23** runtime bones + weights).
3. `automate_blender.py` builds the runtime armature **from that rest**, not mesh-bbox invent.
4. Lab / UI-XR consumers use the **23-bone** subset; full 163 remains in the sidecar for future retarget.

## Files

| File | Role |
|------|------|
| `runtime_bone_map.json` | SSOT 163→23 map (names, parents, weight sources) |
| `anny_rest_skeleton.py` | Export helper + weight collapse |
| `*.anny_rest_skeleton.json` | Per-asset sidecar next to `.anny_base.obj` |

## Revisit when

Animation retarget or finger-level clinical gesture needs richer DOF — expand the runtime subset via the map; do not invent a second bbox rig.

## Claim control

Not clinical validity, scoring, Quest readiness, or B+ realism. Rig interop only.
