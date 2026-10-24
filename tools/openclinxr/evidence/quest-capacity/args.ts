export type Options = Record<string, string | boolean>;

export function parseArguments(argv: string[]): { command: string; options: Options } {
  const command = argv[0] ?? "help";
  const options: Options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!/^--[a-z][a-z-]*$/.test(token)) throw new Error(`Expected an option, received ${token}`);
    const key = token.slice(2);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option --${key}`);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) { options[key] = next; index += 1; }
    else options[key] = true;
  }
  return { command, options };
}

export function allowOptions(options: Options, names: string[]): void {
  for (const key of Object.keys(options)) if (!names.includes(key)) throw new Error(`Unknown option --${key}`);
}

export function stringOption(options: Options, key: string, required = false): string | undefined {
  const value = options[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) throw new Error(`--${key} requires a string value`);
  return value;
}

export function flagOption(options: Options, key: string): boolean {
  const value = options[key];
  if (value !== undefined && value !== true) throw new Error(`--${key} is a flag without a value`);
  return value === true;
}

export function integerOption(options: Options, key: string, fallback: number, min: number, max: number): number {
  const raw = stringOption(options, key);
  const value = raw === undefined ? fallback : /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`--${key} must be an integer in [${min}, ${max}]`);
  return value;
}

export function axisList(options: Options, key: string): string[] {
  const raw = stringOption(options, key);
  if (raw === undefined) return [];
  const values = raw.split(",");
  if (values.length > 16 || values.some((value) => !/^[a-zA-Z][a-zA-Z\d._-]{0,79}$/.test(value)) || new Set(values).size !== values.length) throw new Error(`--${key} requires at most 16 unique comma-separated axis names`);
  return values;
}
