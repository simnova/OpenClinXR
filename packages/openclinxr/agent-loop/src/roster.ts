import type { HarnessKind } from "./role-harness-policy.js";
import type {
  ScoreDimension,
  AgentTeam,
  AgentRole,
  AgentMemoryEntry,
  AgentMemoryIndex,
  SerializableAgentMemoryIndex,
  IterationDebt,
  IterationRisk,
  IterationScorecard,
  LegacyScorecard,
  MaturityTrend,
  MaturityDelta,
  WorkOrderStage,
  AgentWorkOrder,
  NextAction,
  LeadershipGate,
  AgentLoopPlan,
  SerializableAgentLoopPlan,
  AgentDispatchPacket,
  BackgroundAgentTaskType,
  BackgroundAgentModelName,
  BackgroundAgentReasoningEffort,
  BackgroundAgentPolicyTier,
  ModelAssistBridge,
  BackgroundAgentModelRecommendation,
  AgentWorkflowSkillId,
  AgentWorkflowSkillRecommendation,
  RecommendBackgroundAgentModelInput,
  CreateAgentLoopPlanInput,
  EvaluateMaturityDeltaInput,
} from "./types.js";

export function role(
  agentId: string,
  team: AgentTeam,
  name: string,
  dimensions: ScoreDimension[],
  memoryTopics: string[],
): AgentRole {
  return { agentId, team, name, dimensions, memoryTopics };
}

export const defaultAgentLoopRoster = {
  version: "agent-loop-roster-v2",
  roles: [
    role("chief-coordinator", "coordinator", "Chief Coordinator", ["implementation_readiness", "adversarial_robustness"], [
      "loop-performance",
      "unresolved-decisions",
    ]),
    role("rubric-steward", "coordinator", "Rubric Steward", ["evidence_discipline", "implementation_readiness"], [
      "score-history",
      "rubric-weights",
    ]),
    role("solution-architect", "core", "Solution Architect", ["technical_feasibility", "architecture_coherence", "implementation_readiness"], [
      "architecture-decisions",
      "component-boundaries",
    ]),
    role("xr-systems-architect", "core", "XR Systems Architect", ["technical_feasibility", "cost_performance_efficiency"], [
      "quest-webxr",
      "asset-pipeline",
    ]),
    role("asset-pipeline-lead", "core", "Asset Pipeline Lead", [
      "technical_feasibility",
      "cost_performance_efficiency",
      "open_source_sustainability",
      "architecture_coherence",
    ], ["humanoid-generation", "glb-optimization", "asset-provenance", "blender-pipeline"]),
    role("clinical-simulation-lead", "core", "Clinical Simulation Lead", ["clinical_validity", "ux_workflow_fit"], [
      "scenario-realism",
      "faculty-review",
    ]),
    role("psychometrics-lead", "core", "Psychometrics Lead", ["psychometric_defensibility", "evidence_discipline"], [
      "validity",
      "rater-calibration",
    ]),
    role("security-privacy-lead", "core", "Security And Privacy Lead", ["security_privacy", "legal_regulatory_resilience"], [
      "consent",
      "audit-logs",
    ]),
    role("implementation-planning-lead", "core", "Implementation Planning Lead", ["implementation_readiness", "architecture_coherence"], [
      "implementation-plan",
      "tdd",
    ]),
    role("local-ai-inference-engineer", "core", "Local AI Inference Engineer", [
      "technical_feasibility",
      "cost_performance_efficiency",
      "open_source_sustainability",
    ], ["local-llm", "mlx", "llama-cpp", "qwen", "deepseek", "kimi", "apple-silicon"]),
    role("voice-speech-engineer", "core", "Voice And Speech Engineer", [
      "technical_feasibility",
      "security_privacy",
      "cost_performance_efficiency",
    ], ["local-voice", "vibevoice", "stt", "tts", "turn-taking", "voice-safety"]),
    role("emergency-medicine-physician", "physicians", "Emergency Medicine Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["ed-realism", "acute-escalation"]),
    role("anesthesiology-critical-care-physician", "physicians", "Anesthesiology And Critical Care Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["airway-hemodynamics", "critical-care"]),
    role("cardiology-physician", "physicians", "Cardiology Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["chest-pain", "cardiac-risk"]),
    role("family-medicine-physician", "physicians", "Family Medicine Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["primary-care", "continuity-of-care"]),
    role("infectious-disease-physician", "physicians", "Infectious Disease Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["infection-control", "antimicrobial-stewardship"]),
    role("internal-medicine-physician", "physicians", "Internal Medicine Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["adult-medicine", "diagnostic-reasoning"]),
    role("neurology-physician", "physicians", "Neurology Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["neurologic-exam", "stroke-recognition"]),
    role("psychiatry-physician", "physicians", "Psychiatry Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["behavioral-health", "suicide-risk"]),
    role("pediatrics-physician", "physicians", "Pediatrics Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["pediatric-assessment", "guardian-communication"]),
    role("radiology-imaging-physician", "physicians", "Radiology Imaging Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["imaging-appropriateness", "diagnostic-imaging"]),
    role("obgyn-physician", "physicians", "Obstetrics And Gynecology Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["pregnancy-triage", "reproductive-health"]),
    role("surgery-physician", "physicians", "Surgery Physician", [
      "clinical_validity",
      "specialty_clinical_generalizability",
    ], ["procedural-triage", "perioperative-risk"]),
    role("general-counsel", "leadership", "General Counsel", ["legal_regulatory_resilience", "evidence_discipline"], [
      "claims-governance",
      "liability",
    ]),
    role("healthcare-compliance-counsel", "legal", "Healthcare Compliance Counsel", ["security_privacy", "legal_regulatory_resilience"], [
      "healthcare-compliance",
      "retention",
    ]),
    role("ai-governance-counsel", "legal", "AI Governance Counsel", ["legal_regulatory_resilience", "security_privacy"], [
      "ai-governance",
      "synthetic-voice",
    ]),
    role("clinical-safety-critic", "adversarial", "Clinical Safety Critic", ["clinical_validity", "specialty_clinical_generalizability"], [
      "clinical-safety",
      "unsafe-assumptions",
    ]),
    role("psychometric-overclaim-critic", "adversarial", "Psychometric Overclaim Critic", [
      "psychometric_defensibility",
      "evidence_discipline",
    ], ["validity-overclaim", "fairness"]),
    role("security-privacy-attacker", "adversarial", "Security And Privacy Attacker", ["security_privacy", "legal_regulatory_resilience"], [
      "threat-model",
      "privacy-exposure",
    ]),
    role("implementation-plan-gap-attacker", "adversarial", "Implementation Plan Gap Attacker", [
      "implementation_readiness",
      "architecture_coherence",
    ], ["plan-gaps", "dependency-gates"]),
    role("cto", "leadership", "Chief Technology Officer", ["technical_feasibility", "cost_performance_efficiency"], [
      "technology-strategy",
      "delivery-risk",
    ]),
    role("chief-medical-officer", "leadership", "Chief Medical Officer", ["clinical_validity", "specialty_clinical_generalizability"], [
      "clinical-safety",
      "physician-acceptance",
    ]),
    role("chief-psychometrician", "leadership", "Chief Psychometrician", ["psychometric_defensibility", "evidence_discipline"], [
      "validity-argument",
      "score-use",
    ]),
  ],
} as const;

