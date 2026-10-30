import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertSameFiles, buildAreaVitestArgs } from "./run-tools-tests";
import {
  assignAreas,
  inputGlobFor,
  isSerialArea,
  pathAreaOf,
  serialPoolOf,
  TOOLS_TEST_AREAS,
  usesSharedSlot,
} from "./tools-test-areas";

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

  it("marks a test that spawns python3 or a nested vitest by literal name", () => {
    const dir = fixture({
      "f.test.ts": `import { execFileSync } from "node:child_process";\nexecFileSync("python3", ["m.py"]);`,
      "g.test.ts": `import { spawnSync } from "node:child_process";\nspawnSync("pnpm", ["exec", "vitest"]);`,
    });
    expect(usesSharedSlot(path.join(dir, "f.test.ts"), [])).toBe(true);
    expect(usesSharedSlot(path.join(dir, "g.test.ts"), [])).toBe(true);
  });

  it("leaves a test parallel when slot words appear only in comments or strings", () => {
    const dir = fixture({
      "d.test.ts": `// chromium.launch( is not called here\nconst s = "spawn(blender";\nexport {};`,
    });
    expect(usesSharedSlot(path.join(dir, "d.test.ts"), ["@openclinxr/factory-stations"])).toBe(false);
  });
});

describe("serialPoolOf", () => {
  it("routes the browser pool: slotted-playwright, chromium.launch, dev server, browser-capture call", () => {
    const dir = fixture({
      "a.test.ts": `import { run } from "./helper.js";\nrun();`,
      "helper.ts": `import { chromium } from "./lib/slotted-playwright.js";\nexport const run = () => chromium;`,
      "lib/slotted-playwright.ts": `export const chromium = {};`,
      "b.test.ts": `import { boot } from "./launcher.js";\nboot();`,
      "launcher.ts": `export function boot(): void { chromium.launch(); }`,
      "c.test.ts": `import { serve } from "./server.js";\nserve();`,
      "server.ts": `export function serve(): void { spawnPortlessDevServer(); }`,
      "d.test.ts": `import { withComputeSlot } from "./slots.js";\nexport const go = withComputeSlot("browser-capture", {}, () => 1);`,
      "slots.ts": `export const withComputeSlot = (...a: unknown[]) => a;`,
    });
    for (const f of ["a.test.ts", "b.test.ts", "c.test.ts", "d.test.ts"]) {
      expect(serialPoolOf(path.join(dir, f), [], [])).toBe("serial-browser");
    }
  });

  it("routes the Blender pool: blender call site, Blender spawn, blender package", () => {
    const dir = fixture({
      "a.test.ts": `import { bake } from "./baker.js";\nbake();`,
      "baker.ts": `import { withComputeSlot } from "@openclinxr/compute-slots/slots";\nexport const bake = () => withComputeSlot("blender", {}, () => 1);`,
      "b.test.ts": `import { spawnSync } from "node:child_process";\nspawnSync(blenderBin, []);`,
      "c.test.ts": `import { runStation } from "@openclinxr/factory-stations";\nrunStation();`,
    });
    expect(serialPoolOf(path.join(dir, "a.test.ts"), [], [])).toBe("serial-blender");
    expect(serialPoolOf(path.join(dir, "b.test.ts"), [], [])).toBe("serial-blender");
    expect(serialPoolOf(path.join(dir, "c.test.ts"), [], ["@openclinxr/factory-stations"])).toBe("serial-blender");
  });

  it("routes interpreter spawns with no slot marker to serial-spawn", () => {
    const dir = fixture({
      "a.test.ts": `import { execFileSync } from "node:child_process";\nexecFileSync("python3", ["m.py"]);`,
      "b.test.ts": `import { run } from "./guard.js";\nrun();`,
      "guard.ts": `import { spawnSync } from "node:child_process";\nconst TSX = "x";\nexport const run = () => spawnSync(TSX, ["guard.ts"]);`,
    });
    expect(serialPoolOf(path.join(dir, "a.test.ts"), [], [])).toBe("serial-spawn");
    expect(serialPoolOf(path.join(dir, "b.test.ts"), [], [])).toBe("serial-spawn");
  });

  it("applies the browser+blender tie rule: both markers route to serial-browser", () => {
    const dir = fixture({
      "a.test.ts": `import { both } from "./helper.js";\nboth();`,
      "helper.ts": `import { withComputeSlot } from "@openclinxr/compute-slots/slots";\nexport function both(): void {\n  chromium.launch();\n  withComputeSlot("blender", {}, () => 1);\n}`,
    });
    expect(serialPoolOf(path.join(dir, "a.test.ts"), [], [])).toBe("serial-browser");
  });

  it("keeps the size-1 gpu pool in serial-browser so every gpu acquirer shares one area", () => {
    const dir = fixture({
      "a.test.ts": `import { withComputeSlot } from "@openclinxr/compute-slots/slots";\nexport const go = withComputeSlot("gpu", {}, () => 1);`,
    });
    expect(serialPoolOf(path.join(dir, "a.test.ts"), [], [])).toBe("serial-browser");
  });

  it("returns null for plain parallel files", () => {
    const dir = fixture({ "a.test.ts": `import { it, expect } from "vitest";\nit("a", () => expect(1).toBe(1));` });
    expect(serialPoolOf(path.join(dir, "a.test.ts"), [], [])).toBeNull();
  });
});

describe("serial areas", () => {
  it("lists three serial pools and no bare serial area", () => {
    expect([...TOOLS_TEST_AREAS]).toEqual([
      "serial-browser",
      "serial-spawn",
      "serial-blender",
      "evidence",
      "asset-pipeline",
      "agent-factory",
      "openclaw",
      "misc",
    ]);
    expect(isSerialArea("serial-browser")).toBe(true);
    expect(isSerialArea("serial-blender")).toBe(true);
    expect(isSerialArea("serial-spawn")).toBe(true);
    expect(isSerialArea("evidence")).toBe(false);
  });

  it("assignAreas routes serial pools before path prefixes", () => {
    const dir = fixture({
      "tools/openclinxr/evidence/plain.test.ts": `import { it, expect } from "vitest";\nit("a", () => expect(1).toBe(1));`,
      "tools/b.test.ts": `import { run } from "./helper.js";\nrun();`,
      "tools/helper.ts": `export function run(): void { chromium.launch(); }`,
      "tools/c.test.ts": `import { execFileSync } from "node:child_process";\nexecFileSync("python3", ["m.py"]);`,
    });
    const areas = assignAreas(
      ["tools/openclinxr/evidence/plain.test.ts", "tools/b.test.ts", "tools/c.test.ts"],
      dir,
    );
    expect(areas.get("tools/openclinxr/evidence/plain.test.ts")).toBe("evidence");
    expect(areas.get("tools/b.test.ts")).toBe("serial-browser");
    expect(areas.get("tools/c.test.ts")).toBe("serial-spawn");
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
