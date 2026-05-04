import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static browser assets", () => {
  it("declares a local favicon to keep headset browser smoke logs clean", () => {
    const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(indexHtml).toContain('rel="icon"');
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(existsSync(new URL("../public/favicon.svg", import.meta.url))).toBe(true);
  });

  it("keeps Three.js imports explicit so the headset bundle remains tree-shakeable", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(mainSource).not.toContain('import * as THREE from "three"');
    expect(mainSource).toContain('} from "three"');
  });

  it("loads only the active scenario fixture subpath in the headset app", () => {
    const mainSource = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const runtimeStateSource = readFileSync(new URL("./runtime-state.ts", import.meta.url), "utf8");
    const headsetSources = `${mainSource}\n${runtimeStateSource}`;

    expect(headsetSources).not.toContain('from "@openclinxr/scenario-fixtures"');
    expect(headsetSources).toContain('from "@openclinxr/scenario-fixtures/ed-chest-pain"');
  });

  it("keeps the Portless dev script aligned to the injected app port", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["dev:portless"]).toBe("vite --host 127.0.0.1 --port ${PORT:-5173} --strictPort");
  });
});
