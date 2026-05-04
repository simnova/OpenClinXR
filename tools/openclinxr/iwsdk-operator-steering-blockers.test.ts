import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildIwsdkOperatorSteeringBlockers } from "../../packages/openclinxr/iwsdk-spike/src/index.js";

describe("IWSDK operator steering blockers", () => {
  it("keeps human approval blockers mirrored in the operator steering file", async () => {
    const operatorSteeringText = await readFile("operator-steering-needed-questions.md", "utf8");

    for (const blocker of buildIwsdkOperatorSteeringBlockers()) {
      expect(operatorSteeringText).toContain(blocker.operatorQuestionText);
      expect(operatorSteeringText).toContain(blocker.blockedAction);
    }
  });

  it("links non-simple open blockers to proposal files", async () => {
    const operatorSteeringText = await readFile("operator-steering-needed-questions.md", "utf8");
    const proposalFiles = [
      "proposal-local-model-benchmark.md",
      "proposal-local-voice-runtime.md",
      "proposal-quest-foreground-performance-capture.md",
      "proposal-iwsdk-phase2-devtools.md",
    ];

    for (const proposalFile of proposalFiles) {
      expect(operatorSteeringText).toContain(`[${proposalFile}](${proposalFile})`);
      const proposalText = await readFile(proposalFile, "utf8");
      expect(proposalText).toContain("# Proposal:");
      expect(proposalText).toContain("## Decision Needed");
      expect(proposalText).toContain("## Recommendation");
      expect(proposalText).toContain("## Pros");
      expect(proposalText).toContain("## Cons");
    }
    expect(operatorSteeringText).toContain("Simple physical-state actions");
  });
});
