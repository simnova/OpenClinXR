# ECG cart · 4-view TRELLIS × optimize × cage-bake cagematch

Date: 2026-08-31  
Status: plan (Lane C bake-off). Does not dispatch. Does not invent Bothy `done_when`.  
Subject: the hard-surface ECG cart on the Factory page (`docs/assets/factory-pipeline/`).  
claimScope: experimental design for one equipment subject.  
notEvidenceFor: Quest readiness, clinical accuracy, a winning method, or that hatch/`--bake` already ran on this cart.

---

## 1. Why this plan exists

The Factory stills (commit `9ac738c0`) are the **973,639-tri raw TRELLIS mesh** and the **34,443-tri meshopt stretch champion**, relit in studio grey. They look like the Imagine prompt, but the optimize station that produced them is **older than two later stations**:

| Station | What it actually is | On this cart? |
|---|---|---|
| `factory:trellis:bake` 4-view | sequence-concat embeddings when 4 PNGs exist (`trellis-bake-cli.ts`, `run_bake_isolated.py` `#255`) | **Unknown.** Fleet test still says many TRELLIS sources are `viewCount: 1` (`the-derived-trellis-fleet-has-terminal-measured-dispositions.test.ts`). 4-view is wired; this cart may predate the pack. |
| Hatch remesh-then-optimize | `run_bake_isolated.py --remesh` then `iterate-optimize` (`trellis-hatch-cli.ts:429`) | **No.** Hatch is escape-hatch. This cart is VR-hard optimize-from-raw. |
| Blender high-to-low `--bake` | `hl_bake.py` **after** a low mesh exists (`iterate-optimize.ts:271-333`, `:499-501`) | **No.** Opt-in; hatch does not pass `--bake`. |

Operator memory (“Blender bake before decimation”) collides with two facts:

1. **High-to-low cannot run before a low mesh exists.** Selected-to-active needs HIGH and LOW. The wired stage bakes raw → champion *after* meshopt.
2. **TRELLIS remesh-at-export is the thing that can run before meshopt.** That is voxel remesh (`remesh=True, remesh_band=1, remesh_project=0`), not Cycles.

This cagematch treats the **current 973,639 / 34,443 pair as CONTROL**, not as the station. New methods must match or beat control on *likeness to the Imagine pack* **and** land in the preferred triangle band (≤80k, stretch ≤40k only if likeness holds).

Lane C rule (`PROTO_BOARD_LOOP`): the deliverable is a **decision with evidence**. A negative result (none of the treatments beat control) **closes the item**. Do not adopt a method to make the board green.

---

## 2. Control (do not move this)

| Role | Path | Tris | Notes |
|---|---|---:|---|
| Imagine (appearance oracle) | `docs/assets/factory-pipeline/01-imagine-image.png` + `01b-multiview-pack.png` | — | Hard-surface Grok pack. Likeness target. |
| CONTROL high | `apps/arena/model-vetting-studio/public/glb-grade-staging/2026-08-11T01-57-18Z/ecg-cart.glb` | **973,639** | Raw TRELLIS. Copy into evidence **before** any treatment. |
| CONTROL low | `…/2026-08-11T01-57-18Z/champion.glb` | **34,443** | meshopt stretch. Website post-opt still. |
| CONTROL stills | `docs/assets/factory-pipeline/02-preopt-mesh.png`, `03-postopt-mesh.png` | — | Blender EEVEE studio, three-quarter right, grey world. **Re-render every treatment with this exact camera/lights** (`render-glb-multiview-pack.py`). |

If CONTROL GLBs go missing (staging is gitignored-adjacent), abort: do not substitute the midband 974,864 / 59,999 pair without labelling it a **second control**.

**Control grade (orchestrator, native PNG, not a thumbnail):**

- Reads as the Imagine cart (box, black screen, pad row, jack row, casters, column).
- Studio grey, even light, no grid, no HUD.
- Stretch 34k: jacks/pads lumpier than raw; silhouette still a cart.
- **notEvidenceFor:** Quest, clinical device, “34k is required.”

---

## 3. Learnings already paid for (do not rediscover)

### Generation

- Photoreal packs post-opt floor ~**186k**; hard-surface chain ~**59k** / high-error **34k**. Optimize the **prompt**, not only the ladder (skill `trellis-vr-equipment-optimize`).
- 4-view sequence-concat is implemented. Measured on a later ECG bake: far-side fill **0.35 → 0.44**, surface area **+47%**, **3.7% fewer tris**. Do not collage four views into one image (`MULTIVIEW-GROK-PACKS.md`).
- Same-process multi-subject TRELLIS OOMs MPS. One OS process per subject (`#237`).
- Sampler knobs **are** forwarded by `factory:trellis:bake` (`trellis-bake-cli.ts:470-604` → `run_bake_isolated.py:132+`). Defaults remain vendor balanced. **Do not add sampler treatments to this cagematch** (OpenAI consult 2026-08-31).
- Debris (extra components) is from **generation**, not meshopt: raw and champion component counts match on the shoe (`#661`).

### TRELLIS export (inside `to_glb`)

Order is extract → optional `simplify(16_777_216)` cap → **`remesh`** → **`decimation_target`** (default 300_000). Hatch turns remesh **on**, `remesh_project=0` (smoother, less projection). Vendor/fal default remesh is often **true**; our control 973k raw implies remesh **off** or a high decimation target.

fal.ai: `remesh_project` 0 = no projection (smoother), 1 = full projection (preserves detail). Hatch uses 0. That is a **treatment**, not a law.

### meshopt (`iterate-optimize.ts`)

- Chain ratios plateau (~59k hard-surface). **Direct high-error from raw** is the proven break.
- Weld then same targets: 40k stays ~40k.
- Stretch 25k floors ~**34.4k** on this cart; meshopt can plateau ~**19.5k** on other subjects and then silhouette dies.
- Champion policy: **highest survival-ok tris ≤80k**, not lowest. 60k/80k may beat 34k on grade.
- `simplifySloppy` / `Prune` can eat casters (MADR 0050). Keep off.
- Interior-shell strip (MADR 0050 step 2) is still **unconsumed**. Highest-leverage unused step.

### Blender high-to-low (`hl_bake.py`)

- Cage: `objectDiagonal * 0.02` extrusion, `* 0.04` max ray. Derived, not picked.
- Map **512** is the economic rung (2048 costs more bytes than the triangles saved).
- **A map fixes shading, not silhouette.** If outline facets, stop decimating.
- Object-global cage produces a **dark rim at every raised-feature junction** on TRELLIS output (6/6 hatch subjects). **Not a default station.**
- Deviation / component-share / fragment-proximity all **failed** as bake-quality predictors. **The render is the oracle.**
- `use_selected_to_active=False` (same-mesh bump bake in `automate_blender.py`) is a **different job**. Do not reuse those settings.

### Failed treatments (name them so they are recognised)

| Failed | What it produced |
|---|---|
| Photoreal pack + meshopt | ~186k floor; dirty cracked unit |
| Chain 0.05 ratios after first cut | Plateau; barely moves tris |
| Force 25k as champion | Lumpy jacks; hyperopt |
| `--bake` object-global cage as quality default | Rim artifact class |
| Keep-largest as pipeline rule | Amputates multi-part assets (o2-port 51%) |
| Collaged multi-view as one image | TRELLIS fights itself |
| Grade from 600px contact sheet | False CLEAN |
| Workbench render of Principled colour | Grey-on-grey; wrong engine |

---

## 4. First principles (what “better” means)

A treatment wins only if **all** of these hold vs CONTROL low, on the **same EEVEE studio camera**:

| Column | Win | Falsify |
|---|---|---|
| **Likeness to Imagine pack** | Orchestrator native grade: same box/screen/pads/jacks/casters; closer pad/jack circularity than 34k stretch | Different object class; missing casters; screen collapsed |
| **Reprojection** | Re-render front / side / ¾L / ¾R from the GLB; LPIPS (or even pixel RMSE in linear) vs pack PNGs **lower than control** on ≥3 of 4 views | Worse on 3+ views |
| **Far-side** | If 4-view bake: far-side fill ≥ control 4-view measurement (0.44 class) | Hollow back if 4-view was the treatment |
| **Budget** | Tris ≤ **80,000** preferred. ≤40k only if likeness **≥** 80k sibling | 180k+ “win”; 19k faceted outline |
| **No new artifact class** | 1:1 crop of pad/jack junction: no new dark rim vs control | Rim, speckle collars, keep-largest amputation |
| **Land path** | Champion GLB + stills + `iteration-report.json` + `bake-measure.json` (`viewCount`) | Grade PNG only |

**Oracle split:** worker produces GLB + stills; **orchestrator grades pixels**. `min-bytes` and `--validate-latest` are necessary and not sufficient.

---

## 5. Treatments (12). Control/treatment TABLE, not a sequence to try first

Every row is a candidate. **Success is every column at once.** First green is the first that beats control on §4, not the first that is smaller.

Generation pack: reuse the **existing hard-surface 4-view pack** on disk if `viewCount` can be shown; if the control bake is 1-view, generate/confirm pack then bake once and freeze those 4 PNGs as **PACK_A** for all generation treatments.

| ID | Generation | TRELLIS export | Decimate | Blender | Why (first principles) | Known risk / failed cousin |
|---|---|---|---|---|---|---|
| **C0** | CONTROL as-is | as-is | meshopt stretch 34k | none | Baseline | Hyperopt cousin |
| **T1** | Same raw as C0 | none | meshopt **direct 80k** (policy champion) | none | 80k may look closer than 34k without new gen | — |
| **T2** | Same raw | none | meshopt **direct 60k** | none | Website preferred rung | — |
| **T3** | Same raw | none | **weld** then 80k | none | Split verts inflate counts | Over-weld UV islands |
| **T4** | Same raw | none | **interior-strip** (MADR 0050 §2) then 80k | none | Double walls steal budget | Prune/casters |
| **T5** | **4-view** `factory:trellis:bake` PACK_A | remesh **off** | meshopt 80k | none | 4-view is the unused factory capability | 1-view control may already be 4-view — measure `viewCount` first |
| **T6** | 4-view PACK_A | hatch **`--remesh` band=1 project=0** then meshopt 80k | none | TRELLIS remesh **before** meshopt (the “bake then remesh then decimate” station) | `project=0` smooths away Imagine edges |
| **T7** | 4-view PACK_A | remesh **project=1** then meshopt 80k | none | Project remesh back onto surface (fal) | Untested here |
| **T8** | 4-view PACK_A | remesh on, `decimation_target=300000` **then** meshopt 80k | none | Vendor export already decimates; don’t meshopt from 973k if 300k remesh exists | 300k may already destroy casters |
| **T9** | T1 or T5 80k champion | — | already low | **`--bake --bake-res 512`** high=raw low=80k | Formalized stage; recover shading after decimate | Object-global cage **rim** |
| **T10** | 80k | — | — | Bake with cage **diag×0.01 / ray×0.02** (half) | Rim hypothesis is cage too fat vs button thickness | May miss high peaks |
| **T11** | 80k | — | — | Bake **main component only** (join-off; skip fragments <10% share) | Rim from cross-component rays | o2-port class is multi-part; ECG cart should be 1-body |
| **T12** | 4-view remesh (T6 medium mesh as LOW) | remesh **is** the low | meshopt **after** bake | High=pre-remesh raw (if extract kept), low=remeshed ~300k, **then** meshopt mapped 80k | Experimental: Blender bake onto TRELLIS-remeshed topology **before** meshopt — closest to “bake before decimation” that physics allows | Need a pre-remesh dump; if `to_glb` never writes it, **instrument first** |

**Do not run T9–T12 until T1–T8 have stills.** Bake is expensive and the rim class is known. If T1/T2 already beat C0 on likeness at 60–80k, bake is optional polish.

**Skip unless T5 `viewCount` is 1:** repeating 4-view is wasted GPU.

**Photoreal 4-view** is a **negative control only** (one bake) if GPU budget remains — expected ~186k floor. Do not enter the winner table.

---

## 6. Instrumentation (build the smallest that makes a method fail)

Before variants:

1. **Stamp control:** copy both GLBs + Imagine pack + EEVEE stills into `.openclinxr/evidence/ecg-cart-4view-cagematch/<utc>/control/` with `measuredAgainstCommit` = `git rev-parse --short HEAD`.
2. **Read `bake-measure.json` if any** next to the 973k file: `viewCount`, `remesh`, `decimationTarget`. If missing, treat generation as **unknown 1-or-4**.
3. **Reprojection harness:** load GLB, render the four pack cameras (same as `render-glb-multiview-pack.py` elevations), write `front.png`… and a JSON of per-view LPIPS/RMSE vs PACK_A. Control numbers **first**.
4. **Junction crop:** 1:1 crop of one pad and one jack from each still (native px). Rim detector is the human; optional `ambiguousProjectionRate` stays unbuilt unless T9+ run.
5. **Tris / AABB / component count** via existing `iterate-optimize` `measureRung`.

Renderer for grade stills: **Blender EEVEE**, grey world + key/fill/rim, three-quarter **right**, 1280² — same as `9ac738c0`. Not Workbench. Not the dark grade lab.

---

## 7. Execution order (cheap first)

1. Instrument + **C0** numbers on the new stills (already on the site; re-run reprojection).
2. **T1, T2, T3** (no GPU TRELLIS; minutes). If T1 or T2 wins likeness at 60–80k, the “need 34k” story is dead.
3. Confirm PACK_A and `viewCount`. If control was already 4-view, skip T5.
4. **T5–T8** (one isolated TRELLIS process each; hours; D9 duration is allowed).
5. **T4** interior strip if T1–T3 lose budget to interior (measure component volumes first).
6. **T9–T12** only if shading loss at 80k is the remaining gap vs Imagine (raw is closer than 34k because of lumps, not because of missing 4-view).
7. Write `cagematch-report.v1.json`: per treatment tris, 4× reprojection, still paths, orchestrator grade, `beatsControl: bool`. **No winner required.**

Stop early if two consecutive treatments fail the same column for the same reason (e.g. remesh_project=0 always fillets pads): record class, do not grind the rest of that class.

---

## 8. What “optimized station” means if something wins

Promote **only** the row that beats C0 on §4:

- If T5/T6/T7 win: change **default equipment path** to 4-view bake ± remesh, then `iterate-optimize` champion ≤80k. Hatch already has remesh-then-optimize; equipment `factory:trellis:bake` should match.
- If T1/T2 win with old raw: **do not re-bake**; change champion policy on this cart to 60k/80k and replace the 34k website still.
- If T9 wins without rim: `--bake --bake-res 512` **after** champion, not before.
- If T12 wins: add a factory step “TRELLIS remesh → Cycles bake onto remesh → meshopt”, and **dump the pre-remesh mesh** from `run_bake_isolated.py` (that dump does not exist today — T12 is blocked on it).

Do not change the six protected docs. Do not claim Quest.

---

## 9. Research notes (external, labelled)

| Claim | Label | Source |
|---|---|---|
| TRELLIS.2 `to_glb(..., remesh=True, remesh_band=1, remesh_project=0, decimation_target=…)` is the reference export | VERIFIED | [microsoft/TRELLIS.2 README](https://github.com/microsoft/TRELLIS.2) |
| Hosted APIs default remesh **true**, decimation_target **500k–1M**, texture 2048 | VERIFIED | [fal.ai trellis-2](https://fal.ai/models/fal-ai/trellis-2/api), [Runware](https://runware.ai/docs/providers/microsoft) |
| `remesh_project` 0 = smoother, 1 = project onto original | VERIFIED | fal.ai parameter text |
| Multi-image TRELLIS.2 PR: stochastic vs multidiffusion; averaging can fatten/thin | VERIFIED | [PR #104](https://github.com/microsoft/TRELLIS.2/pull/104) — our path is sequence-concat, not that PR |
| Cage is an expanded **copy of the low**, rays high←low; bake **after** low exists | VERIFIED | game-bake practice (Marmoset cage docs; Blender selected-to-active) |
| Bake-before-decimate as “bake maps on high then simplify high” is NOT selected-to-active | INFERRED | would be same-mesh bake; repo already distinguished this from `hl_bake.py` |

---

## 10. Anti-toil / visibility

- This is **Lane C**. One bake-off. After the report, next work is **promote the winner into `factory:trellis:*` or record none-won**.
- Evidence lives under `.openclinxr/evidence/ecg-cart-4view-cagematch/` (gitignored). `done_when` for any later board card must name a **tracked** report JSON + website stills if the Factory page changes.
- Website stills only update if a treatment beats C0 on native grade. Do not publish a darker lab capture again.

---

## 11. Recommended next (after this document)

1. Copy CONTROL into the evidence dir; print `viewCount` / remesh from any adjacent `bake-measure.json`.
2. Run T1 and T2 (80k / 60k from control raw). Grade against Imagine + C0 stills.
3. Only then spend a TRELLIS 4-view process.

Recommended next: **C1 same-source 59,187 vs C0 34,443, frozen C0 camera (Q5)**.

BothyBoard (2026-08-31):
- Parent Idle (do not plant): `tsk_df0b9db03e0e9afc` — markdown SSOT
- First child Planted+ready: `tsk_ddac264a23ad361f` — C1 vs C0 TREE on `85170af3`
- RED: `tools/openclinxr/evidence/the-ecg-cart-c1-density-falsifier-has-been-graded.test.ts`
- Freeze: `tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json` (GLBs gitignored; SHA-256 is the land path)

---

## 12. OpenAI consult (2026-08-31) — cuts this matrix

No `OPENAI_API_KEY` on this machine (Conversations REST API unavailable). Consult used the repo’s OpenAI path: **Codex `gpt-5.6-sol`**, ChatGPT login, `codex exec` session **`01a05910-dc92-73a1-aa68-ef5a168c9f8d`**, two turns (`high` reasoning, read-only). Transcripts: gitignored Codex exec notes for that session (not in-tree).

**Verdict: rewrite the treatment matrix; keep the exact control and cheap-first order.**

| Finding | Action |
|---|---|
| T6 hatch is 1-view, not PACK_A | Cut as written |
| T7 `remesh_project` hard-coded 0 | Unreachable without a runner change |
| T8 duplicates T6 export (`decimation_target` default 300k) | Cut |
| T2 60k: same-source **59,187** already on disk | Use as **C1**, do not re-run until density is falsified |
| Path: `apps/arena/model-vetting-studio/public/glb-grade-staging/2026-08-11T01-57-18Z/ecg-cart-r0_005.glb` | NodeIO 59,187; positions subset of 973,639 raw; textures SHA-match raw+champion |
| LPIPS as win column | **Lead only** until it rejects #56-class wrong pixels |
| AABB-refit hides extent change (`render-glb-multiview-pack.py:153`) | Record C0 center+radius once; reuse; do not pin a full matrix |
| “Bake before decimate is impossible” | Too broad. Selected-to-active needs a low mesh; `HIGH → intermediate LOW → bake → further simplify` is legal. T12 is not the only cousin. Safer: bake onto the **final** low |
| Midband 974k/60k as substitute | Trap (pack+seed+gen+opt all change) |

**Six rows Codex would actually run:**

| ID | Treatment |
|---|---|
| C0 | Exact 973,639 + 34,443; frozen C0 camera/lights |
| C1 | Existing 59,187 chain rung; zero-build density falsifier |
| M1 | Direct high-error 80k from exact C0 raw |
| G1 | PACK_A 4-view, fixed seed, remesh off, then direct 80k |
| G2 | Same PACK_A+seed, remesh project=0 + 300k export, then direct 80k |
| B1 | Bake the winning 80k vs its unbaked sibling at 512; last because rim class is known |

Cut from this bake-off: weld-80k, interior-strip, project=1, half-cage, component filter, pre-remesh bake.

Cheapest falsifier: render C1 beside C0 with **non-refitted** cameras. If 59k does not repair jacks/pads, the “60–80k rescues likeness” premise dies before GPU TRELLIS.

---

## 13. Research: Babylon WebXR medical PoC vs “bake before decimate”

Source (verbatim process, Lay84, 2022-07-06):
[forum.babylonjs.com/t/webxr-medical-simulation-proof-of-concept/31965](https://forum.babylonjs.com/t/webxr-medical-simulation-proof-of-concept/31965)

> In Blender, I imported the env, then characters, **baked lightmaps, decimated and optimized the meshes down to 20% of originally polycounts**, merged and packed UVs, **baked shaders into babylon friendly PBR shaders**, merged meshes, **optimize character blend shapes** … and **created texture atlases** to reduce draw calls and improve framerates.

Demo: https://web-xr-med-sim.vercel.app/sim/demo — Unity/Sketchfab/CC3 **authored** assets, not TRELLIS.

### What that post actually proved

| Step | What it is | Not |
|---|---|---|
| Bake lightmaps **on the dense mesh** | Lighting/AO into textures while there is still geometry to sample | High-to-low **normal** transfer onto a missing low |
| Then decimate to ~20% | Same as our meshopt, after maps exist | A reason to run `hl_bake.py` first |
| Then pack UVs / atlas / merge | Draw-call / fill-rate (skill already ranks this above −15k tris) | Triangle-count champion |

That **is** bake-before-decimate in the **lightmap/shader** sense. It is the game-art default: capture appearance on HIGH, throw away polygons, keep UVs. It does **not** prove selected-to-active normals before a low mesh exists.

### What this repo already did under the same words

Card title `#694` / test `the-optimize-path-can-bake-before-it-decimates.test.ts` landed a **different** operation:

- `iterate-optimize.ts --bake`: Cycles **selected-to-active** `hl_bake.py` of **raw HIGH onto an already-decimated LOW** (`:271-333`, `:499`).
- `--target <low.glb> --bake` runs that **without the ladder** — bake onto a low you already have, not bake then create the low.
- Shoe sweep (`shoe-rung-sweep.json`): **60k unmapped beats shipped 80k**; **map lost at 25k, 40k, and 60k** (outline faceted; heel-collar streaks). Champion `59999`, `championMapped: false`.
- Pulse-oximeter **hand-run** 25k+512 was the one place a map **won** (boxy FORM). Stage later reproduced 25k pairs; grade still `inconclusive_blocked` for appearance.

So “we formalized bake before decimate” = we **named** the card that, then **wired bake after LOW exists**. The Babylon post is the other order (lightmaps on HIGH, then 20% decimate).

### What the ECG control already has (TRELLIS export)

`to_glb` unwraps and bakes voxel PBR onto the **high** mesh (`texture_size` default 2048; control inspect: 1024 baseColor + metallicRoughness, `TEXCOORD_0` on both 973,639 and 34,443). Meshopt **kept UVs**. That is already “texture bake on HIGH, then decimate.” The 34k still looks lumpy because **silhouette** was destroyed — a lightmap cannot grow a circular jack back.

### Treatments this source actually adds (not T9)

| ID | Do | Why | Falsify |
|---|---|---|---|
| **L1** | Blender **AO / combined lightmap** on C0 **HIGH** (same UVs), then meshopt 80k **without** rebaking UVs | Babylon order: appearance on dense mesh, then 20% | If 80k+AO still has faceted jacks, lighting was not the deficit |
| **L2** | Same as L1 then **atlas/merge** (one material) | Draw calls, not tris — the post’s other win | Grade must stay the cart; atlas bleed |
| **N1** | #694 `--bake` onto **C1 59,187** (boxy cart, FORM says maps can help) vs C1 bare | Pulse-oximeter class, not shoe | Rim at pad/jack junctions → lose |

Do **not** treat the Vercel demo as a TRELLIS control. Different generator, authored UVs, hand-staged lighting.

claimScope: process text from that thread + #694 sweep numbers.  
notEvidenceFor: that lightmaps on this cart will beat C0; that Babylon Toolkit export is in our factory.
