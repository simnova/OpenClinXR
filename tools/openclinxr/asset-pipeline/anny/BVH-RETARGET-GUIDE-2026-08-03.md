# BVH → full Anny retarget handoff (2026-08-03)

**Audience:** next agent picking up locomotion retarget (not clinical / Quest / B+ work).  
**Status:** spike **partially succeeded**. MB-Lab walk is readable locomotion; residual axis / hand / CMU noise remain.  
**Claim scope:** `animation_retarget_validation_not_clinical_validity` only.

---

## BLUF

1. **Problem:** CMU / MB-Lab BVH on full MakeHuman/Anny (~163) looked “almost walking but hinges slightly wrong,” or crumpled earlier.
2. **Root cause (measured):** after Blender BVH import, Anny vs source rest **bone-Y** often differ **~90–99°**, and rest **roll-Z** often **~70–130°**. Parent-local joint deltas without frame align flex on the wrong plane.
3. **Current method:** `parent_local_after_full_align` (report schema v3) in `apply_bvh_to_anny_full.py`.
4. **Best visual today:** MB-Lab walk on `cmu-bvh-full.glb` (v35 evidence). CMU is better than early crumple but noisier than MB-Lab.
5. **Next agent:** improve residual hands / CMU / mid-chain LBS twist; do **not** restart from world `COPY_ROTATION` without re-reading history.

---

## Product / validation context

| Item | Value |
|------|--------|
| Mesh | Seated adult BOD Anny base OBJ (Y-up) |
| Skeleton | Full Anny/MH ~163 bones + `fullSkinning` LBS |
| Runtime consumer | Isolated humanoid lab (glass skin + skeleton overlay) |
| Not claims | clinical validity, scoring, Quest readiness, B+ visual gate, production asset readiness |
| Licenses | MB-Lab samples **AGPL** (local validation only); CMU diag clips free-all-uses; Bandai NC |

Primary actor path:

```
.openclinxr/asset-production/anny/seated-adult-bod-preview-2026-08-02/
  ed_chest_pain_patient_adult_bod.anny_base.obj
  ed_chest_pain_patient_adult_bod.anny_base.anny_rest_skeleton.json
```

Outputs:

```
apps/ui-xr/public/cagematch/seated-adult-bod-preview-2026-08-02/
  ed_chest_pain_patient_adult_bod.cmu-bvh-full.glb          # MB-Lab walk+run
  ed_chest_pain_patient_adult_bod.cmu-bvh-full.bvh-retarget-report.json
  ed_chest_pain_patient_adult_bod.cmu-diag.glb              # CMU walk+run
  ed_chest_pain_patient_adult_bod.cmu-diag.bvh-retarget-report.json
```

---

## Source of truth (code)

| Path | Role |
|------|------|
| `tools/openclinxr/asset-pipeline/anny/apply_bvh_to_anny_full.py` | **Main retarget bake** (edit this) |
| `tools/openclinxr/asset-pipeline/anny/anny_rest_skeleton.py` | Rest sidecar + fullSkinning export (already landed) |
| `tools/openclinxr/asset-pipeline/anny/proof-animations/cmu/` | MB-Lab + Bandai samples + LICENSE notes |
| `tools/openclinxr/asset-pipeline/anny/proof-animations/diag/` | CMU diag BVHs + LICENSE-CMU-DIAG.txt |
| `tools/openclinxr/asset-pipeline/anny/proof-animations/cmu/README-CMU-DROPIN.txt` | Drop-in usage notes (updated for v3) |
| `apps/ui-xr/public/_isolated-humanoid-lab/index.html` | Lab viewer (glass skin, skeleton, `?anim=glb:…`) |

### Joint maps (in `apply_bvh_to_anny_full.py`)

- **MAP_MBLAB** — `pelvis`, `thigh_L`, `calf_L`, …
- **MAP_CMU** — `Hips`, `LeftUpLeg`, …  
  **Important:** CMU **does not** map `LHipJoint`/`RHipJoint` → `pelvis.L`/`pelvis.R` (those are near-zero pad joints; driving them twisted hips).
- **MAP_BANDAI** — present; less validated recently.
- Drive defaults: feet **on**, hands **off** (`DEFAULT_SKIP_DRIVE` wrists), body-only skips fingers/toes unless `--include-extremities`.

---

## Current retarget pipeline (v3)

Method name in reports: **`parent_local_after_full_align`**.

```
1. Load Anny OBJ + rest JSON; optional bindSnap (~11–12" elevated bones → mesh)
2. Build full 163 armature (use_connect=False)
3. Probe-import first BVH:
   a. hip translate (bind rest heads)
   b. shoulder-line yaw (XZ)
   c. mean limb bone-Y object rotate  ← critical ~90° fix
   d. re-snap hips
   e. align_roll mapped Anny edit bones to BVH rest Z (world)
   f. mid-chain *02 (etc.) inherit nearest mapped ancestor Z
4. Apply fullSkinning AFTER rolls (bind must include new matrix_local)
5. Per clip BVH:
   a. re-do object aligns (hip/yaw/limbY)
   b. parent-local: L_a = L_a0 · shortest(inv(L_b0)·L_b)
   c. set rotation_quaternion only (no limb location keys)
   d. NLA strip per clip; export glTF without re-Y-up
```

### Why this shape

| Failed / weak approach | Why |
|------------------------|-----|
| World `COPY_ROTATION` | Mesh explode / LBS shred |
| `pb.matrix` + keyframe location | Non-zero basis loc on unconnected MH bones → crumple |
| Mute BVH action then restore without Blender 5 `action_slot` | Deltas went to **identity** (static A-pose) |
| Parent-local **without** limb-Y + roll | Hinges “a bit rotated” / wrong plane |
| World motion delta alone | More extreme limbs; not prettier than full-align local |
| Knee pole post-process | User rejected as “wonky”; wrong layer |

### MB-Lab first-party context (research, not inventing)

- README known issue: **“Importing BVH animation files is buggy.”**
- `animationengine.py` `RetargetEngine`: `align_bones_z_axis`, local vs world copy rotation, manual `correct_bone_angle` / rot offsets.
- No portable offset table for MakeHuman/Anny; our pipeline ports the *ideas*.

Probe that quantified mismatch:

```
.openclinxr/evidence/physics-clinical-touch/isolated-humanoid-vision-2026-08-02/v33-axis-probe/
  mblab-anny-rest-axes.json
  findings.json
```

Mean rest roll-Z mismatch ~95°, bone-Y ~92° **before** limb-frame rotate.

---

## Evidence ladder (do not confuse folders)

| Dir | What it is |
|-----|------------|
| `v31-axis-aware/` | Early world-delta; **crumpled** (stale) |
| `v32-parent-local/` | Parent-local only; decent silhouette, axis still off |
| `v33-world-delta/` | World delta + facing; extreme limbs |
| `v33-axis-probe/` | Rest-axis measurements |
| `v34-roll-align/` | Roll before skin; partial |
| **`v35-full-align/`** | **Current best** multi-frame sides + front + `REVIEW.json` |

Base:

```
.openclinxr/evidence/physics-clinical-touch/isolated-humanoid-vision-2026-08-02/
```

Also: lab lives under `apps/ui-xr/public/_isolated-humanoid-lab/` (not only evidence).

---

## How to bake (reproduce)

Requires Blender on PATH (validated on Blender 5.1.x). From repo root:

```bash
MESH=".openclinxr/asset-production/anny/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.anny_base.obj"
REST=".openclinxr/asset-production/anny/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.anny_base.anny_rest_skeleton.json"
OUT_DIR="apps/ui-xr/public/cagematch/seated-adult-bod-preview-2026-08-02"
SCRIPT="tools/openclinxr/asset-pipeline/anny/apply_bvh_to_anny_full.py"

# MB-Lab walk + run (scale 0.01 cm→m style)
blender --background --python "$SCRIPT" -- \
  --mesh "$MESH" --rest-skeleton "$REST" \
  --bvh tools/openclinxr/asset-pipeline/anny/proof-animations/cmu/mblab_walking.bvh \
  --bvh tools/openclinxr/asset-pipeline/anny/proof-animations/cmu/mblab_running.bvh \
  --output-glb "$OUT_DIR/ed_chest_pain_patient_adult_bod.cmu-bvh-full.glb" \
  --map mblab --scale-bvh 0.01 --no-root-motion

# CMU walk + run (scale 0.1; no root motion keeps character in frame)
blender --background --python "$SCRIPT" -- \
  --mesh "$MESH" --rest-skeleton "$REST" \
  --bvh tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_07_01_walk.bvh \
  --bvh tools/openclinxr/asset-pipeline/anny/proof-animations/diag/cmu_16_15_run.bvh \
  --output-glb "$OUT_DIR/ed_chest_pain_patient_adult_bod.cmu-diag.glb" \
  --map cmu --scale-bvh 0.1 --no-root-motion
```

Useful flags:

| Flag | Meaning |
|------|---------|
| `--no-root-motion` | Prefer for lab (root motion walks off-camera) |
| `--no-drive-feet` | Feet rest vs shin (plantigrade experiment) |
| `--drive-hands` | Drive wrists (currently default off) |
| `--include-extremities` | Fingers/toes (risky axis noise) |
| `--map auto\|cmu\|mblab\|bandai` | Force map |

Check report after bake:

```bash
python3 -c "import json; r=json.load(open('apps/ui-xr/public/cagematch/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.cmu-bvh-full.bvh-retarget-report.json')); print(r['retargetMethod'], r.get('rollAlign',{}).get('preSkinLimbFrame'), r.get('rollAlign',{}).get('midChainRolled'))"
```

Expect roughly:

- `retargetMethod`: `parent_local_after_full_align`
- limb frame angle ~90–100°
- mid-chain rolled count > 0
- walk `max_joint_delta` in log on order of **tens of degrees**, not ~350° (shortest-arc)

---

## How to test in the lab

1. Serve UI-XR so static public files resolve (typical: Vite **http://127.0.0.1:5173**).  
   Confirm: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/_isolated-humanoid-lab/index.html` → `200`.
2. **Must use `index.html`** in the path (directory URL can fall through to SPA).
3. Hard-refresh after rebake (GLB cache).

### Primary test URL (MB-Lab walk — start here)

```
http://127.0.0.1:5173/_isolated-humanoid-lab/index.html?glb=/cagematch/seated-adult-bod-preview-2026-08-02/ed_chest_pain_patient_adult_bod.cmu-bvh-full.glb&anim=glb:walking&physics=0&skeleton=1&skinOpacity=0.28
```

### Other clips

| Clip | URL params |
|------|------------|
| MB-Lab run | same GLB, `anim=glb:running` |
| CMU walk | `…cmu-diag.glb&anim=glb:07_01&physics=0&skeleton=1&skinOpacity=0.28` |
| CMU run | same diag GLB, `anim=glb:16_15` |

### What “good” looks like

- Side view: alternating stride, knees flex **forward**, feet plantigrade-ish, torso upright.
- Not: crumpled mesh, fused limbs, static A-pose with “playing” HUD only, reverse knees every frame, skeleton floating 12" above mesh.
- HUD should show `animation playing`, joints ~169, `anim=openclinxr_bvh_…`.

### Automated capture pattern (Playwright)

Repo has `playwright`; lab may expose `window.__isoCamera` / `window.__isoControls` for side/front framing. Example capture dir: `v35-full-align/`. Pattern:

- `goto` lab URL with cache-bust `&_ts=`
- wait for body text `animation playing`
- set camera side `(2.05, 1.05, 0.12)` target `(0, 0.95, 0)`
- multi-frame side screenshots + front

---

## Current visual assessment (agent review, 2026-08-03)

| Asset | Verdict |
|-------|---------|
| **MB-Lab walk** | **Best.** Clear walk cycle; forward knees; usable side silhouette. Hands still blob (wrists off). |
| MB-Lab run | Readable run pose; some arm noise. |
| CMU walk | Side stride OK; front/arms/spine noisier than MB-Lab. |
| CMU run | Still the weakest of the four. |

Quantitative bake logs (last full run):

- MB-Lab limb-Y fix **99.3°**; roll **32** bones (**14** mid); max joint Δ walk **55°**
- CMU limb-Y fix **90°**; roll **32** (**13** mid); max joint Δ walk **~97°**; **19** mapped pairs (no hip pads)

---

## Known residuals / traps for the next agent

1. **Hands / wrists** — default skip; orange joint clusters in lab. Try `--drive-hands` carefully; extremities historically shred LBS if axes bad.
2. **Mid-chain vs mapped** — mid bones get roll inheritance only; they stay rest rotation (no BVH channels). Skin twist between rolled segments can remain.
3. **Blender 5 layered actions** — do **not** mute BVH `action = None` without restoring `action_slot`. Prefer rest from `bone.matrix_local`.
4. **Location keyframes** — never key non-root location after setting `pb.matrix` with head translation; use rotation-only apply (`_set_world_rotation_basis_only`).
5. **Root motion** — off for lab framing; on for “character walks away.”
6. **License** — don’t ship MB-Lab BVH as product without AGPL plan; prefer CMU for product-facing path once quality matches.
7. **Orchestrator vs IC** — this thread did product IC on the pipeline; main-session orchestrator rules may still apply in other sessions (spawn asset-pipeline-lead if required).
8. **Do not** reintroduce knee pole solvers as the primary fix; user rejected as wonky.

---

## Recommended next slices (ordered)

### A. Close residual “axis off a little” on MB-Lab (if still visible)

1. After full align, re-run rest-axis probe (compare Anny vs BVH bone-Y/Z on mapped pairs post-limb-frame) — expect near-0°, not ~90°.
2. If residual roll only: MB-Lab-style **per-bone small Euler offsets** table (their `correct_bone_angle` idea), not a pole.
3. Optional: drive wrists with low influence / body-only still off fingers.

### B. Make CMU match MB-Lab quality

1. Audit spine map density (`LowerBack`/`Spine`/`Spine1` → Anny multi-spine) for double-rotation.
2. Verify scale 0.1 vs 0.01 and import `axis_forward`/`axis_up` for CMU specifically.
3. Prefer free CMU clips for any long-term lab default once quality is OK.

### C. Pipeline hygiene

1. Unit/diagnostic script: bake 1 frame + assert max joint delta & non-zero thigh swing (catch Blender 5 slot bugs).
2. Keep evidence under `vNN-*` with `summary.json` + `REVIEW.json`; don’t overwrite without new version dir.
3. If committing: code + README/handoff; **not** large GLBs unless policy allows public cagematch assets.

### D. Out of scope unless Patrick expands

- Quest headset claims, clinical validity, Mixamo (account/license), production promotion of Anny as B+ ready.

---

## Quick “is the spike still green?” checklist

- [ ] `retargetMethod` is `parent_local_after_full_align` in both reports  
- [ ] Bake log shows limb frame angle ~90°+ and mid-chain rolls > 0  
- [ ] Lab MB-Lab walk side view shows stride (not crumple / not static bind)  
- [ ] `bindSnap` offsetYInches ~11 if applied, or “below threshold” if already snapped offline  
- [ ] No knee pole code path  
- [ ] CMU map has no `LHipJoint`/`RHipJoint`  

---

## Contacts in-repo

- Pipeline ownership: asset-pipeline-lead / rigging-animation-specialist  
- Lab / UI-XR consumer: xr-systems-architect  
- Adversarial “is this fixture?”: productivity-skeptic  
- This handoff supersedes chat for state; evidence under `v35-full-align/REVIEW.json` is the last visual review snapshot.

**Primary code entry:** `tools/openclinxr/asset-pipeline/anny/apply_bvh_to_anny_full.py`  
**Primary test URL:** lab + `cmu-bvh-full.glb` + `anim=glb:walking` (see above).
