import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeConfig } from "@cellix/config-vitest/node";
import { describe, expect, it } from "vitest";
import { checkVitestConfigsUseCellixShared } from "../checks/vitest-config-conventions.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("vitest configs use @cellix/config-vitest", () => {
  it("ensures every Vitest package mergeConfig's the shared Cellix node/arch config", () => {
    const violations = checkVitestConfigsUseCellixShared();
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps architecture-rules unit test and architecture lane as different commands on the real manifest", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts["test"]).not.toEqual(manifest.scripts["architecture"]);
    expect(manifest.scripts["architecture"]).toContain("vitest.arch.config.ts");
    expect(manifest.scripts["test"]).not.toContain("vitest.arch.config.ts");
    const unitCfg = readFileSync(join(packageRoot, "vitest.config.ts"), "utf8");
    const archCfg = readFileSync(join(packageRoot, "vitest.arch.config.ts"), "utf8");
    expect(unitCfg).toContain("@cellix/config-vitest/node");
    expect(archCfg).toContain("@cellix/config-vitest/arch");
    expect(unitCfg).not.toContain("archConfig");
    expect(nodeConfig["test"]?.exclude).toEqual(expect.arrayContaining(["src/archunit-tests/**"]));
  });
});
