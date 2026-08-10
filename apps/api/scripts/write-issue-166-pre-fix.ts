/**
 * Write the #166 pre-fix baseline artifact.
 *
 * Records all 14 shipped scenarios (status / validationStage / four review flags /
 * isActivationEligible) measured through the REAL api routes and the REAL learner resolver
 * (`createApiApp` + in-process fetch + `resolveLearnerExamScenarios`), before any product edit.
 *
 * Run: pnpm --filter @openclinxr/api exec tsx scripts/write-issue-166-pre-fix.ts
 */

import { writePreFixArtifact } from "../src/scenario-promotion-baseline.js";

const artifactPath = await writePreFixArtifact();
console.log(`pre-fix artifact written: ${artifactPath}`);
