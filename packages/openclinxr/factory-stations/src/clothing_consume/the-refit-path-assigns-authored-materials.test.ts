import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { factoryStationSchemas } from "../catalog.js";
import { planClothingConsume } from "./run.js";

/**
 * OBSERVABLE: refit outputs carry AUTHORED materials — the garment's own
 * .mhclo-declared .mhmat (diffuseColor + diffuseTexture) and phenotype skin —
 * with the Display fallback ONLY when the source is verifiably absent, and the
 * reason recorded in the report. Never silent.
 *
 * Deterministic: same garment + body inputs -> same material records
 * (no randomness, no wall-clock, fixed read order).
 *
 * static material assignment only. No sim, animation, Quest, or clinical claims.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function refitPy(script: string): string {
  return execFileSync("python3", ["-c", script], { encoding: "utf8", cwd: SRC }).trim();
}

function fixtureGarment(files: Record<string, string>): { dir: string; mhclo: string } {
  const dir = mkdtempSync(join(tmpdir(), "ocx-refit-mat-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return { dir, mhclo: join(dir, "garment.mhclo") };
}

describe("the refit path assigns authored materials", () => {
  it("(1) plan() passes skinTone through and absent keeps legacy behavior", () => {
    const planned = planClothingConsume({
      actorId: "actor_a",
      mhcloPath: "library/cargo.mhclo",
      skinTone: "warm_light",
    });
    expect("issues" in planned).toBe(false);
    if ("issues" in planned) return;
    expect(planned.plan["skinTone"]).toBe("warm_light");
    const legacy = planClothingConsume({ actorId: "a", mhcloPath: "m" });
    expect("issues" in legacy).toBe(false);
    if ("issues" in legacy) return;
    expect("skinTone" in legacy.plan).toBe(false);
    const runSrc = readFileSync(join(SRC, "run.ts"), "utf8");
    expect(runSrc).toContain("--skin-tone");
  });

  it("(2) catalog schema accepts optional skinTone", () => {
    const json = factoryStationSchemas.clothing_consume.jsonSchema.input({ target: "draft-2020-12" });
    expect(json.properties, "skinTone").toHaveProperty("skinTone");
    const checked = factoryStationSchemas.clothing_consume["~standard"].validate({
      actorId: "a",
      mhcloPath: "m",
      skinTone: "warm_light",
    });
    expect("issues" in checked).toBe(false);
  });

  it("(3) authored chain resolves: .mhmat with spaces-in-path texture -> authored", () => {
    const { dir, mhclo } = fixtureGarment({
      "garment.mhclo": "basemesh hm08\nobj_file garment.obj\nmaterial garment.mhmat\n",
      "garment.mhmat":
        "name Test\n" +
        "diffuseColor 0.1000 0.5000 0.4500\n" +
        "diffuseTexture My Utility - sRGB - Texture.png\n",
      "My Utility - sRGB - Texture.png": "faked-png-bytes-not-read-by-parser",
    });
    try {
      const out = JSON.parse(
        refitPy(
          [
            "import json",
            "from refit_materials import describe_garment_material_source",
            `r = describe_garment_material_source(${JSON.stringify(mhclo)}, True)`,
            "print(json.dumps(r))",
          ].join("\n"),
        ),
      ) as Record<string, unknown>;
      expect(out["source"]).toBe("authored");
      expect(out["declaredMhmat"]).toBe("garment.mhmat");
      expect(out["declaredDiffuseTexture"]).toBe("My Utility - sRGB - Texture.png");
      expect(out["reason"]).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(4) fallback is recorded, never silent: missing .mhmat, missing texture, no UV", () => {
    const missing = fixtureGarment({
      "garment.mhclo": "basemesh hm08\nobj_file garment.obj\nmaterial garment.mhmat\n",
    });
    const noTex = fixtureGarment({
      "garment.mhclo": "basemesh hm08\nobj_file garment.obj\nmaterial garment.mhmat\n",
      "garment.mhmat": "name Test\ndiffuseColor 0.1 0.5 0.45\ndiffuseTexture Absent.png\n",
    });
    try {
      const script = (mhclo: string, uv: boolean): string =>
        [
          "import json",
          "from refit_materials import describe_garment_material_source",
          `r = describe_garment_material_source(${JSON.stringify(mhclo)}, ${uv ? "True" : "False"})`,
          "print(json.dumps(r))",
        ].join("\n");
      const a = JSON.parse(refitPy(script(missing.mhclo, true))) as Record<string, unknown>;
      expect(a["source"]).toBe("fallback");
      expect(String(a["reason"])).toMatch(/\.mhmat not staged/);
      const b = JSON.parse(refitPy(script(noTex.mhclo, true))) as Record<string, unknown>;
      expect(b["source"]).toBe("fallback");
      expect(String(b["reason"])).toMatch(/missing on disk/);
      const c = JSON.parse(refitPy(script(noTex.mhclo, false))) as Record<string, unknown>;
      expect(c["source"]).toBe("fallback");
      expect(String(c["reason"])).toMatch(/missing on disk|no UV layer/);
    } finally {
      rmSync(missing.dir, { recursive: true, force: true });
      rmSync(noTex.dir, { recursive: true, force: true });
    }
  });

  it("(5) skin follows phenotype; unknown tone falls back with a recorded reason", () => {
    const out = JSON.parse(
      refitPy(
        [
          "import json",
          "from refit_materials import describe_skin_material_source",
          "print(json.dumps({",
          "  'known': describe_skin_material_source('warm_light'),",
          "  'unknown': describe_skin_material_source('not_a_tone'),",
          "  'absent': describe_skin_material_source(''),",
          "}))",
        ].join("\n"),
      ),
    ) as {
      known: { source: string; factor: number[]; reason: null };
      unknown: { source: string; reason: string };
      absent: { source: string; reason: string };
    };
    expect(out.known.source).toBe("phenotype");
    expect(out.known.factor.slice(0, 3)).toEqual([0.78, 0.62, 0.52]);
    expect(out.known.reason).toBeNull();
    expect(out.unknown.source).toBe("fallback");
    expect(out.unknown.reason).toMatch(/absent or unknown/);
    expect(out.absent.source).toBe("fallback");
  });

  it("(6) determinism: same files -> identical records on repeat reads", () => {
    const { dir, mhclo } = fixtureGarment({
      "garment.mhclo": "basemesh hm08\nobj_file garment.obj\nmaterial garment.mhmat\n",
      "garment.mhmat": "name Test\ndiffuseColor 0.1 0.5 0.45\ndiffuseTexture T.png\n",
      "T.png": "bytes",
    });
    try {
      const script = [
        "import json",
        "from refit_materials import describe_garment_material_source, describe_skin_material_source",
        `g1 = describe_garment_material_source(${JSON.stringify(mhclo)}, True)`,
        `g2 = describe_garment_material_source(${JSON.stringify(mhclo)}, True)`,
        "s1 = describe_skin_material_source('warm_medium')",
        "s2 = describe_skin_material_source('warm_medium')",
        "print(json.dumps({'g': g1 == g2, 's': s1 == s2}))",
      ].join("\n");
      expect(JSON.parse(refitPy(script))).toEqual({ g: true, s: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(7) fit_stage.py wires assignment inside the baker with per-mesh report records", () => {
    const fitSrc = readFileSync(join(SRC, "fit_stage.py"), "utf8");
    expect(fitSrc).toContain("refit_materials");
    expect(fitSrc).toContain("assign_garment_material");
    expect(fitSrc).toContain("assign_skin_material");
    expect(fitSrc).toContain("--skin-tone");
    expect(fitSrc).toContain('report["materials"]');
    // Grade re-tint must not overwrite an authored garment material.
    expect(fitSrc).toContain('get("source") == "fallback"');
    // Refusals still refuse before assignment.
    expect(fitSrc).toContain("binding_topology_mismatch");
    expect(fitSrc).toContain("topology_uv_changed");
  });
});

// NOT TESTED: live Blender fit/export; Quest; cloth dynamics; clinical fit.
