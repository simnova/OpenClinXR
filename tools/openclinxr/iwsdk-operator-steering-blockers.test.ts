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
});
