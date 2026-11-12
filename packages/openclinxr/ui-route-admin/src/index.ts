import { createRouteManifest, findRouteByPath } from "@openclinxr/ui-route-shared";

export const adminWorkbenchRoutes = createRouteManifest([
  {
    id: "case-authoring",
    path: "/authoring",
    label: "Case Authoring",
    description: "Create and edit encounter cases that drive the factory; export scenario-bank JSON.",
    capabilityTags: ["Ant Design 6", "ScenarioSchema"],
  },
  {
    id: "scenario-bank",
    path: "/scenarios",
    label: "Scenario Bank",
    description: "Author, validate, and review case-bank scenarios before publication.",
    capabilityTags: ["GraphQL Codegen", "Apollo Client"],
  },
  {
    id: "review-packet-replay",
    path: "/reviews",
    label: "Review Replay",
    description: "Inspect trace replay, actor responses, scoring evidence, and reviewer findings.",
    capabilityTags: ["OpenTelemetry", "Serenity/JS"],
  },
  {
    id: "exam-form-workbench",
    path: "/exam-forms",
    label: "Exam Forms",
    description: "Assemble locked station sequences from approved scenarios and coverage targets.",
    capabilityTags: ["Psychometric Review", "MongoDB"],
  },
  {
    id: "faculty-review",
    path: "/faculty-review",
    label: "Faculty Review",
    description: "Join a finished encounter room as faculty, read each station's turns and score, and finalize the review.",
    capabilityTags: ["Colyseus"],
  },
]);

export const adminPublicationGates = Object.freeze([
  "Clinical review",
  "Psychometric review",
  "Legal review",
  "Simulation QA",
]);

export function findAdminWorkbenchRoute(path: string) {
  return findRouteByPath(adminWorkbenchRoutes, path);
}

/** The /faculty-review route: joins a finished encounter room as faculty and finalizes the review. */
export { FacultyReviewRoute } from "./faculty-review-console.js";
export { capabilityTagColor } from "./formatters.js";
export { ReviewReplayWorkbenchProvider, ReviewReplayWorkbenchUI } from "./review-replay-workbench.js";
export { ScenarioBankWorkbenchProvider, ScenarioBankWorkbenchUI } from "./scenario-bank-workbench.js";
export { ScenarioDetailWorkbenchProvider, ScenarioDetailWorkbenchUI } from "./scenario-detail-workbench.js";
export { SeedBlueprintWorkbenchProvider, SeedBlueprintWorkbenchUI } from "./seed-blueprint-workbench.js";
/** The admin "/" overview: one card per workbench route, then the publication gates in review order. */
export { WorkbenchOverview } from "./workbench-overview.js";
