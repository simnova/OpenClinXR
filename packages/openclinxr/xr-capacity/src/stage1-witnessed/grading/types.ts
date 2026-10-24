import type { DuplexAudioOwnership } from "../../stage1/audio/types.js";
import type { Stage1Mode, Stage1Slot, Stage1ScheduledSlot } from "../../stage1/grading/types.js";
import type { Stage0Record, Stage0Release } from "../../stage0/types.js";
import type { WitnessedAudioRecord } from "../audio/types.js";

export type { Stage1Mode, Stage1Slot, Stage1ScheduledSlot } from "../../stage1/grading/types.js";

/** A distinct release for the three-processor graph; old records cannot qualify. */
export interface WitnessedStage1Release extends Stage0Release {
  schema: "quest-stage1-witnessed-release.v1";
  audioConfigSha256: string;
  workletSha256: string;
  witnessWorkletSha256: string;
  effectiveAudio: { sampleRate: number; trackSettings: MediaTrackSettings };
  slots: Stage1ScheduledSlot[];
}
export interface WitnessedStage1Record {
  schema: "quest-stage1-witnessed-record.v1";
  mode: Stage1Mode;
  slot: Stage1Slot;
  pageTimeOriginMs: number;
  xr: Stage0Record;
  audio: WitnessedAudioRecord | null;
  audioOwnership: DuplexAudioOwnership;
}
