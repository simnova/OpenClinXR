import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The IWSDK spike ships a real executable dependency, not a source-text mention. Pins: 1.1.0-rc.2 per ci-w5 f0638c7a0 (was the 0.4.2 licensed hold). Clause (1) proves bare-Node import on the current pin (0.4.2 needed a DOM; three proves the resolver). Clause (2) asserts the checked-in Chromium receipt: historical execution tied to installed source SHA — NOT fresh capture, NOT currentness, NOT Quest. claimScope: ship set + Node DOM cause + historical execution. notEvidenceFor: latest status, Quest behavior. */

const req = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(HERE, "../..", ".."); // evidence -> openclinxr -> tools -> root
const SPIKE_ROOT = join(REPO_ROOT, "apps/arena/ui-xr-iwsdk-spike");

/**
 * Pins declared at apps/arena/ui-xr-iwsdk-spike/package.json. Superseded 2026-10-30 by ci-w5
 * f0638c7a0 (operator decision: IWSDK npm latest, 1.1.0-rc.2, all MIT). The 0.4.2 hold survives
 * only as the historical Chromium receipt in clause (2).
 */
const CURRENT_CORE = "1.1.0-rc.2";
const CURRENT_XR_INPUT = "1.1.0-rc.2";
const CURRENT_DEV_PLUGIN = "1.1.0-rc.2";
const CURRENT_UIKITML_PLUGIN = "0.4.2";
/** The pin the checked-in Chromium receipt executed (history, clause 2). */
const RECEIPT_CORE = "0.4.2";
const IWSDK_PACKAGES = ["@iwsdk/core", "@iwsdk/xr-input"] as const;

type ProbeRow = {
  cjsResolve?: string;
  cjsResolveError?: string;
  imported?: boolean;
  moduleKind?: string;
  exportCount?: number;
  functionExportCount?: number;
  version?: string;
  importError?: string;
};
type ProbeReport = { cwd: string; results: Record<string, ProbeRow> };

/** Runs scripts/probe-iwsdk.mjs in the spike root and returns its parsed report. */
function runSpikeContextProbe(): ProbeReport {
  const outPath = join(mkdtempSync(join(tmpdir(), "openclinxr-iwsdk-probe-")), "probe.json");
  try {
    execFileSync(process.execPath, [join(SPIKE_ROOT, "scripts/probe-iwsdk.mjs"), outPath], {
      cwd: SPIKE_ROOT,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(readFileSync(outPath, "utf8")) as ProbeReport;
  } catch {
    // The probe exits 1 on the licensed pin under bare Node (document-error rows).
    // The report file is still written; read it rather than losing the evidence.
    return JSON.parse(readFileSync(outPath, "utf8")) as ProbeReport;
  } finally {
    rmSync(dirname(outPath), { recursive: true, force: true });
  }
}

/**
 * Resolve the installed package's main entry through its exports map — the same method
 * as the capture producer (iwsdk-browser-proof/capture-browser-proof.ts): resolve
 * <specifier>/package.json from the spike root, then follow the "." export's import
 * condition (main when no exports map exists). No hard-coded dist path: 1.1.0-rc.2 is
 * ESM-only with an import-only exports map, so require.resolve("@iwsdk/core") throws.
 */
function resolveInstalledEntry(specifier: string): string {
  const pkgJsonPath = req.resolve(`${specifier}/package.json`, { paths: [SPIKE_ROOT] } as never) as string;
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as { main?: unknown; exports?: unknown };
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
  if (target === undefined) throw new Error(`no entry found for ${specifier}`);
  return join(dirname(pkgJsonPath), target.replace(/^\.\//u, ""));
}

describe("the iwsdk spike proves the package runs", () => {
  it("(1) the probe runs in the spike context; both iwsdk packages import under bare Node on the current pin", () => {
    const report = runSpikeContextProbe();
    expect(report.cwd, "the probe must run from the spike root, where pnpm links the packages").toBe(
      SPIKE_ROOT,
    );
    // Known-good: three executes in this context, so the instrument is proven.
    expect(report.results.three?.imported, "`three` must import in the probe context").toBe(true);
    // 0.4.2 needed a DOM at import (cursor-visual document.createElement). 1.1.0-rc.2 imports under
    // bare Node: measured 2026-10-30, core 705 exports / 387 functions, xr-input 38 / 27.
    for (const p of IWSDK_PACKAGES) {
      const row = report.results[p];
      expect(row, `${p} must appear in the probe report`).toBeDefined();
      expect(row?.importError, `${p} must import without error on the current pin`).toBeUndefined();
      expect(row?.imported, `${p} must import under bare Node on the current pin`).toBe(true);
      expect(row?.functionExportCount ?? 0, `${p} must expose callable exports`).toBeGreaterThan(0);
    }
    // core is ESM-only on 1.1.0-rc.2 (ERR_PACKAGE_PATH_NOT_EXPORTED under CJS); its version is read
    // from the imported module, so a wrong install cannot pass.
    expect(report.results["@iwsdk/core"]?.version, "imported core reports the current pin").toBe(CURRENT_CORE);
  });

  // (2) HISTORICAL: the 0.4.2 receipt is preserved as recorded. ci-w5 f0638c7a0 moved the
  // spike to 1.1.0-rc.2 (operator decision, IWSDK npm latest), so 042 executed a DIFFERENT pin
  // than the installed packages: this clause asserts ONLY what the receipt records, never the
  // installed tree. Re-adding an installed-package comparison here is wrong for that reason.
  // Clause (2b) below is the current-pin replacement. Historical execution, NOT fresh capture,
  // NOT currentness, NOT Quest. Receipt browser-proof-042.json: real Vite bundle of the 0.4.2
  // pin, headless-Chromium real-DOM import, computed window.__openClinXrIwsdkProof, captured
  // 2026-10-20 (pass:true). Heavy browser capture stays out of the 5s unit queue.
  it("(2) HISTORICAL: the 0.4.2 receipt is preserved as recorded", () => {
    const receiptPath = join(HERE, "iwsdk-browser-proof/browser-proof-042.json");
    expect(existsSync(receiptPath), "checked-in browser receipt must exist").toBe(true);
    const artifact = JSON.parse(readFileSync(receiptPath, "utf8")) as {
      capturedAt?: string;
      bundleSha256?: string;
      sdk?: {
        core?: { version?: string; license?: string; distSha256?: string };
        xrInput?: { version?: string; license?: string; distSha256?: string };
      };
      evaluated?: { proof?: { coreVersion?: unknown; uiKitDocumentType?: unknown; xrInputExports?: unknown } | null };
      pass?: boolean;
    };
    expect(artifact.pass, "recorded Chromium run passed").toBe(true);
    expect(artifact.evaluated?.proof?.coreVersion, "executed core VERSION is the receipt pin").toBe(RECEIPT_CORE);
    expect(artifact.evaluated?.proof?.uiKitDocumentType, "executed UIKitDocument is callable").toBe("function");
    expect(Number(artifact.evaluated?.proof?.xrInputExports ?? 0), "executed xr-input exposes exports").toBeGreaterThan(0);
    expect(String(artifact.bundleSha256 ?? ""), "receipt pins the executed bundle").toMatch(/^[0-9a-f]{64}$/u);
    expect(artifact.sdk?.core?.version, "recorded core version is the receipt pin").toBe(RECEIPT_CORE);
    expect(artifact.sdk?.core?.license, "recorded core is MIT").toBe("MIT");
  });

  it("(2b) CURRENT: Chromium executed the current pin", () => {
    // Current-pin execution, NOT fresh capture, NOT Quest. Receipt
    // browser-proof-110rc2.json: real Vite bundle of the f0638c7a0 pin, headless-Chromium
    // real-DOM import, computed window.__openClinXrIwsdkProof. The receipt's dist SHAs are
    // checked against the installed entries resolved through the exports map (same method
    // as the producer), so a wrong-pin install cannot pass. Heavy browser capture stays
    // out of the 5s unit queue: recapture with iwsdk-browser-proof/capture-browser-proof.ts.
    const receiptPath = join(HERE, "iwsdk-browser-proof/browser-proof-110rc2.json");
    expect(existsSync(receiptPath), "checked-in current-pin browser receipt must exist").toBe(true);
    const artifact = JSON.parse(readFileSync(receiptPath, "utf8")) as {
      capturedAt?: string;
      bundleSha256?: string;
      sdk?: {
        core?: { version?: string; license?: string; distSha256?: string };
        xrInput?: { version?: string; license?: string; distSha256?: string };
      };
      evaluated?: { proof?: { coreVersion?: unknown; uiKitDocumentType?: unknown; xrInputExports?: unknown } | null };
      pass?: boolean;
    };
    expect(artifact.pass, "recorded Chromium run passed").toBe(true);
    expect(artifact.evaluated?.proof?.coreVersion, "executed core VERSION is the current pin").toBe(CURRENT_CORE);
    expect(artifact.evaluated?.proof?.uiKitDocumentType, "executed UIKitDocument is callable").toBe("function");
    expect(Number(artifact.evaluated?.proof?.xrInputExports ?? 0), "executed xr-input exposes exports").toBeGreaterThan(0);
    expect(String(artifact.bundleSha256 ?? ""), "receipt pins the executed bundle").toMatch(/^[0-9a-f]{64}$/u);
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const shaFile = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
    expect(artifact.sdk?.core?.distSha256, "receipt core SHA matches installed source").toBe(
      shaFile(resolveInstalledEntry("@iwsdk/core")),
    );
    expect(artifact.sdk?.xrInput?.distSha256, "receipt xr-input SHA matches installed source").toBe(
      shaFile(resolveInstalledEntry("@iwsdk/xr-input")),
    );
    expect(artifact.sdk?.core?.license, "installed core is MIT").toBe("MIT");
  });

  it("(3) KNOWN-GOOD COLUMN: the resolver succeeds on a package that IS installed", () => {
    expect(req.resolve("three"), "the CJS resolver must work on a dual-format package").toContain(
      "/node_modules/",
    );
    const report = runSpikeContextProbe();
    expect(report.results.three?.imported, "`three` must also import in the probe context").toBe(true);
  });

  it("(4) COUNTERWEIGHT: the declaration is not deleted to clear the red", () => {
    const pkg = JSON.parse(readFileSync(join(SPIKE_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(all["@iwsdk/core"], "the spike must still DECLARE @iwsdk/core — do not clear the red by deleting it")
      .toBeDefined();
  });

  it("(5) NET: the spike stays on the operator-chosen pins — 1.1.0-rc.2 trio, uikitml 0.4.2", () => {
    const pkg = JSON.parse(readFileSync(join(SPIKE_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(all["@iwsdk/core"], "@iwsdk/core stays on the f0638c7a0 pin").toBe(CURRENT_CORE);
    expect(all["@iwsdk/xr-input"], "@iwsdk/xr-input stays on the f0638c7a0 pin").toBe(CURRENT_XR_INPUT);
    expect(all["@iwsdk/vite-plugin-dev"], "dev plugin stays on the f0638c7a0 pin").toBe(CURRENT_DEV_PLUGIN);
    expect(all["@iwsdk/vite-plugin-uikitml"], "uikitml plugin stays at 0.4.2").toBe(CURRENT_UIKITML_PLUGIN);
  });
});
