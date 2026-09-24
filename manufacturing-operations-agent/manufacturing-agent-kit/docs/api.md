# 사건 저장·조회 API

현재 기능은 AI4I 합성 표본의 임계값 초과 알림을 SQLite에 저장하고 읽는 로컬 API다. 실제 설비의 고장 사건으로 해석하지 않는다.

## 실행

프로젝트 폴더에서 Node.js 24.19.0을 사용한다. 추가 npm 패키지나 API 키는 필요 없다.

```powershell
node src/import-events.mjs
node src/server.mjs
```

API는 `127.0.0.1:8765`에서 실행된다. 종료는 실행 터미널에서 Ctrl+C. 다른 포트는 시작 전에 PowerShell에서 `$env:PORT='8766'`처럼 지정한다. DB가 없으면 서버가 시작하지 않으며 먼저 import 명령을 안내한다.

다른 터미널에서 확인한다:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8765/events?limit=1'
node tools/smoke-api.mjs
```

smoke 명령은 기본 포트 8765의 실행 중인 서버를 검사하고 `reports/api-smoke.json`을 저장한다.

## 계약

| 요청 | 정상 응답 | 주요 실패 |
|---|---|---|
| GET /health | 200, status 및 실행 모드 | DB 사용 불가: 503 |
| GET /events?limit=50&offset=0 | 200, items/total/limit/offset | 범위·중복·미지원 쿼리: 400 |
| GET /events/{eventId} | 200, 저장된 사건 전체 | ID 형식 오류: 400, 유효한 없는 ID: 404 |

limit는 1~100, offset은 0 이상의 안전 정수다. 목록은 sampleId와 eventId 순서로 정렬한다. 범위 밖 offset은 빈 items와 전체 total을 반환한다. ID는 목록에서 얻은 `evt_`+64자리 소문자 SHA256을 사용한다. 미지원 경로는 404, GET 외 메서드는 405, 저장소 오류는 상세 내부 정보를 제외한 `storage_unavailable` 코드와 503을 반환한다.

## 데이터 의미와 중복 처리

- CSV·설정·기준선 코드의 해시가 기존 baseline 결과와 일치해야 가져온다. 저장된 정규화 계수와 임계값을 사용하며 재학습·test 재평가를 하지 않는다.
- `max_abs_z`를 인터페이스용 고정 기준선으로 사용한다. test 지표를 근거로 우승 모델을 선정한 것이 아니다. validation 6101~8000 중 임계값 초과 114개가 현재 대상이다.
- `eventId`는 데이터 해시·모델 fingerprint·표본 번호에서 결정한다. fingerprint는 정규화 계수·임계값·코드/설정 출처를 포함한다. 같은 입력 재처리는 최초 storedAt을 유지하고 건수를 늘리지 않는다.
- 같은 ID에 다른 내용이 들어오면 오류로 처리하며 해당 묶음 저장을 전부 되돌린다. SQL 값은 매개변수 바인딩으로 전달한다.
- API는 SQLite를 읽기 전용으로 열며 생성·수정 엔드포인트가 없다. 별도 import 명령만 저장한다.
- `observedAt`과 `equipmentId`는 null, `freshness.status`는 unknown이다. `storedAt`은 DB 저장 시각으로 관측 시각이 아니다. 표본 번호는 시간으로 변환하지 않는다.
- `status=open`은 알림 작업 상태, `severity=unassigned`는 심각도 판단 미실시를 뜻한다. 센서·운전 변수 5개의 값과 단위, score/threshold, 합성 표시와 한계를 함께 반환한다. 정답 라벨은 점검 응답에 노출하지 않는다.

## 완료 기준과 검증

`node --test tests/baseline.test.mjs tests/events.test.mjs`: 기존 기준선 6개와 저장/API 8개 검사.
새 검사는 실제 파일 DB 재개방, 중복 저장, 충돌 시 원자성, 결측/비유한 값/출처 위조 거부, 페이지 순서, 실제 HTTP 상세 조회, 잘못된 요청, DB 오류를 다룬다. 실제 시각이 없으므로 오래된 관측의 판정 대신 unknown 계약을 검증했다.

실행 환경에서 내장 SQLite 3.53.3을 확인했다. 구현 참고: [Node.js 24 SQLite 공식 문서](https://nodejs.org/download/release/v24.8.0/docs/api/sqlite.html), 2026-09-07 확인. 문서는 24.8.0판이며 실제 호환성은 고정 환경 24.19.0에서 검증했다.

다음 단계는 목록·상세 작업자 화면과 검토 대기 피드백 저장이다. 현재 UI·SOP 검색·LLM Agent·실제 작업자 평가는 미구현이다.

## 작업대와 의견 저장 (2026-09-07)
GET / 는 작업자 HTML 화면. 사건 조회 API는 기존과 동일.
POST /events/{eventId}/feedback: Content-Type application/json, Idempotency-Key 8~128 영문/숫자/밑줄/하이픈. 본문 verdict=yes|no|unknown, note=최대 2000자 문자열. 새 저장 201, 동일 키·동일 내용 200, 키 충돌 409. 잘못된 입력 400, 없는 사건 404, 외부 Origin 403, 저장 불가 503. 결과 reviewStatus=pending_review. 별도 data/feedback.sqlite 저장; 사건/모델 변경 없음.
실행: 프로젝트 폴더에서 node src/server.mjs. http://127.0.0.1:8765/ 접속. 개인 로컬 시제품이며 외부 공개·인증 다중사용자 운영 미지원.
