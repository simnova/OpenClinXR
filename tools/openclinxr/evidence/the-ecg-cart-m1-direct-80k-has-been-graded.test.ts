import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: C1 59,187 beat C0 34,443 on jack circularity. Codex six-row cut next is M1 —
 * direct ~80k meshopt from the frozen 973,639 raw (plan T1). No GPU TRELLIS. This RED fails
 * until a TRACKED report and a 1280² EEVEE still of that 80k rung exist, same frozen camera
 * as C0/C1. Lane C: a negative grade still closes.
 *
 * IMMUTABLE diagnosis. Flip it.fails → it and append ## FIXED. Do not rewrite these hashes.
 *
 * Control freeze: tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json
 * Camera freeze: tools/openclinxr/asset-pipeline/trellis/ecg-cart-camera-freeze.json
 * Plan: docs/openclinxr/ecg-cart-4view-optimize-cagematch-plan-2026-08-31.md §12 M1
 *
 * known-good column: C0 still 1,355,200 B at 1280². min-bytes floor 100000 is below that.
 *
 * Counterweight: stills 1280×1280 PNG, not byte-identical to C0, report echoes freeze SHAs
 * and triangleCount ≤ 80_000. exists+min-bytes alone would pass a grey rectangle.
 *
 * claimScope: whether M1 vs C0 was rendered and recorded on the tree.
 * notEvidenceFor: Quest, 4-view TRELLIS, hatch remesh, Blender high-to-low, that M1 must win.
 */

const REPO = join(import.meta.dirname, "../../..");
const CONTROL = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json");
const CAMERA = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-camera-freeze.json");
const REPORT = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-m1-80k-report.json");
const STILL_C0 = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c1-c0-renders/c0-champion.png");
const STILL_M1 = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-m1-renders/m1-direct80k.png");
const VERDICTS = ["beats_control", "loses_to_control", "indistinguishable", "inconclusive_blocked", "other"] as const;

type Freeze = {
  stagingDir: string;
  raw: { file: string; sha256: string; triangles: number };
  c0: { file: string; sha256: string; triangles: number };
};

function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("the ECG cart M1 direct 80k has been graded", () => {
  it.fails("(1) tracked M1 vs C0 report and 1280 EEVEE stills exist with frozen SHAs", () => {
    const freeze = JSON.parse(readFileSync(CONTROL, "utf8")) as Freeze;
    const staging = join(REPO, freeze.stagingDir);
    for (const row of [freeze.raw, freeze.c0]) {
      const glb = join(staging, row.file);
      expect(existsSync(glb), `control GLB missing (gitignored staging): ${glb}`).toBe(true);
      expect(sha256File(glb), row.file).toBe(row.sha256);
    }

    const cam = JSON.parse(readFileSync(CAMERA, "utf8")) as { elevDeg: number; azimDeg: number; radius: number };
    expect(cam.elevDeg).toBe(14);
    expect(cam.azimDeg).toBe(40);
    expect(Number(cam.radius)).toBeGreaterThan(0);

    expect(existsSync(REPORT), `${REPORT} is the tracked land path`).toBe(true);
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      schemaVersion?: string;
      controlSha256?: { raw?: string; c0?: string; m1?: string };
      cameraFreeze?: { elevDeg?: number; azimDeg?: number; radius?: number; center?: number[] };
      triangleCount?: number;
      gradedVerdict?: string;
      verdictNote?: string;
      nextTreatmentIfNeeded?: string;
    };
    expect(report.schemaVersion).toBe("openclinxr.ecg-cart-m1-80k.v1");
    expect(report.controlSha256?.raw).toBe(freeze.raw.sha256);
    expect(report.controlSha256?.c0).toBe(freeze.c0.sha256);
    expect(report.controlSha256?.m1, "M1 GLB SHA is the land path for a gitignored mesh").toMatch(/^[0-9a-f]{64}$/u);
    expect(report.cameraFreeze?.elevDeg).toBe(14);
    expect(report.cameraFreeze?.azimDeg).toBe(40);
    expect(report.cameraFreeze?.center).toHaveLength(3);
    expect(Number(report.triangleCount), "M1 must be ≤80k preferred band").toBeLessThanOrEqual(80_000);
    expect(Number(report.triangleCount)).toBeGreaterThan(0);
    expect(VERDICTS, "gradedVerdict").toContain(report.gradedVerdict);
    expect(report.verdictNote?.length ?? 0, "escape values hide in the note").toBeGreaterThan(0);
    expect(report.nextTreatmentIfNeeded?.length ?? 0, "name G1/hatch/bake if likeness still open").toBeGreaterThan(0);

    expect(existsSync(STILL_C0), STILL_C0).toBe(true);
    expect(existsSync(STILL_M1), STILL_M1).toBe(true);
    const png0 = readFileSync(STILL_C0);
    const png1 = readFileSync(STILL_M1);
    expect(png0.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(png1.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(pngSize(png0)).toEqual({ width: 1280, height: 1280 });
    expect(pngSize(png1)).toEqual({ width: 1280, height: 1280 });
    expect(png0.length).toBeGreaterThan(100_000);
    expect(png1.length, "known-good EEVEE 1280 stills are 1.3MB+; 100k is the floor").toBeGreaterThan(100_000);
    expect(createHash("sha256").update(png0).digest("hex")).not.toBe(
      createHash("sha256").update(png1).digest("hex"),
    );
  });
});

// NOT TESTED: 4-view TRELLIS, hatch remesh, high-to-low bake, Imagine-pack LPIPS.
