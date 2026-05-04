import { describe, expect, it } from "vitest";
import {
  buildAgentMemoryIndex,
  createAgentLoopPlan,
  createAgentDispatchPackets,
  defaultAgentLoopRoster,
  evaluateMaturityDelta,
  normalizeLegacyScorecard,
  recommendAgentModelForWorkOrder,
  recommendBackgroundAgentModel,
  serializeAgentLoopPlan,
  type AgentMemoryEntry,
  type IterationScorecard,
} from "./index.js";

function scorecard(overrides: Partial<IterationScorecard> = {}): IterationScorecard {
  return {
    iterationId: "iteration-0008",
    scoredBy: "rubric-steward",
    confidence: 0.82,
    dimensions: {
      clinical_validity: { score: 3.55, rationale: "Needs specialty depth." },
      psychometric_defensibility: { score: 3.7, rationale: "Pilot validity argument still thin." },
      technical_feasibility: { score: 4.25, rationale: "Quest smoke is now verified locally." },
      architecture_coherence: { score: 4.15, rationale: "Package boundaries are clearer." },
      security_privacy: { score: 3.9, rationale: "Consent and logs need more design." },
      ux_workflow_fit: { score: 4.05, rationale: "XR vertical slice works." },
      cost_performance_efficiency: { score: 3.95, rationale: "Local model benchmark missing." },
      open_source_sustainability: { score: 4.15, rationale: "License gates exist for assets." },
      market_gtm_strength: { score: 3.6, rationale: "Pilot buyer proof still abstract." },
      evidence_discipline: { score: 3.5, rationale: "Evidence debt remains open." },
      implementation_readiness: { score: 4.3, rationale: "Executable scaffold exists." },
      adversarial_robustness: { score: 3.8, rationale: "Adversarial loop is not executable yet." },
      legal_regulatory_resilience: { score: 3.4, rationale: "Claims governance needs counsel pass." },
      specialty_clinical_generalizability: { score: 3.45, rationale: "Only one station is coded." },
    },
    criticalRisks: [],
    evidenceDebt: [
      {
        id: "evidence-quest-smoke",
        owner: "xr-systems-architect",
        summary: "Record clean Quest 3 WebXR smoke evidence.",
        status: "open",
      },
    ],
    decisionDebt: [],
    ...overrides,
  };
}

describe("agent-loop memory index", () => {
  it("keeps detailed active memories indexed by topic while hiding superseded entries", () => {
    const entries: AgentMemoryEntry[] = [
      {
        id: "old-quest-claim",
        agentId: "xr-systems-architect",
        team: "core",
        topic: "quest-webxr",
        summary: "Quest support still unverified.",
        detail: "Before USB authorization, the headset smoke path could not be trusted.",
        confidence: 0.5,
        iteration: 7,
        status: "active",
      },
      {
        id: "quest-smoke-clean",
        agentId: "xr-systems-architect",
        team: "core",
        topic: "quest-webxr",
        summary: "Quest Browser reports WebXR ready on the local station shell.",
        detail: "ADB reverse loaded localhost:5173, canvas rendered, and trace click advanced state.",
        confidence: 0.92,
        iteration: 8,
        status: "active",
        supersedes: ["old-quest-claim"],
      },
      {
        id: "legal-claim-boundary",
        agentId: "general-counsel",
        team: "leadership",
        topic: "claims-governance",
        summary: "Avoid high-stakes score-use claims until validation evidence exists.",
        confidence: 0.88,
        iteration: 8,
        status: "active",
      },
    ];

    const index = buildAgentMemoryIndex(entries);

    expect(index.activeEntries.map((entry) => entry.id)).toEqual(["quest-smoke-clean", "legal-claim-boundary"]);
    expect(index.byTopic.get("quest-webxr")?.map((entry) => entry.id)).toEqual(["quest-smoke-clean"]);
    expect(index.search("quest").map((entry) => entry.id)).toEqual(["quest-smoke-clean"]);
    expect(index.byAgent.get("xr-systems-architect")?.[0]?.detail).toContain("ADB reverse");
  });
});

describe("agent-loop maturity scoring", () => {
  it("detects improvement and blocks leadership readiness while evidence debt remains open", () => {
    const prior = scorecard({
      iterationId: "iteration-0007",
      confidence: 0.76,
      dimensions: {
        ...scorecard().dimensions,
        technical_feasibility: { score: 3.65, rationale: "Quest smoke blocked." },
        implementation_readiness: { score: 3.75, rationale: "API and XR were not fully tied together." },
      },
    });
    const current = scorecard();

    const delta = evaluateMaturityDelta({ previous: prior, current, leadershipThreshold: 4 });

    expect(delta.trend).toBe("improving");
    expect(delta.weightedScore).toBeGreaterThan(delta.previousWeightedScore ?? 0);
    expect(delta.readyForLeadershipReview).toBe(false);
    expect(delta.blockers).toContain("open_evidence_debt");
  });

  it("marks mature iterations ready for senior leadership only after risks and evidence debt are closed", () => {
    const current = scorecard({
      confidence: 0.9,
      evidenceDebt: [],
      dimensions: Object.fromEntries(
        Object.entries(scorecard().dimensions).map(([dimension, value]) => [dimension, { ...value, score: Math.max(value.score, 4.4) }]),
      ) as IterationScorecard["dimensions"],
    });

    expect(evaluateMaturityDelta({ current, leadershipThreshold: 4.2 }).readyForLeadershipReview).toBe(true);
  });
});

describe("agent-loop synthesis planning", () => {
  it("normalizes existing agent-factory scorecards into the executable loop model", () => {
    const normalized = normalizeLegacyScorecard({
      iteration_id: "iteration-0007",
      plan_type: "leadership-review",
      scored_by: "senior-leadership-panel",
      scored_at: "2026-05-03",
      dimensions: scorecard().dimensions,
      critical_risks: [
        {
          id: "risk-001",
          severity: "medium",
          summary: "Scenario governance is thin.",
          owner: "chief-medical-officer",
          status: "open",
        },
      ],
      evidence_debt: [
        {
          id: "evidence-001",
          owner: "test-automation-lead",
          summary: "Run root verification.",
          status: "closed",
        },
      ],
      decision_debt: [],
      confidence: 0.93,
      summary: "Existing scorecard shape.",
    });

    expect(normalized).toMatchObject({
      iterationId: "iteration-0007",
      scoredBy: "senior-leadership-panel",
      confidence: 0.93,
      evidenceDebt: [{ id: "evidence-001", status: "closed" }],
    });
    expect(normalized.criticalRisks[0]).toMatchObject({ severity: "medium", owner: "chief-medical-officer" });
  });

  it("creates staged core, physician, legal, adversarial, and leadership work orders from score gaps", () => {
    const plan = createAgentLoopPlan({
      iterationId: "iteration-0008",
      candidatePlanTitle: "OpenClinXR next vertical-slice synthesis",
      scorecard: scorecard(),
      memoryEntries: [],
      leadershipThreshold: 4,
    });

    expect(plan.rosterVersion).toBe(defaultAgentLoopRoster.version);
    expect(plan.workOrders.map((order) => order.stage)).toEqual([
      "core_revision",
      "physician_specialty_review",
      "legal_governance_review",
      "adversarial_counterplan",
      "leadership_preflight",
    ]);
    expect(plan.workOrders.find((order) => order.stage === "physician_specialty_review")?.assignedAgentIds).toEqual(
      expect.arrayContaining([
        "emergency-medicine-physician",
        "cardiology-physician",
        "anesthesiology-critical-care-physician",
        "family-medicine-physician",
        "infectious-disease-physician",
        "internal-medicine-physician",
        "neurology-physician",
        "psychiatry-physician",
        "pediatrics-physician",
        "radiology-imaging-physician",
        "obgyn-physician",
        "surgery-physician",
      ]),
    );
    expect(plan.workOrders.find((order) => order.stage === "legal_governance_review")?.assignedAgentIds).toEqual(
      expect.arrayContaining(["general-counsel", "healthcare-compliance-counsel", "ai-governance-counsel"]),
    );
    expect(plan.workOrders.find((order) => order.stage === "adversarial_counterplan")?.dependsOnStages).toEqual([
      "core_revision",
      "physician_specialty_review",
      "legal_governance_review",
    ]);
    expect(plan.nextActions[0]).toMatchObject({
      actionType: "close_evidence_debt",
      owner: "xr-systems-architect",
    });
    expect(plan.leadershipGate.ready).toBe(false);
    expect(plan.leadershipGate.blockers).toContain("open_evidence_debt");
  });

  it("keeps blocker-focused owners even when dimensions are above threshold", () => {
    const current = scorecard({
      confidence: 0.93,
      dimensions: Object.fromEntries(
        Object.entries(scorecard().dimensions).map(([dimension, value]) => [dimension, { ...value, score: Math.max(value.score, 4.35) }]),
      ) as IterationScorecard["dimensions"],
      evidenceDebt: [
        {
          id: "quest-benchmark",
          owner: "xr-systems-architect",
          summary: "Run Quest 3 benchmark before immersive claims.",
          status: "open",
        },
      ],
      decisionDebt: [],
    });

    const plan = createAgentLoopPlan({
      iterationId: "iteration-0008",
      candidatePlanTitle: "High score with remaining blocker",
      scorecard: current,
      memoryEntries: [],
      leadershipThreshold: 4,
    });

    expect(plan.nextActions[0]).toMatchObject({
      id: "quest-benchmark",
      dimensions: ["technical_feasibility", "cost_performance_efficiency"],
    });
    expect(plan.workOrders.find((order) => order.stage === "leadership_preflight")?.assignedAgentIds).toEqual(
      expect.arrayContaining(["cto", "chief-medical-officer", "chief-psychometrician", "general-counsel"]),
    );
  });

  it("recommends appropriately sized models for background agent work", () => {
    const plan = createAgentLoopPlan({
      iterationId: "iteration-0008",
      candidatePlanTitle: "Model-aware dispatch",
      scorecard: scorecard(),
      memoryEntries: [],
      leadershipThreshold: 4,
    });

    expect(recommendBackgroundAgentModel({ taskType: "bounded_scout" })).toMatchObject({
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      policyTier: "fast_bounded",
    });
    expect(recommendBackgroundAgentModel({ taskType: "leadership_synthesis" })).toMatchObject({
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      policyTier: "frontier_thinking",
    });
    expect(recommendAgentModelForWorkOrder(plan.workOrders.find((order) => order.stage === "core_revision")!)).toMatchObject({
      model: "gpt-5.4",
      reasoningEffort: "medium",
      policyTier: "standard_execution",
    });
    expect(recommendAgentModelForWorkOrder(plan.workOrders.find((order) => order.stage === "physician_specialty_review")!)).toMatchObject({
      model: "gpt-5.4",
      reasoningEffort: "high",
      policyTier: "expert_review",
    });
    expect(recommendAgentModelForWorkOrder(plan.workOrders.find((order) => order.stage === "adversarial_counterplan")!)).toMatchObject({
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      policyTier: "frontier_thinking",
    });
  });

  it("keeps specialist-owned blocker actions tied to scored dimensions after the plan clears low score thresholds", () => {
    const current = scorecard({
      confidence: 0.94,
      dimensions: Object.fromEntries(
        Object.entries(scorecard().dimensions).map(([dimension, value]) => [dimension, { ...value, score: Math.max(value.score, 4.35) }]),
      ) as IterationScorecard["dimensions"],
      evidenceDebt: [
        {
          id: "local-runtime-benchmark",
          owner: "local-ai-inference-engineer",
          summary: "Configure and run a no-cloud Apple Silicon model benchmark.",
          status: "open",
        },
        {
          id: "voice-runtime-benchmark",
          owner: "voice-speech-engineer",
          summary: "Configure and run a local VibeVoice or text fallback speech benchmark.",
          status: "open",
        },
        {
          id: "asset-pipeline-benchmark",
          owner: "asset-pipeline-lead",
          summary: "Install Blender and run a humanoid GLB optimization benchmark.",
          status: "open",
        },
      ],
      decisionDebt: [],
      criticalRisks: [],
    });

    const plan = createAgentLoopPlan({
      iterationId: "iteration-0008",
      candidatePlanTitle: "Specialist evidence owners",
      scorecard: current,
      memoryEntries: [],
      leadershipThreshold: 4,
    });

    expect(plan.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "local-runtime-benchmark",
          dimensions: expect.arrayContaining(["technical_feasibility", "cost_performance_efficiency"]),
        }),
        expect.objectContaining({
          id: "voice-runtime-benchmark",
          dimensions: expect.arrayContaining(["technical_feasibility", "security_privacy"]),
        }),
        expect.objectContaining({
          id: "asset-pipeline-benchmark",
          dimensions: expect.arrayContaining(["technical_feasibility", "open_source_sustainability"]),
        }),
      ]),
    );
    expect(plan.nextActions.every((action) => action.dimensions.length > 0)).toBe(true);
  });

  it("serializes loop plans and creates memory-rich dispatch packets for agents", () => {
    const memoryEntries: AgentMemoryEntry[] = [
      {
        id: "memory-architecture-001",
        agentId: "solution-architect",
        team: "core",
        topic: "component-boundaries",
        summary: "Keep GraphQL static artifacts out of runtime file loading.",
        confidence: 0.91,
        iteration: 8,
        status: "active",
      },
      {
        id: "memory-legal-001",
        agentId: "general-counsel",
        team: "leadership",
        topic: "claims-governance",
        summary: "No ECFMG equivalence or validated high-stakes scoring claim.",
        confidence: 0.94,
        iteration: 8,
        status: "active",
      },
    ];
    const plan = createAgentLoopPlan({
      iterationId: "iteration-0008",
      candidatePlanTitle: "Serializable agent loop",
      scorecard: scorecard(),
      memoryEntries,
      leadershipThreshold: 4,
    });

    const serialized = serializeAgentLoopPlan(plan);
    expect(serialized.memoryIndex.byTopic["component-boundaries"]?.[0]?.id).toBe("memory-architecture-001");
    expect(JSON.parse(JSON.stringify(serialized))).toMatchObject({
      iterationId: "iteration-0008",
      memoryIndex: {
        byAgent: {
          "general-counsel": [
            {
              id: "memory-legal-001",
            },
          ],
        },
      },
    });

    const packets = createAgentDispatchPackets(plan, { memoryLimit: 2 });
    expect(packets.find((packet) => packet.stage === "core_revision")).toMatchObject({
      retrievedMemoryEntries: expect.arrayContaining([
        expect.objectContaining({ id: "memory-architecture-001" }),
      ]),
      nextActions: expect.arrayContaining([
        expect.objectContaining({ actionType: "close_evidence_debt" }),
      ]),
    });
    expect(packets.find((packet) => packet.stage === "legal_governance_review")).toMatchObject({
      retrievedMemoryEntries: expect.arrayContaining([
        expect.objectContaining({ id: "memory-legal-001" }),
      ]),
    });
  });
});
