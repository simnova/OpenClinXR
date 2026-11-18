#!/usr/bin/env tsx
/**
 * Thin CLI: forwards argv to the render-parity station (P2e station move).
 * Aisha subject values live ONLY here; runtime lives in the station package.
 */
import { parseCaptureArgs, runRuntimeCapture } from "@openclinxr/station-render-parity";
import { BROWSER_PAGE_GLOBALS_INIT_SCRIPT } from "../lib/evidence-page.js";
import { spawnPortlessDevServer, stopPortlessDevServer } from "../lib/portless-server.js";
import { chromium } from "../lib/slotted-playwright.js";

const AISHA = {
  id: "aisha-parity",
  bodyGlb: "generated-humanoids/mpfb-ob-patient-aisha.glb",
  hdriUrl: "/cagematch/aisha-parity/studio_small_09_2k.hdr",
  bodyMeshName: "mpfb_ob_patient_aisha_v1_body",
  garmentMeshNames: ["toigo_t_shirt"],
};
const deps = { chromium, spawnPortlessDevServer, stopPortlessDevServer, BROWSER_PAGE_GLOBALS_INIT_SCRIPT };
await runRuntimeCapture(parseCaptureArgs(process.argv.slice(2)), AISHA, deps).then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
