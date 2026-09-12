import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  waitForHumanoidAssetsLoaded,
  waitForStationShell,
} from "../ui-xr-environment-room-capture.js";

/**
 * OBSERVABLE: station-environment wait predicates named the types-only alias
 * `browserPageWindow` (browser-dom.d.ts). Playwright evals the closure in the
 * page, so the first waitForFunction throws
 * `ReferenceError: browserPageWindow is not defined` and the capture never
 * reaches a shell check or a wait budget.
 *
 * MEASURED 2026-09-12 on ed_chest_pain_priority_v2 (classify-one-render.ts):
 *
 *   page.waitForFunction: ReferenceError: browserPageWindow is not defined
 *
 * KNOWN-GOOD: model-vetting-glb-grade-capture.ts uses `globalThis` in the same
 * kind of closure (measured 2026-09-11).
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED` block.
 *
 * ## FIXED (#0) — 2026-09-11
 *
 * `waitForStationShell` and `waitForHumanoidAssetsLoaded` read page globals
 * through `globalThis`. The alias remains only in comments naming the defect.
 */

const CAPTURE_SOURCE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../ui-xr-environment-room-capture.ts"),
  "utf8",
);

const functionBody = (name: string): string => {
  const start = CAPTURE_SOURCE.indexOf(`export async function ${name}`);
  expect(start, `${name} disappeared`).toBeGreaterThan(-1);
  const next = CAPTURE_SOURCE.indexOf("\nexport ", start + 1);
  return CAPTURE_SOURCE.slice(start, next === -1 ? undefined : next);
};

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");

/** Stub that actually invokes the Playwright callback, the way the page does. */
const evaluatingPage = (): {
  waitForFunction: (fn: () => unknown) => Promise<unknown>;
  evaluate: () => Promise<{ ready: true; environmentId: string }>;
} => ({
  waitForFunction: (fn) => {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(err);
    }
  },
  evaluate: () => Promise.resolve({ ready: true, environmentId: "ed_exam" }),
});

describe("the wait predicates use the page global", () => {
  it("(0) VACUITY GUARD: invoking a callback that names the alias throws ReferenceError", () => {
    const broken = Function("return browserPageWindow");
    expect(() => broken()).toThrow(ReferenceError);
    expect(() => broken()).toThrow(/browserPageWindow is not defined/u);
  });

  it("(1) waitForStationShell's waitForFunction callback names globalThis, not the alias", () => {
    const body = stripComments(functionBody("waitForStationShell"));
    const waitAt = body.indexOf("waitForFunction");
    expect(waitAt, "waitForStationShell never calls waitForFunction").toBeGreaterThan(-1);
    const callback = body.slice(waitAt);
    expect(callback, "shell wait does not read globalThis").toMatch(/globalThis/);
    expect(callback, "shell wait still names the types-only alias").not.toMatch(/browserPageWindow/);
  });

  it("(2) waitForHumanoidAssetsLoaded's waitForFunction callback names globalThis, not the alias", () => {
    const body = stripComments(functionBody("waitForHumanoidAssetsLoaded"));
    const waitAt = body.indexOf("waitForFunction");
    expect(waitAt, "waitForHumanoidAssetsLoaded never calls waitForFunction").toBeGreaterThan(-1);
    const callback = body.slice(waitAt);
    expect(callback, "humanoid wait does not read globalThis").toMatch(/globalThis/);
    expect(callback, "humanoid wait still names the types-only alias").not.toMatch(/browserPageWindow/);
  });

  it("(3) waitForStationShell's predicate evaluates instead of throwing ReferenceError", async () => {
    const page = evaluatingPage();
    await expect(waitForStationShell(page as never, 10)).resolves.toMatchObject({
      ready: true,
      environmentId: "ed_exam",
    });
  });

  it("(4) waitForHumanoidAssetsLoaded's predicate evaluates instead of throwing ReferenceError", async () => {
    const page = evaluatingPage();
    await expect(waitForHumanoidAssetsLoaded(page as never, 10)).resolves.toBeUndefined();
  });
});
