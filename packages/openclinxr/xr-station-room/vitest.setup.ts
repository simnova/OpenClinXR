// Vitest setup for xr-station-room package tests
import { beforeAll, afterAll } from "vitest";

// @openclinxr/xr-capture-evidence reads window.location at module scope, so the
// stub must exist before any test module imports the package.
(globalThis as unknown as { window?: unknown }).window ??= {
  devicePixelRatio: 1,
  location: { search: "" },
  __openClinXrDebugScene: undefined,
};

beforeAll(() => {
});

afterAll(() => {
  // Cleanup
});