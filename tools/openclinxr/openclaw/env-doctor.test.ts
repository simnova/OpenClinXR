import { describe, expect, it } from "vitest";
import { ENV_DOCTOR_SCHEMA_VERSION, runEnvDoctor } from "./env-doctor.ts";
import path from "node:path";

describe("env-doctor", () => {
  it("produces a v1 report for the repo root", () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    const report = runEnvDoctor(repoRoot);
    expect(report.schemaVersion).toBe(ENV_DOCTOR_SCHEMA_VERSION);
    expect(report.cwd).toBe(repoRoot);
    expect(["ok", "warn", "fail"]).toContain(report.health);
    expect(report.checks.length).toBeGreaterThan(5);
    expect(report.mcpCliMatrix.some((r) => r.mcpId.includes("playwright"))).toBe(true);
    expect(report.mcpCliMatrix.some((r) => r.recommendation === "prefer_cli")).toBe(true);
    expect(report.pins.miseTools).toBeTruthy();
    expect(report.pins.miseTools?.node).toBe("24");
    expect(report.pins.miseTools?.python).toBe("3.13");
  });
});
