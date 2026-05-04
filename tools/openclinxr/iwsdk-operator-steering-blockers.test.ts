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

  it("moves approved proposal records under proposals/approved with approval timestamps", async () => {
    const operatorSteeringText = await readFile("operator-steering-needed-questions.md", "utf8");
    const approvedProposalFiles = [
      "proposals/approved/proposal-iwsdk-sidecar-install.md",
      "proposals/approved/proposal-local-model-benchmark.md",
      "proposals/approved/proposal-local-voice-runtime.md",
      "proposals/approved/proposal-quest-foreground-performance-capture.md",
      "proposals/approved/proposal-webxr-mixed-reality-mode.md",
      "proposals/approved/proposal-iwsdk-phase2-devtools.md",
    ];

    for (const proposalFile of approvedProposalFiles) {
      expect(operatorSteeringText).toContain(`](${proposalFile})`);
      const proposalText = await readFile(proposalFile, "utf8");
      expect(proposalText).toContain("# Proposal:");
      expect(proposalText).toContain("Status: Approved by Patrick");
      expect(proposalText).toContain("2026-05-04");
    }

    expect(await readFile("proposals/approved/proposal-local-model-benchmark.md", "utf8")).toContain(
      "Status: Approved by Patrick on 2026-05-04 10:40:15 EDT",
    );
    expect(await readFile("proposals/approved/proposal-local-voice-runtime.md", "utf8")).toContain(
      "Status: Approved by Patrick on 2026-05-04 10:40:15 EDT",
    );
    expect(await readFile("proposals/approved/proposal-quest-foreground-performance-capture.md", "utf8")).toContain(
      "Status: Approved by Patrick on 2026-05-04 11:49:38 EDT",
    );
    expect(await readFile("proposals/approved/proposal-webxr-mixed-reality-mode.md", "utf8")).toContain(
      "Status: Approved by Patrick on 2026-05-04 14:16:18 EDT",
    );
    expect(await readFile("proposals/approved/proposal-iwsdk-phase2-devtools.md", "utf8")).toContain(
      "Status: Approved by Patrick on 2026-05-04 14:19:29 EDT",
    );
  });
});
