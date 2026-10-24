"""Version-bound observations from actual aiortc transports; unknown stays null."""

def codec_for(pc, transceiver):
    if pc.remoteDescription is None or pc.localDescription is None:
        return None
    # Actual negotiated local SDP; prefer observed RTP payload where exposed below.
    from aiortc.sdp import SessionDescription
    description = SessionDescription.parse(pc.localDescription.sdp)
    matches = [m for m in description.media if m.kind == "audio" and m.rtp.muxId == transceiver.mid]
    if len(matches) != 1:
        return None
    codecs = [c for c in matches[0].rtp.codecs if c.mimeType.lower() == "audio/opus"]
    if len(codecs) != 1:
        return None
    c = codecs[0]
    return {"mimeType": c.mimeType, "clockRate": c.clockRate, "channels": c.channels, "payloadType": c.payloadType,
            "sdpFmtpLine": ";".join(f"{k}={v}" for k, v in c.parameters.items()) or None}


def selected_pair(pc, inventory):
    observations = []
    for transceiver in pc.getTransceivers():
        transport = transceiver.sender.transport
        if transport is None:
            continue
        # aiortc1.15/aioice selected component; this is explicitly not a portable public API.
        nominated = getattr(getattr(transport.transport, "_connection", None), "_nominated", {})
        for component, pair in nominated.items():
            if component != 1:
                continue
            def endpoint(candidate):
                address = candidate.host
                return {"address": address, "port": candidate.port, "protocol": candidate.transport,
                        "candidateId": candidate.foundation, "inventoryAddress": address if address in inventory else None}
            item = {"observer": "server-ice-transport", "id": f"component:{component}:{pair.local_addr}:{pair.remote_addr}",
                    "state": str(pair.state.name).lower(), "nominated": True, "local": endpoint(pair.local_candidate),
                    "remote": endpoint(pair.remote_candidate), "observationSource": "aiortc1.15.0/aioice.Connection._nominated component1"}
            if item not in observations:
                observations.append(item)
    return observations[0] if len(observations) == 1 else None


def sdp_binding(description, mid):
    if description is None:
        return None, set()
    from aiortc.sdp import SessionDescription
    rows = [m for m in SessionDescription.parse(description.sdp).media if m.kind == "audio" and m.rtp.muxId == mid]
    if len(rows) != 1:
        return None, set()
    row = rows[0]
    tokens = [] if row.msid is None else row.msid.split()
    track_id = tokens[1] if len(tokens) == 2 else None
    return track_id, {item.ssrc for item in row.ssrc}


async def observe_bindings(peer):
    for t in peer.pc.getTransceivers():
        if t.kind != "audio":
            continue
        codec = codec_for(peer.pc, t)
        remote_track, remote_ssrcs = sdp_binding(peer.pc.remoteDescription, t.mid)
        local_track, local_ssrcs = sdp_binding(peer.pc.localDescription, t.mid)
        receiver_stats, sender_stats = await t.receiver.getStats(), await t.sender.getStats()
        inbound = [s for s in receiver_stats.values() if s.type == "inbound-rtp" and s.kind == "audio"]
        outbound = [s for s in sender_stats.values() if s.type == "outbound-rtp" and s.kind == "audio"]
        if t.receiver.track is not None and len(inbound) == 1 and inbound[0].packetsReceived > 0:
            s = inbound[0]
            peer.receiver_binding.update(receiverTrackId=t.receiver.track.id, receiverSdpTrackId=remote_track,
                mid=t.mid, ssrc=s.ssrc, codec=codec, bindingObserved=remote_track == t.receiver.track.id and s.ssrc in remote_ssrcs and codec is not None)
            peer.uplink.record["rtp"].update(packets=s.packetsReceived, packetsLost=s.packetsLost,
                jitterSeconds=s.jitter / codec["clockRate"] if codec else None)
        if peer.return_track is not None and t.sender.track is peer.return_track and len(outbound) == 1 and outbound[0].packetsSent > 0:
            s = outbound[0]
            peer.sender_binding.update(sourceTrackId=peer.return_track.id, senderTrackId=t.sender.track.id,
                mid=t.mid, ssrc=s.ssrc, codec=codec, bindingObserved=local_track == t.sender.track.id and s.ssrc in local_ssrcs and codec is not None)
    peer.last_pair = selected_pair(peer.pc, peer.inventory)
    peer.last_ice = peer.pc.iceConnectionState
    transports = [t.sender.transport for t in peer.pc.getTransceivers() if t.sender.transport]
    peer.last_dtls = transports[0].state if transports else "new"
