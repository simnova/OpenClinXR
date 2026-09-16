import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const path = "packages/openclinxr/xr-humanoid-animation/src/natural-blink-and-emotion.test.ts";
const normalized = readFileSync(path, "utf8").replaceAll("it.fails(", "it(");
const actual = createHash("sha256").update(normalized).digest("hex");
const expected = "0ccf65b186d85fc19058f861fe4098902bf6e11cf44b9d860184c52f55bb32dc";
if (actual !== expected) throw new Error("facial acceptance plant changed beyond expected-failure marker conversion");
console.log("facial acceptance plant assertions and fixture intact");
