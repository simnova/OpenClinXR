# Iteration 0003 Brief

Date: 2026-05-03
Loop focus: technology approach, XR asset pipeline, provider routing, communication-style fidelity, admin UX/testing, and production-ready case-bank expansion.

## User Additions

The user asked the agent teams to:

- Reinspect the original assets and add a technological approach brief for development guidance.
- Incorporate human generation, skin, clothing, rigging, animation, and interaction-model references.
- Keep runtime feasible on Azure App Service Plan B1 Basic and Quest 3, with local M4 Max mode for development and asset generation.
- Favor TypeScript, React, Bun, Hono, CellixJS-compatible patterns, MongoDB, WebXR, Ant Design 6, Ant Design Pro patterns, Penpot/OpenPencil, Storybook, Serenity/JS, and automated testing.
- Consider Grok APIs for production voice/reasoning once reviewed.
- Ground the plan in open-source or commercially supportable options while avoiding AGPL/GPL/copyleft runtime contamination.
- Use the provided Laverde et al. PDF and Bodonhelyi et al. PDF for virtual-patient agent, communication-style, and QA inspiration.

## Inputs Reviewed

- Original `xr-solution.zip` architecture bundle and MADRs.
- `grok.docx` and `chatgpt.docx` business/technical plans.
- Laverde et al. virtual-patient agent paper.
- Bodonhelyi et al. challenging patient communication preprint.
- Public source checks for Anny, MakeHuman, MakeClothes, StableGen, Mesh2Motion, NVIDIA ACE/Audio2Face, xAI voice/Grok docs, MDN WebXR/WebTransport, Penpot, OpenPencil, Storybook, Serenity/JS, Azure App Service, and npm dependency metadata.

## Iteration Goal

Produce a development-team handoff that is detailed enough to start a TypeScript implementation plan later, but does not build code yet.

The core team's work should now be judged on whether it gives developers:

- A realistic first product scope.
- Concrete technology choices and license posture.
- Quest 3/Azure B1 performance constraints.
- Asset-generation pipeline.
- Model/voice provider routing.
- Admin UX and testing stack.
- Virtual-patient memory, response grounding, and communication-style QA.
- A first case bank with environment, actors, assets, trace, and dialogue requirements.
