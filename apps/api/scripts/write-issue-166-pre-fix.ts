/**
 * Write the #166 pre-fix baseline artifact.
 *
 * Records all 14 shipped scenarios (status / validationStage / four review flags /
 * isActivationEligible) measured through the REAL api routes and the REAL learner resolver
 * (`createApiApp` + in-process fetch + `resolveLearnerExamScenarios`), before any product edit.
 *
 * Run: pnpm --filter @openclinxr/api exec tsx scripts/write-issue-166-pre-fix.ts
 */

import { createApiFetchTransport } from "../src/api-fetch-transport.js";
import { writePreFixArtifact } from "@openclinxr/rest";
import {
  createApiAppHarnessBridge,
  loadLearnerScenarioResolver,
} from "../src/scenario-promotion-bridge.js";

const bridge = createApiAppHarnessBridge();
const artifactPath = await writePreFixArtifact({
  ...bridge,
  loadLearnerScenarioResolver,
  wrapFetch: (dispatch) =>
    createApiFetchTransport((call) =>
      dispatch({ url: call.url, method: call.method, headers: call.headers, body: call.body }),
    ) as typeof fetch,
});
console.log(`pre-fix artifact written: ${artifactPath}`);
