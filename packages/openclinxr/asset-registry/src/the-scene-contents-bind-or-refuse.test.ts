import { describe, expect, it } from "vitest";
import {
  bindInitialSceneContents,
  type SceneContentsInput,
} from "@openclinxr/asset-registry/initial-scene-contents";

/**
 * Brief §3, initial scene planner step 2: "define an explicit reviewed binding and precedence,
 * rather than assuming the strings are catalogue keys" and "If no permitted combination fits,
 * return the conflict rather than silently dropping items or generating a new room."
 *
 * THE REAL CASE is the fixture below, taken from `ed_chest_pain_priority_v2`: six authored English
 * phrases against a catalogue whose ids are not those phrases. Two do not resemble their id at all
 * and one — "stretcher" — names TWO. A substring matcher binds five of six and picks a stretcher,
 * which is precisely the silent behaviour the brief forbids in the same sentence.
 */

const CATALOGUE = [
  "ecg_cart_equipment",
  "bedside_monitor_equipment",
  "stretcher_equipment",
  "ed_stretcher_bed_equipment",
  "iv_pole_equipment",
  "oxygen_nasal_cannula_equipment",
  "wall_clock_equipment",
] as const;

const AUTHORED = [
  "12-lead ECG machine",
  "bedside monitor",
  "stretcher",
  "IV pole",
  "oxygen nasal cannula",
  "wall clock",
] as const;

const SOURCES: Record<string, string> = Object.fromEntries(
  AUTHORED.map((phrase) => [phrase, `activity:ed_chest_pain_initial_assessment#${phrase}`]),
);

function plan(overrides: Partial<SceneContentsInput> = {}) {
  return bindInitialSceneContents({
    scenario: { scenarioId: "ed_chest_pain_priority_v2", equipment: [...AUTHORED] },
    catalogueEquipmentIds: [...CATALOGUE],
    requirementSources: SOURCES,
    reviewedAliases: {
      "12-lead ECG machine": ["ecg_cart_equipment"],
      "bedside monitor": ["bedside_monitor_equipment"],
      // The reviewed alias records BOTH, because both exist and a reviewer has not chosen.
      stretcher: ["stretcher_equipment", "ed_stretcher_bed_equipment"],
      "IV pole": ["iv_pole_equipment"],
      "oxygen nasal cannula": ["oxygen_nasal_cannula_equipment"],
      "wall clock": ["wall_clock_equipment"],
    },
    ...overrides,
  });
}

describe("initial scene contents bind through a reviewed alias, or refuse", () => {
  it("(1) an AMBIGUOUS phrase is refused with both candidates kept, not collapsed to one", () => {
    const result = plan();
    expect(result.resolves).toBe(false);
    const stretcher = result.rows.find((row) => row.authoredPhrase === "stretcher");
    expect(stretcher?.boundEquipmentId).toBeNull();
    expect(stretcher?.candidateEquipmentIds).toEqual(["stretcher_equipment", "ed_stretcher_bed_equipment"]);
    expect(result.conflicts.map((c) => c.kind)).toContain("ambiguous_binding");
  });

  it("(2) COUNTERWEIGHT: the five unambiguous phrases DO bind, so the refusal is not blanket", () => {
    // A binder that refused everything would satisfy clause (1) and be useless. Two of these five
    // do not resemble their catalogue id, which is why the alias table exists at all.
    const result = plan();
    const bound = result.rows.filter((row) => row.boundEquipmentId !== null);
    expect(bound).toHaveLength(5);
    expect(result.rows.find((row) => row.authoredPhrase === "12-lead ECG machine")?.boundEquipmentId)
      .toBe("ecg_cart_equipment");
    for (const row of bound) expect(row.precedence).toBe("reviewed_alias");
  });

  it("(3) an authored asset-need id OUTRANKS the alias, and says so", () => {
    const result = plan({
      scenario: {
        scenarioId: "ed_chest_pain_priority_v2",
        equipment: [...AUTHORED],
        assetNeeds: [{ assetId: "ed_stretcher_bed_equipment" }],
      },
    });
    const stretcher = result.rows.find((row) => row.authoredPhrase === "stretcher");
    expect(stretcher?.boundEquipmentId).toBe("ed_stretcher_bed_equipment");
    expect(stretcher?.precedence).toBe("authored_asset_need_id");
    // And the ambiguity is gone, because the case itself resolved it.
    expect(result.conflicts.map((c) => c.kind)).not.toContain("ambiguous_binding");
  });

  it("(4) a phrase with NO reviewed alias is unbound and conflicts — strings are not catalogue keys", () => {
    const result = plan({
      scenario: { scenarioId: "probe", equipment: ["defibrillator"] },
      requirementSources: { defibrillator: "activity:probe" },
      reviewedAliases: {},
    });
    expect(result.resolves).toBe(false);
    expect(result.conflicts[0]?.kind).toBe("unbound_requirement");
    expect(result.rows[0]?.realizedPlacementIds).toEqual([]);
  });

  it("(5) an INTENTIONALLY ABSENT item stays in the plan, binds to nothing and is never realized", () => {
    // "preserve deliberately absent or unconnected items". Dropping the row would lose the decision.
    const result = plan({ intentionallyAbsent: ["wall clock"] });
    const clock = result.rows.find((row) => row.authoredPhrase === "wall clock");
    expect(clock).toBeDefined();
    expect(clock?.startState).toBe("intentionally_absent");
    expect(clock?.boundEquipmentId).toBeNull();
    expect(clock?.realizedPlacementIds).toEqual([]);
    // Absence is not a conflict on its own.
    expect(result.conflicts.map((c) => c.authoredPhrase)).not.toContain("wall clock");
  });

  it("(6) a requirement with NO SOURCE is refused, however well it would bind", () => {
    // "Each requirement records its source activity/rule." A binding nobody can trace to a reviewed
    // activity is not reviewable, so it is refused before the catalogue is consulted.
    const result = plan({ requirementSources: {} });
    expect(result.resolves).toBe(false);
    expect(result.rows.every((row) => row.boundEquipmentId === null)).toBe(true);
  });

  it("(7) multiple copies get DISTINCT realized identities, not one id used twice", () => {
    const result = plan({ copies: { iv_pole_equipment: 3 } });
    const pole = result.rows.find((row) => row.authoredPhrase === "IV pole");
    expect(pole?.realizedPlacementIds).toEqual([
      "iv_pole_equipment",
      "iv_pole_equipment#2",
      "iv_pole_equipment#3",
    ]);
    expect(new Set(pole?.realizedPlacementIds).size).toBe(3);
  });

  it("(8) a case that both requires and deletes an item reports THAT, rather than choosing", () => {
    const result = plan({
      scenario: {
        scenarioId: "probe",
        equipment: ["stretcher"],
        assetNeeds: [{ assetId: "stretcher_equipment" }],
      },
      requirementSources: { stretcher: "activity:probe" },
      intentionallyAbsent: ["stretcher"],
    });
    expect(result.conflicts[0]?.kind).toBe("required_and_absent");
    expect(result.resolves).toBe(false);
  });

  it("(9) approved alternatives ride with the row for an unavailable requirement", () => {
    const result = plan({
      scenario: { scenarioId: "probe", equipment: ["defibrillator"] },
      requirementSources: { defibrillator: "activity:probe" },
      reviewedAliases: {},
      approvedAlternatives: { defibrillator: ["ecg_cart_equipment"] },
    });
    expect(result.rows[0]?.approvedAlternatives).toEqual(["ecg_cart_equipment"]);
    // Recording an alternative does not silently apply it.
    expect(result.rows[0]?.boundEquipmentId).toBeNull();
    expect(result.resolves).toBe(false);
  });
});
