# Iteration 0001 Memory Update Log

## Agent Memory Updates

Record each durable memory update in this format:

- Agent: `agent-id`
- Entry ID: `entry-id`
- Type: claim, decision, risk, source, question, lesson, or capability
- Topic: short topic label
- Summary: one durable sentence
- Confidence: 0.00 to 1.00
- Source IDs: source IDs or internal artifact IDs
- Status: active, superseded, deferred, resolved, or rejected

## Superseded Entries

List entries that this iteration replaces.

## Shared Memory Index Action

After memory updates are written, run:

```bash
npm run agent:index
```

