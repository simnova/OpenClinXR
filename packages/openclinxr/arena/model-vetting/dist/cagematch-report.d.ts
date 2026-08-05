export type CagematchTechnologyId = "anny_parametric_forward_pass" | "mpfb_makehuman_basemesh" | "hybrid_anny_mesh_mpfb_rig" | "comfy_realvisxl_masked_face" | "stablegen_comfyui_skin";
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
    technologies: Record<string, {
        rating: "pass" | "warn" | "fail" | "not_evaluated";
        note: string;
    }>;
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
export declare function validateCagematchReportPage(value: unknown): {
    ok: true;
    report: CagematchReportPage;
} | {
    ok: false;
    errors: string[];
};
export declare function validateCagematchReportRegistry(value: unknown): {
    ok: true;
    registry: CagematchReportRegistry;
} | {
    ok: false;
    errors: string[];
};
//# sourceMappingURL=cagematch-report.d.ts.map