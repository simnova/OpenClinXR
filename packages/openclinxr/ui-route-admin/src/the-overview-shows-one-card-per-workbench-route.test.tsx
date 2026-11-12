import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { adminPublicationGates, adminWorkbenchRoutes, WorkbenchOverview } from "./index.js";

describe("WorkbenchOverview", () => {
  beforeAll(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("renders one card per manifest entry, each linking to its route, then the publication gates", () => {
    render(
      <MemoryRouter>
        <WorkbenchOverview routes={adminWorkbenchRoutes} gates={adminPublicationGates} />
      </MemoryRouter>,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(adminWorkbenchRoutes.map((route) => route.path));
    expect(links.map((link) => link.textContent)).toEqual(adminWorkbenchRoutes.map((route) => `Open ${route.label}`));
    expect(adminWorkbenchRoutes.map((route) => route.path)).toContain("/faculty-review");
    expect(screen.getByText("Publication gates")).toBeInTheDocument();
    for (const gate of adminPublicationGates) {
      expect(screen.getByText(gate)).toBeInTheDocument();
    }
  });
});
