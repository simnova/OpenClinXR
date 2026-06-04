# OpenClinXR Apps

Production app roots live directly under this directory:

- `api`: primary HTTP/API surface.
- `ui-admin`: faculty/admin review and authoring surface.
- `ui-xr`: learner station runtime and WebXR desktop/Quest shell.

Experimental runnable or source-level sidecars live under `apps/arena/`. Arena apps are for capability cage matches, local proving, and evidence capture before promotion. Production apps must not import arena apps or depend on their packages directly; use stable packages and gateway contracts instead.
