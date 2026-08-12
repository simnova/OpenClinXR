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
