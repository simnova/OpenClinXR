import { spawn } from "node:child_process";

/**
 * Blender exits 0 on an uncaught Python exception by default (measured
 * 2026-09-27 on Blender 5.1.1: the albedo bake's RuntimeError still exits
 * 0), which lets a crashed pass masquerade as success. Every spawn through
 * this wrapper carries `--python-exit-code 1` so an uncaught exception in a
 * `--python` script surfaces as a non-zero exit and every caller fails
 * closed. Verified flag semantics: `blender --help` documents
 * `--python-exit-code <code>` ("exit if a Python exception is raised (only
 * for scripts executed from the command line)"), and the raising probe
 * returns 0 without it, 1 with it.
 */
const PYTHON_EXIT_CODE_ARGS = ["--python-exit-code", "1"];

function withFailClosedExitCode(args: string[]): string[] {
  if (!args.includes("--python")) return args;
  if (args.includes("--python-exit-code")) return args;
  const backgroundAt = args.indexOf("--background");
  if (backgroundAt === -1) return [...PYTHON_EXIT_CODE_ARGS, ...args];
  return [...args.slice(0, backgroundAt + 1), ...PYTHON_EXIT_CODE_ARGS, ...args.slice(backgroundAt + 1)];
}

export function spawnBlenderProcess(
  blender: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(blender, withFailClosedExitCode(args), {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer =
      opts.timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
          }, opts.timeoutMs)
        : null;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err: Error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}\n${String(err)}` });
    });
    child.on("close", (code: number | null) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
