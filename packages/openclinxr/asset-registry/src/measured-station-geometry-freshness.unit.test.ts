import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freshMeasuredTriangleCounts } from "./measured-station-geometry-freshness.js";

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function setup(files: Record<string, string>): { repoRoot: string; fps: Record<string, { bytes: number; sha256: string }> } {
  root = mkdtempSync(join(tmpdir(), "freshness-real-"));
  const fps: Record<string, { bytes: number; sha256: string }> = {};
  try {
    for (const [name, text] of Object.entries(files)) {
      const abs = join(root, name);
      mkdirSync(join(root), { recursive: true });
      writeFileSync(abs, Buffer.from(text, "utf8"));
      const bytes = Buffer.from(text, "utf8");
      fps[name] = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
  } catch (e) {
    rmSync(root, { recursive: true, force: true });
    root = "";
    throw e;
  }
  return { repoRoot: root, fps };
}

describe("measured-station-geometry freshness (real files)", () => {
  it("fresh file returns its count", () => {
    const { repoRoot, fps } = setup({ "a.glb": "AAAAAAAAA" });
    try {
      const doc = { sources: { a: "a.glb" }, triangles: { a: 9 }, fingerprints: { a: fps["a.glb"] } };
      expect(freshMeasuredTriangleCounts(doc, repoRoot)).toEqual({ a: 9 });
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      root = "";
    }
  });

  it("triangle count with no sources entry is dropped", () => {
    const { repoRoot } = setup({ "a.glb": "AAAAAAAAA" });
    try {
      const doc = { sources: {}, triangles: { ghost: 9 }, fingerprints: {} };
      expect(freshMeasuredTriangleCounts(doc, repoRoot)).toEqual({});
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      root = "";
    }
  });

  it("wrong sha drops the count", () => {
    const { repoRoot, fps } = setup({ "a.glb": "AAAAAAAAA" });
    try {
      const fp = fps["a.glb"];
      if (!fp) throw new Error("missing fixture fingerprint a.glb");
      const bad = { bytes: fp.bytes, sha256: "0".repeat(64) };
      const doc = { sources: { a: "a.glb" }, triangles: { a: 9 }, fingerprints: { a: bad } };
      expect(freshMeasuredTriangleCounts(doc, repoRoot)).toEqual({});
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      root = "";
    }
  });

  it("missing fingerprint drops the count", () => {
    const { repoRoot } = setup({ "a.glb": "AAAAAAAAA" });
    try {
      const doc = { sources: { a: "a.glb" }, triangles: { a: 9 }, fingerprints: {} };
      expect(freshMeasuredTriangleCounts(doc, repoRoot)).toEqual({});
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      root = "";
    }
  });

  it("missing file drops the count", () => {
    const { repoRoot, fps } = setup({ "a.glb": "AAAAAAAAA" });
    try {
      const doc = { sources: { a: "gone.glb" }, triangles: { a: 9 }, fingerprints: { a: fps["a.glb"] } };
      expect(freshMeasuredTriangleCounts(doc, repoRoot)).toEqual({});
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      root = "";
    }
  });

  it("NaN and Infinity counts are dropped", () => {
    const { repoRoot, fps } = setup({ "a.glb": "AAAAAAAAA", "b.glb": "BBBBBBBBB" });
    try {
      const doc = {
        sources: { a: "a.glb", b: "b.glb" },
        triangles: { a: NaN, b: Infinity },
        fingerprints: { a: fps["a.glb"], b: fps["b.glb"] },
      };
      expect(freshMeasuredTriangleCounts(doc, repoRoot)).toEqual({});
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      root = "";
    }
  });

  it("inherited sources entry never fingerprints and yields no fresh count", () => {
    const { repoRoot, fps } = setup({ "a.glb": "AAAAAAAAA" });
    try {
      const sources = Object.create({ a: "a.glb" });
      const doc = { sources, triangles: { a: 9 }, fingerprints: { a: fps["a.glb"] } };
      expect(freshMeasuredTriangleCounts(doc, repoRoot)).toEqual({});
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
      root = "";
    }
  });
});
