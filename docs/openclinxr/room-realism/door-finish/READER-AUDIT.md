# Ward door finish reader audit

The shipped seed-205 ward now carries a finish-depth light casing with a dark
reveal, a light textured vision pane, and full-leaf UV maple facing. This is
desktop learner-runtime evidence only; it is not Quest, clinical, scoring,
production-readiness, or exam-equivalence evidence.

## Runtime measurements

- Pose 04 casing bands are 15 px left, 13 px right, and 15 px at the head.
  Means are 213.86/212.38/210.71, 213.18/211.93/210.09, and
  207.36/205.18/203.34. Every channel is at least four units above its
  crop-verified adjacent wall and no channel exceeds 215.
- The pane mean is 172.06/180.76/175.57 against 169/180/178 (all within
  ±20); standard deviation is 10.219/8.961/9.368 (all at least 6).
- The clean leaf box mean is 195.68/149.84/97.56 against
  190.3/151.5/103.1 (all within ±12). R−B is 98.12 against 87.2 (within
  ±15). The six 2×3-cell standard deviations are recorded in
  `runtime-measurements.json`; every channel in every cell is at least 2.5.
- Ceiling, floor, and wall box deltas against the prior shipped runtime are
  between −0.57 and +1.58 per channel, within the ±3 no-regression gate.

## Reproduction and provenance

Run the package-internal `room_chain/cli.ts --seed 205 --out-dir
.openclinxr/evidence/ward-finish-chain`, install the resulting GLB and rig at
their UI-XR runtime paths, and capture with
`ward-finish-chain-capture.ts` using `hand-placed-poses.json` and no
`STAGE2_CAPTURE_GLB`. `before/` and `after/` manifests both record
`mechanism: ui-xr-runtime-url`; the twelve root sheets are derived from those
pixels and the tracked v2 references.

`ship-ward-provenance.ts` re-read the installed GLB and rig, required them to
equal the chain outputs, and produced `shipped-budget.json` plus the runtime
provenance entry. The shipped GLB is 9,451,868 bytes, SHA-256
`338162bcaa6357297a07edc6ba33e098adc461b1d6caa3e2e42080201b0f9621`,
with 6,533 triangles, 98 primitives, zero material-less primitives, and
49.2983 MiB decoded RGBA including the 1.33× mip allowance (limit 56 MiB).
The rig SHA-256 is
`fe731a6a8afb12b8e938c2ba03c524658a458577285a5302c51fb5863f91659e`.
SC-06 was rerun through its live runtime observer and re-derived
`geom-v1-d983811a-17`, door shift −0.7699999046 m, and board shift
+0.7699999046 m.

The shipped-GLB property test pins the three generated casing nodes ahead of
the measured room-side wall plane, a bright varying glass texture, and
aggregate veneer UV spans of at least 0.99 on both axes.
