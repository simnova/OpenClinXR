import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const navPartialPath = ["docs", "site", "partials", "nav.html"];
const footerPartialPath = ["docs", "site", "partials", "footer.html"];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isV2Page(html: string): boolean {
  return /<body\b[^>]*\bdata-site\s*=\s*("v2"|'v2'|v2)[\s>]/i.test(html);
}

function isSkippedRef(ref: string): boolean {
  const target = ref.trim();
  if (target === "") {
    return true;
  }
  if (target.startsWith("#") || target.startsWith("//")) {
    return true;
  }
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target);
}

function stripQueryAndFragment(ref: string): string {
  return ref.trim().split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "";
}

async function fileExists(pathname: string): Promise<boolean> {
  try {
    const info = await stat(pathname);
    return info.isFile();
  } catch {
    return false;
  }
}

export async function checkLayout(rootDir: string): Promise<string[]> {
  const blockers: string[] = [];

  const navText = await readFile(path.join(rootDir, ...navPartialPath), "utf8").catch(
    () => undefined,
  );
  const footerText = await readFile(path.join(rootDir, ...footerPartialPath), "utf8").catch(
    () => undefined,
  );
  if (navText === undefined) {
    blockers.push("layout_partial_missing:nav.html");
  }
  if (footerText === undefined) {
    blockers.push("layout_partial_missing:footer.html");
  }
  const collapsedNav = navText === undefined ? undefined : collapseWhitespace(navText);
  const collapsedFooter = footerText === undefined ? undefined : collapseWhitespace(footerText);

  const docsDir = path.join(rootDir, "docs");
  const entries = await readdir(docsDir, { withFileTypes: true }).catch(() => []);
  const pages = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name)
    .sort();

  for (const page of pages) {
    const html = await readFile(path.join(docsDir, page), "utf8").catch(() => undefined);
    if (html === undefined || !isV2Page(html)) {
      continue;
    }
    const collapsedPage = collapseWhitespace(html);
    if (collapsedNav === undefined || !collapsedPage.includes(collapsedNav)) {
      blockers.push(`layout_nav_missing:${page}`);
    }
    if (collapsedFooter === undefined || !collapsedPage.includes(collapsedFooter)) {
      blockers.push(`layout_footer_missing:${page}`);
    }

    const refPattern = /(?:href|src)\s*=\s*"([^"]*)"|(?:href|src)\s*=\s*'([^']*)'/gi;
    let match: RegExpExecArray | null = refPattern.exec(html);
    while (match !== null) {
      const raw = (match[1] ?? match[2] ?? "").trim();
      if (!isSkippedRef(raw)) {
        const cleaned = stripQueryAndFragment(raw);
        const relative = cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
        const target = path.join(docsDir, relative);
        if (!(await fileExists(target))) {
          blockers.push(`layout_link_broken:${page}:${raw}`);
        }
      }
      match = refPattern.exec(html);
    }
  }

  return blockers;
}
