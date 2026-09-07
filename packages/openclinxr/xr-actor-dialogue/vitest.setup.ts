import { vi } from "vitest";

vi.stubGlobal("window", { 
  location: { search: "" },
  setTimeout: vi.fn((fn) => fn()),
  setInterval: vi.fn((fn) => fn()),
} as never);
vi.stubGlobal("performance", { now: () => 100 } as never);