import { describe, expect, it } from "vitest";
import {
  buildLocalRuntimeProbeReport,
  buildUserLocalCommandCandidatePath,
  buildUserLocalCommandCandidatePaths,
  type CommandProbe,
  LOCAL_RUNTIME_COMMAND_TIMEOUT_MS,
  localRuntimeCommandNames,
  type PythonModuleProbe,
  selectCommandVersionOutput,
} from "./local-runtime-probe.js";

describe("local runtime probe gates", () => {
  it("tracks workstation package and parallel-agent helper commands", () => {
    expect(localRuntimeCommandNames).toEqual(expect.arrayContaining(["brew", "portless"]));
  });

  it("ignores errored command probes when evaluating command-ready gates", () => {
    const report = buildLocalRuntimeProbeReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      system: {},
      commands: [
        { command: "vibevoice", status: "available", path: "/usr/local/bin/vibevoice", version: "", error: "module missing" },
        { command: "ollama", status: "available", path: "/usr/local/bin/ollama", version: "", error: "binary broken" },
      ],
      pythonModules: [],
      adbDevices: "List of devices attached\n",
      adbReverse: "",
      adbPower: "",
    });

    expect(report.gates.localModel).toEqual({
      status: "not_configured",
      blockers: ["no_ollama_llama_cpp_or_mlx_runtime_detected"],
    });
    expect(report.gates.localVoice).toEqual({
      status: "not_configured",
      blockers: ["no_vibevoice_runtime_detected"],
    });
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

  it("knows the approved user-local wrapper fallback path", () => {
    expect(buildUserLocalCommandCandidatePath("/Users/patrick", "vibevoice")).toBe("/Users/patrick/.local/bin/vibevoice");
    expect(buildUserLocalCommandCandidatePaths("/Users/patrick", "portless")).toEqual([
      "/Users/patrick/.local/bin/portless",
      "/Users/patrick/Library/pnpm/portless",
      "/Users/patrick/.bun/bin/portless",
    ]);
    expect(buildUserLocalCommandCandidatePaths("/Users/patrick", "bun")).toContain("/Users/patrick/.bun/bin/bun");
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
      adbPower: "mWakefulness=Awake\nmWakefulnessChanging=false",
    });

    expect(report.gates.questUsb).toEqual({ status: "ready", blockers: [] });
    expect(report.gates.questForegroundPreflight).toEqual({ status: "ready", blockers: [] });
    expect(report.gates.assetPipeline).toEqual({ status: "ready", blockers: [] });
    expect(report.gates.apiBunRuntime).toEqual({
      status: "not_configured",
      blockers: ["bun_runtime_not_installed_on_this_machine"],
    });
    expect(report.gates.localModel).toEqual({
      status: "blocked",
      blockers: ["model_weights_not_selected_or_benchmarked"],
    });
    expect(report.gates.localVoice).toEqual({
      status: "blocked",
      blockers: ["voice_model_not_selected_or_benchmarked"],
    });
  });

  it("allows @gltf-transform/core Node API evidence to satisfy the GLTF conversion runtime gate", () => {
    const report = buildLocalRuntimeProbeReport({
      generatedAt: "2026-05-27T00:00:00.000Z",
      system: {},
      commands: [availableCommand("blender")],
      pythonModules: [],
      nodePackages: [{ packageName: "@gltf-transform/core", status: "available", path: "/repo/node_modules/@gltf-transform/core" }],
      adbDevices: "List of devices attached\n",
      adbReverse: "",
      adbPower: "",
    });

    expect(report.nodePackages).toEqual([
      { packageName: "@gltf-transform/core", status: "available", path: "/repo/node_modules/@gltf-transform/core" },
    ]);
    expect(report.gates.assetPipeline).toEqual({ status: "ready", blockers: [] });
  });

  it("uses a generic GLTF conversion runtime blocker when neither CLI nor Node API is available", () => {
    const report = buildLocalRuntimeProbeReport({
      generatedAt: "2026-05-27T00:00:00.000Z",
      system: {},
      commands: [availableCommand("blender")],
      pythonModules: [],
      nodePackages: [{ packageName: "@gltf-transform/core", status: "missing" }],
      adbDevices: "List of devices attached\n",
      adbReverse: "",
      adbPower: "",
    });

    expect(report.gates.assetPipeline).toEqual({
      status: "not_configured",
      blockers: ["missing_permissive_gltf_conversion_runtime"],
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
      adbPower: "",
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
    expect(report.gates.apiBunRuntime).toEqual({
      status: "not_configured",
      blockers: ["bun_runtime_not_installed_on_this_machine"],
    });
  });

  it("keeps Bun API runtime blocked until websocket behavior is benchmarked", () => {
    const report = buildLocalRuntimeProbeReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      system: {},
      commands: [availableCommand("bun"), availableCommand("gltf-pipeline"), availableCommand("blender")],
      pythonModules: [],
      adbDevices: "List of devices attached\n",
      adbReverse: "",
      adbPower: "",
    });

    expect(report.gates.apiBunRuntime).toEqual({
      status: "blocked",
      blockers: ["api_bun_websocket_runtime_not_benchmarked"],
    });
  });

  it("marks Bun API runtime ready when local websocket smoke evidence has passed", () => {
    const report = buildLocalRuntimeProbeReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      system: {},
      commands: [availableCommand("bun"), availableCommand("gltf-pipeline"), availableCommand("blender")],
      pythonModules: [],
      adbDevices: "List of devices attached\n",
      adbReverse: "",
      adbPower: "",
      apiBunWebSocketRuntimeSmoke: {
        status: "passed",
        runtimeEvidenceBlockers: [],
        runtime: {
          h3: {
            enabled: false,
            h3TrueEnabled: false,
          },
        },
      },
    });

    expect(report.gates.apiBunRuntime).toEqual({ status: "ready", blockers: [] });
  });

  it("keeps foreground Quest performance blocked when the headset is asleep", () => {
    const report = buildLocalRuntimeProbeReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      system: {},
      commands: [availableCommand("adb"), availableCommand("gltf-pipeline"), availableCommand("blender")],
      pythonModules: [],
      adbDevices: "2G0YC5ZGB5000J device usb:0-1 product:eureka model:Quest_3 device:eureka",
      adbReverse: "tcp:5173 tcp:5173",
      adbPower: "mWakefulness=Asleep\nmWakefulnessChanging=false",
    });

    expect(report.gates.questUsb).toEqual({ status: "ready", blockers: [] });
    expect(report.gates.questForegroundPreflight).toEqual({
      status: "blocked",
      blockers: ["quest_3_asleep_or_not_foreground_ready"],
    });
  });
});

function availableCommand(command: string): CommandProbe {
  return { command, status: "available", path: `/usr/local/bin/${command}`, version: "test" };
}

void ({} satisfies Record<string, PythonModuleProbe>);
