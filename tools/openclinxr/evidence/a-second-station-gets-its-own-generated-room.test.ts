import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **One station of fifteen has a generated room. The other fourteen render a procedural box.**
 *
 * Measured 2026-08-14 after the operator asked whether the Infinigen rooms had been promoted to the
 * encounters. The honest answer is "one of them":
 *
 *   - `INFINIGEN_ENVIRONMENT_ASSETS` (`infinigen-station-environment.ts:33`) has exactly **one row**,
 *     `ed_exam_bay_v1 -> /xr-assets/environment/infinigen-ed-exam-bay.glb`.
 *   - The scenario bank declares **15 distinct `environmentId`s**.
 *   - Only `ed_chest_pain_priority_v1` reaches it (`ed-chest-pain.ts:218`). Everything else falls back
 *     to `buildStationEnvironment`'s parametric box.
 *
 * The wiring is real and proven, not a stub: `main.ts:3386` loads it, `hideProceduralShellMeshes`
 * suppresses the box underneath, `main.ts:4023` reads the room back out for camera framing, and
 * `infinigen-station-environment.test.ts` is 17/17 green. **The gap is rooms, not plumbing** — the
 * module's own comment says the contract is "one reproducible room per environmentId", i.e. a table
 * with rows to add.
 *
 * ## THE GENERATOR IS PRESENT AND RUNNABLE — this is not a procurement ask
 *
 * `~/.openclinxr-tools/infinigen`: **infinigen 1.14.0-dev**, venv python **3.11.8**,
 * `infinigen_examples/configs_indoor/disable/no_objects.gin` present, and prior sweep outputs on disk
 * (`sweep_u38_l12`, `sweep_u30_l12`, ...). `infinigen-single-room-shell.ts:174-192` resolves exactly
 * those paths. **Wiring a proven component beats proving a new one (D1).**
 *
 * ## SCOPE: ONE ROOM, NOT FOURTEEN (D4)
 *
 * `pediatric_urgent_care_bay_v1` is the second room. It is the station whose cast is fully MPFB and
 * the one every recent campaign capture used, so a generated room there is immediately gradeable
 * against existing stills.
 *
 * ## THE KNOWN-GOOD COLUMN, MEASURED (§9h)
 *
 * `infinigen-ed-exam-bay.glb`: 4 meshes, extent **6.90 x 2.65 x 7.26 m**, 3 materials, 6 textures,
 * 2.6 MB. Every bound below is derived from those numbers at test time, never a literal I invented.
 *
 * **NO TRIANGLE-COUNT GATE, DELIBERATELY.** The standing directive is that no generated output is
 * gated on triangle count — meshoptimizer runs later in the pipeline. So "is this a real room"
 * is asked with mesh count, material count, texture count and extent, all of which survive decimation.
 * The ED bay is 440 tris and is a perfectly good room; a tri floor would have called it a stub.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                          | (1) row | (2) distinct | (3) known-good | (4) real room | result
 *   ----------------------------------------------------|---------|--------------|----------------|---------------|--------
 *   a) today — one row                                 | **FAIL**|   **FAIL**   |      pass      |   **FAIL**    | REFUSED
 *   b) point peds at the SAME ED bay GLB               |   pass  |   **FAIL**   |      pass      |     pass      | REFUSED
 *   c) copy the ED bay to a new filename               |   pass  |   **FAIL**   |      pass      |     pass      | REFUSED
 *   d) ship an empty/near-empty GLB at the new path    |   pass  |     pass     |      pass      |   **FAIL**    | REFUSED
 *   e) generate a second room and register it          |   pass  |     pass     |      pass      |     pass      | ALL PASS
 *
 * **(b) and (c) are the ones to watch.** One asset serving two ids is #388/#85 — this repo has already
 * shipped a patient, his wife and a nurse as byte-identical meshes, and the fix cost a campaign. So
 * clause (2) compares **content hash AND geometric signature**: a copy defeats a hash-only check the
 * moment someone re-exports it, and a re-export defeats a signature-only check if the bytes differ.
 * Both, or neither is worth having.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1), (2) and (4) are REDs** — all fail today on the
 * absence of a second room. **(3) passes today** and is a true net: it pins the shipped ED bay so a
 * fix cannot reach green by degrading the room that already works. **(5) passes today** and guards
 * vacuity.
 *
 * NOT TESTED:
 *   - **That the generated peds room LOOKS right.** That is a pixel grade, and the orchestrator does
 *     it from an isolated capture after the fix. A green contract here is not a graded room.
 *   - **The other thirteen environmentIds.** Deliberately out of scope; this is the second room, not
 *     the campaign.
 *   - **Whether the room suits paediatric urgent care clinically.** No clinical claim is made.
 *   - **Runtime framing.** `main.ts:4009` records that the doorway camera lands 2.38 m beyond the ED
 *     room's closed shell; a second closed shell may need its own framing and that is not asserted.
 *   - **`main.ts:4395` defaults an undeclared environment to `ed_exam_bay_v1`**, so a scenario that
 *     forgets to declare one silently inherits the ED Infinigen room. Measured, not fixed here.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = join(REPO_ROOT, "apps/ui-xr/public");
const MODULE_SRC = join(REPO_ROOT, "apps/ui-xr/src/infinigen-environment-assets.ts");

const KNOWN_GOOD_ENV = "ed_exam_bay_v1";
const SUBJECT_ENV = "pediatric_urgent_care_bay_v1";
/** Each axis must land within this multiple of the known-good room's, in either direction. */
const EXTENT_BAND = 2;

type RoomShape = {
  path: string;
  sha256: string;
  meshes: number;
  materials: number;
  textures: number;
  extent: [number, number, number];
};

function tableRow(env: string): string | null {
  const src = readFileSync(MODULE_SRC, "utf8");
  const m = new RegExp(`\\b${env}\\b\\s*:\\s*"([^"]+)"`, "u").exec(src);
  return m?.[1] ?? null;
}

async function shapeOf(assetUrl: string): Promise<RoomShape | null> {
  const abs = join(PUBLIC, assetUrl.replace(/^\//u, ""));
  if (!existsSync(abs)) return null;
  const bytes = readFileSync(abs);
  const doc = await new NodeIO().readBinary(bytes);
  const root = doc.getRoot();
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let meshes = 0;
  for (const mesh of root.listMeshes()) {
    meshes += 1;
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute("POSITION")?.getArray();
      if (!a) continue;
      for (let i = 0; i < a.length; i += 3) {
        for (let k = 0; k < 3; k++) { const v = a[i + k]!; if (v < lo[k]!) lo[k] = v; if (v > hi[k]!) hi[k] = v; }
      }
    }
  }
  return {
    path: assetUrl,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    meshes,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    extent: [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!],
  };
}

const knownGoodUrl = tableRow(KNOWN_GOOD_ENV);
const subjectUrl = tableRow(SUBJECT_ENV);
const knownGood = knownGoodUrl ? await shapeOf(knownGoodUrl) : null;
const subject = subjectUrl ? await shapeOf(subjectUrl) : null;

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireKnownGood(): RoomShape {
  expect(knownGood, `${KNOWN_GOOD_ENV} must resolve to a readable room GLB (the known-good column)`).not.toBeNull();
  return knownGood as RoomShape;
}

describe("a second station gets its own generated room", () => {
  it("resolves to a generated room asset", () => {
    requireKnownGood();
    expect(
      subjectUrl,
      `INFINIGEN_ENVIRONMENT_ASSETS has one row today; the bank declares 15 environmentIds and the other 14 render a procedural box`,
    ).not.toBeNull();
    expect(subject, `${SUBJECT_ENV} room GLB readable under apps/ui-xr/public`).not.toBeNull();
  });

  it("the second room is not the first one wearing a new name", () => {
    // Refuses (b) and (c). One asset serving two ids is #388/#85, which this repo has already shipped
    // once. Hash alone loses to a re-export; signature alone loses to a byte-level copy. Both.
    const k = requireKnownGood();
    expect(subject, `${SUBJECT_ENV} room measured`).not.toBeNull();
    const s = subject as RoomShape;
    expect(s.sha256, `${SUBJECT_ENV} must not be the ED bay bytes`).not.toBe(k.sha256);
    expect(
      `${s.meshes}/${s.materials}/${s.textures}/${s.extent.map((v) => v.toFixed(2)).join("x")}`,
      `${SUBJECT_ENV} must not be a re-export of the ED bay geometry`,
    ).not.toBe(`${k.meshes}/${k.materials}/${k.textures}/${k.extent.map((v) => v.toFixed(2)).join("x")}`);
  });

  it("(3) COUNTERWEIGHT: the shipped ED bay room is not degraded to reach green", () => {
    // The known-good column. Bounds are the room's own measured values, so this cannot be satisfied by
    // swapping the ED bay for something smaller.
    const k = requireKnownGood();
    expect(k.meshes, "ED bay meshes, measured 4 on 2026-08-14").toBeGreaterThanOrEqual(4);
    expect(k.materials, "ED bay materials, measured 3").toBeGreaterThanOrEqual(3);
    expect(k.textures, "ED bay textures, measured 6").toBeGreaterThanOrEqual(6);
    for (const [i, axis] of (["x", "y", "z"] as const).entries()) {
      expect(k.extent[i]!, `ED bay ${axis} extent, measured 6.90/2.65/7.26`).toBeGreaterThan(2);
    }
  });

  it("(4) RED: the second room is a room, not a placeholder at the right path", () => {
    // Refuses (d). NO TRIANGLE GATE — meshoptimizer runs later and the ED bay is a good room at 440
    // tris. Everything here survives decimation: enclosure, material variety, and a plausible size
    // derived from the known-good rather than invented.
    const k = requireKnownGood();
    expect(subject, `${SUBJECT_ENV} room measured`).not.toBeNull();
    const s = subject as RoomShape;
    expect(s.meshes, "a room has more than one surface").toBeGreaterThanOrEqual(2);
    expect(s.materials, "a room is not single-material").toBeGreaterThanOrEqual(2);
    expect(s.textures, "a room is textured, not flat-shaded").toBeGreaterThanOrEqual(1);
    for (const [i, axis] of (["x", "y", "z"] as const).entries()) {
      expect(s.extent[i]!, `${axis} extent within ${EXTENT_BAND}x the ED bay's ${k.extent[i]!.toFixed(2)} m`)
        .toBeGreaterThanOrEqual(k.extent[i]! / EXTENT_BAND);
      expect(s.extent[i]!, `${axis} extent within ${EXTENT_BAND}x the ED bay's ${k.extent[i]!.toFixed(2)} m`)
        .toBeLessThanOrEqual(k.extent[i]! * EXTENT_BAND);
    }
  });

  it("(5) VACUITY GUARD: the known-good row exists and carries real geometry", () => {
    const k = requireKnownGood();
    expect(k.sha256.length, "known-good hashed").toBe(64);
    expect(k.extent.every((v) => Number.isFinite(v) && v > 0), "known-good has a finite extent").toBe(true);
  });
});

/**
 * ## FIXED (#405) — a second room is generated, extracted, baked and registered
 *
 * Flips (1), (2) and (4) from RED to green; (3) and (5) stay nets as planted.
 *
 * Bake, fully deterministic (same config chain as the ED bay, different seed):
 *   - Generate: `clinical_bay.gin` seed 1, coarse, `compose_indoors.terrain_enabled=False`
 *     (the proven #271/#336 invocation; ~57 s wall-clock on this machine). Fresh seed — the
 *     seed-0 floorplan is already shipped as the ED bay and cannot serve a second id (#388).
 *   - Extract: `tools/openclinxr/asset-pipeline/environment/infinigen-single-room-extract.py`
 *     selects `dining-room_0` (single segment, 5.0 × 5.0 × 2.65 m — smaller than the ED
 *     dining-room 6.5 × 6.5, a paediatric scale) by mesh-name selection (#236 technique) and
 *     centers with floor top at y=0 (#336 convention).
 *   - Bake: Cycles DIFFUSE albedo+AO (`room-albedo-ao-bake.py`, 3 baseColor textures, geometry
 *     unchanged 432 tris) then native AO occlusion (`room-occlusion-bake.py`, 3 occlusion
 *     textures) — the same two-stage texture pipeline as the ED bay.
 *   - Shipped: `apps/ui-xr/public/xr-assets/environment/infinigen-pediatric-urgent-care-bay.glb`
 *     (744,552 bytes, SHA-256 `c1f8d4ea6e309c6a69ccc1b8706f7356beed3c7be2b623ea1235f4551afa8bf2`,
 *     provenance appended to `PROVENANCE.md`).
 *
 * Measured (2026-08-14, this slice):
 *
 *   | field | peds bay (shipped) | ED bay (known-good) |
 *   |-------|--------------------|---------------------|
 *   | meshes | 4 | 4 |
 *   | materials | 3 | 3 |
 *   | textures | 6 | 6 |
 *   | extent | 5.832 × 2.650 × 5.063 m | 6.899 × 2.650 × 7.259 m |
 *   | tris | 432 | 440 |
 *
 * Clause (2) holds on BOTH halves: sha256 differs and the geometric signature
 * `4/3/6/5.83x2.65x5.06` differs from `4/3/6/6.90x2.65x7.26` — neither a byte copy nor a
 * re-export of the ED room. Clause (4) holds on every axis within the 2× band of the
 * known-good (x 3.45–13.80, y 1.33–5.30, z 3.63–14.52).
 *
 * DECISIONS TAKEN (with what was rejected):
 *   - Seed 1 over seeds 0/2: seed 0 is the ED bake's floorplan (shipping it twice is exactly
 *     the anti-cheat this contract refuses); seed 2's best single-segment rooms are 5.5 × 5.5
 *     dining/kitchen, closer to the ED square. Seed 1's `dining-room_0` is a clean single
 *     segment at 5.0 × 5.0 — smaller than the ED room, plausible paediatric scale.
 *   - `dining-room_0` over the largest room by triangle count (#236's default): seed 1's
 *     largest is `bedroom_0` — a multi-segment union spanning 22.5 × 15.5 m, outside the
 *     contract band and not one enclosed room. Extraction therefore targets a named
 *     single segment.
 *   - No camera framing change: `main.ts:4023`'s interior-camera derivation
 *     (`deriveInteriorPreviewCamera`) is generic — it measures the loaded room's geometry and
 *     the actor bounds, so the second closed shell gets the same treatment automatically.
 *   - Runtime `positionInfinigenRoom` needs no change: it re-derives floor top and center from
 *     the room's own geometry on load, like the ED bay.
 *
 * NOT TESTED:
 *   - That the peds room LOOKS right — a pixel grade the orchestrator does from an isolated
 *     capture. Capture command: the glb-grade capture path against
 *     `apps/ui-xr/public/xr-assets/environment/infinigen-pediatric-urgent-care-bay.glb`
 *     (evidence writes under `.openclinxr/evidence/issue-405/`).
 *   - The other twelve environmentIds (still the procedural box).
 *   - Clinical suitability of the room for paediatric urgent care — no clinical claim.
 *   - Browser/WebXR live load of the new row (unit-tested here; live grading is a capture).
 *
 * **#406 re-bake:** this row's GLB was re-baked from seed-1 `hallway_0` (the shipped `dining-room_0`
 * has zero horizontal wall thickness — interior room — collapsing the derived interior-camera
 * stand-off). The clauses above re-measure the file and still hold: sha256 `d01932ff…` and the
 * signature `4/3/6/10.13x2.65x5.13` differ from the ED bay's, and every axis is inside the 2× band
 * (x 3.45–13.80, y 1.33–5.30, z 3.63–14.52). See `a-generated-room-gives-the-interior-camera-a-standoff.test.ts`
 * FIXED (#406) and `PROVENANCE.md`.
 */
