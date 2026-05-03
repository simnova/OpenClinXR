export type AdminGraphqlDocument = {
  routeId: string;
  operationName: string;
  source: string;
};

export { adminGraphqlDocuments } from "./generated/documents.generated.js";
