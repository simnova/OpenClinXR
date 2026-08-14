import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Accessor, NodeIO } from "@gltf-transform/core";
import { cloneDocument } from "@gltf-transform/functions";
import { describe, expect, it } from "vitest";
import { isFittedNonBodyName } from "./garment-slot.ts";

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
 *
 * ## FIXED (#318)
 *
 * `materialize_mpfb_humanoid_candidate.py` now calls the MPFB-shipped
 * `ExportService.bake_modifiers_remove_helpers(basemesh, remove_helpers=True)` (exportservice.py:79)
 * AFTER the face targets load (load order is load-bearing — face keys must load on the full base
 * topology, body_param_stage #221 A2). The bake's own census printed
 * `HELPER_STRIP verts 19158 -> 13380; tris 36972 -> 26756` — both endpoints exactly the MADR 0052
 * documented pair. Measured from the shipped GLB after the fix (NodeIO):
 *
 *   mpfb-ob-patient-aisha.glb   14,762 verts   26,756 tris   2 primitives   137 joints
 *   usable mouth targets: mouth-compression, mouth-corner-puller, mouth-depression-retraction,
 *   mouth-elevation, mouth-eversion, mouth-open, mouth-parling, mouth-part-later, mouth-protusion,
 *   mouth-pursing, mouth-retraction, mouth-upward-retraction  (13, unchanged from #317)
 *
 * The `it.fails` marker on (1) was flipped to `it`; all four clauses pass on the stripped asset.
 * The post-strip figure is an unclothed body — wardrobe staging for an OB triage patient is MADR
 * 0052 P3, untouched here.
 *
 * ## SCOPED (#321) — measurement, not bound
 *
 * #321 fits a real MakeHuman garment (toigo t-shirt via ClothesService) onto the stripped body, and
 * the garment test's own counterweight (3) governs TOTAL triangles at 40,000 (`MAX_BODY_TRIS +
 * 12_000` — the orchestrator wrote it knowing a garment adds tris; no garment with >= 500 verts
 * fits under the 1,244-tris headroom left by the 28,000 bound). Clause (1) below therefore measures
 * BODY triangles only: it excludes primitives whose material names a garment, so the net keeps its
 * exact discriminator — with-helpers body (36,972) still fails, stripped body (26,756) still passes —
 * while the fitted garment's triangles are asserted by mpfb2-actor-wears-a-fitted-garment.test.ts
 * counterweight (3). The bound itself is unchanged.
 *
 * ## FIXED (#391) — slot-keyed classification replaces the name-keyed vocabulary
 *
 * The GARMENT_MATERIAL regex (`/garment|clothing|shirt|pants|trouser|tshirt|scrub|gown|makeclothes/i`)
 * counted everything it could not name as body, so #381's fitted hair
 * (`openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_mpfb_ob_patient_aisha_mat`, 4,976 tris) was
 * attributed to the body: 31,732 > 28,000. The classifier now lives in the shared `garment-slot.ts`
 * module (#389) and keys on the ROLE/rail, not the name: a makeclothes library garment of any slot
 * (the rail gate `isUpperGarmentName` already uses) or fitted hair (`isFittedHairMeshName`, #394 —
 * imported, not a third vocabulary) is non-body; everything else is body. A new garment style or
 * hairstyle matches with no list edit — the third name-keyed matcher this night broke.
 *
 * Measured on the shipped bytes with the new classifier: body = 26,756 — the documented stripped
 * count, hair and garments excluded. The destructive probe rebuilds the with-helpers state (36,972)
 * on top of it and the RED still fails, so the net keeps its exact discriminator.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const AISHA = `${REPO_ROOT}/apps/ui-xr/public/generated-humanoids/mpfb-ob-patient-aisha.glb`;

/** MADR 0052: helper-stripped is 26,756 tris. Headroom for scalp / material-region variation. */
const MAX_TRIANGLES = 28_000;
/** MADR 0052 documented pair: with helpers / stripped. The probe rebuilds both endpoints. */
const WITH_HELPERS_TRIANGLES = 36_972;
const STRIPPED_TRIANGLES = 26_756;
const MOUTH_NAME = /mouth|lip|jaw|viseme/i;
const MOVED_EPSILON_M = 1e-5;
const MIN_USABLE_MOUTH_TARGETS = 13;
const MAX_MOVED_FRACTION = 0.5;

const io = new NodeIO();
const doc = await io.read(AISHA);

/**
 * Body triangles: every primitive that is not a fitted makeclothes garment (any slot)
 * or fitted hair. Slot/rail-keyed in garment-slot.ts (#389/#391) — a new garment style
 * or hairstyle matches with no list edit.
 */
function bodyTrianglesOf(target: typeof doc): number {
  let bodyTris = 0;
  for (const mesh of target.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const indices = prim.getIndices();
      const primTris = indices ? indices.getCount() / 3 : pos.getCount() / 3;
      // #321: a fitted garment is separate geometry; #391: fitted hair is not body either.
      if (!isFittedNonBodyName(prim.getMaterial()?.getName() ?? "")) {
        bodyTris += primTris;
      }
    }
  }
  return bodyTris;
}

let totalVerts = 0;
let bodyTris = 0;
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
bodyTris = bodyTrianglesOf(doc);

const joints = doc.getRoot().listSkins()[0]?.listJoints().map((j) => j.getName()) ?? [];

/** An unmeasured asset must FAIL every clause, never pass vacuously (§7t). */
function requireMeasured(): void {
  expect(totalVerts, "aisha measured at all").toBeGreaterThan(1000);
  expect(primitives, "aisha primitives found").toBeGreaterThan(0);
}

describe("the shipped MPFB2 actor is a body, not a body wearing MakeHuman fitting shells", () => {
  it(
    `(1) RED: body triangles <= ${MAX_TRIANGLES} — the helper shells are stripped`,
    () => {
      requireMeasured();
      expect(
        bodyTris,
        `aisha BODY triangles (36,972 = base.obj with helpers; 26,756 = documented stripped; garment tris excluded per #321, fitted hair per #391)`,
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

  it("(5) DESTRUCTIVE PROBE: an unstripped helper shell is still counted as body — the with-helpers count still fails the RED", () => {
    // Helpers are body-ish shells (skin-region geometry), not makeclothes garments and not fitted
    // hair. Rebuild the documented with-helpers state (36,972) from the stripped body (26,756) by
    // adding one helper-shell primitive; a classifier that wrongly excluded body-ish geometry —
    // or that excluded the fitted hair the wrong way — would let the known-bad pass.
    const probe = cloneDocument(doc);
    const before = bodyTrianglesOf(probe);
    expect(before, "probe starts from the documented stripped body").toBe(STRIPPED_TRIANGLES);
    const helperTris = WITH_HELPERS_TRIANGLES - STRIPPED_TRIANGLES;
    const positions = new Float32Array(helperTris * 9);
    const accessor = probe
      .createAccessor()
      .setType(Accessor.Type.VEC3)
      .setArray(positions)
      .setBuffer(probe.createBuffer());
    const helperPrim = probe.createPrimitive().setAttribute("POSITION", accessor);
    helperPrim.setMaterial(probe.createMaterial().setName("mpfb_helper_shell_mat"));
    probe.createMesh().setName("mpfb_helper_shell_mesh").addPrimitive(helperPrim);
    const after = bodyTrianglesOf(probe);
    expect(after, "with-helpers count = the documented 36,972 (stripped 26,756 + helper shell)").toBe(
      WITH_HELPERS_TRIANGLES,
    );
    expect(after, "the RED still catches the known-bad").toBeGreaterThan(MAX_TRIANGLES);
  });

  it("(6) NET: the slot classifier reads the shipped primitives by role, not by name", () => {
    // Pins the classification on the actual material names in the shipped GLB. There is no name
    // list to go stale: a fitted hair material and a makeclothes garment of ANY slot are non-body,
    // the skin and painted body regions are body.
    expect(
      isFittedNonBodyName("openclinxr_fitted_hair_toigo_blunt_bob_with_bangs_mpfb_ob_patient_aisha_mat"),
      "fitted hair is not body (#391)",
    ).toBe(true);
    expect(isFittedNonBodyName("mat_makeclothes_library_toigo_t_shirt"), "upper slot garment").toBe(true);
    expect(isFittedNonBodyName("mat_makeclothes_library_cargo_pants.001"), "lower slot garment").toBe(true);
    expect(isFittedNonBodyName("mat_makeclothes_library_footwear_toigo_flats"), "foot slot garment").toBe(true);
    expect(isFittedNonBodyName("mat_makeclothes_library_eyes_ob_patient_aisha"), "eye slot").toBe(true);
    expect(isFittedNonBodyName("mpfb_skin_ob_patient_aisha"), "body skin is body").toBe(false);
    expect(isFittedNonBodyName("openclinxr_hidden_upper_mpfb_ob_patient_aisha_body_mesh"), "painted body region is body").toBe(
      false,
    );
  });
});
