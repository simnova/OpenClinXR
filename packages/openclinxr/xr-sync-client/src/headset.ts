/**
 * Class-pure headset entrypoint: the names the thin headset client (an app)
 * binds. Package consumers (server tests) keep binding ".".
 *
 * Re-exporting from index would mix "." across consumer classes, which the
 * consumer-contracts gate refuses without an allowlist reason, and the
 * allowlist is frozen. So this subpath exists instead.
 */
export { connect } from "./index.js";
export type {
  EncounterSnapshot,
  IntentKind,
  SyncConnection,
} from "./index.js";
export type { ConnectOptions } from "./options.js";
