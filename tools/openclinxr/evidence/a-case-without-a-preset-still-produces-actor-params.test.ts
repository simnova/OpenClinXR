import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildActorPhenotypeExport } from "../../../packages/openclinxr/scenario-fixtures/src/actor-phenotype-export.js";

/**
 * OBSERVABLE: a case whose actor carries an authored phenotype produces actor params WITHOUT anyone
 * hand-typing a row into CASE_ACTOR_PRESETS.
 *
 * MEASURED 2026-08-23, do not re-derive.
 *
 * `.openclinxr/evidence/issue-288/multi-case-rollup.json` (the dark-factory multi-case runner):
 *   casesAttempted 15 | casesFullyDeterministic 1 | frontier case_to_actor_params 13, rigging 1
 *   deterministic per station: clothing 15, room 15, staging_placement 15, render 15,
 *                              equipment 5, case_to_actor_params 2, body 2, rigging 1
 *
 * 13 of 15 shipped cases stop at station ONE. Cause, measured by importing the module:
 * `orchestrate_character.CASE_ACTOR_PRESETS` holds FOUR hand-authored rows covering TWO cases.
 * A case with no hand-written row has no humans in it, and every downstream station is already 15/15.
 *
 * THE PAIR THAT MAKES THIS UNARGUABLE — both actors carry the SAME authored numbers, read from
 * `buildActorPhenotypeExport()` (#291, committed, deterministic):
 *
 *   actor                                              age  height_cm  bmi    preset row   body built
 *   ------------------------------------------------   ---  ---------  ----   ----------   ----------
 *   peds_asthma_parent_anxiety_v1:patient_maya_...       8      125     16.5   YES          yes
 *   peds_fever_v1:patient_noah_chen_v1                   8      125     16.5   **NO**       **no**
 *
 * Identical phenotype, opposite outcome. The only difference is a hand-typed dict entry. That is
 * directive D1's forbidden shape ("wire proven tools, never hand-author") sitting at the centre of
 * the factory, and it is why D9 cannot be reached from any downstream slice.
 *
 * PROVEN AND UNCONSUMED: the deterministic case -> phenotype path ALREADY EXISTS and is landed —
 * `actor-phenotype-export.ts` (#291) extracts authored phenotype from every fixture actor, and
 * `descriptor-phenotype-lookup.ts` `derivePhenotypeFromDescriptors` (#293) resolves actors with no
 * authored phenotype through a descriptor -> numeric lookup. `orchestrate_character.py` consumes
 * NEITHER. The bridge is what is missing, not the data.
 *
 * DERIVATION, so no field is invented (SS7r): the params for an actor with no preset row come from
 * `buildActorPhenotypeExport().entries[caseId][actorId].phenotype` — the committed export — not from
 * a new table, a default, or a guess.
 *
 * KNOWN-GOOD COLUMN: `patient_maya_johnson_v1`. It resolves today through the preset path and must
 * still resolve after the change, so a fix cannot pass by rerouting everything through a new path
 * that drops the working case.
 *
 * COUNTERWEIGHT: the cheap fix is to type one more row into CASE_ACTOR_PRESETS. Clause (3) pins the
 * table at its measured size of 4, so hand-authoring cannot reach green.
 *
 * claimScope: whether actor params resolve for a case that has authored phenotype and no preset row.
 * notEvidenceFor: whether the resulting body is anatomically right, what it looks like, rigging,
 * clothing, or any clinical claim. Producing params is station one of eight.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ANNY_DIR = resolve(HERE, "..", "asset-pipeline", "anny");

const WITHOUT_PRESET = { caseId: "peds_fever_v1", actorId: "patient_noah_chen_v1" };
const WITH_PRESET = { caseId: "peds_asthma_parent_anxiety_v1", actorId: "patient_maya_johnson_v1" };

/** Measured 2026-08-23 by importing the module. The counterweight pins this. */
const PRESET_COUNT_AT_PLANT = 4;

function py(script: string): string {
  return execFileSync("python3", ["-c", script], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

/**
 * Ask the orchestrator to resolve params for one actor of one case.
 * Requires `resolve_case_actor_params(case_id, actor_id)` on orchestrate_character — the seam this
 * slice must create. It must fall back to the committed phenotype export when no preset row exists.
 */
function resolveParams(caseId: string, actorId: string): Record<string, unknown> | null {
  const script = `
import sys, json, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, ${JSON.stringify(ANNY_DIR)})
import orchestrate_character as oc
fn = getattr(oc, "resolve_case_actor_params", None)
if fn is None:
    print("JSON" + json.dumps({"missing_seam": True}))
else:
    try:
        p = fn(${JSON.stringify(caseId)}, ${JSON.stringify(actorId)})
    except Exception as exc:
        print("JSON" + json.dumps({"error": type(exc).__name__ + ": " + str(exc)[:200]}))
    else:
        print("JSON" + json.dumps({"params": p}, default=str))
`;
  const line = py(script).split("\n").find((l) => l.startsWith("JSON"));
  if (!line) return null;
  const parsed = JSON.parse(line.slice(4)) as { params?: Record<string, unknown>; missing_seam?: boolean; error?: string };
  if (parsed.missing_seam || parsed.error) return null;
  return parsed.params ?? null;
}

function presetCount(): number {
  const script = `
import sys, json, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, ${JSON.stringify(ANNY_DIR)})
from orchestrate_character import CASE_ACTOR_PRESETS
print("JSON" + json.dumps({"n": len(CASE_ACTOR_PRESETS)}))
`;
  const line = py(script).split("\n").find((l) => l.startsWith("JSON"));
  if (!line) throw new Error("could not read CASE_ACTOR_PRESETS");
  return (JSON.parse(line.slice(4)) as { n: number }).n;
}

function phenotypeOf(params: Record<string, unknown> | null): Record<string, unknown> {
  if (!params) return {};
  const p = (params.phenotype ?? params) as Record<string, unknown>;
  return typeof p === "object" && p !== null ? p : {};
}

describe("a case without a preset still produces actor params", () => {
  it.fails("(1) RED: the preset-less case resolves params from its authored phenotype", () => {
    // peds_fever_v1's patient carries age 8 / height_cm 125 / bmi 16.5 in the committed #291 export
    // and has no CASE_ACTOR_PRESETS row, so station one produces nothing for him today.
    const params = resolveParams(WITHOUT_PRESET.caseId, WITHOUT_PRESET.actorId);
    expect(params, `${WITHOUT_PRESET.actorId} must resolve without a hand-authored preset row`).not.toBeNull();

    // Not merely "something came back" — it must carry the AUTHORED numbers, so a stub returning
    // defaults fails here (SS11s: presence is not the claim).
    const ph = phenotypeOf(params);
    expect(Number(ph.height_cm), "the authored height must reach the resolved params").toBe(125);
    expect(Number(ph.age), "the authored age must reach the resolved params").toBe(8);
  });

  it.fails("(2) RED: both actors resolve through the SAME entry point", () => {
    // Refuses a fix that special-cases the new actor on a side path. Identical phenotype numbers must
    // produce a resolution for both, through one call.
    for (const target of [WITH_PRESET, WITHOUT_PRESET]) {
      const ph = phenotypeOf(resolveParams(target.caseId, target.actorId));
      expect(Number(ph.height_cm), `${target.actorId} resolved height`).toBe(125);
      expect(Number(ph.age), `${target.actorId} resolved age`).toBe(8);
    }
  });

  it("(3) COUNTERWEIGHT: the hand-authored preset table does not grow", () => {
    // The cheap fix is one more typed row. Measured at 4 when this was planted; adding Noah's row
    // would make clause (1) pass and advance nothing, so it fails here instead.
    expect(presetCount(), "CASE_ACTOR_PRESETS must not gain rows — hand-authoring is the defect")
      .toBeLessThanOrEqual(PRESET_COUNT_AT_PLANT);
  });

  it("(4) KNOWN-GOOD COLUMN: the authored export still carries both actors' phenotypes", () => {
    // Pins the INPUT side, read through the committed #291 export itself rather than a copy of it.
    // If a fix "resolves" by editing the fixtures, this notices.
    const e = buildActorPhenotypeExport() as unknown as {
      entries: Record<string, Record<string, { phenotype?: Record<string, unknown> }>>;
    };
    const noah = e.entries[WITHOUT_PRESET.caseId]?.[WITHOUT_PRESET.actorId]?.phenotype ?? {};
    const maya = e.entries[WITH_PRESET.caseId]?.[WITH_PRESET.actorId]?.phenotype ?? {};
    expect(Number(noah.height_cm), "peds_fever's patient keeps his authored height").toBe(125);
    expect(Number(maya.height_cm), "the asthma patient keeps hers").toBe(125);
    expect(Number(noah.age), "and his authored age").toBe(8);
  });
});
