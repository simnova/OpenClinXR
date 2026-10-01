# Ward floor cast reader audit

The shipped seed-205 ward keeps the finished door and replaces only the
procedural vinyl tile albedo with a runtime-calibrated neutral baseline. This
is desktop learner-runtime evidence only; it is not Quest, clinical, scoring,
production-readiness, or exam-equivalence evidence.

## Runtime measurements

- Pose 01 floor mean is 211.60/206.51/206.13 against
  198.18/196.13/190.01. Its R−B is 5.47 against 8.17, within ±4. The three
  channel means miss ±8 by +13.42/+10.38/+16.12; this is the accepted
  lighting-falloff exception for the darker pose-01 reference.
- Pose 02 floor mean is 215.70/210.54/209.85 against
  214.51/213.52/209.02 (deltas +1.19/−2.98/+0.83, all within ±8). R−B is
  5.85 against 5.49 (delta +0.36, within ±4).
- Pose 06 floor mean is 212.64/207.57/207.01 against
  204.96/204.96/202.92 (deltas +7.68/+2.61/+4.09, all within ±8). R−B is
  5.63 against 2.04 (delta +3.59, within ±4).
- Against `door-finish/runtime-measurements.json`, both ceiling-tile boxes,
  the wall, both troffer boxes, door glass, door leaf, and all three casing
  boxes move by at most 2.52 per channel. Every ±3 no-regression check is
  recorded in `runtime-measurements.json` and passes.

## Reproduction and provenance

Run the package-internal `room_chain/cli.ts --seed 205 --out-dir
.openclinxr/evidence/ward-finish-chain`, install the resulting GLB and rig at
their UI-XR runtime paths, and capture with `ward-finish-chain-capture.ts`
using `hand-placed-poses.json` and no `STAGE2_CAPTURE_GLB`. Both manifests
record `mechanism: ui-xr-runtime-url`; the twelve root sheets are derived from
those pixels and the tracked v2 references.

`ship-ward-provenance.ts` re-read the installed GLB and rig, required them to
equal the chain outputs, and produced `shipped-budget.json` plus the runtime
provenance entry. The shipped GLB is 9,218,804 bytes, SHA-256
`a25fc5680a64d7c73c6732eda76e968dd82d3594404c6b64ac2258f0847bffac`,
with 4,007 triangles, 109 primitives, zero material-less primitives, and
49.2983 MiB decoded RGBA including the 1.33× mip allowance (limit 56 MiB).
The rig SHA-256 is
`a0391d4eefc7bb5c019dedda7e4b406c357afba02f8c10249bc9cec461569ff6`.
SC-06 was rerun through its live runtime observer and re-derived
`geom-v1-d983811a-17`, door shift −0.7699999046 m, and board shift
+0.7699999046 m.

The deterministic generator retains seed 21, grain, chips, seams, derived
normal, and roughness. Its baseline changes from 177.7/176.5/170.9 to
177.0/176.5/184.9; the normal was regenerated from albedo luminance but is
byte-identical because the baseline shift does not change spatial gradients.
