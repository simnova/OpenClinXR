CMU-class BVH drop-in for full Anny/MakeHuman (~163) retarget
=============================================================

Pipeline:
  blender --background --python tools/openclinxr/asset-pipeline/anny/apply_bvh_to_anny_full.py -- \
    --mesh <anny_base.obj> \
    --rest-skeleton <anny_base.anny_rest_skeleton.json> \
    --bvh tools/openclinxr/asset-pipeline/anny/proof-animations/cmu/mblab_walking.bvh \
    --bvh tools/openclinxr/asset-pipeline/anny/proof-animations/cmu/mblab_running.bvh \
    --output-glb apps/ui-xr/public/cagematch/.../ed_....cmu-bvh-full.glb \
    --map mblab   # or auto|cmu|bandai

Lab:
  http://127.0.0.1:5173/_isolated-humanoid-lab/index.html?glb=.../ed_....cmu-bvh-full.glb&anim=glb:walk&physics=0
  (use index.html — directory URL falls back to SPA)

Bundled sources (CMU-class locomotion, not clinical validity):
  mblab_walking.bvh / mblab_running.bvh  — MB-Lab sample BVH (see LICENSE-MBLAB.txt)
  bandai_walk_normal.bvh                 — Bandai research (CC BY-NC; LICENSE-BANDAI.txt)

True CMU (cgspeed / mocap.cs.cmu.edu):
  Drop files as cmu_*.bvh here, then --map cmu.
  Auto-detect looks for LeftUpLeg / LHipJoint joint names.

Retarget method (v3 — full align + parent-local):
  1) hip translate  2) shoulder yaw  3) mean limb bone-Y object rotate (~90°)
  4) MB-Lab-style align_roll on mapped bones + mid-chain *02 before skinning
  5) L_a = L_a0 · shortest(inv(L_b0)·L_b)  parent-local body-fixed deltas
  6) rotation_quaternion only (no limb location keys)
  CMU map skips LHipJoint/RHipJoint (pad joints that twist Anny pelvis.*)
  Feet driven by default; hands rest-local unless --drive-hands
  Body-only maps skip fingers/toes; full 163 + fullSkinning; bindSnap ~12\" fix

Why alignment matters: Anny↔MB-Lab rest bone-Y/roll often differ ~70–130° after
BVH import. Parent-local channel copy without limb-Y + roll align flexes on the
wrong hinge plane. See MB-Lab animationengine.align_bones_z_axis + known issue
"Importing BVH animation files is buggy".

Evidence:
  v32 parent-local only · v33 world-delta · v34 roll-only · v35 full-align
  .openclinxr/evidence/physics-clinical-touch/isolated-humanoid-vision-2026-08-02/v35-full-align/
claimScope: animation_retarget_validation_not_clinical_validity

