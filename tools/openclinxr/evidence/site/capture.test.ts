import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const TEST_FILE = fileURLToPath(new URL(import.meta.url));
const SITE_DIR = path.dirname(TEST_FILE);
const REPO_ROOT = path.resolve(SITE_DIR, "..", "..", "..", "..");
const CAPTURE_DIR = path.join(SITE_DIR, "capture");
const RR1 = path.join(CAPTURE_DIR, "rr1.mjs");

const A1_KEYS = ["buildSha", "seed", "blueprintId", "cameraPreset", "clientRoles", "ffmpeg"] as const;

interface DryRunPlan {
  argv: string[][];
  captureJson: Record<string, unknown>;
  serverPlan: { mode: string; chapters?: string[]; reason?: string; evidence?: string };
}

function dryRun(extra: string[]): DryRunPlan {
  const out = execFileSync("node", [RR1, "--dry-run", "--out", path.join(REPO_ROOT, "docs"), ...extra], {
    encoding: "utf8",
    timeout: 60000,
  });
  return JSON.parse(out) as DryRunPlan;
}

it("dry run prints argv naming c14 and c36 plus captureJson with all A1 keys", () => {
  const plan = dryRun([]);
  expect(plan.argv.length).toBe(5);
  const flat = plan.argv.map((entry) => entry.join(" ")).join("\n");
  expect(flat).toContain("c14-run.mjs");
  expect(flat).toContain("c36-run.mjs");
  for (const key of A1_KEYS) {
    expect(plan.captureJson).toHaveProperty(key);
  }
  expect(plan.captureJson["ffmpeg"]).toMatchObject({ version: null, args: null });
  for (const entry of plan.argv) {
    expect(entry[0]).toBe("node");
    expect(entry).toContain("--mode");
    expect(entry).toContain("host");
  }
});

it("capture dir defines no main and copies no runner line over 40 chars", () => {
  const runnerLongLines = new Set<string>();
  for (const runner of ["c14-run.mjs", "c36-run.mjs"]) {
    const text = readFileSync(path.join(REPO_ROOT, "tools", "openclinxr", "evidence", "xr-sync", runner), "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line === "" || line.startsWith("import ")) continue;
      if (line.length > 40) runnerLongLines.add(line);
    }
  }
  const files = readdirSync(CAPTURE_DIR);
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const text = readFileSync(path.join(CAPTURE_DIR, file), "utf8");
    expect(text).not.toMatch(/function\s+main\s*\(/);
    expect(text).not.toMatch(/(const|let|var)\s+main\s*=/);
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line === "" || line.startsWith("import ") || line.length <= 40) continue;
      expect(runnerLongLines.has(line), `copied runner line: ${line.slice(0, 80)}`).toBe(false);
    }
  }
});

it("chaptered dry run reports shared server or per-runner with evidence", () => {
  const plan = dryRun(["--chapters", "CH1,CH2,CH3,CH4,CH5"]);
  expect(plan.argv).toHaveLength(5);
  expect(plan.serverPlan.mode === "shared" || plan.serverPlan.mode === "per-runner").toBe(true);
  if (plan.serverPlan.mode === "shared") {
    expect(plan.serverPlan.chapters).toEqual(["CH1", "CH2", "CH3", "CH4", "CH5"]);
  } else {
    const evidence = plan.serverPlan.evidence ?? "";
    expect(evidence.length).toBeGreaterThan(0);
    const filePart = evidence.split(":")[0] ?? "";
    expect(existsSync(path.join(REPO_ROOT, filePart))).toBe(true);
  }
});
