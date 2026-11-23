/**
 * Accessor-digest reader trace: binding-traced MISLABELLED analysis for
 * post-export-stage accessor-digest rows. Higher-order/callback flows
 * (array.map(fn), function values) are NOT traced.
 */
export type { ReaderCompare, ReaderTraceFS, ReaderVerdict } from "./reader-trace/trace.js";
export {
  assessDataRow,
  assessReader,
  assessReaderCompares,
  mapProblem,
  REASON_BYTES,
  REASON_EMPTY_MAP,
  REASON_LANGUAGE,
  REASON_PIN,
  REASON_SIDECAR,
} from "./reader-trace/trace.js";
