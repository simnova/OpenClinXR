import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

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
});
