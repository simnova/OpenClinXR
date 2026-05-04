import type { CodegenConfig } from "@graphql-codegen/cli";
import { createGraphqlCodegenPlan } from "./src/index.js";

const plan = createGraphqlCodegenPlan();
const packagePrefix = "packages/openclinxr/graphql/";

function packageRelativePath(repoRelativePath: string): string {
  if (!repoRelativePath.startsWith(packagePrefix)) {
    throw new Error(`GraphQL Codegen path must stay in @openclinxr/graphql: ${repoRelativePath}`);
  }

  return repoRelativePath.slice(packagePrefix.length);
}

const generates = Object.fromEntries(
  Object.entries(plan.generates).map(([outputPath, outputConfig]) => [
    packageRelativePath(outputPath),
    outputConfig,
  ]),
) as CodegenConfig["generates"];

const config: CodegenConfig = {
  schema: packageRelativePath(plan.schema),
  documents: plan.documents.map(packageRelativePath),
  generates,
  ignoreNoDocuments: false,
};

export default config;
