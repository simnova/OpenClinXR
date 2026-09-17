import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const source = readFileSync(new URL("./ordinary-turn-and-cue-authority.test.ts", import.meta.url), "utf8");
const expected = "43fcc12105868b85a99b4b61d8231cb68097886ca0608a99b6ab0c3af7504227";
if (createHash("sha256").update(source.replaceAll("it.fails(", "it(")).digest("hex") !== expected) throw new Error("factory-regression-assertions-changed");
if (process.argv.includes("--fixed") && source.includes("it.fails(")) throw new Error("factory-regression-not-fixed");
console.log("factory ordinary-turn and cue-authority assertions intact");
