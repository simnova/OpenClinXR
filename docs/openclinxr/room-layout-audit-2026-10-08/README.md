# All-room layout audit — 2026-10-08

This audit covers every shipped room with a learner perspective, a true top-down orthographic projection, and an isometric orthographic projection. The retained images are bound by SHA-256 in `capture-manifest.json`.

## Result

- Live framing gates improved from **7/15 to 11/15**.
- Mean layout score improved from **87.93 to 95.50**.
- **No room regressed** on the measured framing gate.
- Chest Pain v1/v2, Stroke Handoff, and Oncology were promoted from failing to passing.
- Joint Pain remained passing while its role-weighted projected actor coverage increased by more than 3×, making both actors substantially easier to inspect.

Four rooms remain below the strict all-actors gate: Pediatric Asthma, Pediatric Fever, Postoperative Fever Consult, and Psychiatric Safety. Their scores did not regress; Pediatric Fever and Psychiatric Safety improved. They remain explicit follow-up work rather than being hidden by relaxed thresholds.

## Corrections

1. **Room-owned props now fail closed.** Only the generic ED exam bay and inpatient ward receive their corresponding runtime prop libraries. Twelve other environments had inherited the 30-item ED set, adding 360 erroneous prop groups across the shipped scenario set. Their environment fixtures and scenario-declared equipment remain.
2. **Spawn metadata is no longer furniture.** The `learner_start` anchor remains available for navigation but its debug cube is not rendered.
3. **Stroke no longer includes an unused stretcher.** Its patient is authored standing and the encounter does not declare patient-support equipment.
4. **Review UI is excluded from room evidence.** The large portal review panel is hidden only by the room-capture harness; product behavior remains unchanged.
5. **The corrupt adult gown shell is suppressed precisely.** The current `mpfb-gown-adult-patient.glb` contains one malformed garment node that produces cyan shards in both standing and supine poses. The loader hides only that node on that asset and retains the actor and clean underlying body/clothing. The asset still needs a proper gown rebake.
6. **Overhead views cover the complete retained scene.** The orthographic camera is placed above the highest retained room object, fits the room footprint, and records its bounds and hidden shell names.
7. **Readable camera promotion is measured.** The solver can promote an already-passing camera only when the replacement also passes, keeps a containment margin of at least 0.08, does not worsen near-camera occlusion, and increases projected actor coverage by at least 1.5×.

## Review artifacts

- `all-rooms-perspective-before-after.png` — each prior learner view beside the final view.
- `all-rooms-overhead.png` — top-down orthographic projection for all 15 rooms.
- `all-rooms-isometric.png` — isometric orthographic projection for all 15 rooms.
- `perspective/`, `overhead/`, and `isometric/` — individual full-resolution captures.
- `capture-manifest.json` — live scene readings and hashes for every retained view.
- `../staging-solver/comparison/all-rooms-score.json` — before/after scoring and gate result.

## Claim boundary

These captures establish browser-rendered room composition and camera framing. They do not establish Quest performance, clinical validity, physical contact quality, or that the malformed gown asset has been repaired. Scenario-owned objects were retained unless the encounter model itself showed they were erroneous.
