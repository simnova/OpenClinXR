# Waist-fit record staleness (2026-09-12)

Record: `tools/openclinxr/evidence/waist-fit-coverage.json` (HEAD `bedd7e32`).
Instrument: `measureWaistFit` / `measureWaistAt`
(`tools/openclinxr/evidence/garments-meet-at-the-waist-measure.ts`),
36 angular buckets, rim fraction 0.12. Recomputed from the shipped GLB bytes
via `pnpm exec tsx tools/openclinxr/evidence/waist-fit-coverage-write.ts`.
Population: library known-good rails + live cast from
`live-scenario-actor-cast.ts` (D1, no hand-typed ids).

## Record vs live bytes

| actor | record overlapMm / gapped / buckets / lower | live overlapMm / gapped / buckets / lower |
|---|---|---|
| mpfb-clinical-nurse-adult | 2.6 / 0 / 36 / scrub_pants | +5.0 / 0 / 36 / scrub_pants |
| mpfb-clinical-physician-adult | 2.6 / 0 / 36 / scrub_pants | +2.7 / 0 / 36 / scrub_pants |
| mpfb-peds-nurse-kevin | 2.6 / 0 / 36 / scrub_pants | +2.8 / 0 / 36 / scrub_pants |
| mpfb-family-partner-adult | 5 / 0 / 35 / cargo_pants | +5.0 / 0 / 32 / cargo_pants |
| mpfb-ob-patient-aisha | 5 / 0 / 36 / cargo_pants | +5.0 / 0 / 25 / cargo_pants |
| mpfb-peds-parent-aisha.motion-bind | 5 / 0 / 36 / cargo_pants | +5.0 / 0 / 32 / cargo_pants |
| mpfb-peds-patient-child | 5 / 0 / 36 / cargo_pants | +5.0 / 0 / 36 / cargo_pants |
| mpfb-street-adult-male | 5 / 0 / 34 / cargo_pants | -16.8 / 4 / 31 / straight_leg_jeans_pants |

Library rails (`body-param-adult_lean_female`, `body-param-adult_heavy_male`)
recompute clean: +5.0 / 0 / 12 and +5.0 / 0 / 16. The gown
(`mpfb-gown-adult-patient`, no lower mesh) stays a declared skip with reason.

## What drifted and why

1. **Nurse (the named defect of card #0).** The record said `gapped: 0` while
   the bytes it was generated from said `gapped: 2`
   (`nurse-waistband-gap-2026-09-12.md`: front buckets 26–27, min −2.6 mm).
   The hem-fix slice `38ff3505` (clothing_consume, withdrew the scrub skip on
   `fit_upper_hem_to_waistband`, pushed 36 verts, 7.65 mm deficit) then moved
   the live nurse to gapped 0 / min +5.0 mm without regenerating the record.
   Stale twice over; the recompute lands the nurse at +5.0 / 0 / 36.
2. **Street.** Shipped lower is now
   `mat_makeclothes_library_straight_leg_jeans_pants` (`e59925fc`), not the
   recorded `cargo_pants`. Live bytes say gapped 4 / min −16.8 mm. Fixing the
   street hem is out of scope here; the record now says what the bytes say.
3. **Bucket counts.** Six cast rows moved (35→32, 36→25, 36→32, 34→31) with no
   GLB change on most — comparable-bucket count shifts with rim-band geometry
   of the shipped bytes, and nothing re-recorded them.

No gate read the record back against the bytes, so every drift sat green.
The new contract
(`the-waist-fit-record-matches-the-shipped-bytes.test.ts`) recomputes every
listed actor from the shipped bytes and refuses on any mismatch, so drift
fails closed. It fails against the pre-recompute record (1 failed, 2 passed)
and passes on the recomputed record (3 passed).

## claimScope / notEvidenceFor

- **claimScope:** the recomputed record vs the shipped GLB bytes as of
  2026-09-12; the drift-guard contract above.
- **notEvidenceFor:** that the street gap is fixed (it is not — gapped 4 is
  recorded, not cleared); any threshold change; visual realism, Quest/WebXR
  readiness, clinical claims.

CLAIM: waist-fit record recomputed from shipped bytes; drift-guard contract
fails on the stale record and passes on the new one.
NOT TESTED: whether any actor other than the adult nurse is stale beyond what
the recompute shows; whether the record's other fields drifted.
