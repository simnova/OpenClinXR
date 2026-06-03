import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceRoot = process.cwd();
const appRoot = join(workspaceRoot, "apps/ui-quest-voice-godot");

function readAppFile(path: string): string {
  return readFileSync(join(appRoot, path), "utf8");
}

describe("Godot Quest voice client contract", () => {
  it("keeps the sidecar as a source-level Godot 4 app without workspace package dependencies", () => {
    expect(existsSync(join(appRoot, "package.json"))).toBe(false);
    expect(readAppFile("project.godot")).toContain("config_version=5");
    expect(readAppFile("project.godot")).toContain('run/main_scene="res://scenes/realtime_voice_spike.tscn"');
    expect(readAppFile("project.godot")).toContain('renderer/rendering_method="mobile"');
  });

  it("models the Quest realtime voice transport as WebSocket JSON control plus binary audio packets", () => {
    const client = readAppFile("src/RealtimeVoiceClient.gd");

    expect(client).toContain("WebSocketPeer.new()");
    expect(client).toContain("connect_to_url");
    expect(client).toContain("VOICE_GATEWAY_URL");
    expect(client).toContain('const VOICE_GATEWAY_URL := "ws://127.0.0.1:4017/voice/realtime/ws"');
    expect(readAppFile("scenes/realtime_voice_spike.tscn")).toContain(
      'text = "ws://127.0.0.1:4017/voice/realtime/ws"',
    );
    expect(client).toContain("/voice/realtime/ws");
    expect(client).toContain('const CODEC := "opus"');
    expect(client).toContain("const SAMPLE_RATE_HZ := 48000");
    expect(client).toContain('const FRAME_VOICE_START := "voice.start"');
    expect(client).toContain('const FRAME_VOICE_STOP := "voice.stop"');
    expect(client).toContain('const FRAME_AUDIO_METADATA := "voice.audio_metadata"');
    expect(client).toContain('const EXPECTED_GATEWAY_EVENTS := ["backend.ready", "backend.error", "voice.started", "voice.stopped", "audio.chunk", "transcript.partial", "transcript.final"]');
    expect(client).toContain('"type": FRAME_VOICE_START');
    expect(client).toContain('"type": FRAME_VOICE_STOP');
    expect(client).toContain('"type": FRAME_AUDIO_METADATA');
    expect(client).toContain('"chunkIndex": next_chunk_index');
    expect(client).toContain('"clientSentAtMs": Time.get_ticks_msec()');
    expect(client).toContain("socket.send_text(JSON.stringify(payload))");
    expect(client).toContain("socket.put_packet(packet)");
    expect(client).toContain("socket.get_packet()");
    expect(client).toContain("socket.was_string_packet()");
  });

  it("waits for voice.stopped before closing the websocket", () => {
    const client = readAppFile("src/RealtimeVoiceClient.gd");

    expect(client).toContain("var close_after_stop_ack := false");
    expect(client).toContain("close_after_stop_ack = true");
    expect(client).toContain('if event_type == "voice.stopped" and close_after_stop_ack:');
    expect(client.indexOf('if event_type == "voice.stopped" and close_after_stop_ack:')).toBeLessThan(
      client.lastIndexOf("socket.close()"),
    );

    const stopSessionStart = client.indexOf("func stop_session() -> void:");
    const handleJsonStart = client.indexOf("func _handle_json_packet(text: String) -> void:");
    const stopSessionBody = client.slice(stopSessionStart, handleJsonStart);
    expect(stopSessionBody).not.toContain("socket.close()");
  });

  it("keeps speculative protocol and production-readiness claims out of the Godot sidecar", () => {
    const allSidecarText = [
      readAppFile("README.md"),
      readAppFile("project.godot"),
      readAppFile("scenes/realtime_voice_spike.tscn"),
      readAppFile("src/Main.gd"),
      readAppFile("src/RealtimeVoiceClient.gd"),
    ].join("\n");

    expect(allSidecarText).not.toMatch(/WebTransport|QUIC|web3|wallet|MultiplayerPeer|ENet/);
    expect(allSidecarText).not.toMatch(/production[- ]ready|live dialog ready|latency proven/i);
  });

  it("keeps transport probing separate from real microphone and Opus evidence", () => {
    const readme = readAppFile("README.md");
    const brief = readFileSync(join(workspaceRoot, "docs/openclinxr/godot-quest-voice-client-spike.md"), "utf8");

    expect(readme).toContain("does not yet prove Quest microphone capture");
    expect(readme).toContain("native Opus encode/decode");
    expect(brief).toContain("Godot `WebSocketPeer` is the client transport");
    expect(brief).toContain("It does not prove:");
    expect(brief).toContain("End-to-end latency on the headset");
  });

  it("documents Godot as a deletable voice sidecar rather than the selected primary XR client", () => {
    const note = readFileSync(join(workspaceRoot, "godot-usage-temporary-note.md"), "utf8");

    expect(note).toContain("temporary, deletable");
    expect(note).toContain("Godot is not currently selected as the long-term primary OpenClinXR client");
    expect(note).toContain("The WebXR/IWSDK browser app remains the main XR scenario UI path");
    expect(note).toContain("Godot does not replace:");
    expect(note).toContain("apps/ui-xr");
    expect(note).toContain("apps/api");
    expect(note).toContain("Production readiness without a follow-up proposal");
  });
});
