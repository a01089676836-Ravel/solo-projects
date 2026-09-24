# 제품 계약 초안

상용화를 염두에 둔 API·데이터 경계 초안이다. 현재는 로컬 파일 저장소 기반 Phase 1 파일럿 API를 구현했으며, 아래 계약은 PostgreSQL·OIDC/SSO로 교체할 때도 유지할 경계다.

## 리소스

### `initiative`

```json
{
  "id": "dx-001",
  "title": "AI/DX 과제 제목",
  "problem": "검증 가능한 문제 정의",
  "ownerId": "user-or-group-id",
  "evidenceRefs": ["evidence-001"],
  "scoreConfigVersion": "dt-portfolio-rubric-v1",
  "status": "draft"
}
```

### `decision`

```json
{
  "id": "decision-001",
  "initiativeId": "dx-001",
  "status": "review_required",
  "decisionBy": null,
  "decisionAt": null,
  "reason": "기준값 측정 후 심의 필요",
  "runId": "run-20260922-001"
}
```

허용 상태는 `draft`, `review_required`, `approved`, `rejected`, `paused`, `archived`다. AI는 `review_required` 초안을 만들 수 있지만 `approved`로 직접 변경할 수 없다.

## Phase 1 API 초안

### `POST /v1/runs`

후보 과제와 루브릭 버전을 받아 점수·KPI 초안·로드맵을 생성한다.

- 인증: OIDC 토큰에서 `tenantId`, `workspaceId`, `userId`를 파생한다.
- 클라이언트가 보낸 `tenantId`를 권한 판단의 근거로 신뢰하지 않는다.
- 멱등성 키를 요구한다.
+ 현재 로컬 파일럿은 `Idempotency-Key`를 테넌트·워크스페이스 범위의 입력 해시와 함께 `01_입력데이터_실행기록/실행기록/idempotency/`에 저장한다. 같은 키와 같은 입력은 기존 `runId`를 재반환하고, 다른 입력은 `409 idempotency_conflict`로 거부한다.
- 로컬 파일럿의 fixture 실행은 `additionalReferenceSources`로 공개자료 메타데이터를 추가할 수 있으며, 후보의 `evidenceRefs`가 해당 출처를 가리키는지와 `http(s)` URL인지 검증한다. URL 원문을 서버가 자동 수집하지는 않는다.
- 결과는 `runId`, 입력 해시, 루브릭 버전, 근거 참조, 제한사항을 포함한다.

### `GET /v1/runs/{runId}`

결과와 증거·점수·KPI 보류 사유·사람 검토 상태를 반환한다. 원문 접근권한이 없으면 원문을 노출하지 않고 메타데이터만 반환한다.

### `POST /v1/decisions/{decisionId}`

사람의 승인·반려·보류를 기록한다.

- 서버에서 역할과 승인 범위를 재검증한다.
- `viewer`는 조회만 가능하고, 승인·반려·보류·KPI 기준값 등록은 `reviewer` 또는 `admin` 역할이 필요하다.
- 결정 사유와 현재 근거 버전을 필수로 한다.
- 불변 감사 이벤트를 먼저 기록한 뒤 상태를 변경한다.

현재 로컬 파일럿은 `POST /v1/runs/{runId}/decisions`에서 승인·반려·보류 사유를 실행 결과의 후보 상태와 감사 이벤트에 함께 기록한다. AI가 사람 결정을 대신 확정하지는 않는다.

### `GET /v1/audit?runId={runId}`

입력·점수·LLM 제안·사람 수정·승인·반려·오류를 시간순으로 조회한다. 현재 로컬 파일럿은 이벤트마다 이전 이벤트 해시와 현재 이벤트 해시를 기록하고, 응답의 `integrity.valid`로 파일 변조 여부를 확인한다.

### `POST /v1/runs/{runId}/baselines`

사람이 KPI 기준값과 측정 출처를 등록한다. 기준값이 등록되어도 목표값은 자동 승인하지 않고 `human_review_required`로 남긴다.

```json
{
  "candidateId": "dx-001",
  "metric": "과제 접수부터 파일럿 승인까지의 평균 리드타임",
  "value": 12.5,
  "unit": "일",
  "source": "가상 업무 승인 로그"
}
```

## 오류 계약

- `400 invalid_json`: 요청 본문이 JSON 객체가 아님
- `400 idempotency_key_required`: 실행 생성 요청에 멱등성 키가 없음
- `400 invalid_request`: 스키마·점수·출처 필드가 잘못됨
- `415 unsupported_media_type`: JSON API에 `application/json`이 아님
- `401 unauthenticated`: 인증 토큰 없음 또는 만료
- `403 forbidden`: 워크스페이스·리소스 권한 없음
- `409 idempotency_conflict`: 동일 키의 입력이 다름
- `422 invalid_initiative_input`: 후보·KPI·출처 형식 또는 근거 연결이 잘못됨
- `429 rate_limited`: 요청량 제한
- `503 dependency_unavailable`: LLM·커넥터 등 외부 의존성 장애

## 보안 원칙

- Phase 0 픽스처에 비밀값·고객 데이터·개인정보를 넣지 않는다.
- Phase 1부터 테넌트 격리·RBAC·감사 로그를 테스트 없이는 구현 완료로 표시하지 않는다.
- LLM provider가 바뀌어도 정책·근거·승인 계층은 동일하게 유지한다.
