import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runCopilot } from './copilot.mjs';

// 실행 위치와 무관하게 프로젝트 내부의 입력·리포트 경로를 찾는다.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = path.join(root, '01_입력데이터_실행기록', 'candidate-initiatives.json');
const reportPath = path.join(root, '03_검증리포트_진행기록', 'demo-run.json');
const markdownPath = path.join(root, '03_검증리포트_진행기록', 'demo-run.md');

function toMarkdown(result) {
  const topThree = result.rankedCandidates.filter(item => item.eligibleForNextProject).slice(0, 3);
  const lines = [
    '# AI·DX 과제 발굴·우선순위·로드맵·성과관리 Copilot 실행 리포트',
    '',
    `- 실행 모드: ${result.runMode}`,
    `- 외부 API 호출: ${result.externalApiCalled ? '있음' : '없음'}`,
    `- 루브릭: ${result.rubricVersion}`,
    '',
    '## 신규 프로젝트 추천 순위',
    '',
    '| 순위 | 과제 | 점수 | 판단 |',
    '|---:|---|---:|---|',
    ...topThree.map((item, index) => `| ${index + 1} | ${item.title} | ${item.score} | ${item.selectionNote} |`),
    '',
    '## KPI 초안',
    '',
    ...result.kpiDrafts.flatMap((kpi, index) => [
      `### ${index + 1}. ${kpi.candidateTitle}`,
      `- 목적: ${kpi.objective}`,
      `- 선행 KPI: ${kpi.leadingIndicator}`,
      `- 결과 KPI: ${kpi.outcomeIndicator}`,
      `- 기준값 상태: **${kpi.baselineStatus}**`,
      `- 목표값: ${kpi.target ?? '기준값 측정 후 사람 승인'}`,
      ''
    ]),
    '## 사람 검토 체크리스트',
    '',
    ...result.humanReviewChecklist.map(item => `- [ ] ${item}`),
    '',
    '## 제한사항',
    '',
    ...result.limitations.map(item => `- ${item}`),
    ''
  ];
  return lines.join('\n');
}

// 현재 데모는 합성 픽스처를 사용하므로 외부 API나 회사 내부 데이터를 호출하지 않는다.
const input = JSON.parse(await readFile(inputPath, 'utf8'));
const result = runCopilot(input);

if (!process.argv.includes('--check')) {
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, toMarkdown(result), 'utf8');
}

console.log(JSON.stringify({
  status: 'ok',
  mode: result.runMode,
  externalApiCalled: result.externalApiCalled,
  recommendedNextProjectIds: result.recommendedNextProjectIds,
  topThree: result.rankedCandidates
    .filter(item => item.eligibleForNextProject)
    .slice(0, 3)
    .map(item => ({ rank: item.rank, id: item.id, title: item.title, score: item.score })),
  reportWritten: !process.argv.includes('--check')
}, null, 2));
