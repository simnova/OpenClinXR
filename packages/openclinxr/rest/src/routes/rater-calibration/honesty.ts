import {
  assembledExamRaterCalibrationClaimBoundary,
  assembledExamRaterCalibrationNotEvidenceFor,
} from "../../runtime-durable-store.js";

export function raterCalibrationHonesty() {
  return {
    claimBoundary: assembledExamRaterCalibrationClaimBoundary,
    notEvidenceFor: assembledExamRaterCalibrationNotEvidenceFor,
    scoringValidityClaimed: false as const,
    examEquivalenceGate: false as const,
    agreementKind: "calibration_evidence" as const,
  };
}

export function forbiddenBody(reason: string) {
  return {
    error: "forbidden",
    reason,
    notEvidenceFor: [...assembledExamRaterCalibrationNotEvidenceFor],
  };
}

export function conflictBody(error: string, reason: string) {
  return {
    error,
    reason,
    ...raterCalibrationHonesty(),
  };
}
