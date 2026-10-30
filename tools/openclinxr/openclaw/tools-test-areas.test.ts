import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSameFiles, buildAreaVitestArgs } from "./run-tools-tests";
import { inputGlobFor, pathAreaOf, usesSharedSlot } from "./tools-test-areas";

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tools-test-areas-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

describe("usesSharedSlot", () => {
  it("marks a test whose import closure reaches the slotted Playwright wrapper", () => {
    const dir = fixture({
      "a.test.ts": `import { run } from "./helper.js";\nrun();`,
      "helper.ts": `import { chromium } from "./lib/slotted-playwright.js";\nexport const run = () => chromium;`,
      "lib/slotted-playwright.ts": `export const chromium = {};`,
    });
    expect(usesSharedSlot(path.join(dir, "a.test.ts"), [])).toBe(true);
  });

  it("marks a Blender spawn and a slot-owning package import", () => {
    const dir = fixture({
      "b.test.ts": `import { spawnSync } from "node:child_process";\nspawnSync(blenderBin, []);`,
      "c.test.ts": `import { runStation } from "@openclinxr/factory-stations";\nrunStation();`,
    });
    expect(usesSharedSlot(path.join(dir, "b.test.ts"), [])).toBe(true);
    expect(usesSharedSlot(path.join(dir, "c.test.ts"), ["@openclinxr/factory-stations"])).toBe(true);
  });

  it("marks a test that spawns tsx per case", () => {
    const dir = fixture({
      "e.test.ts": `import { spawnSync } from "node:child_process";\nconst TSX = "x";\nspawnSync(TSX, ["guard.ts"]);`,
    });
    expect(usesSharedSlot(path.join(dir, "e.test.ts"), [])).toBe(true);
  });

  it("leaves a test parallel when slot words appear only in comments or strings", () => {
    const dir = fixture({
      "d.test.ts": `// chromium.launch( is not called here\nconst s = "spawn(blender";\nexport {};`,
    });
    expect(usesSharedSlot(path.join(dir, "d.test.ts"), ["@openclinxr/factory-stations"])).toBe(false);
  });
});

describe("areas and turbo inputs", () => {
  it("routes paths to areas, defaulting to misc", () => {
    expect(pathAreaOf("tools/openclinxr/evidence/x.test.ts")).toBe("evidence");
    expect(pathAreaOf("tools/agent-factory/y.test.ts")).toBe("agent-factory");
    expect(pathAreaOf("tools/openclinxr/factory/z.test.ts")).toBe("misc");
  });

  it("cuts input globs at area depth and lists shallow files exactly", () => {
    expect(inputGlobFor("tools/openclinxr/evidence/lib/a.ts")).toBe("tools/openclinxr/evidence/**");
    expect(inputGlobFor("tools/openclinxr/encounter-runtime-emission.ts")).toBe("tools/openclinxr/encounter-runtime-emission.ts");
    expect(inputGlobFor("packages/openclinxr/xr-scene/src/a/b.ts")).toBe("packages/openclinxr/xr-scene/src/**");
  });
});

describe("area vitest args", () => {
  it("serial adds one worker and no file parallelism; parallel areas opt into file parallelism", () => {
    const serial = buildAreaVitestArgs("run", ["tools/a.test.ts"], ["**/x/**"], true, []);
    expect(serial).toContain("--maxWorkers=1");
    expect(serial).toContain("--no-file-parallelism");
    const parallel = buildAreaVitestArgs("run", ["tools/a.test.ts"], ["**/x/**"], false, []);
    expect(parallel).not.toContain("--maxWorkers=1");
    expect(parallel).toContain("--file-parallelism");
    expect(parallel).toContain("**/x/**");
  });

  it("fails when the listed file set differs from the area's files", () => {
    expect(() => assertSameFiles("evidence", ["a.test.ts"], ["a.test.ts"])).not.toThrow();
    expect(() => assertSameFiles("evidence", ["a.test.ts"], ["a.test.ts", "b.test.ts"])).toThrow(/extra 1/);
    expect(() => assertSameFiles("evidence", ["a.test.ts", "b.test.ts"], ["a.test.ts"])).toThrow(/missing 1/);
  });
});
