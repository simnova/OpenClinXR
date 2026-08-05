export function validateCagematchReportPage(value) {
    const errors = [];
    if (!isRecord(value)) {
        return { ok: false, errors: ["report must be an object"] };
    }
    requireString(value["schemaVersion"], "schemaVersion", errors);
    if (value["schemaVersion"] !== "openclinxr.cagematch-report-page.v1") {
        errors.push("schemaVersion must be openclinxr.cagematch-report-page.v1");
    }
    for (const key of ["reportId", "lane", "runId", "title", "subtitle", "generatedAt", "canonicalPlanPath", "family", "claimScope"]) {
        requireString(value[key], key, errors);
    }
    if (!Array.isArray(value["objectives"]) || value["objectives"].length === 0)
        errors.push("objectives must be a nonempty array");
    if (!Array.isArray(value["processSteps"]) || value["processSteps"].length === 0)
        errors.push("processSteps must be a nonempty array");
    if (!Array.isArray(value["technologies"]) || value["technologies"].length === 0)
        errors.push("technologies must be a nonempty array");
    if (!Array.isArray(value["feasibilityCriteria"]) || value["feasibilityCriteria"].length === 0)
        errors.push("feasibilityCriteria must be a nonempty array");
    if (!Array.isArray(value["decisionBranches"]) || value["decisionBranches"].length === 0)
        errors.push("decisionBranches must be a nonempty array");
    if (!isRecord(value["interimVerdict"]))
        errors.push("interimVerdict must be an object");
    if (!Array.isArray(value["media"]))
        errors.push("media must be an array");
    if (!Array.isArray(value["notEvidenceFor"]) || value["notEvidenceFor"].length === 0)
        errors.push("notEvidenceFor must be a nonempty array");
    if (errors.length > 0)
        return { ok: false, errors };
    return { ok: true, report: value };
}
export function validateCagematchReportRegistry(value) {
    const errors = [];
    if (!isRecord(value))
        return { ok: false, errors: ["registry must be an object"] };
    if (value["schemaVersion"] !== "openclinxr.cagematch-report-registry.v1")
        errors.push("invalid schemaVersion");
    if (!Array.isArray(value["reports"]))
        errors.push("reports must be an array");
    if (errors.length > 0)
        return { ok: false, errors };
    return { ok: true, registry: value };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireString(value, label, errors) {
    if (typeof value !== "string" || value.length === 0)
        errors.push(`${label} must be a nonempty string`);
}
