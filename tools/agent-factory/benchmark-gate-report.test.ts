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
  evidence_gates: Array<{
    evidence_id: string;
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

    expect(gate?.blockers).toEqual(expect.arrayContaining(["local_model:no_ollama_llama_cpp_or_mlx_runtime_detected"]));
    expect(gate?.blocker_summary?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          group_id: "local_model_runtime",
          owner: "local-ai-inference-engineer",
          blockers: expect.arrayContaining([
            "local_model:no_ollama_llama_cpp_or_mlx_runtime_detected",
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
        expect.objectContaining({
          group_id: "asset_pipeline_blender",
          owner: "asset-pipeline-lead",
          blockers: ["asset_pipeline:missing_blender"],
        }),
      ]),
    );
    expect(gate?.blocker_summary?.groups.every((group) => group.next_step.length > 0)).toBe(true);
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
      "local_model_ready_to_benchmark",
      "local_voice_ready_to_benchmark",
    ]));
  });
});
