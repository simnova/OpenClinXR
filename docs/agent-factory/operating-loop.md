# Operating Loop

The Agent Factory loop is designed to force constructive planning, adversarial improvement, and senior review.

## Loop Sequence

1. **Chief Coordinator creates the brief**
   Defines objective, constraints, activated agents, source artifacts, rubric weights, and expected outputs.

2. **Memory Archivist retrieves context**
   Pulls relevant prior claims, decisions, risks, scores, and source records.

3. **Source Librarian attaches evidence context**
   Separates confirmed facts, reasonable inferences, strategic bets, and unknowns.

4. **Core Design Team produces the plan**
   The constructive team creates `01-core-plan.md`.

5. **Rubric Steward scores the plan**
   Scores are recorded in `02-core-scorecard.json`.

6. **Adversarial Challenge Team attacks the plan**
   The adversarial team must produce a counterplan, not only comments.

7. **Rubric Steward scores the counterplan**
   Scores are recorded in `04-adversarial-scorecard.json`.

8. **Core Design Team revises**
   Valid attacks are incorporated into `05-core-revision.md`.

9. **Senior Leadership reviews**
   Leadership records approval, blocks, revisions, deferrals, and kill criteria in `06-leadership-review.md`.

10. **Final synthesis and memory update**
    The Coordinator writes `07-final-synthesis.md`, and the Archivist updates `08-memory-update-log.md` plus agent memory indexes.

## Plateau Rule

The Coordinator must trigger a capability review when:

- Weighted score changes by less than 0.1 for two consecutive loops.
- The same critical risk appears in three consecutive loops.
- Evidence debt remains unchanged for two consecutive loops.
- Senior Leadership repeats the same rejection reason.

## Capability Review Responses

Allowed responses:

- Activate a specialist agent.
- Add a legal, compliance, physician, or market research work order.
- Add a TypeScript/Node tool that reduces repeated manual work.
- Narrow scope.
- Change rubric weights with recorded approval.

