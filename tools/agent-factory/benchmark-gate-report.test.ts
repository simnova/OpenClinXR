import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBenchmarkGateReport, latestJson } from "./build-benchmark-gate-report.js";

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
            "quest_manual_performance:missing_quest_manual_performance_report",
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
            frameStats: { framesObserved: 120 },
          },
          interaction: {},
          frameSample: {
            timedOut: false,
            latestFrameAgeMs: 16,
            framesObservedDuringProbe: 120,
          },
          verdict: {
            shellLoaded: true,
            interactionAdvanced: true,
            frameSampleComplete: true,
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
    expect(report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-004")?.blockers).toEqual([
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
    ]);

    expect(gatesById.get("evidence-leadership-0008-001")).toEqual(expect.objectContaining({
      ready_to_resolve: false,
      blockers: expect.arrayContaining([
        "quest_immersive_entry_activation_not_received",
        "quest_immersive_session_not_started",
        "quest_manual_performance:missing_quest_manual_performance_report",
      ]),
      satisfied_conditions: expect.arrayContaining([
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
    const iwsdkGate = report.evidence_gates.find((gate) => gate.evidence_id === "evidence-leadership-0008-004");

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
          performance: {
            source: "window.__openClinXrFrameStats",
            framesObserved: 600,
            sampleWindowSize: 120,
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
      "rolling_frame_window_120_or_more",
      "average_fps_72_or_higher",
      "p95_frame_ms_25_or_lower",
      "controller_select_latency_150ms_or_lower",
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
            frameStats: { framesObserved: 120 },
          },
          interaction: {},
          frameSample: {
            timedOut: false,
            latestFrameAgeMs: 16,
            framesObservedDuringProbe: 120,
          },
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
