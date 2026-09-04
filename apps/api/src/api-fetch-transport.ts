/**
 * Node-typed fetch input/body contract for the API package.
 *
 * Ambient DOM names `RequestInfo` and `BodyInit` are not in the bun-types + ES2023
 * program. Do not restore them with a DOM lib — that collapses the staged type-error
 * ratchet globally. Keep this boundary local and preserve fetch init-wins semantics.
 */

export type ApiFetchHeaders = Record<string, string> | string[][];

export type ApiFetchBody = string | ArrayBuffer | ArrayBufferView | null;

export type ApiFetchRequestLike = {
  url: string;
  method?: string;
  headers?: ApiFetchHeaders;
  body?: ApiFetchBody;
};

export type ApiFetchInput = string | URL | ApiFetchRequestLike;

export type ApiFetchInit = {
  method?: string;
  headers?: ApiFetchHeaders;
  body?: ApiFetchBody;
};

export type ResolvedApiFetchCall = {
  url: string;
  method: string;
  headers?: ApiFetchHeaders;
  body?: ApiFetchBody;
};

export type ApiFetchDispatcher = (call: ResolvedApiFetchCall) => Promise<Response> | Response;

export type ApiFetchTransport = (input: ApiFetchInput, init?: ApiFetchInit) => Promise<Response>;

export function isApiFetchRequestLike(input: ApiFetchInput): input is ApiFetchRequestLike {
  return typeof input === "object" && input !== null && !(input instanceof URL);
}

export function resolveApiFetchUrl(input: ApiFetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function resolveApiFetchCall(input: ApiFetchInput, init?: ApiFetchInit): ResolvedApiFetchCall {
  const fromRequest = isApiFetchRequestLike(input) ? input : undefined;
  const method = init?.method ?? fromRequest?.method ?? "GET";
  const headers = init?.headers ?? fromRequest?.headers;
  const methodUpper = method.toUpperCase();
  const body =
    init?.body !== undefined
      ? init.body
      : fromRequest && methodUpper !== "GET" && methodUpper !== "HEAD"
        ? fromRequest.body
        : undefined;

  const resolved: ResolvedApiFetchCall = {
    url: resolveApiFetchUrl(input),
    method,
  };
  if (headers !== undefined) {
    resolved.headers = headers;
  }
  if (body !== undefined) {
    resolved.body = body;
  }
  return resolved;
}

export function createApiFetchTransport(dispatch: ApiFetchDispatcher): ApiFetchTransport {
  return async (input, init) => dispatch(resolveApiFetchCall(input, init));
}
