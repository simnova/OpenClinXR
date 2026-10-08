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
3. **Stroke now stages one coherent supine treatment group.** The patient posture, authored support, and room fixture all resolve to the same stretcher. The patient is aligned head-to-pillow and feet-to-foot-end rather than standing beside an unrelated support.
4. **Review UI is excluded from room evidence.** The large portal review panel is hidden only by the room-capture harness; product behavior remains unchanged.
5. **Two corrupt outer garment shells are suppressed precisely.** The current `mpfb-gown-adult-patient.glb` contains a malformed hospital-gown node and a stray lab-coat node that produce cyan shards. The loader hides only those two nodes on that asset and retains the clean fitted T-shirt underlayer. This is a readable fallback, not a hospital-gown rebuild; the asset still needs a properly fitted gown rebake.
6. **Overhead views cover the complete retained scene.** The orthographic camera is placed above the highest retained room object, fits the room footprint, and records its bounds and hidden shell names.
7. **Readable camera promotion is measured.** The solver can promote an already-passing camera only when the replacement also passes, keeps a containment margin of at least 0.08, does not worsen near-camera occlusion, and increases projected actor coverage by at least 1.5×.

## Review artifacts

- `all-rooms-perspective-before-after.png` — each prior learner view beside the final view.
- `all-rooms-overhead.png` — top-down orthographic projection for all 15 rooms.
- `all-rooms-isometric.png` — isometric orthographic projection for all 15 rooms.
- `perspective/`, `overhead/`, and `isometric/` — individual full-resolution captures.
- `capture-manifest.json` — live scene readings and hashes for every retained view.
- `humanoid-repairs/` — final perspective, top-down orthographic, and isometric evidence for Pediatric Asthma, Pediatric Fever, Chest Pain, and Stroke Handoff, with a separate SHA-256 manifest.
- `../staging-solver/comparison/all-rooms-score.json` — before/after scoring and gate result.

## Humanoid repair extension

- **Pediatric Asthma:** removed the bind-relative arm rotations that reversed the child's arms; preserved the authored head cue; removed duplicated case furniture; and moved the shared family chair clear of the exam surface. The retained overhead and isometric views show the three actors separated with the child's arms hanging naturally.
- **Supine patients:** the pose loop now reapplies the closed-loop shoulder solution every frame instead of letting animation restore the raised bind pose. Chest Pain, Pediatric Fever, and Stroke Handoff now remain lengthwise on their supports with heads at the pillow end, feet at the foot end, and arms lowered beside the torso without entering the ribs or rails.
- **Pediatric Fever:** removed stale authored camera and placement overrides that put the parent outside the room. The shared child asset now renders continuously and fits its current clothing, but it is still a general pediatric asset rather than a fever-specific wardrobe.
- **Stroke Handoff:** changed the posture, support instance, and equipment together, then moved the wall clock to a back-wall mounting so its face is readable in the retained isometric view.

The focused captures establish the repaired runtime behavior on these four encounters. They do not establish a new hospital-gown asset or a scenario-specific fever wardrobe; those remain asset-pipeline work.

## Claim boundary

These captures establish browser-rendered room composition and camera framing. They do not establish Quest performance, clinical validity, physical contact quality, or that the malformed gown asset has been repaired. Scenario-owned objects were retained unless the encounter model itself showed they were erroneous.
