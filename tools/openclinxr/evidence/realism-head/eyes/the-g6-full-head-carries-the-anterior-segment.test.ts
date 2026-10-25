import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

const STORE_ROOT = "/Volumes/files/openclinxr-assets/store";
function storePath(src: string): string {
  const rel = src.startsWith("assets:") ? src.slice("assets:".length) : src;
  return join(STORE_ROOT, rel);
}

const manifestPath = join(here, "geometric-eye-g6-manifest.json");
const manifest = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : null;
const HEAD_ABS = manifest ? storePath(manifest.head.file) : "";
const HAVE_HEAD = HEAD_ABS !== "" && existsSync(HEAD_ABS);

describe("the G6 full head carries the geometric anterior segment in-human", () => {
  it("manifest exists with head bake, report, renders, and a green gate", () => {
    expect(manifest).not.toBeNull();
    expect(manifest.head.file).toMatch(/\.glb$/);
    expect(manifest.report.file).toMatch(/\.json$/);
    expect(Object.keys(manifest.renders)).toHaveLength(12);
    expect(manifest.gate).toMatch(/GREEN/);
  });

  if (HAVE_HEAD) {
    it("shipped bytes match the manifest shas", () => {
      expect(sha256File(HEAD_ABS)).toBe(manifest.head.sha256);
      expect(sha256File(join(here, manifest.report.file))).toBe(
        manifest.report.sha256,
      );
      for (const k of Object.keys(manifest.renders)) {
        expect(sha256File(join(here, manifest.renders[k].file))).toBe(
          manifest.renders[k].sha256,
        );
      }
    });
  } else {
    it.skip("store head GLB absent — head sha unverified", () => {});
    it("shipped report + render bytes match the manifest shas", () => {
      expect(sha256File(join(here, manifest.report.file))).toBe(
        manifest.report.sha256,
      );
      for (const k of Object.keys(manifest.renders)) {
        expect(sha256File(join(here, manifest.renders[k].file))).toBe(
          manifest.renders[k].sha256,
        );
      }
    });
  }

  it("blink-follow holds on both sides with lashes shown", () => {
    expect(manifest.blinkFollowPass).toBe(true);
    for (const s of ["L", "R"]) {
      const row = manifest.blinkFollow[s];
      expect(row.lidMarginVerts).toBeGreaterThan(0);
      expect(row.sameDirection).toBe(true);
      expect(row.travelPct).toBeGreaterThanOrEqual(80);
    }
  });

  it("catchlight dot present and round on both eyes in-human (three.js)", () => {
    for (const s of ["imgL", "imgR"]) {
      const row = manifest.grade.threejs[s];
      expect(row.hotCluster).toBeGreaterThanOrEqual(10);
      expect(row.hotRound).toBeLessThanOrEqual(1.5);
      expect(row.meansat).toBeGreaterThanOrEqual(0.3);
      expect(row.meansat).toBeLessThanOrEqual(0.6);
    }
  });

  it("closure shows no bright show-through in the eye band (seal)", () => {
    expect(manifest.grade.seal["threejs-closure"].bright230).toBe(0);
    expect(manifest.grade.seal["threejs-closure"].regionPx).toBe(
      manifest.grade.seal["threejs-bind"].regionPx,
    );
  });
});
