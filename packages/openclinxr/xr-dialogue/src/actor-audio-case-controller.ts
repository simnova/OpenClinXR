import type { CaseAudioController, CaseAudioOptions } from "./actor-audio-case-types.js";
/** OWNER semantic baseline: callable, valid API; the actual capability is not implemented. */
export function createCaseAudioController(_options: CaseAudioOptions | undefined): CaseAudioController {
  const controller: CaseAudioController = {
    select: bundle => bundle,
    bindPlan: consumed => consumed,
    preload: async () => ({ kind: "refused", reason: "not_implemented" }),
    markGesture: async () => {},
    start: () => null,
    dispose: () => ({ kind: "refused", reason: "not_implemented" }),
    snapshot: () => ({ selected: false, verifiedCount: 0, readyCount: 0, reason: "not_implemented" }),
  };
  return Object.freeze(controller);
}
