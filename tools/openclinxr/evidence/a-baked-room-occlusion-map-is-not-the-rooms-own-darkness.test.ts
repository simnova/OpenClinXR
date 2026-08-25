import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { decodePng } from "./decode-png.js";

/**
 * **OBSERVABLE: a generated room's baked occlusion map is OCCLUSION, not the room's own darkness.**
 *
 * ## MEASURED ON HEAD 81d06dd6, 2026-08-23 — do not re-derive any row
 *
 * One baker — `tools/openclinxr/asset-pipeline/environment/room-occlusion-bake.py` — writes every
 * `openclinxr_room_ao_*` texture in `apps/ui-xr/public/xr-assets/environment`. Fifteen shells carry
 * its output. Decoded (`decode-png.ts`), luminance 0..255, `black` = fraction of texels below 64:
 *
 *     shell                                    AO maps   brightest mean   darkest mean
 *     ed-exam-bay-shell        (HAND-BUILT)       28         216.30           10.40
 *     infinigen-behavioral-health-private          3          54.96           38.64
 *     infinigen-oncology-consult                   3          52.54           12.54
 *     infinigen-ob-triage                          3          48.29           40.51
 *     infinigen-pediatric-urgent-care-bay          3          28.55           17.96
 *     infinigen-adult-ed-abdominal-bay             3          28.14           12.63
 *     infinigen-surgical-ward                      3          23.09           14.83
 *     infinigen-primary-care-clinic                3          20.29            7.97
 *     infinigen-inpatient-ward                     3          16.61           13.65
 *     infinigen-ed-stroke-bay                      3          14.44            7.86
 *     infinigen-ed-exam-bay                        3          11.56            9.93
 *     infinigen-pediatric-fever-urgent-care        3          10.23            7.65
 *     infinigen-urgent-care-clinic                 3           8.14            3.09
 *     infinigen-telehealth-home-visit              3           8.07            7.36
 *     infinigen-stepdown                           2           4.97            4.04
 *
 * **The hand-built shell's single brightest map (216.30) is 3.9x the brightest map any of the
 * fourteen generated rooms produced (54.96), and 44x the brightest map `stepdown` produced (4.97).**
 * Forty-one generated AO maps, not one above 54.96. That is one bake path, not fourteen accidents.
 *
 * ## THE MECHANISM IS ALREADY WRITTEN DOWN — `room-occlusion-bake.py:20-23`, verbatim
 *
 *   "Blender 5.1 IGNORES `scene.render.bake.max_ray_distance` for the AO bake type ... Consequence:
 *    a fully CLOSED room self-occludes to a dark cave. The shipped shell room is open-top, so native
 *    AO gives real contact darkening (measured sd 98-120 ...). The Infinigen room is a closed 6.5m
 *    box: its AO is darker but still carries real variation (measured sd 22-51) and mechanically
 *    passes the luminance-variation gate."
 *
 * So the baker's author knew, wrote it down, and shipped it — on the recorded belief that the closed
 * rooms still carry sd 22-51. **They do not.** Shipped generated sd runs 8.58..39.96: 21 of 41 below
 * 22 and NONE at or above 51 (recorded as a reading in clause (5), not asserted — a docstring is
 * cheap to edit and must not be the thing a fix satisfies).
 *
 * ## WHY THE GATE CANNOT SEE IT — the SS11s shape, in the generator
 *
 * `room-occlusion-bake.py:236` wires a map when `sd255 >= 6.0` and skips it otherwise. That bounds
 * VARIATION. A cave is not flat — it is dark and noisy — so `stepdown/shader_plaster.022`, whose
 * texels are **99.95% below 64** at mean 4.04, clears the gate at sd 8.58. Every one of the 41
 * generated maps clears it. The gate answers "is this map varied?", never "is this occlusion?".
 *
 * ## WHERE EVERY THRESHOLD BELOW COMES FROM — no invented magnitudes
 *
 * Both bounds are read off the hand-built shell IN THIS TEST, at run time, from the shipped bytes:
 *
 *   clause (1)  bound = MEDIAN mean of the hand-built shell's 28 AO maps        = 117.91
 *   clause (2)  bound = MAXIMUM blackness among those same 28 maps              = 0.9533
 *   clause (4)  gate  = the `6.0` literal parsed out of room-occlusion-bake.py:236
 *
 * Nothing here is a number I chose. Clause (1)'s margin is 2.15x at the closest generated shell
 * (117.91 vs behavioral-health's 54.96), so it is not fitted to clear an observation. Clause (2)'s
 * margin is thin by construction (0.9533 vs 0.9995) — it is a CEILING read off the known-good, and I
 * am stating plainly that it is a weaker bound than (1) and would move if the hand-built shell were
 * rebaked.
 *
 * ## WHAT THIS IS NOT
 *
 * Not a claim about which surface is which. `#524`, `#525` and `#526` each named the wrong noun for
 * this room and `#534` resolved it (the primary-care WALL primitive is `Circle.065`, which carries no
 * material and no `TEXCOORD_1`, so three.js drops `aoMap` on it entirely). **This contract reads
 * TEXTURE BYTES only** and asserts nothing about which primitive wears which map.
 *
 * Not a claim that neutralising `aoMapIntensity` is wrong, or right. `grep aoMapIntensity
 * apps/ui-xr/src` returns nothing today; that is a runtime question and this is a bake question.
 *
 * claimScope: whether the shipped `openclinxr_room_ao_*` textures for generated rooms are occlusion
 *   maps comparable to the ones the same baker produced for the hand-built shell.
 * notEvidenceFor: which surface reads dark to a learner; any lighting default; whether a rebake is
 *   the right remedy; the runtime aoMap term; other texture slots; Quest readiness; clinical validity.
 */

const ENV = "apps/ui-xr/public/xr-assets/environment";
const HAND_BUILT = "ed-exam-bay-shell.glb";
const BAKER = "tools/openclinxr/asset-pipeline/environment/room-occlusion-bake.py";

/** The known-good wall, pinned by clause (3). Measured on HEAD 81d06dd6. */
const KNOWN_GOOD_WALL = "ed_bay_soft_blue_wall";

type AoMap = { glb: string; material: string; mean: number; sd: number; black: number; strength: number; sha: string };

let cache: AoMap[] | null = null;

/** Every shipped room AO texture, decoded once. Bytes only — no loader, no scene, no capture. */
async function census(): Promise<AoMap[]> {
  if (cache) return cache;
  const io = new NodeIO();
  const rows: AoMap[] = [];
  for (const file of readdirSync(ENV).filter((f) => f.endsWith(".glb")).sort()) {
    const doc = await io.read(`${ENV}/${file}`);
    for (const material of doc.getRoot().listMaterials()) {
      const tex = material.getOcclusionTexture();
      if (!tex) continue;
      const png = decodePng(tex.getImage()!);
      if (!png) throw new Error(`${file}/${material.getName()}: occlusion texture did not decode`);
      const n = png.w * png.h;
      let sum = 0;
      let below64 = 0;
      for (let i = 0; i < n; i += 1) {
        const v = png.lum[i]!;
        sum += v;
        if (v < 64) below64 += 1;
      }
      const mean = sum / n;
      let sq = 0;
      for (let i = 0; i < n; i += 1) {
        const d = png.lum[i]! - mean;
        sq += d * d;
      }
      rows.push({
        glb: file,
        material: material.getName(),
        mean,
        sd: Math.sqrt(sq / n),
        black: below64 / n,
        strength: material.getOcclusionStrength(),
        sha: createHash("sha256").update(tex.getImage()!).digest("hex").slice(0, 16),
      });
    }
  }
  cache = rows;
  return rows;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 === 1 ? s[h]! : (s[h - 1]! + s[h]!) / 2;
};

/** Groups of AO maps sharing one image hash. A copied map is the cheapest way to fake a bake. */
function duplicateShaGroups(rows: readonly AoMap[]): string[] {
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.sha, [...(by.get(r.sha) ?? []), `${r.glb}/${r.material}`]);
  return [...by.entries()].filter(([, ks]) => ks.length > 1).map(([sha, ks]) => `${sha}: ${ks.join(" | ")}`);
}

/** AO maps wired at zero strength - present in the slot, absent from the render. */
function silenced(rows: readonly AoMap[]): string[] {
  return rows.filter((r) => !(r.strength > 0)).map((r) => `${r.glb}/${r.material} strength=${r.strength}`);
}

describe("a baked room occlusion map is not the room's own darkness", () => {
  it.fails("(1) RED: every generated room's BRIGHTEST occlusion map is darker than the hand-built shell's MEDIAN one", async () => {
    // BOUND SOURCE: the median of the 28 AO maps the SAME baker wrote for `ed-exam-bay-shell.glb`,
    // computed below from shipped bytes. Not a number I picked. Measured today: 117.91, against a
    // generated maximum of 54.96 — a 2.15x margin at the closest shell, so this is not fitted.
    //
    // Comparing BRIGHTEST-per-shell (not mean-per-shell) is deliberate: it is the most generous
    // reading of each generated room. A room whose single best occlusion map is still 2x darker
    // than a typical hand-built one has not been occlusion-baked; it has been photographed inside
    // a closed box.
    const rows = await census();
    const hand = rows.filter((r) => r.glb === HAND_BUILT);
    expect(hand.length, `${HAND_BUILT} must ship AO maps to serve as the known-good`).toBeGreaterThan(10);
    const bound = median(hand.map((r) => r.mean));

    const generated = [...new Set(rows.filter((r) => r.glb !== HAND_BUILT).map((r) => r.glb))].sort();
    expect(generated.length, "all fourteen generated shells must be present").toBe(14);

    const tooDark = generated
      .map((glb) => ({
        glb,
        brightest: round2(Math.max(...rows.filter((r) => r.glb === glb).map((r) => r.mean))),
      }))
      .filter((s) => s.brightest < bound);

    expect(tooDark, `every shell's brightest AO map must reach the hand-built median of ${round2(bound)}`)
      .toEqual([]);
  });

  it.fails("(2) RED: no generated occlusion map may be blacker than the blackest map a human-built room ships", async () => {
    // BOUND SOURCE: `max(black)` over the hand-built shell's own 28 maps = 0.9533, on
    // `wall_chamfer_soft_blue` — a narrow bevel, which is exactly the kind of surface that IS
    // legitimately almost fully occluded. So the ceiling is "nothing may be blacker than the most
    // occluded thing in a room somebody built by hand".
    //
    // WEAK-MARGIN, STATED (SS9s): 0.9533 vs the worst generated 0.9995 is a thin absolute gap, and
    // it would move if the hand-built shell were rebaked. Clause (1) is the load-bearing RED; this
    // one names the extreme so a partial fix that lifts the means cannot leave a 99.95%-black map
    // wired.
    const rows = await census();
    const hand = rows.filter((r) => r.glb === HAND_BUILT);
    const ceiling = Math.max(...hand.map((r) => r.black));

    const over = rows
      .filter((r) => r.glb !== HAND_BUILT && r.black > ceiling)
      .map((r) => `${r.glb}/${r.material}`)
      .sort();

    expect(over, `maps blacker than the hand-built ceiling of ${round2(ceiling * 100) / 100}`).toEqual([]);
  });

  it("(3) KNOWN-GOOD COLUMN: the hand-built shell's wall AO is a real occlusion map and stays wired", async () => {
    // Pins what must NOT change. The same baker produced this from an OPEN-TOP room and it is
    // correct: bright almost everywhere, dark in creases, at full strength. Any remedy that
    // globally darkens, drops, or flattens room AO breaks this clause, which is the point.
    //
    // Measured on HEAD 81d06dd6: mean 216.30, sd 62.68, black 0.0585, strength 1.
    const rows = await census();
    const wall = rows.find((r) => r.glb === HAND_BUILT && r.material === KNOWN_GOOD_WALL);
    expect(wall, `${HAND_BUILT} must still carry ${KNOWN_GOOD_WALL} with an occlusion texture`).toBeTruthy();
    expect(round2(wall!.mean), "known-good wall AO mean").toBeCloseTo(216.3, 1);
    expect(round2(wall!.sd), "known-good wall AO sd").toBeCloseTo(62.68, 1);
    expect(wall!.black, "known-good wall AO must stay overwhelmingly UNoccluded").toBeLessThan(0.1);
    expect(wall!.strength, "known-good wall AO must stay wired at full strength").toBe(1);
  });

  it("(4) COUNTERWEIGHT: the occlusion slot survives, and every surviving map still carries the variation the baker demands", async () => {
    // THE CHEAP FIX, NAMED: delete the offending `occlusionTexture` slots (or bake a flat white
    // over them). Either makes clauses (1) and (2) green instantly — (1) because a deleted map
    // cannot be too dark, (2) because a white map is not black — and ships rooms with no ambient
    // occlusion at all, which is a worse product than the cave.
    //
    // So: the count of materials carrying an occlusion texture may not FALL in any shell, and every
    // map that survives must still clear the baker's own wiring gate. The gate literal is parsed out
    // of the Python at read time (`room-occlusion-bake.py:236`, `if sd255 < 6.0:`) so this clause
    // tracks the generator rather than a copy of it.
    expect(existsSync(BAKER), `${BAKER} must exist — it is the generator under discussion`).toBe(true);
    const gate = /if\s+sd255\s*<\s*([0-9.]+)\s*:/u.exec(readFileSync(BAKER, "utf8"));
    expect(gate, `${BAKER} must still express its wiring gate as \`if sd255 < <n>:\``).toBeTruthy();
    const threshold = Number(gate![1]);
    expect(Number.isFinite(threshold) && threshold > 0, "gate threshold must parse to a positive number").toBe(true);

    const rows = await census();
    const perShell: Record<string, number> = {};
    for (const r of rows) perShell[r.glb] = (perShell[r.glb] ?? 0) + 1;

    // Measured on HEAD 81d06dd6 — the floor, not a target. A rebake may ADD maps; it may not remove them.
    const AT_HEAD: Record<string, number> = {
      "ed-exam-bay-shell.glb": 28,
      "infinigen-adult-ed-abdominal-bay.glb": 3,
      "infinigen-behavioral-health-private.glb": 3,
      "infinigen-ed-exam-bay.glb": 3,
      "infinigen-ed-stroke-bay.glb": 3,
      "infinigen-inpatient-ward.glb": 3,
      "infinigen-ob-triage.glb": 3,
      "infinigen-oncology-consult.glb": 3,
      "infinigen-pediatric-fever-urgent-care.glb": 3,
      "infinigen-pediatric-urgent-care-bay.glb": 3,
      "infinigen-primary-care-clinic.glb": 3,
      "infinigen-stepdown.glb": 2,
      "infinigen-surgical-ward.glb": 3,
      "infinigen-telehealth-home-visit.glb": 3,
      "infinigen-urgent-care-clinic.glb": 3,
    };
    const lost = Object.entries(AT_HEAD)
      .filter(([glb, n]) => (perShell[glb] ?? 0) < n)
      .map(([glb, n]) => `${glb}: ${perShell[glb] ?? 0} < ${n}`);
    expect(lost, "no shell may lose an occlusion texture — the remedy is a better bake, not a deletion").toEqual([]);

    const flattened = rows.filter((r) => r.sd < threshold).map((r) => `${r.glb}/${r.material} sd=${round2(r.sd)}`);
    expect(flattened, `every wired map must clear the baker's own gate of ${threshold} — a flat white is not a fix`)
      .toEqual([]);
  });

  it("(6) COUNTERWEIGHT: no AO map is a COPY of another, and none ships silenced", async () => {
    // THE SECOND CHEAP FIX, NAMED (found by a gpt-5.6-sol review 2026-08-25, then reproduced):
    // clauses (1), (2) and (4) are all LUMINANCE STATISTICS. Copying the hand-built known-good
    // wall AO into every generated material clears all three at once - mean 216.30 beats the
    // 117.91 median, black 0.0585 beats the 0.9533 floor, sd 62.68 beats the gate of 6 - while
    // encoding the WRONG GEOMETRY for every generated room. SS11s: the clauses bound a QUANTITY
    // while the defect lives in the SHAPE.
    //
    // This does NOT prove locality (see NOT TESTED). It kills wholesale copying and silencing,
    // the two cheapest routes to a green that ships no real occlusion.
    const rows = await census();

    // Detector proof: these predicates must FLAG a planted cheat, or the clause is decoration.
    const synthetic: AoMap[] = [
      { glb: "a.glb", material: "m1", mean: 216, sd: 62, black: 0.05, strength: 1, sha: "deadbeefdeadbeef" },
      { glb: "b.glb", material: "m2", mean: 216, sd: 62, black: 0.05, strength: 1, sha: "deadbeefdeadbeef" },
      { glb: "c.glb", material: "m3", mean: 216, sd: 62, black: 0.05, strength: 0, sha: "0123456789abcdef" },
    ];
    expect(duplicateShaGroups(synthetic).length, "the duplicate detector must flag a planted copy").toBe(1);
    expect(silenced(synthetic).length, "the silence detector must flag a planted strength-0 map").toBe(1);

    // The real population: measured 69 maps, 69 distinct hashes, all at full strength.
    expect(rows.length, "the AO population must not vanish out from under this clause").toBeGreaterThan(40);
    expect(
      duplicateShaGroups(rows),
      "no occlusion map may be byte-identical to another - a copied map encodes another room's geometry",
    ).toEqual([]);
    expect(
      silenced(rows),
      "no occlusion map may ship at strength 0 - a silenced map is a deleted map wearing a texture slot",
    ).toEqual([]);
  });

  it("(5) READING (SS9d): the generated-room AO census is recorded, not asserted", async () => {
    // Recorded so a later slice does not re-decode 41 textures to answer "how far off was it".
    // Deliberately NOT asserted: the docstring band (`room-occlusion-bake.py:22-23`, "sd 22-51") is
    // a comment, and a contract satisfiable by editing a comment is not a contract.
    const rows = await census();
    const generated = rows.filter((r) => r.glb !== HAND_BUILT);
    const sds = generated.map((r) => r.sd);
    const means = generated.map((r) => r.mean);
    const reading = {
      generatedMaps: generated.length,
      sdRange: [round2(Math.min(...sds)), round2(Math.max(...sds))],
      meanRange: [round2(Math.min(...means)), round2(Math.max(...means))],
      belowDocstringSd22: sds.filter((s) => s < 22).length,
      atOrAboveDocstringSd51: sds.filter((s) => s >= 51).length,
      allAtFullStrength: generated.every((r) => r.strength === 1),
    };
    expect(typeof reading.generatedMaps, "the census must be computable").toBe("number");
    expect(reading.generatedMaps, "forty-one generated AO maps ship today").toBeGreaterThan(0);
    process.stdout.write(`[ao-census] ${JSON.stringify(reading)}\n`);
  });
});
