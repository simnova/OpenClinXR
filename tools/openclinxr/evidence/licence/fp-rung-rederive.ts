import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Adapter so `correct-sidecar-byte-lineage.ts` can replay the face-preserving decimation rung.
 *
 * WHY IT EXISTS. The correction tool substitutes `{out}` with a single output FILE and then reads
 * exactly that path (`correct-sidecar-byte-lineage.ts:49,63`). `iterate-optimize.ts` takes `--out`
 * as a DIRECTORY and writes a rung ladder into it (`iterate-optimize.ts:37`), naming the
 * face-preserving result `<input-basename>-fp-r<ratio>.glb`. Passing `{out}` straight through would
 * hand a file path to a tool that wants a directory, and the correction tool's read would fail.
 *
 * This adapter changes NOTHING about what is verified. The correction tool still re-runs the real
 * derivation on the committed pre-image and still refuses to write unless the result is
 * byte-identical to the shipped file; this only moves the produced rung to the path it expects.
 *
 * Usage: fp-rung-rederive.ts --input <pre.glb> --out <file.glb> --face-preserving-ratio <r>
 */

function flagValue(argv: readonly string[], name: string): string {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`fp-rung-rederive: ${name} requires a value`);
  }
  return v;
}

function main(): void {
  const argv = process.argv.slice(2);
  const input = flagValue(argv, "--input");
  const out = flagValue(argv, "--out");
  const ratio = flagValue(argv, "--face-preserving-ratio");

  const ladderDir = mkdtempSync(path.join(tmpdir(), "fp-rung-"));
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "tools/openclinxr/asset-pipeline/trellis/iterate-optimize.ts",
      "--input",
      input,
      "--out",
      ladderDir,
      "--face-preserving",
      "--face-preserving-ratio",
      ratio,
    ],
    { stdio: "pipe" },
  );

  // Prefer the exact expected name; fall back to the single fp rung in the ladder, and refuse if
  // the ladder is ambiguous — picking arbitrarily would silently compare the wrong artifact.
  const expected = `${path.basename(input, ".glb")}-fp-r${ratio}.glb`;
  const produced = readdirSync(ladderDir).filter((n: string) => n.endsWith(".glb"));
  const chosen = produced.includes(expected)
    ? expected
    : (() => {
        const rungs = produced.filter((n: string) => n.includes("-fp-r"));
        if (rungs.length !== 1) {
          throw new Error(
            `fp-rung-rederive: expected ${expected} or exactly one -fp-r rung in ${ladderDir}, found [${produced.join(", ")}]`,
          );
        }
        return rungs[0] as string;
      })();

  copyFileSync(path.join(ladderDir, chosen), out);
}

main();
