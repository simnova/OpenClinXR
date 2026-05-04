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
    expect(client).toContain("/voice/realtime/ws");
    expect(client).toContain('const CODEC := "opus"');
    expect(client).toContain("const SAMPLE_RATE_HZ := 48000");
    expect(client).toContain('"type": "voice.start"');
    expect(client).toContain('"type": "voice.stop"');
    expect(client).toContain("socket.send_text(JSON.stringify(payload))");
    expect(client).toContain("socket.put_packet(packet)");
    expect(client).toContain("socket.get_packet()");
    expect(client).toContain("socket.was_string_packet()");
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
});
