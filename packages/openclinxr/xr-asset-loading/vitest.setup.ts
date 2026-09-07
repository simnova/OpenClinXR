import { vi } from "vitest";

vi.stubGlobal("window", { location: { search: "" } } as never);
vi.stubGlobal("performance", { now: () => 100 } as never);
