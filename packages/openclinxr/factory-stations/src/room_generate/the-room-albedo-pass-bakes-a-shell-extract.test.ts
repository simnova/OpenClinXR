import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { withComputeSlot } from "@openclinxr/compute-slots";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * The albedo pass must actually bake on a room-shell extract (S1 fail-closed).
 *
 * The ward-finish chain shipped a silent crash: `link_bake_object` raised
 * `RuntimeError: ... not in view layer after link` before any material was
 * touched, Blender exited 0, and the occlusion pass overwrote the evidence.
 * The prior guard test only asserted source text. This test runs the REAL
 * albedo script in Blender on the `fixtures/extract.glb` shell and asserts
 * the bake ran to completion: exit 0, the `[room-bake] baked` log line
 * present, and the link-failure error string absent. Live Blender per
 * dispatch; walls-only fixture at --resolution 64 keeps it fast.
 *
 * Raw `execFile`, not the package-internal `spawnBlenderProcess` wrapper:
 * this test only asserts the happy path (exit 0, log line present), so the
 * wrapper's `--python-exit-code 1` fail-closed injection is not exercised
 * here (`the-spawn-blender-fails-closed-on-python-exceptions.test.ts` pins
 * that behavior directly, which does need the wrapper itself as its
 * subject). Using raw execFile keeps this test import-surface clean, the
 * same way the sibling "raw Blender" case in that file does.
 */

describe("the room albedo pass bakes a shell extract", () => {
  it("exits 0 and logs [room-bake] baked with no link-failure error", async () => {
    const work = mkdtempSync(path.join(tmpdir(), "room-albedo-bake-"));
    const input = path.join(SRC, "fixtures", "extract.glb");
    const output = path.join(work, "baked.glb");
    const script = path.join(SRC, "room-albedo-ao-bake.py");
    const result = await withComputeSlot("blender", { label: "test:albedo-shell-extract" }, () => execFileAsync(
      "blender",
      ["--background", "--python", script, "--", "--input", input, "--output", output, "--resolution", "64"],
      { timeout: 300_000 },
    ))
      .then((ok) => ({ code: 0, stdout: ok.stdout, stderr: ok.stderr }))
      .catch((err: { code?: number; stdout?: string; stderr?: string }) => ({
        code: err.code ?? 1,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? "",
      }));
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain("not in view layer after link");
    expect(result.stdout).toContain("[room-bake] baked");
    // Pixels were written, not just log lines: every baked material reports
    // a positive mean luminance (the dielectric shell bakes bright).
    const means = [...result.stdout.matchAll(/meanL=(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    expect(means.length).toBeGreaterThan(0);
    for (const mean of means) expect(mean).toBeGreaterThan(0);
    expect(result.code).toBe(0);
  }, 300_000);
});
