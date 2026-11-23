/** Mutation and preservation contracts for tools recorded in shipped byteLineage. */
export interface PostExportStage {
  readonly mutates: readonly string[];
  readonly preserves: readonly string[];
}

import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { glbGeometryDigest } from "./glb-geometry-digest.js";
import { mintPostExportConsumers } from "./post-export-stage-mint.js";

export const POST_EXPORT_STAGE_REGISTRY: Readonly<Record<string, PostExportStage | undefined>> = {
  "tools/openclinxr/asset-pipeline/makeclothes/apply_actor_hair_colour.py": {
    mutates: ["materials"],
    preserves: ["geometry", "rig", "animations", "images", "procedural-gown-lineage", "teeth-swap-evidence"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/apply_hair_material_maps.py": {
    mutates: ["materials", "textures", "images"],
    preserves: ["geometry", "rig", "animations", "procedural-gown-lineage", "teeth-swap-evidence"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/couple-fitted-teeth-to-lip-viseme.ts": {
    mutates: ["mouth-morphs"],
    preserves: ["procedural-gown-lineage"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/rehide-poking-skin.py": {
    mutates: ["body-primitive-indices", "hidden-skin-indices"],
    preserves: ["vertex-attributes", "morph-targets"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/rehide-aisha-shoulder-skin.py": {
    mutates: ["body-primitive-indices", "hidden-skin-indices"],
    preserves: ["vertex-attributes", "morph-targets"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/sample-grade-poses.ts": {
    mutates: [],
    preserves: ["geometry", "rig", "animations", "images"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/teeth-rest-clearance.ts": {
    mutates: ["teeth-positions"],
    preserves: ["procedural-gown-lineage"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/decimate_teeth.mts": {
    mutates: ["teeth-indices"],
    preserves: ["procedural-gown-lineage", "vertex-attributes", "morph-targets"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/teeth-swap/swap_teeth.py": {
    mutates: ["mouth-geometry", "mouth-materials", "mouth-rig", "mouth-textures"],
    preserves: ["procedural-gown-lineage"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/tongue-forward-place.ts": {
    mutates: ["tongue-positions"],
    preserves: ["procedural-gown-lineage"],
  },
  "tools/openclinxr/asset-pipeline/makeclothes/unhide-neckline-opening.py": {
    mutates: ["body-primitive-indices", "neckline-opening-indices"],
    preserves: ["vertex-attributes", "morph-targets"],
  },
  "tools/openclinxr/evidence/skin-footprint-inpaint/scripts/kevin-collar-s9-chain.py": {
    mutates: ["body-primitive-indices", "skin-image"],
    preserves: ["vertex-attributes", "morph-targets"],
  },
  "tools/openclinxr/evidence/skin-footprint-inpaint/scripts/nurse-vneck-chain.py": {
    mutates: ["body-primitive-indices", "nurse-neckline-indices", "skin-image"],
    preserves: ["vertex-attributes", "morph-targets"],
  },
  "tools/openclinxr/evidence/skin-footprint-inpaint/scripts/nurse-vneck-6tri-unhide.py": {
    mutates: ["body-primitive-indices", "nurse-neckline-indices"],
    preserves: ["vertex-attributes", "morph-targets"],
  },
};

const INTERPRETERS = new Set(["python3", "python", "tsx", "node", "sh", "bash"]);

function scriptReferences(text: string): string[] {
  return text.match(/tools\/[^\s'"`\\$;&|()<>{}=,]+\.(?:py|ts|mts|mjs|js|cjs|sh)(?=$|[\s'"`\\$;&|()<>{}=,])/g) ?? [];
}

function literalShellWord(word: string): string {
  // Strip only one enclosing pair. Keep concatenation and escapes intact.
  return word.match(/^(['"])([^'"\\]*)\1$/)?.[2] ?? word;
}

function commandWords(words: string[], shell = false): string[] {
  const literal = shell ? words.map(literalShellWord) : words;
  let start = 0;
  while (start < words.length) {
    const head = literal[start];
    if (/^[A-Za-z_]\w*=/.test(words[start] ?? "") || head === "env") start += 1;
    else if (head === "mise" && literal[start + 1] === "exec" && literal[start + 2] === "--") start += 3;
    else if (head === "pnpm" && literal[start + 1] === "exec") start += 2;
    else break;
  }
  return literal.slice(start);
}

function simpleShellCommands(shell: string): string[][] | undefined {
  const commands: string[][] = [];
  let index = 0;

  function readCommands(end?: ")" | "`"): boolean {
    let words: string[] = [];
    let word = "";
    let doubleQuoted = false;
    const flushWord = () => {
      if (word) words.push(word);
      word = "";
    };
    const flushCommand = () => {
      flushWord();
      if (words.length) commands.push(words);
      words = [];
    };
    while (index < shell.length) {
      const char = shell.charAt(index);
      if (!doubleQuoted && char === end) {
        flushCommand();
        index += 1;
        return true;
      }
      if (char === "\\") {
        if (index + 1 === shell.length) return false;
        word += shell.slice(index, index + 2);
        index += 2;
        continue;
      }
      if (!doubleQuoted && char === "'") {
        const close = shell.indexOf("'", index + 1);
        if (close < 0) return false;
        word += shell.slice(index, close + 1);
        index = close + 1;
        continue;
      }
      if (char === '"') {
        doubleQuoted = !doubleQuoted;
      } else if (shell.startsWith("$(", index) || char === "`") {
        index += char === "$" ? 2 : 1;
        if (!readCommands(char === "$" ? ")" : "`")) return false;
        word += "$()";
        continue;
      } else if (!doubleQuoted) {
        if (/[;|&\n]/.test(char)) {
          flushCommand();
          index += 1;
          continue;
        }
        if (/\s/.test(char)) {
          flushWord();
          index += 1;
          continue;
        }
        // A literal heredoc body is opaque. Its text cannot supply a stage.
        if (shell.startsWith("<<", index)) {
          const marker = shell.slice(index).match(/^<<[ \t]*(['"]?)([\w-]+)\1[ \t]*\n/);
          if (!marker) return false;
          const bodyStart = index + marker[0].length;
          const close = new RegExp(`^${marker[2]}$`, "gm");
          close.lastIndex = bodyStart;
          const delimiter = close.exec(shell);
          if (!delimiter || scriptReferences(shell.slice(bodyStart, delimiter.index)).length) return false;
          flushCommand();
          index = close.lastIndex;
          continue;
        }
        if (/[()<>]/.test(char) || shell.startsWith("${", index) || (char === "#" && !word)) return false;
      }
      word += char;
      index += 1;
    }
    flushCommand();
    return end === undefined && !doubleQuoted;
  }

  return readCommands() ? commands : undefined;
}

/** Resolve a level only when every script invocation has an exact registry entry. */
export function postExportLevelStages(argv: unknown): PostExportStage[] | undefined {
  if (!Array.isArray(argv) || !argv.every((word) => typeof word === "string")) return undefined;
  const normalized: string[] = argv.map((word: string) => word.replace(/\\\r?\n/g, ""));
  const direct = commandWords(normalized);
  const isShell = direct[0] === "sh" && direct[1] === "-c";
  let commands = [normalized];
  if (isShell) {
    const shell = direct[2];
    if (shell === undefined || direct.slice(3).some((word) => scriptReferences(word).length)) return undefined;
    const parsed = simpleShellCommands(shell);
    if (!parsed) return undefined;
    commands = parsed;
  }

  const credited = new Map<string, PostExportStage>();
  for (const words of commands) {
    const [head, ...args] = commandWords(words, isShell);
    const interpreter = head !== undefined && INTERPRETERS.has(head);
    const operand = interpreter ? args.find((word) => !word.startsWith("-")) : head;
    if (interpreter || (head?.startsWith("tools/") && scriptReferences(head).includes(head))) {
      if (!operand || !Object.hasOwn(POST_EXPORT_STAGE_REGISTRY, operand)) return undefined;
      const stage = POST_EXPORT_STAGE_REGISTRY[operand];
      if (!stage) return undefined;
      credited.set(operand, stage);
    } else if (words.some((word) => scriptReferences(word).length)) {
      // cp, set and other commands without script references are inert.
      return undefined;
    }
  }
  if (normalized.flatMap(scriptReferences).some((tool) => !credited.has(tool))) return undefined;
  return credited.size ? [...credited.values()] : undefined;
}

export function postExportLevelPreserves(argv: unknown, domain: string): boolean {
  return postExportLevelStages(argv)?.every((stage) => stage.preserves.includes(domain)) ?? false;
}

/** Production pin-writer allowlist (FINALIZE-2 C2b: the material-only
 * re-pin writer). finalize fails closed on every LIVE row whose writer is not
 * listed here; listed writers run through their argv templates with
 * row-context placeholders filled, never through env. */
export interface PostExportPinWriter {
  readonly argv: readonly string[];
  readonly glbProducing: boolean;
}

export const POST_EXPORT_PIN_WRITERS: Readonly<Record<string, PostExportPinWriter | undefined>> = {
  "pnpm exec tsx tools/openclinxr/evidence/licence/correct-sidecar-byte-lineage.ts (actor entry and recorded derivationArgv)": {
    argv: [
      "pnpm",
      "exec",
      "tsx",
      "tools/openclinxr/evidence/licence/correct-sidecar-byte-lineage.ts",
      "--repin",
      "--sidecar",
      "{file}",
      "--pre-sha",
      "{pre_sha}",
      "--post",
      "{post}",
    ],
    glbProducing: false,
  },
};

const FROZEN_PIN_WRITER_PATH = "tools/openclinxr/evidence/scene-closure/proofs/sc-06/freeze-case-scene-plan.ts";

/** X3: frozen-plan class rule — frozen only when the writer's INVOKED script
 * (the token after the interpreter, per commandWords) IS exactly the repo
 * path above. Path identity, never the basename: an unrelated path that merely
 * ends in freeze-case-scene-plan.ts does not qualify, nor does the path
 * appearing anywhere else in the string (e.g. as an argument to a
 * lash repacker). */
export function isFrozenPinWriter(writer: unknown): boolean {
  if (typeof writer !== "string") return false;
  const words = commandWords(writer.split(/\s+/).filter((word) => word.length > 0));
  if (!words.length) return false;
  const [head, ...args] = words;
  const invoked =
    head !== undefined && INTERPRETERS.has(head)
      ? args.find((word) => !word.startsWith("-"))
      : head;
  return invoked === FROZEN_PIN_WRITER_PATH;
}

/** Resolve a keep-sha row writer: frozen class, the closed allowlist, else unresolvable. */
export function resolvePinWriter(writer: unknown): { frozen: true } | PostExportPinWriter | undefined {
  if (isFrozenPinWriter(writer)) return { frozen: true };
  if (typeof writer !== "string") return undefined;
  if (!Object.hasOwn(POST_EXPORT_PIN_WRITERS, writer)) return undefined;
  return POST_EXPORT_PIN_WRITERS[writer];
}

/**
 * Shared invoked-tool rule CLI (single copy; R3.2 option A).
 *
 * apply_hair_material_maps.py record mode reaches this rule only through
 * this entry, invoked as `pnpm exec tsx <this-file> '<json>'`. Guarded so
 * importing the module runs nothing.
 *
 * Input must be exactly one mode:
 * - {"argv": [...]} -> {"tool": "<invoked>", "stages": n}; exits NON-ZERO
 *   when the level is unregistered or the input is malformed.
 * - {"digest": ["<glb-path>", ...]} -> {"digests": ["<hex>", ...]} via
 *   glbGeometryDigest; exits NON-ZERO on any read/digest failure.
 * - {"pinWriter": "<writer>"} -> {"frozen": true} for the frozen-plan writer
 *   class, {"argv": [...], "glbProducing": false} for a CLOSED-allowlist
 *   writer, exits NON-ZERO naming the writer otherwise.
 * - {"mint": {"edits": "<path>", ...}} -> inventory re-pins (see
 *   mintPostExportConsumers; refusals r1-r4 exit 2, nothing written).
 * Single key only: both keys, extra keys, non-object input, or wrong element
 * types exit 2.
 *
 * A multi-stage level reports the INTERSECTION of its stages' preserves
 * (never the union): hair maps + teeth swap does not claim geometry.
 */
function registryCliMain(): void {
  let flagRoot: string | undefined;
  let raw: string | undefined = process.argv[2];
  if (raw === "--test-registry") {
    flagRoot = process.argv[3];
    raw = process.argv[4];
  }
  if (raw === undefined) {
    process.stderr.write(
      "usage: tsx post-export-stage-registry.ts [--test-registry <root>] '<{\"argv\": [...]} | {\"digest\": [...]} | {\"pinWriter\": \"<writer>\"} | {\"mint\": {...}}>'\n",
    );
    process.exit(2);
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write("refusing malformed registry CLI input: not JSON\n");
    process.exit(2);
  }
  const malformed: (why: string) => never = (why) => {
    process.stderr.write(`refusing malformed registry CLI input: ${why}\n`);
    process.exit(2);
  };
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    malformed('want exactly one of {"argv": [...]}, {"digest": [...]}, {"pinWriter": "<writer>"}, or {"mint": {...}}');
  }
  const keys = Object.keys(input);
  if (
    keys.length !== 1 ||
    (keys[0] !== "argv" && keys[0] !== "digest" && keys[0] !== "pinWriter" && keys[0] !== "mint")
  ) {
    malformed('want exactly one of {"argv": [...]}, {"digest": [...]}, {"pinWriter": "<writer>"}, or {"mint": {...}}');
  }
  if (keys[0] === "argv") {
    const argv = (input as { argv: unknown }).argv;
    if (!Array.isArray(argv)) malformed("argv must be an array of strings");
    const stages = postExportLevelStages(argv);
    if (stages === undefined) {
      process.stderr.write(`refusing unregistered post-export level: ${raw.slice(0, 300)}\n`);
      process.exit(2);
    }
    // The credited tool names, resolved through the single rule above by
    // object identity (no second copy of the operand logic).
    const tools = Object.keys(POST_EXPORT_STAGE_REGISTRY).filter((key) =>
      stages.includes(POST_EXPORT_STAGE_REGISTRY[key] as PostExportStage),
    );
    // INTERSECTION: a multi-stage level claims only what every stage preserves.
    const [first = [], ...rest] = stages.map((stage) => [...stage.preserves]);
    const preserves = rest.reduce((acc, cur) => acc.filter((domain) => cur.includes(domain)), first).sort();
    process.stdout.write(`${JSON.stringify({ tool: tools.length === 1 ? tools[0] : tools, stages: stages.length, preserves })}\n`);
    return;
  }
  if (keys[0] === "pinWriter") {
    const writer = (input as { pinWriter: unknown }).pinWriter;
    if (typeof writer !== "string" || writer.length === 0) malformed("pinWriter must be a non-empty string");
    const resolved = resolvePinWriter(writer);
    if (resolved === undefined) {
      process.stderr.write(`refusing non-allowlisted pin writer: ${writer.slice(0, 300)}\n`);
      process.exit(2);
    }
    if ("frozen" in resolved) {
      process.stdout.write(`${JSON.stringify({ frozen: true })}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify({ argv: [...resolved.argv], glbProducing: resolved.glbProducing })}\n`);
    return;
  }
  if (keys[0] === "mint") {
    const spec = (input as { mint: unknown }).mint as { edits?: unknown; compact?: unknown; storeRoot?: unknown; testRegistry?: unknown };
    if (typeof spec !== "object" || spec === null || typeof spec.edits !== "string") malformed('mint wants {"edits": "<path>", "compact"?: "<path>", "storeRoot"?: "<path>", "testRegistry"?: "<path>"}');
    for (const k of ["compact", "storeRoot", "testRegistry"] as const) if (spec[k] !== undefined && typeof spec[k] !== "string") malformed(`mint.${k} must be a string path`);
    const editsPath: unknown = spec.edits;
    const compactPath: unknown = spec.compact;
    const storeRoot: unknown = spec.storeRoot;
    const testRegistry: unknown = spec.testRegistry;
    if (typeof editsPath !== "string") malformed("mint.edits must be a string path");
    if ((compactPath !== undefined && typeof compactPath !== "string") || (storeRoot !== undefined && typeof storeRoot !== "string") || (testRegistry !== undefined && typeof testRegistry !== "string")) malformed("mint.compact/storeRoot/testRegistry must be string paths");
    try {
      const arg: { compactPath?: string; storeRoot?: string; editsPath: string; testRoot?: string } = { editsPath: editsPath as string };
      if (flagRoot === undefined) {
        if (compactPath !== undefined || storeRoot !== undefined || testRegistry !== undefined) malformed("mint compact/storeRoot/testRegistry overrides need --test-registry <root>");
      } else {
        let root = "";
        try { root = realpathSync(flagRoot); } catch { root = ""; }
        const cands = [tmpdir(), "/private/tmp"].map((t) => { try { return realpathSync(t); } catch { return ""; } });
        if (root === "" || !cands.some((t) => t !== "" && (root === t || root.startsWith(`${t}/`)))) malformed(`--test-registry outside the tmp fixture root (${flagRoot})`);
        if (testRegistry !== undefined) {
          let tr = "";
          try { tr = realpathSync(testRegistry as string); } catch { tr = ""; }
          if (tr !== root) malformed("mint testRegistry must equal --test-registry <root>");
        }
        if (compactPath !== undefined) arg.compactPath = compactPath as string;
        if (storeRoot !== undefined) arg.storeRoot = storeRoot as string;
        arg.testRoot = root;
      }
      process.stdout.write(`${JSON.stringify({ mint: mintPostExportConsumers(arg) })}\n`);
    } catch (error) {
      const msg = (error as Error).message;
      process.stderr.write(`${msg.startsWith("mint refused") ? msg : `refusing mint failure: ${msg}`}\n`);
      process.exit(2);
    }
    return;
  }
  const digest = (input as { digest: unknown }).digest;
  if (!Array.isArray(digest)) malformed("digest must be an array of strings");
  try {
    const digests = (digest as unknown[]).map((p) => {
      if (typeof p !== "string" || p.length === 0) throw new Error("digest paths must be non-empty strings");
      return glbGeometryDigest(new Uint8Array(readFileSync(p)));
    });
    process.stdout.write(`${JSON.stringify({ digests })}\n`);
    return;
  } catch (error) {
    process.stderr.write(`refusing registry digest failure: ${(error as Error).message}\n`);
    process.exit(2);
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) registryCliMain();
