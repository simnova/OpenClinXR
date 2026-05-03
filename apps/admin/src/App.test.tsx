import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AdminApp } from "./App.js";

describe("AdminApp", () => {
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

  it("renders the scenario governance workbench routes and GraphQL contract status", () => {
    render(<AdminApp />);

    expect(screen.getByRole("heading", { name: "OpenClinXR Admin" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Scenario Bank" })).toHaveAttribute("href", "/scenarios");
    expect(screen.getByRole("link", { name: "Review Replay" })).toHaveAttribute("href", "/reviews");
    expect(screen.getByRole("link", { name: "Exam Forms" })).toHaveAttribute("href", "/exam-forms");
    expect(screen.getByText("GraphQL Codegen")).toBeInTheDocument();
    expect(screen.getByText("Apollo Client")).toBeInTheDocument();
    expect(screen.getByText("ProComponents v3")).toBeInTheDocument();
    expect(screen.getByText("Clinical, psychometric, legal, and simulation QA gates")).toBeInTheDocument();
  });
});
