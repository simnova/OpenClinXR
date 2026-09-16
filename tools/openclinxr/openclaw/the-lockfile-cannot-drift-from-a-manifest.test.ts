import { describe, expect, it } from "vitest";

import {
  buildLockfileDriftStep,
  LOCKFILE_DRIFT_RELEVANT_PATH,
} from "./agentic-hook-runner.js";

describe("lockfile drift detection step", () => {
  it("fires when package.json is staged", () => {
    expect(LOCKFILE_DRIFT_RELEVANT_PATH.test("apps/ui-xr/package.json")).toBe(true);
    expect(LOCKFILE_DRIFT_RELEVANT_PATH.test("packages/openclinxr/domain/package.json")).toBe(true);
    expect(LOCKFILE_DRIFT_RELEVANT_PATH.test("package.json")).toBe(true);
  });

  it("fires when pnpm-lock.yaml is staged", () => {
    expect(LOCKFILE_DRIFT_RELEVANT_PATH.test("pnpm-lock.yaml")).toBe(true);
  });

  it("does not fire on coordination-only files", () => {
    expect(LOCKFILE_DRIFT_RELEVANT_PATH.test("PROJECT_STATUS.md")).toBe(false);
    expect(LOCKFILE_DRIFT_RELEVANT_PATH.test("operator-open-questions.md")).toBe(false);
    expect(LOCKFILE_DRIFT_RELEVANT_PATH.test("docs/openclinxr/foo.md")).toBe(false);
  });

  it("does not fire on source files without manifest changes", () => {
    expect(LOCKFILE_DRIFT_RELEVANT_PATH.test("apps/ui-xr/src/main.ts")).toBe(false);
    expect(LOCKFILE_DRIFT_RELEVANT_PATH.test("packages/openclinxr/domain/src/claim-language.ts")).toBe(false);
  });

  it("builds a step that runs pnpm install --frozen-lockfile --lockfile-only", () => {
    const step = buildLockfileDriftStep(["apps/ui-xr/package.json"]);
    expect(step).not.toBeNull();
    expect(step?.label).toBe("Lockfile matches manifests");
    expect(step?.command).toEqual(["pnpm", "install", "--frozen-lockfile", "--lockfile-only"]);
  });

  it("returns null when no manifest or lockfile is staged", () => {
    expect(buildLockfileDriftStep(["apps/ui-xr/src/main.ts"])).toBeNull();
    expect(buildLockfileDriftStep(["PROJECT_STATUS.md"])).toBeNull();
    expect(buildLockfileDriftStep([])).toBeNull();
  });
});