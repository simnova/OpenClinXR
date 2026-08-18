# Superagent brief — promote the remaining station rooms

**From:** hourly-loop orchestrator. **Date:** 2026-08-14.
**Status:** **TELEHEALTH LANDED** `18f8e1ce`. Sixth room:
`telehealth_home_visit_v1` → `infinigen-telehealth-home-visit.glb`
sha `476a8e40…` (new seed 14 `bedroom_0` seg 2 yaw 180). Orchestrator
grade: **ACCEPT interior**. Next: `behavioral_health_private_room_v1`
(new seed 15+; skip crash seeds 3/4/5/9/11/12). No humanoids. Prior
five room bytes frozen.

## READ THIS FIRST — one of the two existing rooms renders BLACK

`pediatric_urgent_care_bay_v1` currently renders **nothing** in its own station: black viewport, no
room, no floor, no cast. Reproduced three times with byte-identical camera output. Measured non-black
viewport share **0.1 %** against ED's 70.3 % and telehealth's 100 %.

**Cause NOT DETERMINED.** Three hypotheses are already dead and are recorded so nobody re-walks them:

| hypothesis | verdict |
|---|---|
| eye is inside geometry | **no** — 1.084 m clearance; ED's eye is closer at 0.534 m and renders |
| the bake lost its materials | **no** — both rooms 3 materials / 6 textures, identical structure |
| corridor geometry explains it | **no** — #407 made it a 1.02-aspect room and it went black anyway |

A limit of my own instrument, stated: I computed that clearance with the room centred on its own AABB,
while `positionInfinigenRoom` centres Z on the **parametric shell's** floor centre. So it approximates
the runtime frame. **The next measurement is a live scene dump at the derived eye** — not another
capture, not another offline guess. My attempt at it hit a 10-minute foreground ceiling; it wants a
background run.

**Do not generate twelve more rooms before this is understood.** Whatever makes one room black may
make all of them black, and you would find out twelve bakes later.

## Why the rest is a good superagent effort

- **13 of 16 declared `environmentId`s** still render the parametric box. Two are mapped.
- **The generator is installed and proven**: infinigen **1.14.0-dev**, venv python 3.11.8,
  `no_objects.gin` present, prior sweep outputs on disk. `infinigen-single-room-shell.ts:174-192`
  resolves those paths; `infinigen-single-room-extract.py` already extracts one room from a scene.
  **Wire what exists (D1).**
- **Each room is independently landable and independently gradeable.** No room blocks another.
- **Duration is not a constraint (D9).** A generation run is ~6 minutes plus a bake. That is fine.
- **The runtime side is a one-row-per-room table** — `INFINIGEN_ENVIRONMENT_ASSETS`. The plumbing is
  proven (load, procedural-box suppression, camera read-back, fixture re-anchoring).

## Four contracts already guard this work — all green on main today (15 passed, 1 expected fail)

| contract | what it refuses |
|---|---|
| `a-second-station-gets-its-own-generated-room` | one asset serving two ids (#388/#85), by hash **and** geometric signature |
| `a-generated-room-gives-the-interior-camera-a-standoff` | a hull that does not stand proud, which collapses the interior camera |
| `a-clinical-bay-is-a-room-not-a-corridor` | a corridor; bound derived from the ED bay's aspect, generous at 1.5× |
| `a-station-capture-is-not-a-black-frame` | **a station that renders nothing** — the catastrophe gate |

The last one is why offloading is safe now and would not have been yesterday: a black room fails
mechanically instead of shipping green. **It is a catastrophe gate, not a quality gate** — "did a
learner see anything" is the one appearance question a machine can answer. Whether a room looks *right*
stays an orchestrator pixel grade.

## The unsolved part is SELECTION, and that is the real D9 work

`hallway_0` was extracted for a paediatric urgent-care bay. It satisfied every contract at the time —
enclosed, floored, walled, hulled — and was a 9.9 m corridor. The aspect contract now refuses that
specific failure, but **"which extracted room suits which clinical station" is still a judgement made
per bake**, and a judgement made per bake is exactly what a dark factory removes.

**The highest-value thing in this campaign is turning selection into a deterministic predicate** —
reject-at-extract-time on measured properties (aspect, floor area, opening count, ceiling height)
rather than a human eyeballing which named room to take. Twelve rooms produced by a predicate is worth
far more than twelve rooms produced by twelve judgements.

## Ownership

Rooms only. **Do not touch any humanoid GLB** — a separate campaign owns those and has just finished.
Do not touch the ED bay asset (it is the known-good column in three contracts). Do not #167.

## Sequence

1. **Diagnose the peds black frame.** Live scene dump at the derived eye. This gates everything else.
2. **Turn selection into a predicate** at extract time, with the measured thresholds recorded.
3. **Then** the remaining rooms, one landing each, isolated grade per room, orchestrator grades pixels.

## Done means, per room

Generated deterministically (seed + config recorded in PROVENANCE.md), registered in the artifact
registry by hand-adding the row — **never `pnpm docs:artifacts`**, which shrinks the protected registry
in a worktree — four contracts green, a fresh station capture, orchestrator pixel grade, and a CLAIM /
NOT TESTED line. A green contract is not done.
