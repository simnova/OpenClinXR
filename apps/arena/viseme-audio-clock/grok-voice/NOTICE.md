# Arena-only trial. Every promotion gate stays false. No production, Quest, or clinical claim.

Grok Voice (xAI via OpenRouter) as a cached actor-turn audio clock: TTS audio is
recorded once to a content-addressed machine cache, STT word timestamps are recorded
once, and every later run replays from cache with no network. Nothing here is wired
into apps/ui-xr or packages. See score-sheet.md for the adopt/reject decision.
