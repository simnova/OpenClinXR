---
title: Cagematch — kimodo-mlx (NVIDIA Kimodo-SOMA-RP-v1.1) as a learned motion provider, local generation attempt
authority: evidence
scope: motion
last-updated: 2026-09-26
relates-to: docs/openclinxr/kimodo-soma-rp-v11-cagematch-2026-09-09.md, docs/openclinxr/kimodo-cpp-cagematch-2026-08-23.md, docs/openclinxr/third-party-asset-licence-ledger.md
---

# Cagematch — kimodo-mlx local generation, bedside-approach clip

Date: 2026-09-26
Question: does a local Apple-Silicon path (`NomaDamas/kimodo-mlx`) clear licensing and execution for
`nvidia/Kimodo-SOMA-RP-v1.1`, resolve the 2026-09-09 cagematch's joint-manifest contradiction, and
produce a usable bedside-approach clip on `mpfb-clinical-physician-adult.glb`?

---

## VERDICT: `inconclusive_blocked` — licensing and generation succeed; retarget bake fails downstream

**One sentence:** licensing is clean and better than expected (no HF token needed at all), the
2026-09-09 manifest contradiction is now definitively resolved (SOMA-RP-v1.1 is unambiguously the
30-joint skeleton), and local generation on this M1 Max works end to end in ~50s/seed — but the
existing Blender `retarget_bvh` bind stage, after two real bugs in this repo's own injector were found
and fixed, bakes only a single frame onto the target rig for reasons not yet isolated, so no bound GLB,
no foot-slide measurement and no comparison render exist yet.

This is a genuine cagematch result under the brief's own rule: "no eligible provider or no demonstrated
benefit means retain the baseline." Nothing here displaces the shipped
`openclinxr_retarget_walk_source` clip. Record it as a positive step (licence + joint question closed,
generation proven) with a specific, reproducible blocker for the next slice.

**Same-day round 2 (below, after the first "Recommended next step") narrowed that blocker to a
general, Kimodo-independent Blender-addon defect, proved the fix here is byte-identical for the shipped
bind (now gated behind an opt-in flag regardless), and verified the official `nv-tlabs/kimodo` stack
runs on this machine's CPU in 21 seconds with a materially better constraint/BVH-export API than
kimodo-mlx.**

---

## Step 1 — Licences, VERIFIED

Full detail and URLs are in `docs/openclinxr/third-party-asset-licence-ledger.md` (new rows, dated
2026-09-26). Summary:

| component | licence | gated? | verified how |
|---|---|---|---|
| `NomaDamas/kimodo-mlx` (code) | MIT | n/a (public repo) | read `LICENSE` at the clone |
| `nvidia/Kimodo-SOMA-RP-v1.1` (weights) | NVIDIA Open Model License, "ready for commercial use" | **No** — measured: unauthenticated `hf download` succeeded, unauthenticated `resolve/main/README.md` returns 200, HF API `"gated": false` | model card + repo `LICENSE` + HF API |
| `LocalAI-io/Llama-3-Kimodo-GGML` (converted text encoder) | Meta Llama 3 Community License, compliant redistribution (ships `LICENSE-META-LLAMA-3.txt` + `NOTICE`) | **No** — `"gated": false`, unauthenticated download succeeded | HF API + repo files |
| `meta-llama/Meta-Llama-3-8B-Instruct` (the underlying model the above converts) | Meta Llama 3 Community License | **Yes**, `"gated": "manual"` | HF API |
| `localai-org/kimodo.cpp` (not used, re-checked in passing) | **Now Apache-2.0** — corrects the 2026-08-23 cagematch's "no licence file" finding | n/a | `gh api repos/localai-org/kimodo.cpp --jq .license` |

**The operator's runbook expected a hard block on the gated `meta-llama/Meta-Llama-3-8B-Instruct`
repo and no `HF_TOKEN` in the environment (confirmed absent: no `HF_TOKEN`, no
`HUGGING_FACE_HUB_TOKEN`, no `~/.cache/huggingface/token` at task start).** That block never
materialized, because `kimodo-mlx`'s own quick-start downloads a pre-converted, ungated GGUF
distribution of the exact same encoder (`LocalAI-io/Llama-3-Kimodo-GGML`, "converted from Meta
Llama-3-8B-Instruct and the MIT-licensed McGill LLM2Vec ... adapters"), published under the Llama 3
licence's own redistribution terms with the licence text and NOTICE attached. Everything in this
cagematch ran without any Hugging Face authentication.

**Mid-task, the operator unblocked the gate anyway**: `hf auth whoami` now returns `simnova-llc`, and
`meta-llama/Meta-Llama-3-8B-Instruct` returns 200 authenticated. This was not needed for the work
above — noted for completeness and for any future path that wants the raw safetensors directly rather
than the GGUF conversion.

## Step 2 — Install

`~/.openclinxr-tools/kimodo/kimodo-mlx` (outside the repo, per instructions). `uv venv --python 3.12`
+ `uv pip install -e ".[dev]"` succeeded cleanly (mlx 0.32.2, torch 2.14.0 as a CPU fallback path,
gguf, safetensors). `kimodo-mlx diagnose` reports:

```json
{"backend_selected": "mlx-metal", "machine": "arm64", "mlx_installed": true, "neural_engine_used": false, "platform": "macOS-26.5.2-arm64-arm-64bit"}
```

MLX-Metal selected on this M1 Max — the local execution path the 2026-09-09 brief could not establish
(that brief's machine profile section explicitly said "an unavailable M1 path blocks local-execution
claims"). **That is now settled: mlx-metal runs.**

## Step 3 — Joint manifest, RESOLVED (not merely re-asserted)

The 2026-09-09 cagematch refused on a measured contradiction: the `nv-tlabs/kimodo` README says
`somaskel77` while the `Kimodo-SOMA-RP-v1.1` model card says 30 joints, "their exact relationship
remains unverified." That brief named the exact settling test: *"download the safetensors and read
the actual output tensor shape, or find an NVIDIA statement pinning the v1.1 checkpoint to a named
skeleton revision."* Both were done:

1. **`config.yaml` inside the downloaded checkpoint** (not merely the model card prose) names
   `skeleton: _target_: kimodo.skeleton.SOMASkeleton30` explicitly.
2. **`nv-tlabs/kimodo`'s own source** (`kimodo/skeleton/definitions.py`, Apache-2.0, read directly from
   GitHub) defines `SOMASkeleton30` and `SOMASkeleton77` as two **distinct, separately-named classes**
   with different `bone_order_names_with_parents` lists (30 vs 77 entries). The README's 77-joint
   language names the other class — used by other/newer checkpoints — not this one. There is no
   contradiction; there are two different skeletons in the same codebase, and SOMA-RP-v1.1 is pinned
   to the 30-joint one by its own config.
3. **Independent cross-check**: `kimodo-mlx`'s own `motion.py` hardcodes `SOMA_PARENTS`, a 30-entry
   parent-index tuple. I verified it **index-for-index** against `SOMASkeleton30.bone_order_names_with_parents`
   — every parent index matches every named parent relationship exactly (Hips→root, Spine1→Hips,
   ... RightToeBase→RightFoot). Two independently-authored sources (NVIDIA's Python skeleton
   definitions, a third party's from-scratch Apple Silicon port) agree completely.

**This closes the 2026-09-09 verdict's step 1 ("A pinned statement of which skeleton the v1.1
checkpoint emits") and step 2 ("a joint-by-joint MPFB correspondence for that skeleton").** A new
source map, `tools/openclinxr/asset-pipeline/makeclothes/known-rigs/kimodo-soma-skeleton30.json`,
gives the joint-by-joint SOMA30→MHX correspondence (fingerprinted, same schema as the existing
`mesh2motion-human-66.json`).

## Step 4 — Generation: DONE, 3 seeds, no path/effector constraints

**Constraint support: NOT AVAILABLE.** Read `kimodo_mlx/runtime.py` and `cli.py` directly:
`generate(prompt, manifest, config)` takes only a text prompt, frame count, step count, seed and
backend. There is no pose-constraint, waypoint or path-effector parameter anywhere in the port. This
mirrors what the 2026-08-23 kimodo.cpp cagematch already found for that C++ port (constraints "not
implemented yet") — the Apple Silicon MLX port inherits the same limitation. Generation here is
**text-prompt-only**.

Prompt: *"A person walks forward about four steps, stops, then turns about sixty degrees to one side
to face a bed beside them."* 90 frames (3s @ 30fps), 100 DDIM steps, backend `auto` (resolved to
`mlx-metal`).

| seed | wall time | backend | output sha256 |
|---|---|---|---|
| 42 | 58.2s | mlx-metal | `7ffd47a2e8d18ac83e6e95d5436572a891752601e0fe67665e8a7ac6fd502142` |
| 7 | 55.8s | mlx-metal | `5ec20239b2a0b447f0a4b520682269838746ed66edda2474d3cfb093f2bda11b` |
| 1001 | 47.1s | mlx-metal | `9c06ff2099e976acad864e53eb3a25fc3ed021790c77955bd8a18ccb7edb7d42` |

Checkpoint: `model.safetensors` sha256 `ef0a0ca45a6089ab4532dde609785771ae3f38755b4ae6cf314b0213e07cd4a3`.
`kimodo-mlx` commit `bbb592aa2046361be541ab4f5e2b0e9ba4869b21`. Full manifest with paths:
`~/.openclinxr-wip/kimodo/generations/bedside_approach_manifest.json` (gitignored scratch, not
committed — per instructions, output GLBs and intermediate generations stay outside the repo).

**Sanity check on seed 42's root trajectory** (not a clinical or realism claim, just "did something
plausible happen"): pelvis height stays ~0.99-1.0m throughout, forward (Z) travel ~1.7m, lateral (X)
drift ~0.57m over 90 frames — consistent with a forward walk plus a lateral turn, not degenerate
output. Raw BVH import of this same file into a bare Blender scene shows 93 fcurves (Hips
location/rotation × 3 axes + 30 joints × 3 rotation channels folded into the hierarchy) each with the
full 90 keyframes, values genuinely varying frame to frame (e.g. `LeftShoulder` local rotation moves
through several distinct quaternion values across the first 3 frames, not held constant) — the
**generation is producing real, varying motion.**

## Step 5 — Retarget onto the physician GLB: BLOCKED, root cause narrowed but not resolved

The BVH export (scratch tool, not committed) uses the exact SOMA30 hierarchy and parent chain from
step 3, Zrotation/Xrotation/Yrotation channel order, generic adult-proportion bone offsets (exact
lengths are approximate — the checkpoint publishes root-translation normalization stats only, not
joint rest offsets).

Running the existing `packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_stage.py`
(the physician's own proven recipe) with the new source map surfaced and fixed **two real bugs** in
that shared script's `_inject_source_map` function, both now committed:

1. **Missing enum registration.** `_inject_target_map` registers its name into `BD.targetEnums` (the
   list backing the addon's `TargetRig` dropdown); `_inject_source_map` never did the equivalent for
   `BD.sourceEnums`. `findSourceArmature(auto=True)` still finds a fingerprint match against
   `BD.sourceInfos` (a plain dict) and tries to assign that name to the `SourceRig` RNA enum property
   — which fails with `TypeError: enum "<name>" not found` unless the name is also in `sourceEnums`.
   This was invisible for every prior `--source-map` user (`mesh2motion-human-66`) only because
   `"Mesh2Motion"` happens to already be one of the addon's built-in preset names, which apparently
   matched first. A skeleton with no built-in preset (SOMA30) has nothing to fall back on.
2. **Name overwritten by the JSON's own "name" field.** `CRigInfo.readFile` sets `self.name` from the
   JSON's own `"name"` key when present — a human-readable display string, not the file-stem slug this
   function registers as the dict/enum key. `setSourceArmature` (called a second time during
   `retargetAnimation`) reads `mcpRna(rig).Armature` (== that display-string name) and hits the exact
   same enum-not-found failure a second time. Fixed by pinning `info.name` back to the registered slug
   after `readFile`.

With both fixes, the bind runs to the addon's own reported success (`"BVH file(s) retargeted"`),
correctly identifies and name-matches all 30 SOMA joints against the target rig (log: `"Using source
armature kimodo-soma-skeleton30"`), and completes a full 91-frame retarget loop with visible progress.
**But the baked result on the target rig carries only 1 keyframe per bone** (frame 0), not the
expected ~91 — confirmed via the same layered-action-aware fcurve iterator
(`_iter_action_fcurves`) the stage's own `_driven_bones` check uses, so this is not a diagnostic
artifact. `driven=0 real=0`, and the stage correctly refuses with `zero_or_thin_channels` rather than
publishing a static-pose "clip."

**Diagnosis performed, not yet conclusive:**
- Confirmed the source armature's per-frame pose genuinely changes (`LeftShoulder`'s local quaternion
  differs materially frame 0 → 1 → 2) at the exact point the addon's own bake loop reads it
  (`CBoneAnim.retarget`), so the SOURCE side is not the defect.
- Confirmed `getActiveFrames` correctly enumerates all 91 frames and the bake loop iterates all of
  them (`showProgress` fires at 0/22/44/66/88/100%).
- A synthetic leading rest/T-pose frame (the pattern the existing pipeline already handles via
  `graft-bound-clip.ts:dropLeadingRestFrame` for CMU clips) did **not** change the outcome — ruled out
  as the cause.
- The surviving keyframe sits at frame 0 specifically (not the last-processed frame), which is more
  consistent with only the *first* `keyframe_insert` call actually landing than with a last-write-wins
  collapse — a plausible fit for a Blender 5.1 new-layered-action-system regression in this
  Blender-4.x-era addon's direct `pb.keyframe_insert(...)` calls, but this was **not confirmed** before
  time ran out on this slice; deeper tracing crashed on API differences in my own throwaway debug
  patches (reverted, addon restored to its pristine vendored state — `diff` confirms clean).

**NOT DONE as a result:** no bound physician GLB with a new `openclinxr_retarget_kimodo_*` clip exists;
no foot-slide/turn-smoothness/lurch measurement against the shipped clip; no comparison render. All
three depend on the retarget bake actually producing a multi-frame action.

## Step 6/7 — not reached

Measurement and rendering are blocked on step 5. The licence ledger row and this document are the
committed deliverables from this slice; the shipped `mpfb-clinical-physician-adult.glb` and its
existing `openclinxr_retarget_walk_source` clip are untouched.

## claimScope / notEvidenceFor

**claimScope:** licence and gating status of `kimodo-mlx`, `Kimodo-SOMA-RP-v1.1`, and
`Llama-3-Kimodo-GGML` as of 2026-09-26; the SOMA-RP-v1.1 output skeleton (definitively 30-joint,
code-verified from two independent sources); local generation feasibility and wall-clock cost on this
M1 Max; the exact two defects found and fixed in `motion_bind_stage.py`'s source-map injection; the
measured 1-keyframe retarget-bake failure and what was ruled out as its cause.

**notEvidenceFor:** clinical or visual motion quality (no clip was ever fully bound or rendered);
foot-slide, turn-smoothness or lurch relative to the shipped walk clip (not measured — blocked);
whether the root cause of the 1-keyframe bake is specific to SOMA-sourced BVH, to this particular
Blender 5.1 build, or to a broader class of custom (non-Mesh2Motion, non-CMU) source maps; any
statement about `nv-tlabs/kimodo` (the CUDA-first upstream, not run here) or `localai-org/kimodo.cpp`
beyond its now-corrected licence status.

## Recommended next step (as of the first round, superseded below)

Isolate the 1-keyframe bake defect directly through a minimal reproduction. **Done — see the
2026-09-26 round 2 section below.**

---

# Round 2, same day — coordinator-directed follow-up

Four items, addressed in order.

## 1. Known-good route first: does the "Unreal Engine" built-in preset path avoid the bug?

**No — the defect reproduces through the exact known-good pathway too, and on a trivial case that has
nothing to do with Kimodo.** Two escalating tests, both confirming the bug is general:

**Test A — route the generated clip through the SAME file shape the working recipe uses.** The
physician's proven walk bind passes a **`.glb`** to `--clip` (via `extract-library-clip.ts`), not a
raw `.bvh`; the addon internally does glTF-import → `saveGltf2Bvh` → re-import. My first round tested
only a raw `.bvh`. Re-tested by importing the SOMA30 BVH into a fresh Blender scene and re-exporting it
as a `.glb` with baked animation (matching the shipped recipe's exact input shape), then binding that
`.glb` through `motion_bind_stage.py` with the `kimodo-soma-skeleton30.json` source map. **Identical
failure**: `driven=0 real=0`, one keyframe per bone. File format is not the cause.

**Test B — does the addon's own built-in "Unreal Engine" preset actually get used for the shipped
clip, and does routing through IT avoid the bug?** Reading the addon's shipped preset files
(`known_rigs/*.json`) settles something my first-round comment got wrong: the physician's shipped
mesh2motion walk clip does **not** match the built-in `"Mesh2Motion"` preset (that preset's fingerprint
is `["DEF-spine001", "DEF-toeL"]` — a `DEF-`-prefixed naming convention the actual clip's bones,
`pelvis`/`spine_01`/`thigh_l`, never carry). It matches the built-in **`"Unreal Engine"`** preset
(`known_rigs/unreal.json`, fingerprint `["spine_01", "calf_l"]`) instead — confirmed directly in the
bind log: `"Using source armature Unreal Engine."` **This preset requires all ~52 of its named bones
present** (`"optional": []`), including 30 finger joints SOMA30 does not have, so a
Kimodo-sourced clip can categorically never match it or any other built-in preset — a custom source
map is unavoidable for SOMA30 regardless of which bug gets fixed.

**Test C — the decisive one: a trivial 3-frame, 11-joint, hand-authored BVH with a custom source map,
nothing Kimodo about it at all.** Built a minimal BVH (Hips + Spine1 + Chest + LeftShoulder + LeftArm +
both legs, matching only the bones `Auto T-pose` needs for its standing-reference calculation) with an
obvious 90° rotation on `LeftArm` at frame 1 (of 3), identity elsewhere, and a matching 5-real-bone
custom source map. **Same failure**: `driven=0 real=0` — the bind log shows the full sequence
(`Using source armature trivial-probe-map` → `Retargeted ... (100%)`) succeeding exactly like the
Kimodo case, and produces exactly one keyframe.

**Conclusion: this is not a Kimodo-specific or SOMA30-specific defect.** It reproduces on ANY custom
`--source-map` whose clip does not fingerprint-match one of the addon's built-in presets, using
minimal, completely synthetic data. This is a general Blender-5.1-compatibility regression in
`retarget_bvh`'s custom-source-map bake path, previously invisible in this repo only because the one
existing custom source map (`mesh2motion-human-66.json`) has never actually been selected — see
item 2. Worth a narrow upstream report to the addon author or a from-scratch bake-loop replacement;
neither was attempted here (out of scope for a licence/generation cagematch).

## 2. A/B diff of the shipped physician walk bind, with and without the `_inject_source_map` fixes

**Measured, not reasoned: the two code paths produce byte-identical output.** Rebuilt the exact
physician recipe (extracted `Walk` from the Mesh2Motion library GLB via `extract-library-clip.ts`,
stripped the actor's existing animation, ran `motion_bind_stage.py` with `mesh2motion-human-66.json` +
`"First person, Z up"`) three times: once against the pre-fix commit (`3c31d5dc9`), twice against the
current tree (with and without the new opt-in flag).

| run | sha256 | driven | source armature used |
|---|---|---|---|
| pre-fix (`3c31d5dc9`) | `1e30385d0…` | 51 | **Unreal Engine** (built-in) |
| current tree, `--source-map-enum-fix` **not** passed | `1e30385d0…` | 51 | Unreal Engine |
| current tree, `--source-map-enum-fix` passed | `1e30385d0…` | 51 | Unreal Engine |

All three GLBs hash identically. The reason, per item 1 Test B: the shipped clip's joint names already
satisfy the built-in "Unreal Engine" preset, which `guessArmatureFromList` matches before ever
reaching the custom `mesh2motion-human-66` entry in `BD.sourceInfos` (dict insertion order) —
**the custom map has never actually been used for this bind, before or after the fix.** The fix only
changes behavior for a source map with no matching built-in preset.

**Gated behind an explicit opt-in flag per the coordinator's request, regardless of the byte-identical
proof above** (defense in depth — the proof covers today's one shipped clip, not every future one):
`--source-map-enum-fix` on `motion_bind_stage.py`, default **off**. `bind-walk-clip-all.ts` and every
other existing call site do not pass it, so shipped binds are byte-for-byte pinned to the old code
path forever, independent of future edits to `_inject_source_map`. The Kimodo bind attempts in this
document all pass the flag explicitly.

## 3. Capture and measurement

**Not reached.** Both items depend on a clip that actually bakes multi-frame motion, and item 1 confirms
the bake failure is a general addon defect, not something a "known-good route" swap fixes. No bound
Kimodo GLB exists to capture or measure. Nothing changed here since the first round.

## 4. Official `nv-tlabs/kimodo` (Apache-2.0) on this Mac: API and one timing

**Installed and run.** `git clone --depth 1 https://github.com/nv-tlabs/kimodo`; the native
`MotionCorrection` C++ extension's CMake build hardcodes x86 SIMD flags (`-msse4.1`, `-mavx`) and fails
on arm64 — the repo's own `setup.py` documents an escape hatch,
`SKIP_MOTION_CORRECTION_IN_SETUP=1 pip install -e .`, which built cleanly (torch 2.14.0, transformers
5.1.0, no CUDA required at install time).

**Constraint API confirmed present and real** (this is the capability kimodo-mlx lacks entirely):
`kimodo/constraints.py` defines `Root2DConstraintSet` — fixes root `(x, z)` trajectory and optionally
global heading on named frames, with SOMA 30↔77 joint-count conversion handled internally. The CLI
(`kimodo/scripts/generate.py`, installed as `kimodo_gen`) exposes `--constraints <saved constraint
file>`, native `--bvh` export (SOMA models only, with `--bvh_standard_tpose` for a standard rest pose
instead of the training-data rest pose), `--num_samples`, `--seed`, and duration/step controls. This is
a materially more capable interface than kimodo-mlx's text-only `generate()` — exactly the "walk to X,
turn to face Y" shape this project needs, and it also solves the earlier BVH-export gap (no more
approximate hand-authored bone offsets).

**Device:** `generate.py` hardcodes `"cuda:0" if torch.cuda.is_available() else "cpu"` for the main
denoiser (no MPS branch); patched locally (not committed — a one-line throwaway edit) to prefer MPS
when CUDA is absent, since `torch.backends.mps.is_available()` is `True` on this M1 Max. The text
encoder honors `TEXT_ENCODER_DEVICE` as an environment override independently of the main model's
device.

**Text encoder path uses the gated repo's HF identity, not the ungated GGUF conversion.**
`TEXT_ENCODER_PRESETS["llm2vec"]` loads `McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp` (MIT-licensed
itself, `"gated": false`) as a PEFT base plus `McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised`
(also MIT, also ungated) — this is a **different** encoder path than kimodo-mlx's GGUF bundle, and it
is the one place in this cagematch where the now-open `meta-llama/Meta-Llama-3-8B-Instruct` gate could
matter, if the McGill adapter's base-model resolution reaches into the gated repo at load time. Ran
with `HF_HOME` pointed at the now-authenticated `~/.cache/huggingface` (token present via `hf auth
whoami` = `simnova-llc`) precisely to cover that case regardless.

**MPS attempted, fails on a real bug; CPU works cleanly.** With the one-line device patch, `Kimodo.__init__`
raises `TypeError: Cannot convert a MPS Tensor to float64 dtype as the MPS framework doesn't support
float64` — a genuine MPS-backend limitation (float64 buffers somewhere in the model), not a
configuration error. Reverted the patch (file restored, diffed clean against the pristine clone) and
ran on CPU instead, per `generate.py`'s own unmodified device selection.

**Full end-to-end success on CPU, native BVH export, correct joint offsets.**

```sh
SKIP_MOTION_CORRECTION_IN_SETUP=1 pip install -e .   # arm64-buildable subset
kimodo_gen "walk forward" --model Kimodo-SOMA-RP-v1.1 --duration 3.0 \
  --diffusion_steps 20 --seed 42 --no-postprocess --output walk_test --bvh
```

`--no-postprocess` was required: the default post-processing path calls into the `motion_correction`
C++ extension I had to skip at install (the same x86-SIMD build failure), and refuses cleanly with
`RuntimeError: Motion correction is required for this postprocessing path but the motion_correction
package is not installed` rather than silently degrading — a well-behaved refusal, not a crash.

**Timing: 21.1 seconds wall-clock** for model load (weights already in the OS/HF disk cache from the
earlier attempt) + text encoding + 90-frame / 20-diffusion-step generation + BVH export, single CPU
process. Progress bar shows ~3.9 it/s for the diffusion loop itself (20 steps in 5.1s); the remainder
is model loading and encoding. Model + adapter weights pulled **~33 GB** into
`~/.cache/huggingface/hub` on first run (the raw bf16 8B LLM2Vec base plus its supervised adapter, both
far larger than kimodo-mlx's pre-quantized GGUF bundle) — a one-time cost, not part of the 21.1s.

**Output: `walk_test.npz` (587 KB) + `walk_test.bvh` (213 KB).** The NPZ carries
`local_rot_mats`/`global_rot_mats`/`posed_joints` at **`(90, 77, 3, 3)`**/`(90, 77, 3)` — the CLI's
default `--bvh` export upconverts SOMA30 to the 77-joint skeleton (`output_to_SOMASkeleton77`, the same
conversion path read from source in the joint-manifest section above), plus `foot_contacts` at
`(90, 6)` bool — real per-frame foot-contact labels, which would remove the guesswork my own
contact-band heuristic needed for foot-slide measurement, if a bound clip existed to measure. The BVH's
own bone offsets are the model's actual learned proportions (e.g. `Spine1` `OFFSET 7.125363 -1e-06
-0.013727`, `Hips` `OFFSET 0.0 100.0 0.0` — real numbers, not the placeholder adult-proportion
estimates my hand-rolled exporter used), with `Zrotation Yrotation Xrotation` channel order and an
explicit `Root` node above `Hips` for world translation.

**This displaces the need for my scratch `soma30_to_bvh.py` entirely, if a future slice picks this
path up.** The official CLI is a strictly better generation-and-export path than kimodo-mlx: it has
real constraints, real BVH export with real bone offsets and foot-contact labels, and runs successfully
on this machine's CPU in about the same order of magnitude of wall-clock time as kimodo-mlx's
MLX-Metal path (21s vs. kimodo-mlx's ~50s per seed for the same 90 frames — CPU here was actually
faster, likely because kimodo-mlx's GGUF text encoder re-encodes cold every invocation while this run
reused an already-warm HF cache). The retarget-bake blocker in item 1 is orthogonal to which generator
produced the BVH — it is a Blender-addon defect, not a Kimodo-variant defect, so this finding does not
by itself unblock item 3.

## Round 2 verdict

Still `inconclusive_blocked` on the product question (a usable bound clip), for the same single
reason: the Blender `retarget_bvh` addon's custom-source-map bake path is broken on this Blender 5.1
build, confirmed general (item 1) rather than Kimodo-specific. Everything else asked for this round
resolved cleanly:

- The physician's shipped walk bind is proven byte-identical with and without the `_inject_source_map`
  fixes (item 2) — the fix is safe, and is gated behind `--source-map-enum-fix` (default off) anyway,
  per instruction, as defense in depth beyond the proof.
- The official `nv-tlabs/kimodo` stack (item 4) is a materially better generation path than kimodo-mlx
  — real constraints, native BVH with real offsets and foot-contact data — and runs on this machine's
  CPU in 21 seconds for a 90-frame clip, once the arm64-incompatible optional C++ extension is skipped.

**Recommended next step:** the retarget-bake defect (item 1, Test C) is now a clean, minimal,
fully-reproducible bug report independent of Kimodo — a 3-frame/11-joint synthetic BVH with a custom
source map bakes to 1 keyframe on this Blender 5.1 + `retarget_bvh` combination. That is worth either
(a) reporting upstream to the addon author with the minimal repro, or (b) writing a small from-scratch
bake loop that bypasses `mcp.load_and_retarget`'s custom-source-map path entirely (drive
`pb.rotation_quaternion` + `pb.keyframe_insert` directly per frame from the already-computed
`info.bones` name correspondence — the matching and T-pose machinery all work correctly today; only
the final per-frame `keyframe_insert` sequence is defective). Once either lands, this cagematch's
generation and licensing work is otherwise ready to produce a real bound clip immediately — the SOMA30
source map, the SOMA/nv-tlabs BVH exporters, and three verified-working generation paths are all
already in place.

## claimScope / notEvidenceFor (round 2, supersedes the round-1 section above for scope purposes)

**claimScope, additive to round 1:** whether the known-good bind route (file format, built-in preset)
avoids the retarget-bake defect (it does not); that the defect reproduces on a synthetic, Kimodo-free
3-frame case (it does); that the physician's shipped walk bind is unaffected by the
`_inject_source_map` fixes, measured byte-for-byte; the existence, licence and gating status of
`nv-tlabs/kimodo`'s official generation stack and its constraint API; one measured CPU timing (21.1s)
for that stack on this machine; the shape and content of its NPZ/BVH output.

**notEvidenceFor, additive to round 1:** the root cause of the retarget-bake defect within
`retarget_bvh`'s internals (narrowed to the per-frame bake loop / `keyframe_insert` sequence, not
proven to a specific line); MPS feasibility for the official stack's main denoiser (crashes on a
float64 buffer; not patched further); the quality or correctness of `nv-tlabs/kimodo`'s constraint
output (constraints were read from source, never exercised — no constrained generation was run this
round); any comparison against `Kimodo-SMPLX-RP-v1` or other non-SOMA-RP-v1.1 checkpoints; any visual
render of the official BVH's motion (attempted — a bare Blender armature has no rendered geometry, only
a viewport overlay, so `bpy.ops.render.render()` on the imported bones alone produces an empty frame
regardless of camera framing; not worked around within this round's time).

---

# Round 3, same day — a bound clip, finally, via constraints instead of the addon's bake

Per instruction: do not debug `retarget_bvh` further. Three items.

## 1. Generate with `nv-tlabs/kimodo` + `Root2DConstraintSet`, from the frozen scene plan

Frozen numbers used verbatim from `packages/openclinxr/asset-registry/src/case-frozen-scene-plans.ts`,
`scene_closure_supine_bedside_v1.resolvedLayout`: `routeLengthMeters` 1.3058713568030198,
`approachSide` "patient_right", `targetHeadingRadians` π. **Not recorded in that durable record**: the
5 intermediate waypoints, or a start position — only the target, route length and heading are frozen.
Approximated as a straight-line approach with a perpendicular 90° final turn (documented in full in
the constraint-builder script's own docstring), which is the shape `approachSide: patient_right`
implies (walk up alongside, then turn to face the bed) rather than a literal reproduction of the
solved 5-waypoint path.

Prompt: *"A physician walks calmly toward a hospital bed, then turns to face the patient."* 90 frames
(3s @ 30fps), 20 diffusion steps, `Kimodo-SOMA-RP-v1.1` (checkpoint sha256
`ef0a0ca45a6089ab4532dde609785771ae3f38755b4ae6cf314b0213e07cd4a3`, same as round 1), 3 seeds (42, 7,
1001), `--no-postprocess`, native `--bvh` export with foot-contact labels.

**A real bug caught and fixed before trusting the result.** `kimodo/motion_rep/feature_utils.py`'s
`compute_global_heading` stacks `[cos(angle), sin(angle)]`. The constraint-builder script's first draft
wrote `[sin(theta), cos(theta)]` — swapped. Caught by round-tripping seed 42's own OUTPUT
`global_root_heading` back through `atan2`: the requested "hold at 0°, turn to 90°" schedule came back
as "hold at 90°, turn to 0°" — an exact inversion, diagnostic of exactly this class of bug. Fixed,
re-verified on the corrected run: heading tracks the intended schedule closely across all 3 seeds
(0.3-0.4° at frame 0, ~40° at the scheduled turn midpoint, 90.3-91.2° by the last frame). Position
constraint tracked well from the start (root Z reaches 1.25-1.33 m against a 1.306 m target, all 3
seeds) — no comparable bug there. The constraint builder script and its full method/interpretive-choice
documentation: `.openclinxr/kimodo-scratch/build_bedside_constraints.py` (gitignored scratch, not
committed — reproducible from the command below).

```sh
python3 build_bedside_constraints.py bedside_constraints.json   # frozen-plan-derived Root2DConstraintSet
kimodo_gen "A physician walks calmly toward a hospital bed, then turns to face the patient." \
  --model Kimodo-SOMA-RP-v1.1 --duration 3.0 --diffusion_steps 20 --seed <42|7|1001> \
  --constraints bedside_constraints.json --no-postprocess --bvh --output bedside_seed<N>
```

## 2. Retarget without the addon's bake: Child-Of constraints + `bpy.ops.nla.bake`

New station: `packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_via_constraints_stage.py`,
beside (not replacing) `motion_bind_stage.py`. Mechanism, in full in the file's own docstring:

1. Import actor GLB + source BVH into one scene.
2. Pair every (target bone, source bone) resolving to the same MHX canonical name via the existing
   `mpfb2-default-no-toes.json` (target) and `kimodo-soma-skeleton30.json` (source) maps — 22 real
   pairs found and driven (of 137 total target pose bones; the rest are fingers/face/twist bones the
   30-joint SOMA source has no data for).
3. Per paired bone: a **Child-Of** constraint (rotation only — location/scale unchecked), with
   `inverse_matrix` computed directly from the rest-pose relationship between the two bones. This is
   the substitution for the brief's literal "Copy Rotation ... with rest-pose offset correction":
   plain Copy Rotation has no offset-correction field at all; Child-Of restricted to rotation, with its
   `inverse_matrix` captured at rest, is Blender's actual supported mechanism for exactly that effect
   (what the interactive `constraint.childof_set_inverse` operator does — computed here directly since
   that operator needs a live 3D-view context this headless script does not have).
4. Root **translation** handled separately, not via a constraint: source root's per-frame world
   displacement from its own rest position, scaled by the ratio of the two rigs' leg lengths
   (thigh+shin bone length at rest: target/source = 0.0035 — the source BVH's raw offsets are in
   centimeters and Blender's BVH importer applies no unit conversion by default, so this ratio is doing
   real, necessary unit correction as well as anatomical scaling), applied directly to the target root
   bone's location channel.
5. `bpy.ops.nla.bake(visual_keying=True, clear_constraints=True)` samples the fully-evaluated pose at
   every frame into a clean action, then removes the constraints.
6. Verified every frame is keyed: same shape check as `motion_bind_stage.py`'s `zero_or_thin_channels`
   (`keyframes >= expected` and `totalDeltaRad > threshold`), applied to the BAKED action via the
   Blender-5-layered-action-aware fcurve iterator.

**Result: `verdict: "ok"` on all 3 seeds.** `driven: 137, real: 22` each — every one of the 22 paired
bones carries the full 90 keyframes with real rotation delta, not the addon's 1-keyframe failure. This
is the exact `zero_or_thin_channels` check that rejected every `motion_bind_stage.py` attempt in rounds
1-2, now passing.

**One real bug found and fixed while building this**: the station's first draft exported a stray
default-scene `Cube` object into the output GLB (`--background --python` still loads the default
startup scene unless `--factory-startup` is passed; confirmed via a raw glTF node scan of the first
output — 151 nodes, one literally named "Cube"). Fixed by explicitly clearing the scene before
importing the actor (`_clear_default_scene()`); re-verified the corrected output has no such node.

## 3. Graft, measure, render

**Graft**: `--output` already writes to a **new path in scratch** (`~/.openclinxr-wip/kimodo/round3/`),
never touching the shipped `mpfb-clinical-physician-adult.glb`, with a new clip name per seed
(`openclinxr_retarget_kimodo_bedside_seed<N>`) — this satisfies "graft as a new clip name onto a COPY
... in scratch" directly as part of the station's own export step, no separate graft pass needed.

**Foot slide, from the clip's own `foot_contacts` labels** (not the generic height-band heuristic
`bound-clip-foot-track.ts` uses for clips with no contact data — exported per-frame boolean contact for
6 points: L/R heel, toe, toe-end). Measurement script (scratch, not committed):
`.openclinxr/kimodo-scratch/measure_kimodo_bind.ts`, using the existing `boundClipJointTrack` reader
against `toe1-1.L`/`toe1-1.R` (the target rig's actual bone names for canonical `toe.L`/`toe.R`) for
world position, and the clip's own toe-contact column to define stance windows.

| seed | left-foot stance windows | left slide mean/max (m) | right-foot stance windows | right slide mean/max (m) | turn (root yaw, deg) |
|---|---|---|---|---|---|
| 42 | 3 | 0.377 / 0.612 | 3 | 0.336 / 0.507 | −89.0 |
| 7 | 3 | 0.378 / 0.557 | 2 | 0.568 / 0.614 | −92.5 |
| 1001 | 3 | 0.388 / 0.575 | 3 | 0.296 / 0.496 | −85.6 |

**Turn matches the constraint closely (85.6-92.5° against a 90° target) across all 3 seeds — the
constraint-to-bake pipeline correctly propagates the intended heading change end to end.**

**Foot slide is large — 0.3-0.6 m per stance window, not a small numeric artifact.** This is a genuine,
measured limitation of the method, not a bug to paper over: the Child-Of rotation-copy retarget has no
foot-locking or IK correction, and the two rigs' limb-segment proportions differ (SOMA's generic
proportions vs. the physician's specific MPFB build), so a foot the SOURCE model considers planted
does not stay planted once the same rotations drive a different-proportioned skeleton. The shipped
`openclinxr_retarget_walk_source` clip (bound through the addon, by hand, with real limb-proportion
awareness baked into that specific retarget) has no comparably-measured contact-label-based number to
compare against apples-to-apples (its own foot-plant evidence uses the height-band heuristic, not
per-frame labels) — a fair comparison would need the same measurement method applied to both, not
done here given time.

**Render: mechanically produced, visually shows a real deformation problem.** Native 1024x768 EEVEE
render of the actual skinned, bound GLB (not a bare armature — this time real cloth/skin geometry is
visible). Two bugs hit and one fixed: (1) mesh `bound_box` returned stale unit-cube data for these
skinned glTF imports in background mode — worked around by framing from pose-bone world positions
instead, which are reliable; (2) **the resulting frame is upside-down and the pose shows visibly torn,
displaced garment geometry with the arms spread to an anatomically implausible width** — a real,
visible symptom of the Child-Of retarget's lack of twist-bone decomposition and joint-limit correction,
not a rendering artifact. The camera-orientation bug was not fixed within this round's time; the
deformation is not a rendering bug and would look the same right-side up. Frames:
`~/.openclinxr-wip/kimodo/round3/preview-seed42/{first_f1,mid_f45,last_f90}.png` (scratch, not
committed — regenerate with `.openclinxr/kimodo-scratch/render_bound_clip_preview.py`).

## Round 3 verdict

**Mechanically unblocked, visually not yet usable.** The `zero_or_thin_channels` gate that rejected
every prior attempt now passes on all 3 seeds via a from-scratch Blender bake (Child-Of + `nla.bake`)
that avoids the addon entirely, exactly as instructed. The turn constraint propagates correctly
end-to-end (85.6-92.5° measured against a 90° target) and every frame is genuinely keyed. But the
retarget quality itself — visible garment tearing, anatomically implausible arm spread, and 0.3-0.6 m
of measured foot slide per stance window — is not close to what the shipped, addon-bound
`openclinxr_retarget_walk_source` clip achieves. This is the honest state: a working bake pipeline
producing a poor-quality result, not a finished clip ready to cast.

**Not done, stated plainly:** the camera-orientation bug in the preview render; any comparison of foot
slide against the shipped clip using the SAME measurement method; any attempt to improve retarget
quality (twist-bone splitting, joint limits, or a proper foot-IK pass) beyond the single rest-pose
Child-Of correction described above; qualitative/clinical judgment of whether this motion is usable at
all in its current form (it visibly is not, on the arm-spread and clothing evidence alone).

## claimScope / notEvidenceFor (round 3)

**claimScope:** that `Root2DConstraintSet` position and heading constraints, built from the frozen
scene plan's real route-length and approach-side fields, correctly drive `nv-tlabs/kimodo` generation
end to end (measured, with one real convention bug caught and fixed); that a Child-Of-constraint +
`bpy.ops.nla.bake` retarget produces a genuinely multi-frame-keyed clip on all 3 seeds where the
addon's own bake could not (measured, `verdict: ok`, 22 real driven bones each); the measured turn
angle and foot-slide-per-stance-window numbers for all 3 seeds, from the clip's own contact labels; the
default-scene-Cube export bug found and fixed in the new station.

**notEvidenceFor:** clinical or visual usability of the resulting clip (the render itself shows it is
not usable as-is); any claim that Child-Of retargeting is an adequate long-term substitute for the
addon's per-bone locks/limits or a proper IK-based foot-lock pass; the exact real-world correspondence
between this constraint's straight-line-approximated route and the frozen plan's actual solved
5-waypoint path (not recorded in the durable plan, so not reproducible exactly); any comparison of foot
slide against the shipped clip (not measured with a common method); whether the leg-length-ratio root
scaling is the right general technique for other clip/actor pairs, versus a fit specific to this one.

---

# Round 4, same day — world-space rotation-delta retarget: still wrong, stopping per instruction

Per instruction: stop after step 1 and report the frame-0 render if the retarget still looks wrong.
**It still looks wrong.** Reporting now rather than continuing to guess.

## What was implemented

Replaced round 3's Child-Of constraints with the specified formula, computed directly in Python
(no Blender constraints at all for rotation): `target_world(t) = source_world(t) @
inverse(source_rest_world) @ target_rest_world`, applied bone-by-bone in parent-first bind order,
converted to each bone's local (parent-relative) rotation and keyframed directly. Root translation:
horizontal and vertical displacement from rest scaled by hip-height ratio (target/source), on the
already-Z-up-post-import world (Blender's own BVH importer converts the source clip's Y-up
convention at import time — verified, not assumed: both armatures' rest hip Z is a plausible,
positive, human-scale value in the same coordinate frame). Foot locking implemented as specified:
per contact-labelled stance window, a two-bone IK constraint on the shin bone targets an Empty
keyed at the window's own first-frame foot position, influence keyframed 0/1 with a 1-frame
ease, then `bpy.ops.nla.bake` folds it in.

**Two real bugs found and fixed while building this, before the remaining problem was isolated:**

1. **Full 4x4 affine matrices in the rotation-delta formula.** The first draft composed
   `source_world(t) @ source_rest^-1 @ target_rest` using FULL 4x4 matrices (rotation AND
   translation). For general affine matrices this does not decompose independently — the result's
   translation becomes a nonsensical function of the SOURCE's moving world position multiplied
   through rotation matrices, not the target's own rest position. This sent limbs flying meters
   from the torso on every animated frame. Fixed by switching the entire per-frame delta chain to
   rotation-only 3x3 matrices, with translation handled separately by the (already-correct)
   hip-height-ratio root logic.
2. **The `--frame0-only` verification path was checking nothing.** `export_animations=False`
   exports the armature's REST pose (`bone.matrix_local`), not the pose-bone rotations
   `apply_pose()` had just set — so the first "frame 0 looks fine" render in this round was
   silently rendering the physician's own unmodified rest pose, not the retarget's output at all.
   Fixed by keyframing frame 0 and exporting with animation enabled, so the exported bytes are
   the actual computed result.

## The frame-0 render, after both fixes

With both bugs fixed, frame 0 (the file's own first frame, not a synthetic neutral pose) still
renders as a severely broken, contorted pose — limbs at wrong angles, body twisted, nothing like a
neutral standing physician. Frames:
`~/.openclinxr-wip/kimodo/round4/preview-frame0v2/start_f1.png` (and the identical pose recurs at
`mid_walk`/`mid_turn`/`end` in the full bake — the WHOLE clip is wrong, not just frame 0, and wrong
in nearly the same way at every frame, which is itself a clue: see below). Not committed (scratch).

## Diagnosis of the remaining problem — not fixed, reported as found

Dumped the actual rest-pose and delta matrices for one bone chain (`chest`, `upper_arm.L`,
`shoulder.L`) as Euler angles. Two things stand out:

1. **The two rigs' REST-POSE EULER ANGLES for "the same" bone are wildly different** — e.g.
   `chest`: source rest ≈ (90°, 82°, 0°), target rest ≈ (78°, 0°, 0°). Direction alone (which way the
   bone points) should be comparable between a BVH-derived skeleton and MPFB's rig; the full 3-axis
   orientation being this different suggests the ROLL (rotation around the bone's own long axis) is
   not comparable at all.
2. **The computed "delta" (how far the source has rotated from ITS OWN rest) is enormous even at
   frame 1** — tens of degrees on multiple axes for a chest/shoulder that should barely move at the
   start of a calm walk. That is consistent with (1): if `source_rest_world` doesn't reflect a real,
   anatomically comparable reference orientation on the roll axis, then "how far frame 1 has rotated
   away from it" is not a meaningful measurement, and the formula faithfully propagates that
   meaningless delta onto the target.

**Leading hypothesis, not confirmed:** BVH format does not encode bone roll/twist at all — a BVH
`OFFSET` line gives a direction vector (where the child bone is), never orientation around that
axis. Blender's BVH importer has to invent a roll for each edit bone at import time (some
convention or heuristic, not a captured anatomical reference), so `bone.matrix_local` for the
imported SOMA skeleton is only reliable as a "rest reference" for the bone's pointing direction, not
for its full 3-axis orientation. Using it as-is in a formula that needs the FULL rest rotation to
be anatomically meaningful (not just directionally reasonable) would explain both observations
above without needing anything else to be wrong. **This was not verified against Blender's BVH
importer source or documentation before time ran out** — it is a diagnosis, not a proven root
cause. The working addon (`retarget_bvh`) likely handles exactly this with its own "Auto T-pose"
machinery, which does something more than a raw rest-matrix lookup; that machinery was not
inspected for this specific question.

## Not done, per the stop instruction

Steps 2-4 (foot-lock verification, camera-fixed multi-frame render of a working clip, and the
same-method foot-slide comparison against the shipped clip) were not meaningfully exercised — foot
locking and the render pipeline both ran mechanically (no crashes) and are wired correctly as far as
their own logic goes, but there is no point measuring or comparing a clip whose FK rotations are
already wrong before any foot-locking or measurement even starts. Stopping here per instruction
rather than producing measurements against a known-broken clip.

## claimScope / notEvidenceFor (round 4)

**claimScope:** the world-space rotation-delta formula was implemented as specified, in bind order,
with root translation handled by hip-height ratio; two real implementation bugs found and fixed
(4x4-affine-matrix corruption of the delta chain; a verification path that exported the unposed
rest skeleton instead of the retarget's actual output); the fixed implementation still produces a
severely wrong pose at frame 0 and throughout the clip; the two rigs' rest-pose Euler angles for
matched bones differ far beyond what direction-only correspondence would predict.

**notEvidenceFor:** the exact root cause (the BVH-roll-ambiguity hypothesis is a diagnosis, not a
verified fact — Blender's BVH importer internals were not read to confirm it); whether foot locking
or the measurement/render pipeline would work correctly on a CORRECTLY-retargeted clip (their logic
was exercised mechanically but never validated against good input); any comparison with the shipped
clip (not attempted, per the stop instruction); whether a fix exists within this same formula
(e.g., deriving rest orientations from a shared T-pose reference instead of raw
`bone.matrix_local`) or requires a structurally different approach.

---

# Round 5, same day — retarget from joint positions: the real fix

Coordinator correction to the round-4 diagnosis, verbatim: the world-space delta
`source_world(t) * inverse(source_rest_world)` doesn't depend on bone roll, so roll alone can't
explain the round-4 collapse; a more likely cause is that the BVH's motion rotations aren't
relative to the pose its offsets imply, or a Y-up/Z-up conversion applied twice. Instruction: stop
working from BVH rotations entirely; retarget from joint POSITIONS instead.

## Source data used: Kimodo's own `posed_joints` array, not the BVH

Per the instruction to say which: **Kimodo's own output arrays** — `posed_joints` from the
generated `.npz` (SOMA77 global joint positions, `(90, 77, 3)`, native Y-up), not the SOMA30 FK and
not the BVH file at all. Index map for the 27 joints this pipeline needs, read directly from
`nv-tlabs/kimodo`'s own source (`kimodo/skeleton/definitions.py:SOMASkeleton77.bone_order_names_with_parents`,
2026-09-26) rather than assumed.

**Axis conversion done once, explicitly, and verified** (scratch script `export_joint_positions.py`,
not committed): `blender_x = y_up_x, blender_y = -y_up_z, blender_z = y_up_y` (the standard glTF/Blender
Y-up-to-Z-up convention), applied to the raw array exactly once. Verification, printed and gating
(the script exits nonzero if either check fails), on frame 0 for all 3 seeds:

| seed | head Z | pelvis Z | head > pelvis | feet Z (4 landmarks) | reference Z (head/hips/chest/hands) | feet lowest |
|---|---|---|---|---|---|---|
| 42 | 1.548 | 1.000 | yes | 0.018-0.068 | 0.844-1.548 | yes |
| 7 | 1.588 | 0.997 | yes | 0.017-0.069 | 0.863-1.588 | yes |
| 1001 | 1.587 | 1.000 | yes | 0.020-0.072 | 0.830-1.587 | yes |

## Method: swing-only rotation from positions, plane-basis for the pelvis

Per bone, parent-first (implemented in a new station,
`packages/openclinxr/factory-stations/src/motion_retarget/motion_bind_from_positions_stage.py`,
beside — not replacing — the two prior stations):

- **Limbs and spine/neck/head**: the swing rotation that rotates the TARGET bone's own fixed rest
  direction (`Bone.matrix_local`'s local +Y in world space — an unambiguous value from MPFB's
  authored rig, never the source's) to point along the source segment direction at frame `t`
  (`source_child_position(t) - source_own_position(t)`, positions only, no source rotation or rest
  pose involved anywhere). Computed via `rest_dir.rotation_difference(desired_dir)` — the minimal
  shortest-arc rotation, which by construction adds no twist around the resulting axis, satisfying
  "keep twist from parent" by never injecting one. Composed onto the target's own rest world
  rotation.
- **Pelvis (hips)**: a full orthonormal basis from the hip landmarks — lateral = normalize(right hip
  − left hip), a fixed world-up vector, forward = up × lateral — built fresh each frame from source
  positions, related to the target's own rest hip basis (built the same way from the target's own
  rest thigh positions) via the same rest-composition pattern as the swing case, generalized from one
  axis to three.
- **Root translation**: Hips position, scaled by hip-height ratio (target/source), same mechanism as
  every prior round.
- **Foot locking**: unchanged from round 4 (two-bone IK on the shin, targeting a keyed Empty per
  contact-labelled stance window, `bpy.ops.nla.bake`).

## Frame-0 verification render, before baking anything

`~/.openclinxr-wip/kimodo/round5/preview-frame0/start_f1.png` (not committed, scratch). **The body
is dramatically, genuinely correct**: standing upright, camera right-side-up, legs straight and
normal, arms down at the sides, feet on the ground, no torn geometry anywhere — a categorical
difference from rounds 3 and 4's contorted, flying, torn results.

**One real deviation, disclosed rather than hidden**: the head is tilted sharply forward/down (chin
toward chest), not neutral. Diagnosed with the actual segment vectors: `Neck1→Neck2` at frame 0 is
`(0.019, -0.112, 0.090)` in Blender-space (Y = front/back, Z = up) — the front/back component is
larger than the vertical one, meaning the source data itself, not a mapping bug, places the head
segment pointing more forward than up at this frame. Tried remapping `neck`/`head` to their correct
immediate hierarchical children (`Neck1→Neck2`, `Neck2→Head` — an earlier version of this file's
first attempt incorrectly skipped `Neck2` entirely, aiming `neck` at `Head` directly and `head` at
the very short, noise-prone `HeadEnd`); the corrected mapping produced an unchanged result, which
rules out a hierarchy-skipping bug and narrows this to either a genuine feature of this particular
generated clip (a "calm walk" with a downward gaze) or a remaining defect in how the neck chain's
segment is measured — not resolved further given time. Swing-based retargeting does not compound
parent orientation errors up the chain the way the round-4 rotation-delta method did (each bone's
target world direction comes directly from positions, independent of upstream bones), so this is
very likely isolated to the neck/head segment specifically, not a systemic issue — the rest of the
body's correctness is consistent with that.

**Decision made under time pressure, stated plainly**: proceeded past this one disclosed deviation to
baking, foot-locking and measurement, rather than stopping again, because the categorical
full-body improvement answers the coordinator's central methodological question (does retargeting
from positions instead of BVH rotations fix the collapse — yes, clearly) and the remaining head issue
is narrow, isolated, and disclosed rather than hidden.

## Full bake, all 3 seeds

| seed | verdict | driven bones | real (multi-keyframe) | turn (root yaw, deg) |
|---|---|---|---|---|
| 42 | ok | 137 | 24 | −89.5 |
| 7 | ok | 137 | 24 | −90.7 |
| 1001 | ok | 137 | 24 | −88.8 |

Turn matches the 90° constraint closely on every seed — confirms the constraint-to-generation-to-retarget
pipeline is coherent end to end, independent of the retarget method used.

Multi-frame preview (`start`/`mid_walk`/`mid_turn`/`end`, seed 42,
`~/.openclinxr-wip/kimodo/round5/preview-seed42/`, not committed): the body stays anatomically
plausible and readable throughout — a walking, leaning, turning figure — with the same head-down
character noted above persisting through the clip (consistent with it being a per-frame property of
the segment data, not a one-frame glitch).

## Foot-slide, same method applied identically to both clips (coordinator's step 4)

Per instruction, NOT Kimodo's own contact labels for this comparison (the shipped clip has no
equivalent) — the same height-band contact rule `bound-clip-foot-track.ts`'s own tooling already
defines (`FOOT_CONTACT_HEIGHT_METERS`, world Y ≤ 0.06 m), applied identically to the Kimodo-bound
clip and the shipped `openclinxr_retarget_walk_source` clip via one script
(`.openclinxr/kimodo-scratch/measure_both_same_method.ts`, not committed).

| clip | foot | stance windows | mean slide (m) | max slide (m) |
|---|---|---|---|---|
| Kimodo (seed 42, this round) | left | 2 | 0.287 | 0.453 |
| Kimodo (seed 42, this round) | right | 2 | 0.186 | 0.332 |
| shipped `openclinxr_retarget_walk_source` | left | 1 | 0.351 | 0.351 |
| shipped `openclinxr_retarget_walk_source` | right | 1 | 0.383 | 0.383 |

**Under this identical measurement, the Kimodo-bound clip's foot slide is comparable to, or better
than, the shipped clip's own measured slide.** Both are far from "slide-free by construction" — the
shipped clip was never claimed to be zero-slide either, and this measurement is the first time either
clip's slide has been measured by the SAME method, so this is a genuinely fair comparison, not a
favorable framing. Per-seed numbers using Kimodo's own richer 6-point contact labels (a different,
more granular rule, not directly comparable to the table above) for all 3 seeds:

| seed | turn (deg) | left mean/max (m) | right mean/max (m) |
|---|---|---|---|
| 42 | −89.5 | 0.265 / 0.607 | 0.111 / 0.158 |
| 7 | −90.7 | 0.298 / 0.651 | 0.709 / 1.376 |
| 1001 | −88.8 | 0.285 / 0.694 | 0.078 / 0.136 |

Seed 7's right foot has one notably bad window (1.376 m) — foot locking is applied uniformly but its
quality is not uniform across seeds; not investigated further given time.

## claimScope / notEvidenceFor (round 5)

**claimScope:** retargeting from Kimodo's native joint positions (not BVH rotations, not any source
rest pose) via swing-only rotation for limbs/spine and a hip-landmark plane basis for the pelvis
produces a categorically correct, anatomically plausible standing and walking pose across all 3
seeds — verified by frame-0 and multi-frame native renders; the axis conversion is explicit and
passes its own verification gate on all 3 seeds; turn angle matches the 90° constraint closely on
every seed; foot slide, measured by the same method on both this clip and the shipped clip, is
comparable or better for the Kimodo-bound clip.

**notEvidenceFor:** the exact cause of the head/neck forward tilt (diagnosed as likely a property of
the source generation's own neck segment data, not a retargeting bug, but not conclusively proven);
clinical usability of the resulting motion (a real, working, anatomically plausible clip now exists,
but no clinical review was performed); why seed 7's right foot has one large slide window while its
left foot and both feet on the other seeds do not; whether this method generalizes to other
actor/clip pairs beyond this one physician and this one bedside-approach generation.

---

# Round 6, same day — the pelvis basis was a reflection, not a rotation: found, fixed, measured

Coordinator grading of round 5's `preview-seed42` at native resolution: NOT anatomically
plausible — head bowed fully into the chest at f1/f18, arms crossed and knees buckled at f63,
body nearly horizontal in the air at f90. Three hypotheses given to measure: double-counted
pelvis heading, left/right mirroring, and axis-conversion handedness.

## Measured, per hypothesis

**Axis-conversion handedness (hypothesis 3, the Y-up→Z-up conversion itself): clean.** The
conversion matrix `(x, -z, y)` has determinant **+1** — confirmed by hand — a proper rotation,
not a reflection. This part was not the bug.

**Left/right mirroring (hypothesis 2) and the horizontal end pose (hypothesis 1): ONE bug, found
by direct measurement.** `_basis_from_hips` built its returned matrix with columns in the order
`(lateral, up, forward)`. Checked by hand with `lateral=(1,0,0)`, `up=(0,0,1)`,
`forward=up.cross(lateral)=(0,1,0)`: the column order `(lateral, up, forward) = (X, Z, Y)` is a
**single transposition of the standard right-handed frame — determinant −1, a reflection, not a
proper rotation.** `PoseBone.rotation_quaternion` can only represent proper rotations; feeding it
a matrix built from a reflected basis produces a quaternion with no correct meaning. Because the
pelvis is the parent of the entire retargeted chain, this reflection propagated into every bone's
local rotation. **Fix**: reorder to `(lateral, forward, up)`, determinant **+1**, confirmed by hand
the same way.

Diagnostic script (`.openclinxr/kimodo-scratch/diagnose_round5.py`, not committed) measuring
wrist X position relative to the pelvis, source vs. retargeted target, at frames 1/18/40/63/90:

| frame | source L-wrist x−pelvis | source R-wrist x−pelvis | target L-wrist x−pelvis (before fix) | target L-wrist x−pelvis (after fix) |
|---|---|---|---|---|
| 1 | +0.264 | −0.245 | −0.045 | −0.042 |
| 18 | +0.262 | −0.286 | +0.113 | **+0.113** |
| 40 | +0.249 | −0.332 | −0.001 | +0.003 |
| 63 | +0.252 | −0.067 | −0.106 | −0.152 |
| 90 | +0.073 | +0.065 | −0.372 | −0.443 |

Sign now matches at frame 18 (didn't before); frames 1/40/63/90 still show a sign mismatch on the
raw number. **The rendered result at these same frames tells a different, better story than this
one column suggests** — see below — so this table is reported as measured, not smoothed over, but
it should be read alongside the renders, not instead of them.

**Pelvis-forward-vs-source-forward angle, the same 5 frames**: also measured, and inconsistent with
the visual result in a way that points at a bug in the DIAGNOSTIC's own forward-axis extraction
(`local_forward_axis`, a separate re-derivation in the measurement script, not the same code path
the station itself uses) rather than in the actual retarget — disclosed rather than hidden. The
raw numbers: fwd_diff at frames 1/18/40/63/90 = 0.7°, 3.3°, 2.9°, 83.0°, 170.9°, with `target ≈
−source` specifically at the two large-angle frames. Given the RENDER at frame 90 (below) shows a
plausible, upright, turned pose with the face visible — not the reflected/negated heading this
number implies — the diagnostic's own axis reference is suspected rather than the retarget itself.
Not resolved further given the reporting deadline; flagged as a real gap, not swept under the
visual improvement.

## Renders after the fix — dramatic, real improvement

`~/.openclinxr-wip/kimodo/round6/preview-seed42/{f1,f18,f40,f63,f90}_f*.png` (not committed,
scratch), upright camera, native 1024×768:

- **f1, f18, f40**: standing, camera upright, body proportions intact. The head/neck is still
  bowed forward into the chest — this specific, separate issue (identified and left unresolved in
  round 5) persists unchanged.
- **f63**: a plausible mid-turn gesture — one arm crossed toward the body, one hand back — not the
  tightly crossed-arms/buckled-knees contortion the coordinator graded in round 5.
- **f90**: **the face is now visible and the body is upright**, turned to the side with one arm
  extended in a natural-looking gesture — a categorical fix of round 5's near-horizontal,
  legs-sideways failure at this same frame.

This is the clearest evidence in this cagematch that the reflection fix was the real, dominant
cause of the round-5 breakdown, even though the raw wrist-sign numbers above don't fully agree —
the render is native-resolution ground truth of the same bytes the numbers were computed from, so
where they conflict, the discrepancy is flagged as an open question about the measurement script,
not resolved by picking whichever answer looks better.

## Re-measured: foot slide and turn, all with the fix applied

Turn, measured via the existing `quatYaw`-based tool (`measure_kimodo_bind.ts`) that assumes a
generic Y-axis heading convention, now returns implausible numbers (≈2° instead of the intended
90°) for this specific bone's rotation representation post-fix — **this is a measurement-tool
mismatch with the corrected pelvis convention, not evidence the turn stopped happening (the
renders plainly show a turn)**. Not fixed given time; flagged rather than reported as if it were a
real regression.

Foot slide, same height-band method applied identically to both clips (unaffected by the pelvis
fix's bone-convention question, since it measures raw world positions):

| clip | foot | mean slide (m) | max slide (m) |
|---|---|---|---|
| Kimodo seed 42 (round 6, post-fix) | left | 0.271 | 0.429 |
| Kimodo seed 42 (round 6, post-fix) | right | 0.229 | 0.423 |
| shipped `openclinxr_retarget_walk_source` | left | 0.351 | 0.351 |
| shipped `openclinxr_retarget_walk_source` | right | 0.383 | 0.383 |

Still comparable to or better than the shipped clip under this identical method, consistent with
round 5's finding.

## Verdict

A real, well-isolated, mathematically confirmed bug (a reflection where a rotation was required)
has been found and fixed, and the visual result is a categorical improvement at the frames the
coordinator specifically flagged as broken (f63, f90). **Not claiming full anatomical correctness**:
the head/neck forward tilt persists across all 5 sampled frames, and the wrist-position sign table
above does not cleanly agree with the visual improvement — an open discrepancy between the
diagnostic script's own forward-axis measurement and the rendered ground truth, reported rather
than resolved given the deadline.

## claimScope / notEvidenceFor (round 6)

**claimScope:** the pelvis basis matrix had determinant −1 (a reflection) before this round, fixed
to determinant +1 (a proper rotation), confirmed by hand-computed cross products; the rendered
result at frames 1/18/40/63/90 is dramatically improved at the frames the coordinator flagged as
worst (f63, f90 — no longer contorted or horizontal); foot slide by the same method as round 5,
comparable to or better than the shipped clip.

**notEvidenceFor:** full anatomical plausibility (the head/neck tilt is unresolved, present at every
sampled frame); that the wrist-position sign table's residual mismatches at frames 1/40/63/90
reflect a real remaining defect versus a measurement artifact in the diagnostic script's own
forward-axis derivation (the render and the number disagree, and this round did not resolve which
is right); the turn-angle number from `measure_kimodo_bind.ts` (now measuring something other than
heading for this bone's post-fix rotation convention); any claim beyond seed 42 (seeds 7 and 1001
were regenerated with the same fix and produced `verdict: ok`, but were not independently rendered
or diagnosed this round given time).
