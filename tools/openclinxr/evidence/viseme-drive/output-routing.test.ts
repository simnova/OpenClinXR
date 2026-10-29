import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCaptureRunId, parseOutputRoot, resolveOutputPath } from "./output-routing.js";

const j = (...s: string[]): string => path.join(...s);

describe("output-routing", () => {
  it("resolves default legacy path without root", () => {
    expect(resolveOutputPath(undefined, ".openclinxr/evidence/viseme-drive-2026-08-06")).toBe(
      j(".openclinxr/evidence/viseme-drive-2026-08-06"),
    );
  });
  it("prefixes a valid root exactly once", () => {
    const r = "/tmp/out";
    expect(resolveOutputPath(r, ".openclinxr/evidence/viseme-drive-2026-08-06")).toBe(
      j(r, ".openclinxr/evidence/viseme-drive-2026-08-06"),
    );
  });
  it("joins frame path under the root exactly once", () => {
    const r = "/tmp/out";
    const outDir = resolveOutputPath(r, ".openclinxr/evidence/viseme-drive-2026-08-06");
    const insp = path.join(outDir, "inspection.json");
    expect(insp).toBe(j(r, ".openclinxr/evidence/viseme-drive-2026-08-06", "inspection.json"));
    expect(insp.split(r).length - 1).toBe(1);
  });
  it("refuses missing/duplicate/relative roots and parses valid forms", () => {
    expect(() => parseOutputRoot(["--output-root"])).toThrow(/missing value/);
    expect(() => parseOutputRoot(["--output-root", "a", "--output-root", "b"])).toThrow(/duplicate/);
    expect(() => parseOutputRoot(["--output-root=rel/path"])).toThrow(/relative/);
    expect(parseOutputRoot([])).toBeUndefined();
    expect(parseOutputRoot(["--output-root=/x"])).toBe("/x");
  });
  it("keeps default stills at the original tracked stills dir", () => {
    expect(resolveOutputPath(undefined, "tools", "openclinxr", "evidence", "speak-fixture-stills")).toBe(
      j("tools", "openclinxr", "evidence", "speak-fixture-stills"),
    );
  });
  it("routes optional install stills under the root exactly once", () => {
    const r = "/tmp/out";
    const stills = resolveOutputPath(r, "tools", "openclinxr", "evidence", "speak-fixture-stills");
    expect(stills).toBe(j(r, "tools", "openclinxr", "evidence", "speak-fixture-stills"));
    expect(stills.split(r).length - 1).toBe(1);
  });
  it("parses capture-run-id: none, valid, output-root combo, refusals", () => {
    expect(parseCaptureRunId([])).toBeNull();
    expect(parseCaptureRunId(["--capture-run-id", "2026-10-29-main73"])).toBe("2026-10-29-main73");
    expect(parseCaptureRunId(["--capture-run-id=2026-10-29-main73"])).toBe("2026-10-29-main73");
    expect(parseCaptureRunId(["--output-root=/x", "--capture-run-id", "2026-10-29-main73"])).toBe(
      "2026-10-29-main73",
    );
    expect(parseOutputRoot(["--output-root=/x", "--capture-run-id", "2026-10-29-main73"])).toBe("/x");
    expect(() => parseCaptureRunId(["--capture-run-id"])).toThrow(/missing value/);
    expect(() => parseCaptureRunId(["--capture-run-id="])).toThrow(/missing value/);
    expect(() => parseCaptureRunId(["--capture-run-id", "a/../b"])).toThrow(/refused/);
    expect(() => parseCaptureRunId(["--capture-run-id", "/abs"])).toThrow(/refused/);
    expect(() => parseCaptureRunId(["--capture-run-id", "a\\b"])).toThrow(/refused/);
    expect(() => parseCaptureRunId(["--capture-run-id", "a", "--capture-run-id", "b"])).toThrow(/duplicate/);
  });
});
