import { readFileSync } from "node:fs";
import { buildSchema, type GraphQLSchema } from "graphql";
export { adminGraphqlDocuments, type AdminGraphqlDocument } from "./documents.js";

export const openClinXrAdminSchemaSdl = readFileSync(new URL("./schema.graphql", import.meta.url), "utf8");

export type GraphqlCodegenPlan = {
  schema: string;
  documents: string[];
  generates: Record<string, {
    preset?: string;
    plugins?: string[];
    config?: Record<string, unknown>;
  }>;
};

export function buildAdminGraphqlSchema(): GraphQLSchema {
  return buildSchema(openClinXrAdminSchemaSdl);
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
