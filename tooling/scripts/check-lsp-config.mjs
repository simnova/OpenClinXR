#!/usr/bin/env node
/**
 * Structural check: project Grok LSP config points at installable stdio servers.
 * Exit 0 when .grok/lsp.json is valid and required binaries exist.
 *
 * Pattern adapted from atlantis-cameras-v2; OpenClinXR also requires pyright.
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lspPath = path.join(root, ".grok/lsp.json");
const rootLspPath = path.join(root, ".lsp.json");

function fail(msg) {
  console.error(`check-lsp-config: FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(lspPath)) fail(`.grok/lsp.json missing at ${lspPath}`);

let cfg;
try {
  cfg = JSON.parse(readFileSync(lspPath, "utf8"));
} catch (e) {
  fail(`invalid JSON: ${e.message}`);
}

// Keep root .lsp.json in sync when both exist (Grok may prefer either)
if (existsSync(rootLspPath)) {
  const rootCfg = readFileSync(rootLspPath, "utf8");
  const grokCfg = readFileSync(lspPath, "utf8");
  if (rootCfg !== grokCfg) {
    fail(".lsp.json and .grok/lsp.json differ — keep them identical");
  }
}

const required = ["typescript", "knip", "python"];
for (const name of required) {
  if (!cfg[name]?.command) fail(`server "${name}" missing command`);
  const cmd = cfg[name].command;
  const abs = path.isAbsolute(cmd) ? cmd : path.join(root, cmd);
  if (!existsSync(abs)) fail(`binary missing for ${name}: ${cmd} → ${abs}`);
  try {
    accessSync(abs, constants.X_OK);
  } catch {
    // shebang scripts may not show X_OK on all FS
  }
  const args = cfg[name].args;
  if (!Array.isArray(args) || !args.includes("--stdio")) {
    fail(`${name} args must include --stdio`);
  }
  if (typeof cfg[name].startupTimeout !== "number" || cfg[name].startupTimeout < 30_000) {
    console.warn(`check-lsp-config: WARN: ${name} startupTimeout < 30000 (large monorepos often need more)`);
  }
}

// typescript-language-server --version
const tsRel = cfg.typescript.command.replace(/^\.\//, "");
const tsBin = path.isAbsolute(cfg.typescript.command)
  ? cfg.typescript.command
  : path.join(root, tsRel);
const ts = spawnSync(tsBin, ["--version"], { encoding: "utf8", timeout: 15_000 });
if (ts.status !== 0) {
  fail(`typescript-language-server --version failed: ${ts.stderr || ts.stdout}`);
}
console.log("typescript-language-server", (ts.stdout || ts.stderr).trim());

// knip-language-server: prove bin present
const knipRel = cfg.knip.command.replace(/^\.\//, "");
const knipBin = path.isAbsolute(cfg.knip.command)
  ? cfg.knip.command
  : path.join(root, knipRel);
if (!existsSync(knipBin)) fail(`knip-language-server missing: ${knipBin}`);
console.log("knip-language-server: bin present", knipBin);

// pyright-langserver: prove bin present
const pyRel = cfg.python.command.replace(/^\.\//, "");
const pyBin = path.isAbsolute(cfg.python.command)
  ? cfg.python.command
  : path.join(root, pyRel);
if (!existsSync(pyBin)) fail(`pyright-langserver missing: ${pyBin}`);
console.log("pyright-langserver: bin present", pyBin);

// package.json pins
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const dev = pkg.devDependencies || {};
if (!dev["typescript-language-server"]) fail("package.json missing typescript-language-server");
if (!dev["@knip/language-server"]) fail("package.json missing @knip/language-server");
if (!dev.pyright && !dev["pyright"]) fail("package.json missing pyright");

console.log("check-lsp-config: PASS");
process.exit(0);
