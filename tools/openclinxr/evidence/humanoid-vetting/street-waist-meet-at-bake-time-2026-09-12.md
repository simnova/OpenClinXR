# Street waist-meet at bake time (2026-09-12)

Subject: rebake of `mpfb-street-adult-male` through
`materialize_mpfb_humanoid_candidate.py --reference adult_male_street_casual
--actor-role patient` (street skip on `fit_upper_hem_to_waistband` already
withdrawn). Bake wrote a job-tmp GLB; **the shipped file was not replaced**.

Factory step: `clothing_consume`. Operator 2026-09-12: fit in MakeHuman BODY
SPACE while hm08 + mhclo bindings address real vertex indices. Not an overlay
on exported glTF.

## Bake log

`WAIST_MEET_UPPER {'enabled': True, 'pushedVertexCount': 48, 'maxDeficitMeters': 0.03139, 'marginMeters': 0.005, 'note': 'hem pushed down to the lower garment waistband rim (issue-320, derived)'}`

Lower: `makeclothes_library_straight_leg_jeans_pants` (elvs_jeans_straight_leg
2,854 faces → 5,708 tris, LOWER GATE covers raycast 0.9886). Cover-shell
`band_hi` not raised. Rim regularize skipped (covering library mesh).

Postopt: HB-03 exception is `raw` (not decimated). No meshopt / lash LOD.
Triangle count of the bake GLB: **115552** — reproduces the shipped HB-03
count exactly.

## measureWaistFit WITHOUT apply-waist-meet-glb.ts

36 buckets, rim 0.12, bake-time GLB only:

| field | value |
|---|---|
| gapped | 1 |
| minMm | -22.08 |
| buckets | 34 |
| triangles | 115552 |
| jeans tris | 5708 |

| field | bake-time (not shipped) | live shipped (post-export GLB, unchanged) |
|---|---|---|
| triangles | **115552** | 115552 |
| jeans tris | **5708** | 5708 |
| lower | straight_leg_jeans_pants | straight_leg_jeans_pants |
| gapped | **1** | 0 |
| buckets | 34 | 31 |
| minMm | **-22.08** | +5.0 |
| medianMm | 5 | +5.0 |

STOP: bake alone does not reach 0 gapped / +5.0 mm. A post-export vertex push
is not applied to hide the shortfall. Live bytes stay the 2026-09-12 GLB-stage
ship (38 verts, maxDeficit 21.83 mm).

Nurse counterweight: 38,958 triangles / 0 gapped / +5.0 mm untouched.
`waist-meet-contract.ts` and the two-implementation agreement test stay.

## Isolated-grade capture (bake-time GLB, not shipped)

`pnpm asset:model-vetting:glb-grade --glb <bake-time glb>` three.js 4096².
selfCheck agrees, relErr 0.00025. Fresh front_lit (orchestrator grades pixels):
`tools/openclinxr/evidence/humanoid-vetting/street-waist-meet-at-bake-time-2026-09-12-front_lit.png`.
Shipped captures under `docs/openclinxr/humanoid-vetting-captures/` are unchanged.

## Production callers of apply-waist-meet-glb.ts

Zero from the bake path (`materialize_mpfb_humanoid_candidate.py` does not
import it). One live production *result*: the shipped street GLB, recorded as
`waistMeet.stage = post_export_glb`. The agreement test calls
`applyWaistMeetGlb` on pre-fix bytes as a diagnostic. **Recommend: keep as a
diagnostic; do not delete in this card.**

## Allow-list fence

`the-waist-meet-runs-at-bake-time-not-after-export.test.ts` asserts the set of
actors whose provenance `waistMeet.stage === "post_export_glb"` is a subset of
`["mpfb-street-adult-male"]`, frozen (length 1). Growth fails closed.

## Destructive probe (this worktree)

Fake actor added to the recorded set (not the allow-list): wrote
`apps/ui-xr/public/generated-humanoids/mpfb-fake-waist-meet.provenance.json`
with `waistMeet.stage = "post_export_glb"`, ran the test, reverted.

| step | recorded set | result |
|---|---|---|
| baseline | `[mpfb-street-adult-male]` | **4 passed** |
| add fake | `[mpfb-fake-waist-meet, mpfb-street-adult-male]` | **1 failed / 3 passed** (allow-list subset) |
| revert | `[mpfb-street-adult-male]` | **4 passed** |

Probe stdout:

```
baseline:  Test Files  1 passed (1)   Tests  4 passed (4)
add fake:  Test Files  1 failed (1)   Tests  1 failed | 3 passed (4)
           AssertionError: provenance recorded a post-export waist-meet for an actor not on the allow-list:
           expected [ 'mpfb-fake-waist-meet' ] to deeply equal []
revert:    Test Files  1 passed (1)   Tests  4 passed (4)
```

Fake file removed from generated-humanoids.

## claimScope / notEvidenceFor

- **claimScope:** this bake-time measurement of mpfb-street-adult-male, the
  frozen post-export allow-list, and the decision not to ship the shortfall.
- **notEvidenceFor:** visual realism, Quest/WebXR readiness, clinical claims,
  that another actor needs the GLB path, that a later bake cannot close the
  remaining bucket.

CLAIM: bake-time fit ran in hm08 space (48 verts, 31.39 mm deficit) and
reproduced 115,552 tris / 5,708 jeans tris; measure without GLB push is
gapped 1 / min -22.08 mm; live shipped bytes unchanged; post-export allow-list
frozen at street only.
NOT TESTED: whether a full street rebake of the *shipped* file would match
triangle count after chest-anchor/albedo stages; whether any other actor
would need the post-export path; the cover-shell actors.
