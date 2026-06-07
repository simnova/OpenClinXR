import {
  validateCagematchReportPage,
  validateCagematchReportRegistry,
  type CagematchFeasibilityCriterion,
  type CagematchReportPage,
  type CagematchReportRegistry,
} from "@openclinxr/model-vetting";

export async function loadCagematchReportRegistry(): Promise<CagematchReportRegistry> {
  const response = await fetch("/cagematch-reports/registry.json");
  if (!response.ok) throw new Error(`Unable to load cagematch report registry: ${response.status}`);
  const validation = validateCagematchReportRegistry(await response.json());
  if (!validation.ok) throw new Error(`Invalid cagematch report registry: ${validation.errors.join("; ")}`);
  return validation.registry;
}

export async function loadCagematchReportPage(reportId: string): Promise<CagematchReportPage> {
  const response = await fetch(`/cagematch-reports/${reportId}/report.json`);
  if (!response.ok) throw new Error(`Unable to load cagematch report ${reportId}: ${response.status}`);
  const validation = validateCagematchReportPage(await response.json());
  if (!validation.ok) throw new Error(`Invalid cagematch report page: ${validation.errors.join("; ")}`);
  return validation.report;
}

export function renderCagematchReportIndex(registry: CagematchReportRegistry): string {
  return `
    <main class="cagematch-report-shell">
      <header class="cagematch-report-hero">
        <p class="eyebrow">Capability Arena</p>
        <h1>Technology Cagematch Reports</h1>
        <p class="lede">Repeatable arena experiments with objectives, media evidence, feasibility criteria, and factory routing decision trees. No promotion or readiness claims.</p>
      </header>
      <section class="cagematch-report-grid" aria-label="Cagematch report index">
        ${registry.reports.map((entry) => `
          <article class="cagematch-report-card">
            ${entry.thumbnailUrlPath ? `<img class="report-thumb" src="${escapeHtml(entry.thumbnailUrlPath)}" alt="" loading="lazy" />` : ""}
            <p class="eyebrow">${escapeHtml(entry.family)}</p>
            <h2><a href="/?cagematchReport=${encodeURIComponent(entry.reportId)}">${escapeHtml(entry.title)}</a></h2>
            <p class="meta">${escapeHtml(entry.lane)} · run ${escapeHtml(entry.runId)}</p>
            <a class="report-link" href="/?cagematchReport=${encodeURIComponent(entry.reportId)}">Open report</a>
          </article>
        `).join("")}
      </section>
    </main>
  `;
}

export function renderCagematchReportPage(report: CagematchReportPage): string {
  return `
    <main class="cagematch-report-shell">
      <header class="cagematch-report-hero">
        <p class="eyebrow">${escapeHtml(report.family)} · ${escapeHtml(report.lane)}</p>
        <h1>${escapeHtml(report.title)}</h1>
        <p class="lede">${escapeHtml(report.subtitle)}</p>
        <p class="meta">Run ${escapeHtml(report.runId)} · ${escapeHtml(report.caseContext.scenarioId)} · ${escapeHtml(report.caseContext.actorProfile)}</p>
        <p class="claim-boundary">${escapeHtml(report.claimScope)}</p>
        <nav class="report-nav">
          <a href="/?cagematchReports=1">All cagematch reports</a>
          <a href="/">Model Vetting Studio</a>
        </nav>
      </header>

      <section class="cagematch-report-section">
        <h2>Objectives</h2>
        <ul>${report.objectives.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </section>

      <section class="cagematch-report-section">
        <h2>Technologies in this cagematch</h2>
        <div class="technology-grid">
          ${report.technologies.map(renderTechnologyCard).join("")}
        </div>
      </section>

      <section class="cagematch-report-section">
        <h2>How this cagematch was run</h2>
        <ol class="process-steps">${report.processSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
      </section>

      <section class="cagematch-report-section">
        <h2>Visual evidence — side-by-side comparison</h2>
        <p class="section-note">Fixed-camera isolated Model Vetting Studio captures. Left candidate is Anny Comfy masked-face; right is MPFB pediatric comparator.</p>
        <div class="media-grid">
          ${report.media.filter((item) => item.role !== "process").map(renderMediaCard).join("")}
        </div>
      </section>

      <section class="cagematch-report-section">
        <h2>Process walkthrough — how to read this cagematch</h2>
        <p class="section-note">Narrated steps for reviewers. Video slots fill when turntable or studio capture recordings are added; text guidance is authoritative until then.</p>
        ${renderProcessExplanations(report)}
        ${report.media.filter((item) => item.role === "process").map(renderMediaCard).join("")}
      </section>

      <section class="cagematch-report-section">
        <h2>Feasibility criteria</h2>
        <p class="section-note">Use these to decide whether a technology is viable for a scenario—not whether it is production-ready.</p>
        ${report.feasibilityCriteria.map(renderFeasibilityCriterion).join("")}
      </section>

      <section class="cagematch-report-section">
        <h2>Decision tree — when to choose which technology</h2>
        <p class="section-note">Factory routing guidance only. Specific scenarios may justify a different path after isolated cagematch review.</p>
        ${renderDecisionTreeFlowchart(report)}
        <div class="decision-tree">
          ${report.decisionBranches.map(renderDecisionBranch).join("")}
        </div>
      </section>

      <section class="cagematch-report-section verdict-panel">
        <h2>Interim verdict (no promotion)</h2>
        <p>${escapeHtml(report.interimVerdict.summary)}</p>
        <dl class="verdict-facts">
          <div><dt>Recommended primary</dt><dd>${escapeHtml(report.interimVerdict.recommendedPrimary)}</dd></div>
          <div><dt>Recommended fallback</dt><dd>${escapeHtml(report.interimVerdict.recommendedFallback)}</dd></div>
        </dl>
        ${report.interimVerdict.blockedReasons.length ? `<p><strong>Blocked reasons:</strong> ${report.interimVerdict.blockedReasons.map(escapeHtml).join(" · ")}</p>` : ""}
        <p><strong>Compare before promotion:</strong> ${report.interimVerdict.compareBeforePromotion.map(escapeHtml).join(" · ")}</p>
      </section>

      <section class="cagematch-report-section">
        <h2>Repeat this cagematch</h2>
        <ul class="mono-list">${report.relatedCommands.map((cmd) => `<li><code>${escapeHtml(cmd)}</code></li>`).join("")}</ul>
      </section>

      <footer class="cagematch-report-footer">
        <p>Not evidence for: ${report.notEvidenceFor.map((gate) => `<span>${escapeHtml(gate)}</span>`).join(" ")}</p>
        <p class="meta">Canonical plan: ${escapeHtml(report.canonicalPlanPath)}</p>
      </footer>
    </main>
  `;
}

function renderTechnologyCard(tech: CagematchReportPage["technologies"][number]): string {
  return `
    <article class="technology-card">
      <h3>${escapeHtml(tech.displayName)}</h3>
      <p>${escapeHtml(tech.summary)}</p>
      ${tech.toolVersions?.length ? `<p class="meta">Versions: ${tech.toolVersions.map(escapeHtml).join(" · ")}</p>` : ""}
      <p><strong>Strengths</strong></p>
      <ul>${tech.strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <p><strong>Limitations</strong></p>
      <ul>${tech.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </article>
  `;
}

function renderMediaCard(media: CagematchReportPage["media"][number]): string {
  const visual = media.kind === "video"
    ? `<video controls preload="metadata" ${media.posterUrlPath ? `poster="${escapeHtml(media.posterUrlPath)}"` : ""} src="${escapeHtml(media.urlPath)}"></video>`
    : `<img src="${escapeHtml(media.urlPath)}" alt="${escapeHtml(media.label)}" loading="lazy" />`;
  const lookFor = media.lookFor?.length
    ? `<ul class="look-for-list">${media.lookFor.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
  return `
    <figure class="media-card">
      ${visual}
      <figcaption>
        <strong>${escapeHtml(media.label)}</strong>
        <span>${escapeHtml(media.caption)}</span>
        ${lookFor}
      </figcaption>
    </figure>
  `;
}

function renderProcessExplanations(report: CagematchReportPage): string {
  if (!report.processExplanations?.length) return "";
  return `
    <div class="process-walkthrough-grid">
      ${report.processExplanations.map((step) => `
        <article class="process-walkthrough-card">
          <p class="eyebrow">Step ${step.stepNumber}</p>
          <h3>${escapeHtml(step.title)}</h3>
          <p>${escapeHtml(step.narrative)}</p>
          <p><strong>What to look for</strong></p>
          <ul>${step.lookFor.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
          ${step.videoUrlPath
            ? `<video controls preload="metadata" ${step.posterUrlPath ? `poster="${escapeHtml(step.posterUrlPath)}"` : ""} src="${escapeHtml(step.videoUrlPath)}"></video>`
            : `<p class="meta">Studio walkthrough video pending — re-run capture manifest when turntable/viseme clips are ready.</p>`}
        </article>
      `).join("")}
    </div>
  `;
}

function renderDecisionTreeFlowchart(report: CagematchReportPage): string {
  return `
    <div class="decision-flowchart" aria-label="Humanoid source routing flowchart">
      <div class="flow-node flow-start">Start: case actor + scenario</div>
      <div class="flow-arrow" aria-hidden="true">↓</div>
      <div class="flow-node flow-question">Case phenotype sliders or parametric body variation required?</div>
      <div class="flow-split">
        <div class="flow-branch">
          <span class="flow-label">Yes</span>
          <div class="flow-node flow-choice">anny_parametric_forward_pass</div>
        </div>
        <div class="flow-branch">
          <span class="flow-label">No</span>
          <div class="flow-node flow-question">MPFB rig, shape keys, or MakeHuman wardrobe needed?</div>
          <div class="flow-split">
            <div class="flow-branch">
              <span class="flow-label">Yes</span>
              <div class="flow-node flow-choice">mpfb_makehuman_basemesh</div>
            </div>
            <div class="flow-branch">
              <span class="flow-label">No / blocked</span>
              <div class="flow-node flow-blocked">blocked_pending_review</div>
            </div>
          </div>
        </div>
      </div>
      <div class="flow-arrow" aria-hidden="true">↓</div>
      <div class="flow-node flow-question">Anny mesh kept but face/scalp needs local diffusion?</div>
      <div class="flow-split">
        <div class="flow-branch">
          <span class="flow-label">Yes</span>
          <div class="flow-node flow-choice">comfy_realvisxl_masked_face (+ UV composite)</div>
        </div>
        <div class="flow-branch">
          <span class="flow-label">No</span>
          <div class="flow-node flow-neutral">Skip Comfy face pass</div>
        </div>
      </div>
      <div class="flow-arrow" aria-hidden="true">↓</div>
      <div class="flow-node flow-question">Two paths both reproducible but realism/rig differ?</div>
      <div class="flow-node flow-choice flow-highlight">compare_in_studio → this report</div>
      <div class="flow-arrow" aria-hidden="true">↓</div>
      <div class="flow-node flow-verdict">Interim primary: <code>${escapeHtml(report.interimVerdict.recommendedPrimary)}</code></div>
    </div>
  `;
}

function renderFeasibilityCriterion(criterion: CagematchFeasibilityCriterion): string {
  const rows = Object.entries(criterion.technologies).map(([technologyId, result]) => `
    <tr class="rating-${result.rating}">
      <td>${escapeHtml(technologyId)}</td>
      <td><span class="rating-pill">${escapeHtml(result.rating)}</span></td>
      <td>${escapeHtml(result.note)}</td>
    </tr>
  `).join("");
  return `
    <article class="criterion-card">
      <div class="criterion-heading">
        <h3>${escapeHtml(criterion.label)}</h3>
        <span class="weight-pill">${escapeHtml(criterion.weight)}</span>
      </div>
      <p>${escapeHtml(criterion.question)}</p>
      <table class="criteria-table">
        <thead><tr><th>Technology</th><th>Rating</th><th>Note</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </article>
  `;
}

function renderDecisionBranch(branch: CagematchReportPage["decisionBranches"][number]): string {
  return `
    <article class="decision-branch">
      <h3>${escapeHtml(branch.condition)}</h3>
      <p><strong>Choose:</strong> <code>${escapeHtml(branch.choose)}</code></p>
      <p>${escapeHtml(branch.rationale)}</p>
      <p class="meta">Examples: ${branch.exampleScenarios.map(escapeHtml).join(" · ")}</p>
    </article>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}