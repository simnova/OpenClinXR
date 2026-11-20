import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { planTeethVisemeTargets } from "./couple-fitted-teeth-to-lip-viseme.ts";

// tsk_09ebec711d102e62 (store/aisha-parity/teeth-visemes/shells/red):
// the shipped coupler refuses mpfb-ob-patient-aisha with "lower front shell
// is not entirely jaw-weighted", so her fitted teeth carry no planned visemes.
// The "front shells follow the skin" test names below pin the refusal (R1)
// and the no-op counterweight on actors the shipped coupler already plans (CW1).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const SHIPPED = path.join(REPO, "apps/ui-xr/public/generated-humanoids");
const VISEMES = ["viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_FF", "viseme_PP"];
const KNOWN_GOOD = [
  "mpfb-clinical-nurse-adult",
  "mpfb-clinical-physician-adult",
  "mpfb-family-partner-adult",
  "mpfb-gown-adult-patient",
  "mpfb-gown-ed-robert-hayes",
  "mpfb-peds-nurse-kevin",
  "mpfb-peds-patient-child",
  "mpfb-street-adult-male",
] as const;

// mpfb-peds-parent-aisha is excluded: its shipped GLB carries 7 teeth targets
// but the shipped coupler refuses it (S0a), so its targets did not come from
// this coupler and are no known-good. This test asserts nothing about it.

// WHY (counterweight): the selection change must be a no-op wherever the old
// rule worked, so every planned delta must match the shipped morph target bit
// for bit on all 8 actors the shipped coupler plans.
function differingFloats(planned: ArrayLike<number>, shipped: ArrayLike<number>): number {
  if (planned.length !== shipped.length) throw new Error(`length ${planned.length} vs ${shipped.length}`);
  let differing = 0;
  for (let i = 0; i < planned.length; i += 1) {
    if ((planned[i] ?? 0) !== (shipped[i] ?? 0)) differing += 1;
  }
  return differing;
}

describe("front shells follow the skin", () => {
  // PLANT (tsk_09ebec711d102e62): it.fails while the coupler refuses Aisha; the fix converts this to it(.
  it.fails("plans all 7 teeth visemes for mpfb-ob-patient-aisha", async () => {
    // RED: today this await rejects with "lower front shell is not entirely
    // jaw-weighted". The rejection fails this clause; that failure is the point.
    const plan = await planTeethVisemeTargets(path.join(SHIPPED, "mpfb-ob-patient-aisha.glb"));
    expect(plan.targets.map((target) => target.name)).toEqual(VISEMES);
    expect(plan.targets.filter((target) => target.name === "viseme_aa")).toHaveLength(1);
  }, 120_000);

  it("plans bit-identical deltas to the shipped teeth morphs on all 8 coupled actors", async () => {
    const io = new NodeIO();
    const perActor: { actor: string; differing: number; floats: number }[] = [];
    for (const actor of KNOWN_GOOD) {
      const glb = path.join(SHIPPED, `${actor}.glb`);
      const plan = await planTeethVisemeTargets(glb);
      const doc = await io.read(glb);
      const teeth = doc.getRoot().listMeshes().find((mesh) => /fitted_teeth/i.test(mesh.getName()));
      if (!teeth) throw new Error(`${actor}: no fitted teeth mesh`);
      const names = (teeth.getExtras() as { targetNames?: string[] }).targetNames ?? [];
      const targets = teeth.listPrimitives()[0]!.listTargets();
      let differing = 0;
      let floats = 0;
      const perViseme: [string, number][] = [];
      for (const target of plan.targets) {
        const index = names.indexOf(target.name);
        if (index < 0) throw new Error(`${actor}: no teeth ${target.name}`);
        const shipped = targets[index]?.getAttribute("POSITION")?.getArray();
        if (!shipped) throw new Error(`${actor}: no POSITION for ${target.name}`);
        const count = differingFloats(target.delta, shipped);
        perViseme.push([target.name, count]);
        differing += count;
        floats += target.delta.length;
      }
      perActor.push({ actor, differing, floats });
      process.stdout.write(`${actor} differing=${differing} floats=${floats} ${JSON.stringify(perViseme)}\n`);
    }
    process.stdout.write(`known-good ${JSON.stringify(perActor)}\n`);
    expect(perActor.filter((row) => row.differing !== 0)).toEqual([]);
  }, 300_000);
});
