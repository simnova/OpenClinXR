import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalComputeServices } from "./local.js";

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

  it("does not invoke a queued browser launch after the acquisition signal aborts", async () => {
    const root = tempRoot();
    let releaseHolder!: () => void;
    const holderGate = new Promise<void>((resolve) => { releaseHolder = resolve; });
    const holder = createLocalComputeServices({
      cwd: root,
      browserLaunch: async () => {
        await holderGate;
        return { close: async () => {} };
      },
    }).sceneCapture.withBrowser("test:holder", async () => "held");
    const slotFile = path.join(root, "locks", "browser-capture", "slot-0.json");
    const acquireDeadline = Date.now() + 10_000;
    while (!existsSync(slotFile)) {
      if (Date.now() > acquireDeadline) throw new Error("holder never acquired the browser slot");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const controller = new AbortController();
    let launched = 0;
    const queued = createLocalComputeServices({
      cwd: root,
      signal: controller.signal,
      browserLaunch: async () => {
        launched += 1;
        return { close: async () => {} };
      },
    }).sceneCapture.withBrowser("test:queued", () => "never");
    const queueDir = path.join(root, "locks", "browser-capture", "queue");
    const queueDeadline = Date.now() + 10_000;
    for (;;) {
      let queuedTicket = false;
      for (const entry of readdirSync(queueDir)) {
        if (!entry.endsWith(".json")) continue;
        try {
          const record = JSON.parse(readFileSync(path.join(queueDir, entry), "utf8")) as { label?: unknown };
          if (record.label === "test:queued") { queuedTicket = true; break; }
        } catch { /* ticket still being written; poll again */ }
      }
      if (queuedTicket) break;
      if (Date.now() > queueDeadline) throw new Error("browser waiter never queued");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    controller.abort(new Error("test abort"));
    await expect(queued).rejects.toThrow("test abort");
    expect(launched).toBe(0);
    releaseHolder();
    await expect(holder).resolves.toBe("held");
  });

  it("does not launch when the signal is already aborted", async () => {
    const root = tempRoot();
    const controller = new AbortController();
    controller.abort(new Error("pre-aborted"));
    let launched = 0;
    await expect(createLocalComputeServices({
      cwd: root,
      signal: controller.signal,
      browserLaunch: async () => {
        launched += 1;
        return { close: async () => {} };
      },
    }).sceneCapture.withBrowser("test:preaborted", () => "never")).rejects.toThrow("pre-aborted");
    expect(launched).toBe(0);
  });

  it("closes a late-settling launch once after abort without invoking the callback", async () => {
    const root = tempRoot();
    let releaseLaunch!: () => void;
    let releaseClose!: () => void;
    const launchGate = new Promise<void>((resolve) => { releaseLaunch = resolve; });
    const closeGate = new Promise<void>((resolve) => { releaseClose = resolve; });
    let launched = 0;
    let callbackCalled = 0;
    let closeCount = 0;
    let settled = false;
    const controller = new AbortController();
    const pending = createLocalComputeServices({
      cwd: root,
      signal: controller.signal,
      browserLaunch: async () => {
        launched += 1;
        await launchGate;
        return { close: async () => { await closeGate; closeCount += 1; } };
      },
    }).sceneCapture.withBrowser("test:late-abort", async () => {
      callbackCalled += 1;
      return "never";
    });
    void pending.then(() => { settled = true; }, () => { settled = true; });
    const startDeadline = Date.now() + 10_000;
    while (launched === 0) {
      if (Date.now() > startDeadline) throw new Error("browser launch never started");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    controller.abort(new Error("test abort"));
    releaseLaunch();
    // Let the late constructor resolve into the post-await abort check,
    // which must block rejection until the delayed close finishes.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callbackCalled).toBe(0);
    expect(settled).toBe(false);
    expect(existsSync(path.join(root, "locks", "browser-capture", "slot-0.json"))).toBe(true);
    releaseClose();
    await expect(pending).rejects.toThrow("test abort");
    expect(callbackCalled).toBe(0);
    expect(closeCount).toBe(1);
    expect(existsSync(path.join(root, "locks", "browser-capture", "slot-0.json"))).toBe(false);
    await expect(createLocalComputeServices({
      cwd: root,
      browserLaunch: async () => ({ close: async () => {} }),
    }).sceneCapture.withBrowser("test:after", () => "after")).resolves.toBe("after");
  });

  it("closes once when abort and resolve land on the same tick", async () => {
    const root = tempRoot();
    let releaseLaunch!: () => void;
    const launchGate = new Promise<void>((resolve) => { releaseLaunch = resolve; });
    let launched = 0;
    let callbackCalled = 0;
    let closeCount = 0;
    const controller = new AbortController();
    const pending = createLocalComputeServices({
      cwd: root,
      signal: controller.signal,
      browserLaunch: async () => {
        launched += 1;
        await launchGate;
        return { close: async () => { closeCount += 1; } };
      },
    }).sceneCapture.withBrowser("test:same-tick", async () => {
      callbackCalled += 1;
      return "never";
    });
    const startDeadline = Date.now() + 10_000;
    while (launched === 0) {
      if (Date.now() > startDeadline) throw new Error("browser launch never started");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    // Same tick: abort and resolve before any microtask runs, so a
    // settled-flag race would see the launch as unsettled yet leak it.
    controller.abort(new Error("same-tick abort"));
    releaseLaunch();
    await expect(pending).rejects.toThrow("same-tick abort");
    expect(callbackCalled).toBe(0);
    expect(closeCount).toBe(1);
  });
});
