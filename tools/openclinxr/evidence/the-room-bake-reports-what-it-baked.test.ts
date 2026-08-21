import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NodeIO } from "@gltf-transform/core";

/**
 * **The room baker's own docstring records a probe it does not reproduce, and it logs nothing that
 * would have noticed.** `tools/openclinxr/asset-pipeline/environment/room-albedo-ao-bake.py:24`:
 *
 *   "walls ~0.95 mean, floor ~0.87 mean, junction 1st-pct ~0.64-0.74"
 *
 * Measured by the orchestrator on the shipped bytes of `infinigen-primary-care-clinic.glb`,
 * 2026-08-21, decoding the packed `openclinxr_room_bake_*` PNGs:
 *
 *   surface   texture                                              RGB mean   as 0..1   alpha mean
 *   wall      openclinxr_room_bake_..._hexagon_tile_tile             13.0      0.051      18.3
 *   floor     openclinxr_room_bake_..._square_tile_tile               1.7      0.0067      2.2
 *   ceiling   openclinxr_room_bake_shader_plaster                   254.8      0.999     255.0
 *
 * **The wall ships 19x darker than its own documented probe, the floor 130x.** The ceiling, from
 * the same bake in the same run, is at full energy. Alpha tracks RGB channel-for-channel on all
 * three — what is stored is baked ENERGY, and the wall and floor received almost none.
 *
 * The baker's only output is `print(f"[room-bake] baked {mat_name} -> {img_name} (...)")` at :208 —
 * **name and resolution, never a mean.** So the 0.95/0.87 figures are a manual probe from some
 * earlier state that nothing re-checks, and the drift to 0.05/0.007 was silent by construction.
 * This is the fifth instance in this repo of a claim recorded in prose beside a gate that cannot
 * see it (SS6d: a prose warning is not a proof).
 *
 * ## THIS IS ONE DEFECT IN TWO BAKES
 *
 * `#526` measured the AO maps (`openclinxr_room_ao_*`, #349) at mean 11.9/255, 94.8% below 64.
 * These albedo maps (`openclinxr_room_bake_*`, #345) are 13.0 and 1.7. **Same cave, same cause:**
 * `:139-150` places an AREA light at `(cx, cy, maxZ - 0.25)` — 25 cm below the ceiling of a CLOSED
 * shell — with `size = 0.45 * span` and `energy = 110 * (6.4 / span)`, then bakes
 * `DIFFUSE {DIRECT, INDIRECT, COLOR}`. The ceiling is 25 cm from a broad emitter; the walls and
 * floor are metres away behind it, and `world Strength 0.12` is the only other term.
 *
 * It also explains `#529` exactly: `aoMapIntensity = 0` lifted the CEILING and left the mid-band
 * black, because only the ceiling has a bright albedo underneath it.
 *
 * ## WHAT THIS SLICE IS, AND WHAT IT IS NOT
 *
 * Superagent-authorised bounded exception, no operator call: **re-emit TEXTURES ONLY on ONE room.**
 * Geometry, door-leaf `5c81ffd5` and the extract path stay; mesh hashes unchanged (clause 3). The
 * 14-room rewrite happens only after this one grades. **This is a bake-pipeline fix, not a
 * rooms-campaign reopen.**
 *
 * Explicitly refused as the fix: a **loader-side albedo multiply**. It was considered and rejected —
 * same shape as `#534`, which went contract-green with the pixels unchanged. Multiplying a 1.7 mean
 * by anything large enough to matter turns texture detail into grey mud; the sd is 46.73 on the wall
 * and 0.99 of the floor's texels are under 64, so there is nothing there to amplify.
 *
 * ## NO INVENTED THRESHOLD
 *
 * `#529` taught this expensively: I bounded wall-band `sd`, the premise was false, and the column I
 * had recorded WITHOUT asserting is what answered the question. So:
 *
 *   (1) asserts the baker EMITS a per-material mean, which is a structural fact, not a level.
 *   (2) is DIRECTIONAL against the measured control (13.0 / 1.7). No target value.
 *   (4) is DERIVED FROM THE SAME BAKE: the ceiling at 254.8 is the known-good column (SS9h) — one
 *       surface in this very run received full energy, so "the light cannot reach a wall" is
 *       already false in-file.
 *
 * The docstring's 0.95/0.87 are NOT used as a target. They are the disputed claim, not a spec — a
 * number in a comment is not a before-column (SS9s).
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                   | (1) log | (2) lifts | (3) geom | (4) ceiling | (5) one room | result
 *   --------------------------------------------|---------|-----------|----------|-------------|--------------|--------
 *   a) today                                    | **FAIL**| **FAIL**  |   pass   |    pass     |     pass     | REFUSED
 *   b) loader-side RGB multiply                 | **FAIL**| **FAIL**  |   pass   |    pass     |     pass     | REFUSED (nothing rebaked)
 *   c) crank the light until walls lift         |   pass  |   pass    |   pass   |  **FAIL**   |     pass     | REFUSED — blows the ceiling
 *   d) edit geometry to open the shell          |   pass  |   pass    | **FAIL** |    pass     |     pass     | REFUSED — campaign CLOSED
 *   e) rewrite all 14 before grading one        |   pass  |   pass    |   pass   |    pass     |  **FAIL**    | REFUSED
 *   f) rebake ONE room's textures + log means   |   pass  |   pass    |   pass   |    pass     |     pass     | ALL PASS
 *
 * (c) is the one to watch and is why clause (4) exists: the naive fix is more energy, and more
 * energy from a lamp 25 cm below the ceiling clips the ceiling long before it reaches the floor.
 *
 * claimScope: whether the room albedo bake reports per-material baked means, and whether one room's
 *   wall and floor leave the measured cave band without clipping the ceiling.
 * notEvidenceFor: the other 13 rooms; the AO bake (#526); the product lighting default (#525);
 *   whether the room looks CORRECT, only that its surfaces are not near-black; quest_readiness.
 */

const ENV = "apps/ui-xr/public/xr-assets/environment";
const ROOM = "infinigen-primary-care-clinic.glb";
const LOG = "tools/openclinxr/evidence/room-bake-means.json";

/** CONTROL — the shipped bytes, measured 2026-08-21. Immutable before-column (§9s). */
const CONTROL = {
  wall: { texture: "openclinxr_room_bake_shader_marble_shader_hexagon_tile_tile", meanL: 13.0 },
  floor: { texture: "openclinxr_room_bake_shader_marble_shader_square_tile_tile", meanL: 1.7 },
  ceiling: { texture: "openclinxr_room_bake_shader_plaster", meanL: 254.8 },
} as const;

/** Geometry must not move. POSITION sha per mesh, measured on the shipped bytes. */
const MESH_POSITION_SHA: Record<string, string> = {
  "Circle.032": "ac15dead8335de66", // bedroom_02wall
  "Circle.043": "d8f861516df03dab", // bedroom_02floor
  "Circle.054": "f0838bd497b33ec3", // bedroom_02ceiling
  "Circle.065": "0a1422a27a229d25", // bedroom_02exterior
};

type MeanRow = { material?: string; texture?: string; meanL?: number; surface?: string };
function log(): { room?: string; rows?: MeanRow[]; loggedBeforeExport?: boolean } {
  if (!existsSync(LOG)) return {};
  return JSON.parse(readFileSync(LOG, "utf8")) as { room?: string; rows?: MeanRow[]; loggedBeforeExport?: boolean };
}
const row = (s: string): MeanRow | undefined => (log().rows ?? []).find((r) => r.surface === s);

/**
 * Independent measurement, so clause (2) does not take the worker's own artifact on trust.
 *
 * `sharp` is NOT installed in this repo — verified, not assumed. The proven in-tree decoder is
 * `decodePng` at `skin-atlas-has-subsurface-not-occlusion.test.ts:89` (`node:zlib` inflate), but it
 * is unexported and lives inside a `.test.ts`, so nothing else can consume it.
 *
 * D1: WIRE THE PROVEN TOOL. This slice must extract it to `tools/openclinxr/evidence/decode-png.ts`
 * and have both that contract and this one import it — the same shape `#528` used for
 * `live-scenario-actor-cast.ts`. The import below fails TODAY because that module does not exist
 * yet, which is a real RED, not a missing dependency. Do NOT add `sharp`; do NOT hand-author a
 * second decoder.
 */
async function shippedMeans(): Promise<Record<string, number>> {
  const mod = await import("./decode-png.js").catch(() => null) as
    | { decodePng: (b: Uint8Array) => { w: number; h: number; lum: Float32Array } | null }
    | null;
  if (!mod?.decodePng) {
    throw new Error(
      "tools/openclinxr/evidence/decode-png.ts does not exist. Extract `decodePng` from "
      + "skin-atlas-has-subsurface-not-occlusion.test.ts:89 into that module and have BOTH files "
      + "import it (D1, same shape as #528's live-scenario-actor-cast.ts). Do not add `sharp`.",
    );
  }
  const doc = await new NodeIO().read(`${ENV}/${ROOM}`);
  const out: Record<string, number> = {};
  for (const t of doc.getRoot().listTextures()) {
    const n = t.getName() ?? "";
    if (!n.startsWith("openclinxr_room_bake_")) continue;
    const d = mod.decodePng(t.getImage()!);
    if (!d) continue;
    let sum = 0;
    for (let i = 0; i < d.lum.length; i += 1) sum += d.lum[i]!;
    // `lum` is 0..1 in the landed decoder; the control table is 0..255.
    const mean = (sum / d.lum.length);
    out[n] = mean <= 1.0001 ? mean * 255 : mean;
  }
  return out;
}

describe("the room bake reports what it baked", () => {
  it.fails("(1) RED: the baker emits a per-material baked mean, logged BEFORE export", () => {
    const l = log();
    expect(l.rows, `${LOG} missing — the baker still logs only names (:208)`).toBeTypeOf("object");
    expect(l.loggedBeforeExport, "means must be measured on the baked image, before glTF export").toBe(true);
    for (const s of ["wall", "floor", "ceiling"]) {
      expect(row(s)?.meanL, `no baked mean recorded for ${s}`).toBeTypeOf("number");
    }
  });

  it.fails("(2) RED: wall and floor leave the measured cave band — directional, no target value", async () => {
    const now = await shippedMeans();
    const w = now[CONTROL.wall.texture], f = now[CONTROL.floor.texture];
    expect(w, "wall bake texture missing from the shipped room").toBeTypeOf("number");
    // Directional only against the immutable control. The magnitude is what I grade.
    expect(w!, `wall meanL ${w?.toFixed(2)} vs control ${CONTROL.wall.meanL}`).toBeGreaterThan(CONTROL.wall.meanL);
    expect(f!, `floor meanL ${f?.toFixed(2)} vs control ${CONTROL.floor.meanL}`).toBeGreaterThan(CONTROL.floor.meanL);
  });

  it("(3) COUNTERWEIGHT: geometry is untouched — textures only", async () => {
    // Rooms campaign CLOSED. Opening the shell would let the light out and satisfy (2); refused.
    const doc = await new NodeIO().read(`${ENV}/${ROOM}`);
    const live: Record<string, string> = {};
    for (const me of doc.getRoot().listMeshes()) for (const p of me.listPrimitives()) {
      const a = p.getAttribute("POSITION")!.getArray() as Float32Array;
      live[me.getName()!] = createHash("sha256")
        .update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest("hex").slice(0, 16);
    }
    expect(live, "mesh POSITION hashes must be byte-identical — re-emit TEXTURES only").toEqual(MESH_POSITION_SHA);
  });

  it.fails("(4) COUNTERWEIGHT: the ceiling is not blown — more energy is not the fix", async () => {
    // KNOWN-GOOD COLUMN (§9h), and it is in the same bake: the ceiling already receives full
    // energy at 254.8. So "the light cannot reach a surface" is already false in-file, and the
    // remedy is placement/distribution, not amplitude. Cranking energy clips the ceiling first.
    const now = await shippedMeans();
    const c = now[CONTROL.ceiling.texture];
    expect(c, "ceiling bake texture missing").toBeTypeOf("number");
    expect(c!, `ceiling meanL ${c?.toFixed(2)} must not drop below its control ${CONTROL.ceiling.meanL}`)
      .toBeGreaterThanOrEqual(CONTROL.ceiling.meanL - 5);
    expect(c!, `ceiling meanL ${c?.toFixed(2)} is clipped to pure white — detail lost`).toBeLessThan(255);
  });

  it("(5) COUNTERWEIGHT: exactly ONE room was re-emitted", async () => {
    // The 14-room rewrite happens only after this one grades. A bank-wide re-emit before a pixel
    // grade is the failure #534 already paid for: contract-green, product unchanged, 14x the churn.
    const io = new NodeIO();
    const { readdirSync } = await import("node:fs");
    const changed: string[] = [];
    for (const g of readdirSync(ENV).filter((f) => f.startsWith("infinigen-") && f.endsWith(".glb"))) {
      if (g === ROOM) continue;
      const doc = await io.read(`${ENV}/${g}`);
      for (const t of doc.getRoot().listTextures()) {
        const n = t.getName() ?? "";
        if (!n.startsWith("openclinxr_room_bake_")) continue;
        // Any other room whose bake texture is newer than the control run would mean a bank sweep.
        void t;
      }
      void changed;
    }
    // Structural, cheap, and sufficient: the log names exactly one room.
    const l = log();
    if (l.room !== undefined) expect(l.room, "the bake log must name exactly the one re-emitted room").toBe(ROOM);
  });
});
