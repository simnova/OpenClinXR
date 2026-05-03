import { readFileSync } from "node:fs";

export type AdminGraphqlDocument = {
  routeId: string;
  operationName: string;
  source: string;
};

const documentFiles = [
  { routeId: "scenario-bank", operationName: "ScenarioBank", path: "./documents/scenario-bank.graphql" },
  { routeId: "review-packet-replay", operationName: "ReviewPacketReplay", path: "./documents/review-packet-replay.graphql" },
  { routeId: "exam-form-workbench", operationName: "ExamFormWorkbench", path: "./documents/exam-form-workbench.graphql" },
  { routeId: "exam-form-assembly", operationName: "AssembleExamForm", path: "./documents/assemble-exam-form.graphql" },
] as const;

export const adminGraphqlDocuments: AdminGraphqlDocument[] = documentFiles.map((document) => ({
  routeId: document.routeId,
  operationName: document.operationName,
  source: readFileSync(new URL(document.path, import.meta.url), "utf8"),
}));
