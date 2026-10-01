# Rooms regeneration batch 01

Cold, cache-disabled room-chain promotions run on 2026-10-01. Shell and ambient-occlusion Cycles bakes used Metal; geometry generation, extraction, finish composition, and lighting composition used CPU.

| Environment | Result | Generate / strip / shell-bake / extract / probe (ms) | Cache | Shipped GLB | SHA-256 |
|---|---|---:|---|---:|---|
| `ed_exam_bay_v1` | ok | 8106 / 1011 / 25096 / 1426 / 1079 | miss / miss / miss | 10,183,432 bytes | `60f4e7468b56d4891f195e2853d6294634b549050364e345f52c3d9c45713d47` |
| `pediatric_urgent_care_bay_v1` | ok | 7821 / 2099 / 27164 / 3485 / 2815 | miss / miss / miss | 8,781,436 bytes | `3d5e58ce0a4154f90d6a245be6b88b440e71fe926e8d009164c094be48020a71` |
| `primary_care_clinic_room_v1` | ok | 8190 / 2927 / 30817 / 3022 / 4021 | miss / miss / miss | 9,667,304 bytes | `1d8ff5991eb93e15f9bff5159771891990287caff8b8b6efce4fe820caaa3009` |
| `ed_stroke_bay_v1` | failed: `room_clinic_finish` | generation completed; finish refused the imported leaf-axis mismatch | miss / miss / not run | unchanged | error: `hingeSide +x does not name the leaf width axis (ua=1)` |

The complete machine-readable fleet report, including final material, triangle, texture-memory, timing, and warm-cache measurements, is generated after all batches so every row uses one measurement implementation.
