import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseDiagnosticsFromTimeoutMessage,
  PREDICATE_ERROR_CLASS,
  RENDER_CAUSE_REPORT_REL,
  TIMEOUT_CLASSES,
} from "./classify-one-render.js";

/**
 * OBSERVABLE: render 0 of 15 is a bare Playwright timeout. The diagnostic bag
 * now classifies page exception vs failed request vs silent page, but that bag
 * has not been pointed at a real case.
 *
 * This file asserts the one-case report names a closed-vocab class. It does not
 * re-run the capture (duration is a wait-budget, out of scope).
 *
 * IMMUTABLE diagnosis. Flip `it.fails` -> `it` and append a `## FIXED` block.
 */

const REPORT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
  RENDER_CAUSE_REPORT_REL,
);

describe("the one-case render cause is classified", () => {
  it("(0) VACUITY GUARD: the parser distinguishes the three timeout classes", () => {
    const exception = parseDiagnosticsFromTimeoutMessage(
      "station shell wait timed out: page.waitForFunction: Timeout 180000ms exceeded.\n"
        + "pageDiagnostics classification: page exception\n"
        + "pageErrors: TypeError: x is not a function\n"
        + "console: (none)\n"
        + "failedRequests: (none)",
    );
    const request = parseDiagnosticsFromTimeoutMessage(
      "humanoid assets wait timed out: page.waitForFunction: Timeout 180000ms exceeded.\n"
        + "pageDiagnostics classification: failed request\n"
        + "pageErrors: (none)\n"
        + "console: (none)\n"
        + "failedRequests: http://127.0.0.1/patient.glb (net::ERR_FAILED)",
    );
    const silent = parseDiagnosticsFromTimeoutMessage(
      "station shell wait timed out: page.waitForFunction: Timeout 180000ms exceeded.\n"
        + "pageDiagnostics classification: unresponsive main thread or silent page\n"
        + "pageErrors: (none)\n"
        + "console: (none)\n"
        + "failedRequests: (none)",
    );
    expect(exception.classification).toBe("page exception");
    expect(request.classification).toBe("failed request");
    expect(silent.classification).toBe("unresponsive main thread or silent page");
    expect(exception.classification).not.toBe(request.classification);
    expect(exception.classification).not.toBe(silent.classification);
    expect(request.classification).not.toBe(silent.classification);
    expect(exception.waitName).toBe("station shell");
    expect(request.waitName).toBe("humanoid assets");

    const predicate = parseDiagnosticsFromTimeoutMessage(
      "page.waitForFunction: ReferenceError: browserPageWindow is not defined",
    );
    expect(predicate.classification).toBe(PREDICATE_ERROR_CLASS);
    expect(predicate.classification, "predicate error collapsed into a timeout class")
      .not.toBe("page exception");
  });

  it("(1) the one-case report exists, is ≥400 bytes, and names a closed-vocab class", () => {
    expect(existsSync(REPORT_PATH), `missing ${RENDER_CAUSE_REPORT_REL}`).toBe(true);
    const bytes = statSync(REPORT_PATH).size;
    expect(bytes, `${RENDER_CAUSE_REPORT_REL} is ${bytes} bytes`).toBeGreaterThanOrEqual(400);
    const body = readFileSync(REPORT_PATH, "utf8");
    expect(body, "report does not name the ED case").toContain("ed_chest_pain_priority_v2");
    const classLine = body.match(/^- classification: (.+)$/m);
    expect(classLine, "no classification: line").not.toBeNull();
    const named = classLine?.[1]?.trim() ?? "";
    const allowed = [...TIMEOUT_CLASSES, PREDICATE_ERROR_CLASS, "did not stop"];
    expect(allowed, `classification ${named} is not in the closed vocab`).toContain(named);
    expect(named, "unclassified is a skipped run, not a class").not.toBe("unclassified");
    expect(body, "report dropped CLAIM").toMatch(/^CLAIM:/m);
    expect(body, "report dropped NOT TESTED").toMatch(/^NOT TESTED:/m);
  });
});
