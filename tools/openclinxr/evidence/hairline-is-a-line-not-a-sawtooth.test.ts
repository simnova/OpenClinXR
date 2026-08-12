import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * Every MPFB actor has a jagged black sawtooth across the forehead. It survives seven #341 rounds,
 * it is on 3 of 3 actors, and it is on the most-looked-at part of a clinical figure.
 *
 * It is NOT the seam-fringe class #341 round 7 fixed. That was discarded alpha-0 hide polygons
 * showing background where no garment covered them (`f1880fe1`). The scalp is not hidden and not a
 * garment: it is a rendering primitive of the body mesh carrying its own material, and the hairline
 * is the boundary between that primitive and the skin primitive.
 *
 * MEASURED 2026-08-12 on the landed GLBs, and the FIRST metric I tried was the wrong one — recorded
 * because the next person will reach for it too:
 *
 *   forehead seam Y      aisha            kevin            child
 *   -----------------    -------------    -------------    -------------
 *   mean                 0.9319 H         0.9397 H         0.9289 H
 *   sd                   30.9 mm          39.3 mm          28.0 mm
 *   span                 147.6 mm         156.4 mm         113.0 mm
 *
 * Span and sd CANNOT distinguish a ragged hairline from a smoothly curved one — a hairline that
 * sweeps up at the temples legitimately spans centimetres. Bounding the spread would have been the
 * §11s error a third time this week: bounding a QUANTITY when the defect lives in the SHAPE.
 *
 * The signature of a sawtooth is ALTERNATION. Sorting the central-forehead seam vertices by X and
 * counting sign changes in successive dY:
 *
 *   central forehead     aisha            kevin            child
 *   -----------------    -------------    -------------    -------------
 *   seam vertices        57               37               59
 *   direction flips      37 / 55 steps    21 / 35 steps    31 / 57 steps
 *   FLIP RATE            67%              60%              54%
 *   median |dY| step     27.3 mm          6.9 mm           14.9 mm
 *
 * A smooth arc flips direction 0–10% of steps (once or twice, at its extrema). 54–67% is a boundary
 * alternating up and down almost every polygon — the per-polygon material assignment following
 * triangle edges, which is what the pixels show.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-12 before planting:
 *
 *   treatment                                    | (1) not ragged | (2) hairline stays put | (3) scalp survives | result
 *   ---------------------------------------------|----------------|------------------------|--------------------|--------
 *   a) today — per-polygon assignment            |   **FAIL**     |         pass           |       pass         | REFUSED
 *   b) raise every seam vertex to the max         |     pass       |       **FAIL**         |       pass         | REFUSED
 *   c) shrink the scalp above the visible brow    |     pass       |       **FAIL**         |       pass         | REFUSED
 *   d) drop the scalp region entirely             |     pass       |       **FAIL**         |     **FAIL**       | REFUSED
 *   e) a boundary that follows a smooth curve     |     pass       |         pass           |       pass         | ALL PASS
 *
 * (b) and (c) are the two to worry about: both flatten the flip rate to ~0 and both do it by MOVING
 * the hairline, which #341 round 5 derived from the body's own surface ("the highest face-front
 * vertex still at or ahead of the forehead plane") after establishing that the shipped anatomy has
 * no hairline reference at all. That derivation is the known-good column and must survive; a fix
 * that smooths the line by relocating it has thrown away the only anatomy we have.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails on all three today. (2) and (3)
 * PASS today and are regression nets, not evidence of a defect.
 *
 * NOT TESTED, and this is the scope statement:
 *   - No pixel is graded here. This asserts the SEAM GEOMETRY only. A hairline can be numerically
 *     smooth and still read wrong — wrong shape, wrong height for the face, wrong for a child.
 *   - Nothing is claimed about the OTHER open defects on these figures: mitten shards on the hands,
 *     the ragged waistband and trouser hems, or the child wearing its shirt on adult bands (#332).
 *     They are not shown to share this cause.
 *   - The flip-rate threshold bounds ALTERNATION, not amplitude. A finer zigzag with the same flip
 *     rate still fails, which is intended; a smooth curve with large amplitude passes, which is also
 *     intended, because that is a hairline shape question and not this contract's.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** A smooth arc reverses direction at its extrema only. Measured ambient today: 54–67%. */
const MAX_FLIP_RATE = 0.25;

/** #341 round 5 derived the hairline from the body's own surface. A fix must not relocate it. */
const HAIRLINE_BAND_H = { min: 0.90, max: 0.96 } as const;

type Row = {
  file: string;
  centralSeamVerts: number;
  steps: number;
  flips: number;
  flipRate: number;
  meanH: number;
  scalpTris: number;
};

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));
  const body = doc.getRoot().listMeshes().find((m) => /_body$/.test(m.getName()));
  if (!body) return null;

  type Prim = ReturnType<typeof body.listPrimitives>[number];
  let scalp: Prim | undefined;
  let skin: Prim | undefined;
  for (const p of body.listPrimitives()) {
    const n = p.getMaterial()?.getName() ?? "";
    if (/scalp/i.test(n)) scalp = p;
    else if (/skin/i.test(n)) skin = p;
  }
  if (!scalp || !skin) return null;

  const key = (v: number[]): string => v.map((x) => x.toFixed(5)).join(",");
  const skinSet = new Set<string>();
  const sp = skin.getAttribute("POSITION")!;
  for (let i = 0; i < sp.getCount(); i++) skinSet.add(key(sp.getElement(i, [0, 0, 0]) as number[]));

  const cp = scalp.getAttribute("POSITION")!;
  const seam: number[][] = [];
  for (let i = 0; i < cp.getCount(); i++) {
    const v = cp.getElement(i, [0, 0, 0]) as number[];
    if (skinSet.has(key(v))) seam.push(v);
  }
  if (seam.length < 20) return null;

  // Figure height from every RENDERING primitive (alpha-0 MASK regions are discarded, not drawn).
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const mat = p.getMaterial();
      if (mat?.getAlphaMode() === "MASK" && (mat?.getBaseColorFactor()?.[3] ?? 1) === 0) continue;
      const pos = p.getAttribute("POSITION");
      if (!pos) continue;
      for (let i = 0; i < pos.getCount(); i++) {
        const y = (pos.getElement(i, [0, 0, 0]) as number[])[1]!;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
  }
  const H = hi - lo;

  // Central forehead: exclude the temples, which curve back and legitimately change height.
  const xs = seam.map((v) => v[0]!);
  const zs = seam.map((v) => v[2]!);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const halfW = (Math.max(...xs) - Math.min(...xs)) / 2;
  const zmin = Math.min(...zs);
  const zmax = Math.max(...zs);
  const central = seam
    .filter((v) => Math.abs(v[0]! - cx) < 0.45 * halfW && v[2]! > zmin + 0.75 * (zmax - zmin))
    .sort((a, b) => a[0]! - b[0]!);

  let flips = 0;
  let steps = 0;
  let prev = 0;
  for (let i = 1; i < central.length; i++) {
    const dy = central[i]![1]! - central[i - 1]![1]!;
    if (Math.abs(dy) < 1e-6) continue;
    steps++;
    if (prev !== 0 && Math.sign(dy) !== Math.sign(prev)) flips++;
    prev = dy;
  }

  const meanY = central.reduce((a, v) => a + v[1]!, 0) / (central.length || 1);
  let scalpTris = 0;
  for (const p of body.listPrimitives()) {
    if (/scalp/i.test(p.getMaterial()?.getName() ?? "")) scalpTris += (p.getIndices()?.getCount() ?? 0) / 3;
  }

  return {
    file: rel.split("/").pop()!,
    centralSeamVerts: central.length,
    steps,
    flips,
    flipRate: steps ? flips / steps : 0,
    meanH: (meanY - lo) / H,
    scalpTris,
  };
}

const files = readdirSync(join(REPO_ROOT, GENERATED))
  .filter((n: string) => n.startsWith("mpfb-") && n.endsWith(".glb") && !/candidate/i.test(n))
  .map((n: string) => `${GENERATED}/${n}`);

const rows = (await Promise.all(files.map((f) => measure(f).catch(() => null)))).filter(
  (r): r is Row => r !== null,
);

/** An empty enumeration must FAIL, never pass vacuously (§7t). */
function requireRows(): void {
  expect(rows.length, `MPFB bodies with a measurable hairline seam (scanned ${files.length})`)
    .toBeGreaterThanOrEqual(3);
}

const show = (r: Row): string =>
  `${r.file}: flipRate=${(r.flipRate * 100).toFixed(0)}% (${r.flips}/${r.steps} steps, ${r.centralSeamVerts} verts) meanH=${r.meanH.toFixed(4)}`;

describe("the hairline is a line, not a sawtooth", () => {
  it.fails("(1) RED: the central forehead seam does not alternate direction every polygon", () => {
    requireRows();
    expect(
      rows.filter((r) => r.flipRate > MAX_FLIP_RATE).map(show),
      `central-forehead seams alternating more than ${MAX_FLIP_RATE * 100}% of steps`,
    ).toEqual([]);
  });

  it("(2) NET known-good: the hairline stays where #341 round 5 derived it", () => {
    // Refuses the two cheap smoothings — raise every seam vertex, or shrink the scalp above the
    // brow. Both flatten the flip rate by MOVING the line the body's own surface put there.
    requireRows();
    const moved = rows
      .filter((r) => r.meanH < HAIRLINE_BAND_H.min || r.meanH > HAIRLINE_BAND_H.max)
      .map(show);
    expect(moved, `hairlines outside ${HAIRLINE_BAND_H.min}–${HAIRLINE_BAND_H.max} H`).toEqual([]);
  });

  it("(3) NET known-good: the scalp region still exists", () => {
    // Refuses "delete the scalp": no region, no ragged boundary, contract (1) green, no hair.
    requireRows();
    const gone = rows.filter((r) => r.scalpTris < 500).map((r) => `${r.file}: scalpTris=${r.scalpTris}`);
    expect(gone, "bodies whose scalp region was dropped").toEqual([]);
  });
});
