import path from "node:path";

export function parseOutputRoot(argv: string[]): string | undefined {
  const hits = argv.filter((a) => a === "--output-root" || a.startsWith("--output-root="));
  if (hits.length > 1) throw new Error("--output-root: duplicate option refused");
  const hit = hits[0];
  if (hit === undefined) return undefined;
  const eq = hit.indexOf("=");
  const value = eq >= 0 ? hit.slice(eq + 1) : argv[argv.indexOf(hit) + 1];
  if (value === undefined || value === "") throw new Error("--output-root: missing value refused");
  if (!value.startsWith("/")) throw new Error("--output-root: relative root refused");
  return value;
}

export function parseCaptureRunId(argv: string[]): string | null {
  const hits: Array<{ raw: string; value: string | undefined }> = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (a === "--capture-run-id") {
      hits.push({ raw: a, value: argv[i + 1] });
      i += 1;
    } else if (a.startsWith("--capture-run-id=")) {
      hits.push({ raw: a, value: a.slice("--capture-run-id=".length) });
    }
  }
  if (hits.length > 1) throw new Error("--capture-run-id: duplicate option refused");
  const hit = hits[0];
  if (hit === undefined) return null;
  const value = hit.value;
  if (value === undefined || value === "") throw new Error("--capture-run-id: missing value refused");
  if (value.length > 80) throw new Error("--capture-run-id: slug too long refused");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))
    throw new Error("--capture-run-id: slug charset refused");
  if (value.includes("..")) throw new Error("--capture-run-id: traversal refused");
  if (value.includes("/") || value.includes("\\")) throw new Error("--capture-run-id: path separator refused");
  return value;
}

export function resolveOutputPath(root: string | undefined, ...segments: string[]): string {
  const joined = path.join(...segments);
  if (root === undefined) return joined;
  return path.join(root, joined);
}
