import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: viewCount on the frozen 973,639 raw is missing, so G1 is eligible.
 * Codex six-row next is G1 — PACK_A 4-view factory:trellis:bake, seed 237802,
 * remesh off, no 300k export cut, then direct ~80k meshopt. This RED fails until
 * a TRACKED report and a 1280² EEVEE still of that 80k rung exist, same frozen
 * camera as C0/C1/M1. Lane C: a negative grade still closes.
 *
 * IMMUTABLE diagnosis. Flip it.fails → it and append ## FIXED. Do not rewrite
 * PACK_A hashes or the frozen C0 raw SHA.
 *
 * PACK_A freeze: tools/openclinxr/asset-pipeline/trellis/ecg-cart-g1-pack-a-freeze.json
 * Control freeze: tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json
 * Camera freeze: tools/openclinxr/asset-pipeline/trellis/ecg-cart-camera-freeze.json
 * Plan: docs/openclinxr/ecg-cart-4view-optimize-cagematch-plan-2026-08-31.md §12 G1
 *
 * known-good column: C0 still 1,355,200 B at 1280². min-bytes floor 100000 is below that.
 *
 * Counterweight: stills 1280×1280 PNG, not byte-identical to C0; report viewCount === 4;
 * remesh false; seed 237802; triangleCount ≤ 80_000; rawTriangles ≠ 974864; PACK_A SHAs
 * echoed. exists+min-bytes alone would pass a grey rectangle or the midband bake.
 *
 * claimScope: whether G1 4-view + 80k vs C0 was rendered and recorded on the tree.
 * notEvidenceFor: Quest, hatch remesh, Blender high-to-low, that G1 must win, M1 re-score.
 */

const REPO = join(import.meta.dirname, "../../..");
const CONTROL = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json");
const PACK = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-g1-pack-a-freeze.json");
const CAMERA = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-camera-freeze.json");
const REPORT = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-g1-report.json");
const STILL_C0 = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c1-c0-renders/c0-champion.png");
const STILL_G1 = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-g1-renders/g1-direct80k.png");
const VERDICTS = ["beats_control", "loses_to_control", "indistinguishable", "inconclusive_blocked", "other"] as const;
const MIDBAND_TRIS = 974864;

type Freeze = {
  stagingDir: string;
  raw: { file: string; sha256: string; triangles: number };
  c0: { file: string; sha256: string; triangles: number };
};

type PackFreeze = {
  schemaVersion?: string;
  seed?: number;
  remesh?: boolean;
  decimationTarget?: number;
  viewCount?: number;
  views?: Record<string, string>;
  packRoot?: string;
  controlRawSha256?: string;
};

function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("the ECG cart G1 4-view bake has been graded", () => {
  it.fails("(1) tracked G1 vs C0 report and 1280 EEVEE still exist with PACK_A + freeze SHAs", () => {
    const freeze = JSON.parse(readFileSync(CONTROL, "utf8")) as Freeze;
    const staging = join(REPO, freeze.stagingDir);
    for (const row of [freeze.raw, freeze.c0]) {
      const glb = join(staging, row.file);
      expect(existsSync(glb), `control GLB missing (gitignored staging): ${glb}`).toBe(true);
      expect(sha256File(glb), row.file).toBe(row.sha256);
    }

    const pack = JSON.parse(readFileSync(PACK, "utf8")) as PackFreeze;
    expect(pack.schemaVersion).toBe("openclinxr.ecg-cart-g1-pack-a.v1");
    expect(pack.seed).toBe(237802);
    expect(pack.remesh).toBe(false);
    expect(pack.decimationTarget).toBe(16_777_216);
    expect(pack.viewCount).toBe(4);
    expect(pack.controlRawSha256).toBe(freeze.raw.sha256);
    const packRoot = join(REPO, pack.packRoot ?? "");
    for (const [name, sha] of Object.entries(pack.views ?? {})) {
      const png = join(packRoot, "ecg-cart", name);
      expect(existsSync(png), `PACK_A missing: ${png}`).toBe(true);
      expect(sha256File(png), name).toBe(sha);
    }

    const cam = JSON.parse(readFileSync(CAMERA, "utf8")) as { elevDeg: number; azimDeg: number; radius: number };
    expect(cam.elevDeg).toBe(14);
    expect(cam.azimDeg).toBe(40);
    expect(Number(cam.radius)).toBeGreaterThan(0);

    expect(existsSync(REPORT), `${REPORT} is the tracked land path`).toBe(true);
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      schemaVersion?: string;
      controlSha256?: { raw?: string; c0?: string; g1?: string };
      packSha256?: Record<string, string>;
      cameraFreeze?: { elevDeg?: number; azimDeg?: number };
      viewCount?: number;
      seed?: number;
      remesh?: boolean;
      rawTriangles?: number;
      triangleCount?: number;
      gradedVerdict?: string;
      verdictNote?: string;
    };
    expect(report.schemaVersion).toBe("openclinxr.ecg-cart-g1-4view.v1");
    expect(report.controlSha256?.raw).toBe(freeze.raw.sha256);
    expect(report.controlSha256?.c0).toBe(freeze.c0.sha256);
    expect(report.viewCount).toBe(4);
    expect(report.seed).toBe(237802);
    expect(report.remesh).toBe(false);
    expect(Number(report.rawTriangles)).not.toBe(MIDBAND_TRIS);
    expect(Number(report.triangleCount)).toBeGreaterThan(0);
    expect(Number(report.triangleCount)).toBeLessThanOrEqual(80_000);
    expect(VERDICTS.includes(report.gradedVerdict as (typeof VERDICTS)[number])).toBe(true);
    expect(report.verdictNote?.length ?? 0).toBeGreaterThan(40);
    for (const [name, sha] of Object.entries(pack.views ?? {})) {
      expect(report.packSha256?.[name], name).toBe(sha);
    }

    expect(existsSync(STILL_C0)).toBe(true);
    expect(existsSync(STILL_G1), `${STILL_G1} is the tracked G1 still`).toBe(true);
    const c0 = readFileSync(STILL_C0);
    const g1 = readFileSync(STILL_G1);
    expect(g1.byteLength, "min-bytes floor 100000 is below known-good C0 1355200").toBeGreaterThanOrEqual(100_000);
    expect(pngSize(g1)).toEqual({ width: 1280, height: 1280 });
    expect(pngSize(c0)).toEqual({ width: 1280, height: 1280 });
    expect(sha256File(STILL_G1), "G1 still must not be a copy of C0").not.toBe(sha256File(STILL_C0));
  });
});

// NOT TESTED: hatch remesh; Blender --bake; M1 re-score; Quest.
