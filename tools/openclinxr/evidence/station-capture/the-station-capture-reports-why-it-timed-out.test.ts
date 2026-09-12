import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const captureModule = await import(
  new URL("../ui-xr-environment-room-capture.js", import.meta.url).href
);
const {
  attachStationCapturePageDiagnostics,
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} = captureModule;

/**
 * OBSERVABLE: 15 render cases fail as a bare Playwright timeout. The station-environment
 * capture never attached page-error, console, or failed-request listeners, so a 180 s wait
 * arriving at multi-case-runner.ts:864 is indistinguishable from a page exception, a failed
 * asset request, and an unresponsive main thread.
 *
 * MEASURED 2026-09-03 from the rollup landed at 6f5d05d4, all 15 cases identical:
 *
 *   render   classification: error   artifactPaths: []
 *   "Capture failed for <caseId>: page.waitForFunction: Timeout 180000ms exceeded."
 *
 * `a-capture-timeout-names-which-wait-failed.test.ts` already names WHICH wait fired and
 * preserves the Playwright Timeout string. That is necessary and not sufficient: the named
 * wait still does not say WHY the predicate never became true.
 *
 * KNOWN-GOOD COLUMN — eight sibling probes in this directory already attach a pageerror
 * listener (clinical-touch-smoke.ts, viseme-inspect-stills-probe.ts, mouth-open-cap-probe.ts,
 * iwsdk-radial-pulse-video-capture.ts, scene-closure/proofs/sc-05/ui-xr-bedside-approach-capture.ts,
 * bvh-retarget-lab-smoke.ts, parent-visemes02-stills.ts, issue-188-footwear-grade.ts).
 * `rethrowNamedWaitTimeout` already names the wait and preserves the cause. This file asks
 * for the same treatment on the page-side events those probes already collect.
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED (#N)` block. Do not
 * rewrite the measured table.
 *
 * claimScope: whether a 180 s capture timeout arrives with pageErrors / console /
 *   failedRequests attached so a page exception, a failed request, and a silent page
 *   are distinguishable.
 * notEvidenceFor: whether the main thread is actually starved; the fix for whatever the
 *   diagnostics reveal; the wait predicates and their budgets; re-running the 15-case rollup.
 *
 * ## FIXED (tsk_302db890ff6f6882) — 2026-09-11
 *
 * `captureStationEnvironmentRooms` attaches pageerror / console / requestfailed before
 * `page.goto`. `waitForStationShell` and `waitForHumanoidAssetsLoaded` consult the same
 * bag via `rethrowNamedWaitTimeout`, which appends
 * `pageDiagnostics classification: page exception | failed request | unresponsive main thread or silent page`
 * plus the three lists. Non-timeout rejections still pass through. The wait-name tests
 * keep their messages when the stub has no `.on`.
 */

const PLAYWRIGHT_TIMEOUT = "page.waitForFunction: Timeout 180000ms exceeded.";
const CAPTURE_SOURCE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../ui-xr-environment-room-capture.ts"),
  "utf8",
);

type Handler = (payload: unknown) => void;

const diagnosticPage = (): {
  on: (event: string, handler: Handler) => void;
  waitForFunction: () => Promise<never>;
  evaluate: () => Promise<undefined>;
  emit: (event: string, payload: unknown) => void;
  events: string[];
} => {
  const handlers = new Map<string, Handler[]>();
  const events: string[] = [];
  return {
    events,
    on(event, handler) {
      events.push(event);
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    waitForFunction: () => Promise.reject(new Error(PLAYWRIGHT_TIMEOUT)),
    evaluate: () => Promise.resolve(undefined),
    emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
};

const messageFrom = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "";
};

describe("the station capture reports why it timed out", () => {
  it("(0) VACUITY GUARD: the stub really does reject, so a silent pass is impossible", async () => {
    const page = diagnosticPage();
    const msg = await messageFrom(() => waitForStationShell(page as never, 10));
    expect(msg, "the stub did not reject — this file is testing nothing").not.toBe("");
    expect(msg, "the stub's rejection is not the observed Playwright timeout").toContain("Timeout");
  });

  it("(1) the capture attaches pageerror, console, and requestfailed before goto", () => {
    const fnStart = CAPTURE_SOURCE.indexOf("export async function captureStationEnvironmentRooms");
    expect(fnStart, "captureStationEnvironmentRooms disappeared").toBeGreaterThan(-1);
    const body = CAPTURE_SOURCE.slice(fnStart);
    const attachAt = body.indexOf("attachStationCapturePageDiagnostics");
    const gotoAt = body.indexOf("page.goto");
    expect(attachAt, "capture never calls attachStationCapturePageDiagnostics").toBeGreaterThan(-1);
    expect(gotoAt, "capture never calls page.goto").toBeGreaterThan(-1);
    expect(attachAt, "listeners must be attached before page.goto").toBeLessThan(gotoAt);

    const page = diagnosticPage();
    attachStationCapturePageDiagnostics(page as never);
    expect(page.events, "pageerror listener missing").toContain("pageerror");
    expect(page.events, "console listener missing").toContain("console");
    expect(page.events, "requestfailed listener missing").toContain("requestfailed");
  });

  it("(2) a page exception on a timed-out wait is classified as a page exception", async () => {
    const page = diagnosticPage();
    attachStationCapturePageDiagnostics(page as never);
    page.emit("pageerror", new Error("TypeError: x is not a function"));
    const msg = await messageFrom(() => waitForStationShell(page as never, 10));
    expect(msg, `timeout does not name the wait: ${msg}`).toMatch(/station.?shell/iu);
    expect(msg, "Playwright Timeout was swallowed").toMatch(/Timeout/u);
    expect(msg, `page exception not classified: ${msg}`).toMatch(/page exception/iu);
    expect(msg, "page error text was dropped").toContain("TypeError: x is not a function");
  });

  it("(3) a failed request on a timed-out wait is classified as a failed request", async () => {
    const page = diagnosticPage();
    attachStationCapturePageDiagnostics(page as never);
    page.emit("requestfailed", {
      url: () => "http://127.0.0.1/xr-assets/generated/ed/humanoid.glb",
      failure: () => ({ errorText: "net::ERR_FAILED" }),
    });
    const msg = await messageFrom(() => waitForHumanoidAssetsLoaded(page as never, 10));
    expect(msg, `timeout does not name the wait: ${msg}`).toMatch(/humanoid|asset/iu);
    expect(msg, "Playwright Timeout was swallowed").toMatch(/Timeout/u);
    expect(msg, `failed request not classified: ${msg}`).toMatch(/failed request/iu);
    expect(msg, "failed request URL was dropped").toContain("humanoid.glb");
    expect(msg, "failed request errorText was dropped").toContain("net::ERR_FAILED");
  });

  it("(4) a silent timeout is classified as an unresponsive main thread, not a page exception", async () => {
    const page = diagnosticPage();
    attachStationCapturePageDiagnostics(page as never);
    const msg = await messageFrom(() => waitForStationShell(page as never, 10));
    expect(msg, "Playwright Timeout was swallowed").toMatch(/Timeout/u);
    expect(msg, `silent page not classified: ${msg}`).toMatch(/unresponsive main thread/iu);
    expect(msg, "silent page was labelled a page exception").not.toMatch(/classification: page exception/u);
    expect(msg, "silent page was labelled a failed request").not.toMatch(/classification: failed request/u);
  });

  it("(5) COUNTERWEIGHT: the three classifications are distinguishable from each other", async () => {
    const exceptionPage = diagnosticPage();
    attachStationCapturePageDiagnostics(exceptionPage as never);
    exceptionPage.emit("pageerror", new Error("boom"));
    const exceptionMsg = await messageFrom(() => waitForStationShell(exceptionPage as never, 10));

    const requestPage = diagnosticPage();
    attachStationCapturePageDiagnostics(requestPage as never);
    requestPage.emit("requestfailed", {
      url: () => "http://127.0.0.1/missing.glb",
      failure: () => ({ errorText: "net::ERR_ABORTED" }),
    });
    const requestMsg = await messageFrom(() => waitForStationShell(requestPage as never, 10));

    const silentPage = diagnosticPage();
    attachStationCapturePageDiagnostics(silentPage as never);
    const silentMsg = await messageFrom(() => waitForStationShell(silentPage as never, 10));

    expect(exceptionMsg, "page exception and failed request produce the same message")
      .not.toBe(requestMsg);
    expect(exceptionMsg, "page exception and silent page produce the same message")
      .not.toBe(silentMsg);
    expect(requestMsg, "failed request and silent page produce the same message")
      .not.toBe(silentMsg);
  });
});
