# primary_care zero median — sampling artifact, not a missing render

Instrument-only. Does not recalibrate floors/ceilings. Does not grade the frame.

- station: `primary_care_dyslipidemia_joint_pain_v1`
- tracked sweep row: `tools/openclinxr/evidence/station-luminance-sweep.json` median **0**, stamp `ec5cbd42`
- graded table: `the-luminance-gate-only-claims-what-it-can-see.test.ts` header — primary_care post-#638 median **23** GOOD
- known-good bank: 14/15 stations in that JSON are non-zero; floor 10 is derived from that bank (darkest graded-good render 23)

## Verdict

**Sampling artifact.** The 0 is the 50th percentile of a mixed viewport, not a uniform black frame (a render that did not happen).

## Why median 0 is not “did not render”

1. The sweep writer stores only median (`station-luminance-sweep.ts:75`: `stations[scenarioId] = { median: lum.median }`). `regionLuminance` also returns mean, sd, p90, nonBlackPct (`lib/png-region-luminance.ts:29-42`). Those fields are discarded, so a 0 cannot be classified as uniform-black vs half-black. `classifyCaptureFrame` (`:228-232`) uses sd ≤ `UNIFORM_SD_CEILING` 9.22 for “rendered nothing”; the sweep never records sd.

2. Same-station tracked PNG, measured 2026-09-12 through that same reader, sweep region `{left:0, top:70/900, width:1005/1440, height:750/900}`, step 6:

   | source | w×h | samples | median | mean | sd | p90 | nonBlackPct | luma-0 share | classify.uniform |
   |---|---|---|---|---|---|---|---|---|---|
   | `room-primitive-material-probe/primary-care-interior.png` | 1007×900 | 14625 | **23** | 40.0 | 60.3 | 99 | 62.3 | **34.77%** | false (sd 61.3) |

   34.77% of sweep-region samples are luma 0; 62.23% are >12. Median is 23 because the black mass is under 50%. A 15-point shift of that mass (camera a little deeper into the unlit interior already visible in the PNG) flips median 23 → 0 while figures, ceiling, and HUD still render. That is the sampling path.

3. Same boot as the 0: the other fourteen stations in `station-luminance-sweep.json` are non-zero (15–181). The renderer produced frames for the rest of the bank. A process-wide failed render does not fit.

4. Reproduced non-zero samples for this station, never 0: `sweep-determinism-report.json` sweep `[23,23,23,17,16]`, per-station `[17,21,23,21,23]`; `fallbackCameraFired: false`; camera `roomCam(derived)=3.01,<Y>,2.44` every sample. #505 FIXED header: 0.0 in the floor table did not reproduce (pre-#503 21/12/23, post 21/23/13/16/17).

5. Where the 0 was written: commit `526318e7` (2026-08-26, #644 re-run at 8911a94c) replaced median 16 with 0. The luminance-gate header’s 23 is a different capture of the same station (93ab4fe6, sweep path, graded GOOD). Two real renders, one 50th-percentile of 0.

6. The gate’s own clause (2) uses `expect(dark).toBeTruthy()` (`the-luminance-gate-only-claims-what-it-can-see.test.ts:92`). JavaScript treats median 0 as missing, so a sampling 0 is indistinguishable from an absent row. That is the same instrument class: median-only, truthy check, no sd.

## Failed treatment (do not repeat)

Recalibrating the floor of 10, or any per-station band, from this 0. Named in the luminance-gate header: the metric is already measured blind (23 GOOD, 83 BAD, 84 GOOD, 118 BAD). This 0 is not a new darkness of the room.

claimScope: why this one station’s tracked median is 0 while a graded capture of the same station is 23.
notEvidenceFor: how the frame looks; the other fourteen stations; whether a later sweep would still write 0; floors/ceilings.

CLAIM: the primary_care median 0 is a sampling artifact of a median-only region read over a mixed viewport (34.77% luma-0 on a frame that still measures median 23, sd 60, uniform=false); it is not a render that did not happen.
NOT TESTED: whether any other station’s recorded median has drifted since ec5cbd42; the discarded 526318e7 screenshot bytes (the sweep does not keep PNGs).
