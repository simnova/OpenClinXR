/** OWNER PLANT: default-denying factory scaffold, not a functional audio runtime. */
export function createActorAudioRuntime(options: { developmentFixture?: boolean; fixtureSearch?: string } = {}) {
  const refused = () => ({ kind: "refused" as const, reason: "prepared_audio_unavailable" as const });
  const diagnostics = {
    installRuntime(_input: unknown): void {
      if (!options.developmentFixture || new URLSearchParams(options.fixtureSearch).get("openclinxrSpeakFixture") !== "1") throw new Error("diagnostic-disabled");
    },
    registerEntry(_entry: unknown): void {
      if (!options.developmentFixture || new URLSearchParams(options.fixtureSearch).get("openclinxrSpeakFixture") !== "1") throw new Error("diagnostic-disabled");
    },
  };
  return {
    initPreparedActorAudioBridge(_deps?: unknown): void {},
    startPreparedActorTurnAudio(_context: unknown): boolean { return false; },
    startPreparedActorTurnAudioOutcome(_context: unknown) { return refused(); },
    syncPreparedActorAudio(_displayNowMs: number): void {},
    preparedActorTurnAudioAvailable(_context: unknown): boolean { return false; },
    startActorTurnSpeech(_context: unknown, _ordinary: unknown) { return refused(); },
    diagnostics,
  };
}
