# OpenClinXR Agent Factory

This directory is the operating manual for the OpenClinXR Agent Factory: a repo-native multi-agent planning system that improves the OpenClinXR system design without building the product itself.

The factory has four layers:

1. **Coordinator and Archivist Layer**: manages loops, memory, sources, scorecards, and synthesis.
2. **Core Design Team**: creates the constructive solution plan.
3. **Adversarial Challenge Team**: attacks the plan and produces a stronger counterplan.
4. **Senior Leadership Team**: approves, blocks, or sends the plan back for revision.

Specialty physicians, legal counsel, compliance counsel, and IP/open-source counsel are first-class participants. They receive persistent memory and can block approval when their risk domain is unresolved.

## Operating Rule

The factory is for planning and design maturity. It must not generate OpenClinXR product implementation code unless a separate implementation plan is reviewed and approved.

## Standard Workflow

1. Create an iteration brief in `iterations/iteration-XXXX/00-brief.md`.
2. Retrieve relevant memory from `agents/**/index.json` and `.agent-factory/memory-index.json`.
3. Produce `01-core-plan.md`.
4. Score the core plan in `02-core-scorecard.json`.
5. Produce `03-adversarial-counterplan.md`.
6. Score the counterplan in `04-adversarial-scorecard.json`.
7. Produce `05-core-revision.md`.
8. Run leadership review in `06-leadership-review.md`.
9. Produce `07-final-synthesis.md`.
10. Record memory changes in `08-memory-update-log.md`.

## Key Commands

```bash
npm run agent:generate
npm run agent:validate
npm run agent:index
npm run agent:score -- iterations/iteration-0001
npm run agent:leadership -- iterations/iteration-0001
npm run agent:verify
```

## Quality Bar

The plan is not mature until it has:

- A weighted score of at least 4.5 out of 5.
- No critical unresolved risks.
- Legal and regulatory resilience at least 4.3.
- Clinical validity at least 4.5.
- Psychometric defensibility at least 4.5.
- Specialty clinical generalizability at least 4.2.
- Senior Leadership majority approval with no block from General Counsel, Chief Medical Education Officer, Chief Psychometrician, or Chief Security and Privacy Officer.

