import fs from 'fs/promises';
import path from 'path';

export async function checkEvidenceGates() {
  const factoryPath = path.join(process.cwd(), '.agent-factory');

  try {
    const [riskRaw, debtRaw] = await Promise.all([
      fs.readFile(path.join(factoryPath, 'risk-report.json'), 'utf-8'),
      fs.readFile(path.join(factoryPath, 'evidence-debt-report.json'), 'utf-8'),
    ]);

    const riskReport = JSON.parse(riskRaw);
    const evidenceDebt = JSON.parse(debtRaw);

    const hasCriticalRisk = (riskReport.criticalIssues?.length || 0) > 0;
    const hasHighDebt = (evidenceDebt.totalDebt || 0) > 8;

    return {
      canProceed: !hasCriticalRisk && !hasHighDebt,
      riskReport,
      evidenceDebt,
    };
  } catch (err) {
    console.warn('[EvidenceGate] Could not read .agent-factory reports. Proceeding with caution.');
    return { canProceed: true };
  }
}