import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { iwsdkSidecarControllerSelectTraceTag } from "../../apps/ui-xr-iwsdk-spike/src/sidecar-state.js";
import {
  buildIwerControllerInputProbeReport,
  type IwerControllerInputProbeEvidence,
  type IwerControllerInputProbeReport,
} from "./iwer-controller-input-probe-check.js";

const execFileAsync = promisify(execFile);

describe("IWER controller/input probe checker", () => {
  it("accepts ready emulated controller input evidence without promoting it to Quest proof", () => {
    const report = buildIwerControllerInputProbeReport({
      generatedAt: "2026-05-05T00:15:00.000Z",
      evidence: readyEvidence(),
    });

    expect(report.result).toEqual({
      readyForInputEmulationEvidence: true,
      readyForProductionRuntime: false,
      readyForPhysicalQuestClaim: false,
      blockers: [],
      satisfiedConditions: expect.arrayContaining([
        "schema_version_iwer_controller_input_probe_v1",
        "classification_sidecar_only",
        "sidecar_localhost_endpoint_recorded",
        "iwer_input_probe_emulated_session_active",
        "iwer_input_probe_required_tools_succeeded",
        "iwer_input_probe_controller_select_trace_observed",
        "safety_boundaries_preserved",
      ]),
    });
    expect(report.evidence.classification?.notEvidenceFor).toEqual(expect.arrayContaining([
      "physical_quest_controller_latency",
      "physical_quest_hand_tracking_quality",
      "production_runtime_readiness",
    ]));
  });

  it("rejects inactive or non-VR emulation sessions and missing required input tools", () => {
    const evidence = readyEvidence();
    evidence.probe.sessionActive = false;
    evidence.probe.sessionMode = "inline";
    evidence.probe.successfulToolNames = ["xr_set_input_mode"];
    evidence.probe.observedTraceActionTags = [];
    evidence.probe.consoleErrorCount = 1;

    const report = buildIwerControllerInputProbeReport({
      generatedAt: "2026-05-05T00:15:00.000Z",
      evidence,
    });

    expect(report.result.readyForInputEmulationEvidence).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "iwer_input_probe_session_not_active",
      "iwer_input_probe_session_mode_not_immersive_vr",
      "iwer_input_probe_missing_required_successful_tool:xr_set_connected",
      "iwer_input_probe_missing_required_successful_tool:xr_set_gamepad_state",
      "iwer_input_probe_missing_required_successful_tool:xr_select",
      `iwer_input_probe_missing_trace_tag:${iwsdkSidecarControllerSelectTraceTag}`,
      "iwer_input_probe_console_errors_present",
    ]));
  });

  it("rejects unsafe production or physical Quest claim boundaries", () => {
    const evidence = readyEvidence();
    evidence.classification!.notEvidenceFor = ["in_headset_text_readability"];
    evidence.sidecar!.runtimeUrl = "https://example.com/iwer";
    evidence.sidecar!.mcpWebSocketEndpoint = "wss://example.com/__iwer_mcp";
    evidence.probe.readyForProductionRuntime = true;
    evidence.probe.readyForPhysicalQuestClaim = true;

    const report = buildIwerControllerInputProbeReport({
      generatedAt: "2026-05-05T00:15:00.000Z",
      evidence,
    });

    expect(report.result.readyForInputEmulationEvidence).toBe(false);
    expect(report.result.readyForProductionRuntime).toBe(false);
    expect(report.result.readyForPhysicalQuestClaim).toBe(false);
    expect(report.result.blockers).toEqual(expect.arrayContaining([
      "missing_not_evidence_for_physical_quest_controller_latency",
      "missing_not_evidence_for_production_runtime_readiness",
      "runtime_url_not_localhost",
      "mcp_websocket_endpoint_not_localhost",
      "ready_for_production_runtime_must_be_false",
      "ready_for_physical_quest_claim_must_be_false",
    ]));
  });

  it("accepts the committed controller input probe fixture", async () => {
    const evidence = JSON.parse(
      await readFile("docs/openclinxr/iwer-controller-input-probe-2026-05-05.json", "utf8"),
    ) as IwerControllerInputProbeEvidence;
    const report = buildIwerControllerInputProbeReport({
      generatedAt: "2026-05-05T00:15:00.000Z",
      inputFile: "docs/openclinxr/iwer-controller-input-probe-2026-05-05.json",
      evidence,
    });

    expect(report.result.readyForInputEmulationEvidence).toBe(true);
    expect(report.result.readyForPhysicalQuestClaim).toBe(false);
    expect(report.result.readyForProductionRuntime).toBe(false);
    expect(report.result.blockers).toEqual([]);
  });

  it("exposes a CLI for validating captured IWER controller/input probe JSON", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwer:controller-input:evidence"]).toBe(
      "tsx tools/openclinxr/iwer-controller-input-probe-check.ts",
    );
    expect(rootPackage.scripts["iwer:controller-input:evidence:validate"]).toBe(
      "tsx tools/openclinxr/iwer-controller-input-probe-check.ts --input docs/openclinxr/iwer-controller-input-probe-2026-05-05.json",
    );

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwer-controller-input-"));
    const inputPath = path.join(tempDir, "iwer-controller-input.json");
    const outputPath = path.join(tempDir, "iwer-controller-input-report.json");
    await writeFile(inputPath, `${JSON.stringify(readyEvidence(), null, 2)}\n`, "utf8");

    const { stdout } = await execFileAsync(
      path.resolve("node_modules/.bin/tsx"),
      ["tools/openclinxr/iwer-controller-input-probe-check.ts", "--input", inputPath, "--output", outputPath],
      { encoding: "utf8", timeout: 15000 },
    );
    const report = JSON.parse(await readFile(outputPath, "utf8")) as IwerControllerInputProbeReport;

    expect(stdout).toContain(`Wrote ${outputPath}`);
    expect(report.inputFile).toBe(inputPath);
    expect(report.result.readyForInputEmulationEvidence).toBe(true);
  });
});

function readyEvidence(): IwerControllerInputProbeEvidence {
  return {
    schemaVersion: "openclinxr.iwer-controller-input-probe.v1",
    generatedAt: "2026-05-05T00:00:00.000Z",
    classification: {
      lane: "iwer_controller_input_probe",
      scope: "sidecar_only_dev_evidence",
      notEvidenceFor: [
        "physical_quest_controller_latency",
        "physical_quest_hand_tracking_quality",
        "physical_quest_foreground_frame_pacing",
        "in_headset_text_readability",
        "production_runtime_readiness",
      ],
    },
    sidecar: {
      app: "apps/ui-xr-iwsdk-spike",
      runtimeUrl: "http://127.0.0.1:5183/?iwerAutoEnterVr=true&iwerEvidenceView=wide",
      devServerPort: 5183,
      mcpWebSocketEndpoint: "ws://127.0.0.1:5183/__iwer_mcp",
    },
    probe: {
      source: "iwer_mcp_emulation",
      sessionActive: true,
      sessionMode: "immersive-vr",
      attemptedToolNames: ["xr_set_input_mode", "xr_set_connected", "xr_set_gamepad_state", "xr_select"],
      successfulToolNames: ["xr_set_input_mode", "xr_set_connected", "xr_set_gamepad_state", "xr_select"],
      observedTraceActionTags: [iwsdkSidecarControllerSelectTraceTag],
      controllerSelectTraceTag: iwsdkSidecarControllerSelectTraceTag,
      consoleErrorCount: 0,
      readyForInputEmulationEvidence: true,
      readyForProductionRuntime: false,
      readyForPhysicalQuestClaim: false,
      blockers: [],
    },
  };
}
