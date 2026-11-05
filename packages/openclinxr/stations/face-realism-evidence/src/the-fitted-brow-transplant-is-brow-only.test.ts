import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../../../..");
const TOOL = join(
  ROOT,
  "tools/openclinxr/asset-pipeline/makeclothes/transplant_fitted_brow.py",
);

type FixturePrimitive = {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
};
type FixtureDocument = {
  accessors: Array<{ bufferView: number }>;
  bufferViews: Array<{ byteLength: number; byteOffset: number }>;
  meshes: Array<{ name: string; primitives: FixturePrimitive[] }>;
  nodes: Array<{ name: string }>;
};
type Glb = { document: FixtureDocument; binary: Buffer };

function encodeGlb(document: object, binary: Buffer): Buffer {
  const jsonSource = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([jsonSource, Buffer.alloc((4 - (jsonSource.length % 4)) % 4, 0x20)]);
  const bin = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
  const output = Buffer.alloc(12 + 8 + json.length + 8 + bin.length);
  output.write("glTF", 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(json.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  json.copy(output, 20);
  const binHeader = 20 + json.length;
  output.writeUInt32LE(bin.length, binHeader);
  output.writeUInt32LE(0x004e4942, binHeader + 4);
  bin.copy(output, binHeader + 8);
  return output;
}

function parseGlb(path: string): Glb {
  const raw = readFileSync(path);
  const jsonLength = raw.readUInt32LE(12);
  const document = JSON.parse(
    raw.subarray(20, 20 + jsonLength).toString("utf8"),
  ) as FixtureDocument;
  const binHeader = 20 + jsonLength;
  const binLength = raw.readUInt32LE(binHeader);
  return { document, binary: raw.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function fixture(jointOrder: number[], browName: string, jointPattern: number[]): Buffer {
  const chunks: Buffer[] = [];
  const bufferViews: Record<string, number>[] = [];
  const add = (payload: Buffer, target?: number) => {
    const padding = (4 - (chunks.reduce((sum, chunk) => sum + chunk.length, 0) % 4)) % 4;
    if (padding) chunks.push(Buffer.alloc(padding));
    const byteOffset = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    chunks.push(payload);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: payload.length, ...(target ? { target } : {}) });
    return bufferViews.length - 1;
  };
  const floats = (values: number[]) => {
    const buffer = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => {
      buffer.writeFloatLE(value, index * 4);
    });
    return buffer;
  };
  const indices = add(Buffer.from(new Uint16Array([0, 1, 2]).buffer), 34963);
  const position = add(floats([0, 0, 0, 1, 0, 0, 0, 1, 0]), 34962);
  const normal = add(floats([0, 0, 1, 0, 0, 1, 0, 0, 1]), 34962);
  const uv = add(floats([0, 0, 1, 0, 0, 1]), 34962);
  const joints = add(Buffer.from(jointPattern), 34962);
  const weights = add(floats([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 34962);
  const body = add(floats([7, 8, 9]), 34962);
  const accessors = [
    { bufferView: body, componentType: 5126, count: 1, type: "VEC3" },
    { bufferView: indices, componentType: 5123, count: 3, type: "SCALAR" },
    { bufferView: position, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: normal, componentType: 5126, count: 3, type: "VEC3" },
    { bufferView: uv, componentType: 5126, count: 3, type: "VEC2" },
    { bufferView: joints, componentType: 5121, count: 3, type: "VEC4" },
    { bufferView: weights, componentType: 5126, count: 3, type: "VEC4" },
  ];
  const binary = Buffer.concat(chunks);
  return encodeGlb(
    {
      asset: { version: "2.0" },
      buffers: [{ byteLength: binary.length }],
      bufferViews,
      accessors,
      materials: [{ name: "donor" }, { name: "shipped" }],
      meshes: [
        {
          name: "fixture_body",
          extras: { targetNames: ["eyebrows-left-up"] },
          primitives: [{ attributes: { POSITION: 0 } }],
        },
        {
          name: browName,
          primitives: [
            {
              material: browName.includes("shipped") ? 1 : 0,
              indices: 1,
              attributes: {
                POSITION: 2,
                NORMAL: 3,
                TEXCOORD_0: 4,
                JOINTS_0: 5,
                WEIGHTS_0: 6,
              },
            },
          ],
        },
      ],
      nodes: [{ name: "Hip" }, { name: "Head" }, { name: "brow", mesh: 1, skin: 0 }],
      skins: [{ joints: jointOrder }],
      scenes: [{ nodes: [0, 1, 2] }],
      scene: 0,
    },
    binary,
  );
}

function runTool(directory: string, input: string, bake: string, output: string) {
  return JSON.parse(
    execFileSync(
      "mise",
      [
        "exec",
        "--",
        "python3",
        TOOL,
        "--input",
        input,
        "--bake",
        bake,
        "--output",
        output,
        "--provenance",
        join(directory, "source.provenance.json"),
        "--output-provenance",
        join(directory, "output.provenance.json"),
        "--style",
        "mindfront_eyebrows_fixture",
        "--budget",
        "3",
        "--cells",
        "2",
        "--ink",
        "0.25",
      ],
      { cwd: ROOT, encoding: "utf8" },
    ),
  );
}

describe("fitted brow transplant", () => {
  it("pins the spouse to style 07 at 9400 and keeps every counterweight at 9000", () => {
    const source = readFileSync(
      join(ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py"),
      "utf8",
    );
    const table = source.match(
      /EYEBROW_STYLE_AND_BUDGET_BY_REFERENCE = \{([\s\S]*?)\n\}/,
    )?.[1];
    expect(table).toBeDefined();
    const rows = [...table!.matchAll(
      /^\s*(None|"[^"]+"):\s*\("([^"]+)",\s*(DEFAULT_EYEBROW_BUDGET_TRIS|\d+)\),$/gm,
    )].map((match) => ({
      actor: match[1] === "None" ? "default" : JSON.parse(match[1]!),
      style: match[2],
      budget: match[3] === "DEFAULT_EYEBROW_BUDGET_TRIS" ? 9000 : Number(match[3]),
    }));
    expect(rows).toEqual([
      { actor: "default", style: "mindfront_eyebrows_05", budget: 9000 },
      { actor: "peds_nurse_kevin", style: "mindfront_eyebrows_08", budget: 9000 },
      { actor: "peds_patient_child", style: "mindfront_eyebrows_03", budget: 9000 },
      { actor: "ed_chest_pain_nurse_adult", style: "mindfront_eyebrows_06", budget: 9000 },
      { actor: "ed_chest_pain_spouse_adult", style: "mindfront_eyebrows_07", budget: 9400 },
      { actor: "adult_male_street_casual", style: "mindfront_eyebrows_08", budget: 9000 },
    ]);
    expect(source).toContain(
      "args.reference, EYEBROW_STYLE_AND_BUDGET_BY_REFERENCE[None]",
    );
  });

  it("changes only brow accessors, remaps joints by name, records provenance, and is idempotent", () => {
    const directory = mkdtempSync(
      join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "brow-transplant-contract-"),
    );
    const shipped = join(directory, "shipped.glb");
    const bake = join(directory, "bake.glb");
    const output = join(directory, "output.glb");
    const second = join(directory, "second.glb");
    writeFileSync(
      shipped,
      fixture([0, 1], "openclinxr_fitted_eyebrow_shipped_mesh", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]),
    );
    writeFileSync(
      bake,
      fixture([1, 0], "openclinxr_fitted_eyebrow_donor_mesh", [0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]),
    );
    writeFileSync(
      join(directory, "source.provenance.json"),
      JSON.stringify({ scenarioId: "fixture", actorId: "actor", assetPath: shipped }),
    );

    const report = runTool(directory, shipped, bake, output);
    const parsed = parseGlb(output);
    const browMesh = parsed.document.meshes[1]!;
    const primitive = browMesh.primitives[0]!;
    const jointsAccessor = parsed.document.accessors[primitive.attributes["JOINTS_0"]!]!;
    const jointsView = parsed.document.bufferViews[jointsAccessor.bufferView]!;
    const jointBytes = parsed.binary.subarray(
      jointsView.byteOffset,
      jointsView.byteOffset + jointsView.byteLength,
    );
    expect([...jointBytes]).toEqual([1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1]);
    expect(primitive.material).toBe(1);
    expect(browMesh.name).toContain("donor");
    expect(report.stage.contract.nonBrowBufferViewsIdentical).toBe(1);
    expect(report.stage.contract.droppedBrowOnlyBufferViews).toEqual([0, 1, 2, 3, 4, 5]);
    expect(report.stage.contract.sourceBrowMesh).toBe(
      "openclinxr_fitted_eyebrow_shipped_mesh",
    );

    const provenance = JSON.parse(readFileSync(join(directory, "output.provenance.json"), "utf8"));
    expect(provenance.assetPath).toBe(shipped);
    expect(provenance.actorBrowTransplantPostExport).toMatchObject({
      stage: "actor_brow_transplant_post_export_v1",
      style: "mindfront_eyebrows_fixture",
      budget: 3,
      cells: 2,
      ink: 0.25,
      causeCommit: "0f1d0b9c6",
    });

    runTool(directory, output, bake, second);
    expect(readFileSync(second)).toEqual(readFileSync(output));
  });

  it("refuses a bake joint name absent from the shipped skin", () => {
    const directory = mkdtempSync(
      join(process.env["OPENCLINXR_JOB_TMP"] ?? tmpdir(), "brow-transplant-refusal-"),
    );
    const shipped = join(directory, "shipped.glb");
    const bake = join(directory, "bake.glb");
    const output = join(directory, "output.glb");
    writeFileSync(shipped, fixture([0, 1], "openclinxr_fitted_eyebrow_shipped_mesh", Array(12).fill(0)));
    const badBake = parseGlbFromBuffer(
      fixture([1, 0], "openclinxr_fitted_eyebrow_donor_mesh", Array(12).fill(0)),
    );
    badBake.document.nodes[1]!.name = "MissingJoint";
    writeFileSync(bake, encodeGlb(badBake.document, badBake.binary));
    writeFileSync(
      join(directory, "source.provenance.json"),
      JSON.stringify({ scenarioId: "fixture", actorId: "actor" }),
    );
    const result = spawnSync(
      "mise",
      [
        "exec",
        "--",
        "python3",
        TOOL,
        "--input",
        shipped,
        "--bake",
        bake,
        "--output",
        output,
        "--style",
        "fixture",
        "--budget",
        "3",
        "--cells",
        "2",
        "--ink",
        "0.25",
        "--no-provenance",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("bake skin joint names missing from shipped skin");
  });
});

function parseGlbFromBuffer(raw: Buffer): Glb {
  const jsonLength = raw.readUInt32LE(12);
  const document = JSON.parse(
    raw.subarray(20, 20 + jsonLength).toString("utf8"),
  ) as FixtureDocument;
  const binHeader = 20 + jsonLength;
  const binLength = raw.readUInt32LE(binHeader);
  return { document, binary: raw.subarray(binHeader + 8, binHeader + 8 + binLength) };
}
