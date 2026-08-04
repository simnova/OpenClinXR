import { pediatricAsthmaScenario, edChestPainScenario } from "@openclinxr/scenario-fixtures";
import { describe, expect, it } from "vitest";
import {
  buildHistoryTakingCoverageSpec,
  coverageTraceTagForDomain,
  domainsForTraceTag,
  initialHistoryTakingCoverageState,
  updateHistoryTakingCoverage,
} from "./history-coverage.js";
import { CONVERSATION_CLAIM_SCOPE, CONVERSATION_NOT_EVIDENCE_FOR } from "./types.js";

describe("history-taking coverage", () => {
  it("builds explicit peds asthma domains aligned to requiredTraceTags", () => {
    const spec = buildHistoryTakingCoverageSpec(pediatricAsthmaScenario);
    expect(spec.scenarioId).toBe("peds_asthma_parent_anxiety_v1");
    const domainIds = spec.domains.map((d) => d.domainId);
    for (const tag of pediatricAsthmaScenario.requiredTraceTags) {
      // parent_communication covers family_communication alias; patient_note etc.
      const covered = domainIds.includes(tag) || spec.domains.some((d) => d.matchesTraceTags.includes(tag));
      expect(covered, `expected domain covering ${tag}`).toBe(true);
    }
    expect(spec.domains.length).toBeGreaterThanOrEqual(9);
  });

  it("builds generic fallback domains from requiredTraceTags", () => {
    const spec = buildHistoryTakingCoverageSpec(edChestPainScenario);
    expect(spec.scenarioId).toBe(edChestPainScenario.scenarioId);
    expect(spec.domains.map((d) => d.domainId)).toEqual([...edChestPainScenario.requiredTraceTags]);
  });

  it("starts with all domains missing and 0% coverage", () => {
    const spec = buildHistoryTakingCoverageSpec(pediatricAsthmaScenario);
    const state = initialHistoryTakingCoverageState(spec);
    expect(state.coveredDomainIds).toEqual([]);
    expect(state.missingDomainIds).toEqual(spec.domains.map((d) => d.domainId));
    expect(state.coveragePercent).toBe(0);
    expect(state.claimScope).toBe(CONVERSATION_CLAIM_SCOPE.historyCoverage);
    expect(state.notEvidenceFor).toEqual([...CONVERSATION_NOT_EVIDENCE_FOR]);
  });

  it("covers a domain from matching trace tag and emits first-covered tag", () => {
    const spec = buildHistoryTakingCoverageSpec(pediatricAsthmaScenario);
    const prev = initialHistoryTakingCoverageState(spec);
    const result = updateHistoryTakingCoverage(
      prev,
      { traceTags: ["inhaler_history"] },
      spec,
    );
    expect(result.newlyCoveredDomainIds).toEqual(["inhaler_history"]);
    expect(result.state.coveredDomainIds).toContain("inhaler_history");
    expect(result.state.missingDomainIds).not.toContain("inhaler_history");
    expect(result.state.coverageTraceTags).toContain(coverageTraceTagForDomain("inhaler_history"));
    expect(result.state.claimScope).toBe("history_taking_domain_coverage_traced_not_scored");
    expect(result.state.notEvidenceFor).toEqual([
      "clinical_validity",
      "exam_equivalence",
      "scoring",
      "learner_readiness",
    ]);
  });

  it("covers a domain from keyword match on learner utterance", () => {
    const spec = buildHistoryTakingCoverageSpec(pediatricAsthmaScenario);
    const prev = initialHistoryTakingCoverageState(spec);
    const result = updateHistoryTakingCoverage(
      prev,
      { learnerUtterance: "Did she use her rescue inhaler last night?" },
      spec,
    );
    expect(result.newlyCoveredDomainIds).toContain("inhaler_history");
  });

  it("does not re-emit newly covered on second observation of same domain", () => {
    const spec = buildHistoryTakingCoverageSpec(pediatricAsthmaScenario);
    const first = updateHistoryTakingCoverage(
      initialHistoryTakingCoverageState(spec),
      { traceTags: ["trigger_history"] },
      spec,
    );
    const second = updateHistoryTakingCoverage(
      first.state,
      { traceTags: ["trigger_history"] },
      spec,
    );
    expect(first.newlyCoveredDomainIds).toEqual(["trigger_history"]);
    expect(second.newlyCoveredDomainIds).toEqual([]);
    expect(second.state.coverageTraceTags).toEqual(first.state.coverageTraceTags);
  });

  it("computes coveragePercent as count-based domain coverage only", () => {
    const spec = buildHistoryTakingCoverageSpec({
      scenarioId: "tiny_v1",
      requiredTraceTags: ["a", "b", "c", "d"],
    });
    const prev = initialHistoryTakingCoverageState(spec);
    const result = updateHistoryTakingCoverage(prev, { traceTags: ["a", "b"] }, spec);
    expect(result.state.coveredDomainIds).toHaveLength(2);
    expect(result.state.missingDomainIds).toHaveLength(2);
    expect(result.state.coveragePercent).toBe(50);
  });

  it("maps domainsForTraceTag for peds adaptive shared source of truth", () => {
    const domains = domainsForTraceTag("peds_asthma_parent_anxiety_v1", "inhaler_history");
    expect(domains.map((d) => d.domainId)).toEqual(["inhaler_history"]);
    const parent = domainsForTraceTag("peds_asthma_parent_anxiety_v1", "family_communication");
    expect(parent.map((d) => d.domainId)).toContain("parent_communication");
  });
});
