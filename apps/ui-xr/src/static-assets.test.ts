import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("static browser assets", () => {
  it("declares a local favicon to keep headset browser smoke logs clean", () => {
    const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(indexHtml).toContain('rel="icon"');
    expect(indexHtml).toContain('href="/favicon.svg"');
    expect(existsSync(new URL("../public/favicon.svg", import.meta.url))).toBe(true);
  });
});
