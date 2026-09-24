import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildKpiDraft,
  rankCandidates,
  runCopilot,
  scoreCandidate,
  validateCandidate
} from '../04_프로그램코드/copilot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = JSON.parse(await readFile(path.join(root, '01_입력데이터_실행기록', 'candidate-initiatives.json'), 'utf8'));

test('all fixture cards are schema-valid and have evidence plus human gates', () => {
  for (const candidate of input.candidates) assert.equal(validateCandidate(candidate), true);
});

test('ranking prioritizes direct DT fit and excludes the existing project from new-project recommendations', () => {
  const ranked = rankCandidates(input.candidates);
  assert.deepEqual(ranked.filter(item => item.eligibleForNextProject).slice(0, 3).map(item => item.id), [
    'dx-001', 'dx-002', 'dx-003'
  ]);
  assert.equal(ranked.at(-1).id, 'existing-001');
  assert.equal(ranked.at(-1).eligibleForNextProject, false);
});

test('score output exposes the rubric instead of hiding the decision', () => {
  const scored = scoreCandidate(input.candidates[0]);
  assert.equal(scored.score, 92);
  assert.equal(scored.rawScore, 92);
  assert.equal(scored.overlapPenalty, 0);
  assert.equal(scored.scoreBreakdown.strategicFit.value, 5);
  assert.equal(scored.scoreBreakdown.strategicFit.contribution, 25);
});

test('KPI draft refuses to invent a target when baseline is missing', () => {
  const ranked = rankCandidates(input.candidates).find(item => item.id === 'dx-001');
  const kpi = buildKpiDraft(ranked);
  assert.equal(kpi.baselineStatus, 'baseline_required');
  assert.equal(kpi.target, null);
  assert.equal(kpi.humanApprovalRequired, true);
});

test('offline run records an explicit no-API boundary and human review gates', () => {
  const result = runCopilot(input);
  assert.equal(result.runMode, 'offline_deterministic');
  assert.equal(result.externalApiCalled, false);
  assert.equal(result.decisionBoundary.copilotMayNot.includes('예산·담당자·목표값을 자동 승인'), true);
  assert.equal(result.kpiDrafts.every(kpi => kpi.humanApprovalRequired), true);
  assert.deepEqual(result.implementationRoadmap.map(phase => phase.phase), ['0-30일', '31-60일', '61-90일']);
  assert.equal(result.limitations.some(item => item.includes('Astra API')), true);
});

test('cards without evidence or with an invalid score are rejected', () => {
  const noEvidence = { ...input.candidates[0], evidenceRefs: [] };
  assert.throws(() => validateCandidate(noEvidence), /evidenceRefs/);
  const badScore = { ...input.candidates[0], feasibility: 6 };
  assert.throws(() => validateCandidate(badScore), /feasibility/);
  const blankTitle = { ...input.candidates[0], title: '   ' };
  assert.throws(() => validateCandidate(blankTitle), /non-empty string/);
  const badId = { ...input.candidates[0], id: 'bad id' };
  assert.throws(() => validateCandidate(badId), /only letters/);
});

test('reference sources require a title and an http(s) URL', () => {
  const invalid = {
    ...input,
    referenceSources: [{ ...input.referenceSources[0], url: 'javascript:alert(1)' }, input.referenceSources[1]]
  };
  assert.throws(() => runCopilot(invalid), /http\(s\) URL/);
});
