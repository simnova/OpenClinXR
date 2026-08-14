import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * **The room I landed in #405 renders as a BLACK FRAME in its own station, and the contract was green.**
 *
 * Captured live 2026-08-14 17:19, `peds_asthma_parent_anxiety_v1`, after #405 landed:
 *
 *     env=pediatric_urgent_care_bay_v1  cam=roomCam(derived)=-2.50,1.66,1.97
 *     interiorMaxZ=1.97  wallThickness=0.000
 *
 * `eyeZ` **equals** `interiorMaxZ`. The preview camera is coplanar with the wall, so the viewport is
 * inside geometry and the 3D half of the frame is black — only the HUD renders (97 KB PNG).
 *
 * The ED control, captured 17:22 the same way, renders the full encounter — supine patient, standing
 * cast, doorway, equipment (328 KB) — at `wallThickness=0.124`. **The defect is room-specific, not a
 * capture failure.** That control is why this is filed as a room defect and not an instrument one.
 *
 * ## MEASURED — the hull does not stand proud of the interior anywhere
 *
 * `roomInteriorAndHull` splits a room's meshes by whether the node name reads `exterior`, then
 * thickness is how far the hull's world AABB exceeds the interior union's:
 *
 *   face | ED bay (known-good) | peds urgent care (#405)
 *   -----|---------------------|------------------------
 *   +Z   |          **0.1245** |             **0.0000**
 *   -Z   |              0.0000 |                 0.0000
 *   +X   |          **0.1245** |             **0.0000**
 *   -X   |              0.0000 |                 0.0000
 *
 * Both rooms DO carry the four expected nodes — `dining-room_0/0.{wall,floor,ceiling,exterior}`. The
 * peds bake's exterior simply coincides with its interior on every horizontal face.
 *
 * **Two consumers degrade silently on that zero, and neither says so:**
 *
 *   - `deriveInteriorPreviewCamera` — `eyeZ = room.max.z - 2 * thickness`, so the stand-off the
 *     "twice the wall thickness" reasoning exists to guarantee collapses to nothing. Its own docstring
 *     explains that one thickness "leaves the eye coplanar" with the inner surface; zero puts it there.
 *   - `measureRoomInteriorPlanes` — `if (!(thickness > 0))` returns all four walls as
 *     `aabb_fallback`, i.e. **guesses**, and `reanchorWallFixturesToRoom` then anchors wall fixtures to
 *     guessed planes. That function was deliberately written to distinguish a measurement from a guess;
 *     nothing consumes the distinction.
 *
 * ## WHAT I GOT WRONG ON THE WAY HERE — recorded, not deleted (§9g)
 *
 * Three of my own hypotheses died before the measurement landed:
 *
 *   1. *"The harness substitutes its own camera, so I photograph a camera the learner never uses."*
 *      **False.** `reframeCameraForRoom` is a 187-line duplicate, but it computes `2 * wallThickness`
 *      exactly as the product does. It is duplication, not divergence. (The harness DOCSTRING is stale
 *      and says one thickness — the comment drifted, the code did not.)
 *   2. *"The peds room has no `exterior` mesh."* **False.** I read glTF MESH names (`Circle.028`) when
 *      the code reads NODE names (`dining-room_0/0.exterior`). §6v, from the wrong side.
 *   3. *"`deriveInteriorPreviewCamera` uses only the +Z face while `measureRoomInteriorPlanes` takes the
 *      max over four, so +Z can read zero alone."* **False here** — on the peds bake all four read zero,
 *      so the single-face-vs-max difference is not what produced this. It remains a real inconsistency
 *      between two functions in one file, and it is NOT what this contract is about.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                              | (1) standoff | (2) inside | (3) known-good | result
 *   --------------------------------------------------------|--------------|------------|----------------|--------
 *   a) today                                               |   **FAIL**   |  **FAIL**  |      pass      | REFUSED
 *   b) clamp the stand-off to a literal when thickness is 0 |     pass     |    pass    |      pass      | ALLOWED*
 *   c) drop the peds row so only the ED bay remains         |   **FAIL**   |  **FAIL**  |   **FAIL**     | REFUSED
 *   d) shrink the ED bay's hull to "normalise" the two      |   **FAIL**   |  **FAIL**  |   **FAIL**     | REFUSED
 *
 * ***(b) is not refused by the contract and is probably the WRONG fix.** A literal stand-off is a
 * number nobody measured, and #342's whole point was deriving it from the room. The right fix is very
 * likely a re-bake whose hull is a genuine offset shell. **Say in the commit which one you did** — a
 * contract cannot tell a re-bake from a clamp, and the next room will re-teach this either way.
 *
 * **Probe correction:** I predicted (c) would leave clause (3) passing. It does not — deleting the row
 * drops the population to one room and the vacuity guard's `>= 2` refuses first, so (3) and (4) both
 * fail. The treatment is still refused, by a different clause than I expected. Corrected here rather
 * than left standing.
 *
 * **(c) is why clause (1) enumerates the TABLE** rather than naming the peds room: deleting the row
 * makes the symptom vanish and the station falls back to the procedural box, which is a regression
 * dressed as a fix.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) and (2) are REDs**, failing on the peds room today.
 * **(3) passes today** and is a true net pinning the ED bay's measured 0.1245. **(4) passes today** and
 * guards vacuity.
 *
 * NOT TESTED:
 *   - **That a re-baked room then renders a gradeable interior.** That is a pixel grade and I do it
 *     from a fresh capture afterwards. A green contract here is not a graded room.
 *   - **The fixture re-anchoring consequence.** `aabb_fallback` planes are guesses today; whether any
 *     fixture is visibly misplaced in the peds room is unmeasured — the frame was black.
 *   - **The +Z-only vs max-over-four inconsistency** between the two consumers. Real, filed separately
 *     in the issue, deliberately not asserted here.
 *   - **The other 13 environmentIds.** They render the procedural box and have no hull at all.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const PUBLIC = join(REPO_ROOT, "apps/ui-xr/public");
const MODULE_SRC = join(REPO_ROOT, "apps/ui-xr/src/infinigen-station-environment.ts");

const KNOWN_GOOD_ENV = "ed_exam_bay_v1";
/** Measured 2026-08-14 on the shipped ED bay, +Z and +X faces. */
const KNOWN_GOOD_THICKNESS_M = 0.1245;

type Room = { env: string; url: string; thickness: number; interiorMaxZ: number; eyeZ: number };

function tableRows(): Array<{ env: string; url: string }> {
  const src = readFileSync(MODULE_SRC, "utf8");
  const block = /INFINIGEN_ENVIRONMENT_ASSETS[^{]*\{([\s\S]*?)\n\} as const/u.exec(src)?.[1] ?? "";
  return [...block.matchAll(/^\s*([a-z0-9_]+)\s*:\s*"([^"]+)"/gmu)].map((m) => ({ env: m[1]!, url: m[2]! }));
}

async function measure(row: { env: string; url: string }): Promise<Room | null> {
  const abs = join(PUBLIC, row.url.replace(/^\//u, ""));
  if (!existsSync(abs)) return null;
  const doc = await new NodeIO().readBinary(readFileSync(abs));
  const acc: Record<string, number[]> = {};
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const key = /exterior/iu.test(node.getName()) ? "hull" : "interior";
    const t = node.getWorldMatrix();
    const cur = acc[key] ?? [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute("POSITION")?.getArray();
      if (!a) continue;
      for (let i = 0; i < a.length; i += 3) {
        const x = a[i]!, y = a[i + 1]!, z = a[i + 2]!;
        const w = [
          t[0]! * x + t[4]! * y + t[8]! * z + t[12]!,
          t[1]! * x + t[5]! * y + t[9]! * z + t[13]!,
          t[2]! * x + t[6]! * y + t[10]! * z + t[14]!,
        ];
        for (let c = 0; c < 3; c++) { if (w[c]! < cur[c]!) cur[c] = w[c]!; if (w[c]! > cur[c + 3]!) cur[c + 3] = w[c]!; }
      }
    }
    acc[key] = cur;
  }
  const I = acc["interior"];
  const H = acc["hull"];
  if (!I || !H) return null;
  // The +Z face is the one `deriveInteriorPreviewCamera` uses to place the eye.
  const thickness = Math.max(0, H[5]! - I[5]!);
  return { env: row.env, url: row.url, thickness, interiorMaxZ: I[5]!, eyeZ: I[5]! - 2 * thickness };
}

const rooms = (await Promise.all(tableRows().map(measure))).filter((r): r is Room => r !== null);

/**
 * An empty enumeration must FAIL, never pass vacuously (§7t). Plain `it` on purpose: an `it.fails`
 * cannot guard its own vacuity — it is satisfied by ANY failure, including this guard throwing.
 */
function requireRooms(): Room[] {
  expect(rooms.length, `rooms measured from INFINIGEN_ENVIRONMENT_ASSETS`).toBeGreaterThanOrEqual(2);
  return rooms;
}

describe("a generated room gives the interior camera a stand-off", () => {
  it.fails("(1) RED: every mapped room's hull stands proud of its interior", () => {
    const bad = requireRooms().filter((r) => !(r.thickness > 0));
    expect(
      bad.map((r) => `${r.env} (+Z thickness ${r.thickness.toFixed(4)} m)`),
      `zero thickness collapses the derived camera stand-off; ED bay measures ${KNOWN_GOOD_THICKNESS_M} m`,
    ).toEqual([]);
  });

  it.fails("(2) RED: the derived eye is strictly inside the room, not on its wall", () => {
    // Threshold-free: the requirement is geometric, not a number. eyeZ = interiorMaxZ means coplanar,
    // which is exactly what the live capture showed at 17:19 and why the frame was black.
    for (const r of requireRooms()) {
      expect(
        r.eyeZ,
        `${r.env}: derived eyeZ ${r.eyeZ.toFixed(4)} must be strictly inside interiorMaxZ ${r.interiorMaxZ.toFixed(4)}`,
      ).toBeLessThan(r.interiorMaxZ);
    }
  });

  it("(3) COUNTERWEIGHT: the ED bay's measured stand-off is not shrunk to normalise the two", () => {
    // Refuses (d). The cheapest way to make a comparison pass is to degrade the side that works.
    const k = requireRooms().find((r) => r.env === KNOWN_GOOD_ENV);
    expect(k, `${KNOWN_GOOD_ENV} present in the table`).toBeDefined();
    expect(
      k!.thickness,
      `${KNOWN_GOOD_ENV} +Z wall thickness, measured ${KNOWN_GOOD_THICKNESS_M} m on 2026-08-14`,
    ).toBeGreaterThanOrEqual(KNOWN_GOOD_THICKNESS_M * 0.9);
  });

  it("(4) VACUITY GUARD: the population contains a working and a broken room today", () => {
    const r = requireRooms();
    expect(r.filter((x) => x.thickness > 0).length, "rooms with a stand-off today").toBeGreaterThan(0);
    expect(r.filter((x) => x.thickness <= 0).length, "rooms without one today").toBeGreaterThan(0);
  });
});
