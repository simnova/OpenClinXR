import { buildSchema, graphql, type ExecutionResult, type GraphQLSchema } from "graphql";
export { adminGraphqlDocumentByOperationName, adminGraphqlDocuments, type AdminGraphqlDocument } from "./documents.js";
export { openClinXrAdminSchemaSdl } from "./schema.js";
import { openClinXrAdminSchemaSdl } from "./schema.js";
import type {
  AssetReadiness,
  MutationCreateStationRunQueueSnapshotArgs,
  MutationSubmitScenarioReviewArgs,
  QueryAssetReadinessArgs,
  QueryScenarioArgs,
  QueryScenariosArgs,
  QueryStationRunQueueSnapshotsArgs,
  Scenario,
  StationRunQueueSnapshot,
} from "./generated/resolvers.generated.js";
export {
  ReviewDecision as AdminGraphqlReviewDecision,
  ScenarioStatus as AdminGraphqlScenarioStatus,
} from "./generated/resolvers.generated.js";

export type AdminGraphqlScenario = Scenario;

export type GraphqlCodegenPlan = {
  tool: "graphql-code-generator";
  configPath: string;
  schema: string;
  documents: string[];
  generates: Record<string, {
    preset?: string;
    plugins?: string[];
    config?: Record<string, unknown>;
  }>;
  guardrails: string[];
};

export type AdminGraphqlExecutionInput = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export type AdminGraphqlRootValue = {
  assetReadiness?: (
    args: QueryAssetReadinessArgs,
  ) => Promise<AssetReadiness> | AssetReadiness;
  scenario?: (
    args: QueryScenarioArgs,
  ) => Promise<AdminGraphqlScenario | null | undefined> | AdminGraphqlScenario | null | undefined;
  scenarios?: (
    args: QueryScenariosArgs,
  ) => Promise<AdminGraphqlScenario[]> | AdminGraphqlScenario[];
  stationRunQueueSnapshots?: (
    args: QueryStationRunQueueSnapshotsArgs,
  ) => Promise<StationRunQueueSnapshot[]> | StationRunQueueSnapshot[];
  createStationRunQueueSnapshot?: (
    args: MutationCreateStationRunQueueSnapshotArgs,
  ) => Promise<StationRunQueueSnapshot> | StationRunQueueSnapshot;
  submitScenarioReview?: (
    args: MutationSubmitScenarioReviewArgs,
  ) => Promise<AdminGraphqlScenario> | AdminGraphqlScenario;
};

export function buildAdminGraphqlSchema(): GraphQLSchema {
  return buildSchema(openClinXrAdminSchemaSdl);
}

export function executeAdminGraphql(input: AdminGraphqlExecutionInput, rootValue: AdminGraphqlRootValue): Promise<ExecutionResult> {
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
    tool: "graphql-code-generator",
    configPath: "packages/openclinxr/graphql/codegen.ts",
    schema: "packages/openclinxr/graphql/src/schema.graphql",
    documents: ["packages/openclinxr/graphql/src/documents/**/*.graphql"],
    generates: {
      "packages/openclinxr/graphql/src/generated/client/": {
        preset: "client",
        config: {
          emitLegacyCommonJSImports: false,
          useTypeImports: true,
        },
      },
      "packages/openclinxr/graphql/src/generated/resolvers.generated.ts": {
        plugins: ["typescript", "typescript-resolvers"],
        config: {
          emitLegacyCommonJSImports: false,
          useTypeImports: true,
        },
      },
    },
    guardrails: [
      "Generate typed documents from local schema and operation files only.",
      "Do not generate Apollo-version-specific React hooks until Apollo Client compatibility is verified.",
    ],
  };
}
