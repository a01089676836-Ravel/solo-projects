# 코드로 읽는 제조 이상탐지 Agent

개발을 처음 시작하면 파일이 많아 보여서 “이 코드가 왜 필요한가?”를 놓치기 쉽다. 이 문서는 코드를 한 줄씩 해설하는 문서가 아니라, 각 모듈이 어떤 의도와 결과물을 위해 존재하는지 쉽게 찾는 안내서다.

## 1. 먼저 이 한 문장만 기억하기

이 프로젝트는 **LLM이 설비를 움직이는 프로젝트가 아니라, 센서 데이터를 사건으로 바꾸고 안전 판단과 Agent 안내를 분리한 프로젝트**다.

전체 흐름은 다음과 같다.

```text
센서 관측값
  → 입력 형식 통일
  → 특징값·정상 기준선·이상 점수
  → 로컬 안전 상태와 액추에이터 출력
  → evidence가 있는 사건
  → MES 문맥/API로 조회
  → 승인된 SOP와 Agent 안내
  → 사람 확인·후속 추세 확인
```

코드를 읽을 때는 항상 다음 다섯 가지를 물어보면 된다.

1. 무엇을 입력받는가?
2. 어떤 기준으로 판단하는가?
3. 누가 설비를 안전하게 멈추는가?
4. 어떤 결과물을 밖으로 내보내는가?
5. 근거가 없거나 실패하면 어떻게 멈추는가?

## 2. 실행하면 어떤 순서로 흐르는가

가장 이해하기 쉬운 실행 명령은 다음이다.

```powershell
npm.cmd run agent:local-run -- temperature_rise -VirtualMes
```

코드의 호출 흐름은 이렇다.

```text
tools/run-local-agent.ps1
  → src/agent-api.mjs:runIncidentWithAgent
      → trainDemoModel
      → runScenario
          → inspectWindow
              → 특징값 계산
              → 이상 점수 계산
              → 로컬 FSM 상태 결정
              → evidence·actuator가 있는 event 생성
      → 선택적으로 MES-lite 문맥 부착
      → local LLM 호출
      → JSON 검증·grounding gate
      → 실패하면 결정적 SOP fallback
```

따라서 LLM이 응답하지 않아도 센서 판단과 안전 출력은 계속 코드로 남아 있어야 한다. 이 구조가 이 프로젝트의 가장 중요한 설계 의도다.

## 3. 핵심 모듈을 역할로 외우기

| 파일 | 쉽게 말하면 | 주요 함수 | 만들어 내는 것 |
|---|---|---|---|
| `src/agent-harness.mjs` | 센서와 안전판 | `normalizeObservation`, `buildFeatureVector`, `fitNormalModel`, `inspectWindow` | 정상 기준선, 이상 점수, `event`, 액추에이터 상태 |
| `src/agent-api.mjs` | 근거를 읽어 설명하는 비서 | `buildAgentMessages`, `parseAgentJson`, `groundedRemotePlan`, `callAgentApi` | 검증된 Agent plan 또는 fallback |
| `src/mes-lite.mjs` | 작업표·운전 상태 메모장 | `normalizeMesContext`, `attachMesContext`, `transitionMesState` | Work Order·Lot·Operation·Equipment·운전 문맥 |
| `src/tep-mode.mjs` | 외부 실험장 기준선 | `fitTepModeBaseline`, `scoreTepSeries`, `evaluateTepSeries` | 모드별/전역 점수 비교, persistence·모드 전환 결과 |
| `src/events.mjs` | 사건을 저장하는 서랍 | `loadDevelopmentEvents`, `openEventStore` | SQLite 사건 저장·중복 방지·읽기 검증 |
| `src/server.mjs` | 사건을 조회하는 창구 | `createApiServer` | `/health`, `/events`, 사건 상세 API |
| `src/feedback.mjs` | 사람의 검토 메모 | `openFeedbackStore` | 검토 대기 피드백 |

비유로 외우면 `agent-harness`는 안전판, `agent-api`는 비서, `mes-lite`는 작업표, `tep-mode`는 외부 실험장, `events/server`는 기록 서랍과 조회 창구다.

## 4. `agent-harness.mjs`: 센서에서 사건까지

### 4-1. `normalizeObservation` — 입력을 같은 모양으로 만든다

위치: `src/agent-harness.mjs:67`

온도·초음파·카메라·모터·서보가 제각각 들어오면 뒤의 코드가 매번 다른 형식을 처리해야 한다. `normalizeObservation`은 입력을 하나의 observation schema로 맞추고, 온도 범위·센서 상태·명령값·`equipmentId`·`runId`를 검사한다.

의도는 “예쁜 데이터 만들기”가 아니라 **잘못된 입력이 판단 단계까지 조용히 흘러가지 않게 하는 것**이다.

결과 예시는 다음과 같다.

```text
timestamp + equipmentId + runId
temperatureC + ultrasonicDistanceCm
motor/servo command + motion feedback
sensor health + camera/person information
```

### 4-2. `createJsonlCollector` — 관측값을 기록한다

위치: `src/agent-harness.mjs:147`

`append`는 정규화한 관측값을 JSONL로 저장하고, `read`는 다시 읽어 같은 검사를 통과시킨다. 실제 Jetson 어댑터를 나중에 붙이더라도 같은 schema를 사용하게 하려는 경계다.

### 4-3. `buildFeatureVector` — 여러 관측값을 판단용 특징으로 바꾼다

위치: `src/agent-harness.mjs:179`

10개의 관측 window를 받아 현재 온도, 평균 온도, 온도 상승 속도, 거리 변화, 모터 불일치, 에코 품질, 카메라-초음파 차이, 센서 상태 비율 등 16개 특징을 만든다.

여기서 중요한 점은 LED·버저·서보의 **출력 결과를 이상 특징으로 다시 사용하지 않는 것**이다. 출력이 원인처럼 모델에 되먹임되는 누수를 막기 위해 센서 관측과 제어 결과를 구분했다.

### 4-4. `fitNormalModel` — 정상만 보고 기준선을 만든다

위치: `src/agent-harness.mjs:231`

정상 window의 평균만 사용하지 않고 median, MAD, IQR을 이용한 robust scale을 계산한다. 정상값이 거의 일정할 때는 센서별 `minimumScale`을 적용하되, 그 특징을 `degenerateFeatures`에 남긴다.

즉, 점수를 작게 보이도록 숨기는 것이 아니라 다음처럼 알린다.

```text
정상 기준의 변동이 부족하다
→ 센서 최소 변동폭으로 보정했다
→ 이 기준선은 아직 현장 검증이 아니다
```

`fitNormalModelWithHoldout`(`src/agent-harness.mjs:326`)은 최신 독립 `runId`를 학습에서 제외하고 holdout 오경보를 확인한다. 그래서 test 결과를 보고 threshold를 뒤에서 맞추는 흐름을 피한다.

### 4-5. `inspectWindow` — 숫자를 운영 사건으로 바꾼다

위치: `src/agent-harness.mjs:388`

이 함수가 핵심 연결부다.

```text
window
  → feature vector
  → anomaly score
  → 센서 고장·온도 규칙·사람 접근·모션 불일치 확인
  → NORMAL / ANOMALY / WARNING / EMERGENCY
  → LED·버저·서보 출력
  → evidence와 limitations가 있는 event
```

예를 들어 사람 접근은 `WARNING` 또는 `EMERGENCY`가 되고, 온도 상승은 `ANOMALY`가 된다. 이 상태와 액추에이터 출력은 `inspectWindow` 안의 로컬 코드가 결정한다. LLM은 이 결과를 바꾸지 않는다.

### 4-6. `buildAgentPlan`·`runMaintenanceAgent` — 처음에는 결정적인 비서로 시작한다

위치: `src/agent-harness.mjs:458`, `src/agent-harness.mjs:490`

`buildAgentPlan`은 사건 상태에 맞는 점검 방향과 사람 확인 여부를 만든다. `runMaintenanceAgent`는 evidence에 맞는 승인 SOP를 검색하고 `toolTrace`와 `evidenceRefs`를 남긴다.

이렇게 먼저 고정된 Agent를 둔 이유는 LLM의 답변과 비교할 기준이 필요하기 때문이다. LLM이 없어도 같은 사건에 대해 안전한 fallback 결과가 있어야 한다.

### 4-7. `verifyRecovery` — 조치 후를 처음 사건과 분리한다

위치: `src/agent-harness.mjs:511`

처음 이상을 감지한 것과 조치 후 정상으로 돌아왔는지는 다른 질문이다. `verifyRecovery`는 follow-up window를 다시 검사하고, 정상이어도 사람 승인 후 재가동하도록 결과를 분리한다.

## 5. `agent-api.mjs`: LLM의 역할과 금지선을 코드로 만든다

### 5-1. `buildAgentMessages` — LLM에 사실만 전달한다

위치: `src/agent-api.mjs:46`

LLM에 전달하는 사실은 상태, score/threshold, feature, evidence, limitations, actuator 결과, 선택적 MES 문맥이다. 시스템 지시에는 고장·원인 확정 금지, GPIO·모터·비상정지 명령 금지, Work Order·Lot·운전 상태 생성·변경 금지가 들어 있다.

### 5-2. `parseAgentJson` — 형식을 검사한다

위치: `src/agent-api.mjs:76`

응답이 JSON인지, 상태·문자열 배열·evidence ID·SOP ID·사람 확인 flag가 올바른지 확인한다. 형식이 틀리면 정상 결과처럼 사용하지 않는다.

### 5-3. `groundedRemotePlan` — 자유 문장을 그대로 믿지 않는다

위치: `src/agent-api.mjs:98`

원격 LLM이 고른 `evidenceIds`는 실제 event evidence 범위 안에 있는지, `sopIds`는 승인된 SOP 목록에 있는지 다시 확인한다. 통과한 뒤에도 관찰 내용은 event evidence에서, 점검 항목은 승인 SOP에서 다시 구성한다.

그래서 LLM이 다음처럼 말해도 그대로 사용자에게 전달되지 않는다.

```text
“invented claim”
“아마 베어링이 고장났다”
“모터를 지금 켜라”
```

코드에 실제 근거가 없으면 사용할 수 없다.

### 5-4. `callAgentApi`와 `runIncidentWithAgent` — 실패하면 fallback한다

위치: `src/agent-api.mjs:139`, `src/agent-api.mjs:172`

API 미설정, timeout, HTTP 오류, 잘못된 JSON, grounding 실패는 로컬 `runMaintenanceAgent`로 돌아간다. `useVirtualMes: true` 또는 `-VirtualMes`를 사용하면 가상 MES 문맥만 추가되고, 안전 출력은 그대로 로컬 FSM 결과다.

## 6. `mes-lite.mjs`: 실제 MES가 아니라 문맥 경계다

위치: `src/mes-lite.mjs:11`

`normalizeMesContext`는 Work Order, Lot, Product, Recipe, Operation, Equipment, `runId`, `processModeId`, `operationMode`, `executionState`를 검사한다. `attachMesContext`는 event와 `equipmentId`·`runId`가 맞을 때만 붙인다.

여기서 꼭 구분할 두 가지가 있다.

- `processModeId`: 공정 운전 조건. 예: `MODE_1`, `MODE_3`, `MODE_4`
- `operationMode`: 장비 실행 방식. 예: `AUTO`, `MANUAL`, `SIMULATE`

`createVirtualMesContext`(`src/mes-lite.mjs:38`)는 현재 온도 데모용이고, `createTepBenchmarkMesContext`(`src/mes-lite.mjs:55`)는 TEP 외부 벤치마크용이다. 둘 다 실제 MES 조회가 아니다.

## 7. `tep-mode.mjs`: 외부 데이터로 모드와 시간 변화를 확인한다

### 7-1. 왜 별도 모듈인가

TEP는 화학공정 시뮬레이션이고, 현재 Jetson 센서 데이터와 물리적 의미가 다르다. 따라서 `agent-harness`의 센서 모델에 섞지 않고, 모드 기준선이 필요한 상황을 별도로 검증한다.

### 7-2. 기준선과 시간 판정

- `fitTepModeBaseline`(`src/tep-mode.mjs:96`): Mode 1·3·4별 정상 기준선
- `fitTepGlobalBaseline`(`src/tep-mode.mjs:112`): 모든 정상 모드를 합친 전역 기준선
- `scoreTepRow`(`src/tep-mode.mjs:122`): 한 행의 점수
- `scoreTepSeries`(`src/tep-mode.mjs:138`): 연속 행과 모드 전환을 반영한 운영 상태
- `evaluateTepSeries`(`src/tep-mode.mjs:185`): 경보 행·대기 행·경보 구간 집계

현재 설정은 단일 초과를 `PENDING_ANOMALY`, 3행 연속 초과를 `ANOMALY`, 모드 전환 직후 2행을 `MODE_TRANSITION`으로 처리한다. 이는 실제 제조 규정이 아니라 현재 데이터로 판단 보류 구조를 확인하기 위한 데모 설정이다.

## 8. 이 코드가 최종적으로 내보내는 결과물

코드가 단순히 `true/false`만 내보내는 것이 아니라 다음 결과물을 만든다.

```text
1. observation JSONL       : 무엇을 관측했는가
2. feature vector           : 관측값을 어떻게 요약했는가
3. anomaly score/threshold  : 정상 기준과 얼마나 다른가
4. event                   : 상태·근거·한계·액추에이터 결과
5. MES context             : 어느 작업·Lot·공정·설비·운전 상태인가
6. Agent plan              : 어떤 SOP를 확인할 것인가
7. toolTrace/evidenceRefs  : Agent가 무엇을 참고했는가
8. feedback                : 사람이 검토 후 무엇을 남겼는가
```

이 구조를 만들려 했기 때문에 특정 모델의 답변보다 데이터 흐름, 안전 경계, 실패 처리, 운영 기록이 중요해졌다.

## 9. 현재 구현과 아직 구현하지 않은 것

현재 코드로 확인한 것:

- 센서 입력 형식과 run 단위 기록
- 정상 기준선·robust scaling·holdout
- 이상 상태와 로컬 액추에이터 출력
- 사건 저장·조회·검토 피드백
- 승인 SOP와 Agent fallback
- 로컬 LLM JSON 연동과 grounding gate
- 가상 MES 문맥
- TEP 모드 기준선·persistence·모드 전환 보류

아직 구현·검증하지 않은 것:

- 실제 Jetson GPIO/I2C 드라이버
- 실제 MES나 Eclipse BaSyx 설치·운영
- 실제 반도체 FAB 데이터
- 실제 Digital Twin 플랫폼
- Cloud/Kubernetes/HPC 운영
- 현장 작업자의 사용성 평가
- fault 데이터에 대한 일반화·recall·탐지 지연

## 10. 기억하기 쉬운 최종 문장

**데이터는 `agent-harness`가 판단하고, 안전은 로컬 FSM이 지키고, 문맥은 `mes-lite`가 붙이고, Agent는 승인된 근거를 찾아 설명하며, 실패하면 fallback한다.**

이 한 문장을 기억하면 각 파일을 읽을 때 “이 파일이 이 흐름의 어느 부분인가?”를 바로 찾을 수 있다.
