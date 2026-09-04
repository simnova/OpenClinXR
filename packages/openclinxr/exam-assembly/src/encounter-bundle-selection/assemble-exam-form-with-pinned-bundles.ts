import { assembleExamForm } from "../assembly.js";
import type { AssembleExamFormInput, ExamForm } from "../types.js";
import { pinExamStationEncounterBundles } from "./pin-station-bundles.js";
import type {
  ExamStationBundlePinTarget,
  PinExamStationEncounterBundlesRefusal,
  PinExamStationEncounterBundlesSuccess,
  PromotedEncounterBundleCatalogEntry,
} from "./types.js";
import {
  examStationEncounterBundlePinClaimScope,
  examStationEncounterBundlePinNotEvidenceFor,
} from "./types.js";

export type AssembleExamFormWithPinnedEncounterBundlesInput = AssembleExamFormInput & {
  catalog: readonly PromotedEncounterBundleCatalogEntry[];
};

export type AssembleExamFormWithPinnedEncounterBundlesSuccess = PinExamStationEncounterBundlesSuccess & {
  assembled: true;
  form: ExamForm;
};

export type AssembleExamFormWithPinnedEncounterBundlesRefusal = PinExamStationEncounterBundlesRefusal & {
  assembled: false;
  form: ExamForm;
};

export type AssembleExamFormWithPinnedEncounterBundlesResult =
  | AssembleExamFormWithPinnedEncounterBundlesSuccess
  | AssembleExamFormWithPinnedEncounterBundlesRefusal;

export function assembleExamFormWithPinnedEncounterBundles(
  input: AssembleExamFormWithPinnedEncounterBundlesInput,
): AssembleExamFormWithPinnedEncounterBundlesResult {
  const form = assembleExamForm({
    examFormId: input.examFormId,
    blueprint: input.blueprint,
    scenarios: input.scenarios,
  });
  if (form.status !== "ready_for_review") {
    return {
      assembled: false,
      form,
      pinned: false,
      examFormId: form.examFormId,
      pins: [],
      blockers: [
        `form:${form.examFormId}:assembly_not_ready:${form.status}`,
        ...form.assemblyIssues.map((issue) => `form:${form.examFormId}:assembly_issue:${issue}`),
      ],
      claimScope: examStationEncounterBundlePinClaimScope,
      notEvidenceFor: examStationEncounterBundlePinNotEvidenceFor,
    };
  }
  const pinned = pinExamStationEncounterBundles({
    examFormId: form.examFormId,
    stations: pinTargetsFromAssembledForm(input, form),
    catalog: input.catalog,
  });
  if (!pinned.pinned) {
    return {
      assembled: false,
      form,
      ...pinned,
    };
  }
  return {
    assembled: true,
    form,
    ...pinned,
  };
}

export function pinTargetsFromAssembledForm(
  input: AssembleExamFormInput,
  form: ExamForm,
): ExamStationBundlePinTarget[] {
  const slotsByOrder = new Map(
    [...input.blueprint.stationSlots]
      .sort((left, right) => left.order - right.order || left.slotId.localeCompare(right.slotId))
      .map((slot) => [slot.order, slot] as const),
  );
  return form.stationRefs.map((ref) => {
    const slot = slotsByOrder.get(ref.order);
    if (!slot) {
      throw new Error(`assembled station order ${ref.order} has no blueprint slot`);
    }
    return {
      stationOrder: ref.order,
      slotId: slot.slotId,
      scenarioId: ref.scenarioId,
      scenarioVersion: ref.scenarioVersion,
    };
  });
}

export const assembledExamFormWithPinnedBundlesClaimScope = examStationEncounterBundlePinClaimScope;
export const assembledExamFormWithPinnedBundlesNotEvidenceFor = examStationEncounterBundlePinNotEvidenceFor;
