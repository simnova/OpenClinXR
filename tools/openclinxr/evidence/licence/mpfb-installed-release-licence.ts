import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * What licence does the MPFB release INSTALLED ON THIS MACHINE actually declare?
 *
 * The brief's §6 names this as an open correction: "The repository records an unshipped-build-tool
 * distinction, but its extension row says AGPL-3 while its split-license row says
 * GPL-3.0-or-later. Correct that record against the exact installed release."
 *
 * MEASURED 2026-09-09 against `.../Blender/5.1/extensions/user_default/mpfb`, version 2.0.15:
 * `blender_manifest.toml` declares `license = ["SPDX:GPL-3.0-or-later"]` and nothing else. Three
 * files in the installed tree contain the string AGPL and none of them licenses MPFB: they are the
 * MakeClothes and MakeSkin author-selectable OUTPUT licence dropdowns (`license.json`, whose own
 * description says it "will have no practical effect apart from being included in the written MHCLO
 * file") and the `.mhclo` writer that emits the author's choice.
 *
 * WHY THIS IS A GATE AND NOT A NOTE. The AGPL claim had propagated from one ledger row into the
 * `licenseChain` of every shipped humanoid provenance record. A prose correction fixes the row a
 * reader happens to open; a gate fixes the class.
 *
 * THE EXTENSION LIVES OUTSIDE THE REPO, so the recorded measurement is the artifact and this reads
 * the installed release only when it is present. A machine WITH the extension re-verifies the
 * recorded manifest digest; a machine without it checks the repo's records against the record.
 *
 * claimScope: the licence string the installed MPFB extension declares for itself.
 * notEvidenceFor: the licence of MPFB's bundled assets (CC0 per LICENSE.ASSETS.md, recorded
 * separately), of any third-party pack installed beside it, or of generated output.
 */

export type InstalledMpfbLicence = {
  installedPath: string;
  version: string | null;
  /** Every SPDX entry in the manifest's own `license` array. */
  declaredLicenses: string[];
  manifestSha256: string;
  /** Files under the installed tree containing "AGPL", with why each one does. */
  agplMentions: Array<{ file: string; reason: string }>;
};

/** Where Blender installs a user extension on macOS. Empty when none is installed. */
export function installedMpfbPaths(home = process.env["HOME"] ?? ""): string[] {
  const root = path.join(home, "Library", "Application Support", "Blender");
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const release of readdirSync(root)) {
    const candidate = path.join(root, release, "extensions", "user_default", "mpfb");
    if (existsSync(path.join(candidate, "blender_manifest.toml"))) found.push(candidate);
  }
  return found.sort();
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "__pycache__") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out, depth + 1);
    else out.push(full);
  }
  return out;
}

/**
 * Read the installed extension's own licence declaration.
 *
 * REFUSES a manifest with no `license` array rather than defaulting to anything. A missing
 * declaration is an unknown licence, and the repo's standing rule is that unspecified is a refusal.
 */
export function readInstalledMpfbLicence(installedPath: string): InstalledMpfbLicence {
  const manifestPath = path.join(installedPath, "blender_manifest.toml");
  const manifest = readFileSync(manifestPath, "utf8");
  const licenseBlock = /^license\s*=\s*\[([\s\S]*?)\]/mu.exec(manifest);
  if (!licenseBlock) {
    throw new Error(
      `readInstalledMpfbLicence: ${manifestPath} declares no license array. An absent declaration is an unknown licence, not a permissive one.`,
    );
  }
  // The refusal above already established the capture group is present. Bound to a const so the
  // narrowing is checked rather than asserted, and each match is filtered rather than assumed.
  const licenseList = licenseBlock[1] ?? "";
  const declaredLicenses = [...licenseList.matchAll(/"([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
  const version = /^version\s*=\s*"([^"]+)"/mu.exec(manifest)?.[1] ?? null;

  const agplMentions: Array<{ file: string; reason: string }> = [];
  for (const file of walk(installedPath)) {
    if (!/\.(py|json|toml|md|txt)$/u.test(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.includes("AGPL")) continue;
    const relative = file.slice(installedPath.length + 1);
    // The author-selectable OUTPUT licence for assets the user creates, not MPFB's own licence.
    const isAuthorChoice =
      /create_assets\/.+\/objectproperties\/license\.json$/u.test(relative)
      || /entities\/clothes\/mhclo\.py$/u.test(relative);
    agplMentions.push({
      file: relative,
      reason: isAuthorChoice
        ? "author-selectable output licence for an asset the USER creates; does not license MPFB"
        : "unclassified — read it before trusting this report",
    });
  }

  return {
    installedPath,
    version,
    declaredLicenses,
    manifestSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex"),
    agplMentions,
  };
}
