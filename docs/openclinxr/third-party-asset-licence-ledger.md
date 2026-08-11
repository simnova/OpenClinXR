# Third-party asset licence ledger

**What this is.** One row per third-party asset source acquired into this repo or its provider cache,
with the licence, where it came from, what consumes it, and whether we intend to replace it.

**Why it exists.** #193 records that CC-BY garments are allowed but "the compliance surface they are
conditional on does not exist". This is that surface. Operator direction 2026-08-11, approving hair
acquisition: *"keep track of these as we'll eventually look for replacements where possible."* So every
row carries a **replacement posture**, not just a licence.

**Rules.**
- **CC0 and CC-BY only** unless the operator approves otherwise in writing. No AGPL/copyleft, no paid,
  no unspecified.
- **An unspecified licence is a refusal, not a maybe.** If the source page does not state a licence, it
  does not get acquired — record it in the REFUSED table instead so nobody re-litigates it.
- CC-BY sources require attribution to survive into anything shipped. Record the attribution string
  here at acquisition time, not later.
- A row is added when the asset is acquired, not when it is first used.

## Acquired

| source | licence | what | acquired | consumed by | replacement posture |
|---|---|---|---|---|---|
| `makehuman-hair01` ([pack page](https://static.makehumancommunity.org/assets/assetpacks/hair01.html)) | **CC0 1.0** | 26 hairstyles, `.mhclo` + `.mhmat`, 217 MB. Authors: Cortu, culturalibre, Elvaerwyn, Faydaen, learning, littleright, punkduck, RehmanPolanski, sonntag78, MargaretToigo | 2026-08-11 | MPFB/hm08 rail via `ClothesService` (hair is clothing in MakeHuman topology terms) | **Keep.** CC0 is the cleanest posture available; replace only on quality grounds, not licence grounds. Mostly low-poly/stylised — likely to be a realism ceiling before it is a licence problem. |
| `makehuman-pants01` ([pack page](https://static.makehumancommunity.org/assets/assetpacks/pants01.html), mirror `https://files2.makehumancommunity.org/asset_packs/pants01/pants01_cc0.zip`) | **CC0 1.0** | 4 lower-body garments — `cortu_cargo_pants`, `cortu_jeans_shorts`, `toigo_wool_pants`, `toigo_harem_pants` — `.mhclo` + `.obj`, author Cortu Johnstone / MargaretToigo. Only cargo pants is cached (`cargo_pants.mhclo` + `cargo_pants.obj`, original pack filename `cortu_cargo_pants.mhclo`, internal name `cargo_pants`) | 2026-08-11 | `body_param_stage.py` lower fit via `ClothesService` (cargo pants on both `body-param-*-library.glb` classes). #310: the missing rebuildable source for the shipped `makeclothes_library_cargo_pants_*` meshes | **Keep.** CC0 is the cleanest posture; replace only on quality grounds. |
| `makehuman-community-scrub-shirt` ([Scrub_Shirt.mhclo](http://www.makehumancommunity.org/sites/default/files/clothes/8124/601141795/Scrub_Shirt.mhclo), author WojackOWL, "Medical Scrubs Kit") | **CC-BY** | `Scrub_Shirt.mhclo` + `.obj`, cached under `.openclinxr-local/provider-cache/garments/sources/makehuman-community-scrub-shirt/`. Header states `license: CC-BY`. Previously only downloaded ad-hoc at bake time; now tracked so re-bakes need no network | 2026-08-11 | `body_param_stage.py` upper fit (`makeclothes_library_scrub_shirt_*` on the heavy-male library body); factory fallback upper per `garment-selection-by-role.ts` | **Replace when a CC0 equivalent exists.** CC-BY attribution must survive into shipped builds. |
| `makehuman-shirts01` (pack file `shirts01_cc0.zip`) | **CC0 1.0** — re-checked against the garments' own `.mhclo` headers on 2026-08-11 (#322): `# license CC0` on `toigo_basic_tucked_t-shirt` (author MRT), `elvs_crude_t-shirt_male` (Elvaerwyn) and `namuhekam_male_polo_shirt` (Namuhekam). The earlier "CC-BY per existing cache provenance" row was a pack-page reading, not the headers, and is corrected here. | 3 upper `.mhclo` shirts + `.obj` | pre-existing | `body_param_stage.py` upper fit via `ClothesService` — `toigo_basic_tucked_t-shirt` now fitted to the lean-female `body-param-adult_lean_female-library.glb` (family/parent/spouse casual layers, #322). `namuhekam_male_polo_shirt` is excluded: 3,648 of its fitting refs are helper vertices (indices ≥ 13,380) and it cannot fit the helper-stripped basemesh (#318/#321) | **Keep.** CC0 removes the CC-BY attribution obligation entirely; replace only on quality grounds. |
| `makehuman-visemes02` ([pack page](https://static.makehumancommunity.org/assets/assetpacks/visemes02.html), mirror `https://files2.makehumancommunity.org/functional/visemes02.zip`) | **UNSPECIFIED — no licence stated anywhere.** Not in `packs/visemes02.json`, not on the pack page, no CC/GPL/public-domain string in the HTML. Unlike `pants01` and `shoes01` there is **no `_cc0` variant** (both `visemes02_cc0.zip` URLs return 404). Author: Mika Suominen. | 2026-08-11 | 15 Meta/ARKit `visemes02` targets (`sil, PP, FF, TH, DD, kk, CH, SS, nn, RR, aa, E, I, O, U`), hm08 topology, real per-vertex deltas (`viseme_aa` 2,548, `viseme_PP` 2,282, `viseme_sil` 0 as rest), 130 KB. Matches MPFB's `VISEMES02_TO_LIPSYNC` (`faceservice.py:122`) name-for-name and the `viseme_*` prefix the runtime already drives. | **STAGED UNDER AN EXPLICIT OPERATOR ASSUMPTION, 2026-08-11.** The standing rule is *unspecified is a refusal*; the operator directed otherwise — *"backlog the license chase but assume the best so that we are unblocked and can move forward — we can revisit if we hear otherwise."* Recorded as an **assumption, not a finding**: this pack is NOT known to be CC0/CC-BY. Licence clarification is filed as a backlog item. **If clarification comes back restrictive, every asset derived from these targets must be re-baked without them** — that is the revisit trigger, and it is why this row states the assumption rather than a licence. |
| `makehuman-shoes01` (pack file `shoes01_cc0.zip`, 83 MB, 23 shoes, all `basemesh hm08`) | **CC0 1.0** — per each shoe's own `.mhclo` header, read on 2026-08-11 (#324): `# license CC0` on `toigo_flats` (author MRT), `toigo_mj_cloth_shoes` (author MRT), `# license CC-0` on `culturalibre_male_boots` (author culturalibre, original Roachburn). The 23-shoe pack is CC0; the per-header read is the compliance surface the factory requires. | 3 cached shoes with **zero helper-vertex refs** (fit the helper-stripped basemesh, #318): `toigo_flats` (28,808 obj verts), `toigo_mj_cloth_shoes` (556), `culturalibre_male_boots` (15,308). Helper-bearing shoes in the pack (ankle boots, ballet flats, stilettos — 6,252–67,242 refs ≥ 13,380) cannot bake and are not cached | 2026-08-11 | `embed_library_footwear.py` footwear fit via `ClothesService.fit_clothes_to_human` — `toigo_flats` on `body-param-adult_lean_female-library.glb` (family role), `culturalibre_male_boots` on `body-param-adult_heavy_male-library.glb` (male patient actor). #324: replaces the 86-vertex procedural footwear shells (a resolution defect — 1 : 50 shoe-to-foot vert ratio) | **Keep.** CC0 is the cleanest posture; the excluded helper-bearing shoes stay out until the basemesh-topology blocker (#318) is resolved, not on licence grounds. |
| `anny` (PyPI, NAVER Corp) | **Apache-2.0** (code); bundled `data/mpfb2` assets **CC0 1.0** | Parametric body model, phenotype oracle | 2026-08-11 | Anny rail; `anny.Anthropometry`, `AnnyInverter` | **Keep.** Note its optional SMPL-X topology is non-commercial download-only and the pipeline deliberately does not call that path. |
| MPFB2 (Blender extension) | AGPL-3 (plugin code) — **tool, not shipped asset** | Rig, macros, `ClothesService`, base mesh | pre-existing | `body_param_stage.py`, `add_mpfb2_eye_rig.py` | **Keep as a build-time tool.** It is not linked into or shipped with the runtime; the outputs (meshes) are ours. Flagged here because the repo bars copyleft in *shipped* dependencies and someone will ask. |

## Refused — do not re-litigate without new information

| source | why refused | date |
|---|---|---|
| `haireditor` ([pack page](https://static.makehumancommunity.org/assets/assetpacks/haireditor.html)) — geometry-nodes hair/fur, `hair.blend` + `fur.blend`, ~12 MB | **No licence stated on the source page.** This is the pack MPFB's own `haireditorservices.py` looks for (`get_hair_blend_path`), and it is the procedural route that would best satisfy D2 — so it is the one worth chasing a clarification on. Until then, unspecified is a refusal. | 2026-08-11 |

## Licence uncertainties surfaced 2026-08-11 (researcher; NOT resolved)

| item | uncertainty | why it matters |
|---|---|---|
| `haireditor` pack | The CC0 grant found is **the distributor's, not the author's**. Tomáš Klecer authored `hair.blend`/`fur.blend` as a CS bachelor thesis; a distributor cannot grant CC0 on someone else's work. **One forum question to the author or MPFB maintainers closes this.** | Blocks the procedural (D2-aligned) hair path. The geo-nodes *engine* is already installed in MPFB 2.0.15; only the two `.blend` templates are missing. |
| `retarget_bvh` (Diffeomorphic) | **GPL-2.0-or-later.** Clear licence, but copyleft. | **Build-time tooling only**, same posture as MPFB's AGPL — never linked into or shipped with the runtime. Recorded so nobody promotes it to a dependency. |
| CMU mocap clips | *"free for all uses"*, commercial embedding permitted, but **"you may not resell this data directly, even in converted form"**, plus a requested NSF EIA-0196217 acknowledgement. | Usable, with an attribution obligation and a resale restriction that must survive into any distribution. |
| Mesh2Motion clips | Code MIT, assets **CC0-1.0**; but the repo ships **no LICENSE file**, so the claim rests on README text. | ~150 clips are the salvage from a motion path that turned out to be browser-only. Verify before harvesting. |
| Expy-Kit, Mwni | **No LICENSE file**; GPL claim rests on a single header line. | Not acquired. Recorded so it is not mistaken for cleared. |
| MakeHuman base mesh | A stale 2016 README in the org's own tree asserts **AGPL** against a 2020 `LICENSE.md` saying **CC0**. No dated relicensing announcement found. | This is the mesh under every body we generate. The contradiction is upstream, not ours, but it is the single most load-bearing licence in the pipeline. |

## Open questions

- **`haireditor` licence.** Worth asking upstream. If it comes back CC0/CC-BY it is the preferred hair
  path: geometry-nodes hair is procedural (D2) and is what MPFB 2.0.11 natively supports, where hair01
  is static mesh assets.
- **CC-BY attribution surface.** #193's actual gap: nothing in the build currently emits attribution
  for CC-BY sources. The one CC-BY source in use today is `makehuman-community-scrub-shirt`
  (WojackOWL's `Scrub_Shirt`, heavy-male + factory fallback upper); `makehuman-shirts01` is CC0 per its
  `.mhclo` headers (#322 re-check) and carries no attribution obligation. This ledger records the
  obligation; it does not discharge it.

## Not tested / not claimed

Licences here are recorded from the source pages as of the acquisition date. This is a tracking record
maintained by an engineering process, **not a legal review**, and nothing in it constitutes clearance
for commercial distribution.
