# MADR 0055: Room realism is a material problem, not a geometry problem

Status: Proposed
Date: 2026-08-12
Issue: #342, #339, #336
Related: MADR 0053 (Infinigen environmentId learner consumer), #343 (MPFB skin bake — the proven texture path)

## Context

Operator, 2026-08-12: *"review the complexity of what is generated with the ideal complexity cap
we've put in place — and techniques to achieve high quality without making everything look like
fisher-price."*

The premise inside that question — that a complexity cap is what constrains room quality — was worth
testing before designing against it. It does not survive measurement.

## Measured, 2026-08-12, on the shipped assets

| asset | tris | meshes | materials | **textured** | **lights** |
|---|---:|---:|---:|---:|---:|
| `ed-exam-bay-shell.glb` (parametric) | **492** | 41 | 15 | **0** | 0 |
| `infinigen-ed-exam-bay.glb` (**shipped**) | **440** | 4 | 3 | **0** | **0** |
| infinigen dining-room (generator, raw) | **15,650,564** | 159 | 175 | 13 | 6 |

**We ship 440 triangles of a 15,650,564-triangle generator output — 1 in 35,570.**

The only budget figure anywhere near this is the Quest ~180,000-triangle target, which has **never
been validated on hardware**, and the standing directive is explicit: *no generated output is gated
on triangle count — meshoptimizer runs later in the pipeline.* So 440 is not a budget decision. It is
what the hull extraction happened to keep.

## Decision

**Stop treating room quality as a polygon-budget question. Treat it as a material and light-transport
question.**

The Fisher-Price look is three zeros — zero textures, zero lights, three materials — not a low
triangle count. A 492-triangle room with baked albedo and ambient occlusion reads as a room. A
50,000-triangle untextured one still reads as a toy.

## Why this is credible rather than a guess

**The texture path is already proven in this repo, on this exporter, this week.** #340 bound a
610,817 B iris texture to every actor's eyes; #343 established that Blender 5.1's glTF exporter does
**not** bake a procedural node tree (flat `[1,1,1,1]` on export) while an explicit **Cycles DIFFUSE
bake does** produce a `baseColorTexture` that survives export — and shipped 738,178 / 755,748 /
744,293 B skin textures on the three MPFB actors. That bake gave aisha a face with eyelids, lashes,
brows and lips where every prior round rendered a blank mask.

The humanoid rail proves the mechanism end to end. **The environment rail has never used it.**

## The work, ranked by leverage against effort

1. **Bake lighting and AO into the albedo.** Largest single lever, zero triangles, zero runtime cost.
   Contact darkening where wall meets floor, under the bed, in corners. Every room currently ships
   with no lights at all, so every surface is flat-lit and scaleless.
2. **Decimate instead of extract.** Take the generator's *full* output and run
   meshoptimizer/quadric simplification to budget, preserving UVs and normals — rather than a hull
   extraction that discards 175 materials, 13 textures, 6 lights and all UVs. This is the D1 move:
   wire the proven tool rather than hand-roll the reduction. Duration is not a constraint (D9), so a
   multi-hour bake is acceptable.
3. **Differentiate materials.** Vinyl floor (low roughness, seams), matte gypsum walls, stainless
   fixtures (metallic 1.0), glass, curtain fabric. Three materials is why every surface reads as the
   same plastic. Costs no geometry.
4. **Trim the corners.** Skirting board, door reveals, a ~2 cm chamfer on wall edges — perhaps 200
   triangles total. Perfectly sharp untrimmed 90° corners are the strongest single "toy" cue, because
   real rooms have trim everywhere and trim catches light.
5. **Scale-setting props.** Outlet plates, light switches, gel dispenser, whiteboard, curtain track.
   The eye calibrates room size from objects of known size; without them a room has no scale
   regardless of its measured area. Bears on #342 — the ED bay measuring 50.1 m² may read wrong
   partly because nothing in it establishes scale.
6. **Atlas the generator's materials.** Bake 175 materials down to a handful of atlased ones —
   standard game-art workflow, native in Blender — which is what makes (2) shippable.
7. **Constrain the generator to clinical props.** Infinigen's solver is producing dining rooms. A
   clinical prop library plus its constraint DSL is a separate question from geometry budget.

## Consequences

- The room lane has been optimising the wrong axis. Every measurement says the geometry ceiling is
  untouched and the floor is texture and light.
- Items (1), (3), (4)+(5) and (2)+(6) have **disjoint write scopes** and can run in parallel.
- A contract now exists: `tools/openclinxr/evidence/a-room-is-lit-and-textured.test.ts` — every
  shipped environment must carry a textured material that is not a single-colour fill, with triangle
  count pinned as a regression net so the RED cannot be satisfied by subdividing a flat box.

## What this decision does NOT claim

- **It does not claim a textured room will grade clean.** Palette, scale, trim and contact shadows
  are separate, and only a pixel grade settles them.
- **It does not settle room DIMENSIONS.** #342 (ED bay at 50.1 m²) and the Infinigen control audit
  (#339: hard `area().in_range()` expressible; absolute W×D and door-on-named-wall not) are unchanged
  by this decision.
- **It does not validate the Quest budget.** The ~180k figure remains unmeasured on hardware, and
  nothing here should be read as headroom confirmed.
- **It does not assert glTF light extensions.** Baked AO in the albedo needs no light node; whether
  the runtime should also carry punctual lights is a separate question and bundling it would make one
  proof stand for two mechanisms.
