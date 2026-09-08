// Vitest setup for xr-exam-flow
import { vi } from "vitest";

// Mock performance.now for deterministic tests
let mockTime = 0;
vi.spyOn(performance, "now").mockImplementation(() => mockTime);

// Mock window.localStorage
const mockStorage = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => mockStorage.get(key) ?? null,
  setItem: (key: string, value: string) => mockStorage.set(key, value),
  removeItem: (key: string) => mockStorage.delete(key),
  clear: () => mockStorage.clear(),
});

// Mock window.location
vi.stubGlobal("location", {
  href: "http://localhost",
  search: "",
  assign: vi.fn(),
  replace: vi.fn(),
});

// Helper to advance mock time
export function advanceMockTime(ms: number) {
  mockTime += ms;
}

// Helper to reset mocks
export function resetMocks() {
  mockTime = 0;
  mockStorage.clear();
}