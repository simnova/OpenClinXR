import { describe, expect, it } from "vitest";
import { parse, validate } from "graphql";
import { adminGraphqlDocuments, buildAdminGraphqlSchema, createGraphqlCodegenPlan, openClinXrAdminSchemaSdl } from "./index.js";

describe("OpenClinXR admin GraphQL contract", () => {
  it("builds a schema with admin workbench query and mutation roots", () => {
    const schema = buildAdminGraphqlSchema();
    const query = schema.getQueryType();
    const mutation = schema.getMutationType();

    expect(query?.getFields()).toHaveProperty("scenario");
    expect(query?.getFields()).toHaveProperty("examForm");
    expect(query?.getFields()).toHaveProperty("reviewPacket");
    expect(query?.getFields()).toHaveProperty("traceEvents");
    expect(mutation?.getFields()).toHaveProperty("assembleExamForm");
    expect(mutation?.getFields()).toHaveProperty("submitScenarioReview");
  });

  it("includes clinical governance and trace quality types needed by the admin UI", () => {
    const schema = buildAdminGraphqlSchema();

    expect(schema.getType("ScenarioReviewState")).toBeDefined();
    expect(schema.getType("ReviewTraceQuality")).toBeDefined();
    expect(schema.getType("TraceEvent")).toBeDefined();
    expect(schema.getType("AssetReadiness")).toBeDefined();
    expect(openClinXrAdminSchemaSdl).toContain("syntheticCaseDisclosure");
    expect(openClinXrAdminSchemaSdl).toContain("voiceAudioEventCount");
  });

  it("describes a GraphQL Code Generator plan without Apollo-version-specific generated hooks", () => {
    expect(createGraphqlCodegenPlan()).toEqual({
      schema: "packages/admin-graphql/src/schema.graphql",
      documents: ["packages/admin-graphql/src/documents/**/*.graphql", "apps/admin/src/**/*.graphql", "apps/admin/src/**/*.tsx"],
      generates: {
        "apps/admin/src/graphql/generated/": {
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
    });
  });

  it("ships seed admin operation documents that validate against the schema", () => {
    const schema = buildAdminGraphqlSchema();
    expect(adminGraphqlDocuments.map((document) => document.operationName)).toEqual([
      "ScenarioBank",
      "ReviewPacketReplay",
      "ExamFormWorkbench",
      "AssembleExamForm",
    ]);

    for (const document of adminGraphqlDocuments) {
      expect(validate(schema, parse(document.source)), document.operationName).toEqual([]);
    }
    expect(JSON.stringify(adminGraphqlDocuments)).not.toContain("hiddenFacts");
  });
});
