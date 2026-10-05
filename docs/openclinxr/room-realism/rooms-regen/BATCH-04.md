# Rooms regeneration batch 04

Cold, cache-disabled promotions run on 2026-10-01. Times include compute-slot queueing; all three stage caches missed.

| Environment | Result | Generate / strip / shell-bake / extract / probe (ms) | Shipped GLB | SHA-256 |
|---|---|---:|---:|---|
| `pediatric_fever_urgent_care_bay_v1` | ok | 9320 / 2420 / 28945 / 3807 / 2948 | 10,282,736 bytes | `c65f0ff52fce7207f201a652fd298393af159aad53cd6fa5994ebe0a583376fb` |
| `inpatient_ward_room_v1` | ok; semantic content already current, bytes preserved | 7095 / 3230 / 33741 / 1960 / 2651 | 9,221,980 bytes | `8816c56eceafd02398077b623975d8948c09549fd9d43bce489040c8c58d42ea` |
| `stepdown_room_v1` | ok | 13715 / 28951 / 26782 / 3306 / 1513 | 9,308,164 bytes | `c7def44bda87d5d115d53c794f546ec6bf1b5ae655865f00df4262cdf538e6ab` |
