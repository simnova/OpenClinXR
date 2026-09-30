import { chromium as playwrightChromium } from "@playwright/test";
import { createSlottedChromium } from "./slotted-playwright.js";

export * from "@playwright/test";
export const chromium = createSlottedChromium(playwrightChromium);
