# Rooms regeneration batch 03

Cold, cache-disabled promotions run on 2026-10-01. Times include compute-slot queueing; all three stage caches missed as required.

| Environment | Result | Generate / strip / shell-bake / extract / probe (ms) | Shipped GLB | SHA-256 |
|---|---|---:|---:|---|
| `telehealth_home_visit_v1` | ok; residential finish | 16304 / 3038 / 67787 / 3181 / 2435 | 6,558,636 bytes | `30fbaa470c1e636a2de5513371f28a3a0fe0e570b43c493cf154cf4fc56556d1` |
| `oncology_consult_room_v1` | ok | 7200 / 10733 / 38660 / 32106 / 2241 | 8,090,368 bytes | `9320e8b2010e1c3adf9fc447e393342b2538a60e226ac15f6b24b03f55760835` |
| `urgent_care_clinic_room_v1` | ok | 9461 / 9084 / 36541 / 31406 / 3587 | 9,763,148 bytes | `f0f1d6ea7c4a7a945392d5ef89d98844c8b1fc2f7babce758c1f85014bab870d` |
| `surgical_ward_room_v1` | ok | 15455 / 3423 / 65591 / 4764 / 2807 | 9,007,736 bytes | `f3e01851171cb79ea4300db5ad5d5fb925bc64033861ca4cc237cb18ab25805a` |
