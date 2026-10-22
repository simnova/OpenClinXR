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

## G2 — build + texture remap (2026-10-22, worktree `eye-geo`)

Built, not spiked: `geometric-eye-g2-build.py` authors the full anterior
segment in eye-local globe-centre coords (+z anterior, mm) — scleral sphere
R 11.9 with limbus opening, corneal cap r 7.8 (apex 12.95, p 1.05), planar
iris disc Ø 10.807 at apex−3.0 = 9.949 — weighted eye.L/R (all verts 1.0 on
own side joint, joints identity at globe centre so the gaze pivot stays at
the scleral centre). Ring derived from first principles (two-sphere
intersection), asserted within 0.01 of the params file; rim verts
bit-coincident (dev 0.0), rim normals shared (dev 0.0) → zero shading seam.
Gate: `geometric-eye-g2-gate.py` re-derives everything from the shipped
GLB/PNGs/render (never trusts the build report) — GREEN.

Texture remap: gen-candidate-A annulus (38<r<99.5, frozen pupil/limbus)
ported onto 207² planar disc PNGs (odd size so texel centres hit source
pixels exactly). Annulus byte-mismatch vs the independent candidate-A
artifact: **0** (verbatim port, same seeds/base/grid). Frozen ring vs base:
byte-exact. Piecewise-linear radial UV (pupil edge 38px↔1.66mm, disc edge
99.5px↔5.4035mm) → annulus internally linear (zero distortion).
Limbus-stretch bound (uniform sphere-arc vs uniform disc-chord between
identical endpoints): mid-annulus dev **0.82 src-px ≤ 1px** — PASS.

Render: EEVEE front ortho (`geometric-eye-g2-sheet.py`; camera-side framing
— object rotation has no effect on matrix_world in background Blender 5.1,
recorded). Iris centroid (511.5,511.6) vs frame centre, visible dia 10.752
vs 10.807 (−0.5%), rim closed (min 76, gap would read 0), sclera smooth
(max step 1.1). Limbal highlight peak 197 (cap specular at the 18.6° crease
— physical, carried to the G5 cornea-env re-tune). Sheet
`geometric-eye-g2-sheet.png` grades the new eye against the prior crop:
same texels, no seam, no regression (render reads darker — EEVEE shading on
dark albedo vs unshaded texture; exposure re-tune is G5 scope).

Outputs: `geometric-eye-anterior.glb` (6 meshes, 2 joints, embedded disc
PNGs), `geometric-eye-iris-disc-{L,R}.png`, `geometric-eye-g2-report.json`,
`geometric-eye-g2-manifest.json` + vitest
(`the-geometric-iris-disc-holds-centre-and-limbus.test.ts`, 5/5).

Adapted with reason: roughness numeral re-target + readback deferred
(needs eye-shader plumbing; UV rects documented in manifest) — recorded in
report not_tested, NOT silently dropped. Lid/lash/gaze/compat are G3–G5.

NOT TESTED: lid interaction, second subject (G6), Quest.

## G3 — lid re-fit + seal (2026-10-22, worktree `eye-geo`)

GLB-space H1-SEAT re-run against the G1 profile (Aisha, `aisha-lidconform.glb`
read-only, sha `96c13f02…`; widen NOT re-applied — already embodied at
27.009mm, re-widening would double-apply H1). Ring1 derived topologically on
the bake itself (56 verts/side, matches conform `baseRing1`); no base-GLB
fallback needed. Scripts: `geometric-eye-g3-seal.py` (measure + refit) →
`geometric-eye-g3-gate.py` (independent re-derivation, GREEN) → vitest
(`the-g3-lid-refit-seals-the-new-profile`, 5/5; G2 suite still 5/5).

Old surface re-derived on THIS bake (trusts no carried number): globe
R 11.9042/11.9043, shell R 12.2394/12.2378 offset +0.950/+0.953 — reproduces
G0 exactly. New surface never proud of old (dense-sample max excess −0.004mm)
→ the seal can only tighten; socket show-through cannot increase.

Seat (gap-adaptive, Aisha row 1.5/0.5/0.5): 24/56 verts moved per side
(32 flesh, gw=0), max 0.25mm. Margin sits near the rim-coincidence circle
(old≈new there), so travel is small by construction, not by refusal.

Seal (measured, both sides): closure-pose seal-band min gap −0.029mm post
(50µm tolerance; baseline vs OLD surface −0.52 — strictly better, and the
closed-lid gap did not float: ring mean 1.96 vs 2.05 pre). Slit-band min
−0.000/+0.000. Occlusion (rays front→eye vs lid patch): closure 1.00,
both-closure 1.00, slit 0.83 pre AND post; bind 0.46 (open eye, expected).
Full near-eye set (≤25mm) no-regression vs old baseline in every pose
(closure −0.59 vs −1.32, slit −1.33 vs −1.76). Morph deltas bit-invariant
(max drift 0.0 — same disp on basis + all 47 targets). EEVEE ortho sheet:
bind (iris/limbus/lashes over new anterior), closure L+R (lids meet, no globe
shows), slit (pupil band); sagittal midline section old-shell vs new-cap.

Aperture: fissure 27.009 × 10.871 post (baseline 27.009 × 11.067 — width
exact, height into the ≤11.0 audit band). Lower edge +0.21 above new limbus
bottom (audit yardstick ±0.3, PASS).

Overlap — rank-1 NOT closed, truthfully carried forward: midline-margin
station 0.29 → 0.38mm post (edge interpolated at pupil meridian vs true iris
top C_y+5.4035). The audit's own edge station (1550.30 + true iris top) reads
1.26 — in [1,2] — so the gate boundary sits INSIDE the station uncertainty
(±1mm between defensible stations; margin arc descends laterally). Mechanical
reason: the re-seat preserves the 0.5 tear-film offset, and the margin lives
at rim coincidence where old≈new (seat ≤0.25mm there). Closing rank-1 needs a
lid-bias/offset change — a seal tradeoff + blink-rig change (G4/G5 scope, owner
call) — NOT a deeper H1 seat. Seating to offset 0 would trade the −0.03 graze
for ~−0.8 poke-through; refused (scope counterweight: no cheapest pass).

Diagnostics carried: slit lower-lid tuck −1.33 (pre-existing morph overshoot,
old −1.76, improved by geometry; re-authoring is G4+ scope). Lash mesh in THIS
bake has 0 morph targets (static; T2b/A3 re-seat lives on the eye-finish
lineage) — mesh untouched, recorded. Compat-eyes suite
(`the-compat-report-names-the-producer-manifests`, 2 fails) is RED on this
worktree's HEAD from a materialize.py/store-sheet sha drift predating G3 —
untouched by this slice (bake sha-verified, no producer source moved); re-pin
only, not re-run. Gaze pivot bookkeeping unchanged (no joints added; G2
anterior joints stay identity at the scleral centre).

NOT TESTED: lash re-seat + blinkFollow (G4), gaze/compat re-run (suites run on
the untouched shipped bake), second subject (G6), Quest.

## G4 — lash re-seat + T2b/A3 re-measure (2026-10-22, worktree `eye-geo`)

Method: bake + G3 refit displacements -> scratch post-refit GLB in $TMPDIR
(skinning at bind is identity to ~2um, so head-frame DV applies directly to
body-prim0 bind POSITION; morph-target displacement arrays left
byte-identical, deltas invariant by construction). Then the real
`lash_blink_follow.py` (T2b+A3) on the post-refit profile, `--measure`,
same-frame Blender ortho A/B (200mm, eye height) pre vs post T2b.

- T2b: L keep 461/470 (98.1%), R 446/454 (98.2%) — both >=95%; every kept
  lower card within its loop MAD bars. R dash-zone [0.028,0.035]: 3 dropped
  (RED still fires on the new profile). Tris 16632->16326 (-1.8%; thinned,
  not hidden — counterweight honored, 13 meshes in both renders).
- A3: nn mean 2.38/2.45mm, max 6.9/6.7mm; moving donor pool 935/935,
  identical to the baseline bake.
- blinkFollow GREEN: L 221 verts / 194.0%, R 90 / 207.2% (baseline bake
  221/203.5, 90/213.0 — same lid-margin counts, travel within ~9pp, >=80).
- Pixel A/B (committed PNGs): render diff localizes at dropped-card
  stations (peak x=307px = gltf -0.040 = L droppedCx cluster; R dash-band
  shading rows 528-564). Dash-box dark 78=78 (attached lash row persists),
  detached zone (below lid line) 0 dark post, in-frame rowcore 5px <= 46px
  T2b reference (62px base) — with the recorded caveat that cross-bake px
  are not commensurable (different bake/framing); the binding gate is the
  byte-level dash-zone drop. Whole-frame dark -1px (no new marks);
  eye-band lash dark 216=216 (lashes persist).
- Seal non-regression: body morph targets + body prims 1-7 POSITION
  byte-identical input-vs-output; G3 seal numbers re-pinned
  (closure min -0.029/-0.029, occlusion 1.0). G4 touches the lash mesh only.
- Gate: geometric-eye-g4-gate.py -> GREEN (23 checks, re-derived from raw
  bake + refit + committed PNGs).

Rank-1 carried (NOT closed by G4): overlap stays 0.38 post-G3. G4 owns no
lid/aperture change, so it cannot own lid overlap; the fix needs a
lid-bias/offset or lid-morph-weight change — a seal tradeoff owned by
lid-morph/aperture work (G4/G5 scope call in the scope doc), with seal-gated
bounds (no regression vs the G3 seal numbers above).

NOT TESTED: pixel grade (human-graded store sheet), gaze/compat re-run,
second subject (G6), Quest.
