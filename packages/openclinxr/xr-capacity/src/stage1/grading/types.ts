import type { DuplexAudioOwnership, DuplexAudioRecord } from "../audio/types.js";
import type { Stage0Record, Stage0Release } from "../../stage0/types.js";

export type Stage1Mode = "off" | "duplex";
export interface Stage1Slot { pair: 1 | 2 | 3; position: 1 | 2; nonce: string }
export interface Stage1ScheduledSlot extends Stage1Slot { mode: Stage1Mode }

/** One new release for all six sessions; unchanged Stage0 graders accept this shape. */
export interface Stage1Release extends Stage0Release {
  schema: "quest-stage1-release.v1";
  audioConfigSha256: string;
  workletSha256: string;
  effectiveAudio: { sampleRate: number; trackSettings: MediaTrackSettings };
  slots: Stage1ScheduledSlot[];
}

/** XR and audio main-thread stamps share this page's performance.timeOrigin. */
export interface Stage1Record {
  schema: "quest-stage1-record.v1";
  mode: Stage1Mode;
  slot: Stage1Slot;
  pageTimeOriginMs: number;
  xr: Stage0Record;
  audio: DuplexAudioRecord | null;
  audioOwnership: DuplexAudioOwnership;
}

export interface Stage1Distribution {
  count: number;
  mean: number | null;
  median: number | null;
  p95: number | null;
  maximum: number | null;
}
export interface Stage1PairedDescription {
  pair: 1 | 2 | 3;
  order: Stage1Mode[];
  off: { nonce: string; cadence: Stage1Distribution; cpu: Stage1Distribution } | null;
  duplex: { nonce: string; cadence: Stage1Distribution; cpu: Stage1Distribution } | null;
  /** Differences of raw arithmetic means; no quantile subtraction. */
  meanDifferences: { callbackIntervalMs: number | null; xrMainThreadWallMs: number | null };
}
