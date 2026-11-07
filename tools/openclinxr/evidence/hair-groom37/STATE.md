# groom37 STATE (evidence dir; store .npz NOT in git)

Goal (one line): routed-only re-blend for children whose blended path
enters the 3 mm ear shell; no clumping, no position moves added.

DONE:
- Flag `--shell-routed-only` + `--ear-proxy` in
  hair-groom/strands/interp_children.py (default OFF; guarded block
  after far-snap; rerouted mask saved as `rerouted`; `shellRoutedOnly`
  in build.json). Routed set = guides-file `route` (60 guides).
- build-37 sha eeae8267 (269480 children): rerouted 738 +x / 732 -x
  (1470, 0.55%); gap-fallback 1468; far-snap-routed 20. Recipe
  fidelity vs build-36: all non-reroute build.json sections identical
  (poolDrop 16, gapGate 50290/344805, farSnap 8468, counts).
- 3D gates (gates-37.json): shell segs +x 1356 (was 2134, -36%) /
  -x 1287 (was 2043, -37%) FAIL; column 53/56 UNCHANGED FAIL;
  concha 0/0/0 PASS; insideBody 0 PASS; gt30 2907 (was 2970) FAIL.
- residual-37.json: remaining shell strands 727/645; rerouted-still-in
  183/120 (domW p50 1.0 = alone on routed guide); never-rerouted
  544/525 (domW p50 0.6); top feeders now 541/422 (+x), 1916/1797
  (-x) — 1264/2639 (orig 2507) gone from top-8. Column strands: 0
  rerouted (blend paths never entered shell), backbones unchanged.
- flyaway-37.json: literal predicate n=76878/77053 (+x/-x, groom36) /
  76405/76583 (groom37); 99% blend-created both. NOTE: literal
  predicate captures the whole front curtain mass; render-CC check on
  ear crops pending for the isolated-strand reading.
- cross37: 1029 (guides-level, identical). calib37: delta 0 PASS.
- Drivers in E37 (import, no copy): run_gates37, residual37,
  run_cross37, run_grad37, flyaway37, make_sheet37, ears37.

ON DISK: store/hair-groom37/{build-37/,build-37det(running)};
E/hair-groom37/ (drivers, gates-37.json, residual-37.json,
flyaway-37.json, metrics-cross37.json, calib37.log, render chain
running pid 57845, render37-chain.log).

NEXT: 1) det sha check (build-37det.log tail). 2) render chain
completion (render37-chain.log ALLDONE). 3) full gates with renders,
iou35 CLI (renders-37), run_grad37, sheet, ears, render-CC flyaway
check, RESULT.txt, DONE.txt, SHA256SUMS, commit.
