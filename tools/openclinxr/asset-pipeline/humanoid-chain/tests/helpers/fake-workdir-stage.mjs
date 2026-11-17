/**
 * fake-workdir-stage.mjs — a bake-like node stage for run-chain tests.
 * Writes its product under a work dir (never at the final path) so the
 * runner's collectFrom move can be tested.
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
const workfile = val("--workfile");
mkdirSync(dirname(workfile), { recursive: true });
writeFileSync(workfile, Buffer.concat([readFileSync(input), Buffer.from("+W", "utf8")]));
