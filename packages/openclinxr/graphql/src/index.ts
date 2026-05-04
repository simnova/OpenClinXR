import { buildSchema, graphql, type ExecutionResult, type GraphQLSchema } from "graphql";
export { adminGraphqlDocumentByOperationName, adminGraphqlDocuments, type AdminGraphqlDocument } from "./documents.js";
export { openClinXrAdminSchemaSdl } from "./schema.js";
import { openClinXrAdminSchemaSdl } from "./schema.js";

export type GraphqlCodegenPlan = {
  schema: string;
  documents: string[];
  generates: Record<string, {
    preset?: string;
    plugins?: string[];
    config?: Record<string, unknown>;
  }>;
};

export type AdminGraphqlExecutionInput = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export function buildAdminGraphqlSchema(): GraphQLSchema {
  return buildSchema(openClinXrAdminSchemaSdl);
}

export function executeAdminGraphql(input: AdminGraphqlExecutionInput, rootValue: unknown): Promise<ExecutionResult> {
  return graphql({
    schema: buildAdminGraphqlSchema(),
    source: input.query,
    rootValue,
    variableValues: input.variables,
    operationName: input.operationName,
  });
}

export function createGraphqlCodegenPlan(): GraphqlCodegenPlan {
  return {
    schema: "packages/openclinxr/graphql/src/schema.graphql",
    documents: ["packages/openclinxr/graphql/src/documents/**/*.graphql", "apps/ui-admin/src/**/*.graphql", "apps/ui-admin/src/**/*.tsx"],
    generates: {
      "apps/ui-admin/src/graphql/generated/": {
        preset: "client",
        config: {
          useTypeImports: true,
        },
      },
      "apps/api/src/graphql/generated/resolvers.ts": {
        plugins: ["typescript", "typescript-resolvers"],
        config: {
          useTypeImports: true,
        },
      },
    },
  };
}
