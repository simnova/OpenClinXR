import { readFileSync, readdirSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * #739 / asset-pipeline-lead.
 *
 * ## THE DEFECT, MEASURED 2026-08-28 at main `5a05ffe4` — IMMUTABLE. Flip assertions and append
 * `## FIXED (#N)` below. Do not rewrite these paths or numbers.
 *
 * #738 measured one humanoid, found its teeth 1.5 mm through the face at the runtime morph weight,
 * and moved that one asset's teeth back 3 mm. The population was never measured. Measuring it:
 *
 *   asset                            rest      at 0.30   teeth-to-tongue
 *   mpfb-peds-parent-aisha           +0.0040   +0.0015   0.0045    <- the one #738 fixed
 *   mpfb-peds-patient-child          +0.0011   -0.0011   0.0056
 *   mpfb-peds-nurse-kevin            +0.0009   -0.0015   0.0075
 *   mpfb-street-adult-male           +0.0009   -0.0015   0.0075
 *   mpfb-gown-adult-patient          -0.0007   -0.0032   0.0074
 *   mpfb-clinical-physician-adult    -0.0012   -0.0058   0.0073
 *   mpfb-family-partner-adult        -0.0021   -0.0050   0.0075
 *   mpfb-clinical-nurse-adult        -0.0027   -0.0064   0.0080
 *   mpfb-gown-inspect                -0.0077   -0.0098   0.0117
 *   mpfb-ob-patient-aisha            -0.0077   -0.0098   0.0117
 *   mpfb-viseme-inspect              -0.0077   -0.0098   0.0117
 *
 * TEN OF ELEVEN are through the median face at the weight the openness channel writes every frame,
 * and FIVE are already through it at rest, with the mouth closed. Every asset carries 47 morph
 * targets including `mouth-open`, so #738's structural finding — the body morphs and the teeth
 * cannot — holds across the population.
 *
 * ## A BLANKET RETREAT IS REFUTED BY THE NUMBERS, NOT BY CAUTION
 *
 * The required retreat spans roughly 1.5 mm to 10 mm. The parent's 3 mm would leave
 * `mpfb-clinical-nurse-adult` and the three -0.0098 assets still through the face. Teeth-to-tongue
 * clearance runs 4.5 mm to 11.7 mm, so every asset has room — but not the same room.
 *
 * ## THE BAND IS PER ASSET
 *
 * #738's contract hardcoded the parent's own teeth AABB. This file derives the band from each
 * asset's teeth mesh, so a smaller head is measured against its own face rather than the parent's.
 *
 * claimScope: whether each shipped humanoid's teeth stay behind its own deformed skin median at the
 *   runtime's morph weight.
 * notEvidenceFor: how any of them looks — that is a pixel grade, and eleven assets is eleven grades.
 *   Whether the identical rows are the same bytes. Per-vertex clearance; this is an AABB face
 *   against a windowed vertex set, per #738's caveat.
 */

const DIR = "apps/ui-xr/public/generated-humanoids";
const CAP_SOURCE = "apps/ui-xr/src/viseme-morph-apply.ts";

/** The runtime's morph weight, read from source so a re-sweep binds automatically. */
function runtimeCap(): number {
  const m = /MOUTH_OPEN_CAP\s*=\s*([0-9.]+)/.exec(readFileSync(CAP_SOURCE, "utf8"));
  if (!m) throw new Error(`MOUTH_OPEN_CAP not found in ${CAP_SOURCE}`);
  return Number(m[1]);
}

type Row = { asset: string; marginAtCap: number; marginAtRest: number; tongueGap: number; skinned: boolean };

async function measure(file: string): Promise<Row | null> {
  const doc = await new NodeIO().read(`${DIR}/${file}`);
  const meshes = doc.getRoot().listMeshes();
  const teeth = meshes.find((m) => /teeth/i.test(m.getName()));
  const tongue = meshes.find((m) => /tongue/i.test(m.getName()));
  const body = meshes.find((m) => /_body$/.test(m.getName()));
  if (!teeth || !body) return null;

  const v = [0, 0, 0];
  let tMaxZ = -Infinity, yLo = Infinity, yHi = -Infinity, xHalf = 0, skinned = true;
  for (const pr of teeth.listPrimitives()) {
    if (!pr.getAttribute("JOINTS_0") || !pr.getAttribute("WEIGHTS_0")) skinned = false;
    const p = pr.getAttribute("POSITION")!;
    for (let i = 0; i < p.getCount(); i++) {
      p.getElement(i, v);
      if (v[2] > tMaxZ) tMaxZ = v[2];
      if (v[1] < yLo) yLo = v[1];
      if (v[1] > yHi) yHi = v[1];
      if (Math.abs(v[0]) > xHalf) xHalf = Math.abs(v[0]);
    }
  }
  let gMaxZ = -Infinity;
  if (tongue) for (const pr of tongue.listPrimitives()) {
    const p = pr.getAttribute("POSITION")!;
    for (let i = 0; i < p.getCount(); i++) { p.getElement(i, v); if (v[2] > gMaxZ) gMaxZ = v[2]; }
  }

  const names = (body.getExtras()?.targetNames as string[] | undefined) ?? [];
  const mi = names.indexOf("mouth-open");
  const prim = body.listPrimitives().find((pr) => /skin/i.test(pr.getMaterial()?.getName() ?? ""))
    ?? body.listPrimitives()[0]!;
  const pos = prim.getAttribute("POSITION")!;
  const delta = mi >= 0 ? prim.listTargets()[mi]?.getAttribute("POSITION") : undefined;

  const median = (w: number): number => {
    const zs: number[] = [];
    const d = [0, 0, 0];
    for (let k = 0; k < pos.getCount(); k++) {
      pos.getElement(k, v);
      if (delta) delta.getElement(k, d); else { d[0] = 0; d[1] = 0; d[2] = 0; }
      const y = v[1] + w * d[1];
      if (y < yLo || y > yHi) continue;
      if (Math.abs(v[0] + w * d[0]) > xHalf) continue;
      zs.push(v[2] + w * d[2]);
    }
    zs.sort((a, b) => a - b);
    return zs[Math.floor(zs.length / 2)]!;
  };

  return {
    asset: file,
    marginAtCap: median(runtimeCap()) - tMaxZ,
    marginAtRest: median(0) - tMaxZ,
    tongueGap: gMaxZ > -Infinity ? tMaxZ - gMaxZ : Number.NaN,
    skinned,
  };
}

const files = readdirSync(DIR).filter((f) => f.startsWith("mpfb-") && f.endsWith(".glb")).sort();
const rows = (await Promise.all(files.map(measure))).filter((r): r is Row => r !== null);

describe("every humanoid's teeth stay behind its own face (#739)", () => {
  /**
   * RED. Ten of eleven are negative at the shipped weight. The bound is each asset against itself —
   * its own skin median in its own teeth band — so no threshold of mine appears, and the weight is
   * read from `MOUTH_OPEN_CAP`.
   */
  it.fails("(1) no shipped humanoid's teeth cross its own skin median at the runtime weight", () => {
    const through = rows.filter((r) => r.marginAtCap < 0).map((r) => `${r.asset} ${r.marginAtCap.toFixed(4)}`);
    expect(
      through,
      "the teeth carry no morph targets, so a lip morph that draws the surface back exposes them; "
        + "the required retreat spans ~1.5 mm to ~10 mm, so one value cannot fix all of them",
    ).toEqual([]);
  });

  /**
   * RED, and the sharper one: five are through the face with the mouth CLOSED, which no morph can
   * be blamed for.
   */
  it.fails("(2) no shipped humanoid's teeth cross its own skin median at rest", () => {
    const through = rows.filter((r) => r.marginAtRest < 0).map((r) => `${r.asset} ${r.marginAtRest.toFixed(4)}`);
    expect(through, "at rest the mouth is closed and the morph is not involved").toEqual([]);
  });

  /**
   * COUNTERWEIGHT. Retreating far enough to clear any morph empties the mouth. The floor is each
   * asset's own tongue, an in-asset landmark, not a number of mine. Current gaps 4.5-11.7 mm.
   */
  it("(3) COUNTERWEIGHT: no asset's teeth retreat behind its own tongue", () => {
    for (const r of rows) {
      if (Number.isNaN(r.tongueGap)) continue;
      expect(r.tongueGap, `${r.asset}: teeth must stay in front of the tongue`).toBeGreaterThan(0);
    }
  });

  /**
   * COUNTERWEIGHT. Deleting or unbinding a teeth mesh is the other way to make a clause pass.
   */
  it("(4) COUNTERWEIGHT: every asset still ships skinned teeth", () => {
    expect(rows.length, "eleven mpfb-*.glb carried teeth at the planting commit").toBeGreaterThanOrEqual(11);
    for (const r of rows) expect(r.skinned, `${r.asset}: JOINTS_0 and WEIGHTS_0`).toBe(true);
  });

  /**
   * KNOWN-GOOD. The one asset #738 already fixed passes both REDs today, so a failure there would
   * mean this instrument disagrees with #738's rather than that the population is broken.
   */
  it("(5) KNOWN-GOOD: the asset #738 fixed clears both bounds", () => {
    const p = rows.find((r) => r.asset === "mpfb-peds-parent-aisha.glb")!;
    expect(p.marginAtRest, "measured +0.0040 after #738").toBeGreaterThan(0);
    expect(p.marginAtCap, "measured +0.0015 after #738").toBeGreaterThan(0);
  });
});

// NOT TESTED: how any of the eleven looks — that is a pixel grade, and eleven assets is eleven
// grades, not one. Whether the identical rows are the same bytes: gown-inspect, ob-patient-aisha and
// viseme-inspect read identically, as do peds-nurse-kevin and street-adult-male. Whether every asset
// is cast into a station; an unused inspect asset failing matters less than a shipped one. Per-vertex
// clearance — this is an AABB face against a windowed vertex set, per #738's stated caveat.
