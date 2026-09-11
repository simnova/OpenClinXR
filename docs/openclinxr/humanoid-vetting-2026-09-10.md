# HB-04 v2 — Vet the baked humanoid GLB as an artifact

Measured 2026-09-11. Status: GREEN on the three done_when rules.

## Objective

Validate the baked, decimated humanoid by handing the GLB to the humanoid-vetting
harness. Never by inspecting the factory's Blender scene.

## What was vetted

Two baked bodies plus the named street exception:

| body | bytes | triangles | live rung | self-check |
|---|---|---|---|---|
| `mpfb-clinical-nurse-adult.glb` | 8833188 | 39017 | raw, promoted, no rewrite | agrees, relErr 0.00043 |
| `mpfb-peds-patient-child.glb` | 11348244 | 77324 | raw, promoted, no rewrite | agrees, relErr 0.00043 |
| `mpfb-street-adult-male.glb` | 15830960 | 115552 | raw, HB-03 exception (owned by `tsk_2a6935fb4eb63f95`) | agrees, relErr 0.00025 |

Triangle counts and byte sizes are computed from the live GLB bytes in the test and
required to equal HB-03's `raw` rung measurement for that body in
`docs/openclinxr/humanoid-postopt-ladder-2026-09-10.json`. The test derives the live
rung from `promoted`, never from `chosenRungId`.

## Clause results

1. **Factors.** Every material of each live GLB is read from the GLB JSON chunk in the
   test. Textured materials carry `baseColorFactor [1,1,1]`, except the street body's
   `mat_makeclothes_library_toigo_t_shirt` at `[0.34,0.44,0.34]`, the named exception:
   unbaked, owned by `tsk_2a6935fb4eb63f95`, with the HB-00 deliberate-palette verdict
   (`closed_casual` at `automate_blender.py:1764`). Untextured flat colours are the albedo
   itself, not a tint.
2. **Rung.** Live triangles and bytes equal the HB-03 `raw` measurement per body (table
   above). Shown failing by pointing the check at `r0.1`; the ladder's own r0.1 rung
   measures fewer triangles and the equality refuses.
3. **Subject alone.** No mesh or node in any vetted GLB is named like
   ground/floor/plane/backdrop/studio/room/lamp/light, and no `KHR_lights_punctual`
   lights exist. The grid floor in the PNGs is the studio capture backdrop, not GLB
   geometry. Lit-vs-structure PNGs differ (the tool's pixel-diff guard passes;
   `imageCount: 4` per body).
4. **Lit luma on the subject.** The structure pass is the subject mask (mask floor
   luma 40, figure-band rows 3–88%): median lit luma inside the mask exceeds the
   background median outside it — nurse 109.9 vs 29.9, child 163.2 vs 29.9, street
   61.0 vs 29.9. Corners are never sampled.
5. **Feet.** Footwear mesh minimum and global minimum are computed from the bytes
   (HB-01's method: per-primitive world minY via node world matrix) and coincide at
   minY 0 for every vetted MPFB body.
6. **Engine.** The GLB harness renders through three.js in Chromium via Playwright;
   the page reports WebGL `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device
   (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)` on Chromium 147.0.7727.15
   (Playwright 1.59.1), stored in the report's `harness` block. The Blender
   WORKBENCH fallback lives in `finished_figure_grade.py`, outside this card's write
   roots: not edited, not exercised, recorded here instead of asserted.

Sidecar: sha256 of each live GLB equals its provenance sidecar's `outputSha256` and
byte length equals `outputBytes`, computed in the test
(`write-shipped-licence-notice.ts --check` also passes fresh).

## Captures

Produced with the real `--glb` CLI after the harness fix below (run
`.openclinxr/evidence/glb-grade-capture/2026-09-11T06-16-17Z`, gitignored by design),
then copied to tracked `docs/openclinxr/humanoid-vetting-captures/` (12 PNGs,
4096x4096 rendered, sha256 in the JSON report). The orchestrator grades the pixels;
this card issues no visual verdict.

## Harness fix

`model-vetting-glb-grade-capture.ts:746` referenced `browserPageWindow` inside a
Playwright `page.waitForFunction` callback. That alias is types-only
(`browser-dom.d.ts` declares it; nothing defines it in the page), so the callback
threw `ReferenceError: browserPageWindow is not defined` on every body. Introduced
by `a9e2510f` (2026-09-04 typecheck baseline). Fixed in place with `globalThis`;
remaining `browserPageDocument` uses are Node-side locals, not page callbacks.
Machine-readable detail: `docs/openclinxr/humanoid-vetting-2026-09-10.json`.

## Retired gate

`tools/openclinxr/evidence/street-humanoid/the-isolated-grade-bake-has-ambient-world-light.test.ts`
is SUPERSEDED by this report plus the humanoid-vetting test. Its clauses stay green
on config text and corner pixels; the replacement asserts GLB bytes and studio
renders. The file keeps an inverted guard naming the replacement and is not deleted.

## Claim scope

Browser three.js render with independent geometry self-check. Not evidence for Quest
3 worn readiness, clinical accuracy, learner runtime adoption, or a visual grade
verdict.
