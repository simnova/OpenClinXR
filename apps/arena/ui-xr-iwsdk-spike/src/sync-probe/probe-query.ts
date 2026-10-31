/**
 * Validator-only probe query module: parsing ?sync=/flags, nothing else.
 * (Architecture gate: apps/ modules must not mix a parse…/validate…/assert…/is…
 * function with other exports.)
 */

export interface ProbeQuery {
  syncUrl: string;
  useIwer: boolean;
  autostart: boolean;
  /** Quest mode: install the IWER runtime even when a native runtime is present. */
  forceIwer: boolean;
  /** Probe script: "c2" (sweep + select each actor), "c3" (server-driven actor turn), "c6" (phase-gated C3 inside the encounter window), "c7" (C3 script once per station with server rotation), "c8" (c7 loop with pose streaming on + observer badge), "c10" (faculty replay of one recorded station), "c11" (C3 script once + patient-note submits in the note phase), "c12" (review lobby: trigger station-2, watch its replay), "c13" (c12 flow + rubric score submit + return to lobby), "c14" (c13 flow + lobby sign-off finalize), "c15" (C3 script once per blueprint station with server rotation + label panel), or "c16" (cast select + C3 script once per scenario-cast station with server rotation + cast panel). */
  script: "c2" | "c3" | "c6" | "c7" | "c8" | "c10" | "c11" | "c12" | "c13" | "c14" | "c15" | "c16";
  /** C10 faculty replay: the recorded station id to replay (from ?replayStationId=; "" otherwise). */
  replayStationId: string;
}

/** Parse the probe query string. Throws on missing/invalid ?sync=. */
export function parseProbeQuery(search: string): ProbeQuery {
  const params = new URLSearchParams(search);
  const syncUrl = params.get("sync") ?? "";
  if (!/^ws:\/\/127\.0\.0\.1:\d+$/.test(syncUrl) && !/^ws:\/\/localhost:\d+$/.test(syncUrl)) {
    throw new Error(`invalid or missing ?sync= ws url: ${syncUrl.slice(0, 80)}`);
  }
  const scriptParam = params.get("script") ?? "c2";
  if (scriptParam !== "c2" && scriptParam !== "c3" && scriptParam !== "c6" && scriptParam !== "c7" && scriptParam !== "c8" && scriptParam !== "c10" && scriptParam !== "c11" && scriptParam !== "c12" && scriptParam !== "c13" && scriptParam !== "c14" && scriptParam !== "c15" && scriptParam !== "c16") {
    throw new Error(`invalid ?script= value: ${scriptParam.slice(0, 20)}`);
  }
  const replayStationId = params.get("replayStationId") ?? "";
  if (scriptParam === "c10" && replayStationId === "") {
    throw new Error("?script=c10 requires ?replayStationId=<recorded station id>");
  }
  return {
    syncUrl,
    useIwer: params.get("iwer") === "1",
    autostart: params.get("autostart") === "1",
    forceIwer: params.get("forceIwer") === "1",
    script: scriptParam,
    replayStationId,
  };
}

/** ?noteMaxChars= page parameter (the C11 harness mirrors its server config). */
export function parseC11NoteMaxChars(search: string): number {
  const raw = new URLSearchParams(search).get("noteMaxChars") ?? "";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ?noteMaxChars= value: ${raw.slice(0, 20)}`);
  }
  return parsed;
}

/** One C13 rubric entry from the ?rubric= page parameter. */
export interface C13RubricParam {
  id: string;
  label: string;
}

/**
 * ?rubric= page parameter (the C13 harness mirrors its server reviewRubric so
 * the page renders one tile per rubric item). JSON array of { id, label };
 * ids must be unique non-empty strings.
 */
export function parseC13Rubric(search: string): C13RubricParam[] {
  const raw = new URLSearchParams(search).get("rubric") ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid ?rubric= value: not JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("invalid ?rubric= value: non-empty array required");
  }
  const seen = new Set<string>();
  const rubric: C13RubricParam[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("invalid ?rubric= value: each entry needs { id, label }");
    }
    const record = entry as Record<string, unknown>;
    if (typeof record["id"] !== "string" || (record["id"] as string) === "" || typeof record["label"] !== "string") {
      throw new Error("invalid ?rubric= value: each entry needs { id: non-empty string, label: string }");
    }
    const id = record["id"] as string;
    if (seen.has(id)) {
      throw new Error(`invalid ?rubric= value: duplicate id ${id.slice(0, 32)}`);
    }
    seen.add(id);
    rubric.push({ id, label: record["label"] as string });
  }
  return rubric;
}
