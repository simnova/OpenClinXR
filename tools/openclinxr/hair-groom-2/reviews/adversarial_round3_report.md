# Adversarial round 3: resolution, 2026-11-07

Reviewers (fresh context, read-only): gate red-team (`redteam_round3_report.md`), EGM zoom-out +
inventive catalyst (`zoomout_round3_report.md`), and three repo adversaries (productivity skeptic,
drift police, realism) whose findings are recorded in the lane handoff only. The Elephant re-verified
the labels marked RE-VERIFIED below with git and file reads on `wt/hair-groom-2` at `a7dd03250`.

## Zoom-out (decided first: could change direction)

| # | finding | re-verification | resolution in DESIGN.md |
|---|---|---|---|
| Z1 🔴 | library route rejected on "five styles" | RE-VERIFIED: ledger hair01 row, 2026-09-17 ruling, all 25 permitted; 2 topology exclusions. Hair 02/03 not fetched (INFERRED) | Problem 7; Phase 0c grades 23 hair01 + Hair 02/03 on three actors; gate limits phases 2-5 to styles the library lacks if it passes |
| Z2 🔴 | adult males wear the female bob | RE-VERIFIED by GLB mesh names: robert-hayes and gown-adult-patient carry `toigo_blunt_bob_with_bangs_mpfb_robert_reference`; 4 actors share the style | Problem 5; Phase 0a keys `robert_reference` to a male style; Phase 4 male baseline defined |
| Z3 🔴 | Phase 0 cannot run: no `provider-cache/hair/` | RE-VERIFIED: shared checkout and worktree caches hold only `eyes/`, `garments/` | Problem 6; Phase 0a prerequisite re-acquires from licence rows 13-14 and diffs the issue-330 classification |
| Z4 🟡 | station inside a 10,256-line materializer cannot be tested alone | accepted | materializer dumps `head-dump.npz` before helper strip; S2-S5 run standalone; S6 re-imports |
| Z5 🟡 | no LOD consumer | accepted | LOD cut from S6 |
| Z6 🟡 | long recipes pierce shoulders in motion | accepted | S6 weights long recipes to `neck01`/`spine05`; V4 garment gate over `body_motion` |
| Z7 🟡 | overdraw and MASK shimmer | accepted | OQ2 extended; V7 motion gate |
| Z8 🟡 | clean comparator skips `material-tint.ts` | accepted | S7 names the lit, tinted path as graded |

## Gate red-team

| gate | resolution |
|---|---|
| V1 inputs 🔴 | `cards.py`/`textures.py` take inputs as arguments; V1 requires the run record to name this actor's `head-dump.npz` and no v1 evidence path |
| V1 seed 🔴 | `textures.py` seed from recipe; V1 seed row compares POSITION and atlas hashes, not file sha |
| V2 budget 🔴 | `cardBudget` is a `cards.py` argument; 300-800 window becomes `[0.5, 1.5] × cardBudget`; selection = smallest budget passing V5+V7 on all Phase 4 actors |
| V3 🟡 | exact primitive contract: 1 MASK+texture, 1 OPAQUE untextured, 0 library hair |
| V4(a) 🔴 | signed distance from nearest face normal; `MeshIndex.query` excluded |
| V4(b) 🟡 | 2.2 mm ceiling kept; hair-cards0 max push measured before Phase 2 as known-good |
| V5 🔴 | cards only (shell hidden), lit pass, scalp mask from S2 ID pass |
| V5 known-good 🟡 | Phase 0a column graded under V7 first; part band bounded by `partWidthMm` instead of exempt |
| V6 🟡 | per-actor V3/V4/V5/V7/V8, distinct head axes, no actor id in station code |
| V7 🟡 | family fields drive `textures.py`; V7 alpha row per `v` band |
| V8 🔴 | v1 test not reused; L/R split of the V5 render, bar = largest Phase 0a asymmetry |
| probes 🟡 | OPAQUE probe now fails V3 mechanically; atlas cache keyed by content |
| missing gates | added V4 garment, V9 families, V10 export survival; eye/face band and colour in V7; capture metadata required per capture |

## Repo adversaries

| reviewer | finding | resolution |
|---|---|---|
| Skeptic 🔴 | first visible card hair arrives in Phase 2 | Phase 1 is the Model Vetting spike on v1 `cards.npz` + atlas, before S1-S3 |
| Skeptic | Phase 0 mixes visible and archaeology work | split into 0a (alpha re-bake, male style), 0b (brow/lash), 0c (library board) |
| Drift 🔴 | fourth parallel hair path | part-open8 retired in `PROJECT_STATUS.md` WAKE BLUF; `hair_editor` stated dormant (refused pack) |
| Drift | one actor until Phase 3 | peds-patient-child joins in Phase 2; not in the spike because v1 cards were built on aisha's body dump |
| Drift | register baseline TSV and `sheet.png` | TSV is tracked here; `sheet.png` is absent from this tree (only `render-times.json` tracked), so Phase 1 re-renders it and registers captures with `pnpm docs:artifacts` when they land |
| Realism 🔴 | v1 sheet reads as striped translucent film | V7 adds show-through, card planes, layer steps, tip line, atlas tiling, root/tip luminance, exposure floor; V7 motion adds the MSAA on/off pair |

NOT TESTED: no gate in this design has run; every threshold above is a plan. Hair 02/03 licences are
unread.
