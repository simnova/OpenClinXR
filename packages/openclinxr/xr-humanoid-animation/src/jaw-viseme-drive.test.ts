/**
 * Jaw bone follows viseme openness so skin-weighted teeth move with the lips.
 *
 * WHY: CEO grade of native 200x180 mouth crops — viseme_sil shows a white teeth line
 * between closed lips, viseme_PP is unsealed with upper teeth in the gap, viseme_aa
 * leaves a static upper-teeth row. Measured: fitted teeth carry no morphs (~50% verts
 * on `jaw`, ~50% on `head`), viseme morphs live only on the body, jaw never rotates.
 * Drives the PUBLIC entrypoint export on a jaw-bone fixture: 0 restores rest, 1 opens,
 * re-applying 0 restores instead of accumulating.
 *
 * claimScope: jaw bone rotation tracks openness; rest restores at 0.
 * notEvidenceFor: pixel grades of a new capture, or anatomical jaw correctness.
 */
import { Group, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { applyJawVisemeToRoot } from "./index.js";

function jawFixture() {
  const root = new Group();
  const jaw = new Object3D();
  jaw.name = "jaw";
  root.add(jaw);
  return { root, jaw };
}

describe("jaw viseme drive", () => {
  it("openness 0 keeps rest, 1 opens to -0.28, 0 restores without accumulating", () => {
    const { root, jaw } = jawFixture();
    applyJawVisemeToRoot(root, 0);
    expect(jaw.rotation.x).toBeCloseTo(0, 5);
    applyJawVisemeToRoot(root, 1);
    expect(jaw.rotation.x).toBeCloseTo(-0.28, 5);
    applyJawVisemeToRoot(root, 0);
    expect(jaw.rotation.x).toBeCloseTo(0, 5);
    applyJawVisemeToRoot(root, 1);
    expect(jaw.rotation.x).toBeCloseTo(-0.28, 5);
  });

  it("no-ops without a jaw bone", () => {
    expect(() => applyJawVisemeToRoot(new Group(), 1)).not.toThrow();
  });
});
