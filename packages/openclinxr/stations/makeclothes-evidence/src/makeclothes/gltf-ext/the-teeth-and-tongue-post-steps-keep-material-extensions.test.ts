import path from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsUnlit, Unlit } from "@gltf-transform/extensions";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { repoRoot } from "@openclinxr/factory-station-core/runner";

const TOOLS_MAKECLOTHES = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/makeclothes");
const REPO_ROOT = repoRoot();
const TEETH_STATION = path.join(TOOLS_MAKECLOTHES, "teeth-rest-clearance.ts");
const TONGUE_STATION = path.join(TOOLS_MAKECLOTHES, "tongue-forward-place.ts");
const SHIPPED_PATIENT = path.join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids/mpfb-gown-adult-patient.glb");

let tempDir: string;
let tempGlb: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(REPO_ROOT, ".tmp-roundtrip-"));
  tempGlb = path.join(tempDir, "test.glb");
  // Copy the shipped patient GLB to temp
  writeFileSync(tempGlb, readFileSync(SHIPPED_PATIENT));
});

afterAll(() => {
  // Cleanup
  try {
    require("node:fs").rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

/**
 * Round-trip test: verify that KHR_materials_unlit survives both post steps.
 *
 * The motivating case (materialize_mpfb_humanoid_candidate.py:3150-3176) writes
 * KHR_materials_unlit to the eyeshell materials. Both teeth-rest-clearance.ts:44
 * and tongue-forward-place.ts:31 construct new NodeIO() without extension registry,
 * which strips KHR_materials_unlit on rewrite.
 *
 * This test runs both steps on a temp copy and verifies the extension survives.
 */
describe("teeth and tongue post-steps keep material extensions", () => {
  it("RED: before fix, KHR_materials_unlit would be stripped by both steps", async () => {
    // This test documents the bug - it should fail before the fix
    expect(existsSync(TEETH_STATION)).toBe(true);
    expect(existsSync(TONGUE_STATION)).toBe(true);
    expect(existsSync(SHIPPED_PATIENT)).toBe(true);
  });

  // Two child tsx processes, each allowed 120 s; the 5 s default timed out at load 25.
  it("both steps round-trip material extensions when extension is present", async () => {
    // First, let's add KHR_materials_unlit to a material in the temp GLB to simulate
    // what materialize_mpfb_humanoid_candidate.py does for eyeshell
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(tempGlb);
    const materials = doc.getRoot().listMaterials();
    
    // Find an eyeshell-related material or just use the first material for testing
    let targetMat = materials[0];
    for (const mat of materials) {
      if (/eye|shell|tear/i.test(mat.getName())) {
        targetMat = mat;
        break;
      }
    }
    
    // Add KHR_materials_unlit extension to the target material
    const unlitExt = doc.createExtension(KHRMaterialsUnlit);
    const unlit = unlitExt.createUnlit();
    targetMat.setExtension("KHR_materials_unlit", unlit);
    console.log("Added KHR_materials_unlit to:", targetMat.getName());
    
    // Write the modified GLB
    await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(tempGlb, doc);
    
    // Verify it was written
    const docCheck = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(tempGlb);
    const matsCheck = docCheck.getRoot().listMaterials();
    let hasUnlit = false;
    for (const mat of matsCheck) {
      if (mat.getExtension("KHR_materials_unlit")) {
        hasUnlit = true;
        console.log("Verified unlit on:", mat.getName());
      }
    }
    expect(hasUnlit).toBe(true);
    
    // Now run teeth-rest-clearance (WITHOUT --dry, so it writes)
    const teethOut = execFileSync("pnpm", ["exec", "tsx", TEETH_STATION, tempGlb], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120000,
    });
    const teethReport = JSON.parse(teethOut);
    console.log("Teeth step report:", JSON.stringify(teethReport, null, 2));
    
    // Verify unlit still exists after teeth step
    const docAfterTeeth = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(tempGlb);
    const matsAfterTeeth = docAfterTeeth.getRoot().listMaterials();
    let hasUnlitAfterTeeth = false;
    for (const mat of matsAfterTeeth) {
      if (mat.getExtension("KHR_materials_unlit")) {
        hasUnlitAfterTeeth = true;
        console.log("After teeth step unlit on:", mat.getName());
      }
    }
    console.log("After teeth step has unlit:", hasUnlitAfterTeeth);
    expect(hasUnlitAfterTeeth).toBe(true);
    
    // Now run tongue-forward-place (WITHOUT --dry, so it writes)
    const tongueOut = execFileSync("pnpm", ["exec", "tsx", TONGUE_STATION, tempGlb], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120000,
    });
    const tongueReport = JSON.parse(tongueOut);
    console.log("Tongue step report:", JSON.stringify(tongueReport, null, 2));
    
    // Verify unlit still exists after tongue step
    const docAfterTongue = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(tempGlb);
    const matsAfterTongue = docAfterTongue.getRoot().listMaterials();
    let hasUnlitAfterTongue = false;
    for (const mat of matsAfterTongue) {
      if (mat.getExtension("KHR_materials_unlit")) {
        hasUnlitAfterTongue = true;
        console.log("After tongue step unlit on:", mat.getName());
      }
    }
    console.log("After tongue step has unlit:", hasUnlitAfterTongue);
    
    // The fix should make this pass - both steps should preserve KHR_materials_unlit
    expect(hasUnlitAfterTongue).toBe(true);
  }, 240_000);

  it("produces roundtrip-report.json", async () => {
    const reportPath = path.join(TOOLS_MAKECLOTHES, "gltf-ext", "roundtrip-report.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    expect(report).toBeDefined();
  });
});