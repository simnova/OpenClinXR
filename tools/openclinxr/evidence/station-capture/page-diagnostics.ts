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
  serverErrors: StationCaptureHttpError[];
  clientErrors: StationCaptureHttpError[];
};

export type StationCaptureHttpError = {
  url: string;
  status: number;
  resourceType: string;
  bodyExcerpt: string;
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
  on(
    event: "response",
    listener: (response: {
      url: () => string;
      status: () => number;
      request: () => { resourceType: () => string };
      text: () => Promise<string>;
    }) => void,
  ): unknown;
  url(): string;
};

const MAX_ENTRIES = 8;
const bags = new WeakMap<object, StationCapturePageDiagnostics>();
const serverErrorSubscribers = new WeakMap<
  StationCapturePageDiagnostics,
  Set<(error: StationCaptureHttpError) => void>
>();

function pushCapped(target: string[], value: string): void {
  if (target.length < MAX_ENTRIES) target.push(value);
}

function firstBytes(value: string, byteCount: number): string {
  return new TextDecoder().decode(new TextEncoder().encode(value).slice(0, byteCount));
}

export function stationCapturePageDiagnosticsOf(
  page: object,
): StationCapturePageDiagnostics | undefined {
  return bags.get(page);
}

export function subscribeToStationCaptureServerErrors(
  diagnostics: StationCapturePageDiagnostics,
  listener: (error: StationCaptureHttpError) => void,
): () => void {
  const listeners = serverErrorSubscribers.get(diagnostics) ?? new Set();
  listeners.add(listener);
  serverErrorSubscribers.set(diagnostics, listeners);
  return () => listeners.delete(listener);
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
    serverErrors: [],
    clientErrors: [],
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
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    let pageOrigin: string;
    let responseOrigin: string;
    try {
      pageOrigin = new URL(page.url()).origin;
      responseOrigin = new URL(response.url()).origin;
    } catch {
      return;
    }
    if (pageOrigin !== responseOrigin) return;
    void response.text().catch(() => "").then((body) => {
      const error: StationCaptureHttpError = {
        url: response.url(),
        status,
        resourceType: response.request().resourceType(),
        bodyExcerpt: firstBytes(body, 300),
      };
      if (status >= 500) {
        if (bag.serverErrors.length < MAX_ENTRIES) bag.serverErrors.push(error);
        for (const listener of serverErrorSubscribers.get(bag) ?? []) listener(error);
      } else if (bag.clientErrors.length < MAX_ENTRIES) {
        bag.clientErrors.push(error);
      }
    });
  });
  bags.set(page, bag);
  return bag;
}

function formatHttpError(error: StationCaptureHttpError): string {
  const body = error.bodyExcerpt.length > 0 ? ` ${error.bodyExcerpt}` : "";
  return `HTTP ${error.status} ${error.url} (${error.resourceType})${body}`;
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
    && diagnostics.failedRequests.length === 0
    && diagnostics.serverErrors.length === 0;
  // 4xx rows are appended below but never classify: a same-origin 404 (favicon)
  // is routine and must not mask a page exception or a silent page.
  const classification = diagnostics.serverErrors.length > 0
    ? "server error"
    : diagnostics.pageErrors.length > 0
      ? "page exception"
      : diagnostics.failedRequests.length > 0
        ? "failed request"
        : silent
          ? "unresponsive main thread or silent page"
          : "console output";
  const join = (rows: string[]): string => (rows.length > 0 ? rows.join(" | ") : "(none)");
  const existingOutput = (
    `\npageDiagnostics classification: ${classification}`
    + `\npageErrors: ${join(diagnostics.pageErrors)}`
    + `\nconsole: ${join(diagnostics.consoleMessages)}`
    + `\nfailedRequests: ${join(diagnostics.failedRequests)}`
  );
  const clientErrors = diagnostics.clientErrors.length > 0
    ? `\nclientErrors: ${diagnostics.clientErrors.map(formatHttpError).join(" | ")}`
    : "";
  const serverErrors = diagnostics.serverErrors.length > 0
    ? `\nserverErrors: ${diagnostics.serverErrors.map(formatHttpError).join(" | ")}`
    : "";
  return existingOutput + clientErrors + serverErrors;
}
