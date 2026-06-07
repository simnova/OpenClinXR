import { describe, expect, it } from "vitest";
import { buildHumanoidSourceSideBySideReportPage } from "./cagematch-report-pages.js";
import { validateCagematchReportPage } from "../../../packages/openclinxr/arena/model-vetting/src/cagematch-report.js";

describe("cagematch report page factory", () => {
  it("builds a valid humanoid source side-by-side report", () => {
    const report = buildHumanoidSourceSideBySideReportPage({
      runId: "2026-06-07-anny-vs-mpfb",
      generatedAt: "2026-06-07T00:00:00.000Z",
      mediaUrlPaths: [
        {
          mediaId: "front",
          label: "Front",
          urlPath: "/cagematch-reports/example/front.png",
          caption: "Front capture",
        },
      ],
    });
    const validation = validateCagematchReportPage(report);
    expect(validation.ok).toBe(true);
    expect(report.decisionBranches.length).toBeGreaterThan(3);
    expect(report.feasibilityCriteria.length).toBeGreaterThan(4);
    expect(report.interimVerdict.recommendedPrimary).toBe("anny_parametric_forward_pass");
  });
});