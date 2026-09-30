# Ward shipment reader audit

The seed-205 candidate is withheld. Assertions and thresholds are unchanged.
The original runtime GLB and lighting rig are retained. No Quest, clinical,
scoring, production-readiness or exam-equivalence claim is made.

## Reproduction

Run the package-internal `room_chain/cli.ts --seed 205 --out-dir
.openclinxr/evidence/ward-finish-chain`. Temporarily stage that output at the
shipped room path for the material/AO readers. Set `WARD_PROPERTY_GLB` to the
candidate for the two ceiling tests; this changes their input reader only.
The historical synthetic fixture remains the default. Restore the original
runtime GLB and rig after measurement. `verification.json` check `property-tests-after` records all
five tests against the candidate; `verification.json` check `property-measurements` records the
three passing files with explicit measurements and the chain rig installed.

| Test | Reader correction | Candidate result |
| --- | --- | --- |
| every-room-primitive-has-a-material | Register glTF extensions supported by the runtime | 92 primitives, zero without a material. File remains FAIL because its historical no-rewrite clause requires exactly one material-less ward primitive. No geometry/material is removed to satisfy that clause. Other live-graph clauses read the historical probe artifact, not a newly generated runtime probe. |
| a-baked-room-occlusion-map-is-not-the-rooms-own-darkness | Register glTF extensions; read the current baker instead of its retired wrapper | PASS, 7 tests. Four ward AO maps, strengths all 1, sd 56.81–100.63, black fractions 0.03652–0.52001. Brightest non-filler mean 181.78 clears the hand-built 75.02 bound. Wall mean 86.21 (non-filler 59.71) is recorded, not hidden by the per-room brightest-map assertion. |
| the-room-occlusion-box-projects-its-ao-uv | Map `shell_bake_wall` and legacy `openclinxr_finish_wall` to wall meshes; stop requiring a mesh-name substring | FAIL: 33 wall triangles, 0 coplanar UV boundaries, 24 coplanar interior pairs, 3 single-texel triangles. Zero-seam and <=5 single-texel properties pass; unchanged >=30 pair clause fails after simplification. This test invokes box projection, so it proves the projector on candidate geometry, not an audit of untouched exported UVs. |
| the-ceiling-tiles-face-the-room | Correct synthetic box negative-Z winding; allow explicit candidate input | PASS: first hit `openclinxr_ceiling_tiles` at 2.83324 m; shell ceiling behind at 2.92821 m. |
| the-ceiling-tiles-render-at-reference-brightness | Same synthetic winding correction; allow explicit candidate input | Initially FAIL RGB 172.9/170.4/163.5. Chain texture producer baseline reduced uniformly by 14 sRGB units, seed/grain/resolution unchanged. Rebuilt candidate PASS RGB 161.6/159.1/151.5 vs reference 159.7/159.8/154.0 (tolerance 8); sd 4.14/4.15/4.25 (floor 2). |

The ceiling fixture's first two triangles wound its negative-Z box face in
the same direction as its positive-Z face. Blender maps glTF negative Z to
positive Y: no positive-Y-facing polygon remained for `_wall_inner_planes`.
Correcting those two input triangles fixes the missing-face compose error;
loosening compose's closed-shell check would conceal the malformed input.
After composing, the original fixture also left bare slabs; the runtime's
legacy missing-wall repair could not find an eligible plaster donor and
never attached that room. The fixture now authors a dielectric on all shell
primitives before compose, matching the candidate's complete-material input.
`verification.json` check `fixture-tests` records that intermediate timeout; `verification.json` check `fixture-tests-fixed`
records validation after fixing the fixture materials.

The material-count and adjacency-count assertions are contract conflicts,
not reasons to introduce missing materials or extra triangles. Coordinator
resolution is required before all five test files can pass. No assertions
or thresholds were changed to resolve them.

## Size

`ship-ward-budget.ts` derives `budget.json` directly from the generated GLB.
Original candidate: 11,582,136 bytes, SHA-256
`93375b4fad74a36b56268dc3285e60279ebb89d4fee0654996916c0d7e884c82`.
After ceiling fix: 11,582,208 bytes, SHA-256
`c9a1a9e9bbabb8321ba7264c6e6dd250516c4e929acd28ec6e91ab0fff752fec`.
Both pass the 209,715,200-byte soft GLB load cap in
`tools/openclinxr/evidence/infinigen-empty-shell.ts`.
Unique decoded RGBA images with the repo's 1.33 mip multiplier total
64.5933 MiB, exceeding the 56 MiB ward budget by 8.5933 MiB (15.35%).
This is a separate decoded-memory budget, not an encoded GLB size ceiling.
No images were resized or removed.

Largest encoded images: shell floor albedo 3,145,241 bytes; shared shell
normal 1,732,713; shell ceiling albedo 1,117,217; door normal 933,651.
Decoded floor alone is 16 MiB before mips; each 1024-square shell image is
4 MiB. The full per-image census is in `budget.json`.

## Evidence and retained runtime

`before/` contains six standard poses loaded from the UI-XR dev server's
`/xr-assets/environment/infinigen-inpatient-ward.glb` without an asset route
override. The capture harness now defaults to that runtime URL; its manifest
records `mechanism: ui-xr-runtime-url`. Only non-room meshes/UI are hidden.
Original shipped GLB SHA-256 is
`0b568439a46e26093784e439b0229211b507b5c2d6c40ac66a6d23b6a26a77b7`
(2,644,744 bytes); retained rig SHA-256 is
`0e10f5f5bcaf716e74e58232302d3d30249b6807a753b728622677bf51d0a809`.
Chain rig SHA-256 is
`99acc4c3abcbde2428e7914ede6b828875f0229cac5660b8364612a195871dc6`.
No shipped provenance/digest refresh or after/comparison sheets are claimed:
shipment is conditional on all five property test files passing.

## Verification of the non-shipping change

- Full UI-XR suite: 24 files / 191 tests pass with the retained runtime assets.
- `TURBO_CONCURRENCY=1 pnpm packages:test:affected`: 103 tasks pass.
- `pnpm architecture`: 13 tasks pass.
- `pnpm docs:drift-check`: pass; registry rows added by hand.
- `pnpm typecheck:strict`: pass. Factory-stations package typecheck exits 2
  with 934 diagnostics in its existing cross-package/source inclusion graph
  (including TS6307 and TS4111); no diagnostics name the edited test file.
- Default synthetic ceiling fixtures after both input fixes: 2 files / 3
  tests pass, RGB 160.8/158.4/150.9 and sd 4.12/4.14/4.24.
- New candidate: 3/5 property files pass; 2 unchanged historical assertions
  remain red as detailed above. The coordinator explicitly requested a
  commit of reader/chain fixes and before evidence when shipment is blocked.
