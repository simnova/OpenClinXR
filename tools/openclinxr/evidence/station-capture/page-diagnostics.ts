/**
 * Page-side listeners for the station-environment capture.
 *
 * Eight sibling probes already attach `pageerror`. This module is the shared bag
 * the room capture consults when a 180 s wait times out, so the operator can
 * tell a page exception from a failed request from a silent / unresponsive page.
 */

export type StationCapturePageDiagnostics = {
  pageErrors: string[];
  consoleMessages: string[];
  failedRequests: string[];
};

export type StationCapturePageListenerHost = {
  on(event: "pageerror", listener: (error: Error) => void): unknown;
  on(
    event: "console",
    listener: (message: { type: () => string; text: () => string }) => void,
  ): unknown;
  on(
    event: "requestfailed",
    listener: (request: {
      url: () => string;
      failure: () => { errorText?: string } | null;
    }) => void,
  ): unknown;
};

const MAX_ENTRIES = 8;
const bags = new WeakMap<object, StationCapturePageDiagnostics>();

function pushCapped(target: string[], value: string): void {
  if (target.length < MAX_ENTRIES) target.push(value);
}

export function stationCapturePageDiagnosticsOf(
  page: object,
): StationCapturePageDiagnostics | undefined {
  return bags.get(page);
}

export function attachStationCapturePageDiagnostics(
  page: StationCapturePageListenerHost,
): StationCapturePageDiagnostics {
  const existing = bags.get(page);
  if (existing) return existing;

  const bag: StationCapturePageDiagnostics = {
    pageErrors: [],
    consoleMessages: [],
    failedRequests: [],
  };
  page.on("pageerror", (error) => {
    pushCapped(bag.pageErrors, error instanceof Error ? error.message : String(error));
  });
  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") return;
    pushCapped(bag.consoleMessages, `${type} ${message.text()}`.trim());
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    pushCapped(
      bag.failedRequests,
      `${request.url()} (${failure?.errorText ?? "failed"})`,
    );
  });
  bags.set(page, bag);
  return bag;
}

/**
 * Suffix attached to a named wait timeout. Empty when no bag was collected
 * (the pre-fix path and the existing wait-name tests).
 */
export function formatStationCapturePageDiagnostics(
  diagnostics: StationCapturePageDiagnostics | undefined,
): string {
  if (!diagnostics) return "";
  const silent =
    diagnostics.pageErrors.length === 0
    && diagnostics.consoleMessages.length === 0
    && diagnostics.failedRequests.length === 0;
  const classification = diagnostics.pageErrors.length > 0
    ? "page exception"
    : diagnostics.failedRequests.length > 0
      ? "failed request"
      : silent
        ? "unresponsive main thread or silent page"
        : "console output";
  const join = (rows: string[]): string => (rows.length > 0 ? rows.join(" | ") : "(none)");
  return (
    `\npageDiagnostics classification: ${classification}`
    + `\npageErrors: ${join(diagnostics.pageErrors)}`
    + `\nconsole: ${join(diagnostics.consoleMessages)}`
    + `\nfailedRequests: ${join(diagnostics.failedRequests)}`
  );
}
