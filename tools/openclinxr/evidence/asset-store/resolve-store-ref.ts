import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const STORE_REF_PREFIX = "store:";

function isStoreRef(value: string): boolean {
  return value.startsWith(STORE_REF_PREFIX);
}

function storeRoot(): string {
  const root = process.env.OPENCLINXR_ASSET_STORE;
  if (!root) {
    throw new Error(
      "resolveStoreRef: refused — no asset store root. Set OPENCLINXR_ASSET_STORE to the directory that holds <sha256>/ directories.",
    );
  }
  return root;
}

function safeBasename(basename: string, ref: string): string {
  if (!basename || basename === "." || basename === ".." || basename.includes("/") || basename.includes("\\")) {
    throw new Error(`resolveStoreRef: refused — ${ref} carries an unsafe basename.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(basename)) {
    throw new Error(`resolveStoreRef: refused — ${ref} carries an unsafe basename.`);
  }
  return basename;
}

export async function resolveStoreRef(
  ref: string,
  options?: { storeRoot?: string },
): Promise<{ filesystemPath: string; sha256: string; basename: string }> {
  if (!isStoreRef(ref)) throw new Error(`resolveStoreRef: not a store reference: ${ref}.`);
  const rest = ref.slice(STORE_REF_PREFIX.length);
  const slash = rest.indexOf("/");
  const sha256 = slash < 0 ? rest : rest.slice(0, slash);
  const basename = slash < 0 ? "" : rest.slice(slash + 1);
  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error(`resolveStoreRef: refused — ${ref} carries a malformed sha256; want 64 lowercase hex.`);
  }
  const root = path.resolve(options?.storeRoot ?? storeRoot());
  const candidate = path.resolve(root, sha256, safeBasename(basename, ref));
  const realRoot = await realpath(root).catch(() => {
    throw new Error(`resolveStoreRef: refused — store root does not exist: ${root}.`);
  });
  let realCandidate: string;
  try {
    realCandidate = await realpath(candidate);
  } catch {
    throw new Error(`resolveStoreRef: refused — ${ref} names no file in the store.`);
  }
  if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`resolveStoreRef: refused — ${ref} escapes the store root.`);
  }
  const info = await stat(realCandidate).catch(() => {
    throw new Error(`resolveStoreRef: refused — ${ref} names no file in the store.`);
  });
  if (!info.isFile()) throw new Error(`resolveStoreRef: refused — ${ref} names no file in the store.`);
  return { filesystemPath: realCandidate, sha256, basename: safeBasename(basename, ref) };
}

export async function readStoreRefBytes(
  ref: string,
  options?: { storeRoot?: string },
): Promise<{ bytes: Buffer; filesystemPath: string; sha256: string }> {
  const resolved = await resolveStoreRef(ref, options);
  const bytes = await readFile(resolved.filesystemPath);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== resolved.sha256) {
    throw new Error(`readStoreRefBytes: refused — ${ref} content hashes to ${actual}, not the referenced sha256.`);
  }
  return { bytes: Buffer.from(bytes), filesystemPath: resolved.filesystemPath, sha256: resolved.sha256 };
}

export async function resolveInputBytes(
  inputPath: string,
  options?: { storeRoot?: string },
): Promise<{ filesystemPath: string; bytes: Buffer; logicalPath: string; fromStore: boolean }> {
  if (!isStoreRef(inputPath)) {
    const bytes = await readFile(inputPath);
    return { filesystemPath: inputPath, bytes: Buffer.from(bytes), logicalPath: inputPath, fromStore: false };
  }
  const stored = await readStoreRefBytes(inputPath, options);
  return { filesystemPath: stored.filesystemPath, bytes: stored.bytes, logicalPath: inputPath, fromStore: true };
}

export function rejectStoreRefForOutput(outputPath: string, role: string): void {
  if (isStoreRef(outputPath)) {
    throw new Error(`${role}: refused — a store reference is an input read address, not an output write target.`);
  }
}
