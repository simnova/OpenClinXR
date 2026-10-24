#!/usr/bin/env node
// Resolve our pinned CLI, never a PATH-selected tsc (the JS API stays on TS 6).
const { spawn } = require("node:child_process");
const { dirname, join } = require("node:path");

const manifestPath = require.resolve("typescript-native/package.json");
const manifest = require(manifestPath);
if (manifest.version !== "7.0.2") {
  throw new Error(`Expected native TypeScript 7.0.2, received ${manifest.version}`);
}
const child = spawn(process.execPath, [join(dirname(manifestPath), manifest.bin.tsc), ...process.argv.slice(2)], {
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  }
  else process.exitCode = code ?? 1;
});
