/**
 * Browser-safe `util` / `node:util` stand-in for the faculty workspace vite build.
 * The production ui-admin bundle currently crashes on `util.promisify` when a
 * workspace dependency is rolled into the browser graph.
 */
export function promisify<T extends (...args: never[]) => unknown>(
  fn: T,
): (...args: unknown[]) => Promise<unknown> {
  return (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      const callback = (error: unknown, result: unknown) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      };
      (fn as (...inner: unknown[]) => void)(...args, callback);
    });
}

export function inherits(ctor: { prototype: object }, superCtor: { prototype: object }): void {
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

const util = { promisify, inherits };
export default util;
