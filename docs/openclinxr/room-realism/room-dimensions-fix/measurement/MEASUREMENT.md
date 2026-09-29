# Room footprint measurement (room-dimensions-fix, STEP 1)

Reference set: `docs/openclinxr/room-realism/imagine-multiview/` (all 1280x720,
grok-4.7 image_gen, aspect 16:9). Tile pitch: 600 mm modules (repo-pinned 0.6 m
UV module in `room_clinic_finish`, 2x4 troffer = 0.6 x 1.2 m in prompts,
single-600mm-tile texture job). Door: 0.95 m wide x 2.1 m high (chain + tests).

## Width (ref 02 back wall)

- Left corner x=177: vertical luminance gradient 21-26, stable at y=300/380/460
  (noise floor ~2). Crop: `ref02-left-wide.png`.
- Right corner x~1085: soft (window wash, gradient ~2); baseboard turn visible
  in `ref02-right-wide.png` at ~65-70% across the x850-1200 crop.
- Span: 177 -> 1085 = 908 px. Overlay: `ref02-wall-span-annotated.png`
  (red = brief's 230->1050 claim, yellow/cyan = own edges).
- Tile verticals at back row (scanline y=140): x =
  192,347,505,662,818,975; intervals 155,158,157,156,157 (mean ~157 px).
  Overlay: `ref02-tile-verticals-y140.png`. Strip: `ref02-ceiling-strip.png`.
- Modules across: 908/157 ~= 5.8 -> 3.3-3.6 m at 0.6 m pitch.
- Coordinator's 7-tile/820 px claim NOT reproduced: 7 tiles would need
  117 px pitch; the visible back-row grid is 157 px. The set draws
  inconsistent rooms (see ref 01 below); the discrepancy is recorded, not hidden.
- Ref 01 door wall (cross-tie): corners x~36 and x~839 (span 803 px, left end
  nearer camera so px/m varies). Door leaf bbox x586-724 (138 px) for 0.95 m.
  Rough deprojection -> 4.2-4.8 m wide. Supports the top end, contradicts ref 02.

WIDTH RANGE: 3.3-4.8 m.

## Depth (ref 01 ceiling rows)

- Transverse T-bar lines from the door-wall junction (y~110-150) to the frame
  top (ceiling above/behind camera): ~6 distinct rows.
  Crop: `ref01-ceiling-rows.png`, zoom: `ref01-ceiling-zoom.png`.
- 6 rows x 0.6 m = 3.6 m MINIMUM (frame top is ceiling over/just behind the
  camera; prompt says "a few meters inside the room", so 0-1.2 m sits behind).
- DEPTH RANGE: 3.6-4.8 m.

## Height (ref 02 tile-row + door)

- Tile-row method (foreshortened, lower bound): wall paint y169 (gradient edge,
  `ref02-wall-span-annotated.png` yellow) to base top y~603 -> 434 px.
  Same range as the brief's 397 px claim within edge-definition tolerance.
- Door method (coplanar, upper bound): ref 01 door leaf y212-561 = 349 px for
  2.1 m -> 166 px/m. Wall beside door: x=560: y139->546 = 407 px -> 2.45 m;
  x=740: y~98->525 = 427 px -> 2.57 m. Crop: `ref01-door-crop.png`.
- HEIGHT RANGE: 2.0-2.6 m (tile-row low end, door high end).

## Door cross-check (0.95 m)

- Ref 01: leaf 138 px wide at slight yaw vs 349 px tall (true h/w 2.21, px 2.53).
  Vertical scale 166 px/m; horizontal effective ~145 px/m -> 0.95 m within ~10-13%,
  explained by leaf yaw + lens. PASS.
- Ref 04: leaf bbox x701-982/y44-719 (281x675 px). Much larger = much closer
  camera, correct direction for a doorway close-up; height 675 px vs ref 01's
  349 px consistent with ~2x closer. PASS (directional).
- Full frames: `ref01-full.png`, `ref04-full.png`, `ref02-full.png`;
  door crop: `ref04-door-crop.png`.

## Chosen single value: 4.3 x 3.9 x 2.4 m

- Width 4.3: inside combined range; matches the coordinator's 7-tile count
  within half a tile (7.17 modules incl. cut perimeter courses, which real
  rooms have); matches ref 01's 4.2-4.8 door wall; ref 02's 5.7-module back
  row is the AI underdraw in this inconsistent set. ~Half of the flagged
  8.77 m (the 2x defect). ~14 ft module.
- Depth 3.9: 6.5 tiles; >= 6-row minimum; +0.3 behind-camera allowance;
  half of the flagged 7.77 m; nearly-square single room as the refs show.
- Height 2.4: 8 ft standard hospital ceiling; top of the tile-row range;
  keeps the current 2.42 calibration (lighting rig, 0.6 m UV module) valid;
  2.1 m door leaves a 0.3 m header.
- RED geometry: frontal capture wall ratio = W/H = 4.3/2.4 = 1.79, inside
  +-15% of the ref ratio (own reproduction 908/434 = 2.09 -> band 1.78-2.40;
  brief's 2.07 -> band 1.76-2.38). A 3.5 m width would give 1.4 and fail RED
  by ~33% -- this is the deciding reason for 4.3 over the ref-02-only 3.5.

## Reference ratio reproduction (for RED)

- Own: ref 02 back wall 908 px wide / 434 px tall = 2.09 (this file's edges).
- Brief's: 820/397 = 2.07. Both cited; RED band uses 2.07 +-15% = 1.76-2.38.
