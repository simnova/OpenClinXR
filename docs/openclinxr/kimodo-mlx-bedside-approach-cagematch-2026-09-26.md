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
