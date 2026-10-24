const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const compiler = resolve(__dirname, "cellix-tsc.cjs");
function run(args, cwd) {
  return spawnSync(process.execPath, [compiler, ...args], { cwd, encoding: "utf8" });
}
test("resolves native TypeScript 7.0.2 from a different working directory", () => {
  const result = run(["--version"], tmpdir());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "Version 7.0.2");
  assert.equal(require("typescript").version, "6.0.3");
  assert.equal(typeof require("typescript").createProgram, "function");
});
test("forwards options, diagnostics and failure status from the native compiler", () => {
  const dir = mkdtempSync(join(tmpdir(), `openclinxr-native-compiler-${process.pid}-`));
  try {
    writeFileSync(join(dir, "input.ts"), 'const value: number = "wrong";\n');
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true, strict: true, types: [] }, files: ["input.ts"] }));
    const bad = run(["--pretty", "false", "-p", "tsconfig.json"], dir);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /error TS2322/);
    writeFileSync(join(dir, "input.ts"), "const value: number = 1;\n");
    const good = run(["--pretty", "false", "-p", "tsconfig.json"], dir);
    assert.equal(good.status, 0, good.stdout + good.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
