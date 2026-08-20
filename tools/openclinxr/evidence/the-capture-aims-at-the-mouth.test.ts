import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * E2 / xr-systems-architect. Superagent ruled #470 over #471 on 2026-08-20 and named the anchor.
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE. Flip assertions and append `## FIXED (#N)`.
 *
 * `ui-xr-viseme-drive-capture.ts:255-305` anchors the WHOLE framing to the crown apex:
 *
 *   localHeadY      = geometry.boundingBox.max.y      crown apex
 *   camera position = headWorld + (0.04, 0.04, 0.72)  4 cm ABOVE the apex
 *   camera lookAt   = headWorld.y - 0.04              4 cm BELOW the apex
 *   raycast target  = headWorld                       the apex exactly
 *
 * At FOV 28 and 0.72 m the vertical extent is ~0.36 m, so the frame centres on the SCALP. The apex
 * is where the surface is TANGENT to a horizontal ray, so the ray grazes the silhouette by
 * construction and reports whatever is behind — measured `kitchen_00exterior` at 4.42 m with the
 * head at 0.71 m. **Camera, lookAt and ray must all move to one new anchor; nudging the ray alone
 * is not the fix.** `:255` also still carries `let localHeadY = 1.12`, a child-calibrated literal.
 *
 * ## WHY 0.04 IS THE BOUND IN CLAUSE (1), AND WHY IT IS NOT FITTED
 *
 * The code ALREADY drops the lookAt 4 cm below the apex. A new anchor that does not clear that
 * existing cosmetic offset is indistinguishable from today's behaviour. The bound is therefore read
 * off the INPUT — a constant already in the file — not fitted to whatever the fix happens to
 * produce. A jaw sits far below 4 cm; if a candidate anchor only just clears it, that is a signal
 * the anchor is still in the skull.
 *
 * ## MY OWN FAILED INSTRUMENT — do not rebuild it
 *
 * I tried to derive the crown-to-jaw offset from the GLB by summing joint local translations up the
 * parent chain. It returned `eye.L` **0.264 m ABOVE the crown**, which is impossible: the method
 * ignores bone rotations and MPFB rigs have them. **Read the joint's world position from the live
 * scene graph (`getWorldPosition`), never from file-space arithmetic.**
 *
 * ## KNOWN-GOOD COLUMN (SS9h) — machine-read from all 16 shipped GLBs
 *
 *   MPFB rail  9 bodies  137 joints  jaw YES  eye.L yes  head yes
 *   Anny rail  7 bodies   23 joints  jaw NO   eye.L yes  head yes
 *
 * So the ruled fallback chain (`jaw` -> eye midpoint -> `head` -> fail closed) is load-bearing, not
 * decoration: an implementation that assumes `jaw` exists breaks seven shipped bodies. Clause (5)
 * pins that population so the chain cannot be quietly dropped.
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * (1)(2)(3) read the new artifact and (4) reads the tree: all four are **REDS**, planted `it.fails`.
 * I first labelled (4) a net and the plant run refused it — `1.12` is present TODAY, so a clause
 * asserting its absence cannot be a net. Only (5) passes on a clean tree: it reads the shipped GLBs
 * and is the **sole TRUE NET**.
 *
 * NOT TESTED:
 *   - That a viseme is legible. This proves the mouth is FRAMED and FIRST-HIT, not readable.
 *   - The 6 FACS-only MPFB bodies and the 7 Anny bodies — the contract measures the parent.
 *   - Whether `jaw` is the best anchor versus a mouth morph centroid. It is the ruled anchor.
 *   - Quest, clinical validity, exam equivalence.
 *
 * ## FIXED (#472)
 *
 * (1)-(4) flipped `it.fails` -> `it` on 2026-08-20 after the capture anchored on `jaw` at runtime:
 *   aimJointName=jaw, aimWorldY=1.5306, crownApexWorldY=1.7284 (drop 0.198 > 0.08 band),
 *   subjectVisible=true, firstHitMeshName=mpfb_ob_patient_aisha_body_1 (not kitchen_00exterior),
 *   subjectInFrame=true, headNdc≈(0,0). The raycast now skins the parent's head-region vertices
 *   through the live skeleton — the bind-pose AABB was at a different place than the skinned face,
 *   which is why the crown-aimed ray "grazed the silhouette" and hit the room hull. The numeric
 *   `localHeadY` seed is retired; the anchor comes from `jaw` -> `eye.L`/`eye.R` midpoint -> `head`
 *   -> fail closed (`no-anchor-joint`), never an AABB extreme. (5) stays the unchanged NET.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const CAPTURE = join(HERE, "ui-xr-viseme-drive-capture.ts");
const SUMMARY = join(HERE, "capture-aims-at-the-mouth.json");
const MPFB = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb");
const ANNY = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb");

/**
 * The file's existing cosmetic band: the camera sits +0.04 ABOVE the apex and looks -0.04 BELOW it,
 * so 0.08 m is the full wobble already present. An anchor inside that band is indistinguishable
 * from today. Read off the INPUT (two constants in the file), not fitted to any fix's output.
 * Probe D3 (2026-08-20) defeated the earlier 0.04 bound: 1.6669 - 1.6269 is 0.04000000000000004 in
 * IEEE, so `> 0.04` was TRUE at exactly the boundary.
 */
const EXISTING_COSMETIC_BAND_M = 0.08;
const ALLOWED_ANCHORS = ["jaw", "eye_midpoint", "head"] as const;

type Summary = {
  capturedFrom: string;
  aimJointName: string | null;
  aimWorldY: number;
  crownApexWorldY: number;
  subjectVisible: boolean;
  firstHitMeshName: string | null;
  subjectInFrame: boolean;
  headNdc: { x: number; y: number };
};

function summary(): Summary {
  if (!existsSync(SUMMARY)) throw new Error(`${SUMMARY} does not exist — the capture must write it.`);
  return JSON.parse(readFileSync(SUMMARY, "utf8")) as Summary;
}

async function jointNames(glb: string): Promise<Set<string>> {
  const doc = await new NodeIO().read(glb);
  const skin = doc.getRoot().listSkins()[0];
  return new Set((skin?.listJoints() ?? []).map((j) => j.getName()));
}

const MPFB_JOINTS = await jointNames(MPFB);
const ANNY_JOINTS = await jointNames(ANNY);

describe("the viseme capture aims at the mouth, not the crown", () => {
  it("(1) RED: the anchor is a named joint well below the crown apex", () => {
    const s = summary();
    expect(ALLOWED_ANCHORS as readonly string[], `anchor was ${s.aimJointName}; an AABB extreme is never allowed`)
      .toContain(s.aimJointName ?? "");
    const drop = s.crownApexWorldY - s.aimWorldY;
    expect(drop, `anchor is ${drop.toFixed(3)} m below the apex; the file already wobbles ${EXISTING_COSMETIC_BAND_M} m (camera +0.04, lookAt -0.04), so this must clear that band to be a real change`)
      .toBeGreaterThan(EXISTING_COSMETIC_BAND_M);
  });

  it("(2) RED: the subject is the first hit, not the room hull", () => {
    const s = summary();
    expect(s.subjectVisible, "camera->anchor ray must reach the parent").toBe(true);
    expect(s.firstHitMeshName ?? "", "the room hull must not be the first hit").not.toContain("kitchen_00exterior");
    expect(s.firstHitMeshName, "something must actually be hit").not.toBeNull();
  });

  it("(3) RED: the anchor projects inside the frame", () => {
    const s = summary();
    expect(s.subjectInFrame, `headNdc ${JSON.stringify(s.headNdc)} must be inside [-1,1]`).toBe(true);
    expect(Math.abs(s.headNdc.x) <= 1 && Math.abs(s.headNdc.y) <= 1, "NDC agrees with the flag").toBe(true);
  });

  it("(4) RED: the child-calibrated literal is gone", () => {
    // Reads the tree. RED today because 1.12 is present. Once retired it also keeps passing, so it
    // doubles as a ratchet against reintroducing a silent constant when a joint fails to resolve.
    // Assert on the CODE, not the string: probe D5 showed "1.12" also appears in the #465 comment
    // above :255, and a contract that forces a worker to mangle a historical comment is a bad
    // contract — the planted-header immutability rule protects exactly that text.
    const src = readFileSync(CAPTURE, "utf8");
    const assignments = [...src.matchAll(/localHeadY\s*=\s*([0-9.]+)/g)].map((m) => m[1]);
    expect(assignments, `a numeric localHeadY seed is the child constant; the anchor must come from a joint`).toEqual([]);
  });

  it("(5) NET: the fallback chain is load-bearing, not decoration", () => {
    // Reads the shipped GLBs. If someone later assumes `jaw` exists everywhere, this states plainly
    // that seven bodies do not have it.
    expect(MPFB_JOINTS.has("jaw"), "the MPFB parent carries jaw — the primary anchor").toBe(true);
    expect(ANNY_JOINTS.has("jaw"), "the Anny rail does NOT carry jaw — hence the fallback").toBe(false);
    expect(ANNY_JOINTS.has("eye.L") && ANNY_JOINTS.has("head"), "the Anny fallbacks must exist").toBe(true);
  });
});
