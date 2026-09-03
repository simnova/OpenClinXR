export type AuthoredTurnReplayRecord = {
  authoredBindingId: string;
  speakerActorId: string;
  spokenText: string;
  caption: string;
  affect: string;
};

export function authoredTurnReplayFromPayload(
  payload: Record<string, unknown> | undefined,
): AuthoredTurnReplayRecord | undefined {
  const binding = payload?.["authoredBinding"];
  if (!isRecord(binding)) {
    return undefined;
  }
  const authoredBindingId = stringField(binding, "authoredBindingId");
  const speakerActorId = stringField(binding, "speakerActorId");
  const spokenText = stringField(binding, "spokenText");
  const caption = stringField(binding, "caption");
  const affect = stringField(binding, "affect");
  if (!authoredBindingId || !speakerActorId || !spokenText || !caption || !affect) {
    return undefined;
  }
  return { authoredBindingId, speakerActorId, spokenText, caption, affect };
}

export function summarizeAuthoredTurnReplay(record: AuthoredTurnReplayRecord): string {
  return [
    `authoredBinding ${record.authoredBindingId}`,
    `speaker ${record.speakerActorId}`,
    `spokenText ${record.spokenText}`,
    `caption ${record.caption}`,
    `affect ${record.affect}`,
  ].join("; ");
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
