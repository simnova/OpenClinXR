# MADR 0052: MPFB graduation — phases, and the hour-by-hour autonomous schedule

Status: Accepted
Date: 2026-08-11
Issue: #296, #301
Related: MADR 0051 (Anny-reference → MPFB match protocol), MADR 0044 (adopt the MH body for garment fit), D11 (MPFB and Anny both first-class, split by job)

## Context

Operator approved 2026-08-11 01:42 EDT. Direction, in their words across this session: Anny stays the
**phenotype source of truth** because it is anchored in datasets; MPFB becomes the **runtime asset**
because of better viseme mapping, eyes and bones; procedural alignment is preferred and LLM-based
alignment is "not ideal but acceptable". Once body types are mapped, re-enable clothing, hair and
animation on the MPFB-based assets.

Also operator, on cadence: steady progress over 8 hours against **actual clock times**, **one
meaningful tick per hour**, **do not strive for perfection**, then alternate **1 h refinement / 1 h
advancement**.

## Measured starting position (this session, not assumed)

| capability | state |
|---|---|
| Rig | **Done.** 137 joints — finger chains, metacarpals, wrist, jaw, `tongue00–07`, facial muscle bones. The Anny rail has 23, with `hand.L/R`, `index_finger_base.L/R`, `foot.L/R` carrying **zero dominant vertices**. |
| Body from phenotype | **Solvable.** Macro Jacobian measured at the 0.5 operating point, central differences over ±0.2. Well-conditioned. Stature already scaled to the Anny reference by `body_param_stage.py:252-260`. |
| Measurement | **Done.** Landmark instrument agrees with `anny.Anthropometry` within 0.83 cm (lean) / 0.45 cm (BMI 45); translation-invariant as of #300. |
| Wardrobe | **Partial.** `ClothesService.fit_clothes_to_human` is wired; cache holds **3 `.mhclo`, all shirts**. MPFB's own library ships **0**. |
| Eyes | `add_mpfb2_eye_rig.py` exists. Unverified at runtime. |
| Visemes | **CORRECTED 2026-08-11 — my "absent" claim was wrong.** The 10 *morph targets on the exported GLB* are body macros, but the MPFB install ships **102 expression unit targets** and **110 mouth/lip targets** (`mouth-upperlip-middle-up`, `mouth-scale-horiz-incr`, …). Zero files match `visem`/`phonem`, so **face action units ship and visemes must be COMPOSED from them** — FACS-style. Materially better than absent; not ready-made. |
| Hair | **Absent on every rail.** MPFB's hair path is asset-based (`is_hair_asset_installed`); zero hair assets on this machine. |
| Runtime | 1 real MPFB actor (OB patient Aisha). 22 case fixture files. |

**The measured Jacobian** — `∂landmark/∂macro`, metres per unit macro, at all-macros-0.5:

| macro | stature | shoulder | chest | waist | hip |
|---|---:|---:|---:|---:|---:|
| weight | 0.0000 | 0.0106 | 0.0363 | **+0.0944** | +0.0917 |
| muscle | 0.0000 | 0.0029 | 0.0301 | **−0.0832** | −0.0577 |
| gender | −0.0317 | **+0.0810** | 0.0654 | 0.0240 | 0.0237 |

Baseline: stature 1.7138, shoulder 0.6572, chest 0.9111, waist 0.7606, hip 1.0221.

Three consequences that shape the plan: **weight and muscle oppose on waist**, so the system is not
degenerate; **weight and muscle move stature by exactly 0.0000**, so girth solving cannot disturb the
reference-driven stature; and **gender is the only coupled knob**, so it is set from the authored
presentation FIRST and the girth solve runs after.

## Decision — phases

- **P1 Body.** Phenotype → MPFB macros by Jacobian solve, matched to the Anny reference, verified by
  landmark deltas inside MADR 0051 §5 bands. Everything downstream depends on a correct body.
- **P2 Cast.** From one MPFB actor to a full station cast; `humanoid-runtime-asset-url` wired so a
  learner loads MPFB bodies.
- **P3 Wardrobe.** `.mhclo` fitted onto MPFB-matched bodies. Lower-body coverage is the real gap.
- **P4 Face.** Eyes verified live, then viseme shape keys — the reason D11 names MPFB for lip-sync.
- **P5 Motion.** Retarget onto the chosen rig. **#70's premise is FALSE and is withdrawn here:**
  Mesh2Motion is a **browser web app** — no CLI, DOM-coupled, its retarget tool is manual drag-and-drop —
  so it cannot run headless and was never a viable motion path, only an unused one. Salvage: its ~150
  clips are CC0 and export as GLB. The real path is **`retarget_bvh`** (Diffeomorphic, ex-MakeWalk),
  which is headless-capable (`setSilentMode(True)`) and ships bone maps that match MPFB rigs exactly.
  **`retarget_bvh` is GPL-2.0-or-later: build-time tooling only**, same posture as MPFB's AGPL, never a
  shipped dependency.
- **P6 Evidence.** Graded captures per phase; website only on a real win (D12).

**Hair: UNBLOCKED 2026-08-11.** Operator approved CC0/CC-BY. Acquired `hair01` — **26 hairstyles,
CC0 1.0**, 25 `.mhclo` + 25 `.mhmat` — into the provider cache with a provenance stamp, tracked in
`docs/openclinxr/third-party-asset-licence-ledger.md`. Hair is clothing in MakeHuman topology terms, so
it fits the **existing** `ClothesService` path — the same one wardrobe uses (P3), not a new mechanism.
**Hair therefore joins P3 rather than becoming its own phase**, and lands in an advancement hour after
the first garment is fitted to a solved MPFB body.

The geometry-nodes `haireditor` pack was researched and **refused**: no licence stated. It is what
MPFB's `haireditorservices.py` looks for and the better long-term (procedural, D2) route, so a licence
clarification upstream is worth chasing — recorded in the ledger's REFUSED table.

**Still NOT scheduled, because it is not an engineering blocker:**
- **Phenotype for the other 13 cases** is clinical authoring (#293). No pipeline slice moves it.

## Rig decision — `mixamo_unity`, taken before runtime wiring

**Decided 2026-08-11, verified locally against the installed 2.0.15 rig JSONs.** `mixamo_unity` is a
**strict superset** of `mixamo`: 64 bones vs 52, **nothing dropped**, and the 12 extras are exactly

`mixamorig:Jaw` · `LeftEye` · `RightEye` · `Left/RightOrbicularisTop` · `Left/RightOrbicularisBottom` ·
`Left/RightBreast` · `Left/RightButtock` · `Root`

So one rig serves **retargeting** (all 52 `mixamorig:` names match by name), **gaze** (eye bones, the
08:00 tick), **lip-sync** (`Jaw` plus the composed visemes above), and **root motion**. There is no
trade-off to weigh. **Take this before the 06:00 runtime-wiring tick** — changing rigs afterwards is
expensive.

Rejected: `default`/`default_no_toes` (163/137 bones) — richer, but `retarget_bvh`'s `makehuman.json`
map is a **trap** against it: the fingerprint matches so retargeting auto-detects MakeHuman, then
silently fails to drive spine, neck and shoulders because the map targets MakeHuman 1.x naming
(`neck`, `spine2–4`) that MPFB2 does not use (`neck01–03`, `spine01–05`).

**Trap to carry:** the rig JSONs use **two incompatible schemas**. `rig.mixamo.json` and
`rig.openpose.json` are WRAPPED (`{bones:{…}}`); the other six are FLAT. A naive `json.load()` reports
**4** bones for mixamo. Always unwrap with `d.get("bones", d)`. Verified counts: default 163,
default_no_toes 137, mixamo 52, **mixamo_unity 64**, game_engine 53, cmu_mb 31, openpose 24.

## The schedule — one meaningful tick per clock hour

Approved 01:42 EDT 2026-08-11. Times are local (EDT).

| clock | tick | done means |
|---|---|---|
| 02:00–03:00 | Jacobian solver lands | `solveMacrosForTarget(landmarks)` + contract solving the Anny lean-female reference inside ±2 cm |
| 03:00–04:00 | Solver drives a real bake | one MPFB body generated from an Anny reference end to end, landmark deltas recorded |
| 04:00–05:00 | Graded capture | lit + structure pair; orchestrator grades pixels; first honest MPFB-vs-Anny image pair |
| 05:00–06:00 | Second + third actor | one case's full cast through the solver; per-actor delta table |
| 06:00–07:00 | Runtime wiring | that case's actors resolve to MPFB; UI-XR loads them |
| 07:00–08:00 | Wardrobe on MPFB | one `.mhclo` fitted to a solved MPFB body; poke-through measured |
| 08:00–09:00 | Eyes verified at runtime | gaze/eye rig confirmed live, not merely present in the file |
| 09:00–10:00 | Station capture + status | full station graded; `PROJECT_STATUS.md` and board reconciled |

**From 10:00 onward: alternate 1 h refinement / 1 h advancement.** Refinement takes the top defect from
the preceding capture. Advancement takes the next unstarted phase item.

## Execution contract for the autonomous loop

- On the first wake past each hour, read this table. If the hour's tick is not done, it is the **only**
  slice for that hour. Intermediate wakes harvest, verify and land.
- **Hour targets are not guarantees.** A Blender bake is minutes; a solve loop can miss. When an hour's
  tick cannot land, take the smallest real piece of it and **say so** — do not stretch the claim.
- **Do not strive for perfection.** One observable, graded change per tick beats a polished one.
- Every tick closes with a CLAIM and a NOT TESTED line, as usual.

## Preconditions any MPFB measurement must satisfy

Learned the expensive way (#300, #301). A mesh handed to the landmark instrument must be:
1. **Y-up** — glTF convention; Anny and Blender are Z-up, and the conversion has been missed three times.
2. **Grounded**, feet at y=0 — bands were absolute-Y before #300; still the safer input.
3. **Helper-stripped** at vertex **13,380** — 19,158 → 13,380 verts, 36,972 → 26,756 faces, byte-matching
   the shipped library GLBs. Un-stripped, the clothes-helper shell narrows shoulder span by 5.8 mm.

## What this does not claim

No clinical or anthropometric validity for any generated body; no learner readiness; no Quest
performance posture. The Jacobian is a **local** linearisation at the 0.5 operating point — body macros
are unlikely to be linear across the full range, so it is good for iterating from a nearby start and is
untested at the extremes.
