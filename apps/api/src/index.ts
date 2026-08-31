/**
 * Composition root for `apps/api` (CellixJS pattern).
 *
 * Domain lives in `packages/openclinxr/*`. This app only wires:
 *   initializeInfrastructureServices → setContext → initializeApplicationServices
 *   → registerAzureFunctionHttpHandler → startUp
 * (`createOpenClinXrApiStartup`, analogue of `Cellix.initializeInfrastructureServices`)
 * and the Hono route phases (`createApiApp` / `ApiApplication`).
 */
export * from "./api-bootstrap.js";
export * from "./app.js";
export * from "./protocol-support.js";
export * from "./runtime-durable-store.js";
