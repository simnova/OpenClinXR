import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Skin-bake Cycles device is CPU by default, Metal only on opt-in.
 *
 * The two skin-bake stages force `scene.cycles.device = "CPU"` with no stated
 * reason anywhere (no comment, no commit message — see #343 origin cccd5e095).
 * GPU vs CPU rendering can shift baked pixels, which would churn every shipped
 * texture, so the default stays CPU. `--cycles-device metal` opts in: it enables
 * the METAL cycles device in preferences and sets GPU only inside the same two
 * forced regions (prev/restore shape kept), falling back to CPU on any failure.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../../../..");
const MAT = join(REPO_ROOT, "tools/openclinxr/evidence/blender/materialize_mpfb_humanoid_candidate.py");

function mat(): string {
  expect(existsSync(MAT), `${MAT} — the factory materializer`).toBe(true);
  return readFileSync(MAT, "utf8");
}

describe("skin-bake cycles device defaults to CPU with a Metal opt-in", () => {
  it("argparse exposes --cycles-device with default cpu", () => {
    const src = mat();
    expect(src, "flag declared").toMatch(/"--cycles-device"/);
    expect(src, "default is cpu").toMatch(/"--cycles-device"[\s\S]{0,300}?default="cpu"/);
    expect(src, "choices cpu/metal").toMatch(/choices=\["cpu",\s*"metal"\]/);
  });

  it("metal sets GPU only inside the two forced regions and falls back to CPU", () => {
    const src = mat();
    expect(src, "helper exists").toMatch(/def _resolve_cycles_bake_device/);
    expect(src, "helper enables METAL preference devices").toMatch(/getattr\(d, "type", ""\) == "METAL"/);
    expect(src, "helper falls back to CPU on failure").toMatch(/falling back to CPU/);
    const uses = src.match(/= _resolve_cycles_bake_device\(\)/g) ?? [];
    expect(uses.length, "both bake stages call the helper").toBe(2);
    expect(src, "device set from resolution").toMatch(/scene\.cycles\.device = _resolve_cycles_bake_device\(/);
  });

  it("COUNTERWEIGHT: the unconditional CPU forcing is gone from both bake stages", () => {
    const src = mat();
    const forced = src.match(/scene\.cycles\.device = "CPU"/g) ?? [];
    expect(forced.length, "no hardcoded CPU forcing remains").toBe(0);
  });
});
