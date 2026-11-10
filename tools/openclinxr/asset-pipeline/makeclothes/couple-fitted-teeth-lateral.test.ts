import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { planTeethVisemeTargets } from "./couple-fitted-teeth-to-lip-viseme.ts";

// tsk_27e0cec12cab410d: the coupler wrote a constant -5.8 mm x on the upper
// arch at viseme_aa, so the arch slid sideways on all 7 coupled actors. The
// clause is the per-shell lateral MEAN, so a later symmetric per-vertex tuck still passes.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const SHIPPED = path.join(REPO, "apps/ui-xr/public/generated-humanoids");
const COUPLED = [
  "mpfb-clinical-nurse-adult",
  "mpfb-family-partner-adult",
  "mpfb-gown-adult-patient",
  "mpfb-gown-ed-robert-hayes",
  "mpfb-peds-patient-child",
  "mpfb-street-adult-male",
  "mpfb-peds-nurse-kevin",
] as const;
const VISEMES = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_FF", "viseme_PP"];

// Float noise, not a design value. A per-vertex x tuck that stays symmetric keeps the mean at 0.
const MEAN_DX_NOISE_M = 1e-6;
const WHY = "tsk_27e0cec12cab410d: a lateral mean shift slides the arch sideways; do not widen";

function meanX(delta: ArrayLike<number>, vertices: readonly number[]): number {
  let sum = 0;
  for (const vertex of vertices) sum += delta[vertex * 3] ?? 0;
  return sum / vertices.length;
}

function maxAbsX(delta: ArrayLike<number>, vertices: readonly number[]): number {
  let max = 0;
  for (const vertex of vertices) max = Math.max(max, Math.abs(delta[vertex * 3] ?? 0));
  return max;
}

type ShellRow = { name: string; shell: "head" | "jaw"; meanDx: number; maxAbsX: number };

function shellRows(name: string, delta: ArrayLike<number>, head: readonly number[], jaw: readonly number[]): ShellRow[] {
  return [
    { name, shell: "head", meanDx: meanX(delta, head), maxAbsX: maxAbsX(delta, head) },
    { name, shell: "jaw", meanDx: meanX(delta, jaw), maxAbsX: maxAbsX(delta, jaw) },
  ];
}

function report(label: string, rows: ShellRow[]): void {
  // max|x| is a report line only; the assertion is on the per-shell mean.
  process.stdout.write(`${label} ${JSON.stringify(rows.map((row) => [row.name, row.shell, row.meanDx, row.maxAbsX]))}\n`);
}

describe("coupled teeth visemes do not slide the arch sideways", () => {
  it("plans a zero lateral mean on each shell for every coupled viseme", async () => {
    const plan = await planTeethVisemeTargets(path.join(SHIPPED, "mpfb-clinical-nurse-adult.glb"));
    expect(plan.targets.map((target) => target.name)).toEqual(VISEMES);
    const rows = plan.targets.flatMap((target) => shellRows(target.name, target.delta, plan.headWeighted, plan.jawWeighted));
    report("plan nurse", rows);
    expect(rows.filter((row) => Math.abs(row.meanDx) > MEAN_DX_NOISE_M), WHY).toEqual([]);
    // Counterweight: the aa upper shell still moves (y down, z forward), so a zeroed target cannot pass.
    const aa = plan.targets[0]!;
    expect(Math.abs(aa.headDelta[1])).toBeGreaterThan(0.005);
    expect(Math.abs(aa.headDelta[2])).toBeGreaterThan(0.005);
  }, 120_000);

  it("ships a zero lateral mean on each shell in the teeth viseme morphs of all 7 coupled actors", async () => {
    const io = new NodeIO();
    const rows: (ShellRow & { actor: string })[] = [];
    const moves: { actor: string; viseme: string; maxAbsYZ: number }[] = [];
    for (const actor of COUPLED) {
      const glb = path.join(SHIPPED, `${actor}.glb`);
      const plan = await planTeethVisemeTargets(glb);
      const doc = await io.read(glb);
      const teeth = doc.getRoot().listMeshes().find((mesh) => /fitted_teeth/i.test(mesh.getName()));
      if (!teeth) throw new Error(`${actor}: no fitted teeth mesh`);
      const names = (teeth.getExtras() as { targetNames?: string[] }).targetNames ?? [];
      const targets = teeth.listPrimitives()[0]!.listTargets();
      for (const viseme of ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U"]) {
        const index = names.indexOf(viseme);
        const array = index < 0 ? undefined : targets[index]?.getAttribute("POSITION")?.getArray();
        if (!array) throw new Error(`${actor}: no teeth ${viseme}`);
        let yz = 0;
        for (let i = 0; i < array.length; i += 3) yz = Math.max(yz, Math.abs(array[i + 1]!), Math.abs(array[i + 2]!));
        for (const row of shellRows(viseme, array, plan.headWeighted, plan.jawWeighted)) rows.push({ actor, ...row });
        moves.push({ actor, viseme, maxAbsYZ: yz });
      }
    }
    report("shipped", rows);
    expect(rows.filter((row) => Math.abs(row.meanDx) > MEAN_DX_NOISE_M), WHY).toEqual([]);
    // Counterweight: every opening viseme still moves the teeth.
    expect(moves.filter((row) => row.maxAbsYZ < 0.002)).toEqual([]);
  }, 300_000);
});
