/** Mutation and preservation contracts for tools recorded in shipped byteLineage. */
export interface PostExportStage {
  readonly mutates: readonly string[];
  readonly preserves: readonly string[];
}

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
          const close = new RegExp("^" + marker[2] + "$", "gm");
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
