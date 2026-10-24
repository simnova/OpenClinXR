import { createRequire } from "node:module";
import { cpus, freemem, hostname, platform, release, totalmem } from "node:os";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

async function dependencyVersion(name: string, from: string): Promise<{ name: string; version: string | null; status: string }> {
  try {
    const require = createRequire(join(root, from, "package.json"));
    let directory = dirname(require.resolve(name));
    for (let depth = 0; depth < 10; depth += 1) {
      try {
        const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as { name?: string; version?: string };
        if (manifest.name === name) return { name, version: manifest.version ?? null, status: "resolved-locally" };
      } catch { /* A package's entry point can be deeper than its manifest. */ }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    return { name, version: null, status: "manifest-unavailable" };
  } catch {
    return { name, version: null, status: "not-resolved-locally" };
  }
}

export async function probeHost(includeAdb = false) {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 2000, maxBuffer: 4096 });
  const adb = includeAdb ? spawnSync("adb", ["devices", "-l"], { encoding: "utf8", timeout: 3000, maxBuffer: 64 * 1024 }) : null;
  return {
    schema: "quest-capacity-host-probe.v1",
    observedAt: new Date().toISOString(),
    provenance: "node-host",
    host: { hostname: hostname(), platform: platform(), osRelease: release(), architecture: process.arch, cpuModel: cpus()[0]?.model ?? "unavailable", logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytes: freemem(), node: process.version, processId: process.pid, processMemory: process.memoryUsage(), revision: revision.status === 0 ? revision.stdout.trim() : null },
    dependencies: await Promise.all([
      dependencyVersion("@iwsdk/core", "apps/arena/ui-xr-iwsdk-spike"),
      dependencyVersion("@iwsdk/vite-plugin-dev", "apps/arena/ui-xr-iwsdk-spike"),
      dependencyVersion("iwer", "apps/arena/ui-xr-iwsdk-spike"),
      dependencyVersion("three", "apps/ui-xr"),
    ]),
    dependencyCurrentness: "Installed/resolved versions only; no registry query was performed. This probe cannot establish latest versions.",
    adb: adb === null ? { status: "not-requested" } : { status: adb.status === 0 ? "inventory-only" : "unavailable", output: adb.stdout?.trim() ?? "", error: adb.error?.message ?? adb.stderr?.trim() ?? null, sessionOwnershipVerified: false, wornHeadsetVerified: false },
    unavailable: ["Quest CPU/GPU clocks, counters and process memory", "native XR session, compositor cadence and display timing", "microphone/headset capture, playback and acoustic latency", "physical tracking and motion-to-photon latency", "Wi-Fi/WAN path capacity, HTTPS/WSS/WebRTC/WebTransport negotiation", "headset thermal, power and battery state"],
    notEvidenceFor: ["Quest 3 capacity or readiness", "browser GPU, microphone or native XR support", "physical headset/server latency", "clinical validity or scoring"],
  };
}
