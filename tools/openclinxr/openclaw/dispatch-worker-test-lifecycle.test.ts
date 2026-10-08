import { describe, expect, it } from "vitest";
import { createTestLifecycle } from "./dispatch-worker-test-lifecycle.js";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function assertCleanupWaits(cleanup: () => Promise<void>, release: () => void) {
  let completed = false;
  const cleaning = cleanup().then(() => { completed = true; });
  await Promise.resolve();
  await Promise.resolve();
  const finishedEarly = completed;
  release();
  await cleaning;
  expect(finishedEarly, "cleanup returned before its owned callback completed").toBe(false);
  expect(completed).toBe(true);
}

describe("dispatch unit fixture lifecycle", () => {
  it("awaits its deferred callback; the same control rejects unawaited cleanup", async () => {
    const lifecycle = createTestLifecycle();
    const callback = deferred();
    lifecycle.run(() => callback.promise);
    await assertCleanupWaits(() => lifecycle.drain(), callback.release);

    const oldCallback = deferred();
    await expect(assertCleanupWaits(async () => {}, oldCallback.release)).rejects.toThrow(
      "cleanup returned before its owned callback completed",
    );
  });

  it("propagates the original callback failure through cleanup", async () => {
    const lifecycle = createTestLifecycle();
    const failure = new Error("fixture callback failure");
    lifecycle.run(async () => { throw failure; });
    await expect(lifecycle.drain()).rejects.toMatchObject({ errors: [failure] });
    await expect(lifecycle.drain()).resolves.toBeUndefined();
  });

  it("also waits work registered by a completing owned callback", async () => {
    const lifecycle = createTestLifecycle();
    const nested = deferred();
    lifecycle.run(async () => { lifecycle.run(() => nested.promise); });
    await assertCleanupWaits(() => lifecycle.drain(), nested.release);
  });
});
