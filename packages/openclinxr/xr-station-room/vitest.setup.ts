// Vitest setup for xr-station-room package tests
import { beforeAll, afterAll } from "vitest";

beforeAll(() => {
  // Mock DOM APIs that three.js might need
  if (typeof globalThis.window === "undefined") {
    (globalThis as any).window = {
      devicePixelRatio: 1,
      location: { search: "" },
      __openClinXrDebugScene: undefined,
    };
  }
});

afterAll(() => {
  // Cleanup
});