import type { createPlayback, createAudioSpeechClock, SpeechLike } from "./actor-audio-playback-clock.js";
import type { PlaybackBuffer, DiagnosticMouthCue } from "./actor-audio-prepared-data.js";
export type PreparedIdentity = {
  scenarioId: string;
  actorId: string;
  responseText: string;
  runnerConversationTurn: number;
  waveformSha256: string;
  cueSha256: string;
};

export type PreparedEntry = PreparedIdentity & {
  buffer: PlaybackBuffer & AudioBuffer;
  cues: DiagnosticMouthCue[];
  decodedSampleRate: number;
  decodedSampleCount: number;
};

export type LiveSlot = {
  actorId?: string;
  activeSpeech?: (SpeechLike & {
    text?: string;
    bakedCues?: DiagnosticMouthCue[];
    phonemeSequence?: readonly string[];
  }) | undefined;
  mediaPositionSeconds?: () => number | null;
  root?: { traverse: (fn: (object: unknown) => void) => void; userData?: Record<string, unknown> };
};

export type PreparedActorStartContext = {
  actorId: string;
  spokenText: string;
  contextState?: string;
  userActivated?: boolean;
  faceEmotion?: string;
  gazeTarget?: { kind: string; actorId: string | null };
  req?: unknown;
  emotionSource?: string;
  resumeOffset?: number;
};

export type Host = {
  getSlot?: (actorId: string) => unknown;
  triggerDialogue?: (ctx: PreparedActorStartContext) => void;
};

export type OwnedSession = {
  actorId: string;
  player: ReturnType<typeof createPlayback>;
  clock: ReturnType<typeof createAudioSpeechClock>;
  speech: SpeechLike;
  slot: LiveSlot;
  generation: string;
  nodeSerial: number;
  startedWhen: number;
  clockState: { lastContextTime: number; lastPosition: number };
  mediaPositionReader: () => number | null;
};

