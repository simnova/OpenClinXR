import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The body_param baker was a 3,148-line single script. Navigation (and bounded
 * workers) need modules. BODY_CELL_PACK must still import from body_param_stage.
 */
const STATION = join(import.meta.dirname, "body_param");

function lineCount(rel: string): number {
  return readFileSync(join(STATION, rel), "utf8").split(/\r?\n/u).length;
}

describe("the body_param stage is split into modules", () => {
  it("keeps the blender entry under 500 lines and no sibling over 1,000", () => {
    expect(lineCount("body_param_stage.py"), "entry stays a thin orchestrator").toBeLessThan(500);
    const py = readdirSync(STATION).filter((name) => name.endsWith(".py"));
    expect(py).toEqual(
      expect.arrayContaining([
        "body_param_stage.py",
        "phenotype_macros.py",
        "stature_solve.py",
        "mesh_io.py",
        "garment_ops.py",
        "rig_bind.py",
        "mpfb_body.py",
        "body_class.py",
        "constants.py",
        "paths.py",
      ]),
    );
    for (const name of py) {
      const lines = lineCount(name);
      expect(lines, `${name} is ${lines} lines`).toBeLessThanOrEqual(1000);
    }
  });

  it("still publishes BODY_CELL_PACK from body_param_stage without Blender", () => {
    const py = [
      "import json, sys",
      `sys.path.insert(0, ${JSON.stringify(STATION)})`,
      "from body_param_stage import BODY_CELL_PACK",
      "from phenotype_macros import BODY_CELL_PACK as PACK2",
      "print(json.dumps({'n': len(BODY_CELL_PACK), 'same': BODY_CELL_PACK == PACK2, 'first': BODY_CELL_PACK[0]['id']}))",
    ].join("\n");
    const out = JSON.parse(execFileSync("python3", ["-c", py], { encoding: "utf8" }).trim()) as {
      n: number;
      same: boolean;
      first: string;
    };
    expect(out.n).toBe(15);
    expect(out.same).toBe(true);
    expect(out.first).toBe("infant_female");
  });

  it("keeps runBodyParam pointed at the station entry script", () => {
    const run = readFileSync(join(STATION, "run.ts"), "utf8");
    expect(run).toContain("packages/openclinxr/factory-stations/src/body_param/body_param_stage.py");
    expect(statSync(join(STATION, "body_param_stage.py")).isFile()).toBe(true);
  });
});
