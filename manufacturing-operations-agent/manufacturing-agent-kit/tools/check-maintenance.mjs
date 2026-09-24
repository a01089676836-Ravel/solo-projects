import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ledgerPath = resolve(root, 'reports/maintenance-review.json');
export const WATCHED_FILES = [
  'config/agent-runtime.json', 'src/runtime-config.mjs', 'src/agent-api.mjs',
  'src/reliable-pipeline.mjs', 'src/skill-registry.mjs', 'agent-skills/manifest.json',
  'AGENTS.md', 'skill/runtime-maintenance/SKILL.md', 'tools/check-maintenance.mjs',
  'tools/offline-run.mjs', 'tools/local-agent-check.mjs', 'tools/reliability-comparison.mjs',
  'tests/astra-runtime.test.mjs', 'tests/maintenance.test.mjs', 'package.json'
];

export function collectSnapshot() {
  let codexVersion = null;
  try {
    codexVersion = process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-Command', 'codex.cmd --version'],
        { encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      : execFileSync('codex', ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  } catch { /* Unknown version is a review signal, never a fabricated value. */ }
  const fileHashes = Object.fromEntries(WATCHED_FILES.map(file => [file,
    existsSync(resolve(root, file)) ? createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex') : null]));
  return { nodeVersion: process.version, codexVersion,
    model: JSON.parse(readFileSync(resolve(root, 'config/agent-runtime.json'), 'utf8')).model,
    fileHashes };
}

export function assessMaintenance(current, reviewed, now = new Date()) {
  const reasons = [];
  if (!reviewed?.snapshot) reasons.push('no_previous_review');
  if (!current.codexVersion) reasons.push('codex_version_unknown');
  if (Object.values(current.fileHashes).some(hash => hash === null)) reasons.push('tracked_file_missing');
  if (reviewed?.snapshot && JSON.stringify(current) !== JSON.stringify(reviewed.snapshot))
    reasons.push('local_version_or_project_changed');
  const reviewTime = Date.parse(reviewed?.reviewedAt);
  if (!Number.isFinite(reviewTime) || now.getTime() - reviewTime >= 7 * 86400000 || reviewTime > now.getTime())
    reasons.push('official_docs_review_due');
  return { status: reasons.length ? 'review_required' : 'current', reasons,
    releaseDiscovery: 'not_run_by_this_offline_checker',
    backgroundMonitor: false, automaticModelSwitch: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const snapshot = collectSnapshot();
  const reviewed = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : null;
  if (process.argv.includes('--record-review')) {
    const evidenceArg = process.argv[process.argv.indexOf('--record-review') + 1];
    if (!evidenceArg || evidenceArg.startsWith('--')) throw new Error('Provide a reviewed JSON evidence file');
    const evidence = JSON.parse(readFileSync(resolve(evidenceArg), 'utf8'));
    if (!Array.isArray(evidence.sources) || !evidence.sources.length || !evidence.tests || !evidence.decision)
      throw new Error('Review requires sources, executed tests and decision');
    const record = { reviewedAt: new Date().toISOString(), snapshot, evidence,
      provenance: 'Codex review record; checker does not independently verify source or test claims' };
    writeFileSync(ledgerPath, JSON.stringify(record, null, 2) + '\n');
    console.log(JSON.stringify({ status: 'review_recorded', path: ledgerPath }));
  } else {
    const report = { checkedAt: new Date().toISOString(), ...assessMaintenance(snapshot, reviewed), snapshot };
    writeFileSync(resolve(root, 'reports/maintenance-status.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}
