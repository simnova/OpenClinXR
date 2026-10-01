# Stepdown room data-driven finish proof

`stepdown_room_v1` is used by `stepdown_sepsis_nurse_escalation_v1`. Seed 205 runs the registered room chain with the ward-like finish block; this is a visual/runtime factory proof, not clinical-validity, exam-equivalence, Quest-readiness, or production-readiness evidence.

The prior shipped asset was SHA-256 `f89a16c89429788e649a89dc0b665dbae7d26c36d6b26f3736a2c8281db9a503`. The promoted asset is SHA-256 `78b3a762a32bfb8ada656fa816652ead3083546996ba76bf8fd9b9f983031c58` (9,585,828 bytes).

The learner runtime produced six equivalent standard room poses for the preserved prior GLB (`before/`, explicit route override) and the promoted runtime URL (`after/`, no GLB route override). `sheets/` presents before | after | no reference. No independent visual reference exists for this stepdown room.

Structural gates are pinned by `the-stepdown-finish-meets-pixel-budgets.test.ts`: 110 primitives, zero material-less primitives, zero black flat materials, floor/cove/hospital-door/troffer/T-bar meshes present, and 50.6283203125 MiB decoded RGBA including the 1.33× mip allowance (limit 56 MiB). See `budget.json` for the complete texture breakdown.

Ward compatibility was checked separately: pre-change finish key `34a1ea6454a6f335f78dd2d7e6613274c9dffc510651e161271086d85b610951`, post-change finish key `dc0a464c97b842d8e006bfea40691ffb297775045308a75a3ab4ccff1c8f8e8c`; both produced byte-identical ward GLB SHA-256 `70a17a751a41d275ce780a96defe7b818c8d94f622772b8d9a46969d8fbdc833`, and promotion reported `changed: []`.
