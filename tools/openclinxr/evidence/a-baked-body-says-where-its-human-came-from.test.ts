import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * OBSERVABLE: a generated humanoid records WHICH source described the human it was baked from.
 *
 * MEASURED 2026-08-24, do not re-derive. #650 landed the seam: `resolve_case_actor_params` in
 * `orchestrate_character.py:225-227` now resolves the case-definition export FIRST and falls back to
 * `CASE_ACTOR_PRESETS`. **So the pipeline now has two possible sources for the human — and the
 * artifact records neither.**
 *
 * Every provenance sidecar shipped today, 15 files:
 *
 *   sourceManifestPath          15
 *   sourceKind                  15
 *   sourceOriginChain           15
 *   sourceNotes                 15
 *   promptOrCaseParameterHash    9
 *   ANY field naming the phenotype source     0
 *
 *   derivationMode = mpfb2_macro_from_anny_reference   6
 *                    blender_only_rebake               5
 *                    mpfb2_promoted_default_cast       2
 *                    orchestrate                       2
 *
 * `derivationMode` says HOW the mesh was made. Nothing says WHERE THE DESCRIBED HUMAN CAME FROM, so a
 * case-driven body and a preset-driven body are indistinguishable after the fact — including to any
 * contract trying to prove #650 works. This is #635's defect one layer down: a gate cannot see a
 * distinction the artifact never records.
 *
 * KNOWN-GOOD COLUMN - clause (2): `promptOrCaseParameterHash` already sits on 9 of 15 sidecars. The
 * convention exists and this field joins it rather than inventing one. Those 9 must keep it.
 *
 * COUNTERWEIGHT - clause (3): the four pinned heights (125 / 166 / 176 / 178) must still appear in
 * `orchestrate_character.py`. A fix that reaches clause (1) by rewriting the resolver's inputs would
 * move them, and #650's known-good column exists to refuse exactly that.
 *
 * FAILED TREATMENT, do not repeat: hand-writing `phenotypeSource` into a sidecar. The field is only
 * worth anything if the RESOLVER writes it — the same lesson as #635's stamp, where a hand-stamped sha
 * is strictly worse than none because it defeats the check that would catch it. It must be emitted by
 * the code that actually chose the source.
 *
 * claimScope: whether a shipped humanoid's provenance names the phenotype source, read statically from
 *   the sidecars, plus the four preset heights in the pipeline script.
 * notEvidenceFor: whether the baked figure looks right; whether the case-resolved values are correct;
 *   any mesh geometry; garments; rigging.
 */

const HUMANOIDS = "apps/ui-xr/public/generated-humanoids";
const ORCHESTRATE = "tools/openclinxr/asset-pipeline/anny/orchestrate_character.py";
/** The two sources `resolve_case_actor_params` can pick between, plus room for a refusal. */
const SOURCE_FIELDS = ["phenotypeSource", "phenotypeSourceKind", "caseDefinitionSource"] as const;

const sidecars = (): Array<{ name: string; body: Record<string, unknown> }> =>
  readdirSync(HUMANOIDS)
    .filter((f) => f.endsWith(".provenance.json"))
    .map((name) => ({ name, body: JSON.parse(readFileSync(`${HUMANOIDS}/${name}`, "utf8")) as Record<string, unknown> }));

const namesItsSource = (body: Record<string, unknown>): boolean =>
  SOURCE_FIELDS.some((f) => typeof body[f] === "string" && (body[f] as string).length > 0);

describe("a baked body says where its human came from", () => {
  it.fails("(1) at least one shipped humanoid names the source of its phenotype", () => {
    const all = sidecars();
    expect(all.length, "no provenance sidecars found — the reader is pointed at the wrong tree")
      .toBeGreaterThanOrEqual(14);
    const naming = all.filter((s) => namesItsSource(s.body)).map((s) => s.name);
    expect(
      naming,
      `none of ${all.length} sidecars names a phenotype source. #650 gave the pipeline two possible `
      + "sources for the human and the artifact records neither, so nothing downstream — including a "
      + "contract — can tell a case-driven body from a preset-driven one",
    ).not.toHaveLength(0);
  });

  it("(2) KNOWN-GOOD COLUMN: the provenance convention this field joins still holds", () => {
    // promptOrCaseParameterHash is already on 9 of 15. The new field joins an existing convention
    // rather than inventing one, and those 9 must not lose it on the way through.
    const withHash = sidecars().filter((s) => typeof s.body["promptOrCaseParameterHash"] === "string");
    expect(withHash.length, "the existing provenance convention must survive").toBeGreaterThanOrEqual(9);
    for (const s of sidecars()) {
      expect(typeof s.body["derivationMode"], `${s.name} lost its derivationMode`).toBe("string");
    }
  });

  it("(3) COUNTERWEIGHT: #650's pinned humans are untouched", () => {
    // Refuses reaching clause (1) by rewriting what the resolver is fed. These four heights are the
    // described humans the pipeline honours today and #650 pinned them for this exact reason.
    const py = readFileSync(ORCHESTRATE, "utf8");
    const heights = [...py.matchAll(/"height_cm":\s*(\d+)/gu)].map((m) => Number(m[1]));
    for (const expected of [125, 166, 176, 178]) {
      expect(heights, `height_cm ${expected} is a pinned known-good from #650`).toContain(expected);
    }
  });

  it("(4) VACUITY GUARD: the reader is parsing real sidecars", () => {
    // Without this, clause (1) passes on an empty directory listing — nothing named, nothing to name.
    const all = sidecars();
    expect(all.length, "15 sidecars shipped when this was planted").toBeGreaterThanOrEqual(14);
    expect(
      new Set(all.map((s) => String(s.body["derivationMode"]))).size,
      "four distinct derivationModes shipped; one value everywhere means the parse is degenerate",
    ).toBeGreaterThan(1);
  });
});
