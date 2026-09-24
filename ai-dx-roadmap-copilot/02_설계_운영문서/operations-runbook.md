# 로컬 파일럿 운영 runbook

이 문서는 `.`의 로컬 파일럿을 재현·점검·중지·백업하는 절차다. 현재 제품은 상용 운영 서비스가 아니며, 이 절차도 단일 Windows 프로세스와 로컬 파일 저장소를 전제로 한다.

## 1. 실행 전 점검

PowerShell에서 프로젝트 폴더로 이동한 뒤 다음 명령을 실행한다.

```powershell
cd .
npm.cmd run verify
```

`verify`가 실패하면 서버를 시작하지 않고 실패한 테스트·입력·문서를 먼저 확인한다. 성공하면 다음 결과를 확인한다.

- 테스트 전체 통과
- `offline_deterministic` 실행 모드
- `externalApiCalled: false`
+ 추천 결과와 `03_검증리포트_진행기록/demo-run.json`, `03_검증리포트_진행기록/demo-run.md` 생성

## 2. 로컬 서버 시작

```powershell
cd .
$env:NODE_ENV = 'development'
$env:DT_STORAGE_DIR = '.\01_입력데이터_실행기록\실행기록'
npm.cmd start
```

브라우저에서 `http://127.0.0.1:8766`을 열고 개발용 토큰 `local-demo-token`을 사용한다. 이 토큰은 로컬 데모용이며 실제 API 키나 Astra 자격증명이 아니다.

## 3. 정상 파일럿 시나리오

1. 샘플 과제를 실행한다.
2. 새 과제 제목·문제·KPI·점수를 입력한다.
3. 필요하면 공개자료의 제목과 `http(s)` URL을 추가한다.
4. 후보별 승인·반려·보류와 사유를 기록한다.
5. 실제로 측정한 KPI 기준값과 측정 출처를 입력한다.
6. 기준값 등록 뒤에도 목표값은 사람 검토 상태로 남는지 확인한다.

API를 직접 호출할 때 `POST /v1/runs`에는 `Idempotency-Key` 헤더가 필수다. 같은 키와 같은 입력은 기존 실행을 재사용하고, 같은 키에 다른 입력을 보내면 `409 idempotency_conflict`가 반환된다.

## 4. 감사 이력 확인

브라우저 개발자 도구 또는 PowerShell에서 실행별 감사 이력을 조회한다.

```powershell
$token = 'local-demo-token'
Invoke-RestMethod `
  -Uri 'http://127.0.0.1:8766/v1/audit?runId=<RUN_ID>' `
  -Headers @{ Authorization = "Bearer $token" }
```

실행 생성, 사람 결정, KPI 기준값 등록 이벤트가 각각 기록되어야 한다. 입력·점수·KPI가 합성인지 실제 측정인지도 결과의 제한사항에서 확인한다.
응답의 `integrity.valid`가 `true`인지 확인한다. `false`이면 감사 JSONL을 운영 증거로 사용하지 말고 백업과 변경 이력을 보존한 뒤 원인을 조사한다.

## 5. 중지와 백업

서버 콘솔에서 `Ctrl+C`로 중지한 뒤, 저장소 전체를 별도 위치에 복사한다. 원본을 삭제하거나 덮어쓰지 않고 날짜가 있는 백업 폴더를 사용한다.

```powershell
$backup = '.-backups\runtime-YYYYMMDD-HHmm'
Copy-Item `
  -LiteralPath '.\01_입력데이터_실행기록\실행기록' `
  -Destination $backup `
  -Recurse
```

백업 대상에는 실행 JSON, 멱등성 기록, 감사 JSONL이 포함된다. 고객·개인정보를 넣지 않는 현재 합성 파일럿에서만 이 로컬 절차를 사용한다.

## 6. 복구

기존 저장소 위에 덮어쓰지 말고 별도 복구 경로를 지정해 먼저 확인한다.

```powershell
$env:DT_STORAGE_DIR = '.-restore\runtime-YYYYMMDD-HHmm'
npm.cmd start
```

복구한 실행을 조회하고 감사 이력이 읽히는 것을 확인한 뒤에만 운영 검토를 진행한다. 파일 저장소는 다중 프로세스·고가용성 저장소가 아니므로 PostgreSQL 마이그레이션 전까지 단일 프로세스로 제한한다.

## 7. 실패 대응

| 증상 | 확인 | 대응 |
|---|---|---|
| `401 unauthenticated` | Bearer 토큰 | 로컬 토큰 또는 설정된 테스트 토큰 확인 |
| `400 idempotency_key_required` | 실행 요청 헤더 | 새 `Idempotency-Key` 발급 |
| `409 idempotency_conflict` | 같은 키의 입력 변경 | 새 키를 사용하거나 기존 실행을 검토 |
| `422 invalid_initiative_input` | 후보·KPI·출처 입력 | 빈 값, 점수 범위, 후보 근거, `http(s)` URL 확인 |
| 기준값이 `baseline_required` | 측정값 미등록 | 실제 업무 로그와 측정 출처를 사람이 등록 |
| 서버 재시작 후 데이터 불일치 | `DT_STORAGE_DIR` | 동일 저장소 경로와 백업 상태 확인 |

외부 API·Astra 장애를 현재 파일럿의 실패로 표현하지 않는다. 현재는 외부 API를 호출하지 않으며, Astra 연결은 별도 검증 전까지 미구현 상태다.

## 8. 상용 전환 게이트

다음 항목이 검증되기 전에는 `production`, `commercial`, 실제 industrial-automation 적용 성공이라고 표시하지 않는다.

- PostgreSQL 기반 영속 저장소와 마이그레이션·롤백
- OIDC/SSO·실제 RBAC·테넌트 격리
- 비밀값 관리, PII 분류·마스킹, 보존·삭제·내보내기 정책
- 데이터 커넥터와 원문·해시·수집시각을 포함한 evidence store
- 관측성, rate limit, 백업·복구 자동화, 장애 대응
- 공개·합성 데이터로 재현되는 평가셋과 릴리스 품질 게이트
