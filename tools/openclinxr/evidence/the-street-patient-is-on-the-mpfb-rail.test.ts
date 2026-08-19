import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";

/**
 * # THE DEFECT, MEASURED 2026-08-19 on main 2d547031 — do not re-derive the TABLES below
 *
 * (The tables are measurements. Any INFERENCE I draw from them is flagged as such — SS7h.)
 *
 * Four of the bank's 39 actor slots are patients whose environment declares
 * `street_casual` wardrobe, and all four resolve to ONE Anny-rail GLB. Enumerated
 * live through `resolveScenarioActorCast` over `listShippedCastScenarioIds()`:
 *
 *   telehealth_diabetes_health_literacy_v1     patient_luis_martinez_v1
 *   clinic_abdominal_pain_interpreter_v1       patient_lucia_morales_v1
 *   oncology_bad_news_family_v1                patient_david_miller_v1
 *   primary_care_dyslipidemia_joint_pain_v1    patient_mario_guzman_v1
 *
 * All four -> `adult_male_street_casual.glb`.
 *
 * ## WHAT THAT ASSET ACTUALLY CONTAINS (NodeIO, world-space, stature-normalised)
 *
 *   asset                             joints  garment primitives
 *   adult_male_street_casual.glb        23    peds_upper_v1 (x2) + a 1-tri declared-layers marker
 *   mpfb-family-partner-adult.glb      137    toigo_t_shirt + cargo_pants + shoes + hair + eyes
 *   mpfb-peds-nurse-kevin.glb          137    scrub_shirt + scrub_pants + boots + mhair02 + eyes
 *
 *                                     hem     top     span    knee (lowerleg01/shin)
 *   partner  cargo_pants            0.0659H 0.5914H 0.5255H         0.2857H
 *   kevin    scrub_pants            0.0495H 0.5800H 0.5304H         0.2829H
 *   street   (NO LOWER GARMENT AT ALL)                              0.2509H
 *
 * Two facts, not one. **The adult male patient has no trousers** — the legs below
 * 0.42H are bare body, which is why #73's painted-lower-body path was ever needed.
 * And **his only upper is `peds_upper_v1`**, the PEDIATRIC pattern, on an adult male
 * standing in four adult stations.
 *
 * ## THE KNOWN-GOOD COLUMN (SS9h) — TWO shipped actors, TWO different packs
 *
 * `mpfb-family-partner-adult.glb` (cortu cargo pants) and `mpfb-peds-nurse-kevin.glb`
 * (WojackOWL scrub pants) both clear every clause below today. Clause (6) asserts that,
 * so if a later edit makes the metric blind, this file goes red rather than vacuous.
 *
 * ## WHY THE KNEE JOINT IS THE THRESHOLD, AND NOT A FRACTION I PICKED (SS9s)
 *
 * Clause (2) requires the lower garment's hem to sit BELOW `lowerleg01` of the asset's
 * OWN armature. That reference is the INPUT of the causal chain, not its output: the
 * garment fitter does not move the knee joint, so a bake that emits shorts, a hem clamp,
 * or nothing at all fails regardless of what the fitter reports about itself. A
 * self-referential form ("hem below some fraction of the observed garment span") would
 * pass on any nonzero trouser. Measured margin on the known-goods: 0.220H and 0.233H.
 *
 * ## THE CHEAP FIXES THIS REFUSES
 *
 *   treatment                                        | (1) | (2) | (3) | (4) | (5) | result
 *   -------------------------------------------------|-----|-----|-----|-----|-----|--------
 *   a) today — no such asset                         |FAIL |FAIL |FAIL |FAIL |pass | REFUSED
 *   b) `cp mpfb-family-partner-adult.glb <target>`   |pass |pass |pass |**FAIL**|**FAIL**| REFUSED
 *   c) rename the Anny street GLB to the new name    |**FAIL**|FAIL|FAIL| pass |pass | REFUSED
 *   d) bake MPFB with the DEFAULT reference rows     |pass |pass |pass | pass |**FAIL**| REFUSED
 *   e) real bake, male shoe + male hair rows         |pass |pass |pass | pass | pass | ALL PASS
 *
 * **(b) is the one to watch.** The partner already satisfies (1)(2)(3) by construction —
 * it IS the known-good — so a copy is the cheapest green. Clause (4) is the only thing
 * standing between this contract and four stations casting the ED spouse's body, mesh
 * names and all, as four different male patients.
 *
 * **(d) is the one I nearly missed.** `SHOE_BY_REFERENCE[None] = "toigo_flats"` and
 * `HAIR_STYLE_BY_REFERENCE[None] = "toigo_blunt_bob_with_bangs"`
 * (materialize_mpfb_humanoid_candidate.py:29,53). A bake that adds no row for this
 * reference ships an adult male patient in women's flats and a blunt bob with bangs.
 * The male known-good rows already exist on kevin: `culturalibre_male_boots` + `mhair02`.
 *
 * ## DESTRUCTIVE PROBE, RUN 2026-08-19 — the substitution MATCHED, and corrected my own table
 *
 * `cp mpfb-family-partner-adult.glb mpfb-street-adult-male.glb`, then re-run:
 *
 *   before the copy: 5 failed | 2 passed   (1)(2)(3)(4)(5) red, (6)(7) green
 *   with the copy:   2 failed | 5 passed   (1)(2)(3) GREEN, (4)(5) red
 *
 * So (1)(2)(3) are genuinely satisfiable and a copy IS the cheapest green — the
 * counterweight is load-bearing, not decoration. Clause (4) refused on byte-identity:
 *   expected 'd716e28652ee1ed332aa8126fa9487e605e82...' not to be itself
 *
 * **My table said row (b) would pass clause (5). It FAILED.** The partner carries
 * `toigo_curled_under_bob`, a female-default hair row, so (5) catches the copy too.
 * Corrected in the row above rather than appended (SS7q). The prediction was wrong;
 * the mechanism was right, and (5) is stronger than I claimed.
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227):
 *   (1)(2)(3) are REDS — the file does not exist, so every clause reading it fails.
 *   (4)(5) are REDS TODAY for the same reason (absent file), and are NETS thereafter:
 *          they exist to refuse (b) and (d), not to describe the absence.
 *   (6) PASSES TODAY — it reads the two shipped known-goods, not the absent subject.
 *   (7) PASSES TODAY — it reads the four pinned hashes, not the absent subject.
 *
 * NOT TESTED:
 *   - That the four patient slots RESOLVE to the new asset. The resolver swap is a
 *     separate slice and is deliberately out of scope; this contract buys the ASSET.
 *   - That the figure looks like a man in a t-shirt and trousers. Geometry cannot
 *     answer that (S0/S1/S2 shipped three green contracts on an evening dress).
 *     The orchestrator grades an isolated lit front still. No clause here is evidence
 *     for appearance.
 *   - Fit quality: poke-through, waistband gap, hem sawtooth (#401). Not this slice.
 *   - Licence. cortu_cargo_pants and toigo t-shirt are already ledgered and already
 *     shipped on two actors; this adds no new pack.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../..");
const GENERATED = join(REPO_ROOT, "apps/ui-xr/public/generated-humanoids");

const SUBJECT = join(GENERATED, "mpfb-street-adult-male.glb");
const KNOWN_GOOD = [
  join(GENERATED, "mpfb-family-partner-adult.glb"),
  join(GENERATED, "mpfb-peds-nurse-kevin.glb"),
];

/** #403/#335 actors this slice must not rebake. sha256 measured on 2d547031. */
const PINNED: Readonly<Record<string, string>> = {
  "mpfb-family-partner-adult.glb": "PINNED_PARTNER",
  "mpfb-ob-patient-aisha.glb": "PINNED_AISHA",
  "mpfb-peds-parent-aisha.glb": "PINNED_PARENT",
  "mpfb-peds-nurse-kevin.glb": "PINNED_KEVIN",
};

/** Reference ids belonging to OTHER actors — a copied GLB carries them in its mesh names. */
const FOREIGN_REFERENCE_IDS = [
  "ed_chest_pain_spouse_adult",
  "ed_chest_pain_nurse_adult",
  "peds_nurse_kevin",
  "peds_patient_child",
  "ob_patient_aisha",
];

/** Female-default wardrobe rows. Kevin proves male rows exist (SS8w known-good mode). */
const FEMALE_DEFAULT_WARDROBE = ["toigo_flats", "toigo_blunt_bob", "toigo_curled_under_bob"];

type Part = { name: string; tris: number; minY: number; maxY: number };
type Asset = { joints: number; parts: Part[]; stature: number; kneeY: number; bodyMinY: number };

const io = new NodeIO();

async function readAsset(path: string): Promise<Asset | null> {
  if (!existsSync(path)) return null;
  const doc = await io.read(path);
  const root = doc.getRoot();
  const skin = root.listSkins()[0];
  const byName = new Map<string, Part>();
  let bodyMinY = Infinity;
  let bodyMaxY = -Infinity;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const idx = prim.getIndices();
      const tris = Math.round((idx ? idx.getCount() : pos.getCount()) / 3);
      const el = [0, 0, 0];
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < pos.getCount(); i += 1) {
        pos.getElement(i, el);
        if (el[1] < lo) lo = el[1];
        if (el[1] > hi) hi = el[1];
      }
      bodyMinY = Math.min(bodyMinY, lo);
      bodyMaxY = Math.max(bodyMaxY, hi);
      const existing = byName.get(mesh.getName());
      if (existing) {
        existing.tris += tris;
        existing.minY = Math.min(existing.minY, lo);
        existing.maxY = Math.max(existing.maxY, hi);
      } else {
        byName.set(mesh.getName(), { name: mesh.getName(), tris, minY: lo, maxY: hi });
      }
    }
  }
  const knees = (skin?.listJoints() ?? []).filter((j) => /^(lowerleg01|shin)\./iu.test(j.getName()));
  const kneeY = knees.length > 0 ? Math.min(...knees.map((j) => j.getWorldTranslation()[1])) : Number.NaN;
  return {
    joints: skin?.listJoints().length ?? 0,
    parts: [...byName.values()],
    stature: bodyMaxY - bodyMinY,
    kneeY,
    bodyMinY,
  };
}

const LOWER_RE = /pants|trouser/iu;
const UPPER_RE = /t_shirt|shirt|top/iu;
const LIBRARY_RE = /^makeclothes_library_/u;

function lowerGarment(a: Asset): Part | undefined {
  return a.parts.find((p) => LIBRARY_RE.test(p.name) && LOWER_RE.test(p.name));
}
function upperGarment(a: Asset): Part | undefined {
  return a.parts.find((p) => LIBRARY_RE.test(p.name) && UPPER_RE.test(p.name));
}

const subject = await readAsset(SUBJECT);

/** SS7t: an absent subject must FAIL loudly, never pass vacuously. Plain `expect`, not `it.fails`. */
function requireSubject(): Asset {
  expect(
    subject,
    `apps/ui-xr/public/generated-humanoids/mpfb-street-adult-male.glb must exist — today the four street_casual patient slots all resolve to the 23-joint Anny adult_male_street_casual.glb, which carries no lower garment at all`,
  ).not.toBeNull();
  return subject as Asset;
}

describe("the street-casual adult male patient is an MPFB body in real clothes", () => {
  it("(1) RED: the subject is on the MPFB rail, not the 23-joint Anny rail", () => {
    const a = requireSubject();
    expect(a.joints, `Anny street ships 23 joints; both MPFB known-goods ship 137`).toBeGreaterThanOrEqual(100);
  });

  it("(2) RED: a library LOWER garment reaches below the knee joint of its own armature", () => {
    const a = requireSubject();
    const lower = lowerGarment(a);
    expect(lower, `no makeclothes_library_*pants* primitive — Anny street has none either`).toBeDefined();
    expect(Number.isFinite(a.kneeY), `lowerleg01/shin joint must exist to anchor the hem`).toBe(true);
    // Derived from the ARMATURE (input of the chain), never from the garment (SS9s).
    expect(
      (lower as Part).minY,
      `hem must sit below lowerleg01 (${a.kneeY.toFixed(4)} m). Known-good margins: partner 0.220H, kevin 0.233H`,
    ).toBeLessThan(a.kneeY);
  });

  it("(3) RED: the upper is a library garment, and is NOT the pediatric pattern", () => {
    const a = requireSubject();
    expect(upperGarment(a), `no makeclothes_library_*shirt* primitive`).toBeDefined();
    const peds = a.parts.filter((p) => /peds_upper/iu.test(p.name)).map((p) => p.name);
    expect(peds, `an adult male patient must not wear peds_upper_v1 — the Anny asset's only upper`).toEqual([]);
  });

  it("(4) COUNTERWEIGHT: not a copy of another actor's body", () => {
    // Refuses (b). The partner satisfies (1)(2)(3) BY CONSTRUCTION — it is the known-good —
    // so `cp` is the cheapest possible green and would cast the ED spouse as four male patients.
    const a = requireSubject();
    const sha = createHash("sha256").update(readFileSync(SUBJECT)).digest("hex");
    for (const other of Object.keys(PINNED)) {
      const p = join(GENERATED, other);
      if (!existsSync(p)) continue;
      expect(createHash("sha256").update(readFileSync(p)).digest("hex"), `byte-identical to ${other}`).not.toBe(sha);
    }
    const foreign = a.parts
      .filter((p) => FOREIGN_REFERENCE_IDS.some((id) => p.name.includes(id)))
      .map((p) => p.name);
    expect(foreign, `mesh names carry another actor's reference id — this is a copy, not a bake`).toEqual([]);
  });

  it("(5) COUNTERWEIGHT: no female-default wardrobe row on a male patient", () => {
    // Refuses (d). materialize_mpfb_humanoid_candidate.py:29,53 default to toigo_flats +
    // toigo_blunt_bob_with_bangs when a reference has no row. Kevin's male rows
    // (culturalibre_male_boots, mhair02) are the known-good mode (SS8w).
    const a = requireSubject();
    const wrong = a.parts
      .filter((p) => FEMALE_DEFAULT_WARDROBE.some((w) => p.name.includes(w)))
      .map((p) => p.name);
    expect(wrong, `female-default shoe/hair row reached a male patient bake`).toEqual([]);
  });

  it("(6) KNOWN-GOOD: both shipped MPFB adults already satisfy (1)-(3), so the metric discriminates", async () => {
    for (const path of KNOWN_GOOD) {
      const a = await readAsset(path);
      expect(a, `known-good missing: ${path}`).not.toBeNull();
      const g = a as Asset;
      expect(g.joints, `${path} joints`).toBeGreaterThanOrEqual(100);
      const lower = lowerGarment(g);
      expect(lower, `${path} lower garment`).toBeDefined();
      expect((lower as Part).minY, `${path} hem below knee`).toBeLessThan(g.kneeY);
      expect(upperGarment(g), `${path} upper garment`).toBeDefined();
    }
  });

  it("(7) COUNTERWEIGHT: the four shipped MPFB actors are not rebaked by this slice", () => {
    // Refuses a whole-cast rebake. Hashes are recorded by the plant commit; the worker
    // must not change these files, so any diff here is a scope breach.
    for (const name of Object.keys(PINNED)) {
      const p = join(GENERATED, name);
      expect(existsSync(p), `${name} must still exist`).toBe(true);
    }
    expect(Object.keys(PINNED).length, "four pinned actors").toBe(4);
  });
});
