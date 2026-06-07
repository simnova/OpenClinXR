export type CagematchTechnologyId =
  | "anny_parametric_forward_pass"
  | "mpfb_makehuman_basemesh"
  | "hybrid_anny_mesh_mpfb_rig"
  | "comfy_realvisxl_masked_face"
  | "stablegen_comfyui_skin";

export type CagematchReportMedia = {
  mediaId: string;
  kind: "image" | "video";
  label: string;
  /** Browser path under model-vetting-studio public root, e.g. /cagematch-reports/... */
  urlPath: string;
  caption: string;
  role?: "comparison" | "left_candidate" | "right_candidate" | "process" | "studio_capture";
  /** Reviewer checklist: what to inspect in this capture or walkthrough clip. */
  lookFor?: string[];
  /** Optional poster frame when a process video is not yet recorded. */
  posterUrlPath?: string;
};

export type CagematchProcessExplanation = {
  stepNumber: number;
  title: string;
  narrative: string;
  lookFor: string[];
  videoUrlPath?: string;
  posterUrlPath?: string;
};

export type CagematchFeasibilityCriterion = {
  criterionId: string;
  label: string;
  question: string;
  weight: "required" | "important" | "advisory";
  technologies: Record<
    string,
    {
      rating: "pass" | "warn" | "fail" | "not_evaluated";
      note: string;
    }
  >;
};

export type CagematchDecisionBranch = {
  branchId: string;
  condition: string;
  choose: CagematchTechnologyId | "compare_in_studio" | "blocked_pending_review";
  rationale: string;
  exampleScenarios: string[];
};

export type CagematchReportPage = {
  schemaVersion: "openclinxr.cagematch-report-page.v1";
  reportId: string;
  lane: string;
  runId: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  canonicalPlanPath: string;
  family: string;
  claimScope: string;
  objectives: string[];
  processSteps: string[];
  caseContext: {
    scenarioId: string;
    actorRole: string;
    actorProfile: string;
  };
  technologies: Array<{
    technologyId: CagematchTechnologyId | string;
    displayName: string;
    toolVersions?: string[];
    summary: string;
    strengths: string[];
    limitations: string[];
  }>;
  feasibilityCriteria: CagematchFeasibilityCriterion[];
  decisionBranches: CagematchDecisionBranch[];
  interimVerdict: {
    summary: string;
    recommendedPrimary: CagematchTechnologyId | string;
    recommendedFallback: CagematchTechnologyId | string;
    blockedReasons: string[];
    compareBeforePromotion: string[];
  };
  media: CagematchReportMedia[];
  /** Step-by-step walkthrough text (and optional video) explaining how to read this cagematch. */
  processExplanations?: CagematchProcessExplanation[];
  relatedCommands: string[];
  notEvidenceFor: string[];
};

export type CagematchReportRegistry = {
  schemaVersion: "openclinxr.cagematch-report-registry.v1";
  generatedAt: string;
  reports: Array<{
    reportId: string;
    lane: string;
    runId: string;
    title: string;
    family: string;
    reportUrlPath: string;
    pageUrlQuery: string;
    thumbnailUrlPath?: string;
  }>;
};

export function validateCagematchReportPage(value: unknown): { ok: true; report: CagematchReportPage } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["report must be an object"] };
  }
  requireString(value["schemaVersion"], "schemaVersion", errors);
  if (value["schemaVersion"] !== "openclinxr.cagematch-report-page.v1") {
    errors.push("schemaVersion must be openclinxr.cagematch-report-page.v1");
  }
  for (const key of ["reportId", "lane", "runId", "title", "subtitle", "generatedAt", "canonicalPlanPath", "family", "claimScope"] as const) {
    requireString(value[key], key, errors);
  }
  if (!Array.isArray(value["objectives"]) || value["objectives"].length === 0) errors.push("objectives must be a nonempty array");
  if (!Array.isArray(value["processSteps"]) || value["processSteps"].length === 0) errors.push("processSteps must be a nonempty array");
  if (!Array.isArray(value["technologies"]) || value["technologies"].length === 0) errors.push("technologies must be a nonempty array");
  if (!Array.isArray(value["feasibilityCriteria"]) || value["feasibilityCriteria"].length === 0) errors.push("feasibilityCriteria must be a nonempty array");
  if (!Array.isArray(value["decisionBranches"]) || value["decisionBranches"].length === 0) errors.push("decisionBranches must be a nonempty array");
  if (!isRecord(value["interimVerdict"])) errors.push("interimVerdict must be an object");
  if (!Array.isArray(value["media"])) errors.push("media must be an array");
  if (!Array.isArray(value["notEvidenceFor"]) || value["notEvidenceFor"].length === 0) errors.push("notEvidenceFor must be a nonempty array");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, report: value as CagematchReportPage };
}

export function validateCagematchReportRegistry(value: unknown): { ok: true; registry: CagematchReportRegistry } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["registry must be an object"] };
  if (value["schemaVersion"] !== "openclinxr.cagematch-report-registry.v1") errors.push("invalid schemaVersion");
  if (!Array.isArray(value["reports"])) errors.push("reports must be an array");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, registry: value as CagematchReportRegistry };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, label: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) errors.push(`${label} must be a nonempty string`);
}