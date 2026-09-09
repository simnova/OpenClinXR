import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { requireSupineControlFreeze } from "./supine-control-freeze.js";

/**
 * Brief §7 step 5: "Corrupt or remove a produced artifact and require the consumer to refuse it."
 *
 * The artifact is corrupted FOR REAL here — written to its actual path and restored afterwards —
 * rather than simulated by passing a bad object to a parser. A test that feeds a hand-made object
 * to the validator proves the validator works; it does not prove the consumer reads the artifact
 * through it, which is the half that fails in practice.
 */
// The path the CONSUMER reads, taken from the module's own constant rather than guessed. A first
// draft of this test guessed `.../supine-control-freeze/supine-control-freeze.json`, corrupted a
// file nothing reads, and every clause returned `ok` — a test that passes while measuring an
// unrelated file on disk.
const ARTIFACT_PATH = path.resolve(process.cwd(), ".openclinxr/evidence/supine-control-freeze.json");

let savedContents: string | null = null;
let createdDirectory = false;

function saveArtifact(): void {
  savedContents = existsSync(ARTIFACT_PATH) ? readFileSync(ARTIFACT_PATH, "utf8") : null;
  const directory = path.dirname(ARTIFACT_PATH);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
    createdDirectory = true;
  }
}

afterEach(() => {
  if (savedContents === null) {
    if (existsSync(ARTIFACT_PATH)) rmSync(ARTIFACT_PATH);
    if (createdDirectory) rmSync(path.dirname(ARTIFACT_PATH), { recursive: true, force: true });
  } else {
    writeFileSync(ARTIFACT_PATH, savedContents, "utf8");
  }
  savedContents = null;
  createdDirectory = false;
});

describe("a corrupt or removed freeze artifact is refused", () => {
  it("(1) REMOVED: the consumer reports absent and says why, rather than returning a usable nothing", () => {
    saveArtifact();
    if (existsSync(ARTIFACT_PATH)) rmSync(ARTIFACT_PATH);

    const read = requireSupineControlFreeze();
    expect(read.status).toBe("absent");
    if (read.status === "ok") throw new Error("unreachable");
    expect(read.reason.length).toBeGreaterThan(0);
    expect(read.path).toContain("supine-control-freeze.json");
  });

  it("(2) CORRUPT: a truncated file is refused as malformed, NOT as absent", () => {
    // The distinction is the point. Both used to come back as null, so a damaged control silently
    // became no control and the evidence depending on it kept being trusted.
    saveArtifact();
    writeFileSync(ARTIFACT_PATH, '{"schemaVersion":"openclinxr.supine-contr', "utf8");

    const read = requireSupineControlFreeze();
    expect(read.status).toBe("malformed");
    if (read.status === "ok") throw new Error("unreachable");
    expect(read.reason).toMatch(/not parseable/);
  });

  it("(3) WRONG SCHEMA: valid JSON that is not this artifact is refused", () => {
    saveArtifact();
    writeFileSync(ARTIFACT_PATH, JSON.stringify({ schemaVersion: "something.else.v9" }), "utf8");

    const read = requireSupineControlFreeze();
    expect(read.status).toBe("wrong_schema");
  });

  it("(4) COUNTERWEIGHT: an EMPTY hash map is refused, because it would validate every tree", () => {
    // This is the corruption that looks healthy. Right schema, parses cleanly, and it accepts any
    // asset bytes at all — a freeze that is worth less than no freeze while reporting ok.
    saveArtifact();
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

    const read = requireSupineControlFreeze();
    expect(read.status).toBe("wrong_schema");
    if (read.status === "ok") throw new Error("unreachable");
    expect(read.reason).toMatch(/no asset hashes/);
  });

  it("(5) CONTROL: a well-formed artifact still reads ok, so the refusals are not refusing everything", () => {
    saveArtifact();
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

    const read = requireSupineControlFreeze();
    expect(read.status).toBe("ok");
  });
});
