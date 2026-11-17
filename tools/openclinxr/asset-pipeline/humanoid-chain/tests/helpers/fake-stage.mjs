/**
 * fake-stage.mjs — a cp-like node stage for run-chain tests.
 * Copies --input to --output and appends --tag bytes, proving run order.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const val = (flag) => {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) throw new Error(`missing ${flag}`);
  return args[i + 1];
};

const input = val("--input");
const output = val("--output");
const tag = args.includes("--tag") ? val("--tag") : "";
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([readFileSync(input), Buffer.from(tag, "utf8")]));
