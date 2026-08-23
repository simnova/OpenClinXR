---
id: AUDIT_HAND_BUILT_ASSET_REPLACEMENT
authority: evidence-report
measured_at: 2026-08-23
claim_scope: hand-authored asset artifacts on the shipped tree, their measured cost, and whether an already-cached or acquirable open-source stand-in exists
not_evidence_for: [clinical_accuracy, quest_performance, licence_ledger_amendment, that_any_swap_was_baked]
---

# Hand-built asset replacement audit — 2026-08-23

**Operator direction:** *"Find any other hand-built assets that cause toil and replace with open
source 'good enough' stand-ins to aid in accelerating productivity."* This is **D1** — *wire proven
tools, never hand-author* — applied to assets.

**What this file is.** An audit and a card. **Nothing here was rebaked.** No Blender ran, no GLB was
regenerated, no licence-ledger row was edited. Every measurement below was read off the shipped tree
with `NodeIO` or off the cached source files directly.

**The pattern being hunted**, from the case that motivated this sweep: the shipped "hospital gown"
was the peds t-shirt shell wearing a material *named* `hospital_gown` — relabelled hand-authored
geometry, not a garment — and it parked an entire rail retirement. **Hand-authored geometry that
burns slices, where a library asset already exists or could be acquired.**

---

## Direction currency — checked FIRST, and it disqualified the headline lead

`PROJECT_STATUS.md` carries the standing rail direction (2026-08-14, Patrick, via
`direction-mpfb2-throughout-2026-08-14.md`):

> **MPFB2 IS THE LEARNER RAIL THROUGHOUT.** Anny stays as reference + comparator only — do not
> delete it, **do not polish its eyes/arm-weights/shoes**. […] **NOT assigned: #3 Anny blob shoes
> (those actors leave the rail)**.

So the brief's lead 1 — the 80-triangle Anny shoe blobs — is **explicitly de-assigned by the
operator**. It is recorded below as **KEEP (pinned by direction)**, not as a candidate. A slice that
replaced them would be work on a rail the cast is leaving.

That single check moved the audit's headline from the Anny rail to the MPFB rail, where the cast
actually lives.

---

## The audit table

| # | Hand-authored artifact | Generated at | Measured cost | Proposed stand-in | Licence, quoted from the asset's OWN header | Fit compat | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **`toigo_flats` as clinical footwear** — a *leopard-print party flat* dressing every clinician | `materialize_mpfb_humanoid_candidate.py:30,37` (`SHOE_BY_REFERENCE`) | **4 cards burned** (#502 C, #553 C, #538 O, #554 O) + a 68-line dedicated patch script + **7,769,810 orphaned texture bytes** still shipped; 57,600 tris on 5 cast GLBs | **`toigo_mj_cloth_shoes`** — plain cloth, **already cached**, already baking on 2 shipped actors | `# license CC0` / `# author MRT` — `toigo_mj_cloth_shoes.mhclo:2-3`, read 2026-08-23 | **PASS** — max basemesh ref **13,331** < 13,380 (#318) | **REPLACE — filed as #598** |
| 2 | **43 of 51 equipment rows built from `BoxGeometry`/`CylinderGeometry`** | `apps/ui-xr/src/station-equipment*.ts` + `room-prop-*.ts` | **3,546 LOC across 21 files, 43 `build*Equipment` functions, 62 station-slot appearances, 14 scenarios** — 84 % of the catalog | 8 GLB-backed rows already prove the loader (`main.ts:3647,9400`); a CC0/CC-BY medical-equipment library would extend it | pending — see NOT DETERMINED below | **REPLACE (larger, unclaimed)** |
| 3 | **Anny 80-tri shoe blobs** `openclinxr_footwear_*_L/R_mesh` (42 v each, 7 assets) | `automate_blender.py` | bare toes through the shell on all 7 | — | — | — | **KEEP — pinned by operator direction** |
| 4 | **One garment shell for the whole Anny cast** — `openclinxr_real_garment_peds_upper_v1_mesh` dresses nurse, spouse, parent AND adult patient, distinguished only by material | `automate_blender.py` | 7 of 7 Anny assets; this IS the gown-relabelling mechanism | — | — | — | **KEEP — pinned (same rail); mechanism already carded #596** |
| 5 | **Hospital gown** | — | — | `makehuman-community-crude-gown` cached; **withdrawn as an evening dress (#413)**; CC0 lab coat now proposed | `# license CC0` / `# author Joel Palmius` — `crudegown.mhclo:2-3` | max ref **13,351** < 13,380 | **ALREADY OWNED — #596 open, do not duplicate** |
| 6 | **Placeholder scalp shell** | `materialize_mpfb_humanoid_candidate.py` | keyed per actor, not by rule | fitted CC0 hair (`toigo_*`, `mhair02`) | — | — | **ALREADY OWNED — #404 open** |
| 7 | **Eyebrows**, 21,816–35,334 tris/actor | `materialize_mpfb_humanoid_candidate.py` | more than eyes+lashes+teeth+tongue combined | — | — | — | **ALREADY OWNED — #597 open** |

---

## Candidate 1, measured in full — filed as **#598**

### The premise, measured, not inferred

`SHOE_BY_REFERENCE` at `materialize_mpfb_humanoid_candidate.py:29-41` sends **`toigo_flats`** to the
default (`None`) branch, to `ed_chest_pain_nurse_adult` (nurse + physician + RT + MA) and to
`ob_patient_aisha` (OB patient + peds parent). Read off the shipped GLBs with `NodeIO` on
2026-08-23, `makeclothes_library_footwear_toigo_flats_*` at **57,600 tris / 115,194–115,206 verts**
appears on:

| GLB | total tris | flats tris | flats share |
|---|---:|---:|---:|
| `mpfb-clinical-nurse-adult.glb` | 132,450 | 57,600 | **43.5 %** |
| `mpfb-clinical-physician-adult.glb` | 135,082 | 57,600 | 42.6 % |
| `mpfb-gown-adult-patient.glb` | 134,375 | 57,600 | 42.9 % |
| `mpfb-ob-patient-aisha.glb` | 131,238 | 57,600 | 43.9 % |
| `mpfb-peds-parent-aisha.glb` | 131,328 | 57,600 | 43.9 % |
| *(`mpfb-gown-inspect.glb`, `mpfb-viseme-inspect.glb` — inspect files, same mesh)* | | | |

**This is NOT a triangle-budget complaint.** #475 is open on that number and states the standing
directive plainly: *no output is gated on triangle count.* This card is filed on a different axis
and must not be read as re-litigating #475.

### The actual cost is repeated slice burn, and it is countable

`toigo_flats` is a **leopard-print party flat**. Its own material declares
`diffuseTexture Shoe.png` (`flats.mhmat:12`), a 7.7 MB leopard print. Putting it on clinicians has
now cost four cards:

| card | state | what it was |
|---|---|---|
| **#502** | CLOSED | *"Ten nurses and a physician wear red-and-leopard party flats"* — the texture was stripped per-actor and `baseColorFactor` forced to (0.10,0.09,0.08) |
| **#553** | CLOSED | *"toigo_flats is textured on one cast actor and near-black on three"* — the per-actor patch created a split treatment |
| **#538** | OPEN | *"carries its 7.7MB texture on two actors and drops it on three"* |
| **#554** | OPEN | *"The leopard `Shoe.png` is unbound but still shipped — **7,769,810 orphaned bytes** in two GLBs"* |

Plus a dedicated 68-line tool, `tools/openclinxr/evidence/strip-clinician-footwear-pattern.py`,
whose entire reason to exist is undoing this one asset's texture. Its own header:
*"`mat_makeclothes_library_footwear_toigo_flats` material with NO `baseColorTexture` and a flat …"*

**Every one of those is downstream of one decision: the wrong library shoe for a clinical role.**
None of them is a bake defect. Stripping a texture per actor is exactly the *"four manual
exceptions, not a pipeline step"* shape that #404 names as the D9 defect class.

### The stand-in, verified from its own header and already on disk

```
.openclinxr-local/provider-cache/garments/sources/makehuman-shoes01/toigo_mj_cloth_shoes/
  toigo_mj_cloth_shoes.mhclo   # license CC0   # author MRT     ← read 2026-08-23
  mj_shoes.obj                 556 verts / 502 faces
  mj_shoes.mhmat               diffuse + spec + NORMAL map
```

| | `toigo_flats` (today) | `toigo_mj_cloth_shoes` (proposed) |
|---|---|---|
| licence, own header | `# license CC0`, author MRT | `# license CC0`, author MRT |
| source `.obj` | 28,808 v / **28,800 faces** | 556 v / **502 faces** |
| baked on the shipped rail | 57,600 tris | **1,004 tris** |
| max basemesh interpolation ref | 13,331 | **13,331** (both < 13,380, #318) |
| declared maps | diffuse (leopard) + spec | diffuse + spec + **normal** |
| already baking on a shipped actor? | yes | **yes — `mpfb-family-partner-adult`, `mpfb-peds-patient-child`** |

Three things this settles, and they are why this is the strongest REPLACE row:

1. **Already cached beats acquirable.** Nothing is downloaded. The file is on disk.
2. **Already proven to fit.** It is not a hypothetical — `ClothesService.fit_clothes_to_human`
   already bakes this exact `.mhclo` onto this exact basemesh on two shipped actors today.
3. **It carries a normal map the flats do not**, so the lower triangle count is not a straight
   fidelity trade.

**"Good enough" is the bar, not "best".** A plain cloth shoe on a nurse is good enough; a leopard
party flat that needs a bespoke patch script on every bake is not.

### Also settles #475's open mechanism question, for free

#475 asks why `toigo_flats` bakes 57× heavier than `toigo_mj_cloth_shoes` and lists *"a modifier
left enabled; an `.mhclo` authored against a subdivided basemesh; a decimation step"* as unranked
candidates. **None of those.** Measured on the cached sources on 2026-08-23:

```
flats.obj      28808 verts / 28800 faces   →  ×2 (quad→tri)  = 57,600 tris   ✓ matches the GLB
mj_shoes.obj     556 verts /   502 faces   →                 =  1,004 tris   ✓ matches the GLB
```

It is **author-side, before anything in this repo runs** — which is what #475's own title suspected.
Recorded here rather than edited into #475, which another lane owns.

---

## Candidate 2 — the equipment builders, unclaimed and larger

`docs/openclinxr/equipment-catalog.v1.json` (51 rows, 14 scenarios), counted 2026-08-23:

```
runtimeSource: parametric 43   gltf 8
lane:          thin_parametric 42   bank 8   modular_kit 1
station-slot appearances served by hand-authored primitives: 62
```

Code volume: **3,546 lines across 21 files** (`station-equipment-builders.ts` 584,
`station-equipment-families.ts` 592, `room-prop-classification.ts` 387, `station-equipment.ts` 465,
+17 more), **43 `build*Equipment` functions**, all `BoxGeometry`/`CylinderGeometry`/`mat(colour)`.

**The loader already exists and is already consuming GLBs** — `main.ts:3647` and `main.ts:9400`
resolve `/xr-assets/medical-equipment/${fileName}`, and eight assets ship through it
(`exam-table`, `hospital-bed`, `stretcher`, `privacy-curtain-monitor`, `ecg-cart-12-lead`,
`iv-pole-with-pump`, `wall-clock-analog`, `bedside-monitor-generated`). So this is **not** a
"build the consumer" slice — the consumer works. It is a **supply** slice: 43 of 51 rows have no
asset to load.

No open card claims this. Left un-carded deliberately — the brief asked for **one** card, and
candidate 1 is the tighter, already-cached, already-proven one.

**Ledger-worthy, flagged not fixed:** four of the eight shipped equipment GLBs are named
`*-sketchfab-ccby.glb` while `equipment-catalog.v1.json` records `"licenceStatus": "internal"` on
all eight. A filename is not a licence and neither is a catalog string. **The licence lane should
read those four `.provenance.json` files and reconcile.** I did not edit the ledger.

---

## NOT FOUND / NOT DETERMINED — recorded so nobody re-searches this ground

- **A lighter clinical shoe than `toigo_mj_cloth_shoes` inside `makehuman-shoes01`.** The pack has
  23 shoes; **only 3 are cached** and the other 20 are **not acquirable for this basemesh** — the
  ledger records them as helper-bearing (6,252–67,242 refs ≥ 13,380), so they cannot bake against
  the helper-stripped basemesh (#318). The cached three are the entire usable set. **NOT FOUND —
  and it is a closed set, not an unfinished search.**
- **A CC0 hospital gown.** `crudegown` is cached and CC0 by its own header, and was **withdrawn on
  inspection as an evening dress (#413)**. #596 now proposes the CC0 lab coat instead. **Do not
  re-search MakeHuman for a gown.**
- **A stand-in for the Anny 80-tri shoes or the shared `peds_upper_v1` shell.** Not searched, by
  direction — those actors leave the rail. **Pinned, not unfound.**
- **A CC0/CC-BY low-poly medical-equipment library for candidate 2.** **NOT DETERMINED at the time
  of writing** — a prior-art scout was dispatched and had not returned. The audit records the
  *demand* (43 rows, 62 slots) as measured; the *supply* is open.

## claimScope / notEvidenceFor

**claimScope:** the artifacts named above are hand-authored, at the measured sizes and code volumes,
on the tree at `f697dc28`; `toigo_mj_cloth_shoes` is CC0 per its own `.mhclo` header, cached, and
already baking on two shipped actors.

**notEvidenceFor:** that any swap was baked or graded; that either shoe is clinically correct; any
Quest or performance claim; any licence-ledger amendment; the cause of anything in candidate 2.

**Card filed:** #598 — *"Five clinicians and patients ship in leopard party flats, and the plain CC0
shoe is already cached and already baking on two actors"*. Plant on main at
`tools/openclinxr/evidence/no-clinician-wears-a-shoe-that-needs-a-patch-script.test.ts`, `2 failed |
2 passed (4)`; the counterweight was destructively probed on a `/tmp` copy (footwear mesh count
`1 -> 0`), so it genuinely refuses delete-instead-of-replace.

**NOT TESTED:** the swapped bake itself — no Blender was run. Whether `toigo_mj_cloth_shoes` reads
as clinically plausible footwear on a nurse at learner framing is a **pixel grade nobody has taken**
and it is the first thing the card's grader must do.
