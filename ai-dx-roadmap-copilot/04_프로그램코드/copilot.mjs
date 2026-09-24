// 이 버전의 점수표를 고정해 두면 같은 입력을 다시 실행해도 판단을 재현할 수 있다.
export const RUBRIC_VERSION = 'dt-portfolio-rubric-v1';

// 점수는 실제 회사의 공식 평가 기준이 아니라, MVP에서 판단 근거를 공개하기 위한 예시다.
export const SCORE_WEIGHTS = Object.freeze({
  strategicFit: 0.25,
  businessImpact: 0.25,
  feasibility: 0.15,
  dataReadiness: 0.15,
  urgency: 0.10,
  governanceReadiness: 0.10
});

const MAX_CANDIDATES = 500;
const MAX_REFERENCE_SOURCES = 200;
const MAX_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 2000;

const REQUIRED_FIELDS = [
  'id', 'title', 'problem', 'owner', 'evidenceRefs', 'humanDecisionPoints',
  'strategicFit', 'businessImpact', 'feasibility', 'dataReadiness', 'urgency',
  'governanceReadiness', 'kpiHints'
];

function assertScore(value, field, id) {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(`${id}.${field} must be an integer from 1 to 5`);
  }
}

function assertText(value, field, id, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new Error(`${id}.${field} must be a non-empty string up to ${maxLength} characters`);
  }
}

/**
 * 과제 카드에 문제 정의·근거·사람 승인 지점·KPI 초안이 모두 있는지 확인한다.
 * 근거가 없는 카드는 이후 점수 계산이나 추천에 넣지 않는다.
 */
export function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('candidate must be an object');
  for (const field of REQUIRED_FIELDS) {
    if (!(field in candidate)) throw new Error(`${candidate.id ?? 'unknown'}.${field} is required`);
  }
  assertText(candidate.id, 'id', 'candidate', MAX_ID_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(candidate.id)) {
    throw new Error(`${candidate.id}.id must contain only letters, numbers, hyphens, and underscores`);
  }
  for (const field of ['title', 'problem', 'owner']) assertText(candidate[field], field, candidate.id);
  for (const field of Object.keys(SCORE_WEIGHTS)) assertScore(candidate[field], field, candidate.id);
  if (!Array.isArray(candidate.evidenceRefs) || candidate.evidenceRefs.length === 0) {
    throw new Error(`${candidate.id}.evidenceRefs must contain at least one source`);
  }
  if (candidate.evidenceRefs.length > 20 || candidate.evidenceRefs.some(value => typeof value !== 'string' || !value.trim() || value.length > MAX_ID_LENGTH)) {
    throw new Error(`${candidate.id}.evidenceRefs must contain short non-empty source IDs`);
  }
  if (new Set(candidate.evidenceRefs).size !== candidate.evidenceRefs.length) {
    throw new Error(`${candidate.id}.evidenceRefs must not contain duplicates`);
  }
  if (!Array.isArray(candidate.humanDecisionPoints) || candidate.humanDecisionPoints.length === 0) {
    throw new Error(`${candidate.id}.humanDecisionPoints must contain at least one human gate`);
  }
  if (candidate.humanDecisionPoints.length > 20 || candidate.humanDecisionPoints.some(value => typeof value !== 'string' || !value.trim() || value.length > MAX_TEXT_LENGTH)) {
    throw new Error(`${candidate.id}.humanDecisionPoints must contain short non-empty decisions`);
  }
  if (new Set(candidate.humanDecisionPoints).size !== candidate.humanDecisionPoints.length) {
    throw new Error(`${candidate.id}.humanDecisionPoints must not contain duplicates`);
  }
  if (!candidate.kpiHints || typeof candidate.kpiHints !== 'object' || Array.isArray(candidate.kpiHints)) {
    throw new Error(`${candidate.id}.kpiHints must be an object`);
  }
  for (const field of ['objective', 'leadingIndicator', 'outcomeIndicator']) assertText(candidate.kpiHints[field], `kpiHints.${field}`, candidate.id);
  for (const field of ['unit', 'baselineSource']) {
    if (candidate.kpiHints[field] !== undefined) assertText(candidate.kpiHints[field], `kpiHints.${field}`, candidate.id);
  }
  if (candidate.tags !== undefined && (!Array.isArray(candidate.tags) || candidate.tags.length > 20 || candidate.tags.some(value => typeof value !== 'string' || !value.trim() || value.length > 100))) {
    throw new Error(`${candidate.id}.tags must contain short strings`);
  }
  if (candidate.overlapRisk !== undefined && !['low', 'medium', 'high'].includes(candidate.overlapRisk)) {
    throw new Error(`${candidate.id}.overlapRisk must be low, medium, or high`);
  }
  if (candidate.baselineAvailable !== undefined && typeof candidate.baselineAvailable !== 'boolean') {
    throw new Error(`${candidate.id}.baselineAvailable must be boolean`);
  }
  if (candidate.existingPortfolio !== undefined && typeof candidate.existingPortfolio !== 'boolean') {
    throw new Error(`${candidate.id}.existingPortfolio must be boolean`);
  }
  if (!candidate.kpiHints.objective || !candidate.kpiHints.leadingIndicator || !candidate.kpiHints.outcomeIndicator) {
    throw new Error(`${candidate.id}.kpiHints must include objective and indicators`);
  }
  return true;
}

function weightedScore(candidate) {
  return Object.entries(SCORE_WEIGHTS)
    .reduce((total, [field, weight]) => total + candidate[field] * weight, 0) * 20;
}

function overlapPenalty(candidate) {
  if (candidate.overlapRisk === 'high') return 8;
  if (candidate.overlapRisk === 'medium') return 3;
  return 0;
}

/**
 * 과제의 점수와 점수 구성요소를 함께 반환한다.
 * 결과만 보여주지 않고 왜 그 점수가 나왔는지 공개하는 것이 핵심이다.
 */
export function scoreCandidate(candidate) {
  validateCandidate(candidate);
  const rawScore = Math.round(weightedScore(candidate));
  const score = Math.max(0, rawScore - overlapPenalty(candidate));
  const eligibleForNextProject = !candidate.existingPortfolio;
  return {
    id: candidate.id,
    title: candidate.title,
    problem: candidate.problem,
    owner: candidate.owner,
    tags: candidate.tags ?? [],
    score,
    rawScore,
    overlapPenalty: rawScore - score,
    eligibleForNextProject,
    selectionNote: eligibleForNextProject
      ? '새 DT 포트폴리오 후보'
      : '기존 포트폴리오로 분류하여 신규 프로젝트 우선순위에서 제외',
    scoreBreakdown: Object.fromEntries(
      Object.entries(SCORE_WEIGHTS).map(([field, weight]) => [field, {
        value: candidate[field],
        weight,
        contribution: Number((candidate[field] * weight * 20).toFixed(2))
      }])
    ),
    evidenceRefs: [...candidate.evidenceRefs],
    humanDecisionPoints: [...candidate.humanDecisionPoints],
    kpiHints: { ...candidate.kpiHints },
    baselineAvailable: Boolean(candidate.baselineAvailable),
    existingPortfolio: Boolean(candidate.existingPortfolio),
    overlapRisk: candidate.overlapRisk ?? 'unknown'
  };
}

/**
 * 새로 만들 후보를 기존 포트폴리오와 분리한 뒤 우선순위를 정한다.
 * 기존 프로젝트는 점수가 높아도 신규 프로젝트 추천에서 제외한다.
 */
export function rankCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) throw new Error('candidates must be a non-empty array');
  const scored = candidates.map(scoreCandidate);
  if (new Set(scored.map(candidate => candidate.id)).size !== scored.length) {
    throw new Error('candidate IDs must be unique');
  }
  return scored
    .sort((a, b) => {
      if (a.eligibleForNextProject !== b.eligibleForNextProject) return a.eligibleForNextProject ? -1 : 1;
      return b.score - a.score || a.id.localeCompare(b.id);
    })
    .map((candidate, index) => ({ rank: index + 1, ...candidate }));
}

/**
 * KPI의 목적·선행지표·결과지표를 제안한다.
 * 기준값이 없으면 목표값을 만들지 않고 사람의 측정을 기다린다.
 */
export function buildKpiDraft(rankedCandidate) {
  const baselineAvailable = Boolean(rankedCandidate.baselineAvailable);
  return {
    candidateId: rankedCandidate.id,
    candidateTitle: rankedCandidate.title,
    objective: rankedCandidate.kpiHints.objective,
    leadingIndicator: rankedCandidate.kpiHints.leadingIndicator,
    outcomeIndicator: rankedCandidate.kpiHints.outcomeIndicator,
    unit: rankedCandidate.kpiHints.unit,
    baselineSource: rankedCandidate.kpiHints.baselineSource,
    baselineStatus: baselineAvailable ? 'available_for_review' : 'baseline_required',
    target: baselineAvailable ? 'human_review_required' : null,
    targetRule: baselineAvailable
      ? '사람이 기준값·목표값·측정주기를 검토한 뒤 승인'
      : '기준값을 먼저 측정한 뒤 목표값을 설정; AI가 목표를 지어내지 않음',
    humanApprovalRequired: true
  };
}

// 제품을 30일·60일·90일 단계로 나누되, 각 단계마다 사람 승인 지점을 둔다.
export function buildImplementationRoadmap() {
  return [
    {
      phase: '0-30일',
      goal: '과제 카드와 근거 기반 우선순위 MVP',
      deliverables: [
        '합성 과제 카드 스키마와 출처 링크',
        '가중치 기반 우선순위 점수와 겹침 위험 표시',
        '사람 검토 체크리스트와 결정 이력 JSON'
      ],
      humanGate: '가중치·후보 과제·최종 1순위 승인'
    },
    {
      phase: '31-60일',
      goal: '로드맵과 KPI 초안의 검증 가능한 연결',
      deliverables: [
        '상위 후보별 30/60/90일 실행 단계',
        '선행·결과 KPI 초안과 기준값 보류 상태',
        '동일 입력 재실행 회귀 테스트와 실패 사례'
      ],
      humanGate: '기준값·목표값·측정주기·담당자 승인'
    },
    {
      phase: '61-90일',
      goal: '선택적 LLM 보조와 운영 리포트',
      deliverables: [
        '선택적 Astra 구조화 출력 어댑터',
        'LLM 제안과 결정론적 점수의 차이 비교',
        '근거 부족 시 보류하는 운영 리포트'
      ],
      humanGate: '외부 API 연결·데이터 전송 범위·운영 전환 승인'
    }
  ];
}

/**
 * 현재 MVP의 전체 실행入口다.
 * 외부 API나 LLM을 호출하지 않고, 입력·루브릭·검토 경계를 포함한 결과를 만든다.
 */
export function runCopilot(input) {
  if (!input || !Array.isArray(input.candidates)) throw new Error('input.candidates must be an array');
  if (input.candidates.length === 0 || input.candidates.length > MAX_CANDIDATES) throw new Error(`input.candidates must contain 1 to ${MAX_CANDIDATES} items`);
  if (!Array.isArray(input.referenceSources) || input.referenceSources.length === 0) {
    throw new Error('input.referenceSources must be a non-empty array');
  }
  if (input.referenceSources.length > MAX_REFERENCE_SOURCES) throw new Error(`input.referenceSources must contain at most ${MAX_REFERENCE_SOURCES} items`);
  const sourceIds = new Set();
  for (const source of input.referenceSources) {
    if (!source || typeof source.id !== 'string' || !source.id.trim() || source.id.length > MAX_ID_LENGTH) throw new Error('reference source id is required and must be short');
    if (typeof source.title !== 'string' || !source.title.trim() || source.title.length > MAX_TEXT_LENGTH || typeof source.url !== 'string' || source.url.length > MAX_TEXT_LENGTH || !/^https?:\/\//i.test(source.url)) {
      throw new Error(`reference source ${source.id} must have a title and http(s) URL`);
    }
    try {
      const parsedUrl = new URL(source.url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) throw new Error('invalid URL');
    } catch {
      throw new Error(`reference source ${source.id} must have a title and http(s) URL`);
    }
    if (source.role !== undefined) assertText(source.role, 'role', `reference source ${source.id}`, 100);
    if (sourceIds.has(source.id)) throw new Error(`duplicate reference source id: ${source.id}`);
    sourceIds.add(source.id);
  }
  for (const candidate of input.candidates) {
    for (const evidenceRef of candidate.evidenceRefs ?? []) {
      if (!sourceIds.has(evidenceRef)) throw new Error(`${candidate.id} references unknown evidence: ${evidenceRef}`);
    }
  }
  const ranked = rankCandidates(input.candidates);
  const eligible = ranked.filter(candidate => candidate.eligibleForNextProject);
  const topThree = eligible.slice(0, 3);
  return {
    schemaVersion: 1,
    rubricVersion: RUBRIC_VERSION,
    runMode: 'offline_deterministic',
    externalApiCalled: false,
    title: 'AI·DX 과제 발굴·우선순위·로드맵·성과관리 Copilot',
    portfolioIntent: '기존 제조설비 Agent의 기술·신뢰성 역량에 DX 전략기획·프로세스 거버넌스·기술 리서치 역량을 보완한다.',
    rankedCandidates: ranked,
    recommendedNextProjectIds: topThree.map(candidate => candidate.id),
    kpiDrafts: topThree.map(buildKpiDraft),
    implementationRoadmap: buildImplementationRoadmap(),
    decisionBoundary: {
      copilotMay: [
        '근거가 연결된 과제 카드를 비교하고 점수 초안을 제안',
        '가중치와 입력값을 공개한 우선순위·로드맵 초안을 생성',
        '기준값이 없는 KPI를 baseline_required로 보류'
      ],
      copilotMayNot: [
        '회사 내부 성과나 KPI를 임의로 주장',
        '예산·담당자·목표값을 자동 승인',
        '근거 없는 트렌드나 벤치마킹 결과를 사실처럼 출력',
        '사람의 검토 없이 운영 전환'
      ]
    },
    evidenceTrace: {
      sourceType: input.sourceType ?? 'unspecified',
      referenceSources: input.referenceSources ?? [],
      candidateEvidenceRefs: Object.fromEntries(ranked.map(candidate => [candidate.id, candidate.evidenceRefs]))
    },
    humanReviewChecklist: [
      '공고·회사 자료와 후보 과제의 연결 근거 확인',
      '점수 가중치와 과제 입력값 검토',
      '실제 기준값과 데이터 소유자 확인',
      'KPI 목표값·측정주기·예외 기준 승인',
      '파일럿 종료·확대·중단 조건 기록'
    ],
    limitations: [
      '후보 과제, 점수, KPI 기준값은 합성 픽스처다.',
      'industrial-automation 내부 데이터·성과·조직 담당자를 검증하지 않았다.',
      '가중치는 설명 가능한 예시이며 실제 조직 의사결정 전에 사람이 조정해야 한다.',
      '현재 LLM이나 Astra API를 호출하지 않았으므로 생성형 모델 품질은 검증하지 않았다.'
    ]
  };
}
