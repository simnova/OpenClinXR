// C43 fix2 REDs: the trace-file count must not depend on the harness idle gap, and the activity watcher must not invent a timestamp.
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as lib from "./harness-lib.mjs";
const { listTraceFiles, watchTraceActivity } = lib;

const SUFFIX = ".conversation-trace.json";
const dirs = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function traceDir() {
  const dir = await mkdtemp(join(tmpdir(), "c43-fix2-"));
  dirs.push(dir);
  await writeFile(join(dir, `room-a${SUFFIX}`), "{\"events\":[]}\n");
  return dir;
}
/** lastEventAt 10 ms before the first file's mtime: the harness idle gap is tiny. */
async function tinyGap(dir) {
  return (await stat(join(dir, `room-a${SUFFIX}`))).mtimeMs - 10;
}
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; }, at: () => t };
}

describe("C43 fix2 trace settle", () => {
  it("r1: a second file landing 3000 ms after close is counted when the last event was 10 ms before close", async () => {
    const dir = await traceDir();
    const lastEventAt = await tinyGap(dir);
    setTimeout(() => { void writeFile(join(dir, `room-b${SUFFIX}`), "{\"events\":[]}\n"); }, 3000);
    const out = await listTraceFiles(dir, { lastEventAt, watchErrors: 0, persisted: Promise.resolve() });
    expect(out.refusal).toBeNull();
    expect(out.files.length).toBe(2);
  }, 30000);

  it("r3: a second file landing 500 ms after close is counted", async () => {
    const dir = await traceDir();
    const lastEventAt = await tinyGap(dir);
    setTimeout(() => { void writeFile(join(dir, `room-b${SUFFIX}`), "{\"events\":[]}\n"); }, 500);
    const out = await listTraceFiles(dir, { lastEventAt, watchErrors: 0, persisted: Promise.resolve() });
    expect(out.files.length).toBe(2);
  }, 30000);

  it("r2: a writer that never settles is REFUSED at the 15 s cap, not counted", async () => {
    const dir = await traceDir();
    const clock = fakeClock();
    let size = 0;
    const out = await listTraceFiles(dir, {
      lastEventAt: await tinyGap(dir), watchErrors: 0, persisted: Promise.resolve(), clock,
      list: async () => [{ name: `room-a${SUFFIX}`, size: (size += 1) }],
    });
    expect(out.refusal).not.toBeNull();
    expect(out.refusal).toContain("cap");
    expect(clock.at()).toBeGreaterThanOrEqual(15000);
    expect(clock.at()).toBeLessThan(16000);
  }, 30000);

  it("a stable listing settles after the quiet period and records mechanism, Q, its source and the per-poll counts", async () => {
    const dir = await traceDir();
    const clock = fakeClock();
    const out = await listTraceFiles(dir, {
      lastEventAt: await tinyGap(dir), watchErrors: 0, persisted: Promise.resolve(), clock,
      list: async () => [{ name: `room-a${SUFFIX}`, size: 13 }],
    });
    expect(out.refusal).toBeNull();
    expect(out.files).toEqual([`room-a${SUFFIX}`]);
    expect(out.mechanism).toContain("persist-signal");
    expect(out.quietMs).toBeGreaterThanOrEqual(1000);
    expect(typeof out.quietSource).toBe("string");
    expect(out.quietSource.length).toBeGreaterThan(10);
    expect(Array.isArray(out.pollCounts)).toBe(true);
    expect(out.pollCounts.length).toBeGreaterThan(1);
    expect(out.pollCounts.every((n) => n === 1)).toBe(true);
    expect(clock.at()).toBeGreaterThanOrEqual(out.quietMs);
  });

  it("a rejected persist signal is a refusal", async () => {
    const dir = await traceDir();
    const out = await listTraceFiles(dir, { lastEventAt: await tinyGap(dir), watchErrors: 0, persisted: Promise.reject(new Error("close failed")), clock: fakeClock(), list: async () => [{ name: `room-a${SUFFIX}`, size: 1 }] });
    expect(out.refusal).toContain("close failed");
  });

  it("r4: a getTrace that always throws leaves lastEventAt null and T1 REFUSED", async () => {
    const dir = await traceDir();
    const watcher = watchTraceActivity(() => { throw new Error("no live room"); }, 5);
    await new Promise((resolve) => setTimeout(resolve, 60));
    watcher.stop();
    expect(watcher.lastEventAt()).toBeNull();
    expect(watcher.errorCount()).toBeGreaterThan(0);
    const out = await listTraceFiles(dir, { lastEventAt: watcher.lastEventAt(), watchErrors: watcher.errorCount(), persisted: Promise.resolve(), clock: fakeClock(), list: async () => [{ name: `room-a${SUFFIX}`, size: 1 }] });
    expect(out.refusal).not.toBeNull();
  });

  it("r4b: watcher errors refuse even when an event was observed", async () => {
    const dir = await traceDir();
    let calls = 0;
    const watcher = watchTraceActivity(() => { calls += 1; if (calls % 2 === 0) throw new Error("flaky"); return { events: new Array(calls) }; }, 5);
    await new Promise((resolve) => setTimeout(resolve, 80));
    watcher.stop();
    expect(watcher.lastEventAt()).not.toBeNull();
    expect(watcher.errorCount()).toBeGreaterThan(0);
    const out = await listTraceFiles(dir, { lastEventAt: watcher.lastEventAt(), watchErrors: watcher.errorCount(), persisted: Promise.resolve(), clock: fakeClock(), list: async () => [{ name: `room-a${SUFFIX}`, size: 1 }] });
    expect(out.refusal).toContain("watcher");
  });

  it("an early refusal still awaits the close promise", async () => {
    const dir = await traceDir();
    let settled = false;
    const closing = new Promise((resolve) => setTimeout(() => { settled = true; resolve(); }, 200));
    const out = await listTraceFiles(dir, { lastEventAt: null, watchErrors: 0, persisted: closing, clock: fakeClock(), list: async () => [] });
    expect(out.refusal).not.toBeNull();
    expect(settled).toBe(true);
  });

  it("the watcher stamps only on a length change", async () => {
    const watcher = watchTraceActivity(() => ({ events: [] }), 5);
    await new Promise((resolve) => setTimeout(resolve, 40));
    watcher.stop();
    expect(watcher.lastEventAt()).toBeNull();
    expect(watcher.errorCount()).toBe(0);
  });

  it("nit: the late-copy probe can be cancelled before it fires", async () => {
    const dir = await traceDir();
    const probe = lib.startLateCopyProbe(dir, 200);
    probe.cancel();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(dir)).filter((n) => n.endsWith(SUFFIX)).length).toBe(1);
  });

  it("nit: the production function does not read C43_LATE_COPY_MS", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./harness-lib.mjs", import.meta.url), "utf8");
    expect(src.includes("C43_LATE_COPY_MS")).toBe(false);
  });
});
