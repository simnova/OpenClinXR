/** Public audio-frame-tags contracts consumed by Quest capacity tooling. */
export { classify } from "../audio-frame-tags/classifier.js";
export { NUMERIC_BOUNDS, countMetadataScalars, decodeNodes, encodeNodes } from "../audio-frame-tags/codec.js";
export { closeGraph, deadlineStep, ownedCloseConfirmed, requireBrowserCommandIdentity } from "../audio-frame-tags/lifecycle.js";
export type { OperationState } from "../audio-frame-tags/lifecycle.js";
export { CONFIG } from "../audio-frame-tags/types.js";
export type { NodeRecord, Role } from "../audio-frame-tags/types.js";
export { WORKLET_SOURCE } from "../audio-frame-tags/worklet.js";
