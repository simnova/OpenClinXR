import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const source = readFileSync(new URL("./ordinary-turn-and-cue-authority.test.ts", import.meta.url), "utf8");
const expected = "847ce90c6e17bea37beb27b7b9bea54066b2b9c3b206f268260ee86d1da10823";
if (createHash("sha256").update(source.replaceAll("it.fails(", "it(")).digest("hex") !== expected) throw new Error("factory-regression-assertions-changed");
if (process.argv.includes("--fixed") && source.includes("it.fails(")) throw new Error("factory-regression-not-fixed");
console.log("factory ordinary-turn and cue-authority assertions intact");
