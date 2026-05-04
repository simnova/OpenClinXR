import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GraphQLObjectType, parse, validate } from "graphql";
import { adminGraphqlDocumentByOperationName, adminGraphqlDocuments, buildAdminGraphqlSchema, createGraphqlCodegenPlan, openClinXrAdminSchemaSdl } from "./index.js";

describe("OpenClinXR admin GraphQL contract", () => {
  it("builds a schema with admin workbench query and mutation roots", () => {
    const schema = buildAdminGraphqlSchema();
    const query = schema.getQueryType();
    const mutation = schema.getMutationType();

    expect(query?.getFields()).toHaveProperty("scenario");
    expect(query?.getFields()).toHaveProperty("examForm");
    expect(query?.getFields()).toHaveProperty("stationRunQueueSnapshots");
    expect(query?.getFields()).toHaveProperty("scenarioReviewDecisions");
    expect(query?.getFields()).toHaveProperty("reviewPacket");
    expect(query?.getFields()).toHaveProperty("traceEvents");
    expect(mutation?.getFields()).toHaveProperty("assembleExamForm");
    expect(mutation?.getFields()).toHaveProperty("submitScenarioReview");
    expect(mutation?.getFields()).toHaveProperty("saveFacultyScoreDraft");
    expect(mutation?.getFields()).toHaveProperty("createStationRunQueueSnapshot");
  });

  it("includes clinical governance and trace quality types needed by the admin UI", () => {
    const schema = buildAdminGraphqlSchema();

    expect(schema.getType("ScenarioReviewState")).toBeDefined();
    expect(schema.getType("ReviewTraceQuality")).toBeDefined();
    expect(schema.getType("TraceEvent")).toBeDefined();
    expect(schema.getType("AssetReadiness")).toBeDefined();
    expect(schema.getType("StationRunQueueSnapshot")).toBeDefined();
    expect(schema.getType("ScenarioReviewDecisionRecord")).toBeDefined();
    const queueType = schema.getType("StationRunQueue");
    const queueItemType = schema.getType("StationRunQueueItem");
    expect(queueType).toBeInstanceOf(GraphQLObjectType);
    expect(queueItemType).toBeInstanceOf(GraphQLObjectType);
    expect((queueType as GraphQLObjectType).getFields()).toHaveProperty("breakCheckpoints");
    expect((queueType as GraphQLObjectType).getFields()).toHaveProperty("totalStationTimeSeconds");
    expect((queueItemType as GraphQLObjectType).getFields()).toHaveProperty("timing");
    expect(openClinXrAdminSchemaSdl).toContain("syntheticCaseDisclosure");
    expect(openClinXrAdminSchemaSdl).toContain("voiceAudioEventCount");
  });

  it("describes a GraphQL Code Generator plan without Apollo-version-specific generated hooks", () => {
    expect(createGraphqlCodegenPlan()).toEqual({
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
    });
  });

  it("ships seed admin operation documents that validate against the schema", () => {
    const schema = buildAdminGraphqlSchema();
    expect(adminGraphqlDocuments.map((document) => document.operationName)).toEqual([
      "ScenarioBank",
      "ScenarioDetail",
      "ReviewPacketReplay",
      "ExamFormWorkbench",
      "AssembleExamForm",
      "CreateStationRunQueueSnapshot",
      "SubmitScenarioReview",
      "ScenarioReviewDecisions",
      "SaveFacultyScoreDraft",
      "StationRunQueueSnapshots",
    ]);

    for (const document of adminGraphqlDocuments) {
      expect(validate(schema, parse(document.source)), document.operationName).toEqual([]);
    }
    expect(JSON.stringify(adminGraphqlDocuments)).not.toContain("hiddenFacts");
  });

  it("looks up generated operation documents by operation name", () => {
    expect(adminGraphqlDocumentByOperationName("StationRunQueueSnapshots")).toMatchObject({
      routeId: "station-run-queue-snapshots",
      operationName: "StationRunQueueSnapshots",
      source: expect.stringContaining("stationRunQueueSnapshots"),
    });
    expect(() => adminGraphqlDocumentByOperationName("MissingOperation")).toThrow(
      "OpenClinXR admin GraphQL document missing: MissingOperation",
    );
  });

  it("keeps bundled schema and operation strings in sync with source GraphQL files", () => {
    expect(openClinXrAdminSchemaSdl).toBe(readFileSync(new URL("./schema.graphql", import.meta.url), "utf8"));

    const documentPathsByRouteId = new Map([
      ["scenario-bank", "./documents/scenario-bank.graphql"],
      ["scenario-detail", "./documents/scenario-detail.graphql"],
      ["review-packet-replay", "./documents/review-packet-replay.graphql"],
      ["exam-form-workbench", "./documents/exam-form-workbench.graphql"],
      ["exam-form-assembly", "./documents/assemble-exam-form.graphql"],
      ["station-run-queue-snapshot", "./documents/create-station-run-queue-snapshot.graphql"],
      ["scenario-review-decision", "./documents/submit-scenario-review.graphql"],
      ["scenario-review-decisions", "./documents/scenario-review-decisions.graphql"],
      ["faculty-score-draft", "./documents/save-faculty-score-draft.graphql"],
      ["station-run-queue-snapshots", "./documents/station-run-queue-snapshots.graphql"],
    ]);

    for (const document of adminGraphqlDocuments) {
      const documentPath = documentPathsByRouteId.get(document.routeId);
      expect(documentPath, document.routeId).toBeDefined();
      expect(document.source, document.routeId).toBe(readFileSync(new URL(documentPath ?? "", import.meta.url), "utf8"));
    }
  });
});
