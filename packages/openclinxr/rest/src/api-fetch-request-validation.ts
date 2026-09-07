/**
 * API fetch request-like validation (moved from apps/api composition root).
 *
 * Validator-only module: the isApiFetchRequestLike predicate plus the
 * ApiFetchInput shape it narrows. Transport helpers stay with the app.
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

export function isApiFetchRequestLike(input: ApiFetchInput): input is ApiFetchRequestLike {
  return typeof input === "object" && input !== null && !(input instanceof URL);
}
