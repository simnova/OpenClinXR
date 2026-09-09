# Scene closure board manifest

Status: **12 cards created and independently read back through BothyBoard MCP; all Idle/backlog. Implementation not released.**

Project: `prj_9b390b99b443a964`. Documentation contract commit: `c58c298deaa14c56c13d0fedc5bc4a6fd82713fc` (local, not pushed).

| Card | BothyBoard ID | Purpose | Dependencies | Parent |
|---|---|---|---|---|
| SC-P | `tsk_11c49e9be50f2def` | One verified encounter and its website proof | None | None |
| SC-01 | `tsk_a3363150bb1c1a53` | A persisted synthetic encounter determines the room that UI-XR actually loads | None | SC-P |
| SC-02 | `tsk_a9c43fe9a7ac15f7` | Observed requirements control actual API/UI encounter entry and scheduled effects | SC-01 | SC-P |
| SC-04 | `tsk_398d49a9f0b81fc5` | The exact demonstration assets have trustworthy provenance and compatible rights | SC-01 | SC-P |
| SC-00 | `tsk_d8bcdfd8eedc0f94` | Independent controls freeze the measurement rubric before runtime motion is graded | SC-04 | SC-P |
| SC-03 | `tsk_9ac9139e15c31b8f` | The patient remains supported by the exact mounted instance and every slot preserves intent | SC-02, SC-00 | SC-P |
| SC-05 | `tsk_b47d8db4afa6aedb` | The case-selected physician walks to the measured bedside target and stops in UI-XR | SC-03 | SC-P |
| SC-06 | `tsk_4ac83b3532fd73f1` | Frozen scene and motion decisions replay and invalidate through the real consumer | SC-05 | SC-P |
| SC-07 | `tsk_97544b466b805059` | An uninterrupted normal-workflow recording proves the complete encounter and its refusals | SC-06 | SC-P |
| SC-08 | `tsk_8f21790d99c4420b` | The existing website presents a cleared edit of the verified encounter | SC-07 | SC-P |
| SC-09 | `tsk_75864c88cf5db1a0` | Independent acceptance closes the complete encounter and website only on direct evidence | SC-08 | SC-P |
| SC-10 | `tsk_1a0d78262213c815` | A pinned learned-motion candidate receives an honest eligibility and execution assessment | SC-09 | None |

## Verified contract and hold

- Read back every complete objective, dependency list, write scope, project field set and parent association against its create payload.
- All twelve records have status `backlog`, factory `Idle`, no assigned agent, no Grok session and no worktree. SC-P has exactly ten children; SC-10 has no parent.
- The API normalizes the submitted body into a canonical rendering of typed fields. Verified required behavior and counterweights in the full objective, plus scope limits and TREE gates in that worker-facing body. Arbitrary free-form headings are not assumed preserved.
- No claim, planting, dequeue, session mint, implementation worker, product edit or public deployment was performed. Read-only specialist/Grok reviews are preparation work.

Frozen contract hashes:

- acceptance.md SHA-256: `1a9b292a6b3e370a395533073157d41f1f8da70813cdd4330f388d25904bbcc0`
- tasks.md SHA-256: `84e7e0b84ac3a63df917cd6e23adad633398b7ad47d322265d13d8c11c40cb57`

The cards pin these two files at the documentation commit above. This manifest is a receipt, not proof that future behavior is implemented. [Release instructions](./index.md) preserve the explicit execution boundary.
