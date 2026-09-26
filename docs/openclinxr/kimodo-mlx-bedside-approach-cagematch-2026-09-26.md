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

## Recommended next step

Isolate the 1-keyframe bake defect directly (not through more throwaway debug patches against the
vendored addon — through a minimal reproduction: retarget a hand-authored 3-frame BVH with obviously
different poses per frame onto the same physician rig, with the same source-map mechanism, and check
whether the defect reproduces on a trivial case). If it does, this is a Blender-5.1-compatibility bug
in `retarget_bvh` worth reporting upstream or working around generically (it would affect **any**
custom `--source-map` user going forward, not just Kimodo). If it does not reproduce on a trivial
case, the defect is specific to something about the SOMA30-sourced BVH (most likely candidate:
generic/approximate bone offsets in the exported BVH interacting badly with the addon's `Auto T-pose`
rescale step) and the next probe is real bone-length data rather than the placeholder proportions used
here.
