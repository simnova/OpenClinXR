import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildIwsdkOperatorSteeringBlockers } from "../../../packages/openclinxr/arena/iwsdk-spike/src/index.js";

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
    const proposalFiles: string[] = [];

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

  it("keeps approved proposal history available after the June proposal purge", async () => {
    const operatorSteeringText = await readFile("operator-steering-needed-questions.md", "utf8");
    const approvedProposalNames = [
      "proposal-iwsdk-sidecar-install.md",
      "proposal-local-model-benchmark.md",
      "proposal-local-voice-runtime.md",
      "proposal-quest-foreground-performance-capture.md",
      "proposal-webxr-mixed-reality-mode.md",
      "proposal-iwsdk-phase2-devtools.md",
    ];

    for (const proposalName of approvedProposalNames) {
      expect(operatorSteeringText).toContain(`historical; proposals/ purged; see git for ${proposalName}`);
    }

    expect(operatorSteeringText).toContain("approved [proposal-local-model-benchmark.md]");
    expect(operatorSteeringText).toContain("approved [proposal-local-voice-runtime.md]");
    expect(operatorSteeringText).toContain("approved [proposal-quest-foreground-performance-capture.md]");
    expect(operatorSteeringText).toContain("approved [proposal-webxr-mixed-reality-mode.md]");
    expect(operatorSteeringText).toContain("approved [proposal-iwsdk-phase2-devtools.md]");
  });
});
