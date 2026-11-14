/**
 * Narrow replay entry for the website MN2 recompute (card WN2, re-scope C).
 *
 * Publishes only the persisted-trace replay and its caption bank: the
 * website recompute imports the production trace replay and the production
 * replyId-to-caption lookup through
 * `@openclinxr/xr-sync-server/conversation-replay` so the MN2 comparison
 * runs production code, never a reimplementation. The root entrypoint is
 * unchanged (root export delta 0).
 */
export { replayConversationTrace } from "./conversation-trace.js";
export { createReplayCaptionBank } from "./replay-captions.js";
