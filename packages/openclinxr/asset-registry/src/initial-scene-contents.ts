import { realizedEquipmentPlacementId } from "./realized-equipment-placements.js";

/**
 * Bind a case's AUTHORED EQUIPMENT PHRASES to catalogue equipment ids, or return the conflict.
 *
 * Brief §3, "Initial scene planner", step 2 — verbatim: *"Case `equipment` currently contains
 * descriptive strings while `assetNeeds` carries asset IDs; define an explicit reviewed binding and
 * precedence, rather than assuming the strings are catalogue keys."* And: *"If no permitted
 * combination fits, return the conflict rather than silently dropping items or generating a new
 * room."*
 *
 * MEASURED on `ed_chest_pain_priority_v2`, which is why this is not hypothetical. Its `equipment`
 * array is `["12-lead ECG machine", "bedside monitor", "stretcher", "IV pole",
 * "oxygen nasal cannula", "wall clock"]` — six English phrases. The catalogue carries
 * `ecg_cart_equipment`, `bedside_monitor_equipment`, `stretcher_equipment`,
 * `ed_stretcher_bed_equipment`, `iv_pole_equipment`, `oxygen_nasal_cannula_equipment` and
 * `wall_clock_equipment`. Two of those six phrases do not resemble their catalogue id at all
 * ("12-lead ECG machine" -> `ecg_cart_equipment`), and one — "stretcher" — matches TWO ids.
 *
 * THERE IS NO SUBSTRING MATCHING HERE, ON PURPOSE. A fuzzy match would bind five of the six and
 * silently pick one of the two stretchers, which is the behaviour the brief forbids in the same
 * sentence. A phrase binds through an explicit REVIEWED alias or not at all.
 *
 * PRECEDENCE, stated once so it cannot be re-derived per caller:
 *   1. an `assetNeeds` entry whose assetId IS a catalogue equipment id binds directly;
 *   2. otherwise a reviewed alias for the authored phrase binds it;
 *   3. otherwise the requirement is UNBOUND and, if required at start, a conflict.
 * A direct asset-need id outranks an alias, because the case author naming the catalogue id is a
 * stronger statement of intent than a reviewer's phrase mapping.
 */

/** How a requirement came to name a catalogue id. Recorded per row, never inferred by a reader. */
type EquipmentBindingPrecedence =
  | "authored_asset_need_id"
  | "reviewed_alias"
  | "unbound";

/**
 * Whether the encounter needs the item AT THE START.
 *
 * `intentionally_absent` is not the absence of a row. The brief asks to "preserve deliberately
 * absent or unconnected items", so an item a case has decided against stays in the plan, bound to
 * nothing, and is never realized.
 */
type StartStateClass = "required_at_start" | "optional" | "intentionally_absent";

type SceneContentConflictKind =
  /** The phrase names more than one catalogue id. Picking one is what this refuses. */
  | "ambiguous_binding"
  /** Required at start, and neither a direct asset-need id nor a reviewed alias binds it. */
  | "unbound_requirement"
  /** Bound, but the item is also declared intentionally absent. The case disagrees with itself. */
  | "required_and_absent";

type SceneContentRow = {
  /** The authored text, exactly as the case wrote it. */
  authoredPhrase: string;
  /** The activity or rule this requirement came from. Every row carries one. */
  requirementSource: string;
  startState: StartStateClass;
  boundEquipmentId: string | null;
  precedence: EquipmentBindingPrecedence;
  /** Catalogue ids the phrase could name. Length > 1 is the ambiguity, kept rather than collapsed. */
  candidateEquipmentIds: string[];
  /**
   * One realized id per copy, from `realizedEquipmentPlacementId`. Empty for an unbound or
   * intentionally absent row: a plan must not hand the runtime an identity for a thing it refused.
   */
  realizedPlacementIds: string[];
  /** Approved alternatives recorded for an unavailable requirement, or an empty list. */
  approvedAlternatives: string[];
  evidence: string;
};

type SceneContentConflict = {
  kind: SceneContentConflictKind;
  authoredPhrase: string;
  detail: string;
};

type SceneContentsPlan = {
  schemaVersion: "openclinxr.initial-scene-contents.v1";
  scenarioId: string;
  rows: SceneContentRow[];
  conflicts: SceneContentConflict[];
  /** False whenever any conflict stands. A caller that ignores this has ignored the refusal. */
  resolves: boolean;
};

type SceneContentsInput = {
  scenario: {
    scenarioId: string;
    /** Authored descriptive phrases. NOT catalogue keys. */
    equipment?: readonly string[] | undefined;
    assetNeeds?: readonly { assetId: string }[] | undefined;
  };
  /** Every equipment id the catalogue can realize. */
  catalogueEquipmentIds: readonly string[];
  /** Reviewed phrase -> catalogue id(s). More than one id is an ambiguity to report, not to resolve. */
  reviewedAliases: Readonly<Record<string, readonly string[]>>;
  /** Phrases the case has deliberately decided against, kept in the plan and never realized. */
  intentionallyAbsent?: readonly string[] | undefined;
  /** Phrases the encounter can proceed without. Everything else authored is required at start. */
  optional?: readonly string[] | undefined;
  /** How many copies each bound id needs. Absent means one. */
  copies?: Readonly<Record<string, number>> | undefined;
  /** Recorded alternatives for a requirement the catalogue cannot supply. */
  approvedAlternatives?: Readonly<Record<string, readonly string[]>> | undefined;
  /** The activity or rule each phrase came from. A phrase with no source is itself a refusal. */
  requirementSources: Readonly<Record<string, string>>;
};

function classify(
  phrase: string,
  input: SceneContentsInput,
): StartStateClass {
  if ((input.intentionallyAbsent ?? []).includes(phrase)) return "intentionally_absent";
  if ((input.optional ?? []).includes(phrase)) return "optional";
  return "required_at_start";
}

export function bindInitialSceneContents(input: SceneContentsInput): SceneContentsPlan {
  const catalogue = new Set(input.catalogueEquipmentIds);
  const directIds = new Set(
    (input.scenario.assetNeeds ?? []).map((need) => need.assetId).filter((id) => catalogue.has(id)),
  );
  const rows: SceneContentRow[] = [];
  const conflicts: SceneContentConflict[] = [];

  for (const phrase of input.scenario.equipment ?? []) {
    const startState = classify(phrase, input);
    const requirementSource = input.requirementSources[phrase] ?? "";
    const aliasIds = [...(input.reviewedAliases[phrase] ?? [])];
    // Precedence 1: the case named a catalogue id outright among its asset needs.
    const direct = aliasIds.find((id) => directIds.has(id))
      ?? [...directIds].find((id) => aliasIds.includes(id))
      ?? null;
    const candidateEquipmentIds = aliasIds.filter((id) => catalogue.has(id));

    let boundEquipmentId: string | null = null;
    let precedence: EquipmentBindingPrecedence = "unbound";
    let evidence: string;

    if (requirementSource === "") {
      conflicts.push({
        kind: "unbound_requirement",
        authoredPhrase: phrase,
        detail: "no requirement source: a scene requirement with no activity or rule behind it cannot be reviewed",
      });
      evidence = "refused: the requirement records no source activity or rule";
    } else if (startState === "intentionally_absent") {
      if (direct) {
        conflicts.push({
          kind: "required_and_absent",
          authoredPhrase: phrase,
          detail: `bound to ${direct} by an authored asset need while also declared intentionally absent`,
        });
      }
      evidence = "deliberately absent: kept in the plan, bound to nothing, never realized";
    } else if (direct) {
      boundEquipmentId = direct;
      precedence = "authored_asset_need_id";
      evidence = `bound to ${direct} because the case's own assetNeeds names that catalogue id`;
    } else if (candidateEquipmentIds.length === 1) {
      boundEquipmentId = candidateEquipmentIds[0]!;
      precedence = "reviewed_alias";
      evidence = `bound to ${boundEquipmentId} through the reviewed alias for this phrase`;
    } else if (candidateEquipmentIds.length > 1) {
      conflicts.push({
        kind: "ambiguous_binding",
        authoredPhrase: phrase,
        detail: `names ${candidateEquipmentIds.length} catalogue ids (${candidateEquipmentIds.join(", ")}); a reviewer picks, this does not`,
      });
      evidence = `refused: ambiguous across ${candidateEquipmentIds.join(", ")}`;
    } else {
      if (startState === "required_at_start") {
        conflicts.push({
          kind: "unbound_requirement",
          authoredPhrase: phrase,
          detail: "no authored asset-need id and no reviewed alias; descriptive strings are not catalogue keys",
        });
      }
      evidence = "unbound: no authored asset-need id and no reviewed alias";
    }

    const copyCount = boundEquipmentId ? Math.max(1, input.copies?.[boundEquipmentId] ?? 1) : 0;
    rows.push({
      authoredPhrase: phrase,
      requirementSource,
      startState,
      boundEquipmentId,
      precedence,
      candidateEquipmentIds,
      realizedPlacementIds: boundEquipmentId
        ? Array.from({ length: copyCount }, (_unused, index) =>
            realizedEquipmentPlacementId(boundEquipmentId, index + 1))
        : [],
      approvedAlternatives: [...(input.approvedAlternatives?.[phrase] ?? [])],
      evidence,
    });
  }

  return {
    schemaVersion: "openclinxr.initial-scene-contents.v1",
    scenarioId: input.scenario.scenarioId,
    rows,
    conflicts,
    resolves: conflicts.length === 0,
  };
}
