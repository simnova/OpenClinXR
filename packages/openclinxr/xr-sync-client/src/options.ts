/** Options for joining the encounter room. All fields optional and backward compatible. */
export interface ConnectOptions {
  /**
   * Matchmaking options forwarded to joinOrCreate (reaching the room's
   * onCreate). Used by the C2 probe page to provision extra actors; defaults
   * to an empty object, preserving C1 behavior.
   */
  roomOptions?: Record<string, unknown>;
}
