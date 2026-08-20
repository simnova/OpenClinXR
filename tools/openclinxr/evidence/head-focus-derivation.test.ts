import { readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deriveHeadBoxFromPoints,
  isFittedHairMeshName,
  type Vec3,
} from "../../../apps/ui-xr/src/head-box-from-geometry.js";

/**
 * #358 — the head-focus station must frame the head on EVERY rail, not only MPFB.
 *
 * MEASURED (orchestrator, 2026-08-13, before this slice): rendering both hair
 * mechanisms through `focus=eyes` returned 4 crops, 1024×1024, zero refusals —
 * and two of them framed an entirely different subject. `mpfb-ob-patient-aisha`
 * (MPFB) framed the head; `peds_nurse_kevin` (Anny) silently fell back to the
 * whole body (92 KB vs 494 KB — byte size was the only signal). The cause is
 * NOT a naming mismatch: 7 of 7 Anny actors have eye BONES and ZERO eye
 * GEOMETRY (0 prims match eye|cornea|iris|sclera). The eye box cannot be
 * derived there because there is no eye mesh.
 *
 * The fix: `focus=head` derives the head box from geometry every humanoid has —
 * the topmost band of the body's own bounds, cut at the neck via the silhouette
 * width profile (`deriveHeadBoxFromPoints`, the SAME pure function the lab and
 * the file-side inspection share, so runtime and measurement cannot drift).
 * And the station refuses an unresolvable focus instead of falling back
 * silently (`probeHeadFocusRefusal` below pins that).
 *
 * #394 (2026-08-14): fitted hair broke the derivation — the bob masks the neck
 * constriction, so `deriveHeadBoxFromPoints` returned null on aisha once #381
 * fitted her hair. Fitted hair is NOT body: hair meshes are excluded from the
 * silhouette profile (the neck stays findable) but their bounds union into the
 * box via `containPoints`, and the containment clause below pins that every
 * hair vertex lies INSIDE the derived box — derive from body, frame to
 * body+hair. A box that derives cleanly but decapitates the hairstyle is not a
 * fix, and this contract is what distinguishes the two.
 *
 * NOT TESTED here: how the hair LOOKS in the crops — that is the orchestrator's
 * pixel grade of mpfb-head-front.png / anny-head-front.png. This contract only
 * pins that the framing is the head on both rails and the framing is recorded.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = "apps/ui-xr/public/generated-humanoids";

const MPFB_SUBJECT = "mpfb-ob-patient-aisha.glb";
const ANNY_SUBJECT = "peds_nurse_kevin.glb";
const ANNY_DECOY = "ed_chest_pain_adult_cast.glb";

/** Head is roughly the top eighth to top third of a standing body. */
const HEAD_HEIGHT_FRACTION_BAND = { min: 0.06, max: 0.45 } as const;
/** The neck of a standing humanoid sits between ~65% and ~95% of body height. */
const NECK_FRACTION_BAND = { min: 0.65, max: 0.95 } as const;
/** The head must contain a real share of the body's vertices — not a sliver. */
const MIN_HEAD_VERTEX_FRACTION = 0.005;

const EYE_MESH_RE = /eyes|iris|cornea|sclera/i;

/**
 * #394: fitted hair is not body — hair meshes feed the head BOX via
 * `containPoints` (the crop must contain the hair) but never the silhouette
 * profile (hair masks the neck constriction). Returns the three point sets
 * from the same traversal.
 */
function worldPoints(doc: import("@gltf-transform/core").Document): {
  points: Vec3[];
  silhouettePoints: Vec3[];
  containPoints: Vec3[];
} {
  const points: Vec3[] = [];
  const silhouettePoints: Vec3[] = [];
  const containPoints: Vec3[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const isHair = isFittedHairMeshName(mesh.getName() ?? "")
      || isFittedHairMeshName(node.getName() ?? "");
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")?.getArray();
      if (!pos) continue;
      for (let i = 0; i + 2 < pos.length; i += 3) {
        const p: Vec3 = {
          x: wm[0] * Number(pos[i]) + wm[4] * Number(pos[i + 1]) + wm[8] * Number(pos[i + 2]) + wm[12],
          y: wm[1] * Number(pos[i]) + wm[5] * Number(pos[i + 1]) + wm[9] * Number(pos[i + 2]) + wm[13],
          z: wm[2] * Number(pos[i]) + wm[6] * Number(pos[i + 1]) + wm[10] * Number(pos[i + 2]) + wm[14],
        };
        points.push(p);
        if (isHair) containPoints.push(p);
        else silhouettePoints.push(p);
      }
    }
  }
  return { points, silhouettePoints, containPoints };
}

function bodyBoundsOf(pts: ReadonlyArray<Vec3>): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) {
    if (p.x < min.x) min.x = p.x;
    if (p.y < min.y) min.y = p.y;
    if (p.z < min.z) min.z = p.z;
    if (p.x > max.x) max.x = p.x;
    if (p.y > max.y) max.y = p.y;
    if (p.z > max.z) max.z = p.z;
  }
  return { min, max };
}

function eyeMeshPresent(doc: import("@gltf-transform/core").Document): boolean {
  return doc
    .getRoot()
    .listNodes()
    .some((node) => {
      const mesh = node.getMesh();
      if (!mesh) return false;
      const materialNames = mesh
        .listPrimitives()
        .map((p) => p.getMaterial()?.getName() ?? "")
        .filter(Boolean);
      return [mesh.getName() ?? "", node.getName() ?? "", ...materialNames].some((n) =>
        EYE_MESH_RE.test(n),
      );
    });
}

function headContractFor(file: string, label: string): void {
  describe(`head box derives from the body bounds on the ${label} rail (#358)`, () => {
    let doc: import("@gltf-transform/core").Document;
    let pts: Vec3[];
    let silhouette: Vec3[];
    let hair: Vec3[];
    let body: { min: Vec3; max: Vec3 };
    beforeAll(async () => {
      doc = await new NodeIO().read(join(REPO_ROOT, GENERATED, file));
      const split = worldPoints(doc);
      pts = split.points;
      silhouette = split.silhouettePoints;
      hair = split.containPoints;
      body = bodyBoundsOf(pts);
    });

    it("derives a head box from the body geometry alone", () => {
      const head = deriveHeadBoxFromPoints(pts, { silhouettePoints: silhouette, containPoints: hair });
      expect(head, "deriveHeadBoxFromPoints returned null on a standing humanoid").not.toBeNull();
      const height = head!.box.max.y - head!.box.min.y;
      const bodyHeight = body.max.y - body.min.y;
      expect(height / bodyHeight, "head height fraction outside the anatomical band").toBeGreaterThanOrEqual(
        HEAD_HEIGHT_FRACTION_BAND.min,
      );
      expect(height / bodyHeight).toBeLessThanOrEqual(HEAD_HEIGHT_FRACTION_BAND.max);
    });

    it("cuts the head at the neck, which sits in the anatomical neck band", () => {
      const head = deriveHeadBoxFromPoints(pts, { silhouettePoints: silhouette, containPoints: hair });
      expect(head).not.toBeNull();
      const bodyHeight = body.max.y - body.min.y;
      const neckFraction = (head!.neckPosition - body.min.y) / bodyHeight;
      expect(neckFraction, `neck at ${(neckFraction * 100).toFixed(1)}% of body height`).toBeGreaterThanOrEqual(
        NECK_FRACTION_BAND.min,
      );
      expect(neckFraction).toBeLessThanOrEqual(NECK_FRACTION_BAND.max);
    });

    it("frames a real region — the head box reaches the top of the body and holds a real vertex share", () => {
      const head = deriveHeadBoxFromPoints(pts, { silhouettePoints: silhouette, containPoints: hair });
      expect(head).not.toBeNull();
      expect(head!.box.max.y, "the head box does not reach the top of the body").toBeCloseTo(body.max.y, 2);
      expect(
        head!.vertexCount / pts.length,
        `head holds ${((head!.vertexCount / pts.length) * 100).toFixed(2)}% of body vertices`,
      ).toBeGreaterThanOrEqual(MIN_HEAD_VERTEX_FRACTION);
    });

    it("the head box does NOT span the shoulders (the #354 whole-body failure mode)", () => {
      const head = deriveHeadBoxFromPoints(pts, { silhouettePoints: silhouette, containPoints: hair });
      expect(head).not.toBeNull();
      const headWidth = head!.box.max.x - head!.box.min.x;
      const bodyWidth = body.max.x - body.min.x;
      // The head is far narrower than the body (shoulders/arms). A whole-body
      // frame would span the full body width.
      expect(
        headWidth / bodyWidth,
        `head width ${(headWidth / bodyWidth).toFixed(2)} of body width — the frame spans the shoulders`,
      ).toBeLessThan(0.6);
    });

    it("the head box CONTAINS the fitted hair on every face (#394)", () => {
      // Only figures with fitted hair carry a containment obligation.
      if (hair.length === 0) return;
      const head = deriveHeadBoxFromPoints(pts, { silhouettePoints: silhouette, containPoints: hair });
      expect(head, "deriveHeadBoxFromPoints returned null on a figure with fitted hair").not.toBeNull();

      // Per-axis cut measurement: how far each hair extreme lies OUTSIDE the box.
      const cut = (ax: "x" | "y" | "z") => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of hair) {
          if (p[ax] < lo) lo = p[ax];
          if (p[ax] > hi) hi = p[ax];
        }
        const loCut = Math.max(0, head!.box.min[ax] - lo);
        const hiCut = Math.max(0, hi - head!.box.max[ax]);
        return { loCut, hiCut, hairLo: lo, hairHi: hi };
      };
      const x = cut("x");
      const y = cut("y");
      const z = cut("z");
      const cm = (v: number) => `${(v * 100).toFixed(2)} cm`;
      const message =
        "the head box cuts the fitted hair — a head crop would clip the hairstyle:\n"
        + `  axis   box (cm)                        hair (cm)                        cut lo / hi\n`
        + `  x      ${(head!.box.min.x * 100).toFixed(1).padStart(7)} .. ${(head!.box.max.x * 100).toFixed(1).padEnd(7)}    ${(x.hairLo * 100).toFixed(1).padStart(7)} .. ${(x.hairHi * 100).toFixed(1).padEnd(7)}    ${cm(x.loCut)} / ${cm(x.hiCut)}\n`
        + `  y      ${(head!.box.min.y * 100).toFixed(1).padStart(7)} .. ${(head!.box.max.y * 100).toFixed(1).padEnd(7)}    ${(y.hairLo * 100).toFixed(1).padStart(7)} .. ${(y.hairHi * 100).toFixed(1).padEnd(7)}    ${cm(y.loCut)} / ${cm(y.hiCut)}\n`
        + `  z      ${(head!.box.min.z * 100).toFixed(1).padStart(7)} .. ${(head!.box.max.z * 100).toFixed(1).padEnd(7)}    ${(z.hairLo * 100).toFixed(1).padStart(7)} .. ${(z.hairHi * 100).toFixed(1).padEnd(7)}    ${cm(z.loCut)} / ${cm(z.hiCut)}`;
      const maxCut = Math.max(x.loCut, x.hiCut, y.loCut, y.hiCut, z.loCut, z.hiCut);
      expect(maxCut, message).toBeLessThanOrEqual(0.0005);
    });
  });
}

headContractFor(MPFB_SUBJECT, "MPFB");
headContractFor(ANNY_SUBJECT, "Anny");
headContractFor(ANNY_DECOY, "Anny (ED cast)");

/**
 * #483 — E5 floor: the #394 fitted-hair containment obligation must be LIVE for at least one
 * subject. `headContractFor` exempts hairless figures at :194; nothing asserted ANY figure carries
 * the duty, so dropping aisha's hair mesh (or repointing the constant) would let all three subjects
 * exempt while the clause still reported green. This floor measures the same quantity the exemption
 * gates on (`containPoints`, the fitted-hair point set) and is a lower bound, never an equality —
 * a second figure gaining a hairstyle must not red it.
 */
describe("the fitted-hair containment obligation is live for at least one subject (#483)", () => {
  it("at least one of the three subjects carries fitted hair", async () => {
    const io = new NodeIO();
    const subjectsWithHair: string[] = [];
    for (const file of [MPFB_SUBJECT, ANNY_SUBJECT, ANNY_DECOY]) {
      const doc = await io.read(join(REPO_ROOT, GENERATED, file));
      const { containPoints } = worldPoints(doc);
      if (containPoints.length > 0) subjectsWithHair.push(file);
    }
    expect(
      subjectsWithHair.length,
      `the #394 obligation is dormant — none of ${[MPFB_SUBJECT, ANNY_SUBJECT, ANNY_DECOY].join(", ")}`
        + ` carries fitted hair, so the containment clause above exempts every subject and still reports green`,
    ).toBeGreaterThan(0);
  });
});

describe("eye mesh presence — the #358 cause, measured file-side", () => {
  it("the MPFB asset carries eye geometry; the Anny assets do not", async () => {
    const io = new NodeIO();
    const mpfb = await io.read(join(REPO_ROOT, GENERATED, MPFB_SUBJECT));
    const anny = await io.read(join(REPO_ROOT, GENERATED, ANNY_SUBJECT));
    expect(eyeMeshPresent(mpfb), "MPFB asset lost its eye mesh").toBe(true);
    expect(
      eyeMeshPresent(anny),
      "Anny asset has eye geometry — the #358 premise (eye bones, zero eye geometry) is wrong",
    ).toBe(false);
  });
});

describe("the head-focus station refuses instead of falling back (#358)", () => {
  it("focus=eyes on an Anny asset (no eye mesh) REFUSES loudly", async () => {
    const mod = await import("./isolated-subject-harness.js") as Record<string, unknown>;
    const probe = mod["probeHeadFocusRefusal"] as
      | ((options?: Record<string, unknown>) => Promise<{
          refused: boolean;
          error: string | null;
          subject: { rail: string; glb: string; focus: string };
        }>)
      | undefined;
    expect(probe, "probeHeadFocusRefusal disappeared").toBeTypeOf("function");
    const result = await probe!({});
    expect(result.subject.rail).toBe("anny");
    expect(result.subject.focus).toBe("eyes");
    expect(
      result.refused,
      `focus=eyes on the Anny asset did NOT refuse (error: ${result.error ?? "none"}) — the station fell back silently`,
    ).toBe(true);
    expect(result.error).toMatch(/refusing rather than falling back/);
  }, 1_800_000);

  it("renders matched head crops on BOTH rails and records the framing used", async () => {
    const mod = await import("./isolated-subject-harness.js") as Record<string, unknown>;
    const render = mod["renderHeadFocusCrops"] as
      | ((options?: Record<string, unknown>) => Promise<{
          crops: Array<{
            rail: string;
            imagePath: string;
            pngDimensions: { width: number; height: number } | null;
            frameSpanFraction: number | null;
            focusRegion: { kind: string } | null | undefined;
          }>;
          summary: { devServerBoots: number; browserLaunches: number };
        }>)
      | undefined;
    expect(render, "renderHeadFocusCrops disappeared").toBeTypeOf("function");

    const run = await render!({});
    expect(run.crops.length, "expected one crop per rail").toBe(2);
    for (const crop of run.crops) {
      expect(["mpfb", "anny"], `unexpected rail ${crop.rail}`).toContain(crop.rail);
      expect(crop.pngDimensions, `${crop.rail}: crop is not a PNG on disk`).not.toBeNull();
      expect(crop.pngDimensions!.width, `${crop.rail}: crop too narrow`).toBeGreaterThanOrEqual(512);
      expect(crop.pngDimensions!.height, `${crop.rail}: crop too short`).toBeGreaterThanOrEqual(512);
      expect(
        crop.frameSpanFraction,
        `${crop.rail}: the head does not fill the frame (span ${crop.frameSpanFraction})`,
      ).not.toBeNull();
      expect(crop.frameSpanFraction!).toBeGreaterThan(0.5);
      expect(
        crop.focusRegion?.kind,
        `${crop.rail}: the run did not record head_box framing — the station degraded silently`,
      ).toBe("head_box");
    }
  }, 1_800_000);

  it("the delivered crops exist at the contract paths", () => {
    const preFix = JSON.parse(
      readFileSync(join(REPO_ROOT, ".openclinxr/evidence/head-focus/pre-fix.json"), "utf8"),
    ) as { subjects?: Array<{ rail: string; framingCurrentCodeSelects: string; onScreenHeadHeightPx: number }> };
    expect(
      preFix.subjects,
      "missing .openclinxr/evidence/head-focus/pre-fix.json — the before-column is required",
    ).toBeTruthy();
    const anny = preFix.subjects!.find((s) => s.rail === "anny");
    expect(anny, "pre-fix.json has no Anny row").toBeDefined();
    expect(
      anny!.framingCurrentCodeSelects,
      "pre-fix must record the CURRENT silent fallback (the #358 defect)",
    ).toBe("whole_subject_fallback");
    expect(
      anny!.onScreenHeadHeightPx,
      `Anny head height ${anny!.onScreenHeadHeightPx} px is not the motivating ~100 px`,
    ).toBeLessThan(200);
  });
});
