# Geometric eye record

Slice log for the G0-G6 series (scope: `geometric-eye-scope.md` in the
`eye-iris-A` workstream). Numbers SSOT:
`tools/openclinxr/evidence/realism-head/eyes/geometric-eye-numbers.json`.

## G0 — numbers lock (2026-10-22, worktree `eye-geo`)

Method: read-only GLB census on the shipped bake
(`aisha-lidconform.glb`, store `lid-conform/`; lids+globe verified identical
to the F-bake by the eye-finish audit cross-check — the F-bake GLB itself is
unrecoverable, `/tmp` scratch gone). Two scripts, uncommitted scratch in
`$TMPDIR` (`g0_census_221001.py`, `g0_iris_221002.py`, `g0_lid_221003.py`):
best-fit-sphere fits + UV-radius ring interpolation with 3D circle fits.

### (1) Shell bias: POLE-BIASED (uniform +3% REFUTED as a description)

- Globe R 11.904 (L/R agree to 0.0001), shell R 12.239 (ratio 1.028).
- Shell centre shifted **+0.95mm forward** (+z; x/y deltas <0.004).
- Shell pole stands **+1.91mm proud of the globe best-fit sphere**
  (+2.19mm beyond the globe pole vert). A concentric +3% scale predicts
  0.36mm pole lift; measured is 5.3x that.
- The `--eye-asset` help-text "+12% cornea bulge at the front pole" is the
  closer characterization (pole radial excess ~16%); its exact definition is
  unknown (no formula), so it is recorded as approximately consistent, not
  verified. G0 gate (shell-pole within 0.2 of a claimed value): 1.91 vs the
  audit's apex range 1.3–1.9 — within 0.2 of the upper end. PASS.

### (2) Target anatomy (each cited in the JSON)

Cornea Ø ~11.5 (Wikipedia Cornea), globe Ø 24 (Wikipedia Human eye;
Bekerman 2014), ACD 3.0 avg / 1.5–4.0 range (Wikipedia Anterior chamber),
photopic pupil 1.5–4mm (Wikipedia Pupil), fissure norms PMC13161299 /
PubMed 18349663 / PMC3562989 (via in-repo any-subject-report). Cap r 7.8,
protrusion 0.5, iris Ø 10.5–11.5 carried from scope/audit — primary sources
NOT verified this slice (G1 must cite before building).

### (3) Current-model re-verification (from the bake, not on trust)

| Audit claim | Re-measured | Verdict |
|---|---|---|
| iris Ø 10.26 | **10.807** (L 10.804 / R 10.809, rms 0.06; identical on compat-eyes Oct-21 GLB) | DOES NOT REPRODUCE (delta 0.55). Audit deviation #2 EVAPORATES — 10.807 passes [10.5, 11.5]. G2 must NOT apply the audit's +4–5% limbus rescale (would overshoot to ~11.3). |
| pupil/iris 0.315 (pupil 3.23–3.24) | 0.307 (pupil 3.32) | approx (delta 0.008/0.09) |
| chamber 2.45 | 2.54 (apex 140.267 − iris plane 137.73) | approx (delta 0.09); gap to 3.0 target stands |
| fissure 27.009 / height 11.067 | 27.009 / 11.067 exact | REPRODUCES |
| globe R 11.904 / shell 12.24 | 11.904 / 12.239 | REPRODUCES (shell within 0.001 of audit; generator mesh-decision says 12.2 — 0.04 method delta, noted) |
| lid overlaps L 0.79 / R 1.07 | cheap method gives 2.43/1.99 (catches fold, not margin) | NOT re-derived; audit values retained as cited, re-measure gated in G3 |

### Counterweight (closure): the (R 11.9, r 7.8, p 0.5) triple does NOT close

A 7.8mm cap with 0.5mm apex protrusion on the 11.9mm globe seats a limbus
opening of Ø **8.7** — narrower than the iris disc (Ø 10.8). Holding WTW
11.5 with r 7.8 on R 11.9 fixes protrusion at **~1.05mm**, matching real
anatomy (corneal sagitta ~2.5 over the same chord exceeds scleral sagitta by
~1.0). So the scope's 0.5mm protrusion is inconsistent with its own 7.8/11.5
companions. G1 must resolve: (a) p≈1.05 with r7.8/WTW11.5, or (b) keep p0.5
with a smaller opening. Do NOT build r7.8+p0.5+iris10.3.

### G1 handoff

Build the cap with p≈1.05 (option a) unless a primary source for 0.5
surfaces; iris disc Ø 10.8 (measured, not 10.26); chamber target 3.0 from
apex 12.95 → iris plane at apex−3. G2 drops the +4–5% limbus rescale.

NOT TESTED: any render grade (per G0 done_when).

## G1 — params-lock (2026-10-22, worktree `eye-geo`; NO mesh)

G0 tension resolved as **option (a)**: r 7.8 + WTW 11.5 fixes p = **1.05mm**
(two-sphere intersection re-derived independently this slice: p0.5 seats
Ø 8.685, p1.05 seats Ø 11.507; delta 0.007 vs WTW).
Option (b) (keep p0.5, opening 8.69) REJECTED: opening < iris Ø 10.807 would
bury the iris periphery behind the limbus. Third alternative checked and
rejected: holding p0.5 + WTW 11.5 needs r≈6.1, off the Gullstrand 7.8 value.

Settled set (globe-centre coords, +z anterior): R 11.9, r 7.8, p 1.05,
apex 12.95, limbus ring z 10.417 (Ø 11.507), ACD 3.0 → iris plane 9.949
(0.47 behind limbus plane), iris Ø 10.807 (1.13 inside sclera at that plane).
Params: `geometric-eye-g1-params.json` (every number traces to a
`geometric-eye-numbers.json` entry). Gate: `geometric-eye-g1-gate.py` —
8/8 GREEN (re-derives from first principles; refuses WTW-only closure,
iris-outside-sclera, iris-ahead-of-limbus, and limbus-rescale passes).

No construction spike: scope option (c) is conditional on needing visual
confirmation of the numbers; closure is analytic (gate proves it), so no
Blender work. Build arm (`--eye-anterior`, Aisha) inherits scope G1
done_when: census within 5% of the params file + seam invisible on a
native-res EEVEE capture (counterweight carried, NOT discharged here).

NOT TESTED: mesh census, seam grade, EEVEE captures, lids/lashes/gaze.
