---
name: movement-acceptance
description: Take any humanoid movement (walk, turn, sit-to-stand, reach, another actor) to an accept/reject decision through source -> bound -> live attribution with the repo's instruments and bars.
---

# Movement acceptance

Accept or reject a movement in three ordered stages. Never skip a stage: every
wrong diagnosis on the physician walk came from grading one stage and blaming another.

## (a) Attribution order

| stage | question | command |
|---|---|---|
| 1. source clip | does the source asset move right | `pnpm exec tsx tools/openclinxr/evidence/walk-clip/measure-gait-three-point.ts --source-glb <source-glb> --bound-glb <shipped-glb> --out <json>` (RUN 2026-10-13: source `Walk` toe 0.172 m, bound 0.159 m; columns `a`/`b` plus gate rows print to stdout; `--out` may point at `/tmp`) — source file: `tools/openclinxr/evidence/walk-clip/measure-gait-three-point.ts` |
| 2. bound clip | did the retarget preserve it | same command's gate rows (RUN 2026-10-13), or the gate unit tests `cd packages/openclinxr/factory-stations && pnpm vitest run src/motion_retarget/walk-symmetry-gate.test.ts` (RUN 2026-10-13, 6 passed) — gate: `packages/openclinxr/factory-stations/src/motion_retarget/walk_symmetry_gate.ts` |
| 3. live runtime | does the mixer play it | `pnpm exec tsx tools/openclinxr/evidence/loco-ground/loco-ground-capture.ts --row=lockOff` (RUN 2026-10-13: 6.00 m route, 209 frames, 211 tap frames) then `pnpm exec tsx tools/openclinxr/evidence/loco-ground/loco-ground-analyze.ts` (NOT RUN here: needs all three rows `lockOff,twoBone,ccd`; last full run 2026-10-12 per `docs/openclinxr/locomotion/loco-proving-ground-2026-10-12.md`) — capture/analyze: `tools/openclinxr/evidence/loco-ground/loco-ground-capture.ts`, `tools/openclinxr/evidence/loco-ground/loco-ground-analyze.ts` |

Full 7-clip sweep `tools/openclinxr/evidence/walk-clip/walk-clip-census.ts`: NOT RUN
here (needs Blender binds; last run 2026-10-12 per
`docs/openclinxr/locomotion/walk-clip-census-2026-10-12.md`).
Browser live-mixer probe `tools/openclinxr/evidence/walk-clip/probe-live-mixer.ts`:
NOT RUN (superseded by the loco-ground tap, which records mixer actions per frame).

## (b) Instruments and what each cannot see

| instrument | measures | cannot see |
|---|---|---|
| `measure-gait-three-point.ts` (a/b columns) | same gait metrics on source bytes vs bound bytes offline | live mixer blending: source 0.172 / bound 0.159 / live 0.035 m toe lift on the same clip (`docs/openclinxr/locomotion/walk-playback-blend-2026-10-12.md`) |
| `walk_symmetry_gate.ts` via `gate-one-clip.ts` | clip symmetry/preservation offline (9 bars, §c) | runtime: the shipped walk fails 4/9 bars offline yet plays at full amplitude live after the playback fix (`docs/openclinxr/locomotion/walk-clip-census-2026-10-12.md` stage 4) |
| loco-ground capture tap (a) mixer, (b) post-posture, (c) end-of-frame | which writer moved which bone, per frame (`docs/openclinxr/locomotion/loco-proving-ground-2026-10-12.md`) | anything before the mixer: clip choice, bind, labels are inputs, not findings |
| loco-ground analyze steady state | label-independent foot metrics, first/last gait cycle dropped | start/stop transients (reported separately) and any run-to-run noise (same-build controls differ by 0.29 leg-quat / 0.087 m root, `docs/openclinxr/locomotion/arm-settle-2026-10-11.md`) |
| headless SC-05 assay (`runApproach`) | clip + root motion slide over the 1.3 m bedside route | stance-lock IK and leg solvers: marker rigs carry no leg chains, so flag on/off rows are bit-identical by construction (`docs/openclinxr/locomotion/ccd-stance-lock-2026-10-11.md`, verdict INCONCLUSIVE) |

## (c) Acceptance bars (every number carries its source)

Offline clip gate (`walk_symmetry_gate.ts:42-55`): stride asymmetry ≤ 5 %,
step-duration asymmetry ≤ 5 %, thigh ROM asymmetry ≤ 10 %, duty 0.55–0.65 per foot
(all four: two-consultant review 2026-10-12); toe lift ≥ 0.06 m, ankle lift ≥ 0.10 m
per foot (walk-clip brief; shipped control 0.03 m); loop seam < 1 deg, root drift
< 0.01 m, arm swing ≥ 10 deg per side (walk-clip census brief). Contact band 0.06 m
is the production constant `FOOT_CONTACT_HEIGHT_METERS`
(`loco-ground-analyze.ts:20`, `loco-proving-ground-2026-10-12.md`).

Live playback (`walk-playback-blend-2026-10-12.md` bars 1–2): live/clip amplitude
≥ 0.95 on every leg bone; swing toe ≥ 0.127 m, ankle ≥ 0.21 m. Runtime timeScale
target ≤ 1.1 (`docs/openclinxr/locomotion/walk-clip-census-2026-10-12.md` browser check;
shipped plays at 1.63, still open).

Arrival and settling (`arrival-turn-stability-2026-10-12.md`,
`turn-leg-quaternion-norm-2026-10-12.md`): arrival position (along + lateral), final
yaw, planted foot as n ≥ 6 mean/sd/range (fixed turn: lateral mean 0.015 m, sd
0.0002 m; SC-05 cap 0.05 m per `stepping-turn-2026-10-11.md`); stance-foot slide per
planted window ≤ 0.02 m; max one-frame leg rotation ≤ 24.5 deg; bone quaternion
|norm − 1| ≤ 1e-4 on every frame. Thigh settling variation ≤ 0.002 m is NOT a bar:
it fails on ambient breathing oscillation with no turn at all
(`turn-leg-quaternion-norm-2026-10-12.md` bar c).

## (d) Wrong diagnoses on the walk and the cheap check that catches each

| wrong diagnosis (cost) | refuting measurement | cheap check first |
|---|---|---|
| "the walk clip itself is the problem" (operator told; 2 days of compensating fixes) | three-point: source 0.172 / bound 0.159 / live 0.035 m; every leg joint at 0.29–0.50x (`docs/openclinxr/locomotion/walk-playback-blend-2026-10-12.md` §Attribution) | list every running mixer action with tracks on the affected bones plus effective weight before blaming a clip |
| "shipped Walk is 67 % stride-lopsided" (instrument, not clip) | contacts wrapping the loop seam were split in two and averaged (`walk-clip-census-2026-10-12.md` §Instrument corrections) | resample the same motion at 8 phase offsets; identical motion must read identical numbers (`walk-symmetry-gate.test.ts` sweep) |
| "85 deg one-frame leg snaps" drove 150 turns of solver traps | upperleg norm decayed 1.00 → 0.86; 2·acos(\|dot\|) on raw quats reads 84 deg for near-identical poses; normalised control already met the bar (`docs/openclinxr/locomotion/turn-leg-quaternion-norm-2026-10-12.md` §Cause, §Metric) | print per-bone min/max quat norm; compare frame n to n − 2 (a real step differs, a norm artefact does not) |
| "the walking foot is the worst foot" from one aggregate number | browser metric read 0.51 m walk slide while settling episodes read 0.058 m: different phases, different contacts, not a disagreement (`docs/openclinxr/locomotion/walk-slide-browser-2026-10-11.md` §Measurement) | split any aggregate maximum by the phase/state column already in the evidence before it becomes a title |
| "the CCD lock does not affect slide" from the headless assay | on/off rows bit-identical: no leg chains run in-assay (`ccd-stance-lock-2026-10-11.md`) | confirm flag on/off rows differ before trusting any headless comparison |
| arm snap blamed on mixer cut, then weight rules, then broken ramp (~600 turns, 3 briefs) | posture pass applied the ownership slerp 19x per frame (w¹⁹), crushing the ramp into a step (`docs/openclinxr/locomotion/arm-settle-2026-10-11.md` §Cause) | per-writer tap on the control build (value after each writer + inputs used); count applications per frame |
| stepping turn made default-on from slide + posture numbers | six-run arrival: lateral mean 0.191 m, sd 0.141 m (`docs/openclinxr/locomotion/arrival-turn-stability-2026-10-12.md` table) | gate any settling/turn change on n ≥ 6 arrival mean/sd/range, control beside fix |

## (e) Measurement rules

1. Per-writer tap before naming a cause (rule d row 6).
2. n ≥ 6 run distributions for anything about where the body ends (rule d row 7).
3. Normalise quaternions before angle metrics; report per-bone min/max norm as its own metric (rule d row 3; `tools/openclinxr/evidence/settle-entry/quat-norm-math.ts` — read-only reference, that directory is owned by another worker).
4. Cyclic measures for one-cycle loops: three.js LoopRepeat period ends at the last timestamp, one closure step past it, sub-frame interpolated band crossings, merge seam-spanning contacts on the loop circle, drop a duplicated end frame, dedupe double-named joints (`walk_symmetry_gate.ts:188-280`, `walk-clip-census-2026-10-12.md`).
5. Split by phase before quoting a maximum (rule d row 4).
6. Grade motion on the bare body: hide garment/hair meshes, distinct thigh/shin/foot colours; garments-on render is a separate check (operator 2026-10-11 per `docs/openclinxr/locomotion/stepping-turn-2026-10-11.md` STEP 4; hide rule in `loco-ground-capture.ts`).

## (f) Walk-specific today, not yet general

- The proving ground runs one movement row (`tools/openclinxr/evidence/loco-ground/loco-ground-movements.ts`):
  default `physician-walk-6m` (6 m route refused otherwise, clip found by the name
  containing "walk"); second entry `nurse-walk-6m` (same walk clip in the nurse GLB).
- Gait bars (stride, duty, toe/ankle lift, L/R symmetry) assume an alternating biped
  gait; the contact band and lifts are foot-specific.
- Only actor proven: physician `senior_resident_ward_v1` on the SC-05 bedside scene
  at 30 fps fake clock. Nurse/child/60 fps/headsets untested
  (`arrival-turn-stability-2026-10-12.md` §Limits).
- No turn-in-place clip exists in any shipped GLB (clip census 2026-10-13:
  locomotion GLBs carry only `openclinxr_retarget_walk_source` beside idle takes).
- The movement-agnostic gate (`motion_retarget/movement_gate.ts`) covers bind
  fidelity (source vs bound) only, never live blending; settling/turn solvers live in
  `xr-humanoid-animation` and `settle-entry`, owned by another worker.
