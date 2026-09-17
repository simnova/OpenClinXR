/** Owner semantic RED scaffold. No audio clock implementation or provider start. */
export function createAudioSpeechClock(_input: {
  slot: { activeSpeech?: unknown };
  speech: object;
  positionSeconds: () => number | null;
  wallOriginMs: number;
  rate: number;
}) {
  return {
    snapshot(_displayNowMs: number): void { throw new Error("audio-speech-clock-not-implemented"); },
    release(): void { throw new Error("audio-speech-clock-not-implemented"); },
  };
}
export function startPreparedActorTurnAudio(..._args: unknown[]): never {
  throw new Error("prepared-actor-audio-not-implemented");
}
export function syncPreparedActorAudio(..._args: unknown[]): never {
  throw new Error("prepared-actor-audio-not-implemented");
}
export function initPreparedActorAudioBridge(..._args: unknown[]): never {
  throw new Error("prepared-actor-audio-not-implemented");
}
