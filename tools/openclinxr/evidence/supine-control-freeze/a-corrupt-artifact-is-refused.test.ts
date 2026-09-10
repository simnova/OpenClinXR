import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freezeRecordPath, requireSupineControlFreeze } from "./supine-control-freeze.js";

/**
 * Brief §7 step 5: "Corrupt or remove a produced artifact and require the consumer to refuse it."
 *
 * The artifact is corrupted FOR REAL here — written to a real file and read back through the real
 * consumer — rather than simulated by passing a bad object to a parser. A test that feeds a
 * hand-made object to the validator proves the validator works; it does not prove the consumer reads
 * the artifact through it, which is the half that fails in practice.
 */
// THE SUBJECT IS A REAL FILE THIS TEST OWNS, not the shared record.
//
// A first draft guessed `.../supine-control-freeze/supine-control-freeze.json`, corrupted a file
// nothing reads, and every clause returned `ok` — a test that passes while measuring an unrelated
// file on disk. The fix was to take the path from the module; the path was then a literal rebuilt
// from `process.cwd()` and a hardcoded `.openclinxr/evidence/...`, which is the same guess wearing a
// comment about not guessing.
//
// SC-06 moved the record to a TRACKED path, which made it SHARED: the byte-freeze gate in the file
// beside this one reads it, and vitest runs the two concurrently. Measured, 1 failure in 3 runs of
// this directory, green every time either file ran alone — this test's `rm` landing inside the
// other's read. So the damage now happens to a temp file this test creates and deletes, driven
// through the SAME reader, and clause (6) below holds the default resolver to the real record.
const OWNED = mkdtempSync(path.join(tmpdir(), "sc06-freeze-refusal-"));
const ARTIFACT_PATH = path.join(OWNED, "supine-control-freeze.record.json");

afterEach(() => {
  if (existsSync(ARTIFACT_PATH)) rmSync(ARTIFACT_PATH);
});

describe("a corrupt or removed freeze artifact is refused", () => {
  it("(1) REMOVED: the consumer reports absent and says why, rather than returning a usable nothing", () => {
    const read = requireSupineControlFreeze(ARTIFACT_PATH);
    expect(read.status).toBe("absent");
    if (read.status === "ok") throw new Error("unreachable");
    expect(read.reason.length).toBeGreaterThan(0);
    // The same literal-vs-resolver point as ARTIFACT_PATH above: assert the consumer named the file
    // it actually reads, not a filename this test remembers.
    expect(read.path).toBe(ARTIFACT_PATH);
  });

  it("(2) CORRUPT: a truncated file is refused as malformed, NOT as absent", () => {
    // The distinction is the point. Both used to come back as null, so a damaged control silently
    // became no control and the evidence depending on it kept being trusted.
    writeFileSync(ARTIFACT_PATH, '{"schemaVersion":"openclinxr.supine-contr', "utf8");

    const read = requireSupineControlFreeze(ARTIFACT_PATH);
    expect(read.status).toBe("malformed");
    if (read.status === "ok") throw new Error("unreachable");
    expect(read.reason).toMatch(/not parseable/);
  });

  it("(3) WRONG SCHEMA: valid JSON that is not this artifact is refused", () => {
    writeFileSync(ARTIFACT_PATH, JSON.stringify({ schemaVersion: "something.else.v9" }), "utf8");

    const read = requireSupineControlFreeze(ARTIFACT_PATH);
    expect(read.status).toBe("wrong_schema");
  });

  it("(4) COUNTERWEIGHT: an EMPTY hash map is refused, because it would validate every tree", () => {
    // This is the corruption that looks healthy. Right schema, parses cleanly, and it accepts any
    // asset bytes at all — a freeze that is worth less than no freeze while reporting ok.
    writeFileSync(
      ARTIFACT_PATH,
      JSON.stringify({
        schemaVersion: "openclinxr.supine-control-freeze.v1",
        scenarioId: "ed_chest_pain_priority_v2",
        assetSha256ByPath: {},
        staged: { posture: "supine", supportSurfaceCount: 1, clearanceAboveDeckMeters: 0.1 },
      }),
      "utf8",
    );

    const read = requireSupineControlFreeze(ARTIFACT_PATH);
    expect(read.status).toBe("wrong_schema");
    if (read.status === "ok") throw new Error("unreachable");
    expect(read.reason).toMatch(/no asset hashes/);
  });

  it("(5) CONTROL: a well-formed artifact still reads ok, so the refusals are not refusing everything", () => {
    writeFileSync(
      ARTIFACT_PATH,
      JSON.stringify({
        schemaVersion: "openclinxr.supine-control-freeze.v1",
        scenarioId: "ed_chest_pain_priority_v2",
        assetSha256ByPath: { "apps/ui-xr/public/x.glb": "a".repeat(64) },
        staged: { posture: "supine", supportSurfaceCount: 1, clearanceAboveDeckMeters: 0.1 },
      }),
      "utf8",
    );

    const read = requireSupineControlFreeze(ARTIFACT_PATH);
    expect(read.status).toBe("ok");
  });

  it("(6) THE BINDING: with no argument the reader resolves the tracked record, so the clauses above are not testing a path nothing uses", () => {
    // Without this, every clause above could pass against a temp file while the consumer read
    // somewhere else entirely — which is exactly the failure this file's first draft committed.
    const read = requireSupineControlFreeze();
    expect(read.status, read.status === "ok" ? "" : `refused: ${read.reason}`).toBe("ok");
    expect(freezeRecordPath()).toContain("supine-control-freeze.record.json");
    expect(existsSync(freezeRecordPath())).toBe(true);
  });
});
