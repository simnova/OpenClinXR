# Rooms regeneration batch 02

Cold, cache-disabled promotions run on 2026-10-01. Times include compute-slot queueing. The original behavioral-health chain completed but pose derivation correctly exposed an invalid ward-only troffer assumption; a preserved `cold-pose-retry` rerun passed after painted ceilings became a geometry-derived ceiling anchor.

| Environment | Result | Generate / strip / shell-bake / extract / probe (ms) | Cache | Shipped GLB | SHA-256 |
|---|---|---:|---|---:|---|
| `ed_stroke_bay_v1` | ok after leaf-axis correction | 15850 / 3574 / 65481 / 2879 / 4406 | miss / miss / miss | 8,951,772 bytes | `8466bf6e1dc761e10f091989c2b543096ea45071bd29c80877208235faf42058` |
| `adult_ed_abdominal_bay_v1` | ok | 7553 / 8806 / 31033 / 30840 / 6083 | miss / miss / miss | 9,267,736 bytes | `755c293a04564b1503fd8960467795791c235455f9c0793d1c1a73f2e2defab1` |
| `behavioral_health_private_room_v1` | ok after pose retry | 6074 / 934 / 28702 / 1316 / 930 | miss / miss / miss | 6,938,628 bytes | `393d0b0ee131cee0a50075de1737c82c3ed689e04133e956d683e4f4d5ed147c` |
| `ob_triage_room_v1` | ok | 15013 / 2841 / 58107 / 6800 / 3042 | miss / miss / miss | 8,947,524 bytes | `554698bd4bafe08ec0bfc9c888c2a2543185b4133229ecd04faf284fc3f5a74e` |

Factory findings: finish fallback must interpret hinge polarity on the measured post-import leaf-width axis; painted-ceiling recipes must derive ceiling poses from the ceiling field rather than require a nonexistent troffer or T-bar.
