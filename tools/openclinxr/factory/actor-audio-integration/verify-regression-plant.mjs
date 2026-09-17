import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const source = readFileSync(new URL("./ordinary-turn-and-cue-authority.test.ts", import.meta.url), "utf8");
const expected = "8acb2eab13248a3baf8410a6bdd415d33887d1726e29550437df64db29c20495";
if (createHash("sha256").update(source.replaceAll("it.fails(", "it(")).digest("hex") !== expected) throw new Error("factory-regression-assertions-changed");
if (process.argv.includes("--fixed") && source.includes("it.fails(")) throw new Error("factory-regression-not-fixed");
console.log("factory ordinary-turn and cue-authority assertions intact");
