import { describe, expect, it } from "vitest";
import {
  buildLocalRuntimeProbeReport,
  LOCAL_RUNTIME_COMMAND_TIMEOUT_MS,
  localRuntimeCommandNames,
  selectCommandVersionOutput,
  type CommandProbe,
  type PythonModuleProbe,
} from "./local-runtime-probe.js";

describe("local runtime probe gates", () => {
  it("tracks workstation package and parallel-agent helper commands", () => {
    expect(localRuntimeCommandNames).toEqual(expect.arrayContaining(["brew", "portless"]));
  });

  it("allows enough time for first-launch local model runtime probes", () => {
    expect(LOCAL_RUNTIME_COMMAND_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("extracts llama.cpp version lines from noisy Metal backend startup logs", () => {
    const output = [
      "load_backend: loaded BLAS backend",
      "ggml_metal_library_init: using embedded metal library",
      "version: 9010 (d05fe1d7d)",
      "built with AppleClang 21.0.0.21000099 for Darwin arm64",
    ].join("\n");

    expect(selectCommandVersionOutput(output, /^version:/)).toBe("version: 9010 (d05fe1d7d)");
  });

  it("marks Quest USB and asset pipeline ready while keeping configured runtimes blocked until benchmarked", () => {
    const report = buildLocalRuntimeProbeReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      system: { arch: "arm64" },
      commands: [
        availableCommand("adb"),
        availableCommand("gltf-pipeline"),
        availableCommand("blender"),
        availableCommand("ollama"),
        availableCommand("vibevoice"),
      ],
      pythonModules: [],
      adbDevices: "2G0YC5ZGB5000J device usb:0-1 product:eureka model:Quest_3 device:eureka",
      adbReverse: "tcp:5173 tcp:5173",
    });

    expect(report.gates.questUsb).toEqual({ status: "ready", blockers: [] });
    expect(report.gates.assetPipeline).toEqual({ status: "ready", blockers: [] });
    expect(report.gates.localModel).toEqual({
      status: "blocked",
      blockers: ["model_weights_not_selected_or_benchmarked"],
    });
    expect(report.gates.localVoice).toEqual({
      status: "blocked",
      blockers: ["voice_model_not_selected_or_benchmarked"],
    });
  });

  it("keeps missing hardware and local runtimes as explicit not-configured or blocked gates", () => {
    const report = buildLocalRuntimeProbeReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      system: {},
      commands: [availableCommand("gltf-pipeline")],
      pythonModules: [{ module: "mlx", status: "missing" }],
      adbDevices: "List of devices attached\n",
      adbReverse: "",
    });

    expect(report.gates.questUsb).toEqual({
      status: "blocked",
      blockers: ["quest_3_not_authorized_or_not_connected"],
    });
    expect(report.gates.localModel).toEqual({
      status: "not_configured",
      blockers: ["no_ollama_llama_cpp_or_mlx_runtime_detected"],
    });
    expect(report.gates.localVoice).toEqual({
      status: "not_configured",
      blockers: ["no_vibevoice_runtime_detected"],
    });
    expect(report.gates.assetPipeline).toEqual({
      status: "not_configured",
      blockers: ["missing_blender"],
    });
  });
});

function availableCommand(command: string): CommandProbe {
  return { command, status: "available", path: `/usr/local/bin/${command}`, version: "test" };
}

void ({} satisfies Record<string, PythonModuleProbe>);
