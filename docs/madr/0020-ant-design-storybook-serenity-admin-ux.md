# MADR 0020: Use Ant Design, Storybook, And Serenity For Admin UX

Status: Accepted for planning
Date: 2026-05-03

## Context

OpenClinXR has several non-examinee workflows: scenario authoring, psychometric review, legal/compliance review, asset QA, faculty scoring, trace replay, and operations. These are dense, audit-heavy workflows that should be familiar to a TypeScript/React team and easy to test.

## Decision

Use React, TypeScript, Ant Design 6, Ant Design Pro component patterns, `@xyflow/react`, Storybook 10.3, Serenity/JS, Vitest, and Playwright for the administrative UI and workflow-testing stack. Use Penpot for collaborative design and OpenPencil as a permissively licensed local exploration option.

## Consequences

Positive:

- Aligns with the development team's TypeScript/React strengths.
- Gives administrators mature tables, forms, filters, drawers, and review workflows.
- Makes acceptance tests readable in domain language.
- Keeps scenario graphs and statecharts inspectable.

Negative:

- Ant Design should stay out of immersive WebXR except as canvas-rendered/fallback panels.
- Requires design-system discipline to avoid bloated admin screens.
- XR headset behavior still needs device testing beyond Storybook and browser automation.

## Reversal Trigger

Revisit only if Ant Design 6 or Pro Components create unacceptable bundle, licensing, accessibility, or maintenance constraints.

## Sources

- `src-penpot-github-2026`
- `src-openpencil-2026`
- `src-npm-stack-metadata-2026-05-03`
- `src-storybook-10-3-2026`
- `src-serenity-js-screenplay-2026`
