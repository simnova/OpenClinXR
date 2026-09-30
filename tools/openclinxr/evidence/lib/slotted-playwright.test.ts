import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readComputeSlotsStatus } from "@openclinxr/compute-slots";
import type { Browser, chromium as playwrightChromium } from "playwright";
import { afterEach, expect, it } from "vitest";
import { createSlottedChromium } from "./slotted-playwright.js";

const priorRoot = process.env["OPENCLINXR_LOCK_ROOT"];
let root: string | null = null;

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
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(readComputeSlotsStatus().pools.find(({ pool }) => pool === "browser-capture")?.holders).toEqual([]);
});
