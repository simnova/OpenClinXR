import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalComputeServices } from "./index.js";

let temp: string | null = null;
const priorLockRoot = process.env["OPENCLINXR_LOCK_ROOT"];

function tempRoot(): string {
  temp = mkdtempSync(path.join(tmpdir(), `local-compute-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = path.join(temp, "locks");
  return temp;
}

afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = null;
  if (priorLockRoot === undefined) delete process.env["OPENCLINXR_LOCK_ROOT"];
  else process.env["OPENCLINXR_LOCK_ROOT"] = priorLockRoot;
});

describe("local compute services", () => {
  it("adds Blender's fail-closed flag and records slot usage", async () => {
    const root = tempRoot();
    const executable = path.join(root, "blender-stub.mjs");
    writeFileSync(executable, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    chmodSync(executable, 0o755);
    const result = await createLocalComputeServices({ cwd: root }).blender.run({
      script: executable,
      args: ["--background", "--python", "probe.py"],
      label: "test:blender",
      timeoutMs: 5_000,
    });
    expect(result).toMatchObject({ code: 0, timedOut: false, signal: null });
    expect(JSON.parse(result.stdout)).toEqual([
      "--background", "--python-exit-code", "1", "--python", "probe.py",
    ]);
    expect(readFileSync(path.join(root, "locks", "usage.jsonl"), "utf8")).toContain('"label":"test:blender"');
  });

  it("preserves a legacy Blender argv when requested", async () => {
    const root = tempRoot();
    const executable = path.join(root, "blender-stub.mjs");
    writeFileSync(executable, "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
    chmodSync(executable, 0o755);
    const result = await createLocalComputeServices({ cwd: root }).blender.run({
      script: executable,
      args: ["--background", "--python", "stage.py", "--", "--output", "actor.glb"],
      label: "test:blender-preserve-argv",
      timeoutMs: 5_000,
      ensurePythonExitCode: false,
      timeoutKillGraceMs: false,
    });
    expect(JSON.parse(result.stdout)).toEqual([
      "--background", "--python", "stage.py", "--", "--output", "actor.glb",
    ]);
  });

  it("reports timeout and closes a captured browser", async () => {
    const root = tempRoot();
    const executable = path.join(root, "slow.mjs");
    writeFileSync(executable, "#!/usr/bin/env node\nsetTimeout(() => {}, 10000);\n");
    chmodSync(executable, 0o755);
    const services = createLocalComputeServices({ cwd: root });
    await expect(services.gpuJob.run({
      command: executable,
      args: [],
      cwd: root,
      label: "test:gpu-timeout",
      timeoutMs: 25,
      env: {},
    })).resolves.toMatchObject({ timedOut: true });

    let closed = false;
    const capture = createLocalComputeServices({
      cwd: root,
      browserLaunch: async () => ({ close: async () => { closed = true; } }),
    });
    await expect(capture.sceneCapture.withBrowser("test:capture", () => "ok")).resolves.toBe("ok");
    expect(closed).toBe(true);
  });
});
