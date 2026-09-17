import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const source = readFileSync(new URL("./ordinary-turn-and-cue-authority.test.ts", import.meta.url), "utf8");
const expected = "fc040dec8d2691b30b64476de6a5c5d803f89d685e2106784c4f4690e470fc18";
if (createHash("sha256").update(source.replaceAll("it.fails(", "it(")).digest("hex") !== expected) throw new Error("factory-regression-assertions-changed");
if (process.argv.includes("--fixed") && source.includes("it.fails(")) throw new Error("factory-regression-not-fixed");
console.log("factory ordinary-turn and cue-authority assertions intact");
