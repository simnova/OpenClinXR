import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The materializer must run the teeth retreat after glTF export, not drop it.
 *
 * A nurse rebake loses the #739 teeth retreat because the export path never
 * calls the existing station. Source-assertion only: the materializer must
 * reference the station, print TEETH_REST_CLEARANCE, compute
 * delta = abs(marginAtCap) + 0.0005, and apply it only when marginAtCap < 0.
 *
 * No Blender, no GLB, no rebake pixels.
 *
 * NOT TESTED: the retreated pixels themselves (nurse rebake card owns that).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const MAT = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

function mat(): string {
  expect(existsSync(MAT), `${MAT} — the factory materializer`).toBe(true);
  return readFileSync(MAT, "utf8");
}

describe("materializer runs teeth-rest-clearance", () => {
  it("calls the station and prints TEETH_REST_CLEARANCE", () => {
    const src = mat();
    expect(src, "station reference").toContain("teeth-rest-clearance.ts");
    expect(src, "TEETH_REST_CLEARANCE line").toContain("TEETH_REST_CLEARANCE");
  });

  it("delta = abs(marginAtCap) + 0.0005, applied only when marginAtCap < 0", () => {
    const src = mat();
    expect(src, "0.5mm safety constant").toMatch(/0\.0005/);
    expect(src, "delta adds the safety to the abs margin").toMatch(
      /abs\(margin\w*\)\s*\+\s*TEETH_REST_CLEARANCE_SAFETY/,
    );
    expect(src, "negative-margin gate").toMatch(/margin\w*\s*<\s*0/);
  });
});
