Factory: Dispatched

#598 worker report — leopard `toigo_flats` → plain CC0 `toigo_mj_cloth_shoes`

## Unlocked decisions taken
1. **Both** `SHOE_BY_REFERENCE` rows moved (`None` + `ed_chest_pain_nurse_adult`) → `toigo_mj_cloth_shoes`.
2. Left `strip-clinician-footwear-pattern.py` on disk (inert; no subject).
3. Left in-script `if shoe_kind == "toigo_flats":` branch on disk (now dead code).
4. Did **not** rebake `mpfb-gown-inspect.glb` / `mpfb-viseme-inspect.glb`. Gown cast rebaked via gown script from rebaked aisha.

## Exact bake invocations
```
blender --background --python tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py -- \
  --output apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb \
  --reference ed_chest_pain_nurse_adult --actor-role nurse

blender --background --python tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py -- \
  --output apps/ui-xr/public/generated-humanoids/mpfb-clinical-physician-adult.glb \
  --reference ed_chest_pain_nurse_adult --actor-role physician

blender --background --python tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py -- \
  --output apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb \
  --actor-role patient --pregnancy-weeks 34

blender --background --python tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py -- \
  --output apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb \
  --actor-role parent --eye-colour-reference peds_anxious_parent

blender --background --python tools/openclinxr/evidence/blender/bake_mpfb_gown_inspect.py -- \
  --input-glb apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb \
  --output-glb apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb
```

Licence headers re-read at bake: both `.mhclo` `# license CC0` / `# author MRT`.

## Baseline re-pins (old → new)
| file | what | old | new |
|---|---|---|---|
| `the-applied-visemes-move-the-mouth.test.ts` | nurse sha256 | `8c8547ff…af7d409` | `34dbfc56…7434b432` |
| same | physician | `ab9a3352…737bdf3` | `b8ac08be…623847` |
| same | aisha | `390ee91f…9c5504` | `67fa2812…c760cd` |
| same | parent | `2182b8c6…5964b6` | `d13e6ebc…d154e1` |
| same | kevin (disk drift only; not rebaked) | `0817dbd1…955d72` | `313ea22c…928679` |
| `viseme-apply-provenance.json` | same five hashes | (matched old table) | (matched new table) |
| `overlapping-garments…` | aisha/nurse/physician/parent `shoeTris` | `57600` | `1004` |
| same | cuffReachMm those four | 28.0 / 29.6 / 29.6 / 28.0 | 9.5 / 8.8 / 8.8 / 9.5 |
| same | ACTORS+BASELINE add | (missing) | `mpfb-street-adult-male` 30768 / `mpfb-viseme-inspect` 57600 |
| `no-shipped-humanoid-carries-an-unbound-texture.test.ts` | aisha PINNED | bytes 24291640, boundTex 4, boundBytes 3168198, tris 131328 | 11395580 / 5 / 4580867 / 74642 |
| same | parent PINNED | 24291644 / 4 / 3168198 / 131328 | 11456228 / 5 / 4598965 / 74732 |
| `garments-are-flat-shaded…` | flats key | `…footwear_toigo_flats` 57600/12922/3780 | `…footwear_toigo_mj_cloth_shoes` 1004/134/146 |
| same | aisha cargo | 2782/966/48 | 2692/906/160 |
| same | aisha t_shirt coplanar/sharp | 800/238 | 851/245 |

## Verification
- Planted contract: **4/4 passed**
- Colliding four suites after re-pin: **19/19 passed**
- `pnpm packages:typecheck:agent`: green
- `pnpm architecture`: green

Grade render: `.openclinxr/evidence/issue-598/nurse-feet-grade.png` (EEVEE, nurse, feet framed, shoe teal vs foot peach).

IN-SCOPE:
- shoe_present_on_both_feet: yes
- toe_shape_defined: no
- heel_shape_defined: no
- sole_meets_floor: yes
- reads_as_clinical_not_party: yes

OUT-OF-SCOPE: nurse mid-torso shows a translucent lower abdomen band and truncated upper arms in the feet-framed crop (body hide / capture framing residue — not this shoe swap).

Product visibly worse? No — party leopard flats replaced by plain cloth shoes; mj shoes are low-detail (toe/heel soft) but clinical-plain.

Turn breakdown: product ~25 / environment thrash ~8 / discovery ~12 / verify ~20

Guesses because brief silent:
1. **Gown fifth invocation** — materialize does not produce gown cast; used `bake_mpfb_gown_inspect.py` with rebaked aisha as input (pregnancy morph rides along; pre-fix AABB already matched aisha).
2. **Overlap ACTORS gap** — street-male + viseme-inspect were missing and failed SS7j before shoeTris could be re-pinned; added measured rows rather than leaving the suite red.
3. **Kevin hash drift** — on-disk kevin ≠ pinned hash without our edit; re-recorded only.

One concrete spec change: name the gown cast regeneration as `bake_mpfb_gown_inspect.py --input-glb <rebaked-aisha>` explicitly — provenance has no argv and materialize alone cannot emit the gown shell.

CLAIM: five cast GLBs no longer carry `toigo_flats`; strip patch has no subject; footwear geometry replaced (1004 tris cloth shoes), not deleted; planted 4/4 green.

NOT TESTED: pixel grade that either shoe is clinically correct; inspect GLB footwear still on flats; whether #538/#554 close as a consequence; Quest/triangle budget (out of claimScope).

Ledger-worthy: `toigo_mj_cloth_shoes.mhclo` and `toigo_flats.mhclo` both `# license CC0` / `# author MRT` (re-read at bake).
