# Evidence-grounded maintenance Agent system

이 문서는 현재 저장소에서 실제 실행되는 범위만 설명한다. 실제 Jetson GPIO/I2C 제어, 현장 SOP 연동, 운영자 사용성 평가는 포함하지 않는다.

2026-09-21 기본 런타임: `gpt-6-astra` / OpenAI Chat Completions. 설정은 `config/agent-runtime.json`, 인증은 로컬 `.env` 또는 환경변수의 `OPENAI_API_KEY`다. `agent:smoke`가 실연결 여부를 별도 검사한다. 현재 SOP는 프로젝트 예제이며 실제 현장 승인 문서가 아니다.

## 시스템 경계

```text
관측 window
  -> normalizeObservation
  -> normal-reference anomaly score
  -> local safety decision / actuator intent
  -> approved SOP lookup
  -> optional LLM selection of evidence IDs and SOP IDs
  -> local grounding gate
  -> operator confirmation
  -> follow-up window recovery verification
```

### 권한 분리

| 영역 | 현재 권한 | 실패 시 동작 |
|---|---|---|
| 관측·정규화·특징 | 로컬 코드 | 입력 거부 |
| 이상 점수·상태·액추에이터 의도 | 로컬 결정 로직 | 안전한 로컬 결과 유지 |
| SOP 검색 | 승인된 로컬 인덱스 | `unavailable` 및 판단 보류 |
| LLM | evidence/SOP ID 선택 | timeout·잘못된 JSON·무근거 선택 시 fallback |
| 재가동 | 사람 승인 | 자동 재가동 금지 |

LLM의 자유 문장, 센서 측정값, 고장 원인, 액추에이터 명령은 최종 운영 출력의 근거로 직접 사용하지 않는다. `src/agent-api.mjs`가 로컬 이벤트와 승인된 SOP에서 최종 계획을 재구성한다.

## 런타임 스킬

`agent-skills/manifest.json`을 실행 기준으로 사용한다. 각 문서에는 같은 스킬의 사람이 읽을 수 있는 운영 규칙을 둔다. 이는 앱 내부 프롬프트 모듈이며 Codex 개인 스킬 설치를 뜻하지 않는다. 지침이 모두 실행 코드로 강제되거나 검증됐다는 뜻도 아니다.

- `verification-first`: 관측 사실과 제한사항을 우선한다.
- `grounding-gate`: 허용된 evidence/SOP ID만 선택한다.
- `safe-escalation`: 비정상 상태에서 사람 확인과 읽기 전용 점검만 허용한다.
- `recovery-verification`: 후속 window로 회복을 따로 확인하고 재가동은 승인으로 남긴다.

`src/skill-registry.mjs`는 이벤트 상태에 따라 스킬을 선택하고, `buildAgentMessages`는 활성 스킬과 버전을 Agent에 전달한다. 스킬은 안전 경계를 대체하지 않고, 코드로 구현된 검증과 함께 사용된다.

## 파이프라인 계약

`src/reliable-pipeline.mjs`의 `runReliableScenario`는 데모 시나리오를, `runReliableObservations`는 실제 수집과 동일한 observation schema의 window를 받는다.

두 경로 모두 다음 결과를 반환한다.

- `event`: 로컬 관측·특징·상태·액추에이터 의도
- `agent`: `remote_api` 또는 `fallback`과 근거 기반 plan
- `pipeline`: 단계별 상태, 활성 스킬, 권한 분리, 제한사항

실제 관측 경로는 `modelForDetection`을 명시적으로 요구한다. 데모 정상 데이터로 현장 센서 기준선을 몰래 학습하지 않기 위한 조건이다.

## 하네스와 완료 게이트

```powershell
npm.cmd test
npm.cmd run agent:harness
npm.cmd run pipeline:check
```

하네스는 정상·온도 상승·동작 불일치·작업자 경고·비상 접근, 오프라인 fallback, 악성 evidence ID, 승인되지 않은 SOP 선택을 확인한다. 이 검사는 코드 경계와 회귀를 확인할 뿐이며, 실제 현장 적합성이나 작업자 UX 성과를 증명하지 않는다.

## 비용 없는 개발·신뢰성 비교

API 크레딧이 없을 때도 `npm.cmd run agent:offline-run -- temperature_rise`로 외부 호출 없는 결정론적 fallback을 검증할 수 있다. 로컬 Qwen이 준비된 경우 `npm.cmd run agent:local-llm` 뒤 `npm.cmd run agent:local-check`로 loopback 모델과 다섯 합성 시나리오의 구조화 응답, 근거 일치, 사람 승인, 액추에이터 권한 분리를 확인한다.

`npm.cmd run agent:reliability-compare`의 기준 정책은 실제 과거 버전이 아니라, 근거 게이트가 없는 느슨한 비교용 reference다. 현재 어댑터가 발명된 evidence, 미승인 SOP, 승인 우회, 중복 참조를 fallback으로 막고 자유 문장을 최종 plan에서 제거하는지 같은 입력으로 비교한다. 이 결과는 시스템 경계의 개선 증거이지, 모델의 지능·Astra 실시간 품질·현장 안전을 증명하지 않는다.

## Astra 전환 경계

Codex의 개발 모델을 바꾸는 것은 저장소의 런타임 동작을 바꾸지 않는다. 런타임 Agent를 `gpt-6-astra`로 지정하는 경우에도 로컬 안전 FSM·grounding gate·fallback·하네스의 역할은 유지된다.

현재 어댑터는 Astra 요청에서 `temperature`를 보내지 않도록 분기한다. 이 프로젝트는 Chat Completions의 구조화 응답만 사용하고 LLM에 도구 실행 권한을 주지 않으므로, 당장 전체 Responses API 전환은 필요하지 않다. 향후 LLM이 직접 도구를 호출하도록 확장할 때는 Responses API와 도구별 권한·호출 한도를 별도로 설계해야 한다.
