# 구현 상태와 다음 단계 재개

2026-09-07 저장/API 단계 완료 시점의 인계다. 프로젝트 루트는 `.`이며 최신 `STATE.md`, `AGENTS.md`와 실제 파일을 먼저 확인한다.

## 현재 재사용할 구현

- Node.js 24.19.0, 외부 npm 의존성 없음. `node:sqlite`로 파일 DB와 HTTP API를 구현했다. 기술 초안의 Python/FastAPI로 바꾸기 위해 기존 동작을 재작성하지 말고, 변경이 실제로 필요한 때만 결정한다.
- `src/baseline.mjs`, `experiment.json`, `reports/baseline.json`: AI4I 합성 10,000행, 정상 참조 기준선 2개, 고정 분할과 임계값, 기존 test 결과. 모델 품질이 충분히 검증됐다고 표현하지 않는다.
- `src/events.mjs`: 원본·설정·기준선 코드의 해시를 확인하고 저장된 계수로 validation 표본만 점수화. SQLite 저장·중복 방지·충돌 시 롤백·조회.
- `src/import-events.mjs`: `data/events.sqlite`에 validation 알림 114개 저장. 반복 import에서 추가 0개·중복 114개를 확인했다. 이는 표본 알림 수이지 실제 고장 사건 수가 아니다.
- `src/server.mjs`: localhost GET /health, /events, /events/{eventId}. 현재 읽기 전용 API. 실행 계약은 `docs/api.md`를 읽는다.
- `tests/baseline.test.mjs`, `tests/events.test.mjs`: 기준선 6개·저장/API 8개 통과. 실제 CLI 서버 조회는 `reports/api-smoke.json`에 기록했다. 기록은 확인 시점의 증거이지 현재 서버 가동 보장이 아니다.
- `opal/session-input.md`: 진행 사실과 다음 작업을 전달하는 입력. Opal 앱 생성·실행은 아직 하지 않았다.

## 바로 다음 기능

작업자용 알림 목록·상세 화면과 검토 대기 피드백 저장을 연결한다. 기존 GET API와 validation 알림을 사용하고 구현 전 다음 수락 기준을 구체화한다.

1. 목록에서 표본 선택 → 점수/임계값과 실제 변수·단위 확인 → 합성·최신성 알 수 없음·심각도 미평가 표시.
2. 빈 목록·API 오류·존재하지 않는 ID를 구분한다. 원본의 equipmentId/observedAt은 null이며 storedAt을 관측 시각으로 바꾸지 않는다. 없는 시간 추세나 설비를 만들지 않는다.
3. 맞음/아님/모름, 실제 조치 메모를 저장한다. 검토 대기 상태로 두고 자동 정답화·재학습하지 않는다. 피드백 추가 시 기존 읽기 API와 구분된 쓰기 경로 및 idempotency key 계약을 설계하고 중복 재전송을 검증한다.
4. 실제 시각이 없는 현재 데이터에서는 오래됨을 단정하지 않는다. 데이터 시각이 확보된 뒤 stale 기준과 테스트를 추가한다.
5. UI·피드백 구현 후 관련 테스트와 화면 흐름을 직접 확인한다. 실제 작업자 평가·30초 UX 목표는 별도이며 개발 테스트로 달성했다고 쓰지 않는다.

SOP 검색·LLM Agent는 그다음 단계다. 실제 근거 자료가 없으면 진단을 보류한다. 화면 개발 또는 성능 개선에 기존 test 표본을 반복 사용하지 않는다.

## 재현 명령

프로젝트 루트에서 실행한다:

```powershell
node --test tests/baseline.test.mjs tests/events.test.mjs
node src/import-events.mjs
node src/server.mjs
```

실행 중인 기본 포트 서버의 확인은 별도 터미널에서 `node tools/smoke-api.mjs`. `powershell.exe -NoProfile -File tools/check.ps1`은 준비 구조와 현재 통합 테스트를 실행한다. 원본이 없으면 `tools/download-data.ps1`을 사용하며 코드/설정 변경으로 해시가 달라졌다면 기존 결과를 검토한 뒤 명시적으로 기준선을 재생성한다.

매 세션에 전체 기획·문서·데이터를 다시 조사하지 않는다. 현재 기능에 필요한 코드와 자료만 읽고, 테스트는 변경과 연결된 범위 및 필수 통합 검사로 제한한다. 사용량 잔여량은 확인한 값만 말한다.
