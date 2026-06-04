# OpenClinXR Packages

Stable product packages and support packages live directly under this directory. They provide app, domain, persistence, gateway, review, runtime, asset-commons, validation, and build-governance contracts.

Support packages such as `architecture-rules`, `agent-loop`, `test-harness`, and `config-rolldown` stay here because they protect, validate, or coordinate the production system. They are not capability trials.

Experimental packages live under `packages/openclinxr/arena/`. Arena packages encode cage-match policy, evidence contracts, and spike implementations. Production apps and stable packages should not import arena packages unless an architecture rule explicitly allows a read-only policy/test exception.
