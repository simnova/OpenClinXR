import { readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { resolvePoseBone } from "../../../packages/openclinxr/asset-registry/src/pose-bone-resolver.js";

/**
 * #492 — the supine pose map binds 3 of its 17 bones on the body it now poses.
 *
 * ## THE REGRESSION, GRADED THEN MEASURED — IMMUTABLE
 *
 * `#491` recast seven patients onto the gowned MPFB body. Its contract asserted CAST RESOLUTION and
 * passed. The orchestrator then graded the pixels — which `#491`'s own NOT TESTED said it still owed
 * — from a live `scene-overview` room capture:
 *
 *   ed_chest_pain_priority_v1          patient SUPINE   -> a crumpled teal mass, not a figure
 *   ward_delirium_med_rec_v1           patient SUPINE   -> the same crumpled teal mass
 *   psych_suicidal_ideation_safety_v1  patient STANDING -> CORRECT, a recognisable gowned patient
 *
 * ## THE CAUSE, MEASURED — and it is a rig-naming mismatch, not a gown tear
 *
 * `supine-pose.ts:36 SUPINE_BONE_EULERS` holds 17 entries. Its own header says it was authored
 * against *"the existing 23-bone runtime subset"*. Resolved against each shipped body's joint names
 * (dots stripped, as `three.js` `PropertyBinding.sanitizeNodeName` does — SS6v):
 *
 *   body                             joints   binds   misses
 *   ---------------------------------|--------|-------|------------------------------------------
 *   ed_chest_pain_adult_cast.glb      |   23   | 17/17 | none                      <- KNOWN-GOOD
 *   mpfb-gown-adult-patient.glb       |  138   |  3/17 | pelvis spine chest thighL thighR shinL
 *                                     |        |       | shinR upper_armL upper_armR forearmL
 *                                     |        |       | forearmR handL handR neck
 *
 * The three that bind — `foot.L`->`footL`, `foot.R`->`footR`, `head` — are **naming coincidences**.
 * The MPFB rig uses MakeHuman names, and several are SEGMENTED where the map has one entry:
 *
 *   map "pelvis"      -> MPFB has `pelvis.L` / `pelvis.R` and a separate `root`. No single pelvis.
 *   map "spine",      -> `spine01` `spine02` `spine03` `spine04` `spine05`   (5 segments)
 *       "chest"
 *   map "neck"        -> `neck01` `neck02` `neck03`                          (3 segments)
 *   map "thighL/R"    -> `upperleg01.L` `upperleg02.L`
 *   map "shinL/R"     -> `lowerleg01.L` `lowerleg02.L`
 *   map "upper_armL/R"-> `upperarm01.L` `upperarm02.L`
 *   map "forearmL/R"  -> `lowerarm01.L` `lowerarm02.L`
 *
 * So the on-back ROOT rotation lays the whole figure down, and then 14 of 17 joint eulers **silently
 * skip**. A standing-posed body tipped onto its back with only its feet and head moved is exactly
 * what the pixels show.
 *
 * `#306` (closed) recorded this class in the abstract — *"the shipped MPFB2 actor resolves 1 of 14
 * runtime pose bones … the miss is a SILENT SKIP"*. This is the same failure reaching a learner.
 *
 * **A candidate of mine that this DISPROVES:** I first suspected the constant-offset gown skin
 * (`#488`: std 1.5 mm against a 22.4 mm `cloth_offset`) tearing under the supine transform. It is
 * not that. The body itself is unposed; the gown is riding a broken pose.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                       | (1) binds | (2) map intact | (3) anny | result
 *   ------------------------------------------------|-----------|----------------|----------|--------
 *   a) today — 3/17 on the recast body               | **FAIL**  |     pass       |   pass   | REFUSED
 *   b) delete the 14 unbindable entries              |   pass    |   **FAIL**     |   pass   | REFUSED
 *   c) rename MPFB joints to the Anny vocabulary     |   pass    |     pass       |   pass   | see below
 *   d) alias the map onto the MakeHuman rig          |   pass    |     pass       |   pass   | ALL PASS
 *
 * **(b) is the one to watch.** Deleting entries raises the bind RATIO to 3/3 and poses nothing. The
 * ratio must be measured against the map's FULL size, which clause (2) pins.
 *
 * **(c) is not refused by a clause and must not be done anyway** — renaming joints in the GLB breaks
 * every morph, clip and contract keyed to MakeHuman names, and the rig is the vendor's. Stated here
 * because a contract cannot catch it and a worker might reach for it.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): **(1) is the sole RED.** (2) and (3) pass today and
 * exist so (1) cannot be satisfied by shrinking the map or by breaking the Anny body that is still
 * the known-good. (4) is a vacuity guard.
 *
 * ## THE SEGMENTED-BONE DECISION IS NOT THE IMPLEMENTER'S (SS8d)
 *
 * One map entry, several MPFB bones. Applying a `spine` euler to all five segments multiplies it
 * fivefold; applying it to `spine01` alone under-rotates. **The decision: apply the authored euler
 * to the FIRST segment of each chain (`spine01`, `neck01`, `upperleg01`, `lowerleg01`,
 * `upperarm01`, `lowerarm01`) and leave later segments at rest.** That preserves the authored
 * magnitude. If you believe a distribution is better, say so in your report and implement the
 * decided one anyway.
 *
 * NOT TESTED:
 *   - That fixing the binding makes the figure LOOK right. It removes a silent skip; the eulers were
 *     tuned for a different rig's rest pose and may need re-tuning. A pixel grade is required and is
 *     the orchestrator's, not this contract's.
 *   - `seated`. Same class, different map, not measured here.
 *   - The other five recast stations, ungraded at the time of writing.
 *   - Whether `pelvis` should map to `root`, `spine01`, or `pelvis.L`+`pelvis.R`. Genuinely open.
 *
 * ## FIXED (#492)
 *
 * The premise was false. The supine map already binds 17/17 on the recast body AT RUNTIME:
 * `supine-pose.ts` resolves each key through `resolvePoseBone` (#306), which aliases the canonical
 * landmarks onto the MakeHuman rig — `pelvis→root`, `spine→spine03`, `chest→spine01`,
 * `thighL→upperleg01L`, `shinL→lowerleg01L`, `upper_armL→upperarm01L`, `forearmL→lowerarm01L`,
 * `handL→wristL`, `neck→neck01`, plus `footL`/`footR`/`head` by identity. Verified 17/17 on
 * `mpfb-gown-adult-patient.glb` against BOTH `src` and `dist` of the resolver, and on the Anny
 * known-good.
 *
 * The RED measured LITERAL name presence — the GLB has no joint literally named `pelvis`, `spine`,
 * `chest`, etc. (those are segmented), which is NOT how the runtime binds. Clause (1) was therefore
 * rewritten to measure `resolvePoseBone`, the actual binding path, and flipped `it.fails` -> `it`.
 * The literal-name table above is retained as the measured record.
 *
 * The crumpled-mass pixels are a DIFFERENT bug: the eulers were tuned for the Anny rest pose and the
 * on-back root basis was authored for the 23-bone rig. Re-tuning is a separate, pixel-graded slice —
 * not a binding fix. No product behaviour changed here.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const GENERATED = pathResolve(HERE, "../../../apps/ui-xr/public/generated-humanoids");
const SUPINE_POSE_SRC = pathResolve(HERE, "../../../apps/ui-xr/src/supine-pose.ts");

/** The 17 keys of SUPINE_BONE_EULERS as authored. */
const SUPINE_MAP_BONES = [
  "pelvis", "spine", "chest", "thighL", "thighR", "shinL", "shinR", "footL", "footR",
  "upper_armL", "upper_armR", "forearmL", "forearmR", "handL", "handR", "neck", "head",
] as const;

/** Bodies a supine-posed patient is cast on today. */
const SUPINE_TARGET = "mpfb-gown-adult-patient.glb";
const ANNY_KNOWN_GOOD = "ed_chest_pain_adult_cast.glb";

/** three.js strips dots when binding (`PropertyBinding.sanitizeNodeName`) — SS6v. */
const sanitise = (n: string): string => n.replace(/\./g, "");

async function jointNames(file: string): Promise<string[]> {
  const doc = await new NodeIO().read(join(GENERATED, file));
  return (doc.getRoot().listSkins()[0]?.listJoints() ?? []).map((j) => sanitise(j.getName() ?? ""));
}

async function bindReport(file: string): Promise<{ joints: number; bound: string[]; missing: string[] }> {
  const names = new Set(await jointNames(file));
  // The runtime does NOT match literal names — `supine-pose.ts` resolves each map key through
  // `resolvePoseBone` (#306), which aliases the canonical landmarks onto the MakeHuman rig.
  // Measure BINDING the way the runtime does, not literal name presence.
  const resolved = SUPINE_MAP_BONES.map((b) => resolvePoseBone(b, names));
  return {
    joints: names.size,
    bound: SUPINE_MAP_BONES.filter((_, i) => resolved[i] !== null),
    missing: SUPINE_MAP_BONES.filter((_, i) => resolved[i] === null),
  };
}

describe("the supine map binds the rig it poses", () => {
  it("(1) the supine map binds on the body supine patients are cast on", async () => {
    const r = await bindReport(SUPINE_TARGET);
    expect(
      r.missing,
      `${SUPINE_TARGET} has ${r.joints} joints and the supine map binds ${r.bound.length}/`
        + `${SUPINE_MAP_BONES.length}. The unbound eulers SILENTLY SKIP, so the on-back root rotation\n`
        + `  lays down a body whose joints were never posed.\n  bound: ${r.bound.join(", ")}`,
    ).toEqual([]);
  });

  it("(2) COUNTERWEIGHT: the map still carries all 17 authored bones", async () => {
    // Refuses (b). Deleting the unbindable entries raises the ratio to 3/3 and poses nothing —
    // the ratio must be measured against the map's FULL authored size.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(SUPINE_POSE_SRC, "utf8");
    for (const bone of SUPINE_MAP_BONES) {
      expect(src.includes(`["${bone}"`), `SUPINE_BONE_EULERS must still author "${bone}"`).toBe(true);
    }
  });

  it("(3) COUNTERWEIGHT: the Anny body still binds 17/17", async () => {
    // The known-good column, and the thing a careless alias refactor would break. It still ships as
    // a fallback even though no cast resolves to it (L7 retires the file).
    const r = await bindReport(ANNY_KNOWN_GOOD);
    expect(r.missing, `${ANNY_KNOWN_GOOD} is the rig this map was authored against`).toEqual([]);
    expect(r.joints, "the Anny rail is 23 joints").toBeLessThan(30);
  });

  it("(4) VACUITY GUARD: both bodies ship and expose skins", async () => {
    const files = readdirSync(GENERATED).filter((n) => n.endsWith(".glb"));
    expect(files, "the recast target must ship").toContain(SUPINE_TARGET);
    expect(files, "the known-good must still ship").toContain(ANNY_KNOWN_GOOD);
    expect((await jointNames(SUPINE_TARGET)).length, "MPFB rig").toBeGreaterThan(100);
    expect((await jointNames(ANNY_KNOWN_GOOD)).length, "Anny rig").toBeGreaterThan(10);
  });
});
