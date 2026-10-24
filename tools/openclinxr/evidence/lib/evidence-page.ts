import type { Browser, Page } from "playwright";

/**
 * Canonical page-global aliases for Playwright evidence pages (`browser-dom.d.ts`
 * declares these names types-only). Install via `addInitScript` plus an eager
 * `evaluate` for already-open blank pages so immediate `evaluate` works.
 */
export const BROWSER_PAGE_GLOBALS_INIT_SCRIPT = [
  "globalThis.browserPageWindow = globalThis;",
  "globalThis.browserPageDocument = globalThis.document;",
  "if (!globalThis.createBrowserPageRecorder) {",
  "globalThis.createBrowserPageRecorder = function (stream, options) {",
  "var MR = globalThis.MediaRecorder;",
  'if (!MR) throw new Error("createBrowserPageRecorder: native MediaRecorder is unavailable in this page");',
  "return new MR(stream, options);",
  "};",
  "}",
  "if (!globalThis.browserPageRecorderSupports) {",
  "globalThis.browserPageRecorderSupports = function (mimeType) {",
  "var MR = globalThis.MediaRecorder;",
  'if (!MR || typeof MR.isTypeSupported !== "function") return false;',
  "try { return MR.isTypeSupported(mimeType); } catch { return false; }",
  "};",
  "}",
].join("\n");

export async function newEvidencePage(
  browser: Browser,
  options?: { viewport?: { width: number; height: number } },
): Promise<Page> {
  const page = await browser.newPage({
    viewport: options?.viewport ?? { width: 1440, height: 900 },
  });
  await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
  return page;
}
