import { repoRoot } from "@openclinxr/factory-station-core/runner";
/**
 * CARD tsk_b1604af3eb881268 — a brown iris renders brown, not red.
 *
 * RED (findings.json row pink-eyes, commit fbe50d483): body2 bakes with no
 * --eye-texture, so eye_iris_colour returns "brown" and the materializer
 * consumes pack brown_eye.png, whose texel iris ring reads (70.1,15.7,3.0),
 * hue ~11.4 deg. Front render iris ring R-G 40 vs Aisha (neutral
 * iris-centred-c.png) R-G 15 under the same rig.
 *
 * FIX: iris_palette.iris_diffuse_override maps pack id "brown" to the
 * UV-locked neutral texture tools/openclinxr/asset-pipeline/eyes/
 * iris-centred-c.png (pupil shift 0.77/0.63 texels per texture-manifest.json);
 * every other id maps to None (pack texture kept). The materializer feeds the
 * resolved texture through the same TEXTURE_OVERRIDES slot --eye-texture uses;
 * an explicit --eye-texture keeps precedence. eye_iris_colour is unchanged.
 *
 * Gates read tools/openclinxr/asset-pipeline/realism-head/iris-neutral/
 * iris-neutral-report.json (numbers measured, not claimed). No Blender, no
 * render here: the resolver is pure Python and runs in-process; the render
 * numbers live in the report with their method.
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const HERE = path.join(repoRoot(), "tools/openclinxr/asset-pipeline/realism-head/iris-neutral");
const REPO_ROOT = repoRoot();
const REPORT = path.join(HERE, "iris-neutral-report.json");
const PALETTE = path.join(
  REPO_ROOT,
  "tools/openclinxr/asset-pipeline/anny/iris_palette.py",
);
const MATERIALIZER = path.join(
  REPO_ROOT,
  "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py",
);

async function runPython(script: string): Promise<string> {
  const { stdout } = await execFileAsync("python3", ["-c", script], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

type Report = {
  verdict: string;
  texel: { barDeg: number; perIdHueDeg: Record<string, number>; resolved: { path: string; hueDeg: number } };
  body2: {
    bakeLogEyeLine: string;
    post: { ringRG: number; presence: number; hueDeg: number; irisLum: number; scleraLum: number };
    pre: { ringRG: number; presence: number; hueDeg: number };
  };
  aisha: { shasEqual: { eyeImage: boolean; POSITION: boolean; TEXCOORD_0: boolean } };
  gates: { G1: { pass: boolean }; G2: { pass: boolean }; G3: { pass: boolean }; G4: { pass: boolean }; G5: { pass: boolean } };
  probes: Array<{ gate: string; result: string }>;
};

function loadReport(): Report {
  return JSON.parse(readFileSync(REPORT, "utf8")) as Report;
}

describe("a brown iris renders brown, not red (tsk_b1604af3eb881268)", () => {
  it("(unit) the resolver maps brown to iris-centred-c.png and nothing else", async () => {
    const stdout = await runPython(`
import sys, json
sys.path.insert(0, "tools/openclinxr/asset-pipeline/anny")
from iris_palette import eye_iris_colour, iris_diffuse_override
ids = ["blue", "bluegreen", "brown", "brownlight", "deepblue", "green", "grey", "ice", "lightblue"]
print(json.dumps({
    "brown": iris_diffuse_override("brown"),
    "others": {i: iris_diffuse_override(i) for i in ids if i != "brown"},
    "roleUnchanged": eye_iris_colour("patient", {}),
}))
`);
    const got = JSON.parse(stdout) as {
      brown: string | null;
      others: Record<string, string | null>;
      roleUnchanged: string;
    };
    expect(got.brown, "brown must resolve to the neutral texture").toBe(
      "tools/openclinxr/asset-pipeline/eyes/iris-centred-c.png",
    );
    expect(
      Object.values(got.others).every((v) => v === null),
      `every non-brown id keeps the pack texture, got ${JSON.stringify(got.others)}`,
    ).toBe(true);
    expect(got.roleUnchanged, "eye_iris_colour return values do not change").toBe("brown");
  });

  it("(unit) the materializer keeps --eye-texture precedence (source)", () => {
    const src = readFileSync(MATERIALIZER, "utf8");
    // HANDBACK1: output-stem tables are product config — no card scratch
    // stems (prefix/postfix/irisfix) may enter them. Bakes use registered
    // stems with outputs in store subdirectories instead.
    for (const table of [
      "LOWER_GARMENT_BY_OUTPUT_STEM",
      "EYE_DIAMETER_TARGET_MM",
    ]) {
      const start = src.indexOf(`${table} = {`);
      expect(start, `table ${table} found`).toBeGreaterThan(-1);
      const end = src.indexOf("\n}", start);
      const keys = [...src.slice(start, end).matchAll(/"([^"]+)":/g)].map(
        (m) => m[1]!,
      );
      expect(keys.length, `${table} must stay non-empty`).toBeGreaterThan(0);
      for (const k of keys) {
        expect(
          /prefix|postfix|irisfix/.test(k),
          `${table} carries a scratch stem ${k}`,
        ).toBe(false);
      }
    }
    // Explicit --eye-texture prints EYE_TEXTURE_RESOLVED with its own path...
    expect(
      src.includes('print(f"EYE_TEXTURE_RESOLVED {_iris_key} {args.eye_texture}")'),
      "explicit --eye-texture must keep precedence and log EYE_TEXTURE_RESOLVED",
    ).toBe(true);
    // ...and the resolver only feeds the same TEXTURE_OVERRIDES slot otherwise.
    expect(
      src.includes('TEXTURE_OVERRIDES["mat_makeclothes_library_eyes"] = str('),
      "resolved texture must travel the same TEXTURE_OVERRIDES slot",
    ).toBe(true);
    expect(
      src.includes("iris_diffuse_override(_iris_key)"),
      "resolution is f(selected pack id)",
    ).toBe(true);
    // No subject or output-stem literal in the eye-resolution block itself
    // (from the resolver import to the EYE_TEXTURE_RESOLVED log line).
    const blockStart = src.indexOf("from iris_palette import iris_diffuse_override");
    const blockEnd = src.indexOf("else 'pack'}", blockStart);
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const eyeBlock = src.slice(blockStart, blockEnd).toLowerCase();
    for (const lit of ["aisha", "body2", "adult_male", "street_casual"]) {
      expect(
        eyeBlock.toLowerCase().includes(lit),
        `eye-resolution code must not name a subject (${lit})`,
      ).toBe(false);
    }
  });

  it("(G1) every texture the resolver returns for brown clears the hue bar", () => {
    const r = loadReport();
    expect(r.gates.G1.pass).toBe(true);
    expect(r.texel.resolved.hueDeg).toBeGreaterThanOrEqual(r.texel.barDeg);
    // The bar bites: the pack brown it replaces fails it.
    expect(r.texel.perIdHueDeg["brown"]!).toBeLessThan(r.texel.barDeg);
  });

  it("(G2/G3) post-fix body2 ring is neutral; pre-fix fails the same bars", () => {
    const r = loadReport();
    expect(r.gates.G2.pass).toBe(true);
    expect(r.gates.G3.pass).toBe(true);
    expect(r.body2.post.ringRG).toBeLessThanOrEqual(27.5);
    expect(r.body2.post.presence).toBeLessThan(0.758);
    expect(r.body2.post.hueDeg).toBeGreaterThanOrEqual(15.9);
    expect(r.body2.post.hueDeg).toBeLessThanOrEqual(60);
    expect(r.body2.post.irisLum).toBeLessThan(r.body2.post.scleraLum);
    // Destructive: the pre-fix render fails the same bars (gates are live).
    expect(r.body2.pre.ringRG).toBeGreaterThan(27.5);
    expect(
      r.body2.pre.hueDeg < 15.9 || r.body2.pre.hueDeg > 60,
      "pre-fix hue must sit outside the brown band",
    ).toBe(true);
  });

  it("(G4) Aisha post-fix eye bytes equal STEP 0 (explicit texture untouched)", () => {
    const r = loadReport();
    expect(r.gates.G4.pass).toBe(true);
    expect(r.aisha.shasEqual.eyeImage).toBe(true);
    expect(r.aisha.shasEqual.POSITION).toBe(true);
    expect(r.aisha.shasEqual.TEXCOORD_0).toBe(true);
  });

  it("(G5) no subject literal in the palette", () => {
    const r = loadReport();
    expect(r.gates.G5.pass).toBe(true);
    const src = readFileSync(PALETTE, "utf8").toLowerCase();
    for (const lit of ["aisha", "body2", "adult_male", "street_casual"]) {
      expect(src.includes(lit), `iris_palette.py must not contain ${lit}`).toBe(false);
    }
  });

  it("each gate was probed destructively once and the verdict is recorded", () => {
    const r = loadReport();
    expect(
      ["fixed", "falsified", "other"].includes(r.verdict),
      `verdict must be one of fixed/falsified/other, got ${r.verdict}`,
    ).toBe(true);
    const probed = new Set(r.probes.map((p) => p.gate));
    for (const g of ["G1", "G2", "G3", "G4", "G5"]) {
      expect(probed.has(g), `gate ${g} needs a recorded destructive probe`).toBe(true);
    }
    if (r.verdict === "fixed") {
      for (const g of ["G1", "G2", "G3", "G4", "G5"] as const) {
        expect(r.gates[g].pass, `verdict fixed requires ${g} pass`).toBe(true);
      }
      expect(
        r.body2.bakeLogEyeLine.includes("EYE_TEXTURE_RESOLVED brown") &&
          r.body2.bakeLogEyeLine.includes("iris-centred-c"),
        "fixed verdict needs the resolver line in the bake log",
      ).toBe(true);
    } else {
      // Falsified/other: the test asserts the recorded verdict path instead
      // of the fix bars (card falsifier clause).
      expect(r.body2.post.ringRG).toBeGreaterThan(27.5);
    }
  });
});
