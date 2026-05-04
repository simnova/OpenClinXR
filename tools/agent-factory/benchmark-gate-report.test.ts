import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildBenchmarkGateReport } from "./build-benchmark-gate-report.js";

type BlockerGroup = {
  group_id: string;
  title: string;
  owner: string;
  blockers: string[];
  next_step: string;
};

type BenchmarkGateReport = {
  iwsdk_evidence_contract?: {
    file: string;
    generated_at: string;
    status: string;
    ready_for_install_backed_sidecar: boolean;
    ready_for_agent_tooling: boolean;
    ready_for_production_runtime: boolean;
    blockers: string[];
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

describe("benchmark gate report", () => {
  it("summarizes duplicate raw blockers into leadership remediation groups", async () => {
    const report = JSON.parse(await readFile(".agent-factory/benchmark-gate-report.json", "utf8")) as BenchmarkGateReport;
    const gate = report.evidence_gates.find((candidate) => candidate.evidence_id === "evidence-leadership-0007-002");

    expect(gate?.blockers).toEqual(expect.arrayContaining(["local_model:model_weights_not_selected_or_benchmarked"]));
    const groups = gate?.blocker_summary?.groups ?? [];

    expect(groups.map((group) => group.group_id).sort()).toEqual([
      "local_model_runtime",
      "local_voice_runtime",
      "quest_foreground_frame_pacing",
    ]);
    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group_id: "local_model_runtime",
          owner: "local-ai-inference-engineer",
          blockers: expect.arrayContaining([
            "local_model:model_weights_not_selected_or_benchmarked",
            "local_model_benchmark:OPENCLINXR_LOCAL_MODEL_ID_not_set",
          ]),
        }),
        expect.objectContaining({
          group_id: "local_voice_runtime",
          owner: "voice-speech-engineer",
          blockers: expect.arrayContaining([
            "local_voice:no_vibevoice_runtime_detected",
            "local_voice_benchmark:OPENCLINXR_LOCAL_VOICE_ID_not_set",
          ]),
        }),
        expect.objectContaining({
          group_id: "quest_foreground_frame_pacing",
          owner: "xr-systems-architect",
          blockers: expect.arrayContaining([
            "quest_page_hidden_or_inactive",
            "quest_manual_performance:missing_quest_manual_performance_report",
          ]),
        }),
      ]),
    );
    expect(groups.every((group) => group.next_step.length > 0)).toBe(true);
  });

  it("splits iteration 0008 benchmark evidence debt by owner-specific leadership gates", async () => {
    const report = JSON.parse(await readFile(".agent-factory/benchmark-gate-report.json", "utf8")) as BenchmarkGateReport;
    const gatesById = new Map(report.evidence_gates.map((gate) => [gate.evidence_id, gate]));

    expect([...gatesById.keys()].sort()).toEqual([
      "evidence-leadership-0007-002",
      "evidence-leadership-0008-001",
      "evidence-leadership-0008-002",
      "evidence-leadership-0008-003",
    ]);

    expect(gatesById.get("evidence-leadership-0008-001")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "quest_cdp_frame_sample_incomplete",
        "quest_manual_performance:missing_quest_manual_performance_report",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0008-002")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "local_model:model_weights_not_selected_or_benchmarked",
        "local_model_benchmark:OPENCLINXR_LOCAL_MODEL_ID_not_set",
      ]),
    }));
    expect(gatesById.get("evidence-leadership-0008-003")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "local_voice:no_vibevoice_runtime_detected",
        "local_voice_benchmark:OPENCLINXR_LOCAL_VOICE_ID_not_set",
      ]),
    }));
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

  it("surfaces IWSDK evidence contract status without changing leadership gate semantics", () => {
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
              "agent_tooling:adapter_sync_not_recorded",
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
        "sidecar:operator_accepts_iwsdk_install_scope",
        "agent_tooling:adapter_sync_not_recorded",
      ],
    });
    expect(report.evidence_gates.map((gate) => gate.evidence_id).sort()).toEqual([
      "evidence-leadership-0007-002",
      "evidence-leadership-0008-001",
      "evidence-leadership-0008-002",
      "evidence-leadership-0008-003",
    ]);
  });

  it("derives Quest manual performance checks from raw foreground headset reports", () => {
    const report = buildBenchmarkGateReport({
      questSmoke: {
        file: "quest.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: false,
            blockers: ["quest_cdp_frame_sample_incomplete"],
          },
        },
      },
      questManualPerformanceReport: {
        file: "docs/openclinxr/quest-manual-performance-2026-05-04.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          runContext: { durationMinutes: 10 },
          setup: {
            foregroundPageConfirmed: true,
            devtoolsScreencastDisabled: true,
            extraBrowserWindowsClosed: true,
          },
          station: {
            shellLoaded: true,
            traceInteractionPassed: true,
            textReadable: true,
            consoleErrors: [],
          },
          performance: {
            avgFps: 72,
            p95FrameMs: 25,
            minimumObservedFps: 60,
          },
          comfort: {
            motionComfort: "comfortable",
            heatConcern: false,
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
    expect(questGate?.satisfied_conditions).toEqual(expect.arrayContaining([
      "quest_manual_frame_pacing_ready",
      "average_fps_72_or_higher",
      "p95_frame_ms_25_or_lower",
    ]));
    expect(questGate?.blockers).not.toContain("quest_manual_performance:missing_quest_manual_performance_report");
  });

  it("marks the leadership evidence gate ready when all fixture evidence is satisfied", () => {
    const report = buildBenchmarkGateReport({
      questSmoke: {
        file: "quest.json",
        value: {
          generatedAt: "2026-05-04T00:00:00.000Z",
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: true,
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
    });
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
