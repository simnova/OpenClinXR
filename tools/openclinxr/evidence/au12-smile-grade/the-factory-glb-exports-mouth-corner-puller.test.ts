import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../../..");

/**
 * The six factory GLBs that ship with AU12 mouth-corner-puller (measured at origin cd93026bf).
 * These are NOT rebaked by this test — the test asserts the morph exists on the current shipped bytes.
 */
const SHIPPED_FACTORY_GLBS = [
  "apps/ui-xr/public/xr-assets/humanoids/candidates/body-param-adult_lean_female-library.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-parent-aisha.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-clinical-nurse-adult.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-peds-nurse-kevin.glb",
  "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb",
  "apps/ui-xr/public/xr-assets/humanoids/candidates/mpfb-peds-parent-aisha.motion-bind.glb",
];

function hasMouthCornerPuller(doc: Awaited<ReturnType<NodeIO["read"]>>): boolean {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const targets = prim.listTargets();
      for (const target of targets) {
        // glTF morph target names are on the primitive; check each
        const name = target.getName?.() ?? "";
        if (name === "mouth-corner-puller") return true;
      }
    }
    // Also check mesh-level morphTargetNames (extras or legacy)
    const meshName = mesh.getName() ?? "";
    // Some exporters put names on mesh.extras.targetNames
    const extras = mesh.getExtras?.() ?? {};
    const targetNames = extras.targetNames;
    if (Array.isArray(targetNames) && targetNames.includes("mouth-corner-puller")) {
      return true;
    }
  }
  return false;
}



describe("factory GLBs export AU12 mouth-corner-puller morph target", () => {
  const io = new NodeIO();

  for (const relPath of SHIPPED_FACTORY_GLBS) {
    const absPath = path.join(REPO_ROOT, relPath);
    it(`has mouth-corner-puller on ${relPath}`, async () => {
      if (!existsSync(absPath)) {
        throw new Error(`Missing shipped GLB: ${absPath}`);
      }
      const doc = await io.read(absPath);
      const found = hasMouthCornerPuller(doc);
      expect(found, `mouth-corner-puller morph target not found on ${relPath}`).toBe(true);
    });
  }

  it("counterweight: a document without mouth-corner-puller fails the assertion", () => {
    const doc = new Document();
    const mesh = doc.createMesh("empty");
    mesh.setExtras({ targetNames: ["mouth-open"] });
    expect(hasMouthCornerPuller(doc)).toBe(false);
  });
});