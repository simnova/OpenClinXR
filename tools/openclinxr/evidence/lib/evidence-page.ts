import type { Browser, Page } from "playwright";

/**
 * Open a Playwright page with the evidence tools' page-global alias actually DEFINED.
 *
 * `browser-dom.d.ts` declares `browserPageWindow` so tsgo stops complaining about page globals,
 * and its own header says "Runtime behavior is unchanged — types only". Nothing defines it in a
 * page, so every callback that references it throws.
 *
 * MEASURED 2026-09-09 against a real chromium page, both forms used in this tree:
 *
 *   page.evaluate(`const win = browserPageWindow; …`)   -> ReferenceError: browserPageWindow is not defined
 *   page.waitForFunction(() => browserPageWindow…)       -> the same ReferenceError
 *   typeof browserPageWindow                             -> "undefined", NO throw
 *
 * That last row is why the problem hid: a `typeof` guard returns a falsy answer instead of
 * failing, so a tool reports its empty-default branch rather than an error.
 *
 * A syntactic sweep of `tools/openclinxr/evidence/` on the same day: 59 files reference the alias,
 * 58 of them at least once in a position that is evaluated at runtime, 176 such occurrences. Two
 * were confirmed by reading the code (inpatient-supine-staging.ts:373, which the scene-layout
 * brief cites as its existing staging instrument, and declared-equipment-mounted.ts:448,481,552);
 * the rest are classified by position, NOT by execution.
 *
 * A typechecker made the wrong thing compile. `globalThis` is the right answer in new code — it
 * typechecks in node and IS the window inside the page. This helper is for the existing callbacks:
 * it defines the alias before any script runs, so they work unchanged.
 */
export const BROWSER_PAGE_GLOBALS_INIT_SCRIPT =
  "globalThis.browserPageWindow = globalThis; globalThis.browserPageDocument = globalThis.document;";

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
