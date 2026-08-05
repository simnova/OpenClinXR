# @cellix/provider-contracts

## 1.0.0-openclinxr.0

### Added

- Initial extraction of generic provider + trace contracts into the seedwork tier:
  - `TraceEventSchema` / `TraceEvent` and `validateTraceEvent` (structural + semantic: nonblank
    identifiers, and a `durableEventRef` that must agree with the event identity).
  - `ProviderHealthSchema` / `ProviderHealth` and `validateProviderHealth` (structural + semantic:
    nonblank `providerId`; a `ready` provider must not report blockers).
  - `ProviderAuditRecordSchema` / `ProviderAuditRecord` plus the model/voice aliases, and
    `validateProviderAuditRecord` / `validateModelProviderAudit` / `validateVoiceProviderAudit`
    (structural + semantic: identity and policy fields must be nonblank).

These were previously defined inside a product schema package, which coupled otherwise-generic
gateway packages to product-specific types. Behavior is preserved exactly; the product package
re-exports these symbols so existing consumers are unaffected.
