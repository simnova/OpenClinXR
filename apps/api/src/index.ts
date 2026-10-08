/**
 * Composition root for `apps/api` (CellixJS pattern).
 *
 * Domain lives in `packages/openclinxr/*`. This app only wires:
 *   initializeInfrastructureServices → setContext → initializeApplicationServices
 *   → registerAzureFunctionHttpHandler → startUp
 * (`createOpenClinXrApiStartup`, analogue of `Cellix.initializeInfrastructureServices`)
 * and the Hono route phases (`createApiApp` / `ApiApplication`).
 */
export { createApiApp } from "./app.js";
export { createOpenClinXrApiStartup } from "./api-bootstrap.js";
export type { OpenClinXrApiStartupOptions, StartedOpenClinXrApi } from "./api-bootstrap.js";
export type { ApiPersistenceSink } from "@openclinxr/rest";
export { createOpenClinXrApiProtocolPosture } from "@openclinxr/rest";
export type { OpenClinXrApiProtocolPosture } from "@openclinxr/rest";
