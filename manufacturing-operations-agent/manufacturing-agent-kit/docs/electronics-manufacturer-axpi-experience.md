# electronics-manufacturer DS AX/PI 지원용 경험 정리 초안

> 이전 대화에서 만든 초안이다. 최신 경험 정리는 [experience-summary.md](experience-summary.md), 코드 기반 해설은 [code-intent-guide.md](code-intent-guide.md)를 기준으로 본다.

이 문서는 현재 구현된 사실을 electronics-manufacturer DS AX/PI 직무에서 관심을 가질 만한 업무 흐름과 연결해 정리한 것이다. 지원 시점의 공고·직무기술서가 바뀌면 표현을 다시 대조한다. electronics-manufacturer 조직의 실제 내부 분장이나 현장 성과를 추정해 적지 않는다.

## 1. 이 프로젝트에서 해결하려 한 문제

온도·거리·카메라·모터·서보 센서가 들어오는 소형 제조 장비에서 이상을 감지한 뒤, 단순히 “이상”이라는 숫자만 보여주는 데서 끝내지 않고 작업자가 확인할 근거와 다음 점검 항목을 얻도록 만드는 것이 목적이었다.

AI가 고장 원인이나 안전 정지를 마음대로 결정하게 하는 것이 목적은 아니었다. 측정값이 부족하거나 충돌할 때도 고장을 확정하지 않고, 사람에게 확인을 넘길 수 있는 구조가 더 중요하다고 판단했다.

## 2. 구현 의도와 선택 근거

| 결정 | 선택한 방법 | 근거 |
|---|---|---|
| 센서 입력 표준화 | 실제 어댑터와 모의 시나리오가 같은 observation schema와 `runId`를 사용 | `src/agent-harness.mjs`, `tests/agent-harness.test.mjs` |
| 이상탐지 기준 | 정상 운전 데이터로 학습한 해석 가능한 max-absolute-z 기준선 + 최신 독립 run holdout | `fitNormalModelWithHoldout`, `reports/baseline.json` |
| 안전 제어 분리 | `NORMAL/ANOMALY/WARNING/EMERGENCY`와 LED·버저·서보 출력은 로컬 FSM이 결정 | `inspectWindow`, `docs/agent-harness.md` |
| LLM 역할 제한 | LLM은 사건 설명과 승인된 SOP 선택만 수행하고 액추에이터 권한은 부여하지 않음 | `buildAgentMessages`, `responseFormatFor` |
| 근거 검증 | LLM의 자유 문장을 그대로 노출하지 않고 이벤트 evidence ID와 승인 SOP ID를 코드로 재검증 | `groundedRemotePlan`, `tests/agent-api.test.mjs` |
| 로컬 실행 | llama.cpp의 OpenAI 호환 loopback API + Qwen GGUF, 실패 시 결정적 fallback | `tools/start-local-llm.ps1`, `src/agent-api.mjs` |
| 런타임 신뢰성 | `gpt-6-astra` 설정과 API 키를 분리하고, 구조화 응답·근거 게이트·fallback·사람 승인 경계를 회귀 검사 | `config/agent-runtime.json`, `src/reliable-pipeline.mjs`, `tools/reliability-harness.mjs` |

## 2-1. 2026-09-21 런타임·Agent 신뢰성 보강

Astra를 기본 런타임으로 설정한 것 자체를 신뢰성의 증거로 보지 않았다. API 모델·엔드포인트·키 존재 여부를 별도로 확인하고, 실제 응답은 구조화된 evidence/SOP 선택이 로컬 허용 목록과 일치할 때만 사용하도록 했다. 이상 상태와 액추에이터 의도는 계속 로컬 안전 로직이 결정하며, 원격 Agent에는 설비 제어 권한을 주지 않는다.

비용 없는 경로도 분리했다. API 키나 크레딧이 없을 때 `agent:offline-run`은 네트워크와 로컬 LLM을 호출하지 않고 결정적인 fallback을 검증하고, `agent:harness`와 `pipeline:check`는 악성 evidence·미승인 SOP·사람 승인 우회·자동 재가동 요청을 회귀 검사한다. Astra 실연결은 `agent:smoke`의 `liveVerified`로만 판단한다.

2026-09-21 실제 smoke 기록은 API 키 존재와 endpoint 설정까지 확인했지만, HTTP 429 `credit_balance_exhausted`로 생성 응답을 받지 못했다. 따라서 Astra의 실제 품질·지연·비용은 미검증으로 남겼고, 반복 호출하지 않았다. 이 프로젝트에서 말할 수 있는 것은 “Astra 호환 요청 계약과 안전 경계를 준비·검증했다”는 범위다.

## 3. AX/PI 업무 흐름과 연결되는 지점

이 프로젝트를 실제 업무 흐름으로 표현하면 다음과 같다.

```text
센서·제어 피드백 수집
  → JSONL observation / runId
  → 특징값 생성·정상 기준 이상점수
  → 로컬 안전 FSM과 액추에이터 상태 결정
  → 구조화된 사건·evidence 저장
  → SQLite/API로 조회
  → 승인 SOP 검색
  → 로컬 LLM의 구조화 선택
  → grounding gate·fallback
  → 작업자 확인과 후속 추세 재확인
```

이 흐름에서 직접 구현한 것은 센서 스키마, 특징값·기준선, 안전 경계, 사건 구조, API, SOP fallback, 로컬 LLM adapter와 근거 검증이다. 따라서 다음과 같이 말하는 것이 정확하다.

- 제조 데이터가 수집되어 분석되고, 이상 판단이 구조화된 사건으로 바뀐 뒤, Agent 안내와 운영 기록으로 이어지는 작은 End-to-End 흐름을 구현했다.
- 모델의 정확도만 높이는 것보다 데이터 입력, 판단, 시스템 경계, 실패 처리, 운영 추적을 함께 설계했다.
- llama.cpp를 붙인 것은 모델을 학습했다는 뜻이 아니라, 외부 API 없이 로컬·CPU 환경에서 Agent 연동과 fallback을 재현하기 위한 선택이다.

## 4. 현재 확보한 실행 증거

- `npm.cmd test`: 75/75 PASS.
- `npm.cmd run maintenance:check`: `current`; 런타임 설정·관련 파일 해시·검토 상태가 유지됨.
- `npm.cmd run agent:harness`: 합성 8개 사례 PASS. offline fallback, 무근거 evidence/SOP, Astra 호환 구조화 선택, 회복 후 사람 승인 필요를 확인.
- `npm.cmd run pipeline:check`: 7/7 PASS. 로컬 안전 결정, 근거 게이트, 자동 재가동 금지, Astra 요청에서 `temperature` 미전송을 확인.
- `npm.cmd run agent:offline-run -- temperature_rise`: 외부 API 호출 없이 `ANOMALY`, 로컬 `servo=STOP`, 승인된 SOP, 사람 확인 필요를 확인.
- `npm.cmd run agent:reliability-compare`: 느슨한 비교 정책은 악성 5/5를 수용했지만 현재 어댑터는 5/5를 거부·fallback 또는 자유 문장 제거로 처리.
- `npm.cmd run agent:api-config`: 공식 endpoint·`gpt-6-astra`·키 설정 여부를 확인. 키 값은 출력하지 않음.
- 2026-09-14 당시 `npm.cmd run llm:verify`: Downloads의 `llama-b10948-win-cpu-x64.zip`과 프로젝트 런타임 51개 파일이 크기·SHA-256 일치. `llama-server`는 `0.4.0-dev (build 10948, commit 5f436dddb)`로 확인. 이후 환경에서 원본 ZIP이 없으면 이 검사는 실패할 수 있으며, 최신 local-check와 Astra 하네스 결과를 별도로 구분한다.
- Qwen2.5-0.5B-Instruct Q4_K_M GGUF: 491,400,032 bytes, SHA-256 `74A4DA8C9FDBCD15BD1F6D01D621410D31C6FC00986F5EB687824E7B93D7A9DB`.
- `npm.cmd run agent:local-run -- temperature_rise`: `mode: remote_api`, `state: ANOMALY`, `hallucinationGate: grounded_structured_selection`, 안전 출력은 로컬 FSM 결과 유지.
- 원격 응답이 evidence/SOP 선택 규칙을 위반하면 `fallback` 또는 검증 실패로 처리하는 테스트가 있다.

위 결과 중 하네스·비교는 mock/합성 사례 기반의 코드 경계 검증이다. 실제 Astra 응답을 받은 결과가 아니며 현장 안전·고장 recall·작업자 사용성 성과로 확대하지 않는다.

## 5. 반드시 함께 말해야 하는 한계

- 현재 온도 시나리오는 데모용 소표본이다. 정상값이 지나치게 일정해 표준편차 바닥값이 적용되고, 이번 실행에서 이상 점수와 임계값 간격이 비현실적으로 커졌다. 실제 일반화 성능으로 해석하지 않는다.
- UCI AI4I 기준선은 공개 합성 데이터 기준선이며 실제 반도체 FAB 성능이 아니다.
- Jetson 실제 GPIO/I2C 드라이버, MES, Digital Twin, Cloud/Kubernetes/HPC, 실제 현장 SOP와 작업자 평가는 아직 구현·검증하지 않았다.
- LLM은 고장 확정·원인 확정·안전 제어를 하지 않는다. `insufficient_evidence`와 사람 확인을 우선한다.

## 6. 발견한 한계와 다음 개선 후보

온도 상승 시나리오를 다시 실행했을 때 정상 데모 데이터가 지나치게 일정했다. `fitNormalModel`은 각 특징의 표준편차가 `1e-6`보다 작으면 바닥값을 사용하므로, 정상 분산이 거의 없는 특징에서 작은 변화가 매우 큰 z-score로 확대될 수 있다. 이 문제는 LLM의 답변 문제가 아니라 정상 데이터와 탐지 기준선의 보정 문제로 분리했다.

### 후보 1 — 정상 운전 데이터와 운전 조건을 먼저 다양화

온도·거리·모터 부하·센서 오차가 조금씩 다른 정상 `runId`를 여러 조건에서 수집하고, 운전 조건별 정상 범위를 기록한다. 모의 데이터라면 노이즈를 임의로 크게 넣어 성능을 만들지 않고, 센서 분해능·반복 측정값·실제 운전 조건을 근거로 변동을 설계한다. 최신 독립 run은 계속 holdout으로 남긴다.

이 방법을 1순위로 추천한다. 기준선의 분산이 실제 정상 변동을 반영하지 못하면 통계 기법을 바꿔도 의미가 제한되기 때문이다.

### 후보 2 — 센서 분해능을 반영한 robust scaling과 임계값 재보정

표준편차가 0에 가까울 때 무조건 `1e-6`을 쓰지 않고, 센서 분해능·반복 측정 오차를 반영한 feature별 최소 변동폭을 사용한다. 동시에 평균·표준편차만 보는 방식과 median/MAD 또는 IQR 기반 방식을 비교하고, 정상 calibration set에서 임계값을 고정한다. 분산이 부족한 특징은 `degenerate_feature`로 기록해 품질 경고를 내고, 점수의 표시값을 임의로 낮추지 않는다.

이 방법은 현재 코드에 가장 직접적으로 적용할 수 있지만, 최소 변동폭을 임의의 숫자로 정하면 또 다른 왜곡이 된다. 따라서 센서 사양이나 반복 측정 자료를 근거로 정하고, holdout false-alarm rate와 feature별 기여도를 함께 확인해야 한다.

### 후보 3 — 운전 모드별 기준선과 시간 변화 탐지 결합

정상 상태를 하나로 묶지 않고 정지·저부하·정상 운전처럼 운전 모드를 나누어 기준선을 만든다. 온도에는 현재값 임계값 외에 slope, EWMA 또는 CUSUM 같은 시간 변화 탐지를 적용하고, 모드별 모델의 결과를 사건 단위로 묶는다. 단일 max-z 점수 하나가 아니라 “어떤 특징이 언제부터 변했는가”를 evidence로 남긴다.

이 방법은 실제 제조 운영에 더 가까운 확장 방향이지만, 모드 식별 데이터와 충분한 정상 run이 필요하므로 1·2번 뒤에 진행한다.

### 추천 진행 순서

```text
정상 run·운전 조건 다양화
  → 센서 분해능 기반 robust scaling·calibration
  → 운전 모드별 temporal detector
  → 독립 holdout·오경보·탐지 지연 비교
  → Agent가 검증된 evidence를 읽고 점검 경로를 선택
```

이 개선 과정에서 Agent의 역할도 자연스럽게 확장할 수 있다. Agent가 이상 점수를 직접 결정하게 하는 것이 아니라, `get_recent_trend`, `search_sop`, `verify_recovery` 같은 읽기 전용 도구를 필요한 경우에만 선택하고, 각 선택을 `toolTrace`로 남기게 한다. 탐지 모델·안전 FSM·Agent 설명·사람의 확인을 계속 분리하면 프로젝트의 본래 목적성과 Agentic 확장이 충돌하지 않는다.

현재 이 세 후보의 구현·비교 실험은 아직 시작하지 않았다. 따라서 아래 내용은 계획이며 개선 성능으로 표현하지 않는다.

## 7. 면접에서 말할 수 있는 1분 답변

제조 AI 프로젝트에서 온도·거리·카메라·모터·서보 데이터를 하나의 observation schema로 수집하고, 정상 운전 데이터를 기준으로 이상 점수를 계산하는 하네스를 만들었습니다. 처음에는 이상을 감지하는 모델에 집중했지만, 실제로 사용하려면 감지 결과가 안전 제어, 사건 기록, 점검 절차와 연결되어야 한다고 판단했습니다. 그래서 안전 상태와 액추에이터 명령은 로컬 FSM이 결정하도록 분리하고, Agent는 구조화된 사건의 evidence와 승인된 SOP를 바탕으로 작업자 점검 항목만 제안하게 했습니다. llama.cpp와 Qwen GGUF는 외부 API 없이 이 Agent 연동을 재현하기 위해 연결했으며, JSON Schema와 grounding gate를 통과한 선택만 사용하고 실패하면 결정적 fallback으로 전환했습니다. 이 경험을 통해 특정 모델 하나보다 데이터 수집부터 판단, 시스템 연결, 실패 처리와 운영 추적까지 이어지는 제조 시스템 흐름을 설계하는 일에 관심이 있다는 것을 구체화했습니다.

## 8. electronics-manufacturer AX/PI와 연결할 때의 안전한 표현

지원동기에서는 `MES`, `Data Pipeline`, `이상 감지`, `시스템 통합`, `인프라·운영` 같은 업무 요소와 연결할 수 있다. 다만 이 프로젝트가 MES나 Digital Twin을 구현했다고 쓰면 안 된다. 현재 근거가 있는 표현은 “센서 데이터 수집–분석–사건/API–Agent 안내–fallback까지의 소형 제조 시스템 흐름을 구현했고, 더 큰 제조 시스템에서 데이터와 AI가 실제 운영으로 이어지는 구조를 배우고 싶다”이다.

경쟁사보다 electronics-manufacturer이라는 결론은 이 프로젝트만으로 확정하지 않는다. 지원 시점에 electronics-manufacturer DS AX/PI와 유사 직무의 최신 JD를 다시 비교해, 이 프로젝트의 업무 흐름과 실제 역할 범위가 어느 쪽에 더 구체적으로 맞는지 확인한 뒤 한 문장으로 좁힌다.
