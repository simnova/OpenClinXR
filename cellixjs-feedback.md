# CellixJS Feedback

Date started: 2026-05-03

This log captures observations from adapting CellixJS patterns inside OpenClinXR. It is intended as constructive upstream feedback for the CellixJS maintainers.

## Feedback Items

### CFX-001: Publish GraphQL static artifact workflow as a first-class migration path

- Observed in: `packages/cellix/graphql-codegen`, `packages/cellix/graphql-core`
- OpenClinXR context: Rolldown packaging exposed runtime file-loading risk when GraphQL schema/documents were read from `.graphql` files at startup. CellixJS already points in the right direction with static type-def generation and resolver manifests.
- Why it matters: Teams adopting CellixJS may not realize this is required until deployment bundling fails, especially for Azure Functions/serverless builds where runtime filesystem layout differs from source.
- Suggested improvement: Add a short migration guide showing before/after examples for replacing `readFileSync`, glob loading, and `loadFilesSync` with generated static artifacts, plus a recommended drift test that compares generated output back to source SDL.
- OpenClinXR workaround: Added a lightweight static artifact generator that emits TypeScript schema/document exports and a `generate:check` test gate. A later slice should replace the local script with GraphQL Code Generator plugins once server resolvers and permission manifests mature.

### CFX-002: Support source-entry bundling in the Rolldown config helper

- Observed in: `packages/cellix/config-rolldown`, `apps/api/rolldown.config.ts`
- OpenClinXR context: CellixJS builds TypeScript first with `tsgo --build` and then bundles `dist/index.js`. OpenClinXR currently uses `tsgo --noEmit` and bundles from `src/index.ts` to keep app packages lean while the monorepo is still maturing.
- Why it matters: Both approaches are valid. A config helper that clearly supports either `dist` entry bundling or direct source-entry bundling would reduce local wrapper code for projects that prefer no-emit typechecking plus direct bundling.
- Suggested improvement: Document and test an explicit `input` option for source TypeScript entries, including workspace alias discovery and serverless deploy preparation.
- OpenClinXR workaround: Created a project-owned `@openclinxr/config-rolldown` wrapper that preserves the Cellix-style alias/deploy behavior while supporting direct source input and latest Rolldown.

### CFX-003: Consider copying `.funcignore` during Azure Functions deploy prep

- Observed in: `packages/cellix/config-rolldown`
- OpenClinXR context: The deploy preparation helper copies `host.json` and writes a deploy `package.json`, while the app-level `.funcignore` remains outside the prepared deploy folder.
- Why it matters: When a team treats `deploy/` as the script root or publish root, keeping `.funcignore` beside `host.json` makes the deploy artifact more self-contained and reduces accidental upload of source maps, TypeScript sources, local settings, or tool-only dependencies.
- Suggested improvement: Copy `.funcignore` to the deploy directory when it exists, and skip it without failing when a project does not use one.
- OpenClinXR workaround: `@openclinxr/config-rolldown` now copies `.funcignore` opportunistically during deploy preparation.
