import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 2026-08-21 — THE FACTORY REFUSES WHAT IT CANNOT BUILD BUT NEVER PUBLISHES WHAT IT CAN.
 *
 * Superagent lane (b), scoped by it as TWO HALVES after `#519`/`#520` landed:
 *   1. OPTIONS  — the nine pack colours + their licence, eye colour only.
 *   2. RESOLVED-FIELD SHAPE — `value` in pack, `source`, `seed`, `from`. Typed.
 * "An options list with no resolved-output contract is the incomplete loop."
 *
 * ## WHY, MEASURED — two live blockers, both authoring-surface
 *
 *   a) `pediatric-asthma.ts:122` authors `eye_color: "hazel"`. No `hazel.mhmat` is staged, so
 *      `#518`'s selector raises `ValueError`. Correct, and nobody can see the nine buildable
 *      colours from the authoring side to pick differently.
 *   b) `#519` honoured the case and the peds cast came out brown/brown/brown, because the bank
 *      authors brown twice and Maya's hazel falls back. Faithful, and nobody was warned that the
 *      cast would be indistinguishable.
 *
 * Operator directive D13 (2026-08-21) permits the authoring adapter to CHOOSE AT RANDOM when
 * needed. It cannot choose from a list that does not exist, and an unrecorded random choice makes
 * the same blueprint bake a different human every run — which breaks D9's "examination performs
 * with no further LLM involvement". Hence half 2: the pick must be FROZEN into the case.
 *
 * ## THE CHEAP FIX THIS EXISTS TO REFUSE
 *
 * **A hand-copied list of nine colour names.** That is a SECOND literal beside
 * `iris_palette._EYE_IRIS_PACK`, and this repo has paid for that shape twice in two days —
 * `#514` (`ACTORS` hardcoded while six actors shipped) and `#516` (`/cargo_pants/i` while Kevin
 * wore scrub_pants). A manifest that drifts from the selector is worse than no manifest: it tells
 * an author a colour is buildable when the factory will refuse it.
 *
 *   treatment                                                    | (1) | (2) | (3) | (4) | result
 *   ---------------------------------------------------------------|-----|-----|-----|-----|--------
 *   a) today — no manifest, no resolved shape                    |FAIL |FAIL |FAIL |pass | REFUSED
 *   b) hand-copy the nine names into a JSON                      |pass |FAIL |FAIL |pass | REFUSED
 *   c) manifest derived, but no resolved-field type              |pass |pass |FAIL |pass | REFUSED
 *   d) add `hazel` so the bank validates                         |pass |pass |pass |FAIL | REFUSED
 *   e) derive from the pack, type the resolved field, keep refuse|pass |pass |pass |pass | ALL PASS
 *
 * WHICH ARE REDS AND WHICH ARE NETS (#227): (1)(2)(3) are RED today. (4) is a NET.
 *
 * KNOWN-GOOD COLUMN (§9h): `iris_palette._EYE_IRIS_PACK` is the nine the selector actually accepts
 * — measured by calling it, not by reading a list. Ledger row 47 of
 * `third-party-asset-licence-ledger.md` records all nine as CC0 1.0, verified in the asset headers
 * 2026-08-13 (#356). The manifest's licence field has a real source; it is not being invented.
 *
 * NOT TESTED:
 *   - Hair, garments, body params. Eye colour ONLY — the superagent scoped it that way and a
 *     broader manifest is the brochure it refused.
 *   - The adapter itself. Not built here, and this contract must not imply it exists.
 *   - Maya's colour. Unbuildable, refused loudly, operator's under D13. Clause (4) pins the bank.
 *   - Whether `eye_color` should become an enum in `schemas.ts`. Explicitly NOT yet — it would red
 *     `pediatric-asthma.ts` on main until someone picks Maya's colour, which is the identity
 *     decision nobody in this loop may take. Clause (4) pins it as a free string.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = pathResolve(HERE, "../../..");
const ANNY = join(REPO, "tools/openclinxr/asset-pipeline/anny");
const MANIFEST = join(REPO, "packages/openclinxr/asset-registry/src/iris-capability-manifest.json");
const RESOLVED = join(REPO, "packages/openclinxr/asset-registry/src/resolved-phenotype-field.ts");
const SCHEMAS = join(REPO, "packages/openclinxr/shared-schemas/src/schemas.ts");
const BANK = join(REPO, "packages/openclinxr/scenario-fixtures/src/pediatric-asthma.ts");

/** §9h — the colours the SELECTOR accepts, obtained by calling it, never by reading a list. */
function packFromSelector(): string[] {
  const py = [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(ANNY)})`,
    "from iris_palette import _EYE_IRIS_PACK",
    "print(json.dumps(sorted(_EYE_IRIS_PACK)))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim()) as string[];
}

describe("the factory publishes what it can build", () => {
  it.fails("(1) RED: an eye-colour capability manifest exists and lists every buildable colour", () => {
    expect(existsSync(MANIFEST), `${MANIFEST} — the authoring side has no list to choose from`).toBe(true);
    const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as { options?: { id: string; licence?: string }[] };
    const ids = (m.options ?? []).map((o) => o.id).sort();
    expect(ids, "the manifest must list exactly what the selector accepts").toEqual(packFromSelector());
    for (const o of m.options ?? []) {
      expect(o.licence, `${o.id} must carry a licence — ledger row 47 records CC0 1.0`).toBeTruthy();
    }
  });

  it.fails("(2) RED: the manifest is DERIVED from the selector's pack, not a second literal", () => {
    // Refuses (b). #514 and #516 were both a literal drifting from reality; a manifest that
    // advertises a colour the selector rejects is that defect pointed at the author.
    const m = JSON.parse(readFileSync(MANIFEST, "utf8")) as { derivedFrom?: string; generatedBy?: string };
    expect(
      /iris_palette/.test(String(m.derivedFrom ?? "") + String(m.generatedBy ?? "")),
      "the manifest must record that it is generated from iris_palette, and how to regenerate it",
    ).toBe(true);
    // And it must actually agree with the selector RIGHT NOW, not merely claim provenance.
    const ids = (JSON.parse(readFileSync(MANIFEST, "utf8")).options ?? []).map((o: { id: string }) => o.id).sort();
    expect(ids, "manifest and selector must not have drifted").toEqual(packFromSelector());
  });

  it.fails("(3) RED: a resolved phenotype field is typed — value, source, seed, from", () => {
    // Refuses (c). D13 permits a random pick; an unrecorded one re-rolls every bake and breaks D9.
    expect(existsSync(RESOLVED), `${RESOLVED} — a random pick with no seed is random PER BAKE`).toBe(true);
    const src = readFileSync(RESOLVED, "utf8");
    for (const field of ["value", "source", "seed", "from"]) {
      expect(new RegExp(`\\b${field}\\b`).test(src), `the resolved field must carry \`${field}\``).toBe(true);
    }
  });

  it("(4) NET: hazel is still refused, the bank is unedited, and eye_color is still a free string", () => {
    // Refuses (d). Making the bank validate by widening the pack or enum-ing the schema are both
    // ways to hide the gap this manifest exists to expose.
    expect(readFileSync(BANK, "utf8"), "Maya still authors hazel").toMatch(/eye_color:\s*"hazel"/);
    expect(packFromSelector(), "the pack must not be widened to admit hazel").not.toContain("hazel");
    expect(
      readFileSync(SCHEMAS, "utf8"),
      "eye_color stays Type.String() — enum-ing it reds the bank until Maya's colour is picked",
    ).toMatch(/eye_color:\s*Type\.Optional\(Type\.String\(\)\)/);
  });
});
