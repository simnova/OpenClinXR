import { existsSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { sep, resolve as resolvePath } from "node:path";

const DOCUMENTS = "Documents";

function homeDocumentsRoot() {
  return homedir() + sep + DOCUMENTS;
}

function isUnderRoot(resolved, root) {
  return resolved === root || resolved.startsWith(root + sep);
}

function refusalUnderDocs(p, role) {
  return `refused lip-sync fixture ${role}: ${p} is under $HOME/${DOCUMENTS}`;
}

/** Lexical $HOME/Documents refusal plus the no-follow lstat walk. No existence check. */
export function assertNotUnderHomeDocs(p, role) {
  const resolved = resolvePath(p);
  if (isUnderRoot(resolved, homeDocumentsRoot())) {
    throw new Error(refusalUnderDocs(p, role));
  }
  const parts = resolved.split(sep).filter((segment) => segment.length > 0);
  const prefixes = [sep];
  for (let i = 0; i < parts.length; i += 1) {
    prefixes.push(prefixes[i] + parts[i] + sep);
  }
  for (const prefix of prefixes) {
    const cursor = prefix === sep ? sep : prefix.slice(0, -1);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch {
      break;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`refused lip-sync fixture ${role}: ${p} traverses a symlink at ${cursor}`);
    }
  }
}

export function requireLipSyncFixture(p, role) {
  assertNotUnderHomeDocs(p, role);
  if (!existsSync(p)) {
    throw new Error(`missing lip-sync fixture ${role}: ${p} (store copy pending operator; see HANG-LIPSYNC)`);
  }
  return p;
}
