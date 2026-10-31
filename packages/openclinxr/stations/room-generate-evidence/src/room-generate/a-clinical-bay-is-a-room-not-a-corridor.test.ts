import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { KHRTextureTransform } from "@gltf-transform/extensions";
import { describe, expect, it } from "vitest";
import { repoRoot } from "@openclinxr/factory-station-core/runner";
import { floorSlabExtents, measureInteriorClear } from "../../../../../../tools/openclinxr/evidence/room-bake/room-interior-clear.js";

/**
 * **The room promoted as a paediatric urgent-care bay is a 9.9 metre corridor.**
 *
 * Measured on the shipped bakes 2026-08-14, per-node world extents:
 *
 *   room                                 | source node   | X x Z (m)      | aspect
 *   -------------------------------------|---------------|----------------|--------
 *   **infinigen-pediatric-urgent-care-bay** | `hallway_0`   | **9.88 x 4.88** | **2.02**
 *   infinigen-ed-exam-bay                | `dining-room_0` | 6.38 x 6.38    | 1.00
 *
 * The generator was asked for a clinical bay and the extraction took a HALLWAY. It is enclosed, it has
 * a floor, walls, a ceiling and (since #406) a genuine offset hull — every existing contract passes.
 * It is simply the wrong KIND of space.
 *
 * ## THE FUNCTIONAL CONSEQUENCE, MEASURED — not an aesthetic complaint
 *
 * `deriveInteriorPreviewCamera` stands the eye against the doorway-side wall and then maximises
 * distance to the nearest actor. In a 9.9 m corridor that pushes the viewpoint to one end:
 *
 *   station | camera x | nearestActor
 *   --------|----------|-------------
 *   peds    |  -4.64   | **3.71 m**
 *   ED      |  -3.00   |   1.98 m
 *
 * The learner's framing is nearly **twice** as far from the cast, down the long axis, with the far end
 * ~10 m away. A clinical encounter is conducted at conversational distance; a corridor cannot produce
 * one however well it is lit.
 *
 * ## WHAT I AM NOT CLAIMING (§7q)
 *
 * The graded frame also shows **a large black rectangle filling roughly a third of the viewport**
 * behind the cast. The corridor geometry is a plausible explanation — the far end is ~10 m from the
 * eye — and **that is a hypothesis, not a measurement.** It is deliberately NOT asserted here and NOT
 * filed as a mechanism. If the fix produces a room-shaped bay and the rectangle survives, it was
 * something else.
 *
 * ## THE BOUND IS DERIVED FROM THE KNOWN-GOOD (§9h/§9s)
 *
 * No invented literal: the allowance is `ALLOWANCE x edBayAspect`, recomputed from the shipped ED bay
 * at test time. On today's bytes that is `1.5 x 1.00 = 1.50`, and the peds room measures **2.02**, so it
 * fails by **1.35x**. The margin was computed before the bound was written; this is not a threshold
 * fitted to clear an observation.
 *
 * A square room is not required — 1.5 is deliberately generous, because real clinical bays are
 * rectangular. What it refuses is a corridor.
 *
 * **NO TRIANGLE GATE** — meshoptimizer runs later and the ED bay is a good room at 440 tris.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) aspect | (2) size | (3) known-good | result
 *   ----------------------------------------------------|------------|----------|----------------|--------
 *   a) today — hallway_0                               |  **FAIL**  |   pass   |      pass      | REFUSED
 *   b) crop the corridor to a 4.88 x 4.88 stub         |    pass    | **FAIL** |      pass      | REFUSED
 *   c) stretch the ED bay's aspect so 2.02 looks normal |  **FAIL**  |   pass   |   **FAIL**     | REFUSED
 *   d) extract a room-shaped space from the generator   |    pass    |   pass   |      pass      | ALL PASS
 *
 * **(b) is the one to watch.** Trimming the long axis satisfies an aspect check instantly and leaves a
 * room too small to stage three actors and a bed. Clause (2) requires the floor area to stay within a
 * band of the ED bay's, so the fix cannot shrink its way to green.
 *
 * **(c) is why clause (3) exists** — the comparison is against a shipped asset, so degrading the
 * reference is the other way to fake it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** **(2) and (3) pass today** and are
 * true nets. **(4) passes today** and guards vacuity.
 *
 * NOT TESTED:
 *   - **That a room-shaped bay renders well.** Pixel grade, done from a fresh capture afterwards.
 *   - **The black rectangle.** See above — hypothesis only.
 *   - **Clinical adequacy of any particular dimension.** No clinical claim is made; this asserts a
 *     shape relation against another shipped room, nothing more.
 *   - **The other 13 environmentIds**, which have no generated room at all.
 *   - **Whether `hallway_0` is the right extraction for a genuine corridor station**, if one is ever
 *     authored. This contract enumerates the mapped table, so such a station would need its own row.
 */

const REPO_ROOT = repoRoot();
/** Overridable so a destructive probe can point the same logic at doctored assets. */
const PUBLIC = process.env.OPENCLINXR_ROOM_PROBE_PUBLIC ?? join(REPO_ROOT, "apps/ui-xr/public");
const MODULE_SRC = join(REPO_ROOT, "packages/openclinxr/xr-runtime-state/src/infinigen-environment-assets.ts");
/** Live declaration of every room footprint (Oct1 authority; see re-key note below). */
const RECIPES_SRC = join(REPO_ROOT, "packages/openclinxr/factory-stations/src/room_chain/recipes.ts");

const KNOWN_GOOD_ENV = "pediatric_urgent_care_bay_v1";
/** Generous: real bays are rectangular. This refuses a corridor, not a non-square room. */
const ALLOWANCE = 1.5;
/** Floor area must stay within this band of the known-good's, so a fix cannot shrink to pass. */
const AREA_BAND = 2;
/** The declared-elongation floor: the gin aspect_ratio_range floor, kept as the minimum intent. */
const DECLARED_ASPECT_MIN = 2.0;

type Room = {
  env: string;
  /** Interior-clear footprint from the wall inner faces — the declared quantity (see measure). */
  x: number;
  z: number;
  aspect: number;
  area: number;
  /** Raw shell floor-slab AABB diagnostic (includes the correct doorway threshold tab). */
  floorX: number;
  floorZ: number;
  floorArea: number;
};

function tableRows(): Array<{ env: string; url: string }> {
  const src = readFileSync(MODULE_SRC, "utf8");
  const block = /INFINIGEN_ENVIRONMENT_ASSETS[^{]*\{([\s\S]*?)\n\} as const/u.exec(src)?.[1] ?? "";
  return [...block.matchAll(/^\s*([a-z0-9_]+)\s*:\s*"([^"]+)"/gmu)].map((m) => ({ env: m[1]!, url: m[2]! }));
}

/**
 * Recipe-declared footprints, parsed from the Oct1 room-chain authority
 * (`ROOM_CHAIN_RECIPES.footprintMeters`). Text-parsed like `tableRows`
 * parses the assets module, so this contract takes no dependency on the
 * producer's TS graph — the file is read as evidence, not imported.
 */
function recipeFootprints(): Map<string, { width: number; depth: number; ceilingHeight: number }> {
  const src = readFileSync(RECIPES_SRC, "utf8");
  const out = new Map<string, { width: number; depth: number; ceilingHeight: number }>();
  for (const m of src.matchAll(
    /^\s*([a-z0-9_]+):\s*\{(?:[^{}]|\{[^{}]*\})*?footprintMeters:\s*\{\s*width:\s*([0-9.]+),\s*depth:\s*([0-9.]+),\s*ceilingHeight:\s*([0-9.]+)\s*\}/gmu,
  )) {
    out.set(m[1]!, { width: Number(m[2]!), depth: Number(m[3]!), ceilingHeight: Number(m[4]!) });
  }
  return out;
}

const recipeAspect = (f: { width: number; depth: number }): number =>
  Math.max(f.width, f.depth) / Math.min(f.width, f.depth);

async function measure(row: { env: string; url: string }): Promise<Room | null> {
  const abs = join(PUBLIC, row.url.replace(/^\//u, ""));
  if (!existsSync(abs)) throw new Error("missing artifact");
  const doc = await new NodeIO().registerExtensions([KHRTextureTransform]).readBinary(readFileSync(abs));
  // CORRECTED (2026-10-20): the footprint is the wall-inner-face interior clear, never the floor
  // AABB. The shell floor runs through the doorway opening to the outer wall face (the threshold
  // tab, +0.11 m on the door wall only — facade-executed Blender probe: inpatient interiorClear
  // 4.300 x 3.900 exact, only in-door-band floor verts reach the outer face). The earlier reading of
  // the floor AABB as the room footprint measured the tab, not drift; no geometry regen is warranted.
  // Port of the generate-step source probe (probe_door.py wall-plane derivation) via
  // room-bake/room-interior-clear.ts: exact planes, world transforms, finish dressing excluded.
  // Missing wall planes THROW (fail-closed). No recipe values, no wall-thickness subtraction.
  const clear = measureInteriorClear(doc);
  // The raw slab is preserved as a diagnostic and the actual area signal — the tab is correct
  // construction, and it is real floor area. It is simply not the interior-clear quantity.
  const slab = floorSlabExtents(doc);
  if (slab === null) return null;
  const x = clear.width;
  const z = clear.depth;
  return {
    env: row.env,
    x,
    z,
    aspect: Math.max(x, z) / Math.min(x, z),
    area: x * z,
    floorX: slab.width,
    floorZ: slab.depth,
    floorArea: slab.area,
  };
}

const rooms = (await Promise.all(tableRows().map(measure))).filter((r): r is Room => r !== null);
const recipes = recipeFootprints();

/**
 * Rooms whose RECIPE declares elongation beyond the generic gate are judged
 * against their own declaration, not the peds-relative allowance: a room
 * whose own approved footprint is 6.2x3.25 cannot be refused for matching it.
 * The rule is derived from the recipe (exceeds ALLOWANCE x peds-recipe
 * aspect), not from any room's measured aspect — no name list is fitted.
 */
function declaredElongationEnvs(): Map<string, number> {
  const peds = recipes.get(KNOWN_GOOD_ENV);
  if (!peds) throw new Error(`recipe footprint missing for ${KNOWN_GOOD_ENV}`);
  const gate = ALLOWANCE * recipeAspect(peds);
  const out = new Map<string, number>();
  for (const [env, f] of recipes) {
    const a = recipeAspect(f);
    if (a > gate) out.set(env, a);
  }
  return out;
}

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireRooms(): { all: Room[]; good: Room } {
  expect(rooms.length, "rooms measured from INFINIGEN_ENVIRONMENT_ASSETS").toBeGreaterThanOrEqual(2);
  const good = rooms.find((r) => r.env === KNOWN_GOOD_ENV);
  expect(good, `${KNOWN_GOOD_ENV} present as the known-good column`).toBeDefined();
  return { all: rooms, good: good as Room };
}

describe("a clinical bay is a room, not a corridor", () => {
  it("(1) RED: every non-declared-aspect room's floor aspect is within the room-shaped known-good's, generously", () => {
    const { all, good } = requireRooms();
    const declared = declaredElongationEnvs();
    const allowed = ALLOWANCE * good.aspect;
    const bad = all.filter((r) => !declared.has(r.env) && r.aspect > allowed);
    expect(
      bad.map((r) => `${r.env} ${r.x.toFixed(2)}x${r.z.toFixed(2)} m aspect ${r.aspect.toFixed(2)}`),
      `allowed ${allowed.toFixed(2)} (${ALLOWANCE}x the peds bay's ${good.aspect.toFixed(2)}); declared-elongation rooms (${[...declared.keys()].join(", ")}) are judged against their own recipe`,
    ).toEqual([]);
  });

  it("(1b) RED: the declared-aspect ED bay actually achieves its declared elongation", () => {
    // The ED bay's live declaration is its recipe footprint (5.882x2.882,
    // aspect 2.041 — at/above the retired gin floor of 2.0, so both the old
    // declared-minimum intent and the recipe declaration are kept). It must
    // measure at least its declared elongation — not quietly revert to a
    // square to dodge the band above. CORRECTED (2026-10-20): the footprint
    // is the wall-inner-face interior clear (5.882x2.882 exact), never the
    // floor AABB. The earlier RED (shell floor 5.882x2.992, aspect 1.966)
    // measured the doorway threshold tab (+0.11 m on the door wall only,
    // correct construction — facade-executed Blender probe refutes the
    // instrument-review's producer depth defect: interiorClear 4.300x3.900
    // exact, no geometry regen warranted). No matcher slack, no tolerance
    // widened: the ruler was reframed to the declared quantity.
    const { all } = requireRooms();
    const ed = all.find((r) => r.env === "ed_exam_bay_v1");
    expect(ed, "ed_exam_bay_v1 present as the declared-aspect bay").toBeDefined();
    const recipe = recipes.get("ed_exam_bay_v1");
    expect(recipe, "ed_exam_bay_v1 recipe footprint present").toBeDefined();
    expect([recipe!.width, recipe!.depth], "ED recipe footprint rewritten").toEqual([5.882, 2.882]);
    const declared = Math.max(recipeAspect(recipe!), DECLARED_ASPECT_MIN);
    expect(ed!.aspect, `ED bay interior-clear aspect must reach its declared ${declared.toFixed(3)} (floor slab ${ed!.floorX.toFixed(3)}x${ed!.floorZ.toFixed(3)} m recorded as diagnostic)`).toBeGreaterThanOrEqual(declared);
  });

  it("(1c) RED: the declared-elongation stepdown room actually achieves its declared elongation", () => {
    // stepdown_room_v1's recipe declares an ICU footprint of 6.2x3.25
    // (aspect 1.908) — an elongated room by declaration, not a corridor by
    // accident. It is exempt from the generic gate by rule (recipe aspect
    // exceeds the allowance) and judged against its own declaration instead.
    // CORRECTED (2026-10-20) as in (1b): interior clear 6.2x3.25 exact; the
    // earlier RED (floor 6.20x3.36, aspect 1.845) measured the threshold tab.
    const { all } = requireRooms();
    const step = all.find((r) => r.env === "stepdown_room_v1");
    expect(step, "stepdown_room_v1 present as a declared-elongation room").toBeDefined();
    const recipe = recipes.get("stepdown_room_v1");
    expect(recipe, "stepdown_room_v1 recipe footprint present").toBeDefined();
    expect([recipe!.width, recipe!.depth], "stepdown recipe footprint rewritten").toEqual([6.2, 3.25]);
    const declared = recipeAspect(recipe!);
    expect(declared).toBeGreaterThan(ALLOWANCE * recipeAspect(recipes.get(KNOWN_GOOD_ENV)!));
    expect(step!.aspect, `stepdown interior-clear aspect must reach its declared ${declared.toFixed(3)} (floor slab ${step!.floorX.toFixed(3)}x${step!.floorZ.toFixed(3)} m recorded as diagnostic)`).toBeGreaterThanOrEqual(declared);
  });

  it("(2) COUNTERWEIGHT: a room may not shrink its way to a good aspect", () => {
    // Refuses (b). Cropping the long axis clears clause (1) instantly and leaves a space too small to
    // stage a cast and a bed. The raw shell floor slab is the actual area signal here (it includes the
    // threshold tab — real floor area, correct construction), so the fix cannot shrink its way to green.
    const { all, good } = requireRooms();
    for (const r of all) {
      expect(r.floorArea, `${r.env} floor-slab area ${r.floorArea.toFixed(1)} m2 vs peds bay ${good.floorArea.toFixed(1)} m2`)
        .toBeGreaterThanOrEqual(good.floorArea / AREA_BAND);
    }
  });

  it("(3) COUNTERWEIGHT: the room-shaped known-good peds bay keeps its measured shape", () => {
    // Refuses (c). The bound is a function of this room, so stretching it widens the gate for everyone.
    // Interior clear 5.39x5.28 (aspect 1.021, area 28.46 m2); slab 5.39x5.39 (area 29.05 m2).
    const { good } = requireRooms();
    expect(good.aspect, "peds bay interior-clear aspect, measured 1.021").toBeLessThanOrEqual(1.2);
    expect(good.area, "peds bay interior-clear area, measured ~28.5 m2").toBeGreaterThanOrEqual(28);
  });

  it("(4) VACUITY GUARD: no mapped room is corridor-shaped after the re-bake", () => {
    // #407: the re-bake removed the corridor class, so the guard flips from "a corridor exists
    // today" to "no room is a corridor" — the ≥2-population requirement in requireRooms is what
    // stays non-vacuous (same re-scope the #406 stand-off guard took).
    const { all, good } = requireRooms();
    const declared = declaredElongationEnvs();
    const allowed = ALLOWANCE * good.aspect;
    expect(all.filter((r) => !declared.has(r.env) && r.aspect <= allowed).length, "room-shaped rooms after the re-bake").toBeGreaterThan(0);
    expect(
      all.filter((r) => !declared.has(r.env) && r.aspect > allowed).length,
      "corridor-shaped rooms after the #407 re-bake (declared-elongation rooms excepted by recipe rule)",
    ).toBe(0);
  });
});

/**
 * ## FIXED (#407) — a room-shaped space, re-baked and oriented
 *
 * Flips (1) from RED to green; (2) and (3) stay nets as planted; (4) is re-scoped to
 * "no mapped room is corridor-shaped" — the same re-scope #406's vacuity guard took when a
 * genuine re-bake removed the broken class.
 *
 * ### The new bake (fully deterministic, same chain as #405/#406)
 *
 * - Generate: `clinical_bay.gin` seed **13**, coarse, `compose_indoors.terrain_enabled=False`
 *   (the proven invocation; seeds 3/4/5/9/11/12 crash on upstream Infinigen flakes — the
 *   #406-documented utility-room material flake plus `Concrete.generate() got an unexpected
 *   keyword argument 'vertical'`; seeds 1/2/6/7/8/10/13 complete).
 * - Room: `kitchen_0` segment 0 — single enclosed segment (the #405 multi-segment union
 *   rejection applies; seed 13's kitchen is the ONLY room-shaped single-segment room among
 *   the seven completing seeds that carries a horizontal hull).
 * - Extract: `infinigen-single-room-extract.py --room kitchen --segment 0 --yaw-deg 90` —
 *   the extract step's new deterministic orientation flag rotates the room about the up axis
 *   BEFORE centering, so the room's genuine outer wall (measured hull 0.1093 m) faces the +Z
 *   side that `deriveInteriorPreviewCamera` and the #406 stand-off contract use. Geometry is
 *   Infinigen's; the rotation is a transform only (D1).
 * - Bake: Cycles DIFFUSE albedo+AO (`room-albedo-ao-bake.py`, 1024 px) then native AO
 *   occlusion (`room-occlusion-bake.py`, 512 px) — the same two-stage texture pipeline as
 *   #405/#406. No literal/clamped stand-off.
 * - Shipped: `apps/ui-xr/public/xr-assets/environment/infinigen-pediatric-urgent-care-bay.glb`
 *   (SHA-256 `1783f4687902fd317bf929094cd5b5d822a6bb337445e9584fb3899e3fad68ab`).
 *
 * Measured from the shipped GLB with this file's own `measure`:
 *
 *   | field | peds bay (re-baked) | ED bay (known-good) |
 *   |-------|--------------------|--------------------|
 *   | floor | 5.28 × 5.39 m | 6.38 × 6.25 m |
 *   | aspect | **1.021** | 1.020 |
 *   | area | **28.47 m²** | 39.85 m² |
 *   | +Z hull | 0.1093 m | 0.1245 m |
 *   | interior | 5.39 × 2.46 × 5.39 m | 6.38 × 2.40 × 6.38 m |
 *   | all-mesh extent | 5.96 × 2.65 × 6.14 m | 6.90 × 2.65 × 7.26 m |
 *   | tris / meshes / materials / textures | 380 / 4 / 3 / 6 | 440 / 4 / 3 / 6 |
 *
 * (1) now passes with margin 1.021 vs the 1.53 allowance; the corridor class is gone. (2)
 * holds — 28.47 m² vs the ≥19.9 m² floor-area band — so the fix cannot have cropped its way
 * to green. (3) holds — the ED bay is untouched. The #406 stand-off contract re-measures the
 * file: +Z thickness 0.1093 m, derived eye inside the interior, and the second-station
 * contract's hash/signature/extent clauses all still hold (`4/3/6/5.96x2.65x6.14` vs the ED
 * bay's `4/3/6/6.90x2.65x7.26`).
 *
 * ### Decisions taken (named, with what was rejected)
 *
 * - **Seed 13 over the other completing seeds.** Seeds 1/2/7/8/10 complete but their
 *   room-shaped single-segment rooms are INTERIOR — the wall mesh carries every outer face,
 *   so the exterior adds no horizontal hull and the #406 stand-off collapses to zero (the
 *   exact defect that cost the #405 bake). Seed 6's dining-room (4.9 × 4.8 m, 23.5 m²) does
 *   carry a horizontal hull but on −X/−Z, needing the same orientation treatment at a smaller
 *   size; seed 13's kitchen is the largest clean room-shaped candidate with a hull. Seeds
 *   0's floorplan is the ED bake's and is not reused (#388/#85).
 * - **`--yaw-deg 90` orientation, not a geometry edit.** The room's outer wall is genuine
 *   (0.1093 m measured, not a literal); the rotation only decides which wall faces the +Z
 *   side the camera derivation stands on. Rejected: cropping the corridor (refused by clause
 *   (2) — area), stretching the ED bay's aspect (refused by clause (3)), a selection
 *   predicate alone (no room in any completing seed satisfies aspect + area + hull
 *   simultaneously without an orientation step — the predicate would select a corridor or
 *   nothing), and hunting further seeds (nine complete seeds sampled; the structural pattern
 *   is that room-shaped rooms are interior and edge rooms are corridors — the ED bay's
 *   seed-0 dining-room was the one corner room and it is taken).
 * - **Selection stays by name** (the extract's existing contract). The new flag is an
 *   orientation transform, not a judgement; no pipeline predicate was added.
 *
 * NOT TESTED:
 *   - **That a room-shaped bay renders well.** Pixel grade, done from a fresh capture
 *     afterwards — capture command
 *     `pnpm asset:ui-xr:environment-room-capture --scenario peds_asthma_parent_anxiety_v1`.
 *   - **The black rectangle** from the #406 frame. Hypothesis only (the far corridor end ~10 m
 *     from the eye); if it survives a room-shaped bay it was something else.
 *   - **Fixture re-anchoring in the new room.** The runtime re-derives wall planes from the
 *     room on load; whether any fixture is visibly misplaced is a pixel-grade question.
 *   - **Clinical adequacy of any particular dimension.** No clinical claim; this asserts a
 *     shape relation against another shipped room, nothing more.
 *   - **The other 13 environmentIds**, which still render the procedural box.
 */

/**
 * ## RE-KEYED (2026-10-20) — Oct1 finished-room chain
 *
 * The 2026-10-01 fleet regen (`room_generate` fixed-footprint singleroom →
 * `room_clinic_finish` → `lighting_design`, `pnpm factory:room:promote`)
 * replaced the 4-mesh Infinigen multi-room extracts with finished clinic
 * rooms (structural shell + ~110 nodes flagged
 * `extras.openClinXrFinishDecoration`). Two stalenesses are repaired here;
 * every scalar and quality bar is unchanged (ALLOWANCE 1.5, AREA_BAND 2,
 * DECLARED_ASPECT_MIN 2.0):
 *
 * - The exception is re-keyed from the retired gin premise to the live
 *   declaration: `ROOM_CHAIN_RECIPES.footprintMeters` in
 *   `packages/openclinxr/factory-stations/src/room_chain/recipes.ts`
 *   (ED 5.882x2.882 aspect 2.041; stepdown 6.2x3.25 aspect 1.908; peds
 *   5.39x5.28 aspect 1.021). Exemption is by RULE (recipe elongation
 *   beyond ALLOWANCE x peds-recipe elongation), never by measured aspect —
 *   no stepdown exception is added merely because its aspect failed, and no
 *   bound is fitted to clear an observation. Telehealth (recipe 9.5x6.38,
 *   aspect 1.489) stays inside the generic gate by the same rule and passes
 *   it live (1.464 vs 1.50).
 * - The floor instrument ports the runtime shell rule
 *   (`packages/openclinxr/xr-scene/src/interior-preview-camera.ts:28-51`):
 *   nodes flagged `openClinXrFinishDecoration` are finish dressing, not
 *   shell. World transforms were already applied. No-op on current bytes
 *   (no flagged node name ends in `floor`); kept so the instrument cannot
 *   silently start measuring dressing.
 * - (1b) and the new (1c) are RED for one shared, verified producer cause:
 *   every finished room's shell floor measures exactly the recipe width but
 *   +0.11 m over the recipe depth (ED 5.882x2.992 vs 5.882x2.882; stepdown
 *   6.20x3.36 vs 6.2x3.25; fleet-wide, depth axis only), while the shell
 *   ceiling matches the recipe (ED 5.882x2.882) and the wall base coincides
 *   with the floor edge — so the floor cannot be re-baselined without
 *   opening a wall gap. Producer report (exact source/geometry) ships with
 *   this candidate; the producer fix + re-promote recovers (1b)/(1c) with
 *   zero further matcher edits. Not loosened, not excepted away.
 *   (SUPERSEDED — see CORRECTED below: the producer-defect premise is refuted.)
 */

/**
 * ## CORRECTED (2026-10-20) — interior-clear reframe; the producer-defect premise is refuted
 *
 * The re-key note above (and the instrument-review's producer verdict it cites) read the shell floor
 * AABB as the room footprint and concluded a +0.11 m producer depth defect. A facade-executed Blender
 * probe on the real chain bytes refutes that: inpatient interiorClear (wall inner faces) is 4.300 x
 * 3.900 exact, and only in-door-band floor verts reach the outer face — the +0.11 m is the doorway
 * threshold tab, correct floor construction, with the wall base coinciding with the floor edge because
 * the tab runs UNDER the closed leaf to the outer face. Re-measured here in the shipped GLB world
 * frame, fleet-wide: every room's wall-inner-face clear matches its recipe footprint exactly
 * (ED 5.882x2.882, peds 5.39x5.28, inpatient 4.3x3.9, stepdown 6.2x3.25, and all 10 remaining rooms),
 * while every floor slab reads clear + 0.11 m on the door-wall depth only. No geometry regen is
 * warranted; a producer "fix" shrinking the slab would open a wall gap.
 *
 * What changed in this instrument (and only this):
 * - `measure` now returns the wall-inner-face interior clear as the footprint (x/z/aspect/area),
 *   ported from the generate-step source probe (`probe_door.py` wall-plane derivation) via
 *   `room-bake/room-interior-clear.ts`. Exact planes, world transforms, finish dressing excluded;
 *   missing planes throw fail-closed. No recipe values, no wall-thickness subtraction, no fitted
 *   tolerance — the large-plane floor (1.0 m^2) and mm quantization are the probe's own constants.
 * - The raw shell floor slab is preserved alongside as `floorX/floorZ/floorArea`: diagnostic and the
 *   actual area signal (the tab is real floor area). Counterweight (2) now pins that signal.
 * - (1b)/(1c) go green on the same bytes the floor-AABB reading failed — the product was never
 *   broken. Every scalar and quality bar is unchanged (ALLOWANCE 1.5, AREA_BAND 2,
 *   DECLARED_ASPECT_MIN 2.0, recipe pins, declared-elongation rule, vacuity guard).
 */
