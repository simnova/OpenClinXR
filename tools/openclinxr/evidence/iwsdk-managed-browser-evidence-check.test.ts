import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  buildIwsdkManagedBrowserEvidenceReport,
  type IwsdkManagedBrowserEvidenceReport,
} from "./iwsdk-managed-browser-evidence-check.js";

const execFileAsync = promisify(execFile);

describe("IWSDK managed browser evidence checker", () => {
  it("marks agent mode ready only when managed and normal browser sessions are independent", () => {
    const report = buildIwsdkManagedBrowserEvidenceReport({
      generatedAt: "2026-05-04T00:00:00.000Z",
      evidence: {
        mode: "agent",
        runtimeUrl: "http://127.0.0.1:5181",
        managedBrowserReady: true,
        managedSessionId: "managed-session",
        normalBrowserOpened: true,
        normalSessionId: "normal-session",
        screenshotWidth: 500,
        screenshotHeight: 500,
        managedDevUiVisible: false,
        normalDevUiVisible: true,
      },
    });

    expect(report.verdict).toEqual({
      ready: true,
      blockers: [],
    });
    expect(report.contract.sourceRecordIds).toEqual(["src-iwsdk-ai-docs-2026"]);
  });

  it("exposes a CLI that exits nonzero for incomplete evidence and prints blockers", async () => {
    const rootPackage = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(rootPackage.scripts["iwsdk:browser:evidence"]).toBe(
      "tsx tools/openclinxr/evidence/iwsdk-managed-browser-evidence-check.ts",
    );

    const dir = await mkdtemp(path.join(os.tmpdir(), "openclinxr-iwsdk-browser-evidence-"));
    const inputPath = path.join(dir, "browser-evidence.json");
    await writeFile(
      inputPath,
      `${JSON.stringify({
        mode: "agent",
        runtimeUrl: "http://127.0.0.1:5181",
        managedBrowserReady: true,
        managedSessionId: "same-session",
        normalBrowserOpened: true,
        normalSessionId: "same-session",
        managedDevUiVisible: false,
        normalDevUiVisible: true,
      })}\n`,
      "utf8",
    );

    try {
      await execFileAsync(
        path.resolve("node_modules/.bin/tsx"),
        ["tools/openclinxr/evidence/iwsdk-managed-browser-evidence-check.ts", "--input", inputPath],
        { encoding: "utf8", timeout: 15000 },
      );
      throw new Error("Expected IWSDK browser evidence checker to reject incomplete evidence");
    } catch (error) {
      const failedRun = error as { code: number; stdout: string };
      const report = JSON.parse(failedRun.stdout) as IwsdkManagedBrowserEvidenceReport;

      expect(failedRun.code).toBe(1);
      expect(report.verdict).toEqual({
        ready: false,
        blockers: [
          "normal_browser_session_not_independent",
          "missing_agent_fixed_screenshot_size",
        ],
      });
    }
  });
});
