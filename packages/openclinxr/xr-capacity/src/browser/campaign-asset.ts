/** A decoder cannot be cancelled by the platform. Bound its owner and close any late bitmap. */
export function boundedImageDecode(blob: Blob, signal: AbortSignal, timeoutMs = 1500): Promise<ImageBitmap> {
  const pending = createImageBitmap(blob);
  return boundedOperation(pending, signal, timeoutMs, (late) => late.close());
}
function boundedOperation<T>(pending: Promise<T>, signal: AbortSignal, timeoutMs: number, late?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => fail(new DOMException("Asset work cancelled", "AbortError"));
    const clear = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const fail = (error: Error) => { if (settled) return; settled = true; clear(); reject(error); };
    const timer = setTimeout(() => fail(new Error("Asset operation deadline exceeded")), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    pending.then((value) => { if (settled) { late?.(value); return; } settled = true; clear(); resolve(value); }, (error: unknown) => fail(error instanceof Error ? error : new Error("Asset operation failed")));
    if (signal.aborted) abort();
  });
}
/** Enforce actual transferred bytes while reading, before a decoded allocation is requested. */
export async function readBoundedPng(response: Response, signal: AbortSignal, limit = 2 * 1024 * 1024): Promise<Blob> {
  const declared = Number(response.headers.get("content-length"));
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png") || !Number.isSafeInteger(declared) || declared <= 0 || declared > limit) throw new Error("Invalid or oversized HTTPS PNG fixture");
  const reader = response.body?.getReader(); if (!reader) throw new Error("PNG response has no readable body");
  const chunks: Uint8Array<ArrayBuffer>[] = []; let count = 0; let complete = false;
  try {
    while (true) {
      const next = await boundedOperation(reader.read(), signal, 2000);
      if (next.done) { complete = true; break; }
      count += next.value.byteLength; if (count > limit || count > declared) throw new Error("PNG transfer exceeded byte cap");
      chunks.push(new Uint8Array(next.value));
    }
    if (count !== declared) throw new Error("PNG transfer length mismatch");
    return new Blob(chunks, { type: "image/png" });
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* An aborted platform read may settle later. */ }
  }
}
