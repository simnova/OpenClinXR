import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildBenchmarkGateReport,
  isQuestManualPerformanceRawReportPath,
  latestJson,
} from "./build-benchmark-gate-report.js";

type BlockerGroup = {
  group_id: string;
  title: string;
  owner: string;
  blockers: string[];
  next_step: string;
};

type BenchmarkGateReport = {
  quest_smoke?: {
    file: string;
    classification: string;
    ready_for_foreground_quest_claim: boolean;
    satisfied_conditions: string[];
    blockers: string[];
  };
  iwsdk_evidence_contract?: {
    file: string;
    generated_at: string;
    status: string;
    ready_for_install_backed_sidecar: boolean;
    ready_for_agent_tooling: boolean;
    ready_for_production_runtime: boolean;
    blockers: string[];
    leadership_posture: {
      statement: string;
      sub_verdicts: Array<{
        area: string;
        status: string;
        blockers: string[];
      }>;
    };
  };
  evidence_freshness?: Array<{
    evidence_id: string;
    file: string | null;
    generated_at: string | null;
    age_hours: number | null;
    max_age_hours: number;
    status: string;
    blockers: string[];
  }>;
  asset_production_readiness_benchmark?: {
    generation_evidence?: {
      generatedHumanRiggingObserved: boolean;
      skinClothingProvenanceObserved: boolean;
      medicalEquipmentLibraryObserved: boolean;
      animationRetargetingObserved: boolean;
      placeholderOnly: boolean;
      blockers: string[];
    };
    optimization_evidence?: {
      lodTiersObserved: boolean;
      textureCompressionBudgetObserved: boolean;
      colliderSimplificationObserved: boolean;
      placeholderOnly: boolean;
      blockers: string[];
    };
    station_budget_evidence?: {
      scenarioId: string;
      source: string;
      requiredAssetCount: number;
      observed: boolean;
      blockers: string[];
      budget: {
        maxVisibleTriangles: number;
        maxTextureMegabytes: number;
        maxDrawCalls: number;
        totalTriangles: number;
        totalTextureMegabytes: number;
        totalDrawCalls: number;
        blockers: string[];
      };
    };
  };
  asset_capability_job_evidence?: {
    summary: {
      allCapabilitiesObserved: boolean;
      allJobsSucceeded: boolean;
      allManifestsObserved: boolean;
      allLicenseProvenanceObserved: boolean;
      zeroSpendObserved: boolean;
      noExternalNetworkObserved: boolean;
      blockers: string[];
    };
    verdict: {
      passed: boolean;
      readyForProductionAssets: false;
      blockers: string[];
    };
  };
  realtime_voice_transport_spike?: {
    round_trip_latency_ms: number;
    latency_budget: {
      targetMs: number;
      passed: boolean;
    };
    python_backend_verifier: {
      status: string;
      blockers: string[];
    };
    verdict: {
      transportContractPassed: boolean;
      readyForLiveDialog: false;
      blockers: string[];
    };
  };
  api_python_backend_runtime_smoke?: {
    status: string;
    health: {
      ok: boolean;
    };
    capabilities?: {
      ok: boolean;
      modes: Array<{ id: string; status: string }>;
    };
    websocket: {
      connected: boolean;
      binaryEchoObserved: boolean;
    };
    verdict: {
      passed: boolean;
      readyForLiveDialog: false;
      blockers: string[];
    };
  };
  evidence_gates: Array<{
    evidence_id: string;
    ready_to_resolve?: boolean;
    satisfied_conditions?: string[];
    blockers: string[];
    blocker_summary?: {
      groups: BlockerGroup[];
    };
  }>;
};

function healthyQuestRuntimeEvidence(): Record<string, unknown> {
  return {
    textPanelEvidence: {
      panelCount: 3,
      panels: [
        {
          name: "openclinxr.ed-chest-pain.in-vr-clinical-panel",
          lineCount: 4,
          readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
        },
        {
          name: "openclinxr.ed-chest-pain.in-vr-dialogue-panel",
          lineCount: 2,
          readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
        },
        {
          name: "openclinxr.ed-chest-pain.in-vr-input-panel",
          lineCount: 3,
          readabilityClaim: "metadata_only_requires_foreground_headset_confirmation",
        },
      ],
    },
    inputEvidence: {
      activeLocomotionSource: "none",
      inputSourceCount: 2,
      inputSourceKinds: ["xr_hand"],
      keyboardVector: { forward: 0, strafe: 0, turn: 0 },
      xrVector: { forward: 0, strafe: 0, turn: 0 },
    },
    frameStats: {
      framesObserved: 120,
      qualitySource: "webxr_animation_loop",
      renderLoopMode: "webxr_animation_loop_with_preview_fallback",
      latestFrameDeltaMs: 16.7,
      longFrameRatio: 0.02,
    },
  };
}

function healthyQuestFrameSampleEvidence(): Record<string, unknown> {
  return {
    timedOut: false,
    latestFrameAgeMs: 16,
    framesObservedDuringProbe: 120,
    qualitySource: "webxr_animation_loop",
    renderLoopMode: "webxr_animation_loop_with_preview_fallback",
    latestFrameDeltaMs: 16.7,
    longFrameRatio: 0.02,
  };
}

describe("benchmark gate report", () => {
  it("selects raw Quest CDP smoke evidence without derived check reports", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-quest-smoke-latest-"));
    const rawPath = path.join(tempDir, "quest-cdp-smoke-2026-05-04.json");
    const derivedCheckPath = path.join(tempDir, "quest-cdp-smoke-check-2026-05-04.json");
    await writeFile(rawPath, `${JSON.stringify({ kind: "raw" })}\n`, "utf8");
    await writeFile(derivedCheckPath, `${JSON.stringify({ kind: "check" })}\n`, "utf8");

    const selected = await latestJson<{ kind: string }>(
      `${tempDir}/quest-cdp-smoke-*.json`,
      (filePath) => path.basename(filePath).startsWith("quest-cdp-smoke-2026-"),
    );

    expect(selected).toEqual({
      file: rawPath,
      value: { kind: "raw" },
    });
  });

  it("selects raw Quest manual performance evidence without derived check reports", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "openclinxr-quest-manual-latest-"));
    const rawPath = path.join(tempDir, "quest-manual-performance-2026-05-04.json");
    const derivedCheckPath = path.join(tempDir, "quest-manual-performance-check-2026-05-04.json");
    await writeFile(rawPath, `${JSON.stringify({ kind: "raw" })}\n`, "utf8");
    await writeFile(derivedCheckPath, `${JSON.stringify({ kind: "check" })}\n`, "utf8");

    const selected = await latestJson<{ kind: string }>(
      `${tempDir}/quest-manual-performance-*.json`,
      isQuestManualPerformanceRawReportPath,
    );

    expect(selected).toEqual({
      file: rawPath,
      value: { kind: "raw" },
    });
  });

  it("keeps resolved local benchmark evidence out of leadership remediation groups", async () => {
    const report = JSON.parse(await readFile(".agent-factory/benchmark-gate-report.json", "utf8")) as BenchmarkGateReport;
    const gate = report.evidence_gates.find((candidate) => candidate.evidence_id === "evidence-leadership-0007-002");

    expect(gate?.blockers).not.toEqual(expect.arrayContaining(["local_model:model_weights_not_selected_or_benchmarked"]));
    expect(gate?.blockers).not.toEqual(expect.arrayContaining(["local_voice:voice_model_not_selected_or_benchmarked"]));
    const groups = gate?.blocker_summary?.groups ?? [];

    expect(groups.map((group) => group.group_id).sort()).toEqual([
      "quest_foreground_frame_pacing",
    ]);
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group_id: "quest_foreground_frame_pacing",
          owner: "xr-systems-architect",
          blockers: expect.arrayContaining([
            "quest_immersive_entry_activation_not_received",
            "quest_immersive_session_not_started",
            "quest_manual_performance:duration_under_10_minutes",
            "quest_manual_performance:frame_sample_under_600_or_missing",
            "quest_manual_performance:controller_select_latency_ms_above_150_or_missing",
          ]),
        }),
      ]),
    );
    expect(groups.every((group) => group.next_step.length > 0)).toBe(true);
  });

  it("blocks leadership gates when non-IWSDK benchmark evidence is stale", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0],
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      questSmoke: {
        file: "docs/openclinxr/quest-cdp-smoke-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          url: "http://localhost:5173/",
          target: "station",
          adb: {
            version: "Android Debug Bridge version 1.0.41",
            deviceLine: "1234 device product:quest3",
            reverseList: "1234 tcp:5173 tcp:5173",
          },
          browser: {
            userAgent: "Mozilla/5.0 Quest 3",
            hidden: false,
            visibilityState: "visible",
            ...healthyQuestRuntimeEvidence(),
          },
          interaction: {},
          frameSample: healthyQuestFrameSampleEvidence(),
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: true,
            immersiveEntryOutcome: "not_requested",
            blockers: [],
          },
        },
      },
      localRuntime: {
        file: "docs/openclinxr/local-runtime-probe-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      localProviderBenchmark: {
        file: "docs/openclinxr/local-provider-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          mockModel: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          mockVoice: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          localModel: { status: "passed", blockers: [], metrics: {} },
          localVoice: { status: "passed", blockers: [], metrics: {} },
          verdict: {
            deterministicMocksPassed: true,
            localModelReadyToBenchmark: true,
            localVoiceReadyToBenchmark: true,
            blockers: [],
          },
        },
      },
      iwsdkEvidenceContract: {
        file: "docs/openclinxr/iwsdk-evidence-contract-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          status: "contract_only",
          verdict: {
            readyForInstallBackedSidecar: false,
            readyForAgentTooling: false,
            readyForProductionRuntime: false,
            blockers: ["sidecar:operator_accepts_iwsdk_install_scope"],
          },
        },
      },
    }, { now: new Date("2026-05-05T01:00:00.000Z"), maxEvidenceAgeHours: 24 });

    expect(report.evidence_freshness).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_id: "quest_smoke",
        status: "stale",
        age_hours: 25,
        blockers: ["quest_smoke:evidence_stale_over_24h"],
      }),
      expect.objectContaining({
        evidence_id: "local_runtime_probe",
        status: "stale",
        age_hours: 25,
        blockers: ["local_runtime_probe:evidence_stale_over_24h"],
      }),
      expect.objectContaining({
        evidence_id: "local_provider_benchmark",
        status: "stale",
        age_hours: 25,
        blockers: ["local_provider_benchmark:evidence_stale_over_24h"],
      }),
    ]));
    expect(report.evidence_freshness?.map((entry) => entry.evidence_id)).not.toContain("iwsdk_evidence_contract");

    expect(report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001")?.blockers).toEqual(
      expect.arrayContaining(["quest_smoke:evidence_stale_over_24h", "local_runtime_probe:evidence_stale_over_24h"]),
    );
    expect(report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-002")?.blockers).toEqual(
      expect.arrayContaining(["local_runtime_probe:evidence_stale_over_24h", "local_provider_benchmark:evidence_stale_over_24h"]),
    );
    expect(report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-004")?.blockers).toEqual([
      "iwsdk:sidecar:operator_accepts_iwsdk_install_scope",
    ]);
  });

  it("splits iteration 0008 benchmark evidence debt by owner-specific leadership gates", async () => {
    const report = JSON.parse(await readFile(".agent-factory/benchmark-gate-report.json", "utf8")) as BenchmarkGateReport;
    const gatesById = new Map(report.evidence_gates.map((gate) => [gate.evidence_id, gate]));

    expect([...gatesById.keys()].sort()).toEqual([
      "evidence-leadership-0007-002",
      "evidence-leadership-0008-001",
      "evidence-leadership-0008-002",
      "evidence-leadership-0008-003",
      "evidence-leadership-0008-004",
      "evidence-leadership-0009-002",
      "evidence-leadership-0009-003",
      "evidence-leadership-0009-004",
      "evidence-leadership-0009-005",
    ]);

    expect(gatesById.get("evidence-leadership-0008-001")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "quest_immersive_entry_activation_not_received",
        "quest_immersive_session_not_started",
        "quest_manual_performance:duration_under_10_minutes",
        "quest_manual_performance:frame_sample_under_600_or_missing",
        "quest_manual_performance:controller_select_latency_ms_above_150_or_missing",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "performed_by_recorded",
        "immersive_session_started",
        "quest_cdp_frame_sample_complete",
        "quest_page_visible",
        "quest_foreground_preflight_ready",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0008-002")).toEqual(expect.objectContaining({
      ready_to_resolve: true,
      blockers: [],
      satisfied_conditions: expect.arrayContaining([
        "local_model_ready_to_benchmark",
        "local_model_runtime_benchmark_passed",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0008-003")).toEqual(expect.objectContaining({
      ready_to_resolve: true,
      blockers: [],
      satisfied_conditions: expect.arrayContaining([
        "local_voice_ready_to_benchmark",
        "local_voice_first_audio_benchmark_passed",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0008-004")).toEqual(expect.objectContaining({
      ready_to_resolve: true,
      blockers: [],
      satisfied_conditions: expect.arrayContaining([
        "asset_pipeline_blender_bake_smoke_passed",
        "asset_pipeline_gltf_pipeline_smoke_passed",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0009-004")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "iwsdk:agent_tooling:phase2_devtools_not_installed_in_sidecar",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "iwsdk_evidence_contract_present",
        "iwsdk_install_backed_sidecar_ready",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0009-002")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "local_model_quality:structured_output:reasoning_markup_emitted",
        "local_model_quality:structured_output:safety_flags_not_guardrail_labels",
        "local_model_quality:structured_output:schema_grammar_not_enforced",
        "local_model_quality:actor_policy:real_local_model_visible_fact_grounding_benchmark_missing",
        "local_model_quality:actor_policy:real_local_model_hidden_truth_injection_benchmark_missing",
        "local_model_quality:actor_policy:real_local_model_system_prompt_extraction_benchmark_missing",
        "local_model_quality:target_hardware:target_hardware_not_m4_profile",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "local_model_quality_report_present",
        "local_model_quality_required_keys_present",
        "local_model_runtime_benchmark_passed",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0009-002")?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_model_quality_actor_policy_benchmark_passed",
    ]));
    expect(gatesById.get("evidence-leadership-0009-003")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "local_voice_live_dialog:runtime_stream:real_local_voice_stream_benchmark_missing",
        "local_voice_live_dialog:runtime:runtime_file_generation_only",
        "local_voice_live_dialog:runtime:real_time_factor_above_1",
        "local_voice_live_dialog:webxr_playback:webxr_playback_not_observed",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "local_voice_first_audio_benchmark_passed",
        "local_voice_live_dialog_mock_stream_passed",
        "local_voice_live_dialog_report_present",
        "local_voice_live_dialog_safety_controls_observed",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0009-005")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "asset_production:source:placeholder_bake_only",
        "asset_production:generation:generated_human_rigging_missing",
        "asset_production:optimization:lod_tiers_missing",
        "asset_production:optimization:texture_compression_budget_missing",
        "asset_production:optimization:collider_simplification_report_missing",
      ]),
      satisfied_conditions: expect.arrayContaining([
        "asset_pipeline_blender_bake_smoke_passed",
        "asset_pipeline_gltf_pipeline_smoke_passed",
        "asset_production_multi_actor_quest_budget_observed",
        "asset_production_readiness_report_present",
        "asset_production_source_smokes_passed",
      ]),
    }));
  });

  it("uses local model quality evidence to replace generic actor-policy blockers with precise findings", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localModelQualityBenchmark?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            structuredOutput: {
              requiredKeysPresent: boolean;
              schemaGrammarEnforced: boolean;
              blockers: string[];
            };
            actorPolicy: {
              passed: boolean;
              blockers: string[];
            };
            targetHardware: {
              passed: boolean;
              blockers: string[];
            };
            verdict: {
              passed: boolean;
              blockers: string[];
              caveats: string[];
            };
          };
        };
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      localRuntime: {
        file: "docs/openclinxr/local-runtime-probe-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      localProviderBenchmark: {
        file: "docs/openclinxr/local-provider-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          mockModel: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          mockVoice: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          localModel: { status: "passed", blockers: [], metrics: {} },
          localVoice: { status: "passed", blockers: [], metrics: {} },
          verdict: {
            deterministicMocksPassed: true,
            localModelReadyToBenchmark: true,
            localVoiceReadyToBenchmark: true,
            blockers: [],
          },
        },
      },
      localModelRuntimeBenchmark: {
        file: "docs/openclinxr/local-model-runtime-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          status: "passed_with_caveats",
          runtime: { device: "MTL0 (Apple M1 Max)" },
          metrics: {},
          output: {},
          verdict: {
            passed: true,
            blockers: [],
            caveats: ["Structured output caveat retained from the runtime smoke."],
          },
        },
      },
      localModelQualityBenchmark: {
        file: "docs/openclinxr/local-model-quality-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          status: "blocked",
          structuredOutput: {
            requiredKeysPresent: true,
            schemaGrammarEnforced: false,
            blockers: ["schema_grammar_not_enforced"],
          },
          actorPolicy: {
            passed: false,
            blockers: [
              "real_local_model_visible_fact_grounding_benchmark_missing",
              "real_local_model_hidden_truth_injection_benchmark_missing",
              "real_local_model_system_prompt_extraction_benchmark_missing",
            ],
          },
          targetHardware: {
            passed: false,
            blockers: ["target_hardware_not_m4_profile"],
          },
          verdict: {
            passed: false,
            blockers: [
              "structured_output:schema_grammar_not_enforced",
              "actor_policy:real_local_model_visible_fact_grounding_benchmark_missing",
              "actor_policy:real_local_model_hidden_truth_injection_benchmark_missing",
              "actor_policy:real_local_model_system_prompt_extraction_benchmark_missing",
              "target_hardware:target_hardware_not_m4_profile",
            ],
            caveats: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:05:00.000Z"), maxEvidenceAgeHours: 24 });

    const qualityGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-002");

    expect(qualityGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_model_quality_report_present",
      "local_model_quality_required_keys_present",
    ]));
    expect(qualityGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_model_quality_actor_policy_benchmark_passed",
    ]));
    expect(qualityGate?.blockers).toEqual(expect.arrayContaining([
      "local_model_quality:actor_policy:real_local_model_visible_fact_grounding_benchmark_missing",
      "local_model_quality:actor_policy:real_local_model_hidden_truth_injection_benchmark_missing",
      "local_model_quality:actor_policy:real_local_model_system_prompt_extraction_benchmark_missing",
      "local_model_quality:structured_output:schema_grammar_not_enforced",
      "local_model_quality:target_hardware:target_hardware_not_m4_profile",
    ]));
    expect(qualityGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_model_quality:missing_hidden_truth_actor_policy_benchmark",
      "local_model_quality:actor_policy:real_local_model_actor_policy_benchmark_missing",
      "local_model_quality:missing_schema_grammar_benchmark",
    ]));
  });

  it("uses local voice live-dialog evidence to replace generic streaming blockers with precise findings", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        localVoiceLiveDialogBenchmark?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            mockStream: {
              passed: boolean;
              blockers: string[];
            };
            runtimeFit: {
              blockers: string[];
            };
            webxrPlayback: {
              observed: boolean;
              blockers: string[];
            };
            safetyControls: {
              blockers: string[];
            };
            verdict: {
              passed: boolean;
              blockers: string[];
              caveats: string[];
            };
          };
        };
        realtimeVoiceTransportSpike?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            harness: {
              roundTripLatencyMs: number;
              latencyBudget: {
                targetMs: number;
                passed: boolean;
              };
            };
            pythonBackendVerifier: {
              status: string;
              blockers: string[];
            };
            protocolEvidence?: {
              websocketLocalHarnessObserved: boolean;
              bunHonoRuntimeObserved: boolean;
              webTransportObserved: boolean;
              quicObserved: boolean;
              web3SignalingObserved: boolean;
              notes: string[];
            };
            verdict: {
              transportContractPassed: boolean;
              readyForLiveDialog: false;
              blockers: string[];
              caveats: string[];
            };
          };
        };
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      localRuntime: {
        file: "docs/openclinxr/local-runtime-probe-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      localProviderBenchmark: {
        file: "docs/openclinxr/local-provider-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          mockModel: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          mockVoice: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          localModel: { status: "passed", blockers: [], metrics: {} },
          localVoice: { status: "passed", blockers: [], metrics: {} },
          verdict: {
            deterministicMocksPassed: true,
            localModelReadyToBenchmark: true,
            localVoiceReadyToBenchmark: true,
            blockers: [],
          },
        },
      },
      localVoiceRuntimeBenchmark: {
        file: "docs/openclinxr/local-voice-runtime-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          status: "passed_with_caveats",
          runtime: {},
          audio: {},
          metrics: { realTimeFactor: 5.24 },
          verdict: {
            passed: true,
            blockers: [],
            caveats: ["This measured file-based local generation."],
          },
        },
      },
      localVoiceLiveDialogBenchmark: {
        file: "docs/openclinxr/local-voice-live-dialog-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:15:00.000Z",
          status: "blocked",
          mockStream: {
            passed: true,
            blockers: [],
          },
          runtimeFit: {
            blockers: ["runtime_file_generation_only", "real_time_factor_above_1"],
          },
          runtimeStream: {
            realLocalVoiceStreamObserved: false,
            blockers: ["real_local_voice_stream_benchmark_missing"],
          },
          webxrPlayback: {
            observed: false,
            blockers: ["webxr_playback_not_observed"],
          },
          safetyControls: {
            blockers: [],
          },
          verdict: {
            passed: false,
            blockers: [
              "runtime_stream:real_local_voice_stream_benchmark_missing",
              "runtime:runtime_file_generation_only",
              "runtime:real_time_factor_above_1",
              "webxr_playback:webxr_playback_not_observed",
            ],
            caveats: [],
          },
        },
      },
      realtimeVoiceTransportSpike: {
        file: "docs/openclinxr/realtime-voice-transport-spike-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:16:00.000Z",
          status: "transport_spike_passed",
          harness: {
            roundTripLatencyMs: 42,
            audioMetadataFramesSent: 2,
            audioChunkMetadataReceived: 2,
            frameLatencySamplesMs: [11, 13],
            audioChunkIndexesReceived: [0, 1],
            latencyBudget: {
              targetMs: 250,
              passed: true,
            },
          },
          pythonBackendVerifier: {
            status: "passed",
            blockers: [],
          },
          protocolEvidence: {
            websocketLocalHarnessObserved: true,
            bunHonoRuntimeObserved: false,
            webTransportObserved: false,
            quicObserved: false,
            web3SignalingObserved: false,
            notes: [
              "Only the local WebSocket transport harness has execution evidence in this report.",
              "WebTransport, direct QUIC, and Web3 signaling remain proposal- and evidence-gated.",
            ],
          },
          verdict: {
            transportContractPassed: true,
            readyForLiveDialog: false,
            blockers: ["real_moshi_or_qwen3_inference_not_observed"],
            caveats: [],
          },
        },
      },
      apiPythonBackendRuntimeSmoke: {
        file: "docs/openclinxr/api-python-backend-runtime-smoke-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:17:00.000Z",
          status: "passed",
          policy: {
            cloudApisUsed: false,
            paidApisUsed: false,
            modelDownloadsUsed: false,
            committedGeneratedAudio: false,
            productionUseAllowed: false,
          },
          python: {
            executable: ".openclinxr-local/api-python-backend-venv/bin/python",
            version: "Python 3.11.4",
            dependencies: {
              fastapi: "available",
              uvicorn: "available",
              websockets: "available",
            },
            missingPackages: [],
          },
          server: {
            attempted: true,
            command: ["python", "-m", "uvicorn"],
            port: 8765,
            stdout: [],
            stderr: [],
          },
          health: {
            attempted: true,
            ok: true,
            statusCode: 200,
            latencyMs: 10,
            body: { status: "ok" },
          },
          capabilities: {
            attempted: true,
            ok: true,
            statusCode: 200,
            latencyMs: 11,
            modes: [
              { id: "transport-echo", status: "ready", blockers: [] },
              { id: "moshi-mlx", status: "approved_runtime_missing", blockers: ["model_weights_not_installed", "mlx_runtime_not_installed", "real_inference_not_observed"] },
              { id: "qwen3-tts-mlx", status: "approved_runtime_missing", blockers: ["model_weights_not_installed", "mlx_runtime_not_installed", "real_inference_not_observed"] },
            ],
            body: { defaultMode: "transport-echo" },
          },
          websocket: {
            attempted: true,
            connected: true,
            jsonMessages: 5,
            binaryMessages: 1,
            controlAckObserved: true,
            audioMetadataObserved: true,
            transcriptDeltaObserved: true,
            binaryEchoObserved: true,
            latencyMs: 8,
          },
          verdict: {
            passed: true,
            readyForLiveDialog: false,
            blockers: [],
            caveats: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:20:00.000Z"), maxEvidenceAgeHours: 24 });

    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(liveDialogGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "local_voice_live_dialog_report_present",
      "local_voice_live_dialog_mock_stream_passed",
      "local_voice_live_dialog_safety_controls_observed",
      "local_voice_realtime_transport_contract_observed",
      "local_voice_python_backend_runtime_smoke_passed",
    ]));
    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:runtime_stream:real_local_voice_stream_benchmark_missing",
      "local_voice_live_dialog:runtime:runtime_file_generation_only",
      "local_voice_live_dialog:runtime:real_time_factor_above_1",
      "local_voice_live_dialog:webxr_playback:webxr_playback_not_observed",
      "local_voice_live_dialog:realtime_transport_spike:real_moshi_or_qwen3_inference_not_observed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog_runtime_stream_observed",
    ]));
    expect(liveDialogGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog:missing_streaming_webxr_playback_benchmark",
      "local_voice_live_dialog:missing_disclosure_retention_misuse_controls",
      "local_voice_live_dialog:realtime_transport_spike:transport_contract_failed",
    ]));
    expect(report.realtime_voice_transport_spike).toMatchObject({
      round_trip_latency_ms: 42,
      audio_metadata_frames_sent: 2,
      audio_chunk_metadata_received: 2,
      frame_latency_samples_ms: [11, 13],
      audio_chunk_indexes_received: [0, 1],
      latency_budget: {
        targetMs: 250,
        passed: true,
      },
      protocol_evidence: {
        websocket_local_harness_observed: true,
        bun_hono_runtime_observed: false,
        webtransport_observed: false,
        quic_observed: false,
        web3_signaling_observed: false,
      },
      python_backend_verifier: {
        status: "passed",
        blockers: [],
      },
      verdict: {
        transportContractPassed: true,
        readyForLiveDialog: false,
      },
    });
    expect(report.api_python_backend_runtime_smoke).toMatchObject({
      status: "passed",
      health: { ok: true },
      capabilities: {
        ok: true,
        modes: [
          { id: "transport-echo", status: "ready" },
          { id: "moshi-mlx", status: "approved_runtime_missing" },
          { id: "qwen3-tts-mlx", status: "approved_runtime_missing" },
        ],
      },
      websocket: {
        connected: true,
        binaryEchoObserved: true,
      },
      verdict: {
        passed: true,
        readyForLiveDialog: false,
      },
    });
  });

  it("blocks realtime voice evidence when frame metadata is incomplete or mismatched", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0],
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      realtimeVoiceTransportSpike: {
        file: "docs/openclinxr/realtime-voice-transport-spike-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:16:00.000Z",
          status: "transport_spike_passed",
          harness: {
            roundTripLatencyMs: 42,
            audioMetadataFramesSent: 2,
            audioChunkMetadataReceived: 1,
            frameLatencySamplesMs: [],
            audioChunkIndexesReceived: [1],
            latencyBudget: {
              targetMs: 250,
              passed: true,
            },
          },
          pythonBackendVerifier: {
            status: "passed",
            blockers: [],
          },
          protocolEvidence: {
            websocketLocalHarnessObserved: true,
            bunHonoRuntimeObserved: false,
            webTransportObserved: false,
            quicObserved: false,
            web3SignalingObserved: false,
            notes: [],
          },
          verdict: {
            transportContractPassed: true,
            readyForLiveDialog: false,
            blockers: [],
            caveats: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:20:00.000Z"), maxEvidenceAgeHours: 24 });

    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:realtime_transport_spike:audio_metadata_count_mismatch",
      "local_voice_live_dialog:realtime_transport_spike:frame_latency_samples_incomplete",
      "local_voice_live_dialog:realtime_transport_spike:audio_chunk_indexes_not_contiguous",
    ]));
    expect(liveDialogGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog:realtime_transport_spike:transport_contract_failed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_realtime_transport_contract_observed",
    ]));
  });

  it("blocks realtime voice evidence when latency budget contradicts the transport verdict", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0],
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      realtimeVoiceTransportSpike: {
        file: "docs/openclinxr/realtime-voice-transport-spike-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:16:00.000Z",
          status: "transport_spike_passed",
          harness: {
            roundTripLatencyMs: 425,
            audioMetadataFramesSent: 2,
            audioChunkMetadataReceived: 2,
            frameLatencySamplesMs: [12, -1],
            audioChunkIndexesReceived: [0, 1],
            latencyBudget: {
              targetMs: 250,
              passed: false,
            },
          },
          pythonBackendVerifier: {
            status: "passed",
            blockers: [],
          },
          protocolEvidence: {
            websocketLocalHarnessObserved: true,
            bunHonoRuntimeObserved: false,
            webTransportObserved: false,
            quicObserved: false,
            web3SignalingObserved: false,
            notes: [],
          },
          verdict: {
            transportContractPassed: true,
            readyForLiveDialog: false,
            blockers: [],
            caveats: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:20:00.000Z"), maxEvidenceAgeHours: 24 });

    const liveDialogGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-003");

    expect(liveDialogGate?.blockers).toEqual(expect.arrayContaining([
      "local_voice_live_dialog:realtime_transport_spike:latency_budget_failed",
      "local_voice_live_dialog:realtime_transport_spike:frame_latency_samples_invalid",
    ]));
    expect(liveDialogGate?.blockers).not.toEqual(expect.arrayContaining([
      "local_voice_live_dialog:realtime_transport_spike:transport_contract_failed",
    ]));
    expect(liveDialogGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "local_voice_realtime_transport_contract_observed",
    ]));
  });

  it("uses asset production readiness evidence to replace generic placeholder asset blockers", () => {
    const buildReport = buildBenchmarkGateReport as (
      input: Parameters<typeof buildBenchmarkGateReport>[0] & {
        assetProductionReadinessBenchmark?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            sourceEvidence: {
              gltfPipelineSmokePassed: boolean;
              blenderBakeSmokePassed: boolean;
              placeholderBakeOnly: boolean;
              blockers: string[];
            };
            productionProofs: Record<string, { observed: boolean; blockers: string[] }>;
            generationEvidence: {
              generatedHumanRiggingObserved: boolean;
              skinClothingProvenanceObserved: boolean;
              medicalEquipmentLibraryObserved: boolean;
              animationRetargetingObserved: boolean;
              placeholderOnly: boolean;
              blockers: string[];
            };
            optimizationEvidence: {
              lodTiersObserved: boolean;
              textureCompressionBudgetObserved: boolean;
              colliderSimplificationObserved: boolean;
              placeholderOnly: boolean;
              blockers: string[];
            };
            stationBudgetEvidence: {
              scenarioId: string;
              source: string;
              requiredAssetCount: number;
              observed: boolean;
              blockers: string[];
              budget: {
                maxVisibleTriangles: number;
                maxTextureMegabytes: number;
                maxDrawCalls: number;
                totalTriangles: number;
                totalTextureMegabytes: number;
                totalDrawCalls: number;
                blockers: string[];
              };
            };
            runtimeBudget: {
              multiActorBudgetObserved: boolean;
              blockers: string[];
            };
            verdict: {
              passed: boolean;
              blockers: string[];
              caveats: string[];
            };
          };
        };
        assetCapabilityJobEvidence?: {
          file: string;
          value: {
            generatedAt: string;
            status: string;
            policy: {
              cloudApisUsed: false;
              paidApisUsed: false;
              externalNetworkAllowed: false;
              spendLimitCents: 0;
              productionArtifactClaimed: false;
            };
            summary: {
              allCapabilitiesObserved: boolean;
              allJobsSucceeded: boolean;
              allManifestsObserved: boolean;
              allLicenseProvenanceObserved: boolean;
              zeroSpendObserved: boolean;
              noExternalNetworkObserved: boolean;
              blockers: string[];
            };
            jobs: Array<{ capabilityId: string; passed: boolean; blockers: string[] }>;
            verdict: {
              passed: boolean;
              readyForProductionAssets: false;
              blockers: string[];
              caveats: string[];
            };
          };
        };
      },
      options: { now: Date; maxEvidenceAgeHours: number },
    ) => BenchmarkGateReport;
    const report = buildReport({
      localRuntime: {
        file: "docs/openclinxr/local-runtime-probe-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      gltfPipelineSmoke: {
        file: "docs/openclinxr/gltf-pipeline-smoke-2026-05-03.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          tool: { command: "gltf-pipeline", package: "gltf-pipeline", version: "4.3.1", license: "Apache-2.0" },
          output: { glbBytes: 848, magic: "glTF", version: 2, declaredLength: 848, elapsedMs: 1 },
          verdict: { passed: true, blockers: [] },
        },
      },
      blenderAssetBakeSmoke: {
        file: "docs/openclinxr/blender-asset-bake-smoke-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:00:00.000Z",
          tool: { command: "blender", package: "Blender", version: "Blender 5.1.1", license: "GPL-3.0-or-later-tooling" },
          input: {
            fixture: "low_poly_clinical_humanoid",
            externalAssetsUsed: false,
            sourceLicensePosture: "repo_generated_placeholder",
            expectedObjectCount: 7,
          },
          output: { glbBytes: 27284, magic: "glTF", version: 2, declaredLength: 27284, elapsedMs: 1 },
          verdict: { passed: true, blockers: [] },
        },
      },
      assetProductionReadinessBenchmark: {
        file: "docs/openclinxr/asset-production-readiness-benchmark-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:30:00.000Z",
          status: "blocked",
          sourceEvidence: {
            gltfPipelineSmokePassed: true,
            blenderBakeSmokePassed: true,
            placeholderBakeOnly: true,
            blockers: ["placeholder_bake_only"],
          },
          productionProofs: {
            generatedHumanRigging: { observed: false, blockers: ["generated_human_rigging_missing"] },
            skinClothingProvenance: { observed: false, blockers: ["skin_clothing_provenance_missing"] },
            medicalEquipmentLibrary: { observed: false, blockers: ["medical_equipment_library_missing"] },
            animationRetargeting: { observed: false, blockers: ["animation_retargeting_missing"] },
            lodTextureColliderBudget: {
              observed: false,
              blockers: [
                "lod_tiers_missing",
                "texture_compression_budget_missing",
                "collider_simplification_report_missing",
              ],
            },
            multiActorQuestBudget: { observed: false, blockers: ["multi_actor_quest_budget_missing"] },
          },
          generationEvidence: {
            generatedHumanRiggingObserved: false,
            skinClothingProvenanceObserved: false,
            medicalEquipmentLibraryObserved: false,
            animationRetargetingObserved: false,
            placeholderOnly: true,
            blockers: [
              "generated_human_rigging_missing",
              "skin_clothing_provenance_missing",
              "medical_equipment_library_missing",
              "animation_retargeting_missing",
            ],
          },
          optimizationEvidence: {
            lodTiersObserved: false,
            textureCompressionBudgetObserved: false,
            colliderSimplificationObserved: false,
            placeholderOnly: true,
            blockers: [
              "lod_tiers_missing",
              "texture_compression_budget_missing",
              "collider_simplification_report_missing",
            ],
          },
          stationBudgetEvidence: {
            scenarioId: "ed_chest_pain_priority_v1",
            source: "@openclinxr/asset-registry:createEdChestPainPlaceholderManifests",
            requiredAssetCount: 3,
            observed: true,
            blockers: [],
            budget: {
              maxVisibleTriangles: 180000,
              maxTextureMegabytes: 512,
              maxDrawCalls: 120,
              totalTriangles: 60000,
              totalTextureMegabytes: 80,
              totalDrawCalls: 28,
              blockers: [],
            },
          },
          runtimeBudget: {
            multiActorBudgetObserved: false,
            blockers: ["multi_actor_quest_budget_missing"],
          },
          verdict: {
            passed: false,
            blockers: [
              "source:placeholder_bake_only",
              "generation:generated_human_rigging_missing",
              "generation:skin_clothing_provenance_missing",
              "generation:medical_equipment_library_missing",
              "generation:animation_retargeting_missing",
              "optimization:lod_tiers_missing",
              "optimization:texture_compression_budget_missing",
              "optimization:collider_simplification_report_missing",
              "runtime:multi_actor_quest_budget_missing",
            ],
            caveats: [],
          },
        },
      },
      assetCapabilityJobEvidence: {
        file: "docs/openclinxr/asset-capability-job-evidence-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T20:25:00.000Z",
          status: "passed",
          policy: {
            cloudApisUsed: false,
            paidApisUsed: false,
            externalNetworkAllowed: false,
            spendLimitCents: 0,
            productionArtifactClaimed: false,
          },
          summary: {
            allCapabilitiesObserved: true,
            allJobsSucceeded: true,
            allManifestsObserved: true,
            allLicenseProvenanceObserved: true,
            zeroSpendObserved: true,
            noExternalNetworkObserved: true,
            blockers: [],
          },
          jobs: [
            { capabilityId: "character-generation", passed: true, blockers: [] },
            { capabilityId: "medical-equipment-generation", passed: true, blockers: [] },
            { capabilityId: "voice-asset-generation", passed: true, blockers: [] },
            { capabilityId: "animation-generation", passed: true, blockers: [] },
            { capabilityId: "asset-bake", passed: true, blockers: [] },
          ],
          verdict: {
            passed: true,
            readyForProductionAssets: false,
            blockers: [],
            caveats: ["Deterministic control-plane evidence only."],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:35:00.000Z"), maxEvidenceAgeHours: 24 });

    const assetGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-005");

    expect(assetGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "asset_pipeline_blender_bake_smoke_passed",
      "asset_pipeline_gltf_pipeline_smoke_passed",
      "asset_production_capability_job_contract_observed",
      "asset_production_readiness_report_present",
      "asset_production_source_smokes_passed",
    ]));
    expect(assetGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "asset_production_generated_human_rigging_observed",
      "asset_production_skin_clothing_provenance_observed",
      "asset_production_medical_equipment_library_observed",
      "asset_production_animation_retargeting_observed",
    ]));
    expect(assetGate?.satisfied_conditions).not.toEqual(expect.arrayContaining([
      "asset_production_lod_tiers_observed",
      "asset_production_texture_compression_budget_observed",
      "asset_production_collider_simplification_observed",
    ]));
    expect(assetGate?.blockers).toEqual(expect.arrayContaining([
      "asset_production:source:placeholder_bake_only",
      "asset_production:generation:generated_human_rigging_missing",
      "asset_production:generation:medical_equipment_library_missing",
      "asset_production:optimization:lod_tiers_missing",
      "asset_production:optimization:texture_compression_budget_missing",
      "asset_production:optimization:collider_simplification_report_missing",
      "asset_production:runtime:multi_actor_quest_budget_missing",
    ]));
    expect(assetGate?.blockers).not.toEqual(expect.arrayContaining([
      "asset_production:missing_asset_capability_job_evidence_report",
      "asset_production:asset_capability_job_contract_failed",
      "asset_production:missing_generated_human_rigging_report",
      "asset_production:missing_lod_texture_collider_budget_report",
      "asset_production:missing_multi_actor_quest_budget_report",
      "asset_production:placeholder_bake_only",
    ]));
    expect(assetGate?.blockers.some((blocker) => blocker.startsWith("asset_production:proof:"))).toBe(false);
    expect(report.asset_capability_job_evidence?.summary).toMatchObject({
      allCapabilitiesObserved: true,
      allJobsSucceeded: true,
      allManifestsObserved: true,
      allLicenseProvenanceObserved: true,
      zeroSpendObserved: true,
      noExternalNetworkObserved: true,
      blockers: [],
    });
    expect(report.asset_capability_job_evidence?.verdict).toMatchObject({
      passed: true,
      readyForProductionAssets: false,
      blockers: [],
    });
    expect(report.asset_production_readiness_benchmark?.station_budget_evidence).toEqual({
      scenarioId: "ed_chest_pain_priority_v1",
      source: "@openclinxr/asset-registry:createEdChestPainPlaceholderManifests",
      requiredAssetCount: 3,
      observed: true,
      blockers: [],
      budget: {
        maxVisibleTriangles: 180000,
        maxTextureMegabytes: 512,
        maxDrawCalls: 120,
        totalTriangles: 60000,
        totalTextureMegabytes: 80,
        totalDrawCalls: 28,
        blockers: [],
      },
    });
    expect(report.asset_production_readiness_benchmark?.generation_evidence).toEqual({
      generatedHumanRiggingObserved: false,
      skinClothingProvenanceObserved: false,
      medicalEquipmentLibraryObserved: false,
      animationRetargetingObserved: false,
      placeholderOnly: true,
      blockers: [
        "generated_human_rigging_missing",
        "skin_clothing_provenance_missing",
        "medical_equipment_library_missing",
        "animation_retargeting_missing",
      ],
    });
    expect(report.asset_production_readiness_benchmark?.optimization_evidence).toEqual({
      lodTiersObserved: false,
      textureCompressionBudgetObserved: false,
      colliderSimplificationObserved: false,
      placeholderOnly: true,
      blockers: [
        "lod_tiers_missing",
        "texture_compression_budget_missing",
        "collider_simplification_report_missing",
      ],
    });
  });

  it("summarizes missing Blender asset evidence as an asset-pipeline group", () => {
    const report = buildBenchmarkGateReport({
      localRuntime: {
        file: "runtime.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "blocked", blockers: ["missing_blender"] },
          },
        },
      },
    });
    const groups = report.evidence_gates[0]?.blocker_summary.groups ?? [];

    expect(groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        group_id: "asset_pipeline_blender",
        owner: "asset-pipeline-lead",
        blockers: expect.arrayContaining(["asset_pipeline:missing_blender", "missing_blender_asset_bake_smoke_report"]),
      }),
    ]));
  });

  it("includes Quest foreground preflight blockers in Quest leadership evidence", () => {
    const report = buildBenchmarkGateReport({
      localRuntime: {
        file: "runtime.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: {
              status: "blocked",
              blockers: ["quest_3_asleep_or_not_foreground_ready"],
            },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(questGate?.blockers).toEqual(expect.arrayContaining([
      "quest_foreground_preflight:quest_3_asleep_or_not_foreground_ready",
    ]));
    expect(questGate?.blocker_summary.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        group_id: "quest_foreground_frame_pacing",
        blockers: expect.arrayContaining(["quest_foreground_preflight:quest_3_asleep_or_not_foreground_ready"]),
      }),
    ]));
  });

  it("surfaces IWSDK evidence contract status as a dedicated leadership gate", () => {
    const report = buildBenchmarkGateReport({
      iwsdkEvidenceContract: {
        file: "docs/openclinxr/iwsdk-evidence-contract-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          status: "contract_only",
          verdict: {
            readyForInstallBackedSidecar: false,
            readyForAgentTooling: false,
            readyForProductionRuntime: false,
            blockers: [
              "sidecar:operator_accepts_iwsdk_install_scope",
              "sidecar:exact_iwsdk_versions_selected",
              "sidecar:license_review_accepts_transitive_dependency_posture",
              "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
              "agent_tooling:adapter_sync_not_recorded",
              "production_runtime:missing_foreground_quest_preflight_ready",
              "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
            ],
          },
        },
      },
    });

    expect(report.iwsdk_evidence_contract).toEqual({
      file: "docs/openclinxr/iwsdk-evidence-contract-2026-05-04.json",
      generated_at: "2026-05-04T00:00:00.000Z",
      status: "contract_only",
      ready_for_install_backed_sidecar: false,
      ready_for_agent_tooling: false,
      ready_for_production_runtime: false,
      blockers: [
        "agent_tooling:adapter_sync_not_recorded",
        "compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major",
        "metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2",
        "production_runtime:missing_foreground_quest_preflight_ready",
        "sidecar:exact_iwsdk_versions_selected",
        "sidecar:license_review_accepts_transitive_dependency_posture",
        "sidecar:operator_accepts_iwsdk_install_scope",
      ],
      leadership_posture: {
        statement: "IWSDK is MIT-licensed and architecturally relevant for Three/WebXR/AI-MCP inspection, but OpenClinXR remains contract-only: no @iwsdk packages installed, no reference warmup, no production runtime claim, and no Quest readiness claim until the local sidecar and manual foreground gates pass.",
        sub_verdicts: [
          {
            area: "license_posture",
            status: "blocked",
            blockers: ["sidecar:license_review_accepts_transitive_dependency_posture"],
          },
          {
            area: "runtime_fit",
            status: "blocked",
            blockers: ["sidecar:exact_iwsdk_versions_selected"],
          },
          {
            area: "vite_fit",
            status: "blocked",
            blockers: ["compatibility:vite_plugin_peer_range_does_not_accept_openclinxr_vite_major"],
          },
          {
            area: "ai_mcp_tooling",
            status: "blocked",
            blockers: ["agent_tooling:adapter_sync_not_recorded"],
          },
          {
            area: "quest_manual",
            status: "blocked",
            blockers: ["production_runtime:missing_foreground_quest_preflight_ready"],
          },
          {
            area: "local_only",
            status: "blocked",
            blockers: ["sidecar:operator_accepts_iwsdk_install_scope"],
          },
          {
            area: "reference_downloads",
            status: "blocked",
            blockers: ["metadata_drift:package_metadata_drift:@iwsdk/reference:docs_0.3.1_npm_0.3.2"],
          },
        ],
      },
    });
    const blenderGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-004");
    const iwsdkGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0009-004");

    expect(blenderGate).toEqual(expect.objectContaining({
      evidence_id: "evidence-leadership-0008-004",
      blockers: expect.arrayContaining(["missing_local_runtime_probe_report", "missing_gltf_pipeline_smoke_report", "missing_blender_asset_bake_smoke_report"]),
    }));
    expect(iwsdkGate).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      satisfied_conditions: ["iwsdk_evidence_contract_present"],
      blockers: expect.arrayContaining([
        "iwsdk:agent_tooling:adapter_sync_not_recorded",
        "iwsdk:sidecar:operator_accepts_iwsdk_install_scope",
      ]),
    }));
    expect(iwsdkGate?.blocker_summary?.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        group_id: "iwsdk_sidecar_tooling",
        owner: "xr-systems-architect",
        blockers: expect.arrayContaining([
          "iwsdk:agent_tooling:adapter_sync_not_recorded",
          "iwsdk:sidecar:operator_accepts_iwsdk_install_scope",
        ]),
      }),
    ]));
  });

  it("derives Quest manual performance checks from raw foreground headset reports", () => {
    const report = buildBenchmarkGateReport({
      questSmoke: {
        file: "quest.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          url: "http://localhost:5173/",
          target: "station",
          adb: {
            version: "Android Debug Bridge version 1.0.41",
            deviceLine: "1234 device product:quest3",
            reverseList: "1234 tcp:5173 tcp:5173",
          },
          browser: {
            userAgent: "Mozilla/5.0 Quest 3",
            hidden: false,
            visibilityState: "visible",
          },
          interaction: {},
          frameSample: {},
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: false,
            immersiveEntryOutcome: "not_requested",
            blockers: ["quest_cdp_frame_sample_incomplete"],
          },
        },
      },
      questManualPerformanceReport: {
        file: "docs/openclinxr/quest-manual-performance-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          runContext: {
            performedBy: "xr-systems-architect",
            durationMinutes: 10,
          },
          setup: {
            foregroundPageConfirmed: true,
            devtoolsScreencastDisabled: true,
            extraBrowserWindowsClosed: true,
          },
          station: {
            shellLoaded: true,
            traceInteractionPassed: true,
            textReadable: true,
            immersiveSessionStarted: true,
            consoleErrors: [],
          },
          experience: {
            modeId: "full_vr",
            phaseLabel: "Phase 1 Full VR",
            requestedSessionMode: "immersive-vr",
            mixedRealityPassthroughImplemented: false,
          },
          input: {
            handModelCount: 2,
            handModelStatus: "active",
            handInputsObserved: 2,
            locomotionMode: "thumbstick",
            activeLocomotionSource: "xr_gamepad",
            lastLocomotionAtMs: 60_000,
            rigPosition: { x: 0.4, z: -0.2 },
          },
          performance: {
            source: "window.__openClinXrFrameStats",
            framesObserved: 600,
            sampleWindowSize: 120,
            firstFrameAtMs: 1000,
            previewFramesObserved: 0,
            immersiveFramesObserved: 600,
            avgFps: 72,
            p95FrameMs: 25,
            minimumObservedFps: 60,
            controllerSelectLatencyMs: 140,
          },
          comfort: {
            motionComfort: "comfortable",
            heatConcern: false,
            batteryDropPercent: 2,
          },
        },
      },
      localRuntime: {
        file: "runtime.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
    });
    const questGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-001");

    expect(report.quest_manual_performance?.file).toBe("docs/openclinxr/quest-manual-performance-2026-05-04.json");
    expect(report.quest_manual_performance?.input_file).toBe("docs/openclinxr/quest-manual-performance-2026-05-04.json");
    expect(report.quest_manual_performance?.adversarial_findings).toEqual([]);
    expect(report.quest_smoke).toEqual(expect.objectContaining({
      classification: "blocked",
      ready_for_foreground_quest_claim: false,
      blockers: expect.arrayContaining([
        "quest_cdp_frame_sample_incomplete",
        "quest_frame_stats_missing",
      ]),
    }));
    expect(questGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "quest_manual_frame_pacing_ready",
      "performed_by_recorded",
      "immersive_session_started",
      "frame_sample_600_or_more",
      "immersive_frame_count_recorded",
      "rolling_frame_window_120_or_more",
      "average_fps_72_or_higher",
      "p95_frame_ms_25_or_lower",
      "controller_select_latency_150ms_or_lower",
      "hand_or_controller_input_observed",
      "locomotion_observed",
    ]));
    expect(questGate?.blockers).not.toContain("quest_manual_performance:missing_quest_manual_performance_report");
  });

  it("marks the leadership evidence gate ready when all fixture evidence is satisfied", () => {
    const report = buildBenchmarkGateReport({
      questSmoke: {
        file: "quest.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          url: "http://localhost:5173/",
          target: "station",
          adb: {
            version: "Android Debug Bridge version 1.0.41",
            deviceLine: "1234 device product:quest3",
            reverseList: "1234 tcp:5173 tcp:5173",
          },
          browser: {
            userAgent: "Mozilla/5.0 Quest 3",
            hidden: false,
            visibilityState: "visible",
            ...healthyQuestRuntimeEvidence(),
          },
          interaction: {},
          frameSample: healthyQuestFrameSampleEvidence(),
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: true,
            immersiveEntryOutcome: "not_requested",
            blockers: [],
          },
        },
      },
      questManualPerformance: {
        file: "quest-manual.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          inputFile: "manual-input.json",
          readyToClaimFramePacing: true,
          satisfiedConditions: ["average_fps_72_or_higher"],
          blockers: [],
          adversarialFindings: [],
          nextSteps: [],
        },
      },
      localRuntime: {
        file: "runtime.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          gates: {
            questUsb: { status: "ready", blockers: [] },
            questForegroundPreflight: { status: "ready", blockers: [] },
            localModel: { status: "ready", blockers: [] },
            localVoice: { status: "ready", blockers: [] },
            assetPipeline: { status: "ready", blockers: [] },
          },
        },
      },
      gltfPipelineSmoke: {
        file: "gltf.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          tool: { command: "gltf-pipeline", package: "gltf-pipeline", version: "4.3.1", license: "Apache-2.0" },
          output: { glbBytes: 1024, magic: "glTF", version: 2, declaredLength: 1024, elapsedMs: 10 },
          verdict: { passed: true, blockers: [] },
        },
      },
      blenderAssetBakeSmoke: {
        file: "blender.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          tool: { command: "blender", package: "Blender", version: "Blender 5.1.1", license: "GPL-3.0-or-later-tooling" },
          input: {
            fixture: "low_poly_clinical_humanoid",
            externalAssetsUsed: false,
            sourceLicensePosture: "repo_generated_placeholder",
            expectedObjectCount: 7,
          },
          output: { glbBytes: 4096, magic: "glTF", version: 2, declaredLength: 4096, elapsedMs: 2500 },
          verdict: { passed: true, blockers: [] },
        },
      },
      localProviderBenchmark: {
        file: "provider.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          mockModel: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          mockVoice: { status: "passed", latencyMs: 1, blockers: [], metrics: {} },
          localModel: { status: "passed", blockers: [], metrics: {} },
          localVoice: { status: "passed", blockers: [], metrics: {} },
          verdict: {
            deterministicMocksPassed: true,
            localModelReadyToBenchmark: true,
            localVoiceReadyToBenchmark: true,
            blockers: [],
          },
        },
      },
    }, { now: new Date("2026-05-04T20:20:00.000Z"), maxEvidenceAgeHours: 24 });
    const gate = report.evidence_gates[0];

    expect(gate?.ready_to_resolve).toBe(true);
    expect(gate?.blockers).toEqual([]);
    expect(gate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "quest_shell_loaded",
      "quest_manual_frame_pacing_ready",
      "asset_pipeline_gltf_pipeline_smoke_passed",
      "asset_pipeline_blender_bake_smoke_passed",
      "local_model_ready_to_benchmark",
      "local_voice_ready_to_benchmark",
    ]));
  });
});
