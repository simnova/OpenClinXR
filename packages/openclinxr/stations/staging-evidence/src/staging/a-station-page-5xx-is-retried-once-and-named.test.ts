import { describe, expect, it, vi } from "vitest";
import { waitForStationShell } from "../../../../../../tools/openclinxr/evidence/ui-xr-environment-room-capture.js";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
};

const deferred = (): Deferred => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

class FakePage {
  readonly waits: Deferred[] = [];
  readonly waitTimeouts: number[] = [];
  reloadCount = 0;
  onReload: (() => void | Promise<void>) | undefined;
  private readonly listeners = new Map<string, Array<(value: never) => unknown>>();

  on(event: string, listener: (value: never) => unknown): void {
    const rows = this.listeners.get(event) ?? [];
    rows.push(listener);
    this.listeners.set(event, rows);
  }

  url(): string {
    return "http://127.0.0.1:4173/capture";
  }

  async reload(): Promise<void> {
    this.reloadCount += 1;
    await this.onReload?.();
  }

  waitForFunction(
    _fn: unknown,
    _arg: unknown,
    options: { timeout: number },
  ): Promise<void> {
    const wait = deferred();
    this.waits.push(wait);
    this.waitTimeouts.push(options.timeout);
    return wait.promise;
  }

  evaluate(): Promise<unknown> {
    return Promise.resolve({ ready: true, environmentId: "exam-room" });
  }

  async respond(input: {
    url?: string;
    status: number;
    resourceType: string;
    body?: string;
  }): Promise<void> {
    const response = {
      url: () => input.url ?? "http://127.0.0.1:4173/src/main.ts",
      status: () => input.status,
      request: () => ({ resourceType: () => input.resourceType }),
      text: () => Promise.resolve(input.body ?? ""),
    };
    await Promise.all((this.listeners.get("response") ?? []).map(async (listener) => listener(response as never)));
  }
}

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition did not become true");
};

const messageFrom = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
};

describe("a station page script 5xx is retried once and named", () => {
  it("does not reload when no response is a 5xx", async () => {
    const page = new FakePage();
    const waiting = waitForStationShell(page as never, 100);
    page.waits[0]?.resolve();
    await waiting;
    expect(page.reloadCount).toBe(0);
  });

  it("does not reload for a non-script 5xx", async () => {
    const page = new FakePage();
    const waiting = waitForStationShell(page as never, 100);
    await page.respond({
      url: "http://127.0.0.1:4173/xr-assets/generated/patient.glb",
      status: 500,
      resourceType: "fetch",
      body: "asset failed",
    });
    page.waits[0]?.resolve();
    await waiting;
    expect(page.reloadCount).toBe(0);
  });

  it("reloads once, then names the second script 5xx", async () => {
    const page = new FakePage();
    const waiting = waitForStationShell(page as never, 100);
    await page.respond({ status: 500, resourceType: "script", body: "first transform failed" });
    await waitUntil(() => page.reloadCount === 1 && page.waits.length === 2);
    await page.respond({
      url: "http://127.0.0.1:4173/src/station.ts",
      status: 503,
      resourceType: "script",
      body: "second transform failed",
    });
    const message = await messageFrom(waiting);
    expect(page.reloadCount).toBe(1);
    expect(message).toContain("station shell wait failed: HTTP 503 http://127.0.0.1:4173/src/station.ts second transform failed");
  });

  it("does not reload on Vite's 504 Outdated Optimize Dep, which reloads the page itself", async () => {
    const page = new FakePage();
    const waiting = waitForStationShell(page as never, 100);
    await page.respond({ status: 504, resourceType: "script", body: "Outdated Optimize Dep" });
    page.waits[0]?.reject(new Error("page.waitForFunction: Timeout 100ms exceeded."));
    const message = await messageFrom(waiting);
    expect(page.reloadCount).toBe(0);
    expect(message).toContain("HTTP 504");
  });

  it("does not reload a 404 script response and carries it into the timeout", async () => {
    const page = new FakePage();
    const waiting = waitForStationShell(page as never, 100);
    await page.respond({ status: 404, resourceType: "script", body: "missing entry module" });
    page.waits[0]?.reject(new Error("page.waitForFunction: Timeout 100ms exceeded."));
    const message = await messageFrom(waiting);
    expect(page.reloadCount).toBe(0);
    expect(message).toContain("HTTP 404");
    expect(message).toContain("/src/main.ts");
    // A routine 404 never reclassifies the timeout (favicon 404s are common).
    expect(message).toContain("classification: unresponsive main thread or silent page");
  });

  it("uses only the remaining wall-clock budget after its retry", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const page = new FakePage();
      page.onReload = () => {
        vi.setSystemTime(1_070);
      };
      const waiting = waitForStationShell(page as never, 100);
      vi.setSystemTime(1_040);
      await page.respond({ status: 500, resourceType: "script", body: "retry me" });
      await waitUntil(() => page.waits.length === 2);
      expect(page.waitTimeouts.every((timeout) => timeout <= 100)).toBe(true);
      expect(page.waitTimeouts.reduce((sum, timeout) => sum + timeout, 0)).toBeLessThanOrEqual(100);
      expect(70 + (page.waitTimeouts[1] ?? Infinity)).toBeLessThanOrEqual(100);
      page.waits[1]?.resolve();
      await waiting;
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves when the station shell appears after the one reload", async () => {
    const page = new FakePage();
    const waiting = waitForStationShell(page as never, 100);
    await page.respond({ status: 500, resourceType: "script", body: "temporary transform failure" });
    await waitUntil(() => page.reloadCount === 1 && page.waits.length === 2);
    page.waits[1]?.resolve();
    await expect(waiting).resolves.toMatchObject({ ready: true, environmentId: "exam-room" });
    expect(page.reloadCount).toBe(1);
  });
});
