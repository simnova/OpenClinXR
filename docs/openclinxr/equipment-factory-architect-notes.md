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
