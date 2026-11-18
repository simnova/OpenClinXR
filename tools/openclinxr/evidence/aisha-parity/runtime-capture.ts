#!/usr/bin/env tsx
/**
 * Thin CLI: forwards argv to the render-parity station (P2e station move).
 * Runtime lives in @openclinxr/station-render-parity; outputs go to the store, never the repo.
 */
import { parseCaptureArgs, runRuntimeCapture, type CaptureCli } from "@openclinxr/station-render-parity";

const opts: CaptureCli = parseCaptureArgs(process.argv.slice(2));
await runRuntimeCapture(opts).then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
