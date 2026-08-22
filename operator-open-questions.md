# Operator Open Questions

This file tracks non-blocking operator questions that need a better answer after more evidence. Blockers that require operator action stay in `operator-steering-needed-questions.md`.

## 2026-08-10 MPFB2 is GPL-3 and D11 makes it first-class — licence posture unresolved (non-blocking)

**Recommended default if silent: keep using MPFB2 at authoring time only, and treat its output
assets as ours, while NOT shipping or linking any MPFB2 code.** That is what the pipeline does
today and nothing has to change for it to continue.

**The tension, stated plainly.** Project constraints say no AGPL/copyleft dependencies. The
Strategy section has recorded MPFB2 as GPL-3 and "deferred by operator decision" since #131.
Operator directive D11 (2026-08-08) then made MPFB **first-class alongside Anny, split by job**,
and two slices have since landed on it: #263 cast an MPFB2 humanoid into a station, #222 gave it
the Anny rail's scalp-hair region. So the rail is in use while the licence note still says
deferred.

**Why I think the default is defensible but will not decide it.** MPFB2 runs as a Blender addon
during asset generation; no MPFB2 code is imported by `apps/**` or `packages/**` and none is
shipped to a learner. The generated GLBs derive from MakeHuman-lineage basemesh and CC-BY
wardrobe assets, whose own licences are tracked separately in the provenance chain
(`licenseToken`, `licenseSource`). Whether GPL-3 reaches through a Blender addon to the geometry
it emits is a legal judgement, not a technical one, and it is not mine to make.

**What would change if the answer is "no":** the hm08 body rail, the MakeClothes wardrobe path,
#272, #275 and #276 all rest on it. That is most of the current clothing and body-generation
direction, so an answer either way is worth having before more slices land on the rail.

**Nothing is blocked today.** Recording it so the decision is explicit rather than accumulated.

## 2026-08-03 BVH→Anny locomotion retarget hardening (non-blocking)

Context: `tools/openclinxr/asset-pipeline/anny/apply_bvh_to_anny_full.py` hardened with fail-loud diagnostics + gates (`asset:bvh-retarget:smoke` / `:lab-smoke`). Three open product questions:

| # | Question | Recommended default |
|---|----------|---------------------|
| 1 | **Seated exam body vs walking motion.** The base mesh is `seated-adult-bod`; locomotion (walk/run) is retarget-validation, not an obvious clinical need. Where (if anywhere) does a *walking* patient belong in the Step 2 CS station flow? | Do **not** auto-wire a walking patient into a seated station. Ship the capability + clean asset; product owner decides placement. Locomotion stays lab/validation until a station needs it. |
| 2 | **License for the shippable clip.** MB-Lab walk/run is the highest-quality result but **AGPL** (local-validation only). CMU (`cmu_07_01_walk`) is license-clean (free-all-uses) and now passes all safety gates (explode ~1.0, torso pitch ~10°, 0 unweighted). | For any product-facing locomotion, use **CMU** (license-clean). Keep MB-Lab as the local quality reference only. |
| 3 | **CMU arm over-swing (cosmetic).** CMU torso is at parity with MB-Lab (measured back-pitch 13.7° max vs 10.2°), but CMU upper-arm delta reaches ~96° (arms swing up higher than natural). Not gated (cosmetic); MB-Lab arms are more natural. | Acceptable for validation now. Before product ship, tune CMU arm mapping (upperarm delta clamp / rest-axis) to MB-Lab-like swing. Tracked follow-on. |

- Guards: `pnpm asset:bvh-retarget:smoke` (bake + diagnostics + `--assert-deterministic` + `--product` license gate) and `pnpm asset:bvh-retarget:lab-smoke` (three.js explode/motion/torso-pitch). Both green 2026-08-03.

## 2026-08-02 arena-physics realbind epic (ACTIVE — BOD pivot)

**Supersedes** prior “post-epic defer WASM/UI-XR” defaults. BOD 2026-08-02 incorporated Desktop `Xxxyyy-arena.md.md` → epic `arena-physics-clinical-touch-realbind-v1` + brief `docs/openclinxr/arena-physics-clinical-touch-realbind-2026-08-02.md`. Residual product lane was empty; explicit queue pivot (not silent preemption).

| Id | Decision | Frozen (epic OD) |
|----|----------|------------------|
| OD-1 | Required real engine | **Rapier** (`@dimforge/rapier3d` deterministic) |
| OD-2 | `bodyMechanics` home | Extend canonical phenotype type at real def site, additive+optional |
| OD-3 | Cross-platform C5 | **`determinismScope: "local"`** accepted |
| OD-4 | Immersive/headset physics | R7 operator-gated; desktop/`foreground_ready` suffices for DoD |
| OD-5 | Per-slice thrash | **90 min** agentic → escalate, never abandon objective |

Still non-blocking (unchanged from v1):

| # | Question | Recommended default |
|---|----------|---------------------|
| 3 | IWSDK MCP config location? | Arena-scoped optional; InputLog remains replay SSOT (MADR 0029). |
| 4 | Fixed step 60 Hz vs 72 Hz? | **60 Hz** |
| 5 | Capture tool `capture=` for physics visuals? | Extend enum only if R3/R4 needs it; keep existing modes byte-identical. |
| 8 | Website / skeptic marketing of physics? | **No** until dual visible evidence + skeptic sign-off on realbind close. |

- Current answer (2026-08-02 autonomous close path): R1–R5 delivered (real Rapier + factory + UI-XR bind + measured metrics + arena cagematch). R6 successor MADR records PROVEN under local determinism; **all production/Quest/clinical/scoring gates remain false** until a human flips the named gate.
- **R7 (OD-4) pre-declared deferral:** immersive/headset physics re-run is **not required for epic DoD**. Desktop/`foreground_ready` evidence suffices. Re-open R7 only with operator headset + explicit queue pivot. Recorded 2026-08-02 fully-autonomous close.
- Recommended default: after R6+R7 deferral, epic complete; product Next may return to non-physics backlog without garment thrash.

## 2026-06-07 garment-hint-v1 aborted per anti-toil gate

Garment-source-geometry-hint-v1 path is **aborted** after skeptic review (subagent 019ea136). Third consecutive zero-visible-delta model-adjacent slice triggered the anti-toil gate. Verdict: 48-face rigid cylindrical tube, sub-pixel at 3.4m viewer distance, no vertex weights (rigid parent), Q1 violation (no sleeve geometry despite `short_sleeve_exam_tshirt` phenotype). **Recommended next: embed-real-garment-region-from-phenotype** — expand `apply_role_clothing_material_regions` to read `phenotype.garmentLayers` and produce weighted torso+shoulder+upper-arm sleeve geometry. The hint-only comparator paths in `main.ts` and tests should be cleaned up as part of this pivot.

- Current answer: Abort hint path. Pivot to real garment region from case phenotype.
- Recommended default: Worker 10/11 `embed-real-garment-region-from-phenotype` via asset-pipeline-lead (general-purpose), then xr-systems-architect cleans up UI-XR bind, then skeptic reviews visible delta.

## 2026-06-06 StableGen/ComfyUI skin cagematch boundary (unchanged)

## 2026-06-04 Local exam Mongo-memory boot profile boundary (unchanged)

## Quest foreground performance capture blocked (unchanged)

## 2026-06-05 Anny local package/source manifest (unchanged)

## 2026-08-21 — Mesh2Motion + Animato evaluation (operator brief; recorded, NOT approved scope)

Operator supplied a full evaluation package: Mesh2Motion as a **static CC0 clip library**, Animato
(`github.com/otdnnc/Animato`, MIT) as **on-demand clinical motion generation** — an LLM writes one
short `bpy` script per animation, headless Blender bakes it into an already-rigged actor. Framed as
complementary, not competing.

**RECORDED AS-IS. Three collisions with measurements already on disk — resolve before any slice.**

1. **The brief's "primary topology: Anny (~163-bone)" is STALE.** Measured 2026-08-21 via
   `resolveScenarioActorCast` over `listShippedCastScenarioIds`: **39 of 39 cast slots resolve to
   `mpfb-`**, zero Anny slots reach a learner; Anny retirement is #478. So every retarget target in
   the brief is **137 joints, not ~163**, and §4.1 step 2 must be re-read accordingly.

2. **Mesh2Motion is already adjudicated, and the trap is named.** #545 `reject_measured` it as a
   RIGGER (browser Vite app, no CLI bin; its `mesh2motion.json` map hits 0/53 on MPFB2 native names).
   The CLIP LIBRARY is the salvage and its licence is **CC0 VERIFIED** (local clone carries
   `LICENSE-MIT.MD` + `LICENSE-CC0.MD`; 87 + 75 human clips). Its skeleton is **66-joint
   Mixamo-adjacent** (`spine_01..03`, `thigh_l`), so the work is a **NEW 66→137 SOURCE map**, NOT keys
   added to `mpfb2-default-no-toes.json` — which never sees those names. That mistake is the
   superagent's explicitly predicted next error, recorded 2026-08-21 in PROJECT_STATUS.
   Lying-adjacent clips `Sleeping`, `LayToIdle`, `Rest Pose` are VERIFIED present; whether `Sleeping`
   is back-flat or side-sleep is **NOT GRADED**.

3. **Animato collides with D1 and D9 and the collision is unresolved.** D1: "wire proven tools, never
   hand-author... not a handful of LLMs toiling in non-deterministic ways building things in the
   factory." D9: "dark software factory with minimal LLM involvement... LLMs can only be used in the
   final product for narrow purposes (e.g. dynamic dialogue generation)." Animato's core mechanism is
   an LLM authoring bespoke `bpy` per animation.
   The defensible reading: it is BUILD-TIME, the runtime artifact is a baked deterministic GLB, and an
   exam still runs with no LLM in the path — which is what D9 actually protects. The hostile reading:
   non-deterministic per-animation authoring is precisely D1's anti-pattern, and the same clip is not
   reproducible from the same input.
   **A resolution that would satisfy both, if approved:** treat the generated `bpy` script as the
   deliverable rather than the animation — generate once, review, COMMIT THE SCRIPT, and re-run it
   deterministically thereafter. The LLM then authors a tool once instead of toiling per asset, the
   manifest records generator + prompt + script hash, and re-baking is reproducible.

**Not started. No slice opened. Requires operator or superagent approval on point 3 before any work.**
