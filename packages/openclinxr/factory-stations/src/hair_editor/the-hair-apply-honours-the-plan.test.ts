import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planHairEditorStation } from "./run.js";

/**
 * OBSERVABLE: the hair-editor --apply path bakes the case, not Aisha constants.
 * apply_hair_editor.py --resolve-inputs resolves plan sliders, macros and the
 * output dir from its inputs without Blender; run.ts wires --macros/--out.
 */

const dir = dirname(fileURLToPath(import.meta.url));
const script = join(dir, "apply_hair_editor.py");

type ResolveResult = {
  values: Record<string, number>;
  macros: Record<string, number>;
  scale: number | null;
  evidenceDir: string;
};

function resolveInputs(plan: unknown, macros: unknown, out: string): ResolveResult {
  const box = mkdtempSync(join(tmpdir(), "hair-resolve-"));
  const planFile = join(box, "plan.json");
  const macrosFile = join(box, "macros.json");
  writeFileSync(planFile, JSON.stringify(plan), "utf8");
  writeFileSync(macrosFile, JSON.stringify(macros), "utf8");
  const stdout = execFileSync("python3", [script, "--resolve-inputs", "--plan", planFile, "--macros", macrosFile, "--out", out], {
    encoding: "utf8",
  });
  return JSON.parse(stdout) as ResolveResult;
}

const planWith = (length: number, density: number) => ({ params: { length, density } });
const macrosWith = (age: number) => ({ gender: 0.5, age, weight: 0.6, muscle: 0.4 });

describe("the hair apply honours the plan", () => {
  it("(1) plan sliders resolve without the 1.2 and 1.0 overrides", () => {
    const first = resolveInputs(planWith(2.4, 0.7), macrosWith(0.31), join(tmpdir(), "hair-out-a"));
    expect(first.values["length"]).toBe(2.4);
    expect(first.values["density"]).toBe(0.7);
    const second = resolveInputs(planWith(0.6, 0.7), macrosWith(0.31), join(tmpdir(), "hair-out-b"));
    expect(second.values["length"]).toBe(0.6);
  });

  it("(2) macros age resolves from input, not 0.6191", () => {
    const resolved = resolveInputs(planWith(2.4, 0.7), macrosWith(0.31), join(tmpdir(), "hair-out-c"));
    expect(resolved.macros["age"]).toBe(0.31);
  });

  it("(3) evidenceDir equals --out and nothing is created under the script dir", () => {
    const before = readdirSync(dir).sort();
    const out = join(tmpdir(), "hair-out-d");
    const resolved = resolveInputs(planWith(2.4, 0.7), macrosWith(0.31), out);
    expect(resolved.evidenceDir).toBe(out);
    expect(readdirSync(dir).sort()).toEqual(before);
  });

  it("(4) omitting --macros exits non-zero with 'macros required'", () => {
    const box = mkdtempSync(join(tmpdir(), "hair-resolve-"));
    const planFile = join(box, "plan.json");
    writeFileSync(planFile, JSON.stringify(planWith(2.4, 0.7)), "utf8");
    let code = 0;
    let output = "";
    try {
      execFileSync("python3", [script, "--resolve-inputs", "--plan", planFile, "--out", join(box, "out")], { encoding: "utf8" });
    } catch (err) {
      const typed = err as { status?: number; stdout?: string; stderr?: string };
      code = typed.status ?? 1;
      output = `${String(typed.stdout ?? "")}\n${String(typed.stderr ?? "")}`;
    }
    expect(code).not.toBe(0);
    expect(output).toContain("macros required");
  });

  it("(5) the Aisha numbers appear nowhere in resolved output for a non-Aisha input", () => {
    const resolved = resolveInputs(planWith(2.4, 0.7), macrosWith(0.31), join(tmpdir(), "hair-out-e"));
    expect(JSON.stringify(resolved)).not.toContain("0.6191");
    expect(JSON.stringify(resolved)).not.toContain("0.5024");
    expect(resolved.macros).toEqual(macrosWith(0.31));
  });

  it("(6) run.ts passes --macros from the plan input and --out from a station input", () => {
    const runSrc = readFileSync(join(dir, "run.ts"), "utf8");
    expect(runSrc).toContain("--macros");
    expect(runSrc).toContain("--out");
    const planned = planHairEditorStation({
      actorId: "actor_a",
      family: "bob",
      hairAsset: "UNRESOLVED",
      targetReadJson: JSON.stringify({ length_class: "jaw", macros: macrosWith(0.31) }),
      round: 0,
    });
    expect(planned.issues).toBeUndefined();
  });
});
