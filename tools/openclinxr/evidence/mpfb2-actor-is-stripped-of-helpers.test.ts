import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * The MPFB2 patient a learner meets is wearing MakeHuman's clothes and hair FITTING SHELLS.
 *
 * I graded her with the named renderer (`pnpm asset:model-vetting:glb-grade`, lit AND structure passes,
 * geometry self-check agreed at relative error 3.6e-4) on 2026-08-11, after #317 landed her face targets.
 * The lit pass shows a figure in a floor-length robe and a hood with flat quads across the face — no
 * visible features. The structure pass shows why, and it is the useful half (§8x): underneath sits a
 * CORRECT dense female body — real face, separated fingers, plausible proportions — with a coarse
 * low-poly shell draped over it. **This is a strip defect, not a body defect.** #301 predicted exactly
 * this render: *"a raw base grades as a figure in a long floor-length robe and a hood — those are the
 * clothes and hair helper shells, not clothing anyone authored."*
 *
 * MEASURED, and the number settles it without reference to any render:
 *
 *   mpfb-ob-patient-aisha.glb   22,154 verts   **36,972 tris**   2 primitives   137 joints
 *
 * **36,972 is exactly MADR 0052's with-helpers triangle count**, and exactly MPFB's
 * `data/3dobjs/base.obj` — 18,486 quad faces — triangulated. The documented strip takes it to
 * **26,756 tris / 13,380 verts**. Aisha matches the "before" number to the digit, from a measurement
 * taken by a different route than the one that recorded it.
 *
 * THE PROVEN TOOL EXISTS AND NOTHING CALLS IT. `ExportService.bake_modifiers_remove_helpers(basemesh,
 * bake_masks=False, bake_subdiv=False, remove_helpers=True, also_proxy=True)` is at
 * `exportservice.py:79` in the installed MPFB. Every occurrence of that name in this repo is a COMMENT
 * — including in the detector #301 landed this hour, which instructs callers to *"strip helpers in the
 * generator"* while no generator does. `materialize_mpfb_humanoid_candidate.py:30` calls
 * `bpy.ops.mpfb.create_human()`, the UI operator — the same D1 shape #317 fixed for face shape keys,
 * one line above where that fix went in.
 *
 * NOT A #317 REGRESSION, and I checked before claiming. Aisha was ~19k verts before #317 and ~22k after
 * (the delta is scalp-vs-skin material reassignment from the Z-flip fix, measured: skin 18,948 → 20,052,
 * scalp 3,082 → 2,102, total +0.6%). Both are far above 13,380. She has carried these shells since she
 * shipped; #317's claim of 13 usable mouth targets stands and is untouched here. What #317 could not
 * see — and what my deferring its pixel grade hid for an hour — is that those targets are behind a hood.
 *
 * WHERE THE THRESHOLD COMES FROM — a documented pair, not a fitted number (§9s):
 *
 *   with helpers    36,972 tris   (MADR 0052; base.obj 18,486 quads; Aisha today, exactly)
 *   stripped        26,756 tris   (MADR 0052, documented exact)
 *   bound           28,000 tris   (26,756 + ~4.6% headroom for scalp/material-region variation)
 *
 * Neither endpoint is mine. Today's value is 32% above the bound and the documented target is 4.6%
 * below it. **The pass margin is the tighter side and I am saying so rather than letting it read as
 * generous**: if a correct strip lands materially above 26,756, the bound is wrong and not the fix —
 * report that rather than trimming geometry to clear it.
 *
 * THE CHEAP FIXES THIS REFUSES, probed before planting:
 *
 *   treatment                                    | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------|-----|-----|-----|-----|--------
 *   a) today                                     |FAIL |pass |pass |pass | REFUSED
 *   b) delete the scalp primitive                |FAIL |pass |pass |**FAIL**| REFUSED
 *   c) decimate the mesh to clear the count      |pass |**FAIL**|pass|pass | REFUSED
 *   d) re-export without the armature            |pass |pass |**FAIL**|pass| REFUSED
 *   e) hand-slice vertices above index 13,380    |pass |pass |pass |pass | see below
 *   f) call bake_modifiers_remove_helpers        |pass |pass |pass |pass | ALL PASS
 *
 * (c) is the one to worry about: decimation reaches the triangle bound while destroying the morph
 * targets, so clause (2) requires the 13 usable mouth targets #317 landed to survive intact. (b) and
 * (d) are the other two ways to lose triangles without stripping anything.
 *
 * (e) PASSES THIS CONTRACT AND IS STILL FORBIDDEN, and a test cannot catch it — this is stated here
 * because the brief must carry it. MADR 0052 is explicit that 13,380 *"survives as a cross-check, not
 * a procedure"*, and a hand-rolled index slice is the exact D1 violation the curious-researcher rule
 * was founded on. The numbers in this contract are cross-checks. The mechanism must be the documented
 * service call.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1) is the RED and fails today. (2), (3) and (4) PASS today
 * on real values — 13 mouth targets, 137 joints, 2 primitives — and are what stop the fix reaching the
 * count by destroying something.
 *
 * NOT TESTED: nothing is rendered by this contract. It asserts the shells are GONE, not that what
 * remains looks right — the post-strip figure will be an unclothed body and whether that is
 * appropriate staging for an OB triage patient is a wardrobe question (P3), not this one. Whether the
 * 13 mouth targets then read as expression is untested and unrelated. No claim is made that 26,756 is
 * stable across MPFB versions.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const AISHA = `${REPO_ROOT}/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb`;

/** MADR 0052: helper-stripped is 26,756 tris. Headroom for scalp / material-region variation. */
const MAX_TRIANGLES = 28_000;
const MOUTH_NAME = /mouth|lip|jaw|viseme/i;
const MOVED_EPSILON_M = 1e-5;
const MIN_USABLE_MOUTH_TARGETS = 13;
const MAX_MOVED_FRACTION = 0.5;

const io = new NodeIO();
const doc = await io.read(AISHA);

let totalVerts = 0;
let totalTris = 0;
let primitives = 0;
let bodyVerts = 0;
let usableMouth: string[] = [];

for (const mesh of doc.getRoot().listMeshes()) {
  const targetNames = ((mesh.getExtras() as Record<string, unknown>)?.targetNames as string[]) ?? [];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    if (!pos) continue;
    primitives += 1;
    totalVerts += pos.getCount();
    const indices = prim.getIndices();
    totalTris += indices ? indices.getCount() / 3 : pos.getCount() / 3;

    if (prim.listTargets().length === 0 || pos.getCount() <= bodyVerts) continue;
    bodyVerts = pos.getCount();
    const found: string[] = [];
    const el: [number, number, number] = [0, 0, 0];
    prim.listTargets().forEach((target, index) => {
      const name = targetNames[index] ?? `#${index}`;
      if (!MOUTH_NAME.test(name)) return;
      const delta = target.getAttribute("POSITION");
      if (!delta) return;
      let moved = 0;
      for (let i = 0; i < delta.getCount(); i += 1) {
        const [dx, dy, dz] = delta.getElement(i, el);
        if (Math.hypot(dx!, dy!, dz!) > MOVED_EPSILON_M) moved += 1;
      }
      if (moved > 0 && moved / bodyVerts < MAX_MOVED_FRACTION) found.push(name);
    });
    usableMouth = found;
  }
}

const joints = doc.getRoot().listSkins()[0]?.listJoints().map((j) => j.getName()) ?? [];

/** An unmeasured asset must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(): void {
  expect(totalVerts, "aisha measured at all").toBeGreaterThan(1000);
  expect(primitives, "aisha primitives found").toBeGreaterThan(0);
}

describe("the shipped MPFB2 actor is a body, not a body wearing MakeHuman fitting shells", () => {
  it.fails(
    `(1) RED: total triangles <= ${MAX_TRIANGLES} — the helper shells are stripped`,
    () => {
      requireMeasured();
      expect(
        totalTris,
        `aisha total triangles (36,972 = base.obj with helpers; 26,756 = documented stripped)`,
      ).toBeLessThanOrEqual(MAX_TRIANGLES);
    },
  );

  it(
    `(2) NET COUNTERWEIGHT: the ${MIN_USABLE_MOUTH_TARGETS} usable mouth targets #317 landed survive — decimation is refused`,
    () => {
      requireMeasured();
      expect(usableMouth.length, `usable mouth targets: ${usableMouth.join(", ")}`).toBeGreaterThanOrEqual(
        MIN_USABLE_MOUTH_TARGETS,
      );
    },
  );

  it("(3) NET COUNTERWEIGHT: the rig survives — dropping the armature is refused", () => {
    requireMeasured();
    expect(joints.length, "skin joints").toBeGreaterThanOrEqual(137);
    const hands = joints.filter((n) => /hand|wrist|finger|thumb/i.test(n));
    expect(hands.length, `hand/finger joints: ${hands.length}`).toBeGreaterThanOrEqual(30);
  });

  it("(4) NET COUNTERWEIGHT: both primitives survive — deleting the scalp is refused", () => {
    requireMeasured();
    expect(primitives, "primitives (body + scalp material region)").toBeGreaterThanOrEqual(2);
  });
});
