import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { factoryStationSchemas, PRODUCTION_STATION_IDS } from "../catalog-mod.js";
import { stationRunners } from "../station-runners.js";
import { applyIteration, clampParam, criticOverall, proposeFromTargetRead } from "./plan.js";
import { planHairEditorStation, runHairEditor } from "./run.js";

/**
 * OBSERVABLE: hair has only the MakeClothes .mhclo fit path plus painted scalp.
 * This station is the Hair Editor alternative; the mhclo path stays default.
 */

const VALID = {
  actorId: "actor_a",
  family: "bob",
  hairAsset: "UNRESOLVED",
  targetReadJson: '{"length_class":"jaw","curl_class":"wave","color_name":"dark_brown","volume_class":"natural","density_class":"normal"}',
  round: 0,
};

const critic = {
  silhouette: 1,
  length: 1,
  part_and_hairline: 1,
  curl_and_clump: 1,
  volume: 1,
  density_temples: 1,
  color: 1,
  uncanny: 0,
  style_mismatch: 0,
};

const baseParams = (): Record<string, number | number[]> => ({
  length: 3.5,
  curl: 0.25,
  curl_radius: 0.05,
  thickness: 0.001,
});

describe("the hair editor station is an alternative to mhclo", () => {
  it("(1) hair_editor is registered with its runner", () => {
    expect(PRODUCTION_STATION_IDS).toContain("hair_editor");
    expect(stationRunners.hair_editor.stationId).toBe("hair_editor");
  });

  it("(2) catalog accepts VALID and rejects an unknown key", () => {
    expect(factoryStationSchemas.hair_editor["~standard"].validate(VALID)).toEqual({ value: VALID });
    const bad = factoryStationSchemas.hair_editor["~standard"].validate({ ...VALID, bogus: 1 });
    expect(bad.issues).toBeDefined();
  });

  it("(3) clamps hit the spec bounds", () => {
    expect(clampParam("length", 99, "short")).toBe(10);
    expect(clampParam("length", -1, "short")).toBe(0);
    expect(clampParam("thickness", 1, "short")).toBe(0.003);
  });

  it("(4) parting is not a slider", () => {
    const result = clampParam("parting", 0.5, "short");
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  it("(5) propose maps shoulder and coil into range", () => {
    const shoulder = proposeFromTargetRead({ length_class: "shoulder" });
    expect(shoulder["length"] as number).toBeGreaterThanOrEqual(2.5);
    expect(shoulder["length"] as number).toBeLessThanOrEqual(4.5);
    const coil = proposeFromTargetRead({ curl_class: "coil" });
    expect(coil["curl"] as number).toBeGreaterThanOrEqual(0.7);
    expect(coil["curl"] as number).toBeLessThanOrEqual(1.0);
  });

  it("(6) five delta keys leave params unchanged", () => {
    const params = baseParams();
    const result = applyIteration({
      params,
      deltas: { length: 0.1, curl: 0.01, thickness: 0.0001, curl_radius: 0.001, frizz: 0.01 },
      critic,
    });
    expect(result.issues).toBeDefined();
    expect(result.params).toEqual(params);
  });

  it("(7) oversize delta leaves params unchanged", () => {
    const params = baseParams();
    const result = applyIteration({ params, deltas: { length: 5 }, critic });
    expect(result.issues).toBeDefined();
    expect(result.params).toEqual(params);
  });

  it("(8) style_mismatch resets without applying sliders", () => {
    const params = baseParams();
    const result = applyIteration({
      params,
      deltas: { length: 0.5 },
      critic: { ...critic, style_mismatch: 0.7 },
    });
    expect(result.status).toBe("reset_style");
    expect(result.params).toEqual(params);
  });

  it("(9) asset change plus slider applies neither", () => {
    const params = baseParams();
    const result = applyIteration({
      params,
      deltas: { length: 0.5 },
      critic,
      hairAsset: "A",
      nextHairAsset: "B",
    });
    expect(result.issues).toBeDefined();
    expect(result.params).toEqual(params);
  });

  it("(10) criticOverall weights color and uncanny", () => {
    expect(criticOverall(critic)).toBeCloseTo(1, 10);
    expect(criticOverall({ ...critic, silhouette: 0, length: 0, part_and_hairline: 0, curl_and_clump: 0, volume: 0, density_temples: 0, color: 0, uncanny: 1 })).toBeCloseTo(0, 10);
  });

  it("(11) plan() is a dry-run for hair_editor", () => {
    const result = planHairEditorStation(VALID);
    expect(result.issues).toBeUndefined();
    if (result.issues !== undefined) return;
    expect(result.plan["mode"]).toBe("dry-run");
    expect(result.plan["stationId"]).toBe("hair_editor");
  });

  it("(12) run() without the blend env is blocked", async () => {
    const saved = process.env["OPENCLINXR_HAIR_EDITOR_BLEND"];
    delete process.env["OPENCLINXR_HAIR_EDITOR_BLEND"];
    try {
      const result = await runHairEditor(VALID);
      expect(result["stop_reason"]).toBe("install Hair editor pack");
      expect(result["status"]).toBe("blocked");
    } finally {
      if (saved !== undefined) process.env["OPENCLINXR_HAIR_EDITOR_BLEND"] = saved;
    }
  });

  it("(13) station sources never fall back to mhclo", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const runSrc = readFileSync(join(dir, "run.ts"), "utf8");
    const pySrc = readFileSync(join(dir, "apply_hair_editor.py"), "utf8");
    for (const src of [runSrc, pySrc]) {
      expect(src).not.toContain("embed_library_hair");
      expect(src).not.toContain(".mhclo");
      expect(src).not.toContain("generate_hair_cards");
      expect(src).not.toContain("bake_hair");
    }
  });

  it("(14) missing pack exits 2 with system python", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const env = { ...process.env };
    delete env["OPENCLINXR_HAIR_EDITOR_BLEND"];
    let stdout = "";
    let code = 0;
    try {
      stdout = execFileSync("python3", [join(dir, "apply_hair_editor.py")], { env, encoding: "utf8" });
    } catch (err) {
      const typed = err as { status?: number; stdout?: string };
      code = typed.status ?? 1;
      stdout = String(typed.stdout ?? "");
    }
    expect(code).toBe(2);
    expect(stdout).toContain("install Hair editor pack");
  });
});
