# 0065 — kevin-collar: drop the 8 leaking unhidden tris (L), keep index-only selection

- Status: **accepted**
- Date: 2026-11-18
- Deciders: operator via cap41 (S9 GO, S10 FINISH ruling ~18:55, GO (i) ~19:35, RULING 2 ~20:15, RULING 3 ~20:50)
- Known-good inputs: `E/s7a/v-select-65.json` (`unionOpen` 132); `E/s9a/work/s9-selected.json` (SELECTED 126); candidate `E/s9a/work/s9-chain-out.glb` sha256 `ad61615d110853cf9b959ca6801afc8d079fce77203dc091d4fde07460075d7a` (20179696 B)

## Context

Kevin's nurse collar/sleeve openings fill with body skin where the shirt hides body tris: shoulder and V-border skin shows through the shirt at grade. The defect is opening fill by un-hiding body tris, not texture or pose.

## Options

- S6 distance band W: B GREEN, C-raycast GREEN, C3 STOP (R2' blind at the right hem; defect inside the pre-fix hidden opening set). Rejected: does not see the hem site it gates (`RESULT-s6.md`, `E/s6a/work`).
- S7 visibility selection: fine sweep finds `T_open` = 132 (v60 101 + 31 fine-added) and `T_leak` = 8 at the grade tie (0 at the product tie), with `T_open ∩ T_leak` = 6 tris (1:460/1:537/1:572/4:17/7:14/7:15). V4 STOP fired before any rebuild (`RESULT-s7.md`, `E/s7a/v-select-65.json`, `E/s7a/work/v-select-65.log`).
- S8 recess along -NORMAL: M1/M2 explain nothing (no material-flag anomaly; GPU agrees with CPU to 0.0002 mm), B1 built (SELECTED 134, 3 verts recessed) but C2' RED (tq 36 -> 12, main 0, one POKE regression) and ship-superset FAIL. Rejected (`RESULT-s8.md`, `E/s8a/work`).
- S9 drop leaking tris: SELECTED 126 = `T_open` 132 minus the 6 open L tris; index-only, ship-superset rc=0, thinning PASS, recess deleted, physician byte-equal. C1/C2'/C4 GREEN; C3 RED only on the unmeetable `>= 4 non-vacuous` rule and 1 px at H-low-front (143,60) (`RESULT-s9.md`, `E/s9a/work/s9-chain-out.glb`, `E/s9a/work/s9-selected.json`).
- Blender shirt offset: rejected by the EGM (not built; no evidence path).

## Decision

Drop L = 1:459, 1:460, 1:461, 1:537, 1:572, 4:17, 7:14, 7:15 (8 tris: the 6 open-leaking intersection plus 1:459/1:461, the hidden-src-only allowance owners). Ship SELECTED-126 index-only (S7 `T_open` 132 minus the 6 open L tris).

## Why recess is rejected

L are main's own hidden-prim tris. Any vertex move removes tris from main's multiset and fails ship-superset tight (a). The M check ruled out material flags + GPU skinning (S8 M1/M2), so there is no flag/skin to fix — only geometry to delete, which breaks the superset gate. Recess is therefore not a repair path for this defect.

## Known residual (RULING 3, S10e GREEN)

- 2 px regressed vs known-good S5 7c9545a7 (skin 8:70 never selected; candidate hidden 1:167 where S5 fills): (H-low-front,(143,60)) and (E-front-low-30,(159,136)), each S5-first 8:70 / cand-first hidden 1:167 / main-first hidden 1:210.
- 7 px parity with S5 (candidate and S5 both hidden-fail; fill sets equal 96/96): E-tq45-low-30 x=686 y=56..80, cand 1:624 / main 1:720.
- Report-only E-front-high-18 (4 px, measured/printed, never gated): 1:625/1:721 (x=744 y=0/4/8) + 1:624/1:720 (x=744 y=12).
- Restore path = densify selection rays, or select 8:70 with a leak check (C2' both ties).
- Why the parity class needs a fill floor (F1): F3 alone (cand-hidden AND main-hidden) would GREEN all 9 px including the 2 regressions — main itself would pass C1 while main is the defect. F1 (every fill(S5) has fill(cand) except a|b) exists to catch parity-masked regressions.
- Exclusion (b) is a closed list: px where S5-first is a body tri NOT in `T_open` AND cand-first hidden AND main-first hidden matches EXACTLY the 2 px above, each with S5 tri 8:70. Any additional match, or either listed px not matching, = STOP.
- HemR grade residual (cap41, not blocking): ~2x10 px light diagonal sliver at hemR-tq, identical on S5 7c9545a7 and the candidate (CAP3 hemR-tq 82 vs 82), absent on main 40492951 (main shows the black sawtooth notches the sliver replaces). Mechanism per p7b: bright shading on visible moved skin body#8 f134/f132/f152 (p7b sliver line (2421-2428,1615-1630), all first-hit SKIN moved+kept; main draws teal there). Grade-only cosmetic residual; the raycast gates see skin (pass), and S5-parity means the S9 selection introduced no new hem defect.

The held-out set is the 5 non-vacuous directions of a 15-direction list fixed before measurement (sha256 2ee21d10); a fixed count of 6 had no source, because the population is the forward-facing opening and 10 of 15 directions are vacuous by geometry. E-front-high-18 is report-only.
- Brow audit citation (cap42 W4 ruling (i), 2026-11-18): the Kevin eyebrow row in docs/openclinxr/humanoid-basecolorfactor-audit-2026-09-10.json cites the manifests/mpfb-peds-nurse-kevin.json:239 note. The setter is apply_actor_hair_colour.py:22,174, which computes the colour via authored_hair_color_rgba() and holds no literal the writer's triple index can reach. A writer setter rule belongs to HB00-AUDIT-STALE tsk_a8f536d45f27f262.

## Verification (2026-11-18, S10e)

- RUL1: `E/s10a/c3-heldout-list.json` sha256 `2ee21d106349aa337c7de76872a62dc639647884f8469c08343864ba61c65291` asserted in-test.
- RUL2: live main site reproduces the census on all 5 dirs (355/83/376/103/4); 4 carry + E-front-high-18 report-only.
- F3 GREEN on all 4 carrying (9 allowed hidden-hidden px / 3 dirs / 2 tri pairs; C2' 0 both ties; 0 px where main-first is not hidden).
- F1 GREEN (per dir S5fill/candfill/exclA/exclB/viol: H-low-front 352/351/0/1/0; H-mirrored-tq 83/83/0/0/0; E-front-low-30 372/371/0/1/0; E-tq45-low-30 96/96/0/0/0; report-only 0/0/0/0/0).
- F2 plants GREEN (main-as-candidate RED on F1 at every carrying dir with nonzero S5 fill; S5-as-candidate RED on C2' with S5fail=36 on tq site=15487). C3d GREEN (keep-L SELECTED=132 RED on 3/4 carrying + report-only).
- T1 honesty: `Tests:` lines print only after their asserts pass (S10e log 105-106).
- Evidence: `E/s10e/work/s10-f1f3.json`, `E/s10e/work/s10-f1f3.log` (EXIT=0); `E/s10d/work/` (RULING 2 RED record); `E/s10c/work/` (C3c record); `E/s10a/` (list + census).

## S10h1 classification (2026-11-18, E/s10h1/classify.json)

- required-behavior 50 vneck/tq hidden px: all 50 S9C1 (main-first tri in the dropped-L set, candidate hidden behind the slot), F3 0, NEITHER 0. Main-tri owners: 1:537 x14, 7:15 x11, 4:17 x10, 1:572 x7, 7:14 x4, 1:460 x2, 1:459 x1, 1:461 x1.
- C1 9 interior px (subset of the 50): all 9 S9C1, F3 0, NEITHER 0 (main 4:17 x5, 7:14 x2, 1:572 x1, 1:537 x1).
- Counterweights RED on both gates: main-as-candidate (hidden 50 / interiorFail 9), keep-L SELECTED=132 (hidden 2).
- The S3-era 0-assertions in the collar test are inverted guards naming this MADR: restoration = densify selection rays or select 8:70 with a C2' both-ties leak check; widening or deleting the guard is wrong.

## Consequences

- The standalone S5 and S7 chain drivers were removed as superseded by `tools/openclinxr/evidence/skin-footprint-inpaint/scripts/kevin-collar-s9-chain.py` and the manifest chain replay in `run-chain.test.ts`. Their decisions are recorded in the S5 and S7 records in this MADR.
- S9 SELECTED-126 stands; no reselection, no densify, no new tri list in S10.
- Any future selection of 8:70 (or any `T_open`-outside tri) ships only with a C2' both-ties leak check GREEN.
- The parity class (F3) never ships without the fill floor (F1); (b) stays a closed 2-px list until densified rays change the measurement.
- Machine-local only (S10h2/B5: `it.runIf(existsSync(...))` on store GLBs, skipped on clean clones via `KEVIN_COLLAR_STORE_ROOT`): required-behavior + C1 NOT PADDING (CW132), C3 C1-RED (S3), C3 C2-RED (S4 soup), S9 C1 + C2' (S5), C3 store record (s9-c3.json), S10e (S5 + CW132), C4 (CW132 + CW125); C3' + S10d are `it.skip` superseded records.
- No Quest readiness, clinical-validity, licensure, or scoring claims follow from this MADR.
