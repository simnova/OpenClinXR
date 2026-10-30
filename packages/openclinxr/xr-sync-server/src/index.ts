/**
 * Server-authoritative encounter sync over Colyseus: validated intents in, ack or reject out, state via schema patches.
 *
 * Clients send only intent messages. The room validates each intent, applies
 * it to authoritative schema state, and replies with a named ack or reject.
 * State reaches clients exclusively through Colyseus schema patches.
 */
export { ENCOUNTER_ROOM_NAME } from "./room.js";
export type { AckMessage, IntentKind, IntentMessage, RejectMessage } from "./room.js";
export type { EncounterServer, EncounterServerOptions } from "./server.js";
export { createEncounterServer } from "./server.js";
