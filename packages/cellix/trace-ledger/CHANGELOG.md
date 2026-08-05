# @cellix/trace-ledger

## 1.0.0-openclinxr.0

### Changed

- Promoted into the seedwork tier. The package is an in-memory, append-only ledger over the generic
  trace-event contract: it appends events and reads them back per run, with no product or domain
  semantics of its own (`eventType`, `tag`, and `payload` are opaque to it).
- Now depends on the generic provider/trace contracts package instead of a product schema package,
  so it can be consumed — or replaced with a durable implementation — independently of any product.

### Notes

- The public surface is unchanged (`InMemoryTraceLedger`); only the package name and its
  dependency direction moved.
