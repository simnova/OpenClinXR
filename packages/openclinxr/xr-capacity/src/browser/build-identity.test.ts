import { afterEach, expect, it, vi } from "vitest";
import { runBrowserProbe } from "@openclinxr/xr-capacity/browser";
afterEach(() => vi.unstubAllGlobals());
async function observe(value: string | null) {
  vi.stubGlobal("document", value === null ? undefined : { getElementById: () => ({ textContent: value }) });
  vi.stubGlobal("navigator", { userAgent: "test-browser", platform: "test-host" });
  const controller = new AbortController(); controller.abort();
  return runBrowserProbe({ suite: "cadence", level: 1, signal: controller.signal, canvas: {} as HTMLCanvasElement, assetCanvas: {} as HTMLCanvasElement, capabilityHash: "test" });
}
it("reads stable runtime app identity without a package compile-time global", async () => {
  const identity = { gitCommit: "4ae790edda0f", capacitySourceHash: `sha256:${"a".repeat(64)}` };
  const run = await observe(JSON.stringify(identity));
  expect(run.environment.revision).toBe(identity.gitCommit);
  expect(run.environment.buildHash).toBe(identity.capacitySourceHash);
});
it("rejects absent, malformed, oversized and placeholder build identities", async () => {
  for (const value of [null, "not-json", "x".repeat(2049), JSON.stringify({ gitCommit: "known", capacitySourceHash: "unavailable" })]) {
    const run = await observe(value);
    expect(run.environment.revision).toBe("unavailable");
    expect(run.environment.buildHash).toBe("unavailable");
  }
});
