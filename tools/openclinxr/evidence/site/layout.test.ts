import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { checkLayout } from "./layout.js";

const expectedNonClaims =
  "Not exam-equivalent. No clinical validity. No validity is claimed for faculty marks or learner readiness. No Quest readiness claim. History-taking and communication only; no physical examination or touch is assessed. Formative practice and case authoring.";

function makeLayoutRoot(pages: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "w1-layout-"));
  mkdirSync(path.join(root, "docs", "site", "partials"), { recursive: true });
  cpSync(
    path.join(process.cwd(), "docs", "site", "partials", "nav.html"),
    path.join(root, "docs", "site", "partials", "nav.html"),
  );
  cpSync(
    path.join(process.cwd(), "docs", "site", "partials", "footer.html"),
    path.join(root, "docs", "site", "partials", "footer.html"),
  );
  for (const [file, html] of Object.entries(pages)) {
    writeFileSync(path.join(root, "docs", file), html);
  }
  return root;
}

function v2Page(options: { nav?: boolean; footer?: boolean; extraHead?: string }): string {
  const nav =
    options.nav === false
      ? ""
      : readFileSync(path.join(process.cwd(), "docs", "site", "partials", "nav.html"), "utf8");
  const footer =
    options.footer === false
      ? ""
      : readFileSync(path.join(process.cwd(), "docs", "site", "partials", "footer.html"), "utf8");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>t</title>${options.extraHead ?? ""}</head>
<body data-site="v2">
${nav}
<p>hello</p>
${footer}
</body>
</html>`;
}

it("negative: a v2 page without the footer gives layout_footer_missing", async () => {
  const root = makeLayoutRoot({ "page.html": v2Page({ footer: false }) });
  const blockers = await checkLayout(root);
  if (!blockers.includes("layout_footer_missing:page.html")) {
    throw new Error(`expected layout_footer_missing, got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a v2 page without the nav gives layout_nav_missing", async () => {
  const root = makeLayoutRoot({ "page.html": v2Page({ nav: false }) });
  const blockers = await checkLayout(root);
  if (!blockers.includes("layout_nav_missing:page.html")) {
    throw new Error(`expected layout_nav_missing, got ${JSON.stringify(blockers)}`);
  }
});

it("negative: a v2 page linking to missing.html gives layout_link_broken", async () => {
  const root = makeLayoutRoot({
    "page.html": v2Page({}).replace("</body>", '<a href="missing.html">gone</a></body>'),
  });
  const blockers = await checkLayout(root);
  if (!blockers.some((blocker) => blocker.startsWith("layout_link_broken:page.html:missing.html"))) {
    throw new Error(`expected layout_link_broken for missing.html, got ${JSON.stringify(blockers)}`);
  }
});

it("known-good: a v2 page with both partials and only existing targets gives []", async () => {
  const root = makeLayoutRoot({ "page.html": v2Page({}), "styles.css": "body { margin: 0; }\n" });
  // The nav/footer partials link to sibling pages, so those targets must exist too.
  for (const file of [
    "index.html",
    "blueprints.html",
    "reference-run.html",
    "evidence.html",
    "progress.html",
    "engineering.html",
    "attribution.html",
  ]) {
    writeFileSync(path.join(root, "docs", file), "<!doctype html><html><body></body></html>");
  }
  const withLink = v2Page({}).replace(
    "</body>",
    '<link rel="stylesheet" href="styles.css"></body>',
  );
  writeFileSync(path.join(root, "docs", "page.html"), withLink);
  expect(await checkLayout(root)).toEqual([]);
});

it("known-good: the real worktree gives [] (no v2 pages yet; old pages are not v2)", async () => {
  expect(await checkLayout(process.cwd())).toEqual([]);
});

it("known-good: a page without data-site=v2 and without footer gives []", async () => {
  const root = makeLayoutRoot({
    "page.html":
      '<!doctype html><html lang="en"><head><title>t</title></head><body><p>old</p></body></html>',
  });
  expect(await checkLayout(root)).toEqual([]);
});

it("counterweight: the text of footer.html p.non-claims equals the S2 sentence exactly", () => {
  const footer = readFileSync(
    path.join(process.cwd(), "docs", "site", "partials", "footer.html"),
    "utf8",
  );
  const match = /<p class="non-claims">([\s\S]*?)<\/p>/.exec(footer);
  if (!match?.[1] || match[1].replace(/\s+/g, " ").trim() !== expectedNonClaims) {
    throw new Error(`non-claims text mismatch, got ${JSON.stringify(match?.[1])}`);
  }
});
