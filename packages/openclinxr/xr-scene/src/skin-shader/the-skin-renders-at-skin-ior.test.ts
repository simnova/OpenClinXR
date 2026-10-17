/**
 * The skin renders at skin IOR (card tsk_d4667a3e507da70).
 *
 * WHY: three.js MeshStandardMaterial hardcodes dielectric F0 0.04
 * (IOR 1.5). Skin IOR is ~1.4 (F0 = ((1.4-1)/(1.4+1))^2 = 0.0278);
 * source cited beside SKIN_IOR in
 * packages/openclinxr/xr-scene/src/isolated-subject-material-variants.ts.
 * Decision (forehead-sheen-report.json, commit 66dc54f6c): skin colour /
 * sheen gates are measured on the product room rig (ob_triage_room_v1),
 * never the studio rig.
 *
 * The node swap units (skin -> MeshPhysicalMaterial at SKIN_IOR with full state,
 * eye/cloth untouched, explicit ior control) live in
 * the-skin-shader-flag-is-read-back.test.ts, sharing that file's import of
 * isolated-subject-material-variants (xr-scene testInternalImports ceiling 10).
 * This file checks the SKIN_IOR source text and validates the room-rig report:
 * G0-G5 present with threshold sources, render shas recomputed when the store exists.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const here = dirname(fileURLToPath(import.meta.url));
const REPORT = join(
  here,
  "..", "..", "..", "..", "..",
  "tools", "openclinxr", "asset-pipeline", "skin", "face-replay",
  "room-rig-remeasure-report.json",
);
const STORE = "/Volumes/files/openclinxr-assets/store/skin-ior-room";

// The swap units live in the-skin-shader-flag-is-read-back.test.ts (shared import of
// isolated-subject-material-variants; see the note there). This file reads the source
// text and validates the room-rig report, so it imports no package internals.
describe("the skin renders at skin IOR", { timeout: 60000 }, () => {
  it("exports SKIN_IOR 1.4 with F0 = ((n-1)/(n+1))^2 beside it", () => {
    const src = readFileSync(
      join(here, "..", "isolated-subject-material-variants.ts"),
      "utf8",
    );
    expect(src).toMatch(/Donner|GPU Gems|Tuchin/);
    const m = src.match(/export const SKIN_IOR = ([0-9.]+);/);
    expect(m?.[1]).toBe("1.4");
    const n = Number(m?.[1]);
    expect(((n - 1) / (n + 1)) ** 2).toBeCloseTo(0.0278, 3);
  });

  it("room-rig-remeasure report carries G0-G5 with sources; render shas recompute", () => {
    expect(existsSync(REPORT)).toBe(true);
    const report = JSON.parse(readFileSync(REPORT, "utf8")) as {
      gates: Record<string, { threshold_source?: unknown } | null>;
      renders: Array<{ path: string; sha256: string }>;
    };
    for (const g of ["G0", "G1", "G2", "G3", "G4", "G5"]) {
      expect(report.gates[g], g).toBeTruthy();
      expect(typeof (report.gates[g] as { threshold_source?: unknown }).threshold_source, `${g}.threshold_source`).toBe("string");
    }
    expect(report.gates["G6"]).toBeTruthy();
    if (existsSync(STORE)) {
      for (const r of report.renders) {
        const abs = r.path.startsWith("/") ? r.path : join("/", r.path);
        expect(existsSync(abs), abs).toBe(true);
        expect(createHash("sha256").update(readFileSync(abs)).digest("hex")).toBe(r.sha256);
      }
    }
  });
});
