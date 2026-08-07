# MADR 0045: StableGen for humanoid clothing/skin texture — cagematch, licence deferred

Status: Accepted (measured decision: **do not adopt as factory authoring path yet**)  
Date: 2026-08-07  
Issue: #132  
Evidence: `.openclinxr/evidence/stablegen-humanoid-texture/latest/probe-report.json`  
Probe: `tools/openclinxr/evidence/stablegen-humanoid-texture-probe.ts`

## Context

After #121 (body-surface garment shell) and #124 (hem continuity), shipped humanoid garments still
read as **flat single-colour fabric** — no fold shading, no seams, no weave. Geometry is defensible;
the *surface* is not. StableGen (Blender add-on, multi-view projection of diffusion imagery onto
existing mesh via local ComfyUI) is the documented candidate for that missing layer.

A prior availability-only probe (`anny-skin-cagematch-probe`, 2026-06-06) recorded the stack as
present but set `generationAllowedByThisReport: false` and left StableGen GPL-3 as a legal gate.
**Operator direction 2026-08-07, verbatim:** *"Let's try stablegen regardless of license.. we will
revisit."* That clears the licence gate for this cagematch only. It does **not** resolve licence
for product distribution.

### Licence position (must remain findable)

| Component | Licence | Position |
| --- | --- | --- |
| StableGen v0.3.0 | **GPL-3.0-or-later** (`blender_manifest.toml` SPDX) | **To be revisited.** Operator cleared a trial; not a permanent acceptance. |
| ComfyUI 0.24.0 | GPL-3.0 | Same: local backend for the trial; not vendored into the monorepo. |
| RealVisXL V5.0 fp16 | CreativeML Open RAIL++-M | Local-only cache; nonprofit medical-training use; no redistribution. |

**Boundary that still holds and that nobody waived:** StableGen is an **out-of-repo authoring tool**.
It is **not** vendored, **not** imported by repo code, **not** shipped. The repo receives generated
textures/images, a probe script, a report, and this MADR only.

## Decision

**Do not adopt StableGen as a factory clothing/skin texturing path yet.**

Verdict from the probe: `inconclusive_blocked`.

Measured reasons (not aesthetic judgment, not licence):

1. **StableGen enables on Blender 5.1.1** (`blender_version_min = 4.2.0`; enable works).
2. **StableGen connects to local ComfyUI** (`check_server_availability("127.0.0.1:8188") = true`).
3. **Generation does not complete under headless `blender -b`.** After enabling
   `preferences.system.use_online_access` and seeding the checkpoint list from
   `GET /models/checkpoints`, `bpy.ops.object.test_stable` poll passes and returns
   `RUNNING_MODAL` for four cameras — then hangs. After **600 s**, ComfyUI `/queue` was still
   empty; no texture files appeared under the StableGen output dir; the exported candidate GLB is a
   geometry re-export only (~10.4 MB), not a textured bake.
4. **Exact first blockers (attempt 1, before online access):**
   - `Operator bpy.ops.object.test_stable.poll() Blender's online access is disabled (File → Preferences → System)`
   - `add_cameras` → `AttributeError: 'NoneType' object has no attribute 'view_perspective'` (no 3D region in headless)
   - `model_name` enum stuck at `NONE_AVAILABLE` until the checkpoint cache is seeded from ComfyUI
5. **ControlNet unit mis-bind in the scripted attempt:** depth unit was added but `model_name`
   remained `"REFRESH"` rather than `controlnet_depth_sdxl.safetensors`.
6. **No texture ⇒ no headset texture-memory measurement.** `textureResolution` and `textureBytes`
   are null. Source humanoid `peds_nurse_kevin.glb` is **7 414 044** bytes; candidate re-export
   **10 431 408** bytes (geometry/material packing only).

### What this is not

- Not a finding that StableGen is incapable of texturing humanoids in the **GUI**.
- Not a finding that RealVisXL or ControlNet depth are broken (Comfy lists both models; the process
  has served `/system_stats` for days).
- Not clinical appropriateness, learner readiness, Quest readiness, or B+ visual realism.
- Not a resolved licence clearance — **to be revisited**.

## Stack as measured (this machine, 2026-08-07)

| Item | Observation |
| --- | --- |
| Blender | 5.1.1 on PATH |
| StableGen | v0.3.0 at `~/Library/Application Support/Blender/5.1/scripts/addons/stablegen/` |
| ComfyUI | Running: `cd ~/ComfyUI && /tmp/openclinxr-comfy-venv/bin/python main.py --listen 127.0.0.1 --port 8188` (PID started 2026-08-02, cwd `~/ComfyUI`, version 0.24.0) |
| Comfy venv on disk | **Hollow** — `/tmp/openclinxr-comfy-venv` python → mise 3.13, `import torch` fails. The live process still serves; if it dies, restart path is **unknown without re-provisioning**. No venv beside `main.py`. **Do not pip-install a new environment without operator approval.** |
| Checkpoint | `RealVisXL_V5.0_fp16.safetensors` (~6.9 GB) present |
| ControlNet | `controlnet_depth_sdxl.safetensors` present |
| IP-Adapter + CLIP vision | present under `~/ComfyUI/models/` |

No model download and no runtime install was performed for this cagematch.

## Measurements (named fields)

| Field | Value |
| --- | --- |
| `textureResolution` | `null` (no texture) |
| `textureBytes` | `null` (no texture) |
| `totalAssetBytes` | 10 431 408 (candidate re-export) / 7 414 044 (source) |
| `generationWallClockSeconds` | ~602 (timeout, not a successful generation) |
| `reproducibleFromSeed` | `false` — seed/prompt set; generation never finished |
| `drivableFromPhenotype` | `false` — hand prompt only; no `garmentLayers` driver |
| `uvLayoutPreserved` | `true` for the attempt (UV maps unchanged; no re-UV occurred because bake never ran). StableGen's `unwrap()` *can* add BakeUV when only ProjectionUV layers exist — risk remains for a successful run. |
| provenance | checkpoint `RealVisXL_V5.0_fp16.safetensors`; seed `132042`; prompt recorded in probe-report (anti-text negative included) |

## Visual (IN-SCOPE slots)

`IN-SCOPE VISUAL: garment surface flat solid teal scrubs, no weave/folds/seams ; skin flat flesh tone, no microtexture ; face not in frame (mid-torso camera) ; seams and folds none ; any lettering or insignia none (no diffusion applied)`

`CONTRACT_MET_VISUAL: not_comparable:no_texture_produced_after_equals_before_flat_scrubs`

Before and after: **BLENDER_EEVEE**, same camera. three.js/ui-xr render **not** attempted — no textured delta to load (a Cycles/Eevee beauty of an untextured mesh would repeat the #69 schematic-class trap).

OUT-OF-SCOPE WRONGNESS (named):

- head and neck cropped out of frame by front camera
- bare feet with no shoes or socks
- painted lower-body teal continuous with top (no waist fabric break)
- blunt mitten hands without finger separation
- small dark speck artifacts on upper arms near sleeve openings

## Consequences

Positive:

- Licence trial is **recorded** with the operator’s words and **to be revisited**, without vendoring GPL into the monorepo.
- Headless automation path is **measured closed** for StableGen’s modal operator — future work either uses a GUI session, or a non-StableGen Comfy workflow that does not depend on Blender modal event loops.
- ComfyUI start command and **hollow venv risk** are documented so the next agent does not invent a `pip install`.

Negative:

- Garment surface quality is still the product’s weakest visible layer; this cagematch did not improve it.
- Texture VRAM cost for headset posture remains **unmeasured** until a real bake exists.
- If the live ComfyUI process dies, the machine may no longer be able to start it without re-provisioning the `/tmp/openclinxr-comfy-venv` environment.

## Safety line (unchanged)

Generated textures must not put **text, insignia, badge numbers, name tags, or institutional branding**
on clinical figures. This run produced no diffusion texture, so lettering was not observed. Any future
successful run must grade lettering as a **defect** (same class as invented vitals, #115).

## Compliance and boundaries

- No cloud APIs, no paid services, no model downloads, no Blender rebuild.
- StableGen remains **outside** the repo tree.
- `claimScope`: local cagematch measurement only.
- `notEvidenceFor`: generated clothing quality; GUI success; B+ realism; production/Quest/learner readiness; clinical/scoring validity; **licence clearance resolved**; phenotype-driven pipeline.

## Recommended next (not decided here)

1. If the factory needs diffusion clothing: either (a) operator GUI StableGen session with the same humanoid + seed, or (b) a **headless Comfy workflow** (depth/canny → RealVisXL → project) that does not use StableGen’s modal operator.
2. Before either path: repair or document a **reproducible ComfyUI start** that does not depend on a hollow `/tmp` venv.
3. Licence **to be revisited** before any path that would distribute StableGen-generated assets under product terms that conflict with GPL-3 adjacency.

## Claim / residual

**CLAIM:** StableGen v0.3.0 enables on Blender 5.1.1 and connects to local ComfyUI 0.24.0 with RealVisXL + depth ControlNet present; headless `object.test_stable` enters `RUNNING_MODAL` then hangs 600s with an empty Comfy queue, so no humanoid texture was produced; licence remains deferred (**to be revisited**); tool stays out-of-repo.

**NOT TESTED:** StableGen GUI generation quality on a rigged humanoid; texture VRAM; seed reproducibility of a finished bake; phenotype→prompt automation; three.js/ui-xr learner view of a textured GLB; clinical appropriateness of any generated surface.
