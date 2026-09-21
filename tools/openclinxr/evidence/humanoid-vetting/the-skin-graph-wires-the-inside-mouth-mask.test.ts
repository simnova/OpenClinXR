import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The materializer must sample the CC0 MPFB inside-mouth mask in the skin graph.
 *
 * CEO grade 2026-09-19: open aa shows an upper tooth row with a dark-hole
 * lower cavity. MPFB ships mpfb_inside-mouth.jpg (CC0 via LICENSE.ASSETS.md)
 * with a registered but unused wrapper
 * (nodewrappermpfbsystemvaluetextureinsidemouth.py); the v2 skin graph never
 * consumes it. Source-assertion only: the materializer must instantiate the
 * proven wrapper and mix the cavity shade over the router output.
 *
 * No Blender, no GLB, no rebake pixels.
 *
 * NOT TESTED: the shaded pixels themselves (speech capture owns that).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const MAT = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

function mat(): string {
  expect(existsSync(MAT), `${MAT} — the factory materializer`).toBe(true);
  return readFileSync(MAT, "utf8");
}

describe("skin graph wires the inside-mouth mask", () => {
  it("references the CC0 mask texture and the proven wrapper", () => {
    const src = mat();
    expect(src, "mask texture").toContain("mpfb_inside-mouth.jpg");
    expect(src, "proven wrapper").toContain("NodeWrapperMpfbSystemValueTextureInsideMouth");
    expect(src, "wrapper import path").toContain("nodewrappermpfbsystemvaluetextureinsidemouth");
  });

  it("mixes a cavity shade over the router output and prints INNER_MOUTH", () => {
    const src = mat();
    expect(src, "mouth mask instance").toContain("IsInsideMouth");
    expect(src, "cavity mix").toContain("InnerMouthMix");
    expect(src, "unlit emission").toContain("ShaderNodeEmission");
    expect(src, "INNER_MOUTH marker").toContain("INNER_MOUTH");
  });

  it("uses a skeptic-visible gum pink for the cavity shade", () => {
    const src = mat();
    expect(src, "cavity red").toContain("0.72");
    expect(src, "cavity green").toContain("0.28");
    expect(src, "cavity blue").toContain("0.32");
  });

  it("does not weaken the skin bake guards", () => {
    const src = mat();
    expect(src, "F1 dermal guard").toContain("DERMAL_VORONOI_FEATURE");
    expect(src, "throat guard").toContain("ORPHAN_EXTEND_SKIP_THROAT");
    expect(src, "teeth clearance station").toContain("TEETH_REST_CLEARANCE");
  });
});
