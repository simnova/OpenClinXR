import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Document, NodeIO } from "@gltf-transform/core";
import { runRoomClinicFinish } from "./run.js";

/**
 * The compose stage must import its --input GLB (defect: args.input was never
 * referenced, so paint/measure/emit ran against Blender's startup Cube).
 *
 * Runs the REAL runner (runRoomClinicFinish -> Blender compose.py) on a
 * fixture GLB with distinctive mesh names and asserts those names survive
 * into the output GLB. Live Blender in this test per dispatch; timeout 5 min.
 */

const FIXTURE_MESHES = ["TestFloor", "TestWall_North", "TestWall_South", "TestWall_East", "TestWall_West"];

async function writeFixtureGlb(outputPath: string): Promise<void> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = new Float32Array([0, 0, 0, 4, 0, 0, 4, 3, 0]);
  for (const name of FIXTURE_MESHES) {
    const accessor = doc.createAccessor().setType("VEC3").setArray(positions).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", accessor);
    const mesh = doc.createMesh(name).addPrimitive(prim);
    doc.createNode(name).setMesh(mesh);
  }
  await new NodeIO().write(outputPath, doc);
}

function glbNodeNames(glbPath: string): string[] {
  const raw = readFileSync(glbPath);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4e4f534a) throw new Error("first GLB chunk is not JSON");
  const json = JSON.parse(raw.subarray(20, 20 + chunkLength).toString("utf8")) as {
    nodes?: Array<{ name?: string }>;
  };
  return (json.nodes ?? []).map((node) => node.name ?? "");
}

describe("the room clinic finish compose stage imports its input GLB", () => {
  it("fixture input meshes survive the real runner into the output GLB", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "clinic-finish-input-"));
    const fixture = path.join(work, "fixture.glb");
    const workGlb = path.join(work, "work.glb");
    const recipeJsonOut = path.join(work, "recipe.json");
    const report = path.join(work, "report.json");
    await writeFixtureGlb(fixture);
    copyFileSync(fixture, workGlb);
    const result = await runRoomClinicFinish(
      { environmentId: "ed_exam_bay_v1", preset: "clinic_day", seed: 7 },
      { blender: "blender", workGlb, recipeJsonOut, report, timeoutMs: 300_000 },
    );
    expect(result["blenderExit"]).toBe(0);
    const names = glbNodeNames(workGlb);
    for (const mesh of FIXTURE_MESHES) {
      expect(names).toContain(mesh);
    }
    expect(names).not.toContain("Cube");
  }, 300_000);
});
