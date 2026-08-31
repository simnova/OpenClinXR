import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: the ECG cart Factory stills compare 973,639 raw to a 34,443 stretch champion.
 * A same-source 59,187 rung already sits next to them and has never been rendered with a frozen
 * camera. Codex consult (session 01a05910-dc92-73a1-aa68-ef5a168c9f8d): that render is the cheapest
 * falsifier of "60–80k rescues likeness." This RED fails until a TRACKED report and two 1280²
 * EEVEE stills exist. Lane C: the bake-off ran; a negative grade (C1 loses) still closes.
 *
 * IMMUTABLE diagnosis. Flip it.fails → it and append ## FIXED. Do not rewrite these hashes.
 *
 * Control freeze: tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json
 * Plan: docs/openclinxr/ecg-cart-4view-optimize-cagematch-plan-2026-08-31.md §12 C0/C1
 *
 * known-good column: docs/assets/factory-pipeline/02-preopt-mesh.png and 03-postopt-mesh.png
 * are 1280×1280 EEVEE studio stills of this cart (1,425,666 and 1,355,200 bytes).
 * min-bytes floor 100000 is below those known-good sizes (not fitted to a failing render).
 *
 * Counterweight: stills must be 1280×1280 PNG, not byte-identical, and the report must echo
 * the freeze SHA-256s. exists+min-bytes alone would pass a 1280 grey rectangle.
 *
 * claimScope: whether C1 vs C0 was rendered and recorded on the tree.
 * notEvidenceFor: Quest, that C1 wins, 4-view TRELLIS, Blender high-to-low, lightmaps.
 */

const REPO = join(import.meta.dirname, "../../..");
const CONTROL = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c0-c1-control.json");
const REPORT = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c1-c0-report.json");
const STILL_C0 = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c1-c0-renders/c0-champion.png");
const STILL_C1 = join(REPO, "tools/openclinxr/asset-pipeline/trellis/ecg-cart-c1-c0-renders/c1-r0_005.png");
const VERDICTS = ["beats_control", "loses_to_control", "indistinguishable", "inconclusive_blocked", "other"] as const;

type Freeze = {
  stagingDir: string;
  raw: { file: string; sha256: string; triangles: number };
  c0: { file: string; sha256: string; triangles: number };
  c1: { file: string; sha256: string; triangles: number };
};

function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("the ECG cart C1 density falsifier has been graded", () => {
  it.fails("(1) tracked C1 vs C0 report and 1280 EEVEE stills exist with frozen SHAs", () => {
    const freeze = JSON.parse(readFileSync(CONTROL, "utf8")) as Freeze;
    const staging = join(REPO, freeze.stagingDir);
    for (const row of [freeze.raw, freeze.c0, freeze.c1]) {
      const glb = join(staging, row.file);
      expect(existsSync(glb), `control GLB missing (gitignored staging): ${glb}`).toBe(true);
      expect(sha256File(glb), row.file).toBe(row.sha256);
    }

    expect(existsSync(REPORT), `${REPORT} is the tracked land path (not .openclinxr/evidence)`).toBe(true);
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      schemaVersion?: string;
      controlSha256?: { raw?: string; c0?: string; c1?: string };
      cameraFreeze?: { center?: number[]; radius?: number; elevDeg?: number; azimDeg?: number };
      gradedVerdict?: string;
      verdictNote?: string;
      beatsControl?: boolean;
    };
    expect(report.schemaVersion).toBe("openclinxr.ecg-cart-c1-c0.v1");
    expect(report.controlSha256?.raw).toBe(freeze.raw.sha256);
    expect(report.controlSha256?.c0).toBe(freeze.c0.sha256);
    expect(report.controlSha256?.c1).toBe(freeze.c1.sha256);
    expect(report.cameraFreeze?.center).toHaveLength(3);
    expect(Number(report.cameraFreeze?.radius)).toBeGreaterThan(0);
    expect(report.cameraFreeze?.elevDeg).toBe(14);
    expect(report.cameraFreeze?.azimDeg).toBe(40);
    expect(VERDICTS, "gradedVerdict").toContain(report.gradedVerdict);
    expect(report.verdictNote?.length ?? 0, "escape values hide in the note").toBeGreaterThan(0);

    expect(existsSync(STILL_C0), STILL_C0).toBe(true);
    expect(existsSync(STILL_C1), STILL_C1).toBe(true);
    const png0 = readFileSync(STILL_C0);
    const png1 = readFileSync(STILL_C1);
    expect(png0.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(png1.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    expect(pngSize(png0)).toEqual({ width: 1280, height: 1280 });
    expect(pngSize(png1)).toEqual({ width: 1280, height: 1280 });
    expect(png0.length, "known-good EEVEE 1280 stills are 1.3MB+; 100k is the floor").toBeGreaterThan(100_000);
    expect(png1.length).toBeGreaterThan(100_000);
    expect(createHash("sha256").update(png0).digest("hex")).not.toBe(
      createHash("sha256").update(png1).digest("hex"),
    );
  });
});

// NOT TESTED: whether C1 looks closer to the Imagine pack (orchestrator grades pixels).
// Nor 4-view TRELLIS, hatch remesh, or #694 high-to-low.
