# Waist-meet one-contract report (2026-09-12)

The waist-meet fit was declared twice: `fit_upper_hem_to_waistband` in
`packages/openclinxr/factory-stations/src/body_param/garment_ops.py` (Blender bake
stage, Z-up frame: height is Z, bucket is atan2(-stage_y, stage_x)) and
`applyWaistMeetGlb` in
`tools/openclinxr/asset-pipeline/makeclothes/apply-waist-meet-glb.ts` (post-export
GLB stage, Y-up frame: height is Y, bucket is atan2(glb_z, glb_x)). The three
constants were copied by hand between the two files. A retune of one copy
silently changes which actors meet and which gap, and no gate read the two copies
back against each other.

## One definition

`tools/openclinxr/evidence/humanoid-vetting/waist-meet-contract.ts` is the single
definition both stages use:

| constant | value | meaning |
|---|---|---|
| WAIST_OVERLAP_MARGIN_M | 0.005 | positive overlap target: "several millimetres" (issue-320) |
| WAIST_RIM_FRACTION | 0.12 | fraction of a garment's own height range treated as its rim band |
| WAIST_BUCKETS | 36 | angular buckets around the vertical axis |

The GLB stage imports it directly. The Blender bake stage keeps literal mirrors
(no TS toolchain inside Blender) with a pointer comment at the declaration site.
The agreement test
(`the-two-waist-meet-implementations-agree.test.ts`) fails closed on any drift:
it reads the live Python values via `python3 -c` import and compares them to the
TS contract, refuses a literal copy in the GLB stage, and requires the bake stage
to cite the contract path. The only sanctioned difference between the two
implementations is the axis swap the Y-up export performs.

## Known-good agreement (measured 2026-09-12, `measureWaistFit`, 36 buckets, rim 0.12)

| actor | stage that shipped it | pushedVertexCount | maxDeficitMeters | live gapped | live minMm |
|---|---|---|---|---|---|
| mpfb-clinical-nurse-adult | Blender bake | 36 | 0.00765 | 0 | +5.0 |
| mpfb-street-adult-male | post-export GLB | 38 | 0.02183 | 0 | +5.0 |

The agreement test replays the GLB stage on the pre-fix bytes of both actors
(nurse `20c575c8`: gapped 2 / -2.6 mm; street `303dbdbb`: gapped 4 / -16.8 mm)
and asserts the re-applied output lands at 0 gapped / +5.0 mm — the same result
each actor's own stage produced. No actor was rebaked, no threshold changed, the
street fix is untouched, and the cropped-jeans and boot appearance (which predate
this work) are out of scope.


## Destructive probe (run by the orchestrator, 2026-09-12 07:49)

The worker's note described the test but did not record a probe, so the brief's
clause 3 was carried out here. Only the PYTHON constant was changed; the
TypeScript contract was left alone.

| step | `garment_ops.py:673` | result |
|---|---|---|
| baseline | `WAIST_OVERLAP_MARGIN_M = 0.005` | **6 passed** |
| mutate | `WAIST_OVERLAP_MARGIN_M = 0.006` | **1 failed / 5 passed** |
| revert | `WAIST_OVERLAP_MARGIN_M = 0.005` | **6 passed** |

The test reads the live Python value through `python3 -c` rather than a copied
literal, which is why a one-sided edit fails closed. A test that compared two
copied literals would have passed all three rows.

## NOT TESTED

Whether the two agree on any input other than the two shipped actors; whether
the Y-up and Z-up frames differ anywhere but the axis swap.
