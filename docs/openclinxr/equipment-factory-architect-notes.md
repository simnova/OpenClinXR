# Equipment factory — architect notes (cadence)

Append-only short notes from every 4th loop tick. Not SSOT; catalogue + MADRs win on conflict.

## Bootstrap

- Doctrine: MADR 0054/0055 accepted.
- Spine: catalogue CLI green; 19 honest unmapped prose; OSS candidates staged.
- Risk: CC-BY volume without attribution surface (#193) — bank acquisitions must record attribution in provenance JSON.

## 2026-08-12 architect tick 16

- Catalogue 51 rows (bank 4 / thin_parametric 46 / modular_kit 1); unmapped 4→3 (blood-culture kit closed 4aad13f6, prose-map.ts:87).
- Drift is self-limiting, not structural: 12+ consecutive thin_parametric fills, but the only gaps left are bank (token-blocked, equipment-oss-candidates.md:68-70), the ECG kit merge (feature/equipment-kit-approach-b, 27 files / 7,393 ins), and 3 documented non-equipment deferrals. No thin_parametric-appropriate fill remains.
- **Wiring gap:** 12 ids have builder case arms but are NOT in PARAMETRIC_KINDS (station-equipment.ts:179-218) → planStationEquipmentMounts tags source="fallback" (station-equipment.ts:513-516) → evidence ledger records fallback (main.ts:3609) while catalogue claims runtimeSource=parametric (inventory.ts:105-108). All recent fills (wall_sign, medication_bottles, urine_cup, drain, incentive_spirometer, plus call_bell, panic_button, privacy_curtain, small_table, consultation_desk, medication_cart, blood_culture_kit) are scenario-bank-channel only — no PARAMETRIC_KINDS, no ROOM_PROP_BUILDER_ALIASES entry, so roomProp channel would box them (room-prop-geometry.ts:29-31).
- Remaining 3 unmapped (neuro exam card / joint diagram / soft lighting) are non-equipment — defer in catalogue with reason so stop condition is reachable.

Recommended next: PARAMETRIC_KINDS closure for the 12 family fills, then ECG kit merge (Q5)

## 2026-08-12 architect tick 20

- Deck-bank verdict holds: Kenney bedSingle 1.125/0.571/0.375 m (bedSingle-report.json:13-15) vs spec 2.15/0.98/0.58 (station-equipment-support-surfaces.ts:48-50). GLB mount path grounds by min-Y + shrink-only uniform footprint fit (station-equipment.ts:388-418, 445-475) — never up-scales, stamps NO deckTopYMeters/seatHeightMeters — so a GLB's deck height is geometry-controlled, while the parametric constants (station-equipment-support-surfaces.ts:101-102) ARE the supine-plant contract (#159/#171). No support-surface GLB precedent exists (stands only for bedside_monitor, station-equipment-builders.ts:145-151).
- Promotion is therefore an architecture change, not a swap. Right next move: measure-first acquisition of GRADD Hospital Room + OGA Small Hospital Bed (CC BY 3.0, equipment-oss-candidates.md:108-109) via the proven convert+measure path; promote hospital_bed_equipment only on mattress-plane deckTop≈0.58 + length≈2.15 (max-Z reads pillow, bedSingle-report.json:20), attribution per #193.
- Minimal promotion contract: converted GLB measured dims; supine-patient-on-deck / articulating-head-of-bed (#159) + actor-floor-contact (#105) + #179 post_op co-location green with GLB mounted; side_rails stays a separate declared id; catalogue row → bank/gltf + provenance + CC-BY ledger row.
- Conversion path proven; two gaps: measurement is pre-export Blender world → one runtime Y-up verify (#156 export_yup class); GRADD/OGA may carry UV textures (Kenney texture-free) → embed + verify MTL images resolve.
- Loop endgame: natural stop for the 15m cadence — fills exhausted, PARAMETRIC_KINDS wiring closed (station-equipment.ts:218-232), unmapped 3 = non-equipment deferrals, kit rebase-blocked (equipment-three-lane-factory.md:70-81). Remaining work is dedicated-slice only.
Recommended next: deck measure-first (GRADD/OGA convert+measure; promote only on spec match, else record negative, keep parametric SSOT), then kit rebase+merge (Q1/Q5)

## Architect notes 2026-08-12 (tick 24)

Note: loop tick 25 landed the deferred-prose classification and closed the loop (active=false) while this consult was reading — assessment below reflects post-landing tree.

### 1. ECG kit rebase plan review — tick-18 blocker still right; families.ts surface undercounted

Branch re-verified in worktree (`/Volumes/files/src/openclinxr-wt/equipment-kit-approach-b`, tip 76029fb3, 10 commits) vs main (merge-base f70ff1d2, +58). Conflict surface by file:

| File | Main | Branch | Merge |
|---|---|---|---|
| package.json:213-218 | pack-batch + 4 `factory:equipment:catalog:*` + loop:status | pack-batch + 4 `equipment:kit:*`, 0 catalog | CONFLICT → union (keep 5 main scripts + add 4 kit scripts) |
| station-equipment-families.ts | union 27 members (26-52), equipmentMat (60), tagEquipmentRootShared (83), legacy parametric buildEcgMachineEquipment (392) | kit import (22), union 16 members (27-44), no shared helpers, buildEcgMachineEquipment→assembleEcgCartMidbandV1 (370-372) | CONFLICT → main imports+union+helpers, re-apply branch kit import + kit body swap |
| station-equipment.ts:179-234 | PARAMETRIC_KINDS 33 (incl 12 tick-16 closures) | PARAMETRIC_KINDS 21 | likely CLEAN (branch strict subset); verify tick-20 GLB-mount region (388-418, 445-475) is main-only |
| station-equipment-builders.ts:147-535 | 50 case arms | 38 case arms (no tick-16 closures) | likely CLEAN (branch strict subset) |

- Plan blocker section (equipment-three-lane-factory.md:79-91) is still the correct shape (rebase onto main, resolve 2 files preserving both sides) — but it undercounts families.ts: the union grew 16→27 and the merged file must hold main's helpers/union AND the branch's kit body. The branch's kit body swap (families.ts:370-372) replaces the legacy cart (main:392+) — intended (catalogue lane modular_kit), but confirm no main consumer depends on the legacy silhouette.
- The +58 drift (ticks 19-23) added NO new conflicting files: those ticks were deck docs/staging + a station-equipment.ts GLB-mount region (tick-20 notes) — check that region resolves clean.
- New risks: (a) merged families.ts must stay ≤600-line zone — kit import+body swap is net-neutral; (b) pnpm-lock.yaml — kit adds no deps (three/tsx), expect clean; (c) after merge, catalogue flips `12_lead` note pending_merge→kit present (inventory.ts:129-139) and report-MD "Next gaps" needs updating.
- Sequence (rebase-onto-main preferred: 10 mostly-additive commits → deterministic replay, 2-file "preserve both" resolution, conflict-free final merge; merge-main-into-branch gives the same 2 resolutions with a messier history): (1) `git checkout main && git pull --ff-only`; (2) worktree `git rebase main`; (3) resolve package.json union → families.ts (main side + kit import/body) → `git rebase --continue`; (4) post-rebase asserts: `git show HEAD:package.json | grep factory:equipment:catalog:inventory`, `grep equipmentMat station-equipment-families.ts`, PARAMETRIC_KINDS contains medication_cart; (5) gates: ui-xr typecheck, `vitest run apps/ui-xr/src/equipment-kit/equipment-kit.test.ts` + station-equipment.test.ts, `pnpm factory:equipment:catalog:loop`, architecture-fitness, line-zone; (6) `git merge --no-ff` on main as a dedicated slice.

### 2. Loop stop condition — MET at tick 25; sound, wording should name the mechanism

- Verified terminal state: loop-state.json active=false tick 25, terminalReason "unmappedProse=0 + deck surfaces explicitly deferred + all real equipment classes mapped + PARAMETRIC_KINDS closed"; loop-log tick-25 row errors=0 warnings=0.
- Sound because the 3 items are genuinely non-equipment (scenario-bank context: joint diagram primary-care-dyslipidemia.ts:68-70; neuro exam card stroke-alert.ts:96-98; soft lighting oncology-bad-news.ts:70) and the deferred classification makes "unmappedProse=0" mean mapped-or-classified. Without it, 0 was reachable only via a fabricated map — the "silent wrong prose map" the lane forbids.
- Improvement: stopWhen (loop-state.json:16-18) and plan stop-conditions (plan:69-72) should name the mechanism explicitly — "unmappedProse=0 AND every prose mapped-or-classified (deferredProse with class+reason; zero fabricated maps)" — so a future re-opener cannot read 0 naively.

### 3. Deferred-non-equipment prose classification — landed tick 25, matches minimal-honest design; 4 small gaps

Implemented & verified: `DeferredNonEquipmentClass` + `DEFERRED_NON_EQUIPMENT` (class+reason SSOT) + `resolveDeferredNonEquipment` with same trim+toLowerCase normalization as resolve (prose-map.ts:92-126); `deferredProse` field + `summary.deferredProseCount` (types.ts:63-67,74); resolve→deferred→unmapped ordering in the bank loop (inventory.ts:71-96), sorted emission (195, 201); validate warns only for true unmapped gaps (validate.ts:52-57); tests assert classification, unmappedProse=0, deferredProse≥3, count match (equipment-catalog.test.ts:14-32); SSOT JSON deferredProse scenarioIds match bank (equipment-catalog.v1.json:1328-1366). Schema constant stays `openclinxr.equipment-catalog.v1` — additive reporting field, row shape unchanged → consistent with MADR 0055.

Gaps (assess-only, small follow-up):
a) CLI/report never surfaces deferredProse (no "deferred" in equipment-catalog-cli.ts) — `catalog:report` prints "unmapped prose: 0" with no why. Add `deferred non-equipment prose: N` + per-item `prose ← scenarios [class] — reason` to printReport (cli.ts:40-61) and the report-MD writer.
b) validate.ts has no contradiction guard: a deferredProse entry whose prose ALSO resolves to an equipment id passes silently. Impossible from a fresh inventory (resolve-first ordering) but possible in a stale committed JSON — add an error line.
c) types.ts:66 `class: string` is untyped — should import `DeferredNonEquipmentClass` from prose-map.ts (a typo class currently passes validate).
d) MADR 0055 needs a one-line amendment recording the additive deferredProse reporting field under decision 3 (CLI surface).

Recommended next: equipment-kit-rebase-merge (Q5)

## Architect notes 2026-08-12 (bank promote — Sketchfab measure-first)

- **normalize-equipment-glb.py fixed** (future-import + world-space mesh transform + mesh filter + closest_target deck prefer).
- **Promoted 4 CC BY 4.0 GLBs** into `apps/ui-xr/public/xr-assets/medical-equipment/` and wired `REAL_EQUIPMENT_GLTF_BY_ID`:
  - hospital_bed: L=2.15 W=0.98 deck≈0.585 (BedsideStand meshes dropped)
  - stretcher: L=2.0 W=0.72 deck≈0.725
  - exam_table: L=1.9 W=0.70 deck≈0.575
  - privacy_curtain: height-fit 2.2 m (curtain+monitor composite)
- **Plant contract:** `stampSupportSurfaceDeckMetadata` stamps `deckTopYMeters`/`seatHeightMeters` from SSOT on gltf mount (station-equipment-support-deck.ts). Catalogue bank lane **4 → 8**.
- **Attribution:** PROVENANCE.md + sidecars + third-party-asset-licence-ledger.md.
- **NOT done this promote:** full-room supine-patient-on-deck / articulating-head-of-bed re-run with GLB mounted (architect tick-20 residual); GRADD public GLB still unmeasured; ECG kit rebase still open.
- claimScope: bank lane acquisition + wiring. notEvidenceFor: Quest, clinical, readiness.

Recommended next: isolated harness grade of bank support-surface GLBs + plant contracts green, or GRADD measure, or ECG kit rebase (Q1/Q5)
