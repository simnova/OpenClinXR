import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenClawDriftReport, loadInputFromWorkspace } from "./check-openclaw-drift.js";

const ROOT_REGISTRY = "docs/openclinxr/doc-authority-registry-2026-05-27.json";
const PROBE_DIR = "docs/openclinxr/authority-manifest-probe";
const PROBE_DOC = `${PROBE_DIR}/actor-turn-policy.md`;

describe("directory authority manifest", () => {
  it("a new markdown file under a directory manifest does not require a root registry edit", () => {
    const before = readFileSync(ROOT_REGISTRY);
    mkdirSync(PROBE_DIR, { recursive: true });
    writeFileSync(path.join(PROBE_DIR, ".authority.json"), "{}\n");
    writeFileSync(PROBE_DOC, "# probe\n");
    try {
      const report = buildOpenClawDriftReport(loadInputFromWorkspace());
      const unregistered = report.failures.filter(
        (failure) => failure.file === PROBE_DOC && failure.message.includes("not registered"),
      );
      expect(unregistered).toEqual([]);
      expect(readFileSync(ROOT_REGISTRY).equals(before)).toBe(true);
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true });
    }
  });
});
