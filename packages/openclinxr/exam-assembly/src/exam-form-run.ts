/**
 * Internal exam-form completion path. Public run functions stay on exam-run.ts
 * via the package entrypoint; this module is not a new public export.
 */
export { completeExamFormRunWithAttemptManifest } from "./attempt-manifest/complete-exam-attempt.js";
export type {
  CompleteExamFormRunWithAttemptManifestInput,
  CompletedExamFormRunWithAttemptManifest,
} from "./attempt-manifest/types.js";
