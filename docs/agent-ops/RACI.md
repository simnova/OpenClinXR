# Agent RACI (OpenClinXR)

| Concern | R | A | C | I |
|---------|---|---|---|---|
| Slice dequeue / lease / SSOT | chief-coordinator | chief-coordinator | drift-police, hrbp | specialists |
| Agent definition / SoD / tools | hrbp | hrbp | chief-coordinator, vp-eng | all roles |
| **Temporal hygiene / cadence / catch-up** | **pmo** | **pmo** | hrbp, archivist, orchestrator | all |
| **Temporal decision catalog (workarounds / pins / revisit)** | **pmo** | **pmo** | analysisOwnerRole per item, orchestrator | all |
| **Temporal decision analysis verdict** | analysisOwnerRole (item) | pmo (due process) | executeOwnerRole, hrbp if capability | specialists |
| Factory guardrails (protected) | drift-police | chief-coordinator | hrbp | implementers |
| Asset/Anny pipeline | asset-pipeline-lead | asset-pipeline-lead | skeptic, license | xr-architect |
| XR runtime / UI-XR | xr-systems-architect | xr-systems-architect | skeptic | asset-pipeline |
| Clinical wording | pediatrics-physician, clinical-safety-critic | chief-coordinator | — | all |
| Delivery sequencing | vp-engineering-delivery | vp-engineering-delivery | chief-coordinator | hrbp |
| CLI-first MCP policy | hrbp | chief-coordinator | drift-police | all |
| Docs warehouse cold retrieval | archivist | pmo (cadence) | hrbp | specialists |

R = responsible, A = accountable, C = consulted, I = informed.
