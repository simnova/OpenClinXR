export type AdminGraphqlDocument = {
  routeId: string;
  operationName: string;
  source: string;
};

import { adminGraphqlDocuments } from "./generated/documents.generated.js";

export { adminGraphqlDocuments };

export function adminGraphqlDocumentByOperationName(operationName: string): AdminGraphqlDocument {
  const document = adminGraphqlDocuments.find((candidate) => candidate.operationName === operationName);
  if (!document) {
    throw new Error(`OpenClinXR admin GraphQL document missing: ${operationName}`);
  }

  return document;
}
