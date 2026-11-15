#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function evaluateLayoutGate() {
  const documentElement = document.documentElement;
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
  const cells = [...document.querySelectorAll(".codeline-text")].filter((cell) => cell.getClientRects().length > 0);
  const narrow = [];
  for (const cell of cells) {
    probe.style.font = getComputedStyle(cell).font;
    probe.textContent = "0".repeat(20);
    document.body.appendChild(probe);
    const ch20 = probe.getBoundingClientRect().width;
    probe.remove();
    const width = cell.getBoundingClientRect().width;
    if (width < ch20) {
      narrow.push({
        line: cell.closest("[data-code-line]")?.getAttribute("data-code-line") ?? null,
        width: Math.round(width),
        ch20: Math.round(ch20),
      });
    }
  }
  // overflow-x:auto by design, docs/styles.css:717
  const EXCLUDE = [".site-nav", ".site-nav *", ".metric-table-wrap"];
  const overflow = [...document.querySelectorAll("body *")]
    .filter(
      (element) =>
        element.clientWidth > 0 &&
        element.scrollWidth > element.clientWidth + 1 &&
        !EXCLUDE.some((selector) => element.matches(selector)),
    )
    .map((element) => ({
      el:
        element.tagName.toLowerCase() +
        (element.className ? `.${String(element.className).trim().split(/\s+/u).join(".")}` : ""),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
  return {
    scrollWidth: documentElement.scrollWidth,
    clientWidth: documentElement.clientWidth,
    cells: cells.length,
    narrow,
    overflow,
    exclude: EXCLUDE,
  };
}

function pageUrl(page, port) {
  const relative = page.replace(/^docs\//u, "").replace(/^\/+/, "");
  return `http://127.0.0.1:${port}/${relative}`;
}

export async function runLayoutRenderGate(page, port) {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ channel: "chromium", args: ["--use-angle=metal"] });
  const failures = [];
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      try {
        const browserPage = await context.newPage();
        await browserPage.goto(pageUrl(page, port), { waitUntil: "networkidle" });
        await browserPage.waitForTimeout(1500);
        const gate = await browserPage.evaluate(evaluateLayoutGate);
        console.log(`GATE_EXCLUDE width=${width} ${JSON.stringify(gate.exclude)}`);
        if (gate.scrollWidth > gate.clientWidth) {
          failures.push(
            `HORIZONTAL_SCROLL width=${width} scrollWidth=${gate.scrollWidth} clientWidth=${gate.clientWidth}`,
          );
        }
        if (gate.overflow.length > 0) {
          failures.push(
            `NESTED_OVERFLOW width=${width} count=${gate.overflow.length} first=${JSON.stringify(gate.overflow[0])}`,
          );
        }
        if (gate.cells > 0 && gate.narrow.length > 0) {
          failures.push(
            `CODE_CELL_UNDER_20CH width=${width} count=${gate.narrow.length} first=${JSON.stringify(gate.narrow[0])}`,
          );
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures.length > 0) {
    for (const failure of failures) console.log(`GATE_FAIL ${failure}`);
    return 1;
  }
  console.log(`GATE_PASS page=${page} widths=1280,390`);
  return 0;
}

const isMain = process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [page, port] = process.argv.slice(2);
  if (page == null || port == null || !/^\d+$/u.test(port)) {
    console.error("usage: layout-render-gate.mjs <page> <port>");
    process.exitCode = 2;
  } else {
    process.exitCode = await runLayoutRenderGate(page, Number(port));
  }
}
