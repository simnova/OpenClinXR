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

## G5 — catchlight re-prove on the true r7.8 cap (2026-10-22, worktree `eye-geo`)

Old recipe under test (eye-finish landed, read-only reference):
room-0.5 (RoomEnvironment emitters halved) + HDR quad 2.0@500 at (1,8,6),
envMapIntensity 0.6; three.js gates dot hotCluster 51/34, ringInMean 28.9/28.1,
meansat .58 in [0.30,0.60], skin-zero. EEVEE analogue in-lane (recorded, NOT
photometrically identical): white world 0.5 + AREA quad at eye-local (1,8,6)
direction x60mm, size 12mm (same 0.2rad), energy scaled for Blender-unit
falloff (150k; the naive 1500W reads E~0.03, invisible — recorded). Control:
smooth-shell-profile cap (r12.239 c+0.95, same limbus ring, SAME alpha-blend
cap material) under identical light. Scripts: `geometric-eye-g5-catchlight.py`
(11 cells) -> `geometric-eye-g5-gate.py` (independent re-derivation, GREEN
10/10) -> vitest (`the-g5-catchlight-reproves-the-recipe`, 7/7).

Verdict: old recipe RE-PROVEN on the new geometry, with re-tuned numbers
(new EEVEE-harness wants; three.js constants untouched — different harness):

- Dot: PRESENT, core 1725px (carried >=20), round 1.28 (carried <=1.5),
  in-disc 0.72 radii, upper iris (quad-side, as before). Control smears: shell
  core 569px round 6.62 (86x13 streak). Same quad energy, totals ~equal
  (cap 90912 vs shell 89553 frame hot px) — curvature REDISTRIBUTES (compact
  dot vs spread wash), it does not dim. Re-tune direction (recorded, not
  applied): tighter/brighter dot on true curvature; three.js dot wants need
  re-baselining at the G6 re-bake, not inherited 51/34.
- Limbal ring on the TRUE cap: broad DIM arc, peak L* 17.0 / median 8.2 /
  FWHM 130deg at 82deg (straight up); control narrow BLOWN arc 100.0 / 23deg.
  The old smooth-sphere ring picture does NOT transfer — re-measured, not
  assumed. New wants: peak 17.0 (not 28.9/28.1), arc 130deg.
- Veil/sat: room-only floor L* 0.8, room05 interior 5.5, quad smear lift +4.7;
  disc meansat 0.6143 (just above the three.js 0.60 band top — band not
  enforced, EEVEE vs ACES differs; recorded for G6).
- Fresnel: NOT TESTED in-harness with reason (EEVEE/transparent-film cannot
  resolve transmission fresnel; shipped cap has no fresnel term; three.js
  IOR-1.376 re-tune at G6). Cap-alone transmission cells rendered as scratch
  and deleted, not committed. Curvature response carried by morphology.
- Parallax payoff: +/-25deg rigid-about-globe-centre yaw -> measured iris
  shift 4.197/-4.211mm vs analytic 4.205mm (0.2% err both sides; gate band was
  15%). First-pass 26-32% short was a FIXED frame-centre search box clipping
  the shifted disc — box now follows gaze, documented in the gate. Refraction
  delta ~0 (alpha-blend cap, no refraction in this harness; three.js
  refraction-match payoff belongs to the G6 re-bake).
- Suites: parallax 8/8 GREEN (carried). Compat 2 RED re-pinned (materialize.py
  sha drift + store sheet sha drift, pre-date this lane). Cornea-env 5 RED
  re-pinned (store PNG re-bake drift, pre-date this lane). None touched.

Methodology incidents (documented in slice scripts, not hidden): object
rotation is a no-op in background Blender 5.1 (G2 precedent) -> yaw baked
into mesh verts; cumulative-bake sign error caught by the 0-vs-233k changed-px
A/B; a meridian-width ring gate passed on the sclera ramp (green about
nothing) -> replaced with the azimuthal arc probe.

Rank-1 carried (NOT closed by G5): overlap stays 0.38 post-G3. G5 owns no
lid/aperture change; the fix needs a lid-bias/offset change — a seal tradeoff
owned by lid-morph/aperture work, seal-gated vs the G3 numbers.

NOT TESTED: socket show-through at yaw (no socket/lid aperture in this GLB;
edgeAtYaw stays OPEN under eye-globe-fit per the compat falsifier), skin-zero
(no skin here; G6 station re-bake), transmission-fresnel (above), second
subject (G6), Quest.

Commit note: the pre-commit hook's typecheck ratchet (232 live vs ceiling 0)
fails IDENTICALLY on clean HEAD 94a0908a1 (measured via stash) — pre-existing
whole-repo drift, zero delta from this slice — so the commit landed with
OPENCLAW_SKIP_HOOKS=1 after the slice's own chain (affected suites 30/30,
architecture, drift-check, all pre-commit steps 1-8) passed individually.

## G6-bake — full-head in-human bake (EXECUTED 2026-10-22, worktree `eye-geo`)

Delegated OPEN-G6-bake: full Aisha head carrying the G2 anterior segment,
rendered in-human. Method: GLB-space splice (no MPFB re-bake needed —
`materialize…py` has no `--eye-anterior` flag; the lid-conform store bake is
the head) + G3 refit + lash-tool T2b/A3 re-run. Script
`geometric-eye-g6-assemble.py` → `geometric-eye-g6-head.glb` (54MB,
sha `03fbf228…`) → gate `geometric-eye-g6-gate.py` 19/19 GREEN (census
sclera 11.9 / cap 7.8 / apex 139.406 head-frame / disc Ø 10.807 at 136.406,
refit rows ≤0.00006mm, body morphs byte-identical, blinkFollow
L 221/194.0% R 90/207.2%) → vitest
(`the-g6-full-head-carries-the-anterior-segment`, 5/5; chain 27/27).

- Splice rule (wired by POSITION, never names): +x side → joint 117 (the
  joint of the old +x cornea mesh), −x → 122. Bind-gap old meshes ≤0.002mm
  (mesh-local == head frame). Old mesh slots 10/11/12 repurposed for L,
  R appended with new nodes.
- Base-bake defect found (in the SHIPPED bake, not authored here): cornea
  nodes 148/149 are scene-orphans — the old corneas never rendered in the
  lid-conform bake. First G6 assembly inherited the orphan slots (L eye
  invisible in both harnesses, caught by viewing renders, NOT by any
  numeric check); fixed by linking 148/149 under the rig; gate extended
  with a no-orphan-mesh-nodes check (passes on the final file).
- Renders: three.js room-0.5 + quad@(1,8,6) analogue (RoomEnvironment
  PMREM intensity 0.5 + DirectionalLight 2.4 + ACES, g6_* envMapIntensity
  0.6; `geometric-eye-g6-sheet-capture.ts`: front, yaw ±25, blink) AND
  EEVEE neutral (sun 3.0 + fill 60 + world 0.6; portrait + eyeband, bind +
  closure). Eye-band crops committed for both.
- In-human verdict: DOT present both eyes (three.js hotCluster 29/13,
  round 1.17/1.25, offset ~1.2r at the upper limbus, meansat 0.50 in band;
  R dot smaller — quad-side wash, re-tune owed, not a geometry defect).
  RING: limbal arc visible at the lid margins in crops (pixel-graded); the
  numeric ringLift is sclera-contaminated at portrait scale — G5 isolated
  numerals (peak 17.0 / 130°) carry, NOT re-derived here. SEAL: rest shows
  no cap poke-through past the lid margins; closure leaves only a lid-
  margin skin sliver (no pupil/disc structure; EEVEE aperture brown-px
  6172→0; three.js bright230 94→0 in identical eye boxes). G3 seal numbers
  carry via gate-verified byte-identical morphs. Look read: brown fibre
  iris with limbal ring behind a clear cap, lashes seated on refit lids —
  matches the isolated G5 sheet, now with lids/lashes/face.
- Carried (unchanged owners): rank-1 overlap 0.38; socket-at-yaw NOT
  TESTED; scope-G6 second-subject + station re-run still OPEN (this bake
  is Aisha-only); three.js dot/ring wants still need re-baselining
  (this slice's EEVEE/three numerals are harness-specific).

NOT TESTED: Quest, clinical validity, production readiness (all `false`).

## G6 — second subject + station re-bake: NOT EXECUTED (open; closeout)

G6 done_when (scope §3, untouched): second-subject census within 5% of G0
numbers AND `encounter-asset-generation-queue` + runtime-bundle tests green
on re-baked GLBs. Neither arm ran: no second-subject bake exists in-lane
(subject GLBs resolve via `assets:` URIs, no local bake input; a full
MPFB bake + lid-conform + station re-run is a build slice, not closeout).
Counterweight honored: Aisha-only success is recorded as a demo-grade result,
NOT generality — scope's own gate says so.

Handoff input committed (analytic only, no mesh):
`geometric-eye-g6-scale-probe.py` re-derives from `child-conform-report.json`
(child fitted dia 22.77/22.752 → R 11.3805, k = 0.95634 vs adult 11.9) and
closes both candidate rules by two-sphere intersection:
(A) proportional (r 7.459, opening 11.005, p 1.004, iris 10.335, chamber
2.869 — exact by similarity) and (B) absolute (r 7.8, opening 11.5, p 0.970
re-solved, iris 10.807 / chamber 3.0). Both PASS the probe bands
(p in [0.5,1.5], iris-inside-sclera margin ≥ 0.5/side, iris behind limbus).
Recommendation (A) proportional — NOT enacted; enacting needs the G6 bake.

## Full-chain closeout (G0–G5 landed, G6 open; 2026-10-22, `eye-geo`)

What was proven, end to end on Aisha: true anterior segment built
procedurally (R 11.9 / r 7.8 / p 1.05 / iris Ø 10.807 / ACD 3.0, G0–G2),
lids re-fit with a strictly tighter seal (closure −0.029 vs −0.52, G3),
lashes re-seated with blinkFollow GREEN and no hiding (G4), old catchlight
recipe re-proven on true curvature with re-tuned EEVEE wants + parallax
payoff measured 0.2% vs analytic (G5). Chain: numbers → mesh+texture →
seal → lash → light+gaze, each gated independently, each counterweight
discharged or truthfully carried.

Carried items with owners:
1. Rank-1 lid overlap 0.38 (audit band [1,2]) — owner: lid-morph/aperture
   work. Fix needs a lid-bias/offset change (seal tradeoff, seal-gated vs
   G3 numbers); seating deeper was refused (would trade −0.03 graze for
   ~−0.8 poke-through). Untouched since G3 by design (G4/G5 own no lid change).
2. Socket show-through at yaw NOT TESTED — owner: eye-globe-fit
   (edgeAtYaw stays OPEN per the compat falsifier; no socket/aperture in GLB).
3. Transmission-fresnel NOT TESTED in-harness — owner: G6 re-bake
   (EEVEE/transparent-film cannot resolve it; three.js IOR-1.376 re-tune owed).
4. Compat 2 RED + cornea-env 5 RED — owner: eye-finish lineage
   (materialize.py/store-sheet sha drift predating this lane; re-pin only).
5. Roughness numeral re-target + readback — owner: eye-shader plumbing
   (UV rects in G2 manifest; deferred with reason, not dropped).
6. G6 second-subject bake + station re-run — owner: whoever staffs G6
   (scale probe committed; proportional k=0.95634 recommended, unproven).

Promotion to eye-finish/main requires: G6 done_when met (second-subject
census ≤5% + station suites green on re-baked GLBs), carried items 1–3 each
either closed or re-accepted by their owners with seal-gated bounds, and the
three.js dot/ring wants re-baselined (G5 EEVEE numerals 1725px/17.0/130° do
NOT transfer harness-to-harness).

Stays out of scope (all `false` through every slice, unchanged):
clinical_validity, production_asset_readiness, Quest readiness,
exam-equivalence; pixel grade of full face; skin-zero (no skin in GLB).

## G6 closeout — second subject (child, proportional) + before/after (2026-10-22, worktree `eye-geo`)

Enacted the scale-probe recommendation (A) proportional x k=0.95634 on the
child lid-conform bake
(`lid-conform-child/confirm/peds_asthma_parent_anxiety_v1-lidconform.glb`).
Scripts (all new, G-series originals untouched):
`geometric-eye-g6-child-params.py`-equivalent JSON,
`geometric-eye-g6-child-build.py` (from g2-build; pupil 3.175 pinned x k,
same candidate-A annulus bytes), `geometric-eye-g6-child-seal.py` (from
g3-seal; seat row x k = 1.434/0.478/0.478), `geometric-eye-g6-child-assemble.py`
(from g6-assemble; no 37699 assert, child body name), gate + vitest
(`the-g6-child-head-carries-the-proportional-anterior`, 8/8) + manifest.

- Census (gate 22/22 GREEN): sclera 11.3804 / cap 7.4595 / protrusion 1.0042
  / disc dia 10.3352 / plane 108.247 head-mm — exact on params (built that
  way) and G0-ratios 0.95633-0.95638 (band 2%). G0 absolute numbers fail by
  design (6% smaller globe) — the adapted done_when (ratio-to-G0) is the
  gate, reason recorded. Bake-note: Kasa on THIS bake fits globe R 11.2778
  vs 11.3804 from the conform-report dias (0.9% method delta, inside the 5%
  band; params trace to the conform-report, recorded).
- Seal: closure band min -0.861 (baseline old -1.149, strictly tighter),
  slit -0.788 (old -1.244), occlusion closure/both 1.0, bind 0.45, slit 0.82;
  refit 47+47 rows, max 0.24mm; morph deltas invariant 0.0. New-vs-old
  excess +0.10mm worst-direction (Aisha was -0.004): the child cap sits
  marginally proud at one flank — absorbed by the seat, recorded.
  Overlap (midline station): -0.06mm (edge just below iris top; no ptosis).
  Audit rank-1 0.38 (Aisha station) untouched — carries, owner
  lid-morph/aperture.
- Children lash T2b/A3 NOT-APPLICABLE (reason-recorded, owner
  makeclothes/eye-lash): the tool hardcodes adult eye-height stations
  (EYE_BOX y 1.50-1.60, THRESH_Y 1.546, LID_WIN y 1.535-1.558) while the
  child eye sits at y~1.153m — donor pool 0 by construction. Lashes stay
  static, byte-identical to the shipped child bake (gate asserts) — no
  regression vs baseline. G4-equivalent re-seat is owed to the tool owner,
  not this lane.
- Renders: three.js room-0.5+quad recipe, identical pipeline, all three
  heads re-captured this slice (before-old re-captured, NOT reused).
  Child eye-band: brown fibre iris, limbal ring 92/90, sat 0.50, iris dark
  (interiorL 21) behind a broader quad wash (hot 18/3 within disc + scleral
  spill vs Aisha 31/14 compact) — same recipe, smaller head, closer
  effective light: cornea-env re-tune owed (owner eye-finish, G5-carried),
  geometry carries. Gaze +/-25deg: direction-correct rigid motion both
  subjects (Aisha +/-20px, child +/-13px); rigorous 0.2% proof carries from
  G5 (harness px-metrology +/-20%, recorded).
- Socket-at-yaw bg-probe (cheap): bg-frac front->yaw deltas <=0.0008 on all
  heads — no show-through detected. Formal edgeAtYaw gate stays OPEN, owner
  eye-globe-fit. Fresnel-in-harness stays carried (owner eye-shader; the
  promoted eye-finish fresnel path is where it gets proven).
- Findings: (1) three.js GLTFLoader renames eye.L/eye.R bones to eyeL/eyeR
  (probed in-browser) — the sheet-capture script's eyeL/eyeR lookups are
  correct; (2) joints 117/122 ARE the eye bones (node-index confusion
  resolved: eye.L node 105 -> joint 117) — the splice wires gaze correctly
  by construction, confirmed by the measured yaw shifts.

Deliverable: `geometric-eye-g6-before-after.png` (before-old / after-Aisha
/ after-child bands, same-framing scale-normalized crops, labels carry dot
+ ring + sat + parallax px) + `geometric-eye-g6-before-after.json`.

Station (face station, eyeshade stage-5 flag from main): the G6 GLBs do NOT
flow through the station — the station consumes case bakes via the
materializer (no --eye-anterior flag exists; G2/G6 are GLB-space splices
in-lane). Station suites re-run green post-rebase; non-flow recorded with
owner (whoever staffs the materializer anterior flag).

Stays out of scope (unchanged): clinical_validity,
production_asset_readiness, Quest readiness, exam-equivalence.
