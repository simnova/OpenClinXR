/**
 * Render docs/openclinxr/third-party-asset-licence-ledger.md from per-asset
 * records in docs/openclinxr/asset-licence-records/ plus the checked-in
 * pre-migration fixture for the hand-written preamble (lines 1-72).
 *
 * Same fail-closed shape as tools/agent-factory/build-doc-authority-registry.ts:
 * the ledger is a record — regeneration may add and update rows; any removal
 * requires an explicit opt-in, and a removal whose record file still exists on
 * disk is refused even with the flag.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  decideRegistryShrink,
  loadRegisteredPaths,
  parseAllowShrink,
  worktreeNote,
} from "../agent-factory/registry-shrink-guard.ts";

const defaultRoot = process.cwd();
const RECORDS_DIR = "docs/openclinxr/asset-licence-records";
/**
 * The ledger's standing rules and title, rendered ahead of every generated section. It was a
 * 72-line slice off a COPY of the pre-migration ledger, which meant the preamble drifted from
 * the rules the moment either file moved a line. It is now its own template, and the only
 * remaining reference to the old ledger is the blob sha pinned in
 * the-licence-ledger-migration-lost-nothing.test.ts.
 */
const PREAMBLE_TEMPLATE = "tools/openclinxr/asset-licence-ledger-rules-header.md";
const OUTPUT_JSON = "docs/openclinxr/third-party-asset-licence-ledger.json";
const OUTPUT_MD = "docs/openclinxr/third-party-asset-licence-ledger.md";
const REGISTRY_LABEL = "licence-ledger";

export type LicenceRowRecord = {
  id: string;
  section: string;
  rowIndex: number;
  cells: string[];
  expectedCells?: number;
  note?: string;
};

export type LicenceProseRecord = {
  id: string;
  section: string;
  kind: "prose-block";
  body: string[];
};

export type LicenceRecord = LicenceRowRecord | LicenceProseRecord;

export function isRowRecord(record: LicenceRecord): record is LicenceRowRecord {
  return !("kind" in record);
}

export type BuildLicenceLedgerOptions = {
  cwd?: string;
  allowShrink?: boolean;
  /** Capture stderr-style messages (tests); defaults to console.error. */
  logError?: (message: string) => void;
};

export type BuildLicenceLedgerResult = {
  ok: boolean;
  exitCode: number;
  wrote: boolean;
  removedPaths: string[];
  stderr: string;
  outputJson: string;
  outputMd: string;
  total: number;
  counts: Record<string, number>;
};

export function loadLicenceRecords(cwd: string): LicenceRecord[] {
  const dir = path.resolve(cwd, RECORDS_DIR);
  if (!existsSync(dir)) return [];
  const records: LicenceRecord[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const raw = readFileSync(path.join(dir, name), "utf8");
    records.push(JSON.parse(raw) as LicenceRecord);
  }
  return records;
}

function sortRecords(records: LicenceRecord[]): LicenceRecord[] {
  const rank = (id: string): [number, number, string] => {
    const row = id.match(/^row-(\d+)-/);
    if (row) return [0, Number(row[1]), id];
    return [1, 0, id];
  };
  return [...records].sort((a, b) => {
    const ra = rank(a.id);
    const rb = rank(b.id);
    if (ra[0] !== rb[0]) return ra[0] - rb[0];
    if (ra[1] !== rb[1]) return ra[1] - rb[1];
    return ra[2] < rb[2] ? -1 : ra[2] > rb[2] ? 1 : 0;
  });
}

/**
 * Render one ledger section from its records. Row sections emit a markdown
 * table with the section's own header; prose sections emit their stored lines
 * verbatim. Odd-cell rows render from `cells` joined with " | " so no text is
 * lost even when a row has fewer or more cells than its header.
 */
export function renderSection(title: string, records: LicenceRecord[]): string {
  const out: string[] = [`## ${title}`, ""];
  const rows = sortRecords(records.filter(isRowRecord)).filter(
    (r): r is LicenceRowRecord => isRowRecord(r),
  );
  const prose = records.filter((r): r is LicenceProseRecord => !isRowRecord(r));

  // CORRECTION 2026-08-25 interleaves essay/table/essay: pre-table prose
  // (prose-9), then the 3-row comparison table (Obj-agpl-correction-table
  // rows), then post-table prose (prose-10). Render in that order and skip
  // the generic postamble (its text is prose-10 already). All other sections
  // keep rows-then-prose order.
  const isCorrection = title.startsWith("CORRECTION 2026-08-25");
  const correctionPre = isCorrection
    ? prose.filter(
        (b) => b.id === "prose-9-obj-agpl-correction" && b.section === "Obj-agpl-correction",
      )
    : [];
  const correctionPost = isCorrection
    ? prose.filter((b) => b.id === "prose-10-obj-agpl-correction-post")
    : [];
  const otherProse = isCorrection
    ? prose.filter(
        (b) => b.id !== "prose-9-obj-agpl-correction" && b.id !== "prose-10-obj-agpl-correction-post",
      )
    : prose;

  for (const block of correctionPre) out.push(...block.body);
  if (rows.length > 0) {
    const header = headerFor(title);
    if (header.preamble.length > 0) out.push(...header.preamble, "");
    if (header.columns !== "") out.push(header.columns, header.separator);
    for (const row of rows) out.push(`|${row.cells.join(" | ")}|`);
    out.push("");
    if (!isCorrection && header.postamble.length > 0) out.push(...header.postamble, "");
  }
  for (const block of [...correctionPost, ...otherProse]) {
    out.push(...block.body);
  }
  // renderSection leaves NO trailing blank; the assembly join supplies the
  // single blank between sections. The fixture carries a double blank after
  // exactly five spots (bank-promote tail, graded-sleeping tail, tool-fact
  // tail, correction pre-table and post-table junction tails), so every
  // section ends with its own blank here and the join adds the second.
  out.push("");
  return `${out.join("\n").replace(/\n$/, "")}\n`;
}

type SectionHeader = {
  columns: string;
  separator: string;
  preamble: string[];
  postamble: string[];
};

function headerFor(title: string): SectionHeader {
  if (title === "Acquired") {
    return {
      columns: "| source | licence | what | acquired | consumed by | replacement posture |",
      separator: "|---|---|---|---|---|---|",
      preamble: [],
      postamble: [],
    };
  }
  if (title.startsWith("Refused —")) {
    return {
      columns: "| source | why refused | date |",
      separator: "|---|---|---|",
      preamble: [],
      postamble: [],
    };
  }
  if (title.startsWith("Sketchfab equipment bank promote")) {
    // The hand-written subsection carries data rows with NO header and NO
    // separator of its own; it inherits the Refused table context visually.
    // Emit rows only, so the bytes match the fixture.
    return {
      columns: "",
      separator: "",
      preamble: [],
      postamble: [],
    };
  }
  if (title.startsWith("Equipment candidates")) {
    return {
      columns: "| source | licence (status) | subject | next action |",
      separator: "|---|---|---|---|",
      preamble: [
        "Full table + poly counts: `docs/openclinxr/equipment-oss-candidates.md`. MADR 0054 lane-1 bank path; acquire only after licence-tab re-verify for INFERRED rows.",
      ],
      postamble: [
        "**Structural note:** no CC0 ward bed / IV pole / crash cart pack found. External equipment path is CC-BY + attribution (same as scrub-shirt), or stay thin_parametric (lane 2).",
      ],
    };
  }
  if (title.startsWith("Licence uncertainties")) {
    return {
      columns: "| item | uncertainty | why it matters |",
      separator: "|---|---|---|",
      preamble: [],
      postamble: [],
    };
  }
  if (title.startsWith("Cleared but NOT acquired")) {
    return {
      columns: "| resource | licence, verified at source | verdict |",
      separator: "|---|---|---|",
      preamble: [],
      postamble: [],
    };
  }
  if (title.startsWith("Superseded")) {
    return {
      columns: "| resource | earlier verdict (superseded) | why superseded |",
      separator: "|---|---|---|",
      preamble: [],
      postamble: [
        "**Cleared is not acquired.** Nothing from CMUdict is in the tree. #375 is the consuming slice and is",
        "deliberately un-operationalized pending its extraction question; this entry removes only the licence",
        "half of that blocker.",
        "",
        "**Method note:** verified by fetching the LICENSE file itself, not a summary page or a package-manager",
        "badge. §PROTO_CURIOUS_RESEARCHER: unspecified is a refusal, so a second-hand claim would not have",
        "cleared it.",
      ],
    };
  }
  if (title.startsWith("CORRECTION 2026-08-25")) {
    // Pre-table essay lives in prose-9; the header carries only columns.
    return {
      columns: "| source | `culturalibre_male_boots` | `cortu_cargo_pants` |",
      separator: "|---|---|---|",
      preamble: [],
      postamble: [
        "Both pack pages list every asset with an explicit per-asset licence column, and neither page mentions",
        "AGPL anywhere. shoes01 is CC0 across all 23 entries; pants01 is CC0 across all 4.",
        "",
        "**RULING: the `.mhclo` is the asset descriptor MakeClothes authors, and the pack page is the",
        "publisher's per-asset record. Where those two agree, a boilerplate line in the `.obj` deferring to a",
        "dead external-tools page does not override them.** `cortu_cargo_pants` and `culturalibre_male_boots`",
        "are **CC0 and cleared**, which also clears them for the six cast actors already wearing them.",
        "",
        "**WHAT THIS DOES NOT REVERSE.** The `skins01`/`skins02` refusals stand and are a different shape: those",
        "carry `# This file is licensed AGPLv3` as an explicit per-file statement in the asset's OWN `.mhmat`",
        "descriptor, not boilerplate in a mesh, and 21 of 23 carry no licence line at all. The rule that",
        "*unspecified is a refusal* is unchanged. So is the `#497` finding that a page alone cannot clear a",
        "file — what clears these two is the DESCRIPTOR agreeing with the page, not the page by itself.",
        "",
        "**Precedence for future intake, in order:**",
        "1. the asset's own descriptor (`.mhclo` / `.mhmat`) — the author's declaration",
        "2. the publisher's per-asset pack page",
        "3. a mesh-header line — only when it is asset-specific, never when it is template boilerplate",
        "   deferring to an external-tools document",
        "",
        "Silence anywhere still refuses. Two sources disagreeing still refuses unless one is demonstrably",
        "boilerplate, as here.",
      ],
    };
  }
  return { columns: "", separator: "", preamble: [], postamble: [] };
}

const SECTION_ORDER: Array<{ match: (title: string) => boolean; records: string }> = [
  { match: (t) => t === "Acquired", records: "Acquired" },
  { match: (t) => t.startsWith("Refused —"), records: "Refused" },
  { match: (t) => t.startsWith("Sketchfab equipment bank promote"), records: "Bank-promote" },
  { match: (t) => t.startsWith("Equipment candidates"), records: "Equipment-candidates" },
  { match: (t) => t.startsWith("Licence uncertainties"), records: "Licence-uncertainties" },
  { match: (t) => t.startsWith("Cleared but NOT acquired"), records: "Cleared-not-acquired" },
  { match: (t) => t.startsWith("Superseded"), records: "Superseded" },
  { match: (t) => t.startsWith("Open questions"), records: "Open-questions" },
  { match: (t) => t.startsWith("NOT FOUND"), records: "Not-found" },
  { match: (t) => t.startsWith("Not tested"), records: "Not-tested" },
  { match: (t) => t.startsWith("REFUSED — Animato"), records: "Refused-animato" },
  { match: (t) => t.startsWith("GRADED 2026-08-21 — Mesh2Motion"), records: "Graded-sleeping" },
  { match: (t) => t.startsWith("CORRECTION 2026-08-21"), records: "Correction-sleeping-mechanism" },
  { match: (t) => t.startsWith("GRADED 2026-08-21 — the seated"), records: "Graded-seated" },
  { match: (t) => t.startsWith("TOOL FACT"), records: "Tool-fact-retarget" },
  { match: (t) => t.startsWith("CORRECTION 2026-08-25"), records: "__correction__" },
];

/** Titles in ledger order; the ### bank-promote subsection keeps its heading. */
export function sectionTitles(): string[] {
  return [
    "Acquired",
    "Refused — do not re-litigate without new information",
    "### Sketchfab equipment bank promote (2026-08-12)",
    "Equipment candidates (NOT acquired — staging only, 2026-08-12)",
    "Licence uncertainties surfaced 2026-08-11 (researcher; NOT resolved)",
    "Cleared but NOT acquired — G2P pronunciation data (2026-08-13, #375)",
    "Superseded rows",
    "Open questions",
    "NOT FOUND — searched, absent, do not re-file as a bake",
    "Not tested / not claimed",
    "REFUSED — Animato (`github.com/otdnnc/Animato`), 2026-08-21",
    "GRADED 2026-08-21 — Mesh2Motion `Sleeping` is NOT side-sleep; back-vs-front NOT DETERMINED",
    "CORRECTION 2026-08-21 — my `Sleeping` mechanism was wrong; the verdict survives on other evidence",
    "GRADED 2026-08-21 — the seated clips are genuinely seated, and two of them are identical at frame 0",
    "TOOL FACT 2026-08-21 - retarget_bvh already ingests glTF; there is NO format bridge to build",
    "CORRECTION 2026-08-25 — `.obj` AGPL3 boilerplate is NOT the asset licence; two refusals reversed",
  ];
}

function bySection(records: LicenceRecord[], key: string): LicenceRecord[] {
  return records.filter((r) => r.section === key);
}

/**
 * Build and (when allowed) write the licence ledger pair.
 *
 * The preamble (title + rules, lines 1-72 of the fixture) is static
 * hand-written policy prose; only the sections below it are generated.
 */
export function buildLicenceLedger(
  cwdOrOptions: string | BuildLicenceLedgerOptions = {},
): BuildLicenceLedgerResult {
  const options: BuildLicenceLedgerOptions =
    typeof cwdOrOptions === "string" ? { cwd: cwdOrOptions } : cwdOrOptions;
  const cwd = options.cwd ?? defaultRoot;
  const allowShrink = options.allowShrink ?? parseAllowShrink();
  const logError = options.logError ?? ((message: string) => console.error(message));

  const stderrParts: string[] = [];
  const note = worktreeNote(cwd);
  if (note) {
    stderrParts.push(note);
    logError(note);
  }

  const records = loadLicenceRecords(cwd);
  const counts = records.reduce<Record<string, number>>((acc, record) => {
    acc[record.section] = (acc[record.section] ?? 0) + 1;
    return acc;
  }, {});

  const previousPaths = loadRegisteredPaths(path.resolve(cwd, OUTPUT_JSON));
  const nextPaths = records
    .map((record) => `${RECORDS_DIR}/${record.id}.json`)
    .sort();
  const decision = decideRegistryShrink({
    registryLabel: REGISTRY_LABEL,
    previousPaths,
    nextPaths,
    allowShrink,
    pathExists: (registeredPath) => existsSync(path.resolve(cwd, registeredPath)),
  });

  if (decision.message) {
    stderrParts.push(decision.message);
    logError(decision.message);
  }

  if (!decision.allowWrite) {
    return {
      ok: false,
      exitCode: 2,
      wrote: false,
      removedPaths: decision.removedPaths,
      stderr: stderrParts.join("\n"),
      outputJson: OUTPUT_JSON,
      outputMd: OUTPUT_MD,
      total: records.length,
      counts,
    };
  }

  const preamble = readFileSync(path.resolve(cwd, PREAMBLE_TEMPLATE), "utf8").replace(/\n$/u, "");

  // Sections are joined with a blank line. renderSection leaves every
  // section WITHOUT a trailing blank; the join supplies exactly one.
  // The ### bank-promote subsection is NOT a standalone section: strip the
  // parent Refused section's trailing blank, then append heading + rows.
  const parts: string[] = [preamble];
  for (const title of sectionTitles()) {
    if (title.startsWith("### ")) {
      const body = renderSection(title.replace(/^###\s+/, ""), bySection(records, "Bank-promote"))
        .replace(/^## .*\n\n/, "")
        .replace(/\n$/, "");
      const prev = (parts.pop() ?? "").replace(/\n$/, "");
      parts.push(`${prev}\n\n${title}\n\n${body}`);
      continue;
    }
    const entry = SECTION_ORDER.find((e) => e.match(title));
    const key = entry ? entry.records : "";
    if (key === "__correction__") {
      parts.push(
        renderSection(title, [
          ...bySection(records, "Obj-agpl-correction"),
          ...bySection(records, "Obj-agpl-correction-table"),
        ]),
      );
      continue;
    }
    parts.push(renderSection(title, key ? bySection(records, key) : []));
  }
  const md = `${parts.join("\n").trimEnd()}\n`;

  const registry = {
    schemaVersion: "2026-09-08",
    claimBoundary:
      "third-party asset licence record for agentic navigation only; not product, clinical, Quest, scoring, or production readiness evidence",
    protectedRule:
      "A refusal that vanishes gets re-litigated and the asset gets acquired: regeneration may add and update rows; removal requires an explicit opt-in, and a removal whose record still exists is refused even with the flag.",
    usageRule:
      "Two workers recording two different assets must never touch the same file: add one record per asset, then regenerate.",
    counts,
    entries: sortRecords(records).map((record) => record.id),
  };

  mkdirSync(path.dirname(path.resolve(cwd, OUTPUT_JSON)), { recursive: true });
  writeFileSync(path.resolve(cwd, OUTPUT_JSON), `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(path.resolve(cwd, OUTPUT_MD), md);

  return {
    ok: true,
    exitCode: 0,
    wrote: true,
    removedPaths: decision.removedPaths,
    stderr: stderrParts.join("\n"),
    outputJson: OUTPUT_JSON,
    outputMd: OUTPUT_MD,
    total: records.length,
    counts,
  };
}

async function main(): Promise<void> {
  const result = buildLicenceLedger({ allowShrink: parseAllowShrink() });
  if (!result.ok) {
    process.exitCode = result.exitCode;
    return;
  }
  console.log(
    JSON.stringify(
      {
        outputJson: result.outputJson,
        outputMd: result.outputMd,
        total: result.total,
        counts: result.counts,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
