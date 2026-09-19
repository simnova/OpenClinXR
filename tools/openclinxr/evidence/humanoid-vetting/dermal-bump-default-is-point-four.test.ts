import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Diagnosis: factory default was 1.0; native bump-1.0 collar cobblestone;
 * bump-0.4 collar smooth.
 *
 * Source-assertion only: the DEFAULT bump string must be "0.4" (env
 * override stays). No Blender, no GLB, no rebake pixels.
 *
 * NOT TESTED: the rebake pixels themselves (nurse rebake card owns that).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const MAT = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

function mat(): string {
  expect(existsSync(MAT), `${MAT} — the factory materializer`).toBe(true);
  return readFileSync(MAT, "utf8");
}

describe("dermal bump default is 0.4", () => {
  it("reads DERMAL_BUMP_STRENGTH env with default \"0.4\"", () => {
    const src = mat();
    expect(src, "default string").toMatch(/DERMAL_BUMP_STRENGTH",\s*"0\.4"/);
    expect(src, "old 1.0 default gone").not.toMatch(/DERMAL_BUMP_STRENGTH",\s*"1\.0"/);
  });
});
