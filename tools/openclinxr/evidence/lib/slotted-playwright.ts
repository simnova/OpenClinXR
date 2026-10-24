import { withComputeSlot } from "@openclinxr/compute-slots/slots";
import { type Browser, type BrowserContext, type Page, chromium as playwrightChromium } from "playwright";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "./evidence-page.js";

export * from "playwright";

// Initialized markers are added ONLY after the corresponding addInitScript
// succeeds, so a failed initializer is retried on the next creation instead
// of being silently skipped.
const contextsInitialized = new WeakSet<object>();
const pagesInitialized = new WeakSet<object>();
const contextsWrapped = new WeakMap<object, BrowserContext>();

async function ensurePageGlobals(page: Page): Promise<void> {
  if (pagesInitialized.has(page)) return;
  await page.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
  await page.evaluate(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
  pagesInitialized.add(page);
}

async function ensureContextGlobals(context: BrowserContext): Promise<void> {
  if (!contextsInitialized.has(context)) {
    await context.addInitScript(BROWSER_PAGE_GLOBALS_INIT_SCRIPT);
    contextsInitialized.add(context);
  }
  // Eagerly initialize already-open blank pages so immediate evaluate works.
  // Errors are NOT swallowed: the caller closes what it created and rethrows.
  for (const page of context.pages()) {
    await ensurePageGlobals(page);
  }
}

function wrapContextGlobals(context: BrowserContext): BrowserContext {
  const cached = contextsWrapped.get(context);
  if (cached) return cached;
  const wrapped = new Proxy(context, {
    get(target, property) {
      if (property === "newPage") {
        return async (...args: Parameters<BrowserContext["newPage"]>) => {
          const page = await Reflect.apply(target.newPage, target, args);
          try {
            await ensurePageGlobals(page);
          } catch (error) {
            await page.close().catch(() => {});
            throw error;
          }
          return page;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  contextsWrapped.set(context, wrapped);
  return wrapped;
}

function protectBrowserLifetime(browser: Browser, release: () => void): Browser {
  browser.once("disconnected", release);
  return new Proxy(browser, {
    get(target, property) {
      if (property === "close") {
        return async (...args: Parameters<Browser["close"]>) => {
          try {
            return await target.close(...args);
          } finally {
            release();
          }
        };
      }
      if (property === "newContext") {
        return async (...args: Parameters<Browser["newContext"]>) => {
          const context = await Reflect.apply(target.newContext, target, args);
          try {
            await ensureContextGlobals(context);
          } catch (error) {
            await context.close().catch(() => {});
            throw error;
          }
          return wrapContextGlobals(context);
        };
      }
      if (property === "newPage") {
        return async (...args: Parameters<Browser["newPage"]>) => {
          const page = await Reflect.apply(target.newPage, target, args);
          try {
            // browser.newPage owns an implicit context (future popups, shared
            // navigation state): install context-level init there too, then
            // eagerly initialize the original page for immediate evaluate.
            await ensureContextGlobals(page.context());
            await ensurePageGlobals(page);
          } catch (error) {
            await page.close().catch(() => {});
            throw error;
          }
          return page;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export type SlottedChromiumLaunchOptions = Parameters<typeof playwrightChromium.launch>[0] & {
  /**
   * Opt-in cancellation for the browser-capture slot wait. Consumed by the
   * slot wrapper and stripped before delegating to playwright. Aborting
   * while queued rejects without invoking the underlying launch; aborting
   * after acquire closes the just-launched browser so no slot leaks.
   */
  signal?: AbortSignal;
};

export type SlottedChromium = Omit<typeof playwrightChromium, "launch"> & {
  launch: (options?: SlottedChromiumLaunchOptions) => Promise<Browser>;
};

function isLaunchOptionsWithSignal(value: unknown): value is { signal: AbortSignal } & Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { signal?: unknown }).signal instanceof AbortSignal
  );
}

function slotAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error("Compute slot acquisition aborted");
}

export function createSlottedChromium(raw: typeof playwrightChromium): SlottedChromium {
  return new Proxy(raw, {
    get(target, property) {
      if (property !== "launch") {
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: Parameters<typeof playwrightChromium.launch>) => {
        // Opt-in cancellation: a leading options object may carry an
        // AbortSignal under `signal`. It is consumed here (slot-queue wait)
        // and stripped before delegating, so playwright never sees it.
        // Without a signal, behavior is exactly as before.
        let signal: AbortSignal | undefined;
        let forward: Parameters<typeof playwrightChromium.launch> = args;
        const [first, ...rest] = args;
        if (isLaunchOptionsWithSignal(first)) {
          signal = first.signal;
          const playwrightOptions: Record<string, unknown> = { ...first };
          delete playwrightOptions["signal"];
          forward = [playwrightOptions, ...rest] as Parameters<typeof playwrightChromium.launch>;
        }
        let resolveBrowser!: (browser: Browser) => void;
        let rejectBrowser!: (error: unknown) => void;
        let release!: () => void;
        const browserReady = new Promise<Browser>((resolve, reject) => {
          resolveBrowser = resolve;
          rejectBrowser = reject;
        });
        const released = new Promise<void>((resolve) => {
          let done = false;
          release = () => {
            if (done) return;
            done = true;
            resolve();
          };
        });
        void withComputeSlot(
          "browser-capture",
          { label: "playwright:chromium", cwd: process.cwd(), ...(signal === undefined ? {} : { signal }) },
          async () => {
            try {
              const browser = await target.launch(...forward);
              if (signal?.aborted) {
                // Acquired, then aborted mid-launch: close what we just made
                // so the slot (and browser process) does not leak to a
                // caller that already received the abort rejection.
                await browser.close().catch(() => {});
                throw slotAbortError(signal);
              }
              resolveBrowser(protectBrowserLifetime(browser, release));
              await released;
            } catch (error) {
              rejectBrowser(error);
              throw error;
            }
          },
        ).catch((error: unknown) => {
          rejectBrowser(error);
          process.stderr.write(`[compute-slots] browser-capture failed: ${String(error)}\n`);
        });
        return browserReady;
      };
    },
  });
}

export const chromium = createSlottedChromium(playwrightChromium);
