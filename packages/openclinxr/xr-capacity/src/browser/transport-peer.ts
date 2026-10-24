import { boundedResponseText, localEndpoint, transportDeadline, type TransportConnection, type TransportLedger } from "./transport-probes-state.js";

/** Nominated ICE pairs are candidates, not proof of the path carrying this transport. */
export function selectRtcCandidatePair(entries: ReadonlyMap<string, Record<string, unknown>>): { status: "selected" | "ambiguous" | "unknown"; pair: Record<string, unknown> | null; source: string } {
  const pointerIds = new Set<string>();
  for (const entry of entries.values()) if (entry['type'] === "transport" && typeof entry['selectedCandidatePairId'] === "string" && entry['selectedCandidatePairId']) pointerIds.add(entry['selectedCandidatePairId']);
  if (pointerIds.size > 1) return { status: "ambiguous", pair: null, source: "multiple-transport-selectedCandidatePairIds" };
  if (pointerIds.size === 1) {
    const pair = entries.get([...pointerIds][0] ?? "");
    return pair?.['type'] === "candidate-pair" && pair['state'] === "succeeded"
      ? { status: "selected", pair, source: "transport.selectedCandidatePairId" }
      : { status: "unknown", pair: null, source: "transport-selected-pair-missing-or-not-succeeded" };
  }
  const selected = [...entries.values()].filter((entry) => entry['type'] === "candidate-pair" && entry['state'] === "succeeded" && entry['selected'] === true);
  return selected.length === 1 ? { status: "selected", pair: selected[0] ?? null, source: "candidate-pair.selected" }
    : { status: selected.length > 1 ? "ambiguous" : "unknown", pair: null, source: selected.length > 1 ? "multiple-selected-candidate-pairs" : "no-explicit-selected-pair; nominated-is-insufficient" };
}

export async function connectRtc(ledger: TransportLedger, signal: AbortSignal): Promise<TransportConnection> {
  if (typeof RTCPeerConnection === "undefined") throw new Error("Unsupported: RTCPeerConnection unavailable");
  const offerUrl = localEndpoint(ledger.options.endpoints.rtcOfferUrl, "https:");
  const closeUrl = localEndpoint(ledger.options.endpoints.rtcCloseUrl, "https:");
  if (offerUrl.origin !== closeUrl.origin) throw new Error("RTC offer/close endpoints must share a local origin");
  const unreliable = ledger.options.protocol === "webrtc-unordered";
  const peer = new RTCPeerConnection({ iceServers: [], bundlePolicy: "max-bundle" });
  const channel = peer.createDataChannel("capacity-echo-v1", unreliable ? { ordered: false, maxRetransmits: 0 } : { ordered: true });
  channel.binaryType = "arraybuffer";
  const peerId = ledger.nonce;
  let offerStarted = false;
  ledger.facts['rtcServerDrainState'] = "unconfirmed";
  let closed = false;
  let audio: HTMLAudioElement | undefined;
  let gatherChange: (() => void) | undefined;
  const remoteTracks: MediaStreamTrack[] = [];
  const close = () => { channel.close(); peer.close(); };
  signal.addEventListener("abort", close, { once: true });
  channel.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (signal.aborted) return;
    if (typeof event.data === "string") ledger.ack(event.data);
    else if (event.data instanceof ArrayBuffer && event.data.byteLength <= 65536) {
      try { ledger.ack(new TextDecoder("utf-8", { fatal: true }).decode(event.data)); } catch { ledger.counters.invalid++; }
    } else ledger.counters.invalid++;
  });
  peer.addEventListener("track", (event) => {
    remoteTracks.push(event.track);
    ledger.facts['rtcRemoteAudioTracks'] = remoteTracks.filter((track) => track.kind === "audio").length;
    if (event.track.kind === "audio") {
      audio ??= document.createElement("audio"); audio.muted = true;
      audio.srcObject = new MediaStream(remoteTracks);
      void audio.play().catch(() => ledger.event("audio-playback", "Muted remote stream playback unavailable; use RTP stats only"));
    }
  });
  peer.addEventListener("connectionstatechange", () => {
    ledger.event("rtc-connection-state", peer.connectionState);
    if ((peer.connectionState === "failed" || peer.connectionState === "closed") && !closed && !signal.aborted) {
      ledger.state.status = "failed"; ledger.state.reason = `RTC connection ${peer.connectionState}`;
    }
  });
  for (const track of ledger.options.mediaStream?.getAudioTracks() ?? []) peer.addTrack(track, ledger.options.mediaStream!);
  async function stats(): Promise<void> {
    if (closed || peer.connectionState === "closed") return;
    const report = await transportDeadline(peer.getStats(), signal, 1000);
    let entries = 0;
    const byId = new Map<string, Record<string, unknown>>();
    report.forEach((entry: Record<string, unknown>) => {
      if (++entries > 1024) return;
      if (typeof entry['id'] === "string") byId.set(entry['id'], entry);
      if (entry['type'] === "inbound-rtp" && (entry['kind'] === "audio" || entry['mediaType'] === "audio")) {
        if (typeof entry['jitter'] === "number") ledger.add("rtc-jitter", entry['jitter'] * 1000);
        if (typeof entry['packetsLost'] === "number") ledger.add("rtc-packets-lost", Math.max(0, entry['packetsLost']));
        if (typeof entry['packetsReceived'] === "number") ledger.add("rtc-audio-packets", entry['packetsReceived']);
        if (typeof entry['totalSamplesReceived'] === "number") ledger.add("rtc-audio-samples", entry['totalSamplesReceived']);
        const codec = report.get(String(entry['codecId'])) as Record<string, unknown> | undefined;
        if (codec) { ledger.facts['rtcAudioCodec'] = String(codec['mimeType'] ?? "unknown"); ledger.facts['rtcAudioCodecClockRate'] = Number(codec['clockRate']) || 0; }
      }
      if (entry['type'] === "transport") {
        if (typeof entry['dtlsState'] === "string") ledger.facts['rtcDtlsState'] = entry['dtlsState'];
        if (typeof entry['dtlsCipher'] === "string") ledger.facts['rtcDtlsCipher'] = entry['dtlsCipher'];
        if (typeof entry['srtpCipher'] === "string") ledger.facts['rtcSrtpCipher'] = entry['srtpCipher'];
      }
    });
    const selection = entries > 1024 ? { status: "unknown", pair: null, source: "RTC-stats-entry-bound-exceeded" } : selectRtcCandidatePair(byId);
    ledger.facts['rtcSelectedPairStatus'] = selection.status; ledger.facts['rtcSelectedPairEvidence'] = selection.source;
    const pair = selection.pair;
    if (pair) {
      const local = byId.get(String(pair['localCandidateId']));
      const remote = byId.get(String(pair['remoteCandidateId']));
      ledger.facts['rtcLocalCandidateType'] = String(local?.['candidateType'] ?? "unknown");
      ledger.facts['rtcRemoteCandidateType'] = String(remote?.['candidateType'] ?? "unknown");
      ledger.facts['rtcCandidateProtocol'] = String(local?.['protocol'] ?? "unknown");
      ledger.facts['rtcIcePath'] = `${local?.['candidateType'] ?? "unknown"}/${remote?.['candidateType'] ?? "unknown"}/${local?.['protocol'] ?? "unknown"}`;
      if (typeof pair['currentRoundTripTime'] === "number") ledger.add("rtc-candidate-pair-rtt", pair['currentRoundTripTime'] * 1000);
    } else {
      ledger.facts['rtcLocalCandidateType'] = selection.status; ledger.facts['rtcRemoteCandidateType'] = selection.status;
      ledger.facts['rtcCandidateProtocol'] = selection.status; ledger.facts['rtcIcePath'] = selection.status;
      ledger.event("rtc-selected-pair-unavailable", selection.source);
    }
  }
  const cleanup = async () => {
    if (closed) return;
    closed = true; signal.removeEventListener("abort", close); close();
    ledger.facts['rtcLocalCloseConfirmed'] = peer.connectionState === "closed";
    if (gatherChange) peer.removeEventListener("icegatheringstatechange", gatherChange);
    for (const track of remoteTracks) track.stop();
    if (audio) { audio.pause(); audio.srcObject = null; audio.remove(); }
    if (offerStarted) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 1000);
      try {
        const response = await fetch(closeUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ peerId }), signal: controller.signal, credentials: "omit", redirect: "error" });
        const result = JSON.parse(await boundedResponseText(response, controller.signal, 4096)) as { closed?: unknown; peerId?: unknown };
        if (result.closed !== true || result.peerId !== peerId) throw new Error("RTC close acknowledgement does not match the client ticket");
        ledger.facts['rtcServerCloseConfirmed'] = true; ledger.facts['rtcServerDrainState'] = "confirmed";
      }
      catch {
        ledger.facts['rtcServerCloseConfirmed'] = false; ledger.facts['rtcServerDrainState'] = "unconfirmed";
        ledger.event("rtc-server-cleanup", "Server drain unconfirmed after signaling; recovery must remain blocked");
      }
      finally { clearTimeout(timer); }
    } else { ledger.facts['rtcServerCloseConfirmed'] = null; ledger.facts['rtcServerDrainState'] = "confirmed"; ledger.event("rtc-server-cleanup", "No offer was dispatched; no server peer could have been allocated"); }
  };
  try {
    const offer = await transportDeadline(peer.createOffer(), signal, 3000);
    await transportDeadline(peer.setLocalDescription(offer), signal, 3000);
    if (peer.iceGatheringState !== "complete") await transportDeadline(new Promise<void>((resolve) => {
      gatherChange = () => { if (peer.iceGatheringState === "complete") { peer.removeEventListener("icegatheringstatechange", gatherChange!); resolve(); } };
      peer.addEventListener("icegatheringstatechange", gatherChange); gatherChange();
    }), signal, 5000);
    offerStarted = true; ledger.event("rtc-signaling-request", "Client-owned peer ticket dispatched; cancellation requires server ticket acknowledgement");
    const response = await transportDeadline(fetch(offerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp: peer.localDescription?.sdp, type: "offer", peerId }), signal, credentials: "omit", redirect: "error" }), signal, 8000);
    const answer = JSON.parse(await boundedResponseText(response, signal, 65536)) as { type?: unknown; sdp?: unknown; peerId?: unknown };
    if (answer.type !== "answer" || typeof answer.sdp !== "string" || answer.peerId !== peerId) throw new Error("Invalid RTC service answer or mismatched peer ticket");
    await transportDeadline(peer.setRemoteDescription({ type: "answer", sdp: answer.sdp }), signal, 3000);
    if (channel.readyState !== "open") await transportDeadline(new Promise<void>((resolve, reject) => {
      channel.addEventListener("open", () => resolve(), { once: true });
      channel.addEventListener("error", () => reject(new Error("RTC data channel failed")), { once: true });
      channel.addEventListener("close", () => reject(new Error("RTC data channel closed before opening")), { once: true });
    }), signal, 5000);
    ledger.facts['rtcOrdered'] = channel.ordered;
    ledger.facts['rtcMaxRetransmits'] = channel.maxRetransmits;
    ledger.facts['rtcMaxPacketLifeTime'] = channel.maxPacketLifeTime;
    ledger.facts['rtcAudioSource'] = ledger.options.mediaStream ? ledger.options.syntheticRtcAudio ? "synthetic-stream" : "caller-stream-unverified" : "none";
    ledger.facts['rtcRttMeaning'] = "selected-ICE-candidate-pair-currentRoundTripTime-seconds-converted-ms";
    ledger.facts['rtcRtpJitterMeaning'] = "inbound-audio-RTP-interarrival-jitter-seconds-converted-ms";
    ledger.facts['rtcSctpMaxMessageSize'] = peer.sctp?.maxMessageSize ?? 0;
    await stats();
    return {
      async send(frame) {
        ledger.add("buffered", channel.bufferedAmount);
        if (channel.readyState !== "open") throw new Error("RTC channel is not open");
        if (channel.bufferedAmount + new TextEncoder().encode(frame).byteLength > 1024 * 1024) throw new Error("RTC buffered bytes watermark reached");
        channel.send(frame); ledger.add("buffered", channel.bufferedAmount);
      },
      stats,
      close: cleanup,
    };
  } catch (error) { await cleanup(); throw error; }
}
