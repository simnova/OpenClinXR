import { describe, expect, it } from "vitest";
import { adminPublicationGates, adminWorkbenchRoutes, findAdminWorkbenchRoute } from "./index.js";

describe("admin route manifest", () => {
  it("keeps the admin workbench routes outside the SPA app shell", () => {
    expect(adminWorkbenchRoutes.map((route) => route.path)).toEqual(["/authoring", "/scenarios", "/reviews", "/exam-forms"]);
    expect(adminWorkbenchRoutes.map((route) => route.id)).toEqual([
      "case-authoring",
      "scenario-bank",
      "review-packet-replay",
      "exam-form-workbench",
    ]);
    expect(findAdminWorkbenchRoute("/reviews")?.label).toBe("Review Replay");
    expect(findAdminWorkbenchRoute("/authoring")?.label).toBe("Case Authoring");
  });

  it("keeps publication gates in the expected review order", () => {
    expect(adminPublicationGates).toEqual([
      "Clinical review",
      "Psychometric review",
      "Legal review",
      "Simulation QA",
    ]);
  });
});
