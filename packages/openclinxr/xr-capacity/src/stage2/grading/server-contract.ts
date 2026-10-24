import type {
  ReservationAudit, Stage2AudioPosition, Stage2Codec, Stage2DecodedConsumer, Stage2Envelope,
  Stage2HealthBin, Stage2SelectedPair, Stage2ServerCloseAck, Stage2ServerMarkAck, Stage2Source,
} from "./types.js";

/** POST /stage2/stats JSON. -1 starts a history; thereafter use returned nextAfterSequence.
 * One history/page, <=16 rows. This reads actual counters; HTTP receipt time never advances audio positions.
 */
export interface Stage2StatsRequest extends Stage2Envelope {
  history: "uplink-decoded" | "downlink-source";
  afterSequence: number;
}
export interface Stage2BinPage {
  history: Stage2StatsRequest["history"];
  afterSequence: number;
  nextAfterSequence: number;
  rows: Stage2HealthBin[];
  totalAvailableRows: number;
  /** True only after source/consumer stop has flushed its nonempty final tail. */
  final: boolean;
}
/** Server-owned observations only. Browser fields are joined independently into final mappings. */
export interface Stage2ServerReceiverBinding {
  sourceId: string; receiverTrackId: string | null; receiverSdpTrackId: string | null;
  mid: string | null; ssrc: number | null; codec: Stage2Codec | null; bindingObserved: boolean;
}
export interface Stage2ServerSenderBinding {
  sourceId: string; kind: Stage2Source["kind"]; sourceTrackId: string | null; senderTrackId: string | null;
  mid: string | null; ssrc: number | null; codec: Stage2Codec | null; bindingObserved: boolean;
}
export interface Stage2ServerSnapshot extends Stage2Envelope {
  schema: "quest-stage2-host-server-snapshot.v1";
  serverClockId: string; atServerMs: number; allocatedAtServerMs: number;
  iceState: string; dtlsState: string;
  uplinkDecoded: Omit<Stage2DecodedConsumer, "bins">;
  downlinkSource: Omit<Stage2Source, "bins">;
  /** Last actual process end-exclusive positions, null before first process. */
  positions: { uplinkDecoded: Stage2AudioPosition | null; downlinkSource: Stage2AudioPosition | null };
  bindings: { uplinkReceiver: Stage2ServerReceiverBinding; downlinkSender: Stage2ServerSenderBinding };
  selectedPair: Stage2SelectedPair | null;
  marks: Stage2ServerMarkAck[];
  page: Stage2BinPage;
  resources: {
    /** Actual Python owner reservation audit; null if setup could not establish it. */
    reservation: ReservationAudit | null;
    activePeers: number; closingPeers: number; ownedTasks: number; pendingControls: number; queuedControlBytes: number;
    maximumConcurrentControls: number; maximumQueuedControlBytes: number;
    typedHealthBytes: number; knownPendingPayloadBytes: number; ownedControlBytes: number;
    dropped: number; rejected: number; overflow: number;
  };
  close: Stage2ServerCloseAck | null;
  outcome: "preparing" | "running" | "completed" | "failed" | "unsupported";
  reason: string | null;
}
/** After matching /close ACK, /stats remains read-only for this exact ticket/nonce until
 * owned service shutdown. Final totals/pages are immutable and include every nonempty tail.
 * Client drains BOTH histories through final=true and nextAfterSequence=totalAvailableRows-1
 * before constructing a complete run. Empty page keeps cursor unchanged. No dropped rows,
 * sequence resets, reused ticket, or synthetic final zero bin is permitted.
 * Closed archives count toward the same memory cap; no live peer/task is retained for paging.
 */
export type Stage2FinalSnapshot = Stage2ServerSnapshot;
