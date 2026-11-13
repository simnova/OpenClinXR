import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  type MessageHandler = (message: unknown) => void;
  class FakeRoom {
    readonly sessionId = "learner-session";
    readonly reconnectionToken = "learner-reconnect-token";
    readonly state = { toJSON: () => ({}) };
    readonly sent: string[] = [];
    private readonly messages = new Map<string, MessageHandler>();
    private readonly leaveHandlers: Array<() => void> = [];

    send(type: string): void { this.sent.push(type); }
    onMessage(type: string, handler: MessageHandler): void { this.messages.set(type, handler); }
    onStateChange(): void { /* no state needed for the ready regression */ }
    onLeave(handler: () => void): void { this.leaveHandlers.push(handler); }
    async leave(): Promise<void> { for (const handler of this.leaveHandlers) handler(); }
    emit(type: string, message: unknown): void { this.messages.get(type)?.(message); }
  }
  const rooms = {
    station1: new FakeRoom(),
    station2: new FakeRoom(),
  };
  class FakeClient {
    async joinOrCreate(): Promise<FakeRoom> { return rooms.station1; }
    async consumeSeatReservation(): Promise<FakeRoom> { return rooms.station2; }
    async reconnect(): Promise<FakeRoom> { return rooms.station2; }
  }
  return { FakeClient, rooms };
});

vi.mock("@colyseus/sdk", () => ({ Client: sdk.FakeClient }));

import { connect } from "./index.js";

const flush = async (): Promise<void> => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
const readyCount = (room: { sent: string[] }): number => room.sent.filter((type) => type === "ready").length;

describe("XS-READY rotation and reconnect", () => {
  it("sends ready once to a rotated station without a new latch and at most once on same-room reconnect", async () => {
    const connection = await connect("ws://sync.test", {}, true);
    expect(readyCount(sdk.rooms.station1)).toBe(0);

    connection.sendReady();
    connection.sendReady();
    expect(readyCount(sdk.rooms.station1)).toBe(1);

    sdk.rooms.station1.emit("rotate", { reservation: "station-2" });
    await flush();
    expect(readyCount(sdk.rooms.station2)).toBe(1);

    const beforeReconnect = readyCount(sdk.rooms.station2);
    await connection.reconnect();
    expect(readyCount(sdk.rooms.station2) - beforeReconnect).toBe(1);
  });
});
