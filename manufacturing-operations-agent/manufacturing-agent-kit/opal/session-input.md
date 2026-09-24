# Opal 비서에 전달할 프로젝트 상태

기준일: 2026-09-07. 요청 업무: 다음 할 일 및 실험 근거 점검.

제조 설비 이상탐지·근거 기반 점검 지원을 혼자 만드는 프로젝트다. 현재 UCI AI4I 합성 데이터 10,000행의 입력 검증, 원본 해시 고정, 순서 블록 분할, 정상 참조 기준선 두 개와 회귀 테스트 6개를 구현·실행했다.

증거: reports/baseline.json, reports/baseline.md, docs/data-card.md, tests/baseline.test.mjs.
Test 1,900행 중 고장 라벨 38개. max_abs_z는 TP 15 / FP 59 / FN 23 / TN 1803, AP 0.16625.
mean_squared_z는 TP 16 / FP 75 / FN 22 / TN 1787, AP 0.15048.
실제 공장 데이터가 아니며 모델 점수는 고장 확률이 아니다. 타깃과 고장 유형 OR 불일치 27개를 발견했다. 원본은 유지했다.

추가 완료: Node.js 내장 SQLite로 validation 알림 114개 저장. 같은 import를 반복해 추가 0개/중복 114개 확인. GET /health, /events, /events/{eventId} 읽기 API 구현. 통합 테스트 14개 PASS, 실제 CLI 서버의 목록/상세 조회 PASS(reports/api-smoke.json). 확인 후 서버 종료.

추가 구현(2026-09-07): 작업자 목록·상세 화면과 별도 SQLite 검토 대기 피드백. 실제 Chrome에서 114개 목록→표본 6119 상세→모름 의견 저장 성공 문구를 확인했다. 개발 UI 검증용 의견 1건이며 현장 평가가 아니다. 의사결정은 docs/decisions.md, AI 위임은 docs/ai-delegation.md 참조. 상세 검증 결과는 최신 STATE.md를 붙여 넣어 확인한다.

미구현: SOP 검색, LLM Agent, 사용자 평가. Opal 앱도 아직 생성·실행하지 않았다.

다음 목표: 교육용임을 명시한 근거 문서와 검색 기준선 설계, opal/create-prompt.txt의 생성 프롬프트로 비서를 만들고 opal/evaluation.md 사례 실행. 실제 시간·설비 ID는 만들지 않는다. UI에는 validation 표본을 쓰고 test를 튜닝에 반복 사용하지 않는다.

오늘 가능한 시간: 사용자가 아직 제공하지 않음. 사용량 제한을 고려해 한 번에 하나의 검증 가능한 기능을 제안한다. 남은 Codex 사용량을 알고 있다고 가정하지 않는다.

위 사실과 제안을 구분하여 다음 행동 최대 3개와 각 완료 증거를 제시해 줘. 파일명만으로 파일 내용을 읽었다고 주장하지 말고, 세부 검토가 필요하면 해당 내용의 붙여 넣기를 요청해 줘.
