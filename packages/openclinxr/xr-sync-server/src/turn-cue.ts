/**
 * One rule for an actor turn's cue id (FOLLOWUP-1 cue-author-01).
 *
 * The live room (actor-turns.ts) and the pure replay reducer
 * (conversation-trace.ts) both call this, so a stored trace replays to the
 * live cue: a cast opening keeps its opening cue, a resolved topic answer
 * carries `cue-answer:<replyId>`, and anything else keeps the scripted
 * fallback cue picked by turn count. This module holds the only `cue-answer:`
 * template literal in non-test server source.
 */
export function resolveTurnCueId(args: {
  /** True on the actor's cast opening turn (first turn + rostered). */
  isOpening: boolean;
  /** The opening cue (live CAST_OPENING_CUE_ID, trace CAST_TRACE_OPENING_CUE_ID). */
  openingCueId: string;
  /** The resolved topic answer's replyId (undefined when no answer resolved). */
  answerReplyId: string | undefined;
  /** The scripted C3 fallback cue for this turn count. */
  fallbackCueId: string;
}): string {
  if (args.isOpening) {
    return args.openingCueId;
  }
  if (args.answerReplyId !== undefined) {
    return `cue-answer:${args.answerReplyId}`;
  }
  return args.fallbackCueId;
}
