import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const source = readFileSync(new URL("./ordinary-turn-and-cue-authority.test.ts", import.meta.url), "utf8");
const expected = "de49cdfd73e781bbc6a2f7ea8fc74f5d755175e582a5d1e4918ff7f2b79ca9b5";
if (createHash("sha256").update(source.replaceAll("it.fails(", "it(")).digest("hex") !== expected) throw new Error("factory-regression-assertions-changed");
if (process.argv.includes("--fixed") && source.includes("it.fails(")) throw new Error("factory-regression-not-fixed");
console.log("factory ordinary-turn and cue-authority assertions intact");
