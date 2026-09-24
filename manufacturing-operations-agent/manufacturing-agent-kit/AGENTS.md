# 프로젝트 작업 규칙

이 폴더는 제조 이상탐지 Agent 프로젝트다. 먼저 STATE.md를 읽고 `skill/manufacturing-anomaly-agent/SKILL.md`와 필요한 reference를 적용한다.

- 프로젝트 작업 재개 시 `skill/runtime-maintenance/SKILL.md`를 적용하고 `npm.cmd run maintenance:check`를 한 번 실행한다. 모델 후속 버전·Codex/도구 변경·공식 문서 점검 기한이 감지되면 영향 확인 → 필요한 보완 → 회귀 검증 → 기록을 수행한다. 상시 감시나 전역 설정 변경은 아니다.
- 런타임 기본값은 `config/agent-runtime.json`의 Astra다. 개발용 Codex 모델과 별개이며, 실제 API 키/성공 응답 없이는 연결 완료로 보고하지 않는다.

- 2026-09-07 구현 시작 요청을 받았다. 현재 완료 범위는 STATE.md를 따르며 미구현 서비스를 완성됐다고 표현하지 않는다.
- 구현 시작 요청을 받으면 데이터 적합성 확인부터 진행한다. 사용자가 다른 경로를 지정하면 필요한 문서와 검증 도구를 그곳에 옮기되 기존 파일을 덮어쓰지 않는다.
- 단계마다 관측 가능한 수락 기준을 정하고 검증 결과를 STATE.md에 남긴다.
- 준비 확인 명령: `powershell -NoProfile -File tools/check.ps1`.
- 실제 기준선 검증은 `node --test tests/baseline.test.mjs`, 지표 재현은 `node src/baseline.mjs`. 준비 확인 통과를 모델 성능으로 간주하지 않는다.
- 저장/API까지 통합 검증은 `node --test tests/baseline.test.mjs tests/events.test.mjs`. API 재개는 `node src/import-events.mjs` 후 `node src/server.mjs`. 원본 test 표본은 화면 개발용으로 사용하지 않는다.
- 원본 데이터·비밀값은 Git에 넣지 않는다. 패키지 버전은 구현 시 확인하고 lock한다.
- 사용자 응답은 한국어 다음 English를 제공한다. 이력과 성능을 창작하지 않는다.
