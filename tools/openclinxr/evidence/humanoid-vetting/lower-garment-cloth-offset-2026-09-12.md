# Lower garment cloth_offset (2026-09-12)

Subject: `apps/ui-xr/public/generated-humanoids/mpfb-family-partner-adult.glb`
(10,409,540 B / 39,974 tris after meshopt 0.4). Factory step: `clothing_consume`.

## 1. Call sites (post-fit snap on a LOWER after `ClothesService.fit_clothes_to_human`)

| file:line | when |
|---|---|
| `tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py` covering-library else-branch (was 4590) | LOWER_GATE `covers` for `_COVERING_LIBRARY_LOWER` (scrub / wool / classic / straight-leg / bootcut) |
| `packages/openclinxr/factory-stations/src/body_param/body_class.py:526` (removed) | library-rail else-branch after LOWER_GATE covers |

`cloth_offset` (`garment_coverage.py:1216`) SNAPS every vertex to `nearest_body + CLOTH_STANDOFF_M` (15 mm). `build_cover_shell` still uses 15 mm as construction standoff (shells only). Lab coat uses `cloth_outward_offset` (additive), not the snap.

**Why the production upper does not receive it:** the materializer never calls `cloth_offset` on `garment` (the shirt). `body_class.py:447` still snaps the library-rail upper; that rail is not the live cast. Shipped family-partner shirt p5 1.659 / med 5.527 / p95 11.019 mm (pre-fix) is the proof.

Premise holds. Did not stop.

## 2. Bite (pre-fix live bytes, instrument in the planted test)

```
AssertionError: pants p95-p5 0.569 mm vs shirt 9.079 mm: expected 0.5693886299090103 to be greater than 3.6316561455175087
```

Same-body shirt spread 9.079 mm; pants 0.569 mm (sub-millimetre band at 15 mm). Topology was already bootcut 5,708 tris (not a cover shell).

## 3. Rebake (offset removed for covering-library lowers)

`--reference ed_chest_pain_spouse_adult --actor-role family`. Log: `LOWER_FIT_STANDOFF kept ClothesService positions`; `PANTS_FIT` 3109 verts / 5708 tris; LOWER_GATE covers raycast 0.9362. Then `#695` meshopt `--simplify-ratio 0.4 --simplify-error 0.001 --simplify-only` (91,492 → 39,974) + chest-anchor 0.085 m + CC-BY notice. No lash-lod (family last-shipped lashes were not the nurse 387-tri rung). Nurse / street not rebaked.

Landed instrument (vertex-to-body point-triangle, 0.05 m hash):

| garment | n | min | p5 | p25 | med | p75 | p95 | max | ≤5 mm | p95−p5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| shirt | 5400 | 0.003 | 1.407 | 4.303 | 5.530 | 7.118 | 11.019 | 17.075 | 0.3893 | 9.611 |
| pants (pre, snapped) | 7685 | 0.478 | 14.464 | 14.983 | 15.000 | 15.000 | 15.027 | 15.983 | 0.0195 | 0.563 |
| pants (post, no snap) | 11416 | 0.455 | 3.848 | 6.929 | 10.637 | 14.769 | 51.463 | 90.434 | 0.0983 | 47.616 |

Signed clearance (`garment_coverage.signed_clearance_report`, Y-up, poke ε = 2 mm) — the clipping the offset was preventing:

| slot | samples | pokeCount | pokeFraction | distinct poke verts | worst m |
|---|---:|---:|---:|---:|---:|
| pants (post) | 7362 | 1909 | 0.259 | 911 | −0.0335 |
| shirt (control, never snapped) | 6984 | 2580 | 0.369 | 1164 | −0.0091 |

Pants histogram: 5 samples < −20 mm, 125 in [−20, −5) mm; most pokes are the near-coincident band. Shirt pokeFraction is *higher* than pants. Hide-mask (#326 lower channel) is the poke treatment on both.

## 4. Decision

**Remove** the post-fit `cloth_offset` snap on covering-library lowers. Keep `CLOTH_STANDOFF_M` for `build_cover_shell` only.

Trade-off: drape returns (pants p95−p5 0.57 → 47.6 mm vs shirt 9.6 mm). Interpenetration does not get worse than the same-body shirt's pokeFraction (0.26 vs 0.37). A 15 mm snap was flattening a correctly fitted bootcut onto a constant-offset shell; it was not a per-garment clip fix. Additive `cloth_outward_offset` was not required on this actor.

## Counterweight

| check | result |
|---|---|
| family total tris | 39,974 (plant 38,657, window ±1500; meshopt 0.4) |
| family lower | 5,708 tris bootcut (faces×2) |
| nurse total | 38,958 unchanged |
| street lower | 5,708 unchanged |
| waist family | gapped 0 / min +5.0 mm / 32 buckets |
| waist nurse | gapped 0 / min +5.0 mm |
| waist street | gapped 0 / min +5.0 mm |
| capture | `docs/openclinxr/humanoid-vetting-captures/mpfb-family-partner-adult-front_lit.png` (2,522,372 B; isolated-grade `model-vetting-glb-grade-capture.ts`; orchestrator grades pixels) |

## claimScope / notEvidenceFor

- **claimScope:** covering-library lowers keep ClothesService standoff; family-partner rebake numbers above; nurse/street not rebaked.
- **notEvidenceFor:** visual realism, Quest/WebXR readiness, clinical claims, other actors, whether a per-garment additive gap would cut the −33 mm tail.

CLAIM: covering-library post-fit `cloth_offset` snap removed; family-partner pants p95−p5 0.569 mm → 47.616 mm against same-body shirt 9.611 mm; pokeFraction 0.259 vs shirt 0.369; lower 5,708 tris; waist 0 gapped / +5.0 mm.
NOT TESTED: how much of the −33 mm tail hide-mask conceals in the renderer; whether uppers on the library rail (`body_class.py:447`) should also drop the snap; the other actors; a per-garment additive gap.
