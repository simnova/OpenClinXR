/**
 * Captures a headless-Chromium execution receipt for the IWSDK spike's CURRENT pin.
 *
 * WHY: tools/openclinxr/evidence/the-iwsdk-spike-proves-the-package-runs.test.ts
 * clause (2b) asserts the checked-in receipt browser-proof-110rc2.json: a real Vite
 * bundle of the CURRENT pin (@iwsdk/core 1.1.0-rc.2 per ci-w5 f0638c7a0), executed in
 * headless Chromium (real-DOM import), computing window.__openClinXrIwsdkProof.
 * The 0.4.2 receipt (browser-proof-042.json) survives untouched as history.
 *
 * Usage:
 *   pnpm exec tsx tools/openclinxr/evidence/iwsdk-browser-proof/capture-browser-proof.ts [--out <path>]
 *
 * Default --out is iwsdk-browser-proof/browser-proof-110rc2.json (next to this file).
 * Heavy browser capture stays out of the 5s unit queue: this producer runs by hand,
 * the test only reads the checked-in receipt.
 *
 * The browser is launched through the compute-services facade
 * (@openclinxr/service-local-compute/local sceneCapture.withBrowser), NOT a direct
 * chromium.launch call: the architecture freeze counts direct heavy-compute launch
 * sites with a shrink-only ceiling, and the facade holds the same browser-capture
 * slot the ./lib/slotted-playwright.js helper would acquire.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalComputeServices } from "@openclinxr/service-local-compute/local";
import type { Browser } from "playwright";
import { build } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(HERE, "..", "..", "..", ".."); // iwsdk-browser-proof -> evidence -> openclinxr -> tools -> root
const SPIKE_ROOT = join(REPO_ROOT, "apps", "arena", "ui-xr-iwsdk-spike");
const spikeRequire = createRequire(join(SPIKE_ROOT, "package.json"));

const PROOF_GLOBAL = "__openClinXrIwsdkProof";
const EVALUATED_VIA = `window.${PROOF_GLOBAL}`;

/**
 * Resolve the installed package's main entry through its exports map.
 * Reads <specifier>/package.json from the spike root, then follows the "."
 * export's import condition (falling back to main when no exports map exists,
 * as on the 0.4.2 pin). No hard-coded dist path: 1.1.0-rc.2 is ESM-only with
 * an import-only exports map, so require.resolve(specifier) throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED on the current pin.
 */
export function resolveInstalledEntry(specifier: string): string {
  const pkgJsonPath = spikeRequire.resolve(`${specifier}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    main?: unknown;
    exports?: unknown;
  };
  let target: string | undefined;
  const dot = (pkg.exports as Record<string, unknown> | undefined)?.["."];
  if (typeof dot === "string") {
    target = dot;
  } else if (dot !== null && typeof dot === "object") {
    const conditions = dot as Record<string, unknown>;
    if (typeof conditions["import"] === "string") target = conditions["import"];
    else if (typeof conditions["default"] === "string") target = conditions["default"];
  }
  if (target === undefined && typeof pkg.main === "string") target = pkg.main;
  if (target === undefined) throw new Error(`capture-browser-proof: no entry found for ${specifier}`);
  return join(dirname(pkgJsonPath), target.replace(/^\.\//u, ""));
}

function readInstalledSpec(specifier: string): { version: string; license: string; entryPath: string; entrySha256: string } {
  const pkgJsonPath = spikeRequire.resolve(`${specifier}/package.json`);
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { version?: unknown; license?: unknown };
  if (typeof pkg.version !== "string") throw new Error(`capture-browser-proof: no version for ${specifier}`);
  if (typeof pkg.license !== "string") throw new Error(`capture-browser-proof: no license for ${specifier}`);
  const entryPath = resolveInstalledEntry(specifier);
  const entrySha256 = createHash("sha256").update(readFileSync(entryPath)).digest("hex");
  return { version: pkg.version, license: pkg.license, entryPath, entrySha256 };
}

const PROOF_ENTRY_SOURCE = `import * as iwsdkCore from "@iwsdk/core";
import * as xrInput from "@iwsdk/xr-input";

const coreVersion = (iwsdkCore as unknown as { VERSION?: unknown }).VERSION ?? null;
(window as unknown as Record<string, unknown>).${PROOF_GLOBAL} = {
  coreVersion,
  uiKitDocumentType: typeof (iwsdkCore as unknown as Record<string, unknown>).UIKitDocument,
  xrInputExports: Object.keys(xrInput).length,
};
`;

async function buildProofBundle(stageDir: string): Promise<{ bundleName: string; bundleBytes: Buffer }> {
  writeFileSync(join(stageDir, "proof-entry.ts"), PROOF_ENTRY_SOURCE, "utf8");
  await build({
    configFile: false,
    root: stageDir,
    logLevel: "warn",
    build: {
      outDir: join(stageDir, "dist"),
      emptyOutDir: true,
      lib: {
        entry: join(stageDir, "proof-entry.ts"),
        name: "OpenClinXrIwsdkProof",
        formats: ["iife"],
        fileName: () => "proof-bundle.js",
      },
    },
  });
  const bundlePath = join(stageDir, "dist", "proof-bundle.js");
  if (!existsSync(bundlePath)) throw new Error("capture-browser-proof: vite build emitted no proof-bundle.js");
  return { bundleName: basename(bundlePath), bundleBytes: readFileSync(bundlePath) };
}

async function executeBundleInChromium(bundleBytes: Buffer): Promise<{
  proof: { coreVersion?: unknown; uiKitDocumentType?: unknown; xrInputExports?: unknown } | null;
  consoleLines: string[];
  pageErrors: string[];
}> {
  const pageHtml = `<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/proof-bundle.js"></script></body></html>`;
  const server = createServer((req, res) => {
    if (req.url === "/proof-bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(bundleBytes);
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(pageHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await createLocalComputeServices().sceneCapture.withBrowser(
      "iwsdk-browser-proof:capture",
      async (launched) => {
        const page = await (launched as Browser).newPage();
        const consoleLines: string[] = [];
        page.on("console", (message) => consoleLines.push(message.text()));
        const pageErrors: string[] = [];
        page.on("pageerror", (error) => pageErrors.push(String(error)));
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
        await page.waitForFunction(
          (globalName: string) => (window as unknown as Record<string, unknown>)[globalName] !== undefined,
          PROOF_GLOBAL,
          { timeout: 30_000 },
        );
        const proof = (await page.evaluate(
          (globalName: string) => (window as unknown as Record<string, unknown>)[globalName],
          PROOF_GLOBAL,
        )) as { coreVersion?: unknown; uiKitDocumentType?: unknown; xrInputExports?: unknown } | null;
        await page.close();
        return { proof, consoleLines, pageErrors };
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function parseOutArg(argv: string[]): string {
  const flagIndex = argv.indexOf("--out");
  if (flagIndex !== -1 && argv[flagIndex + 1] !== undefined) return resolvePath(process.cwd(), argv[flagIndex + 1]);
  return join(HERE, "browser-proof-110rc2.json");
}

async function main(): Promise<void> {
  const core = readInstalledSpec("@iwsdk/core");
  const xrInput = readInstalledSpec("@iwsdk/xr-input");
  // Stage inside the spike root so bare "@iwsdk/*" imports resolve via the spike's node_modules.
  const stageDir = mkdtempSync(join(SPIKE_ROOT, ".iwsdk-proof-"));
  try {
    const { bundleName, bundleBytes } = await buildProofBundle(stageDir);
    const bundleSha256 = createHash("sha256").update(bundleBytes).digest("hex");
    const { proof, consoleLines, pageErrors } = await executeBundleInChromium(bundleBytes);
    const pass = proof !== null
      && proof.coreVersion === core.version
      && proof.uiKitDocumentType === "function"
      && Number(proof.xrInputExports ?? 0) > 0
      && pageErrors.length === 0;
    const receipt = {
      capturedAt: new Date().toISOString(),
      repoRoot: REPO_ROOT,
      licensedExpectation: { core: core.version, xrInput: xrInput.version },
      sdk: {
        core: { version: core.version, license: core.license, distSha256: core.entrySha256 },
        xrInput: { version: xrInput.version, license: xrInput.license, distSha256: xrInput.entrySha256 },
      },
      bundle: bundleName,
      bundleSha256,
      evaluated: { via: EVALUATED_VIA, proof },
      console: consoleLines,
      pageErrors,
      pass,
    };
    const outPath = parseOutArg(process.argv.slice(2));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    console.log(`capture-browser-proof: pass=${pass} core=${core.version} bundle=${bundleName} -> ${outPath}`);
    if (!pass) process.exitCode = 1;
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
