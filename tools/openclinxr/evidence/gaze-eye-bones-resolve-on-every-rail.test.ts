import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

import { resolvePoseBone } from "../../../packages/openclinxr/asset-registry/src/pose-bone-resolver.js";

/**
 * #311 landed a gaze applier that rotates the eye bones instead of spinning the whole actor. #307
 * then landed the MPFB `mixamo_unity` rig on the two library bodies, which RENAMED those bones. Gaze
 * now misses on both — a regression introduced by the landing ORDER of two slices that each passed
 * their own contract.
 *
 * MEASURED 2026-08-11, `resolvePoseBone(landmark, jointNames)` against the shipped rigs:
 *
 *   rail                          | joints | eye bones present            | eyeL resolves
 *   ------------------------------|--------|------------------------------|---------------
 *   body-param-adult_lean_female  |   64   | mixamorig:LeftEye / RightEye |  **null**
 *   body-param-adult_heavy_male   |   64   | mixamorig:LeftEye / RightEye |  **null**
 *   mpfb-ob-patient-aisha         |  137   | eyeL / eyeR                  |  eyeL
 *   peds_anxious_parent (Anny)    |   23   | eyeL / eyeR                  |  eyeL
 *
 * WHY NEITHER CONTRACT CAUGHT IT — and both were mine:
 *   - #311's contract builds a SYNTHETIC skeleton naming its bones `eyeL`/`eyeR`, so it proves the
 *     applier rotates whatever it is handed. It never reads a shipped rig.
 *   - #306's contract enumerates 14 pose landmarks — `upper_armL`, `thighL`, `spine`, … — and eyes
 *     are NOT among them, so the `mixamorig:` alias map #307 added covers arms, legs, spine and neck
 *     and stops short of the eyes.
 *
 * Each contract was sound about its own subject. The gap is the SEAM: a renaming slice and a
 * consuming slice, landed in that order, with no contract spanning both. This one spans it — it
 * resolves against the actual shipped GLBs rather than a fixture.
 *
 * THE CHEAP FIXES THIS REFUSES, probed 2026-08-11 before planting:
 *
 *   treatment                                     | (1) resolves | (2) distinct + present | result
 *   ----------------------------------------------|--------------|------------------------|--------
 *   a) today                                      |     FAIL     |         FAIL           | REFUSED
 *   b) return "mixamorig:LeftEye" for both eyes   |     pass     |       **FAIL**         | REFUSED
 *   c) return a name absent from the rig          |   **FAIL**   |         FAIL           | REFUSED
 *   d) alias eyeL/eyeR per rig convention         |     pass     |         pass           | ALL PASS
 *
 * (b) is the one to worry about: a single-entry alias makes "gaze resolves" true while both eyes
 * rotate as one, which reads as a lazy stare rather than a look. (2) refuses it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) and (2) are REDs and fail today on the two library
 * bodies. (3) PASSES today and is the known-good column — the MPFB2 and Anny rails already resolve,
 * and a fix must not break the rails that work.
 *
 * NOT TESTED: nothing is rendered and no eye is rotated. This asserts NAME RESOLUTION against shipped
 * rigs only. Whether the resolved bone visibly moves an eyeball is a separate question — and on the
 * Anny rail the answer is probably no: its eye bones carry weight but **zero** eye-dominant vertices
 * (#296). Nothing here claims a gaze looks like a person looking somewhere.
 *
 * ## FIXED (#312)
 *
 * `MIXAMORIG_RIG_BONE_NAMES` in `packages/openclinxr/asset-registry/src/pose-bone-resolver.ts` now
 * covers the eyes (`eyeL` → `mixamorig:LeftEye`, `eyeR` → `mixamorig:RightEye`; both are direct
 * children of `mixamorig:Head` on the shipped library bodies, verified against the GLBs). The two
 * `it.fails` markers were flipped to `it`; (1) and (2) now pass on all four rails, and the MPFB2 /
 * Anny rails still resolve the eyes by identity. The `pose-bones-resolve-on-every-rail` net was
 * extended in the same slice so a future eye-bone rename goes red there too (see its FIXED block).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");

/** three.js `PropertyBinding.sanitizeNodeName` strips dots, so the scene graph sees `eyeL`. */
const EYE_LANDMARKS = ["eyeL", "eyeR"] as const;

const RAILS = [
  {
    id: "library_lean_female",
    glb: "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
    knownGood: false,
  },
  {
    id: "library_heavy_male",
    glb: "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_heavy_male-library.glb",
    knownGood: false,
  },
  {
    id: "mpfb2_aisha",
    glb: "apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb",
    knownGood: true,
  },
  {
    id: "anny_parent",
    glb: "apps/ui-xr/public/generated-humanoids/peds_anxious_parent.glb",
    knownGood: true,
  },
] as const;

const io = new NodeIO();
const sanitise = (n: string): string => n.replaceAll(".", "");

async function jointNames(rel: string): Promise<Set<string>> {
  const doc = await io.read(`${REPO_ROOT}/${rel}`);
  const skin = doc.getRoot().listSkins()[0];
  if (!skin) throw new Error(`${rel}: no skin`);
  return new Set(skin.listJoints().map((j) => sanitise(j.getName())));
}

const rigs = await Promise.all(
  RAILS.map(async (r) => ({ ...r, names: await jointNames(r.glb) })),
);

describe("a gaze drive can reach the eye bones on every shipped rail", () => {
  it("(1) RED: both eye landmarks resolve to a joint present on every shipped humanoid", () => {
    const misses: string[] = [];
    for (const rig of rigs) {
      for (const landmark of EYE_LANDMARKS) {
        const resolved = resolvePoseBone(landmark, rig.names);
        if (!resolved || !rig.names.has(resolved)) {
          misses.push(`${rig.id}: ${landmark} -> ${resolved ?? "null"}`);
        }
      }
    }
    expect(misses, "rails where a gaze drive cannot reach an eye bone").toEqual([]);
  });

  it(
    "(2) RED COUNTERWEIGHT: the two eyes resolve to DISTINCT joints — aliasing both to one bone is refused",
    () => {
      const collapsed: string[] = [];
      for (const rig of rigs) {
        const left = resolvePoseBone("eyeL", rig.names);
        const right = resolvePoseBone("eyeR", rig.names);
        if (!left || !right) {
          collapsed.push(`${rig.id}: unresolved (L=${left ?? "null"} R=${right ?? "null"})`);
          continue;
        }
        if (left === right) collapsed.push(`${rig.id}: both eyes resolved to "${left}"`);
      }
      expect(collapsed, "rails whose eyes collapse to one bone").toEqual([]);
    },
  );

  it("(3) NET known-good: the rails that already resolve must keep resolving", () => {
    for (const rig of rigs.filter((r) => r.knownGood)) {
      for (const landmark of EYE_LANDMARKS) {
        const resolved = resolvePoseBone(landmark, rig.names);
        expect(resolved, `${rig.id}: ${landmark}`).not.toBeNull();
        expect(rig.names.has(resolved!), `${rig.id}: ${landmark} -> ${resolved} exists`).toBe(true);
      }
      expect(resolvePoseBone("eyeL", rig.names)).not.toBe(resolvePoseBone("eyeR", rig.names));
    }
    // and every rail genuinely carries two eye bones, so a red on (1) is resolution, not absence
    for (const rig of rigs) {
      const eyes = [...rig.names].filter((n) => /eye/i.test(n));
      expect(eyes.length, `${rig.id} eye bones present: ${eyes.join(", ")}`).toBeGreaterThanOrEqual(2);
    }
  });
});
