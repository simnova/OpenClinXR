import { createRouteManifest, findRouteByPath } from "@openclinxr/ui-route-shared";

export const adminWorkbenchRoutes = createRouteManifest([
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
