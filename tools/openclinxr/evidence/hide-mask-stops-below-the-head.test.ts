import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * GRADED 2026-08-11 (#334): `mpfb-peds-nurse-kevin` renders with a black band across the jaw and
 * dark voids at the eyes and mouth. Measured, the cause is the hide mask — the `openclinxr_hidden_*`
 * primitives are `baseColor [0,0,0,0]` with `alphaMode MASK` / `alphaCutoff 0.5`, so their faces are
 * DISCARDED. The mask is eating the lower face.
 *
 * THE SCALP PAINT IS EXONERATED, measured: all three MPFB bodies carry a comparable
 * `openclinxr_mesh_native_scalp_hair_surface` (3,088-4,212 tris) and nurse_kevin's STARTS HIGHER
 * (0.910 H) than the child's (0.898) or aisha's (0.894). The child's grades as a neat cap. Had this
 * been filed off the render alone the scalp region would have taken the blame — in a lit capture the
 * dark cap and the dark jaw band look like one object.
 *
 * THE REFERENCE IS A JOINT POSITION, NOT A NUMBER I CHOSE. Joint world heights as a fraction of that
 * body's own stature H, from the node hierarchy:
 *
 *   body            neck01   neck03    head      jaw    | hide-mask top
 *   --------------- -------- -------- -------- -------- | -------------
 *   nurse_kevin      0.855    0.902    0.914    0.918   |   **0.924**   <- above its own jaw
 *   aisha            0.848    0.896    0.909    0.912   |     0.851
 *   patient_child    0.835    0.884    0.894    0.898   |     0.557
 *
 * Aisha's mask stops 0.061 H below her jaw; the child's stops 0.341 H below. Only nurse_kevin's is
 * above. The bound below is `<= that body's own head joint`, which is anatomy the body ships with,
 * scales across a 124 cm child and a 176 cm adult, and CANNOT BE MOVED BY A GARMENT-FITTING CHANGE
 * (§9s: the reference must be independent of the effect being measured).
 *
 * FOUR EARLIER BOUNDS ON THIS FAMILY WERE WITHDRAWN TODAY because every candidate was a constant
 * fitted between two observations — aisha's 0.851 and nurse_kevin's 0.924 admit any number between
 * them, and picking one is the §9s failure. This contract has NO constant. That is the whole
 * difference, and it is why it is being planted where those were not.
 *
 * HOW THE JOINT POSITIONS ARE READ, and the failed attempt that preceded it (§9g — disclose your own
 * broken instrument): I first inverted the skin's inverse-bind matrices directly and got
 * `clavicle.L = -128.5 cm` on an upright figure whose feet are at y=0, because the `-R^T·t` shortcut
 * assumes no scale and MPFB's IBMs carry it. The proven approach was already in the tree at
 * `parametric-body-deforms.ts:203` `buildWorldMatrices` — accumulate the NODE HIERARCHY. That is what
 * this module does. Do not reintroduce the IBM-inversion shortcut.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                     | (1) below head | (2) known-good | (3) per-body | result
 *   ----------------------------------------------|----------------|----------------|--------------|--------
 *   a) today                                      |   **FAIL**     |      pass      |     pass     | REFUSED
 *   b) clamp every mask to a constant 0.85 H      |     pass       |      pass      |   **FAIL**   | REFUSED
 *   c) delete the hide mask on nurse_kevin        |     pass       |      pass      |     pass     | see below
 *   d) derive the mask bound from the head joint  |     pass       |      pass      |     pass     | ALL PASS
 *
 * (b) is the tempting one-liner and (3) refuses it: the three head joints sit at 0.914 / 0.909 /
 * 0.894, so a contract that compares against a shared constant cannot distinguish them, and the next
 * body of a new stature regresses silently.
 *
 * (c) IS NOT REFUSED BY THIS CONTRACT and I am saying so rather than pretending otherwise (§6p — a
 * deletion needs a replacement clause). Removing the mask entirely would satisfy every clause here
 * while un-hiding the body under the garment, which is the defect #323 landed the mask to fix. The
 * companion is `mpfb2-body-is-hidden-under-cloth` — a fix must keep that green, and the `done_when`
 * runs it for exactly this reason.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is a RED and fails today on nurse_kevin alone. (2)
 * and (3) PASS today and are the known-good column — two bodies on the SAME rail through the SAME
 * pipeline are already correct, so this is not a rail-wide defect and a rail-wide change is the wrong
 * shape of fix.
 *
 * NOT TESTED: no pixel is graded here. This bounds where the mask STOPS; it does not claim the
 * remaining mask hides the right faces, that the garment above it looks right, or that nurse_kevin's
 * face is otherwise intact — the same capture showed him bare below the waist, which is #333. A
 * post-fix pixel grade is required before this is called closed.
 *
 * ## FIXED (#335)
 *
 * `materialize_mpfb_humanoid_candidate.py` now clips every body-hide mask to the body's OWN
 * head-joint world height — treatment (d) from the probe table above, the bound this contract
 * asserts — via the shared `body_param_stage.clip_hide_mask_below_joint` helper (polygon-level,
 * sibling of the footprint clip). The joint is read at rest from the standard rig's pose bone
 * (`_joint_world_z`, the same frame the exported GLB's node hierarchy reports). The mask still
 * covers the garment footprint and is never deleted: aisha's mask (0.851 H < 0.909 H head) and the
 * child's (0.557 H < 0.894 H) are untouched — the clip is a no-op on the bodies that already stop
 * below — and nurse_kevin's mask top moves from 0.921 H to below his own head joint (0.914 H), so
 * the jaw renders instead of being discarded. Re-baked all three MPFB bodies on the merged
 * materializer (2026-08-11). Measured from the exported bytes with the same attribution this file
 * drives:
 *
 *   body            head joint   mask top    result
 *   --------------- -----------  ----------  ------
 *   mpfb-ob-patient-aisha.glb    0.909 H     0.851 H   (unchanged — clip no-op)
 *   mpfb-peds-nurse-kevin.glb    0.914 H     <= 0.914 H (clip trims 0.921 -> below head)
 *   mpfb-peds-patient-child.glb  0.894 H     0.836 H   (unchanged by the clip; the #332 neck
 *                                                     anchor moved the shirt+mask up this slice)
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

/** The mask primitives, by material name. Alpha-0 MASK => faces discarded. */
const HIDE_MASK = /openclinxr_hidden_/i;
/** The joint whose world Y bounds the mask. Anatomy, per body, from the skeleton. */
const BOUNDING_JOINT = /^head$/i;

type Mat4 = number[];
const I: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      o[c * 4 + r] = s;
    }
  }
  return o;
}

/** Local TRS -> matrix. Mirrors parametric-body-deforms.ts:203; no IBM inversion. */
function localOf(n: { getTranslation(): number[] | null; getRotation(): number[] | null; getScale(): number[] | null }): Mat4 {
  const t = n.getTranslation() ?? [0, 0, 0];
  const q = n.getRotation() ?? [0, 0, 0, 1];
  const s = n.getScale() ?? [1, 1, 1];
  const [x, y, z, w] = q as [number, number, number, number];
  return [
    (1 - 2 * (y * y + z * z)) * s[0]!, 2 * (x * y + z * w) * s[0]!, 2 * (x * z - y * w) * s[0]!, 0,
    2 * (x * y - z * w) * s[1]!, (1 - 2 * (x * x + z * z)) * s[1]!, 2 * (y * z + x * w) * s[1]!, 0,
    2 * (x * z + y * w) * s[2]!, 2 * (y * z - x * w) * s[2]!, (1 - 2 * (x * x + y * y)) * s[2]!, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

type Row = { file: string; statureCm: number; headH: number; maskTopH: number };

const io = new NodeIO();

async function measure(rel: string): Promise<Row | null> {
  const doc = await io.read(join(REPO_ROOT, rel));

  const world = new Map<unknown, Mat4>();
  const visit = (n: any, pw: Mat4): void => {
    const w = mul(pw, localOf(n));
    world.set(n, w);
    for (const c of n.listChildren()) visit(c, w);
  };
  for (const n of doc.getRoot().listNodes()) {
    if (n.listParents().every((p: any) => p.propertyType !== "Node")) visit(n, I);
  }

  // Body = tallest morph-carrying mesh — identity first, size as tie-break (#331).
  let bodyLo = Infinity;
  let bodyHi = -Infinity;
  let maskTop = -Infinity;
  let best = -Infinity;
  for (const mesh of doc.getRoot().listMeshes()) {
    let lo = Infinity;
    let hi = -Infinity;
    let morphs = 0;
    for (const prim of mesh.listPrimitives()) {
      morphs = Math.max(morphs, prim.listTargets().length);
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      // PER-PRIMITIVE bounds. A first pass compared the mask material against the MESH-wide running
      // max, which already included the scalp primitive at 1.000 H, so every body looked like it had
      // a mask over its head. Accumulator scoped to the wrong loop — measure the primitive you named.
      let pLo = Infinity;
      let pHi = -Infinity;
      for (let i = 0; i < pos.getCount(); i++) {
        const v = [0, 0, 0];
        pos.getElement(i, v);
        if (v[1]! < pLo) pLo = v[1]!;
        if (v[1]! > pHi) pHi = v[1]!;
      }
      if (pLo < lo) lo = pLo;
      if (pHi > hi) hi = pHi;
      if (HIDE_MASK.test(prim.getMaterial()?.getName() ?? "") && pHi > maskTop) maskTop = pHi;
    }
    if (morphs > 0 && hi - lo > best) {
      best = hi - lo;
      bodyLo = lo;
      bodyHi = hi;
    }
  }
  if (!Number.isFinite(bodyLo) || bodyHi <= bodyLo || maskTop === -Infinity) return null;
  const H = bodyHi - bodyLo;

  let headY: number | null = null;
  for (const [n, w] of world) {
    const name = ((n as any).getName?.() ?? "").replace(/^mixamorig:/, "");
    if (BOUNDING_JOINT.test(name)) headY = w[13]!;
  }
  if (headY === null) return null;

  return {
    file: rel.split("/").pop()!,
    statureCm: H * 100,
    headH: (headY - bodyLo) / H,
    maskTopH: (maskTop - bodyLo) / H,
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
  expect(rows.length, `MPFB bodies with a hide mask (scanned ${files.length})`).toBeGreaterThanOrEqual(3);
}

const show = (r: Row): string =>
  `${r.file}: mask ${r.maskTopH.toFixed(3)}H vs head joint ${r.headH.toFixed(3)}H (H=${r.statureCm.toFixed(1)}cm)`;

describe("a hide mask stops below the head it must not eat", () => {
  it("(1) RED: no hide mask reaches above its own body's head joint", () => {
    requireRows();
    expect(rows.filter((r) => r.maskTopH > r.headH).map(show), "masks above the head joint").toEqual([]);
  });

  it("(2) NET known-good: the bodies that already stop below the head keep doing so", () => {
    requireRows();
    const good = rows.filter((r) => r.maskTopH <= r.headH);
    // Two of three are correct today on the SAME rail through the SAME pipeline — so this is not a
    // rail-wide defect, and a rail-wide change is the wrong shape of fix.
    expect(good.length, `bodies already correct: ${good.map((r) => r.file).join(", ")}`)
      .toBeGreaterThanOrEqual(2);
  });

  it("(3) NET COUNTERWEIGHT: the bound is PER BODY — a shared constant cannot be what is compared", () => {
    requireRows();
    const heads = new Set(rows.map((r) => Number(r.headH.toFixed(3))));
    expect(
      heads.size,
      `distinct head-joint heights across bodies: ${[...heads].sort().join(", ")}`,
    ).toBeGreaterThanOrEqual(3);
    // and they must track stature, so the reference is anatomy rather than a coincidence
    const byStature = [...rows].sort((a, b) => a.statureCm - b.statureCm);
    expect(byStature[0]!.headH, `shortest body's head joint is lowest`).toBeLessThan(
      byStature[byStature.length - 1]!.headH,
    );
  });
});
