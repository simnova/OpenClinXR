import { withComputeSlot } from "@openclinxr/compute-slots";
import { type Browser, chromium as playwrightChromium } from "playwright";

export * from "playwright";

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
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createSlottedChromium(raw: typeof playwrightChromium): typeof playwrightChromium {
  return new Proxy(raw, {
    get(target, property) {
      if (property !== "launch") {
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: Parameters<typeof playwrightChromium.launch>) => {
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
          { label: "playwright:chromium", cwd: process.cwd() },
          async () => {
            try {
              const browser = await target.launch(...args);
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
