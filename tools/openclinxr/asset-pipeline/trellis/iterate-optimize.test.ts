/**
 * iterate-optimize.test.ts — the R2 face-preserving keep flag.
 *
 * Fixture: a two-mesh GLB (one keep-matching, one not). Asserts the keep
 * mesh's triangle count is unchanged while the other mesh is reduced.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, type Buffer as GltfBuffer, Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptSimplifier } from "meshoptimizer";
import { describe, expect, it } from "vitest";
import { parseIterateOptimizeArgv, writeFacePreservingRung } from "./iterate-optimize.js";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "iterate-optimize.ts");

/** Run the tool CLI; returns exit status + stderr (never throws). */
function runCli(args: string[]): { status: number; stderr: string } {
  try {
    execFileSync("pnpm", ["exec", "tsx", TOOL, ...args], { stdio: "pipe", encoding: "utf8" });
    return { status: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: unknown };
    return { status: err.status ?? 1, stderr: String(err.stderr ?? "") };
  }
}

const KEEP_MESH = "keep_me_garment_mesh";
const SHRINK_MESH = "shrink_me_garment_mesh";

/** One subdivided flat grid primitive (n x n quads) under its own mesh name. */
function addGridMesh(doc: Document, buffer: GltfBuffer, name: string, n: number): void {
  const positions: number[] = [];
  for (let y = 0; y <= n; y += 1) {
    for (let x = 0; x <= n; x += 1) {
      positions.push(x / n, y / n, 0);
    }
  }
  const indices: number[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const a = y * (n + 1) + x;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer);
  const idx = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(indices)).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  doc.createNode(`${name}-node`).setMesh(mesh);
}

async function twoMeshFixture(): Promise<string> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = new Document();
  const buffer = doc.createBuffer();
  addGridMesh(doc, buffer, KEEP_MESH, 10);
  addGridMesh(doc, buffer, SHRINK_MESH, 10);
  doc.createScene("s").addChild(doc.getRoot().listNodes()[0]!).addChild(doc.getRoot().listNodes()[1]!);
  const path = join(mkdtempSync(join(tmpdir(), "fp-keep-")), "two-mesh.glb");
  await io.write(path, doc);
  return path;
}

async function meshTris(glbPath: string): Promise<Map<string, number>> {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(glbPath);
  const out = new Map<string, number>();
  for (const mesh of doc.getRoot().listMeshes()) {
    let tris = 0;
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) tris += idx.getCount() / 3;
    }
    out.set(mesh.getName(), Math.round(tris));
  }
  return out;
}

describe("writeFacePreservingRung --face-preserving-keep", () => {
  it("skips a matching mesh while reducing the other", async () => {
    await MeshoptSimplifier.ready;
    const input = await twoMeshFixture();
    const before = await meshTris(input);
    expect(before.get(KEEP_MESH)).toBe(200);
    expect(before.get(SHRINK_MESH)).toBe(200);

    const dir = mkdtempSync(join(tmpdir(), "fp-keep-"));
    const keptPath = join(dir, "kept.glb");
    await writeFacePreservingRung(input, keptPath, 0.3, [/keep_me/]);
    const kept = await meshTris(keptPath);
    expect(kept.get(KEEP_MESH)).toBe(200);
    expect(kept.get(SHRINK_MESH)).toBeLessThan(200);

    const plainPath = join(dir, "plain.glb");
    await writeFacePreservingRung(input, plainPath, 0.3);
    const plain = await meshTris(plainPath);
    expect(plain.get(KEEP_MESH)).toBeLessThan(200);
    expect(plain.get(KEEP_MESH)).toBe(kept.get(SHRINK_MESH));
  });
});

describe("face-preserving report keep fields (F1: backward-compatible shape)", () => {
  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("omits keep at rung and top level when no --face-preserving-keep is given", { timeout: 20_000 }, async () => {
    const input = await twoMeshFixture();
    const dir = mkdtempSync(join(tmpdir(), "fp-nokeep-"));
    execFileSync("pnpm", ["exec", "tsx", TOOL, "--input", input, "--out", dir, "--face-preserving", "--face-preserving-ratio", "0.3"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    const report = JSON.parse(readFileSync(join(dir, "face-preserving-rungs.json"), "utf8"));
    // Pre-change (origin/main) field set: no keep key anywhere.
    expect(Object.keys(report).sort()).toEqual(["error", "input", "mode", "rungs"]);
    expect(report.keep).toBeUndefined();
    expect(report.rungs).toHaveLength(1);
    for (const rung of report.rungs) {
      expect(rung.keep).toBeUndefined();
      expect(Object.keys(rung).sort()).toEqual([
        "bytes",
        "error",
        "faceTriangles",
        "label",
        "path",
        "ratio",
        "triangleCount",
      ]);
    }
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("emits keep at rung and top level when --face-preserving-keep is given", { timeout: 20_000 }, async () => {
    const input = await twoMeshFixture();
    const dir = mkdtempSync(join(tmpdir(), "fp-keepcli-"));
    execFileSync(
      "pnpm",
      ["exec", "tsx", TOOL, "--input", input, "--out", dir, "--face-preserving", "--face-preserving-ratio", "0.3", "--face-preserving-keep", "keep_me"],
      { stdio: "pipe", encoding: "utf8" },
    );
    const report = JSON.parse(readFileSync(join(dir, "face-preserving-rungs.json"), "utf8"));
    expect(report.keep).toEqual(["keep_me"]);
    expect(report.rungs).toHaveLength(1);
    for (const rung of report.rungs) {
      expect(rung.keep).toEqual(["keep_me"]);
    }
  });
});

describe("--face-preserving-keep argv validation (F4)", () => {
  const dummyIn = join(tmpdir(), "fp-dummy-in.glb");
  const dummyOut = join(tmpdir(), "fp-dummy-out");

  it("rejects --face-preserving-keep at end of argv", () => {
    expect(() =>
      parseIterateOptimizeArgv(["--input", dummyIn, "--out", dummyOut, "--face-preserving", "--face-preserving-keep"]),
    ).toThrow(/--face-preserving-keep/);
  });

  it("rejects --face-preserving-keep followed by another flag without consuming it", () => {
    expect(() =>
      parseIterateOptimizeArgv(["--input", dummyIn, "--out", dummyOut, "--face-preserving", "--face-preserving-keep", "--face-preserving-ratio", "0.3"]),
    ).toThrow(/--face-preserving-keep/);
  });

  it("rejects an empty --face-preserving-keep value", () => {
    expect(() =>
      parseIterateOptimizeArgv(["--input", dummyIn, "--out", dummyOut, "--face-preserving", "--face-preserving-keep", ""]),
    ).toThrow(/--face-preserving-keep/);
  });

  // CI 44195741094 measured 5.7 s max; x3 ≈ 20 s
  it("CLI exits 2 with --face-preserving-keep on stderr for a trailing keep flag", { timeout: 20_000 }, () => {
    const r = runCli(["--input", dummyIn, "--out", dummyOut, "--face-preserving", "--face-preserving-keep"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--face-preserving-keep/);
  });
});
