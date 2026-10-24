import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Script, createContext } from "node:vm";
import { hostname } from "node:os";
import { readComputeSlotsStatus } from "@openclinxr/compute-slots/slots";
import type { Browser, BrowserContext, Page, chromium as playwrightChromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "./evidence-page.js";
import { createSlottedChromium } from "./slotted-playwright.js";

const priorRoot = process.env["OPENCLINXR_LOCK_ROOT"];
let root: string | null = null;

async function awaitSlotFree(pool: string): Promise<void> {
  // Slot-file cleanup runs after the launch promise settles, so poll
  // briefly rather than asserting instantly. A genuine leak never clears.
  const deadline = Date.now() + 2000;
  for (;;) {
    const holders = readComputeSlotsStatus().pools.find((entry) => entry.pool === pool)?.holders ?? [];
    if (holders.length === 0) return;
    if (Date.now() >= deadline) throw new Error(`slot ${pool} still held: ${JSON.stringify(holders)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
  if (priorRoot === undefined) delete process.env["OPENCLINXR_LOCK_ROOT"];
  else process.env["OPENCLINXR_LOCK_ROOT"] = priorRoot;
});

it("holds browser-capture until the launched browser closes", async () => {
  root = mkdtempSync(path.join(tmpdir(), `browser-capture-slot-${process.pid}-`));
  process.env["OPENCLINXR_LOCK_ROOT"] = root;
  const disconnected: Array<() => void> = [];
  const fakeBrowser = {
    once(event: string, callback: () => void) {
      if (event === "disconnected") disconnected.push(callback);
      return this;
    },
    async close() {
      for (const callback of disconnected) callback();
    },
  } as unknown as Browser;
  const raw = { launch: async () => fakeBrowser } as unknown as typeof playwrightChromium;
  const browser = await createSlottedChromium(raw).launch();
  expect(readComputeSlotsStatus().pools.find(({ pool }) => pool === "browser-capture")?.holders).toHaveLength(1);
  await browser.close();
  // Slot-file cleanup settles after close resolves; poll briefly.
  await awaitSlotFree("browser-capture");
  expect(readComputeSlotsStatus().pools.find(({ pool }) => pool === "browser-capture")?.holders).toEqual([]);
});

function runInitScript(sandbox: Record<string, unknown>): { sandbox: Record<string, unknown>; isGlobalAlias: boolean } {
  const context = createContext(sandbox);
  new Script(BROWSER_PAGE_GLOBALS_INIT_SCRIPT).runInContext(context);
  const isGlobalAlias = new Script("browserPageWindow === globalThis && browserPageDocument === globalThis.document").runInContext(context) as boolean;
  return { sandbox: context as unknown as Record<string, unknown>, isGlobalAlias };
}

describe("BROWSER_PAGE_GLOBALS_INIT_SCRIPT", () => {
  it("aliases the real globalThis/document and forwards to the native MediaRecorder", () => {
    const seen: Array<{ stream: unknown; options: unknown }> = [];
    class FakeMediaRecorder {
      static supported = new Set(["video/webm"]);
      static isTypeSupported(mime: string) {
        return FakeMediaRecorder.supported.has(mime);
      }
      constructor(
        readonly stream: unknown,
        readonly options?: unknown,
      ) {
        seen.push({ stream, options });
      }
    }
    const document = { marker: "real-document" };
    const { sandbox, isGlobalAlias } = runInitScript({ document, MediaRecorder: FakeMediaRecorder } as unknown as Record<string, unknown>);
    expect(isGlobalAlias).toBe(true);
    const supports = sandbox["browserPageRecorderSupports"] as (mime: string) => boolean;
    expect(supports("video/webm")).toBe(true);
    expect(supports("video/nope")).toBe(false);
    const create = sandbox["createBrowserPageRecorder"] as (stream: unknown, options?: unknown) => unknown;
    const recordingStream = { id: "s" };
    const recorder = create(recordingStream, { mimeType: "video/webm" }) as { stream: unknown };
    expect(recorder).toBeInstanceOf(FakeMediaRecorder);
    expect(recorder.stream).toBe(recordingStream);
    expect(seen).toHaveLength(1);
  });

  it("never fakes support/data when native MediaRecorder is unavailable", () => {
    const { sandbox } = runInitScript({});
    const supports = sandbox["browserPageRecorderSupports"] as (mime: string) => boolean;
    expect(supports("video/webm")).toBe(false);
    const create = sandbox["createBrowserPageRecorder"] as () => unknown;
    expect(() => create()).toThrow(/MediaRecorder/i);
  });
});

type FakePage = Page & { calls: Array<{ kind: string; script: unknown }>; closed: boolean };

function fakePage(
  overrides: { evaluate?: (script: unknown) => Promise<unknown>; context?: BrowserContext } = {},
): FakePage {
  const calls: Array<{ kind: string; script: unknown }> = [];
  const state = { closed: false };
  const linkedContext =
    overrides.context ??
    ({
      async addInitScript() {},
      pages: () => [],
      async close() {},
    } as unknown as BrowserContext);
  return {
    calls,
    get closed() {
      return state.closed;
    },
    async addInitScript(script: unknown) {
      calls.push({ kind: "addInitScript", script });
    },
    async evaluate(script: unknown) {
      calls.push({ kind: "evaluate", script });
      if (overrides.evaluate) return overrides.evaluate(script);
      return undefined;
    },
    context() {
      return linkedContext;
    },
    async close() {
      state.closed = true;
    },
  } as unknown as FakePage;
}

describe("slotted browser page globals", () => {
  async function launchWith(fakeBrowser: unknown) {
    if (root) rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(path.join(tmpdir(), `browser-capture-slot-${process.pid}-`));
    process.env["OPENCLINXR_LOCK_ROOT"] = root;
    const raw = { launch: async () => fakeBrowser } as unknown as typeof playwrightChromium;
    return createSlottedChromium(raw).launch();
  }

  it("installs the canonical script on newContext pages, context.newPage, and browser.newPage", async () => {
    const contextPage = fakePage();
    const directPage = fakePage();
    const implicitPage = fakePage();
    const newContextArgs: unknown[] = [{ viewport: { width: 10, height: 10 } }];
    const context = {
      newPageCalls: 0,
      async addInitScript(script: unknown) {
        void script;
      },
      pages: () => [contextPage],
      async newPage() {
        this.newPageCalls += 1;
        return directPage;
      },
      async close() {},
    } as unknown as BrowserContext & { newPageCalls: number };
    let seenNewContextThis = false;
    let seenNewPageThis = false;
    const fakeBrowser = {
      once() {
        return this;
      },
      async close() {},
      async newContext(...args: unknown[]) {
        seenNewContextThis = this === fakeBrowser;
        expect(args).toEqual(newContextArgs);
        return context;
      },
      async newPage(...args: unknown[]) {
        seenNewPageThis = this === fakeBrowser;
        expect(args).toEqual([]);
        return implicitPage;
      },
    } as unknown as Browser;
    const browser = await launchWith(fakeBrowser);
    const created = (await (browser.newContext as (...a: unknown[]) => Promise<BrowserContext>)(...newContextArgs)) as BrowserContext & {
      newPageCalls?: number;
    };
    const fromContext = await created.newPage();
    const implicit = await browser.newPage();
    expect(seenNewContextThis).toBe(true);
    expect(seenNewPageThis).toBe(true);
    for (const page of [contextPage, directPage, implicitPage]) {
      const kinds = (page as unknown as { calls: Array<{ kind: string; script: unknown }> }).calls;
      expect(kinds.filter(({ kind }) => kind === "addInitScript")).toHaveLength(1);
      expect(kinds.filter(({ kind }) => kind === "evaluate")).toHaveLength(1);
      for (const { script } of kinds) expect(script).toBe(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    }
    expect(fromContext).toBe(directPage);
    expect(implicit).toBe(implicitPage);
    await browser.close();
  });

  it("browser.newPage installs context-level init covering future popups/navigation", async () => {
    const contextScripts: unknown[] = [];
    const implicitContext = {
      async addInitScript(script: unknown) {
        contextScripts.push(script);
      },
      pages: () => [],
      async close() {},
    } as unknown as BrowserContext;
    const implicitPage = fakePage({ context: implicitContext });
    const fakeBrowser = {
      once() {
        return this;
      },
      async close() {},
      async newPage() {
        return implicitPage;
      },
    } as unknown as Browser;
    const browser = await launchWith(fakeBrowser);
    const page = await browser.newPage();
    expect(page).toBe(implicitPage);
    expect(contextScripts).toEqual([BROWSER_PAGE_GLOBALS_INIT_SCRIPT]);
    expect(implicitPage.calls.map(({ kind }) => kind)).toEqual(["addInitScript", "evaluate"]);
    await browser.close();
  });

  it("marks initialized only after success: failures close, rethrow, and retry", async () => {
    let attempts = 0;
    const made: FakePage[] = [];
    const fakeBrowser = {
      once() {
        return this;
      },
      async close() {},
      async newPage() {
        attempts += 1;
        const fail = attempts === 1;
        const page = fakePage({
          evaluate: async () => {
            if (fail) throw new Error("evaluate boom");
            return undefined;
          },
        });
        made.push(page);
        return page;
      },
    } as unknown as Browser;
    const browser = await launchWith(fakeBrowser);
    await expect(browser.newPage()).rejects.toThrow("evaluate boom");
    expect(made[0]?.closed).toBe(true);
    const retried = await browser.newPage();
    expect(retried).toBe(made[1]);
    // addInitScript ran again on the retry (once per page), proving no stale mark.
    expect(made.map((page) => page.calls.filter(({ kind }) => kind === "addInitScript").length)).toEqual([1, 1]);
    await browser.close();
  });

  it("pre-existing page init failure closes the context and rethrows the original", async () => {
    const bad = fakePage({
      evaluate: async () => {
        throw new Error("sweep boom");
      },
    });
    const state = { closed: false };
    const context = {
      async addInitScript() {},
      pages: () => [bad],
      async close() {
        state.closed = true;
      },
    } as unknown as BrowserContext;
    const fakeBrowser = {
      once() {
        return this;
      },
      async close() {},
      async newContext() {
        return context;
      },
    } as unknown as Browser;
    const browser = await launchWith(fakeBrowser);
    await expect(browser.newContext()).rejects.toThrow("sweep boom");
    expect(state.closed).toBe(true);
    await browser.close();
  });

  it("preserves creation errors and releases cleanup on init failure", async () => {
    // Isolated lock root: this test uses only fake browsers, so it must not
    // contend for the shared production slot (CI: queued behind real
    // browser-capture holders until the 5s timeout — the failure this
    // suite regresses against).
    root = mkdtempSync(path.join(tmpdir(), `browser-capture-slot-${process.pid}-`));
    process.env["OPENCLINXR_LOCK_ROOT"] = root;
    const launchError = new Error("launch boom");
    await expect(createSlottedChromium({ launch: async () => Promise.reject(launchError) } as unknown as typeof playwrightChromium).launch()).rejects.toBe(
      launchError,
    );
    // The failed acquisition released the slot: no holder lingers.
    await awaitSlotFree("browser-capture");
    const failingContext = {
      pages: () => [],
      async addInitScript() {
        throw new Error("context init boom");
      },
      closed: false,
      async close(this: { closed: boolean }) {
        this.closed = true;
      },
    } as unknown as BrowserContext & { closed: boolean };
    const fakeBrowser = {
      once() {
        return this;
      },
      async close() {},
      async newContext() {
        return failingContext;
      },
    } as unknown as Browser;
    const browser = await launchWith(fakeBrowser);
    await expect(browser.newContext()).rejects.toThrow("context init boom");
    expect(failingContext.closed).toBe(true);
    await browser.close();
  });

  it("aborting a queued launch rejects without invoking the underlying launch", async () => {
    root = mkdtempSync(path.join(tmpdir(), `browser-capture-slot-${process.pid}-`));
    process.env["OPENCLINXR_LOCK_ROOT"] = root;
    // Wedge the single slot with a holder file owned by this (live) pid,
    // mimicking a browser test that still holds browser-capture. The holder
    // is raw filesystem state, so the queued launch below is NOT absorbed
    // by withComputeSlot reentrancy and genuinely waits.
    const poolDir = path.join(root, "browser-capture");
    mkdirSync(path.join(poolDir, "queue"), { recursive: true });
    const holderPath = path.join(poolDir, "slot-0.json");
    writeFileSync(
      holderPath,
      `${JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString(), cwd: process.cwd(), label: "test-wedge", token: "test-held-token" })}\n`,
    );
    try {
      let invoked = 0;
      const raw = {
        launch: async () => {
          invoked += 1;
          throw new Error("must not launch while queued");
        },
      } as unknown as typeof playwrightChromium;
      const controller = new AbortController();
      const pending = createSlottedChromium(raw).launch({ signal: controller.signal });
      // Give the waiter time to file its queue ticket, then abort.
      await new Promise((resolve) => setTimeout(resolve, 750));
      controller.abort(new Error("test abort while queued"));
      await expect(pending).rejects.toThrow("test abort while queued");
      expect(invoked).toBe(0);
      // The aborted waiter removed its ticket: nothing waits behind the wedge.
      expect(readComputeSlotsStatus().pools.find(({ pool }) => pool === "browser-capture")?.waiters).toEqual([]);
    } finally {
      rmSync(holderPath, { force: true });
    }
    // With the wedge gone, a fresh launch proceeds immediately.
    const disconnected: Array<() => void> = [];
    const fakeBrowser = {
      once(event: string, callback: () => void) {
        if (event === "disconnected") disconnected.push(callback);
        return this;
      },
      async close() {
        for (const callback of disconnected) callback();
      },
    } as unknown as Browser;
    const browser = await createSlottedChromium({
      launch: async () => fakeBrowser,
    } as unknown as typeof playwrightChromium).launch();
    await browser.close();
    await awaitSlotFree("browser-capture");
  });

  it("aborting mid-launch closes the just-launched browser and frees the slot", async () => {
    root = mkdtempSync(path.join(tmpdir(), `browser-capture-slot-${process.pid}-`));
    process.env["OPENCLINXR_LOCK_ROOT"] = root;
    let releaseRaw!: () => void;
    const rawGate = new Promise<void>((resolve) => {
      releaseRaw = resolve;
    });
    let closed = false;
    const disconnected: Array<() => void> = [];
    const fakeBrowser = {
      once(event: string, callback: () => void) {
        if (event === "disconnected") disconnected.push(callback);
        return this;
      },
      async close() {
        closed = true;
        for (const callback of disconnected) callback();
      },
    } as unknown as Browser;
    let sawOptions: unknown;
    const raw = {
      launch: async (options: unknown) => {
        sawOptions = options;
        await rawGate;
        return fakeBrowser;
      },
    } as unknown as typeof playwrightChromium;
    const controller = new AbortController();
    const pending = createSlottedChromium(raw).launch({ headless: true, signal: controller.signal });
    for (let i = 0; i < 200 && sawOptions === undefined; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(sawOptions).toBeDefined();
    // The slot signal is stripped before delegating to playwright.
    expect(sawOptions).toEqual({ headless: true });
    controller.abort(new Error("mid-launch abort"));
    releaseRaw();
    await expect(pending).rejects.toThrow("mid-launch abort");
    expect(closed).toBe(true);
    await awaitSlotFree("browser-capture");
  });
});
