import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type ClaimState = "CODE" | "ROADMAP" | "SHOWN";
export type DisplayState = "SHOWN" | "BUILT" | "BUILT_PENDING" | "ROADMAP";

// PLAN section 7 SLOTS table, in table order.
const section7SlotIds = [
  "hero-poster",
  "K1",
  "P1.2",
  "K2",
  "K3",
  "K4",
  "K6",
  "K7",
  "K5",
  "K9",
  "KD",
  "K12",
  "K13",
  "E2",
  "E3",
  "data",
  "TT",
  "text",
] as const;

type MediaSlot = {
  id?: unknown;
  kind?: unknown;
  state?: unknown;
  ceilingBytes?: unknown;
  files?: unknown;
};

type ClaimSlotRef = {
  slot?: unknown;
};

type Claim = {
  id?: unknown;
  state?: unknown;
  slots?: unknown;
};

export function deriveDisplayState(claimState: ClaimState, slotStates: string[]): DisplayState {
  if (claimState === "ROADMAP") {
    return "ROADMAP";
  }
  if (claimState === "CODE" && slotStates.some((state) => state === "TEXT_ONLY")) {
    return "BUILT_PENDING";
  }
  if (claimState === "SHOWN" && slotStates.every((state) => state === "GRADED")) {
    return "SHOWN";
  }
  return "BUILT";
}

export async function checkMedia(rootDir: string, opts: { strict: boolean }): Promise<string[]> {
  const blockers: string[] = [];

  let mediaSlots: MediaSlot[] = [];
  try {
    const text = await readFile(path.join(rootDir, "docs", "site", "data", "media.json"), "utf8");
    const data = JSON.parse(text) as { slots?: unknown };
    if (Array.isArray(data.slots)) {
      mediaSlots = data.slots as MediaSlot[];
    }
  } catch {
    mediaSlots = [];
  }
  const byId = new Map<string, MediaSlot>();
  for (const slot of mediaSlots) {
    if (typeof slot.id === "string") {
      byId.set(slot.id, slot);
    }
  }

  for (const id of section7SlotIds) {
    if (!byId.has(id)) {
      blockers.push(`media_slot_missing:${id}`);
    }
  }

  for (const slot of mediaSlots) {
    if (typeof slot.id !== "string") {
      continue;
    }
    const files = Array.isArray(slot.files)
      ? slot.files.filter((file): file is string => typeof file === "string")
      : [];
    if (files.length === 0) {
      continue;
    }
    let total = 0;
    for (const file of files) {
      try {
        const info = await stat(path.join(rootDir, "docs", file));
        total += info.size;
      } catch {
        blockers.push(`media_file_missing:${slot.id}:${file}`);
      }
    }
    if (typeof slot.ceilingBytes === "number" && total > slot.ceilingBytes) {
      blockers.push(`media_over_ceiling:${slot.id}:${total}`);
    }
  }

  if (opts.strict) {
    for (const slot of mediaSlots) {
      if (typeof slot.id === "string" && slot.state === "PLACEHOLDER") {
        blockers.push(`media_placeholder_strict:${slot.id}`);
      }
    }
  }

  let claims: Claim[] = [];
  try {
    const text = await readFile(path.join(rootDir, "docs", "site", "data", "claims.json"), "utf8");
    const data = JSON.parse(text) as { claims?: unknown };
    if (Array.isArray(data.claims)) {
      claims = data.claims as Claim[];
    }
  } catch {
    claims = [];
  }

  for (const claim of claims) {
    if (claim.state !== "SHOWN" || typeof claim.id !== "string") {
      continue;
    }
    const refs = Array.isArray(claim.slots) ? (claim.slots as ClaimSlotRef[]) : [];
    for (const ref of refs) {
      if (typeof ref.slot !== "string") {
        continue;
      }
      const target = byId.get(ref.slot);
      if (!target) {
        blockers.push(`media_shown_slot_absent:${claim.id}:${ref.slot}`);
      } else if (target.state === "TEXT_ONLY") {
        blockers.push(`media_shown_text_only:${claim.id}:${ref.slot}`);
      }
    }
  }

  return blockers;
}

async function main(): Promise<void> {
  const strict = process.argv.includes("--strict");
  const blockers = await checkMedia(process.cwd(), { strict });
  if (blockers.length === 0) {
    console.log(
      strict
        ? "Media check passed (strict: no placeholders)."
        : "Media check passed.",
    );
    return;
  }
  for (const blocker of blockers) {
    console.error(blocker);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ? path.resolve(process.argv[1]) : "").href) {
  await main();
}
