import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const path = "packages/openclinxr/xr-humanoid-animation/src/natural-blink-and-emotion.test.ts";
const normalized = readFileSync(path, "utf8").replaceAll("it.fails(", "it(");
const actual = createHash("sha256").update(normalized).digest("hex");
const expected = "37d6065e573ee71b3e50e49777676d14499a1c1e16a108b5335123d791255ec7";
if (actual !== expected) throw new Error("facial acceptance plant changed beyond expected-failure marker conversion");
console.log("facial acceptance plant assertions and fixture intact");
