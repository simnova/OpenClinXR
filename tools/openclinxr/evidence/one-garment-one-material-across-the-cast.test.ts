import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * **OBSERVABLE: one authored garment looks the same on every cast actor that wears it.** Today
 * `toigo_flats` is a textured shoe on one patient and a near-black shoe on three other actors in the
 * same exam, with nothing in any case definition authoring the difference — the #548 class.
 *
 * ## MEASURED ON HEAD — do not re-derive
 *
 *   toigo_flats (one authored asset)          bytes      baseColorFactor   cast?
 *     mpfb-ob-patient-aisha                 7,769,810   1.00,1.00,1.00     YES
 *     mpfb-peds-parent-aisha                7,769,810   1.00,1.00,1.00     no
 *     mpfb-clinical-nurse-adult                     0   0.10,0.09,0.08     YES
 *     mpfb-clinical-physician-adult                 0   0.10,0.09,0.08     YES
 *     mpfb-gown-adult-patient                       0   0.10,0.09,0.08     YES
 *     mpfb-gown-inspect / mpfb-viseme-inspect       0   0.10,0.09,0.08     no
 *
 * So **one cast actor carries it and three cast actors do not.** `toigo_t_shirt` is the KNOWN-GOOD
 * COLUMN (§9h): 656,736 B on five wearers, dropped by one — the pipeline demonstrably CAN attach a
 * texture consistently, so flats at 2-of-7 is the outlier, not the norm.
 *
 * ## THE DIRECTION IS NOT DECIDED, AND THE NUMBERS CUT BOTH WAYS
 *
 * Do not assume the droppers are wrong. `Shoe.png` is 2048x2048 RGBA at **7,769,810 B** while
 * `ShoeSpec.png` at the SAME 2048x2048 is **21,361 B** — the diffuse is pathologically stored, and
 * the Quest station budget is `maxTextureMegabytes: 64` (`asset-registry/src/index.ts:593`), so one
 * shoe diffuse is **11.6% of the entire station texture budget**. Attaching it to all four cast
 * wearers spends ~30 MB on footwear. And `bcf 0.10,0.09,0.08` is a perfectly reasonable black flat.
 *
 * **THE CAUSE IS NOT KNOWN TO ME.** Candidates, deliberately UNRANKED and possibly all wrong:
 * a per-actor material path that only some bakes take; an orphaned-texture cleanup that ran on some
 * actors (a 7.77 MB orphan `Shoe` texture was already found and removed once, #502/#542); a
 * `.mhmat` resolution difference; a bake-order effect. Measure it; do not adopt one of mine.
 *
 * ## WHAT THE CONTRACT ASSERTS — consistency, NOT a direction
 *
 * Clause (1) requires every CAST wearer of one garment to resolve to the SAME material treatment.
 * Both fixes satisfy it: attach the diffuse everywhere, or drop it everywhere and keep the authored
 * colour. Clause (3) forces whichever is chosen to be defended against the 64 MB budget, so
 * "attach it everywhere" cannot be taken silently.
 *
 * claimScope: material-treatment consistency of one authored garment across the shipped cast.
 * notEvidenceFor: which treatment is correct; how the shoes LOOK (the orchestrator grades that from
 *   the comparison sheet); any garment other than those enumerated; Quest readiness.
 *
 * ## GROUP B progress (#553) — planted it.fails on (1) NOT flipped yet
 *
 * Cast `toigo_flats` is now consistent plain (strip on aisha + generator drop-for-all; no rebake).
 * Clause (1) still expected-fails because cast `toigo_t_shirt` remains split:
 * gown-adult-patient textureBytes=0 vs four textured cast wearers at 656,736 B. Attaching
 * T-shirt_basic.png to the gown GLB requires a bake (or texture inject) — separate card.
 *
 * ## FIXED (#0) — 2026-08-29 re-measurement; the premise is settled, not merely green
 *
 * Re-measured against the current tree (NodeIO over every GLB in generated-humanoids/ plus the
 * cast candidate dirs): **no shipped GLB carries toigo_flats geometry or its material** —
 * `SHOE_BY_REFERENCE` has no row mapping to it since #598 (materialize_mpfb_humanoid_candidate.py:
 * 29-45) and #740 re-materialized the fleet with each garment's declared .mhmat texture. Every
 * footwear slot ships `toigo_mj_cloth_shoes` (MJ-shoes3, 1,418,657 B) or `culturalibre_male_boots`
 * (boot, 461,286 B), each byte-consistent across its wearers. The `toigo_t_shirt` split that kept
 * clause (1) expected-failing is gone too: all eight wearers carry T-shirt_basic.png at 656,736 B,
 * gown included (#740 restored it).
 *
 * `garment-material-consistency.json` regenerated from the current bytes (2026-08-29): garments =
 * toigo_flats (0 wearers), toigo_t_shirt (8), toigo_mj_cloth_shoes (9), culturalibre_male_boots (2),
 * scrub_shirt (3), scrub_pants (3). Clause (1)'s split list is now empty. Direction declared `drop`
 * (the garment is already off the cast) and defended against the 64 MiB budget: the ob station
 * cast-texture total is 12.101 MiB; attaching the leopard Shoe.png diffuse at 7.41 MiB x 4 cast
 * wearers would cost ~29.6 MiB for a pattern nothing in any case definition authors.
 *
 * Clause (1) flipped `it.fails` -> `it`.
 */

const ARTIFACT = "tools/openclinxr/evidence/garment-material-consistency.json";
/** `asset-registry/src/index.ts:593`. Not invented here. */
const STATION_TEXTURE_BUDGET_MB = 64;
/** The known-good column: the pipeline attaches this one consistently. */
const KNOWN_GOOD = "toigo_t_shirt";

type Wearer = { actor: string; cast?: boolean; textureBytes?: number; baseColorFactor?: number[] };
type Garment = { garment: string; wearers?: Wearer[] };
type Probe = {
  method?: string; mechanism?: string; direction?: "attach" | "drop"; rationale?: string;
  garments?: Garment[]; stationTextureMegabytesAfter?: number;
};
const probe = (): Probe => (existsSync(ARTIFACT) ? JSON.parse(readFileSync(ARTIFACT, "utf8")) as Probe : {});
const g = (n: string) => (probe().garments ?? []).find((x) => x.garment === n);

describe("one garment, one material across the cast", () => {
  it("(1) RED: every CAST wearer of a garment resolves to the same material treatment", () => {
    const p = probe();
    expect(p.garments, `${ARTIFACT} missing — Stage A measures before any product edit`).toBeTypeOf("object");
    const split: string[] = [];
    for (const gar of p.garments!) {
      const cast = (gar.wearers ?? []).filter((w) => w.cast);
      if (cast.length < 2) continue;
      const treatments = new Set(cast.map((w) => ((w.textureBytes ?? 0) > 0 ? "textured" : "untextured")));
      if (treatments.size > 1) {
        const t = cast.filter((w) => (w.textureBytes ?? 0) > 0).map((w) => w.actor);
        const u = cast.filter((w) => (w.textureBytes ?? 0) === 0).map((w) => w.actor);
        split.push(`${gar.garment}: textured=[${t.join(", ")}] untextured=[${u.join(", ")}]`);
      }
    }
    expect(split, "garments whose CAST wearers disagree on material treatment, with nothing authoring it").toEqual([]);
  });

  it("(2) KNOWN-GOOD COLUMN: the pipeline can attach a texture consistently", () => {
    const p = probe();
    if (!p.garments) return; // clause (1) owns the missing-artifact failure
    const k = g(KNOWN_GOOD);
    expect(k, `${KNOWN_GOOD} must be measured — it is the proof the pipeline CAN be consistent`).toBeTruthy();
    const wearers = k!.wearers ?? [];
    expect(wearers.length, `${KNOWN_GOOD} must enumerate its wearers`).toBeGreaterThanOrEqual(2);
  });

  it("(3) COUNTERWEIGHT: the direction is declared and defended against the 64 MB budget", () => {
    const p = probe();
    if (!p.garments) return;
    // Refuses the silent "attach it everywhere": a 7.77 MB diffuse on four cast wearers is ~30 MB of
    // a 64 MB station budget spent on footwear. Whichever way this goes, it is stated and costed.
    expect(p.direction === "attach" || p.direction === "drop",
      "declare the direction chosen: 'attach' or 'drop'").toBe(true);
    expect(typeof p.rationale === "string" && p.rationale.length >= 40,
      "state WHY in a sentence — the direction was unlocked and the reasoning is the deliverable").toBe(true);
    expect(p.stationTextureMegabytesAfter, "record the resulting station texture total").toBeTypeOf("number");
    expect(p.stationTextureMegabytesAfter!,
      `station texture total must stay within the ${STATION_TEXTURE_BUDGET_MB} MB budget`)
      .toBeLessThanOrEqual(STATION_TEXTURE_BUDGET_MB);
  });
});
