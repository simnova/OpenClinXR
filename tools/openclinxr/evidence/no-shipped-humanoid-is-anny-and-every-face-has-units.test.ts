import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { scenarioBank } from "../../../packages/openclinxr/scenario-fixtures/src/scenario-bank.js";
import {
  ED_ADULT_CAST_RUNTIME_PATH,
  MPFB_GOWN_ADULT_PATIENT_RUNTIME_PATH,
  resolveHumanoidVariantOrCastPath,
  resolveLocalHumanoidRuntimeAssetUrl,
} from "../../../apps/ui-xr/src/humanoid-runtime-asset-url.js";

/**
 * #652 — the runtime resolver must never emit an Anny-derived humanoid, and every
 * humanoid face it does emit must carry FACS units.
 *
 * ## THE DEFECT, MEASURED — IMMUTABLE
 *
 * CENSUS 2026-08-29 (NodeIO over every GLB in `apps/ui-xr/public/generated-humanoids/`
 * plus the resolver's candidate paths). The Anny rail is 23 joints, has NO jaw, and its
 * 25 morph targets are viseme_* / openclinxr_* emotion morphs — zero MakeHuman FACS
 * face keys. The MPFB2 rail is 137 joints with a jaw and 31 FACS face keys
 * (`eye-*`, `eyebrows-*`, `mouth-*`, `nose-*`, `neck-platysma`).
 *
 *   rail      | joints | jaw | FACS face keys | sample face morphs
 *   ----------|--------|-----|----------------|------------------------------------------
 *   Anny      |   23   | no  |       0        | viseme_AA, brow_raise, eye_blink_l, smile
 *   MPFB2     |  137   | yes |      31        | eye-left-closure, eyebrows-left-up, mouth-open
 *   hm08 LIB  |   64   | no  |      31        | eye-left-closure, mouth-compression (basemesh)
 *
 * EIGHT Anny GLBs ship under generated-humanoids/. SEVEN have MPFB2 counterparts the
 * cast path already resolves; the ED cast's last Anny literal is `ed_chest_pain_adult_cast.glb`,
 * whose counterpart is the gowned MPFB patient (#491 L6). `peds_fever_patient_child.glb`
 * is resolved by no cast row (peds child patients pool to mpfb-peds-patient-child.glb).
 *
 *   Anny GLB                          | MPFB2 counterpart
 *   ----------------------------------|----------------------------------------------
 *   ed_chest_pain_adult_cast.glb      | mpfb-gown-adult-patient.glb  (#491 L6)
 *   ed_chest_pain_nurse_adult.glb     | mpfb-clinical-nurse-adult.glb  (#403)
 *   ed_chest_pain_spouse_adult.glb    | mpfb-family-partner-adult.glb  (#403/#479)
 *   peds_anxious_parent.glb           | mpfb-peds-parent-aisha.motion-bind.glb  (#557)
 *   peds_nurse_kevin.glb              | mpfb-peds-nurse-kevin.glb  (#335)
 *   peds_patient_child.glb            | mpfb-peds-patient-child.glb  (#335)
 *   adult_male_street_casual.glb      | mpfb-street-adult-male.glb  (#444)
 *
 * MEASURED BEFORE THIS SLICE, the resolver still emitted Anny paths:
 *
 *   - `ED_ADULT_CAST_RUNTIME_PATH` was the literal
 *     `/generated-humanoids/ed_chest_pain_adult_cast.glb` (ED fallback + defense rows).
 *   - `resolveLocalHumanoidRuntimeAssetUrl` mapped all seven Anny blob names to
 *     THEMSELVES — and shipped bundles still carry them, e.g. the
 *     `adult_abdominal_pain_v1` bundle names all three ED Anny GLBs as actor blobs.
 *
 * This slice repoints the ED fallback and remaps every Anny blob name to its MPFB2
 * counterpart (`humanoid-runtime-asset-url.ts` ANNY_TO_MPFB_RUNTIME_PATH). It does NOT
 * delete the Anny GLB files — they stay as comparators (#491/#652), which is why
 * clause (5) asserts they still ship.
 *
 * ## KNOWN-GOOD COLUMN (§9h)
 *
 * mpfb-gown-adult-patient.glb (the ED patient body, #491): 138 joints, jaw present,
 * 31 FACS face keys + 16 visemes. mpfb-street-adult-male.glb and the other six
 * counterparts measured identically (137 joints / 31 FACS keys).
 *
 * ## WHICH ARE REDS AND WHICH ARE NETS (#227)
 *
 * (3) and (4) are the REDs — both fail today because the resolver still emits Anny
 * paths. (1), (2), (5) and (6) pass today and exist so the migration cannot regress:
 * (1) pins the cast surface, (2) pins the FACS gate on every resolved file, (5) refuses
 * a "fix" that deletes the comparators, (6) is the vacuity guard.
 *
 * NOT TESTED:
 *   - The URL-gated cagematch comparators in main.ts (/cagematch/..., e.g.
 *     peds_anny_real_garment_patient) — harness overrides, not the default cast.
 *   - The neutral-generated-human.glb fixture fallback for non-humanoid actors
 *     (system/phone/tablet) — those actors are not rendered as humanoids.
 *   - The two hm08 body-param library exports (LIBRARY_ADULT_*_RUNTIME_PATH): no cast
 *     row emits them; they are MakeHuman basemesh with FACS units and stay candidate-layer.
 *   - Anatomical correctness, triangle budget, or garment fit on the swapped bodies.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");
const CANDIDATES = join(REPO_ROOT, "apps/ui-xr/public/xr-assets/humanoids/candidates");

/** Anny-era GLB names the runtime must never resolve to. */
const ANNY_GLB_NAMES = [
  "ed_chest_pain_adult_cast.glb",
  "ed_chest_pain_nurse_adult.glb",
  "ed_chest_pain_spouse_adult.glb",
  "peds_anxious_parent.glb",
  "peds_fever_patient_child.glb",
  "peds_nurse_kevin.glb",
  "peds_patient_child.glb",
  "adult_male_street_casual.glb",
] as const;

/** MPFB2 FACS face-key naming (MakeHuman face units). Anny GLBs carry zero of these. */
const FACS_FACE_KEY = /^(eye-|eyebrows-|mouth-|nose-|neck-platysma)/iu;
const MIN_FACS_UNITS = 20;

type ResolvedRow = { scenarioId: string; actorId: string; role: string; path: string };

/** Mirrors the runtime's own non-humanoid filtering (system / virtual devices). */
function isHumanoidEmbodiedActor(actor: { actorId: string; role: string }): boolean {
  if (actor.role.toLowerCase() === "system") return false;
  if (/_phone_|_tablet_|telehealth_system/iu.test(actor.actorId)) return false;
  return true;
}

/** Every shipped scenario actor with a humanoid embodiment, through the cast SSOT. */
function resolvedHumanoidRows(): ResolvedRow[] {
  const rows: ResolvedRow[] = [];
  for (const scenario of scenarioBank) {
    for (const actor of scenario.actors ?? []) {
      if (!isHumanoidEmbodiedActor(actor)) continue;
      rows.push({
        scenarioId: scenario.scenarioId,
        actorId: actor.actorId,
        role: actor.role,
        path: resolveHumanoidVariantOrCastPath({
          scenarioId: scenario.scenarioId,
          actorId: actor.actorId,
          role: actor.role,
          fallbackPath: "/xr-assets/humanoids/neutral-generated-human.glb",
        }),
      });
    }
  }
  return rows;
}

async function faceUnitsOf(relPath: string): Promise<{ facsUnits: number; hasJaw: boolean } | null> {
  const abs = join(REPO_ROOT, relPath);
  if (!existsSync(abs)) return null;
  const doc = await new NodeIO().read(abs);
  const joints = doc.getRoot().listSkins()[0]?.listJoints().map((j) => j.getName() ?? "") ?? [];
  const facs = new Set<string>();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const target of prim.listTargets()) {
        const name = target.getName() ?? "";
        if (FACS_FACE_KEY.test(name)) facs.add(name);
      }
    }
  }
  return { facsUnits: facs.size, hasJaw: joints.includes("jaw") };
}

describe("no shipped humanoid is Anny-derived and every face has FACS units", () => {
  it("(1) RED: no shipped scenario resolves a humanoid actor to an Anny-derived GLB", () => {
    const rows = resolvedHumanoidRows();
    expect(rows.length, "humanoid cast rows enumerated from scenarioBank").toBeGreaterThanOrEqual(10);
    const offenders = rows.filter((r) => ANNY_GLB_NAMES.some((n) => r.path.includes(n)));
    expect(offenders, "humanoid actors resolving to an Anny GLB").toEqual([]);
    const nonMpfb = rows.filter((r) => !r.path.includes("mpfb"));
    expect(nonMpfb, "resolved paths outside the mpfb rail").toEqual([]);
  });

  it("(2) RED: every runtime-resolved humanoid face carries FACS units and the MPFB jaw", async () => {
    const distinct = [...new Set(resolvedHumanoidRows().map((r) => r.path))];
    expect(distinct.length, "distinct runtime-resolved humanoid paths").toBeGreaterThanOrEqual(6);
    const broken: string[] = [];
    for (const p of distinct) {
      // Runtime paths are public URLs rooted at apps/ui-xr/public.
      const rel = p.replace(/^\//u, "");
      const abs = join(REPO_ROOT, "apps/ui-xr/public", rel);
      if (!existsSync(abs)) {
        broken.push(`${p}: file missing from this tree`);
        continue;
      }
      const face = await faceUnitsOf(join("apps/ui-xr/public", rel));
      if (!face) {
        broken.push(`${p}: unreadable`);
        continue;
      }
      if (!face.hasJaw) broken.push(`${p}: no jaw joint (Anny rail marker)`);
      if (face.facsUnits < MIN_FACS_UNITS) {
        broken.push(`${p}: ${face.facsUnits} FACS face keys (< ${MIN_FACS_UNITS})`);
      }
    }
    expect(broken, "runtime-resolved humanoids failing the MPFB/FACS gate").toEqual([]);
  });

  it("(3) NET: the ED fallback is the gowned MPFB patient, not the Anny cast GLB", () => {
    expect(ED_ADULT_CAST_RUNTIME_PATH).toBe(MPFB_GOWN_ADULT_PATIENT_RUNTIME_PATH);
    expect(ED_ADULT_CAST_RUNTIME_PATH).not.toContain("ed_chest_pain_adult_cast.glb");
    expect(ED_ADULT_CAST_RUNTIME_PATH).toContain("mpfb");
  });

  it("(4) NET: every Anny blob name the emulator or a bundle can hand us remaps to MPFB", () => {
    const cases = [
      "generated-humanoids/ed_chest_pain_adult_cast.glb",
      "apps/ui-xr/public/generated-humanoids/ed_chest_pain_nurse_adult.glb",
      "generated-humanoids/ed_chest_pain_spouse_adult.glb",
      "generated-humanoids/peds_anxious_parent.glb",
      "generated-humanoids/peds_nurse_kevin.glb",
      "generated-humanoids/peds_patient_child.glb",
      "generated-humanoids/adult_male_street_casual.glb",
      "ed_chest_pain_adult_cast.glb",
    ];
    const bad: string[] = [];
    for (const blobName of cases) {
      const url = resolveLocalHumanoidRuntimeAssetUrl({
        kind: "humanoid_model",
        blob: { blobName },
      });
      if (ANNY_GLB_NAMES.some((n) => url.includes(n))) bad.push(`${blobName} -> ${url}`);
      if (!url.includes("mpfb")) bad.push(`${blobName} -> ${url} (not on the mpfb rail)`);
    }
    expect(bad, "Anny blob names that still resolve to Anny GLBs").toEqual([]);
  });

  it("(5) NET: the Anny comparator files still ship and every MPFB counterpart exists", () => {
    for (const n of ANNY_GLB_NAMES) {
      expect(existsSync(join(GENERATED, n)), `Anny comparator ${n} must remain shipped (not deleted)`).toBe(true);
    }
    const counterparts = [
      "mpfb-gown-adult-patient.glb",
      "mpfb-clinical-nurse-adult.glb",
      "mpfb-family-partner-adult.glb",
      "mpfb-peds-nurse-kevin.glb",
      "mpfb-peds-patient-child.glb",
      "mpfb-street-adult-male.glb",
    ];
    for (const c of counterparts) {
      expect(existsSync(join(GENERATED, c)), `MPFB counterpart ${c} must ship`).toBe(true);
    }
    expect(
      existsSync(join(CANDIDATES, "mpfb-peds-parent-aisha.motion-bind.glb")),
      "MPFB counterpart mpfb-peds-parent-aisha.motion-bind.glb must ship",
    ).toBe(true);
  });

  it("(6) VACUITY GUARD: the bank and the generated directory are both enumerable", () => {
    expect(scenarioBank.length, "scenarioBank must enumerate").toBeGreaterThanOrEqual(10);
    expect(
      readdirSync(GENERATED).filter((n) => n.endsWith(".glb")).length,
      "generated-humanoids must enumerate",
    ).toBeGreaterThanOrEqual(15);
  });
});
