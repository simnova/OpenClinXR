import path from "node:path";
import { describe, expect, it } from "vitest";
import { deriveGroupAndManifest, selectLatestVisionScoreReport } from "./pipeline-candidate-index.js";
import { parseArgs, promotionRecordFileName } from "./promote-candidate.js";

describe("deriveGroupAndManifest", () => {
  const annyRoot = "/repo/.openclinxr/asset-production/anny";
  it("derives group folder + manifest id for a nested candidate", () => {
    const result = deriveGroupAndManifest(
      path.join(annyRoot, "photoreal-skin-rung-2026-08-03", "nurse_winner.glb"),
      annyRoot,
    );
    expect(result.group).toBe("photoreal-skin-rung-2026-08-03");
    expect(result.manifestId).toBe("nurse_winner");
  });
  it("handles a glb directly under the root", () => {
    const result = deriveGroupAndManifest(path.join(annyRoot, "loose.glb"), annyRoot);
    expect(result.group).toBe("(root)");
    expect(result.manifestId).toBe("loose");
  });
});

describe("selectLatestVisionScoreReport", () => {
  it("picks the newest dated report", () => {
    expect(
      selectLatestVisionScoreReport([
        "humanoid-vision-score-2026-08-01.json",
        "humanoid-vision-score-2026-08-03.json",
        "humanoid-vision-score-2026-08-02.json",
        "unrelated.json",
      ]),
    ).toBe("humanoid-vision-score-2026-08-03.json");
  });
  it("returns null when none match", () => {
    expect(selectLatestVisionScoreReport(["other.json"])).toBeNull();
  });
});

describe("promote-candidate argument + filename helpers", () => {
  it("parses flags and value pairs", () => {
    const args = parseArgs(["--candidate-id", "g/a", "--apply-copy", "--reason", "best"]);
    expect(args["candidate-id"]).toBe("g/a");
    expect(args["apply-copy"]).toBe(true);
    expect(args["reason"]).toBe("best");
  });
  it("builds a filesystem-safe record filename", () => {
    const name = promotionRecordFileName("photoreal/nurse_winner", "2026-08-03T21:00:00.000Z");
    expect(name).not.toContain("/");
    expect(name).not.toContain(":");
    expect(name.endsWith(".json")).toBe(true);
    expect(name).toContain("photoreal_nurse_winner");
  });
});
