# 최신 재개 상태 — 2026-09-21 Astra 런타임 기본 설정·유지보수 절차

## 2026-09-22 최신본 동기화·industrial-automation DT 후보 추가

- 사용자 확인: 2026-09-21 오후 6시 이후 만든 Astra·API·Agent 신뢰성 보강본이 현재 요청의 기준임을 확인했다. 이전 F: 사본은 2026-09-14 상태였으므로 최신 작업공간 `manufacturing-agent-kit`을 기준으로 삼았다.
- 문서 보완: `docs/electronics-manufacturer-axpi-experience.md`와 포트폴리오 요약에 Astra 런타임 설정, API 키 분리, 구조화 요청, grounding gate, fallback, 사람 승인, 회복 재검증을 추가했다. 실제 Astra smoke는 `credit_balance_exhausted`로 `liveVerified=false`이며 품질·지연·비용은 미검증으로 유지했다.
- 신규 산출물: `docs/industrial-automation-dt-solo-project-options.md`와 F: 루트 `industrial-automation_DT_1인프로젝트_추천.md`를 추가했다. industrial-automation DT 연계 후보는 AI·DX 과제 로드맵 Copilot, 스마트에너지 운영 Digital Twin-lite, 업무 프로세스·AX 거버넌스 Agent 3개이며 실제 내부 데이터·성과를 주장하지 않는다.
- 동기화: `.`에 최신 코드·설정·프로젝트 스킬·Agent 내부 스킬·테스트·보고서를 복사했다. `.env`, 원본 데이터, 로컬 모델, ZIP은 복사하지 않았다. 덮어쓰기 전 백업은 `C:\Users\username\Documents\Codex\CLI-Workspace\backups\industrial-automation-update-20260922-115747`에 보관했다.
- F: 최종 검증: `npm.cmd test` 75/75 PASS, `npm.cmd run maintenance:check` `current`, `npm.cmd run agent:harness` PASS, `npm.cmd run pipeline:check` 7/7 PASS, `npm.cmd run agent:offline-run -- temperature_rise` PASS·`externalApiCalled=false`.
- 산업 자동화 기업 근거: industrial-automation 공식 인재채용·ESG·Beyond X 자료를 확인해 Futuring Smart Energy, 전력·자동화, DX·스마트에너지 방향과 추천 후보를 연결했다. DT 공고 원문은 현재 웹 도구에서 직접 열리지 않아 지원 기록의 공고 요약은 사용자 제공 사실로 구분했다.
- 남은 제약: F: 사본에는 API 키가 없으므로 Astra live 호출 전 해당 폴더의 `.env.example`을 복사해 사용자가 직접 키를 입력해야 한다. 크레딧이 해결되기 전 `agent:smoke`를 반복하지 않는다.

## 2026-09-21 비용 없는 개발 경로 및 신뢰성 비교 — 22:04 KST

- 사용자 결정: API 크레딧을 충전하지 않고도 구현을 계속한다. Astra 런타임 설정은 유지하고, 개발·회귀는 외부 API 없는 fallback 및 로컬 Qwen으로 수행한다.
- 추가: `AGENT_RUNTIME_MODE=offline` 또는 `offline: true`는 API 키가 있어도 네트워크를 호출하지 않고 결정론적 local SOP fallback으로 처리한다. `agent:offline-run`이 합성 사건·근거·사람 승인·로컬 액추에이터 경계를 확인한다.
- 실행: `agent:offline-run -- temperature_rise` PASS. 상태 ANOMALY, servo STOP, SOP `sop-temperature-001`, 사람 확인 required, `externalApiCalled=false`. `reports/offline-run.json`.
- 실행: 기존 로컬 llama.cpp/Qwen loopback 서버를 임시 실행해 `agent:local-check`를 수행했다. normal, temperature_rise, motion_fault, person_warning, person_emergency 5/5가 `remote_api`·구조화 grounding·승인 SOP·로컬 액추에이터 보존·비정상 사람 승인·Agent 액추에이터 부재를 모두 통과했다. 사용한 모델은 `Qwen2.5-0.5B-Instruct`, endpoint는 loopback이며 Astra 품질 검증이 아니다. 검증 후 서버는 종료했다. `reports/local-agent-check.json`.
- 보강 후 재실행: 시나리오별 기대 SOP ID까지 정확히 대조하도록 검사한 뒤 5/5 PASS(2026-09-21T13:09:39Z), 로컬 서버는 다시 종료했다.
- 비용 없는 비교: `agent:reliability-compare`에서 느슨한 pre-gate 비교 정책은 악성 5/5를 수용하지만 현재 adapter는 5/5를 fallback 또는 자유 문장 제거로 안전 처리했다. 유효한 grounded selection은 mock에서 수용됐고 local safety authority는 유지됐다. `reports/reliability-comparison.json`.
- 비교 한계: 느슨한 정책은 과거 커밋을 복원한 것이 아니라 명시적인 reference test model이다. 따라서 “모델이 더 똑똑해졌다”는 증거가 아니라 현재 시스템 경계가 더 엄격하고 검증 가능해졌다는 증거다. Astra live 응답, 고장 recall, 현장 SOP·센서·작업자 평가는 여전히 미검증이다.
- 보완: `src/agent-api.mjs` offline 차단, `tools/offline-run.mjs`, `tools/local-agent-check.mjs`, `tools/reliability-comparison.mjs`, npm 명령·README·시스템 설계 문서를 추가했다. 실제 비용·키 없이 재현 가능한 경로가 생겼다.
- 검증: 전체 `npm.cmd test` 75/75 PASS, `tools/check.ps1` 기존 16/16 및 Agent/유지보수 50/50 PASS, `agent:harness` PASS, `pipeline:check` 7/7 PASS. `llm:verify`는 Downloads의 원본 llama ZIP이 없어 실패했지만, 프로젝트의 실행 파일·모델로 local-check는 성공했다.
- 다음 행동: 비용 없이 계속 구현한다. Astra를 다시 확인할 때는 API 크레딧이 준비된 경우에만 `agent:smoke`를 1회 실행한다. 크레딧 부족 상태에서 반복 호출하지 않는다.

## 2026-09-21 키 설정 확인 및 실제 연결 시도 — 21:43 KST

- 사용자 완료 통보 후 Downloads/.env 존재 및 프로젝트 .env 부재를 확인하고 승인된 이동으로 프로젝트 .env에 복원했다. 다운로드에는 원본이 더 이상 없으며 프로젝트 파일은 존재한다. 키 값·파일 원문은 출력하지 않았다.
- `agent:api-config` 실행: 공식 OpenAI 엔드포인트/gpt-6-astra/keyConfigured=true 확인. 이는 로컬 키 로딩 확인이며 모델 접근 권한 전체의 증명은 아니다.
- 최초 sandbox smoke는 api_unavailable(73ms)로 실패. 승인된 네트워크 실행은 HTTP 429를 반환했다. 기존 HTTP 상태만으로는 원인을 구분할 수 없어 알려진 error.code/type만 허용하는 진단을 추가했다. 메시지·임의 필드·키는 로그에 남기지 않는다.
- 추가 진단 호출 1회: HTTP 429, code=credit_balance_exhausted, type=insufficient_quota, mode=fallback, liveVerified=false. 공식 문서상 조직의 선불 API 크레딧 부족이다. 과금 잔액은 계정 화면에서 직접 확인하지 않았으며 응답 코드에 근거한다. 이 원인 확인 후 추가 호출/자동 재시도는 하지 않았다. Astra 생성 응답·모델 사용 가능 여부·품질 검증은 여전히 미완료다.
- 수정: src/agent-api.mjs의 허용 목록 기반 오류 진단, tools/smoke-astra.mjs 보고서 필드, tests/astra-runtime.test.mjs 5개 회귀 사례. 관련 테스트 27/27 PASS, 전체 npm test 74/74 PASS, 오프라인 agent:harness 8/8 PASS. 모의 오류에 비밀값 문자열이 포함되어도 출력에서 제거됨을 검증했다.
- maintenance:check는 코드 변경으로 review_required다. 오프라인 검증은 통과했지만 live 실패가 해결되지 않아 완료 기준선을 갱신하지 않았다. 다음 재개 시 이 기록과 reports/astra-smoke.json을 먼저 확인해 알려진 잔액 부족을 불필요하게 재호출하지 않는다.
- 다음 행동: 사용자가 API Billing에서 크레딧을 확인하고 필요한 경우 직접 충전한다. 결제·자동 충전·한도 변경은 수행하지 않았다. 사용자 해결 통보 후 합성 smoke 1회로 실제 연결을 다시 확인한다. 키를 새로 발급할 필요가 있다는 근거는 현재 없다.
- 공식 근거: https://developers.openai.com/api/docs/guides/error-codes (2026-09-21 확인). 결과 기록: reports/astra-smoke.json. 키의 발급 이름·만료일은 조회하지 않았다.

## 2026-09-21 사용자 요청으로 .env 위치 이동

- .env를 프로젝트 폴더에서 `C:/Users/username/Downloads/.env`로 이동했다. 다운로드 경로와 대상 파일 부재를 확인하고 이동 후 대상 존재/원본 부재를 확인했다. 파일 내용과 키 값은 읽거나 출력하지 않았다.
- 사용자가 키 이름을 manufacturing-agent로 정했다. 웹사이트에서 키를 생성하거나 이름을 설정한 것은 아니다.
- 다음 행동: 사용자가 다운로드의 .env에 키를 저장한 뒤 프로젝트 폴더로 파일을 다시 옮겨야 기존 실행 명령이 읽는다. 키 입력 완료를 통보받으면 비밀값을 출력하지 않고 원위치 이동 및 설정 존재 여부를 확인한다. 현재 프로젝트에 .env가 없는 것은 의도된 임시 상태다.

## 2026-09-21 API 키 입력 전 준비

- 사용자 요청에 따라 기존 .env가 없음을 확인한 뒤 .env.example의 Astra 설정으로 프로젝트 .env를 생성했다. OPENAI_API_KEY는 빈 값으로 남겼으며 키 생성·입력·유료 API 호출은 하지 않았다.
- .gitignore에 .env 제외 규칙이 이미 있음을 확인했다. 이는 암호화가 아니므로 파일 자체를 공유하지 않는다.
- 다음 행동: 사용자가 OpenAI Platform에서 발급한 개인 프로젝트 API 키를 .env의 OPENAI_API_KEY= 뒤에 직접 붙여 넣고 저장한다. 키를 대화로 받거나 출력하지 않는다.

## 2026-09-21 다음 단계 재개 점검 — 21:17 KST

- 사용자 요청: 사용자가 확인한 5H 잔여량 52%를 참고해 가능한 다음 단계를 진행. 잔여량은 도구로 조회하지 않았다.
- 실행: `maintenance:check` 결과 current, Codex CLI 0.155.1/Node v24.19.0 및 검토 기준선과 파일 해시 일치. `agent:api-config`에서 공식 Astra 설정과 keyConfigured=false 확인; 프로젝트 .env 없음.
- 실행: `agent:smoke` 결과 blocked/missing_api_key/liveVerified=false. 외부 API 호출은 없었으며 보고서를 갱신했다. 코드 변경이 없어 기존 69개 회귀 테스트는 이번에 재실행하지 않았다.
- 공식 Astra 가이드도 다시 열어 기존 모델 및 요청 계약 안내를 확인했다: https://developers.openai.com/api/docs/guides/latest-model . 이번에 런타임 코드나 모델을 변경하지 않았다.
- 다음 수락 기준: 사용자가 .env.example을 참고해 프로젝트 .env에 OPENAI_API_KEY를 로컬로 설정하면 합성 사건 1회 smoke를 실행한다. passed/liveVerified=true, remote_api, grounded_structured_selection 및 로컬 STOP 보존을 확인해야 실제 연결 성공으로 기록한다. 자격 증명을 얻기 위해 Codex 로그인 토큰이나 다른 프로젝트의 비밀 파일을 찾지 않는다.

## 2026-09-21 Astra 적용 및 후속 업데이트 검토

- 적용: `config/agent-runtime.json`의 기본 모델을 `gpt-6-astra`, 엔드포인트를 공식 OpenAI API로 설정했다. `src/runtime-config.mjs`가 환경변수 재정의와 키 분리를 처리한다. 전역 Codex 모델/설정은 변경하지 않았다. 이 변경은 incident Agent API/CLI 경로이며 화면 전체의 Astra 연동 완료를 뜻하지 않는다.
- 요청 계약: Astra에는 temperature 없이 reasoning_effort=low, max_completion_tokens=2048, store=false와 strict 구조화 응답을 사용한다. 로컬 Qwen의 명시적 재정의 경로는 유지했다. store=false는 모든 데이터 보관이 없다는 보장이 아니다.
- 근거 검증: 실제 evidence ID/텍스트와 검색된 SOP 내용을 요청에 포함한다. 미허용/중복 참조, 사람 확인 우회, 거절·미완료 응답은 fallback으로 처리한다. SOP 자료는 프로젝트 데모 절차이며 현장 승인 문서로 주장하지 않는다. 자유 문장 폐기·로컬 안전 FSM·액추에이터 권한 경계는 유지한다.
- 유지보수: `skill/runtime-maintenance/SKILL.md`와 AGENTS.md 경로를 추가했다. 프로젝트 재개 시 `maintenance:check`가 Node/Codex CLI 버전·관련 파일 해시·마지막 검토 후 7일 경과를 확인한다. 변경/기간 경과 또는 사용자의 업데이트 알림이 있으면 공식 문서를 검토하고 필요한 범위만 수정·검증·기록한다. Windows 버전 조회는 실행 정책에 걸리는 ps1 대신 npm의 codex.cmd를 사용하도록 수정했고 codex-cli 0.155.1 조회를 확인했다.
- 한계: 점검 스크립트 자체는 온라인 신제품 출시를 발견하지 않는다. Codex가 닫힌 동안 실행되는 모니터나 예약 작업은 설치하지 않았다. 후속 모델로 무조건 전환하지 않으며 비용·데이터 목적지·권한이 크게 달라지는 전환은 별도 확인이 필요하다. CLI 버전은 데스크톱 앱/현재 대화 모델 버전이 아니다.
- 실행 검증: `npm.cmd test` 69/69 PASS; `tools/check.ps1` 기존 검사 16/16 및 Agent/유지보수 검사 44/44 PASS; `agent:harness` 8/8 PASS. 유지보수 Windows 조회 수정 후 관련 테스트 3/3 PASS 및 실제 CLI 버전 조회 PASS. 새 유지보수 스킬은 공식 quick_validate.py 검사 PASS.
- 실제 연결: `agent:api-config`가 Astra/공식 엔드포인트/keyConfigured=false를 출력했다. `agent:smoke`는 missing_api_key로 BLOCKED이며 실제 Astra 호출은 하지 않았다. API 성공·품질·지연·비용 검증 완료로 기록하지 않는다. OPENAI_API_KEY와 AGENT_API_KEY는 없고 프로젝트 .env도 없었다. 키 값이나 Codex 로그인 토큰을 읽지 않았다.
- 다음 행동: 사용자가 프로젝트 .env에 OPENAI_API_KEY를 로컬로 설정한 뒤 `npm.cmd run agent:smoke`로 실제 연결을 확인한다(유료 합성 요청 1회). 현장 SOP·실제 센서·운영자 평가·GPIO 검증은 별도이며 현재 PASS는 할루시네이션 0% 또는 현장 안전 인증이 아니다.
- 검토 근거(2026-09-21): https://developers.openai.com/api/docs/guides/latest-model , https://developers.openai.com/api/docs/models/gpt-6-astra , https://developers.openai.com/api/docs/guides/structured-outputs . Astra migration .md URL은 조회 실패하여 공식 HTML 가이드로 확인했다.
- 유지보수 기준선 기록은 오프라인 호환성 검토만 의미한다. 실제 연결 BLOCKED 상태는 `reports/astra-smoke.json`에 별도로 남기며 유지보수 current를 실행 준비 완료로 해석하지 않는다.

## 2026-09-21 신뢰 가능한 Agent 스킬·파이프라인·하네스 보강

- 확인: 기존 `manufacturing-agent-kit`은 기준선·SQLite/API·직접 센서 observation schema·로컬 안전 FSM·승인된 SOP fallback·선택적 LLM grounding 경계를 이미 갖고 있어 전면 재작성 대신 연결부를 보완했다.
- 추가: `agent-skills/manifest.json`과 `agent-skills/*/SKILL.md`에 `verification-first`, `grounding-gate`, `safe-escalation`, `recovery-verification` 4개 런타임 스킬을 정의했다. `src/skill-registry.mjs`가 파일 존재·manifest 유효성·상태별 스킬 선택을 확인하고 `src/agent-api.mjs`가 활성 스킬 ID/지침을 요청 문맥에 전달한다.
- 추가: `src/reliable-pipeline.mjs`에 관측 → 로컬 안전 결정 → 근거 게이트 → 작업자 승인 → 회복 재검증의 명시적 trace를 추가했다. `runReliableScenario`는 합성 데모, `runReliableObservations`는 명시적으로 전달한 정상 기준 모델을 사용하는 실제 observation window 경로다. 실제 관측 경로는 데모 모델을 암묵적으로 만들지 않는다.
- 보강: 원격 Agent는 로컬 SOP 검색 결과에 포함된 SOP ID만 선택할 수 있게 제한했다. 승인되지 않은 SOP/evidence ID, 중복 evidence 선택, 잘못된 원격 응답은 fallback으로 처리한다. 원격 Agent는 계속 액추에이터 권한을 갖지 않는다.
- 보강: `gpt-6-astra` 모델 ID에서는 `temperature`를 요청에서 제외하도록 어댑터를 분기했다. 구조화 응답·grounding gate·로컬 FSM·fallback·사람 승인 경계는 모델과 독립적으로 유지된다. Astra 실제 API의 품질·지연·비용은 아직 측정하지 않았다.
- 추가: `tools/reliability-harness.mjs`, `tests/reliable-pipeline.test.mjs`, `reports/reliability-harness.json`, `docs/reliable-agent-system.md`, npm scripts `agent:harness`·`pipeline:check`를 추가했다. `tools/check.ps1`이 신규 스킬 파일과 Agent 파이프라인 테스트도 확인하도록 확장됐다.
- 검증: `npm.cmd test` 52/52 PASS, `tools/check.ps1`의 기존 검사 16/16 PASS와 Agent 파이프라인 검사 27/27 PASS, `npm.cmd run agent:harness` 모든 case PASS.
- 하네스 범위: 합성 정상/온도 상승/동작 불일치/작업자 경고/비상 시나리오, 오프라인 fallback, 무근거 SOP 선택, Astra 요청 계약, 회복 후 자동 재가동 차단을 확인했다.
- 제한: 실제 Jetson GPIO/I2C, 현장 SOP, 실제 Astra 호출, 운영자 30초 판단, 현장 고장 recall/일반화는 검증하지 않았다. 하네스 PASS를 현장 성능 또는 할루시네이션 0%의 증명으로 표현하지 않는다.
- 다음 행동: 실제 정상 observation run을 수집해 `modelForDetection`을 적합하게 fit한 뒤, 승인된 SOP 자료와 분리된 holdout 사례로 원격 모델 품질·근거 적합성·지연·비용을 측정한다.

## 2026-09-17 다크모드 UI 적용

- 적용: `src/ui.html`의 기본 테마를 어두운 팔레트로 변경하고 페이지 배경, 카드, 입력창, 표, 알림, 버튼, 포커스 상태를 CSS 변수로 통일했다.
- 적용: `라이트 모드` 전환 버튼을 추가했다. 사용자가 선택한 테마는 `localStorage`에 저장하며, 별도 선택이 없으면 다크모드로 시작한다.
- 검증: `npm.cmd test` 45/45 PASS, `tools/check.ps1` 16/16 PASS, UI 인라인 JavaScript 구문·다크 기본값 정적 검사 PASS, `GET /` HTTP 200 및 다크 CSS 응답 확인.
- 제한: 이 세션에 연결된 브라우저가 없어 실제 브라우저 캡처 검증은 수행하지 못했다. 검증을 위해 `127.0.0.1:8765`에서 서버를 실행했으며 확인 후 종료했다.

## 2026-09-14 기준선·운영 판단 개선 적용

- 적용: `src/tep-mode.mjs`에 시계열 persistence와 운전 모드 전환 보류를 추가했다. 단일 초과는 `PENDING_ANOMALY`, 기본 3행 연속 초과는 `ANOMALY`, 모드 변경 직후 기본 2행은 `MODE_TRANSITION`, 미등록 모드는 `INSUFFICIENT_EVIDENCE`다.
- 적용: `src/mes-lite.mjs`에 TEP를 반도체 데이터로 오인하지 않도록 `virtual-mes-benchmark`·`SIMULATE` 문맥 생성기를 추가했고, `reports/tep-mode-baseline.json`에 가상 MES 문맥을 함께 기록했다.
- 적용: `run-local-agent.ps1 -VirtualMes`와 `runIncidentWithAgent({ useVirtualMes: true })`를 추가해 virtual MES 문맥을 실제 Agent 실행 경로에 선택적으로 전달한다. 문맥은 사실 입력일 뿐이며 액추에이터 권한을 늘리지 않는다.
- 적용: 합성 `temperature_rise` 상승률을 1.4°C/s에서 0.15°C/s로 완화했다. 현재 데모는 정상 기준 threshold 1.8641, anomaly score 12.3217(약 6.61배)이며 9.00°C/min 규칙과 점수 근거로 `ANOMALY`를 유지한다. 여전히 합성 소표본이고 14개 특징에 최소 변동폭 바닥값이 적용되어 현장 성능으로 해석하지 않는다.
- 결과: TEP 정상 holdout의 mode-aware 행 단위 오경보는 32/1,803(1.775%), temporal 3행 persistence 후 anomaly rows는 10/1,803(0.555%)·4 episodes다. global temporal은 0/1,803이다. 정상 데이터뿐이므로 전역/모드 기준선의 우열이나 fault recall은 결론내리지 않았다.
- 검증: `npm.cmd test` 45/45 PASS, `tools/check.ps1` 16/16 PASS, `npm.cmd run llm:verify` PASS, `npm.cmd run agent:local-run -- temperature_rise -VirtualMes`가 `remote_api`·`grounded_structured_selection`으로 완료됐다. 안전 상태와 액추에이터 출력은 계속 로컬 FSM이 결정했다.
- 할루시네이션 감사: `npm.cmd run agent:audit`에서 정상·온도·모션·작업자 경고·비상 5개 시나리오와 악의적인 `e99` evidence 응답이 모두 통과했다. 상세 결과는 `reports/agent-grounding-audit.json`이며, 이는 참조·권한 경계 검사이지 현장 적합성 증명이 아니다.
- 남은 제약: persistence·전환 유예 값은 실제 샘플링 주기와 운전 규정으로 재보정해야 하며, TEP는 모드별 독립 run이 하나씩이고 fault 시나리오·onset label이 없다. 다음에는 fault 평가 또는 독립 정상 run 확보 후 fault recall·탐지 지연을 별도로 비교한다.

- 사용자 요청: Downloads의 `llama-b10948-win-cpu-x64.zip`을 오늘 만든 온도 이상탐지 Agent에 적용할 수 있는지 확인하고, electronics-manufacturer DS AX/PI 지원용 경험 정리를 준비.
- 확인: ZIP의 llama.cpp 실행 파일 51개가 `tools/local-llm/bin`의 기존 파일과 크기·SHA-256 모두 일치했다. 따라서 바이너리 덮어쓰기는 하지 않고, `tools/verify-local-llm.ps1`과 `npm.cmd run llm:verify`로 재현성 검사를 프로젝트에 추가했다.
- 확인: Qwen2.5-0.5B-Instruct Q4_K_M GGUF 491,400,032 bytes, SHA-256 `74A4DA8C9FDBCD15BD1F6D01D621410D31C6FC00986F5EB687824E7B93D7A9DB`; llama.cpp `0.4.0-dev (build 10948, commit 5f436dddb)`.
- 실제 실행: 로컬 서버를 127.0.0.1:8000에 기동하고 `npm.cmd run agent:local-run -- temperature_rise`를 실행했다. `mode: remote_api`, `state: ANOMALY`, `hallucinationGate: grounded_structured_selection`; 안전 상태·액추에이터 출력은 로컬 FSM 결과를 유지했다.
- 추가 문서: `docs/electronics-manufacturer-axpi-experience.md`는 이전 초안으로 남기고, 최신 경험 정리는 `docs/experience-summary.md`, 코드-의도 해설은 `docs/code-intent-guide.md`로 분리했다.
- 새 한계 기록: 정상 데모 데이터가 지나치게 일정해 표준편차 바닥값이 적용되고 온도 이상 점수와 임계값이 비현실적으로 벌어졌다. 이는 일반화 성능이 아니라 데이터 품질·표본 한계이며, 향후 다양한 정상 run과 실제 센서 수집으로 재검증한다.

## 2026-09-14 MES-lite·공개 다중 운전 모드 데이터 적용

- 사용자 확인: 최종 경험 정리는 이번 요청으로 작성했다. “데이터가 어떤 공정·설비·운전 상태에서 발생하는가”에 공감했다는 사실은 확인했지만, 이것이 처음부터 본인의 생각이었는지 대화를 통해 구체화된 것인지는 경험 정리에서도 구분해 기록했다.
- 후속 산출물 완료: 사용자의 시작 계기·대화 중 구체화된 사고·확인·판단·결과를 `docs/experience-summary.md`에, 모듈·함수·입출력·안전 경계·실패/fallback·검증 결과를 `docs/code-intent-guide.md`에 정리했다. 두 문서 모두 실제 코드와 현재 한계를 기준으로 하며 electronics-manufacturer 내부 시스템 구현으로 확대하지 않는다.
- 구현: `src/mes-lite.mjs`에 Work Order·Lot·Product·Recipe·Operation·Equipment·`processModeId`·`operationMode`·`executionState` 문맥과 허용 상태 전이를 추가했다. MES 문맥은 이벤트와 장비/run이 일치할 때만 연결된다.
- Agent 연결: `src/agent-api.mjs`가 선택적 `mesContext`를 사실로 전달하되 Work Order·Lot·운전 상태를 생성·변경하지 않도록 프롬프트 경계를 추가했다. 액추에이터 권한은 계속 로컬 FSM에만 있다.
- 데이터: Tennessee Eastman 저장소의 고정 커밋 `309b944f35ac440ff0c70616947ffe723c766e14`에서 Mode 1·3·4 정상 50시간 파일을 내려받아 원본과 정규화 JSONL을 분리 보존했다. `tools/download-tep.ps1`, 표준 라이브러리만 사용하는 `tools/convert-tep.py`, `docs/tep-data-card.md`를 추가했다.
- 모드 기준선: `src/tep-mode.mjs`와 `npm.cmd run mode:baseline`을 추가했다. 9,003행을 시간 순서 80/20으로 분리했으며 mode-aware holdout false-alarm rate 1.775%(32/1,803), global baseline 0%(0/1,803)였다. 어느 쪽이 우수하다는 결론은 내리지 않았고, mode-aware 기준선이 Mode 1 후반 drift를 민감하게 표시했을 가능성과 전역 기준선이 변동을 넓게 흡수했을 가능성을 기록했다.
- 검증: `npm.cmd test` 41/41 PASS, `npm.cmd run mode:baseline` 실행 완료. TEP 모드별 독립 run이 하나씩이고 fault 파일은 아직 포함하지 않아 일반화·fault recall 성능으로 해석하지 않는다.
- 추가 문서: `docs/mes-lite.md`에 가상 MES의 범위와 다음 도구 연결 계획을 기록했다. BaSyx는 개념·표준 참고이며 실제 설치·운영으로 주장하지 않는다.

# 이전 최신 재개 상태 — 2026-09-07 UI·피드백 완료

- 이번 사용자 요청: Opal·의도 기록 기준을 기존 작업에 보완한 뒤 이전 단계부터 재개. 토큰 효율 스킬 적용.
- 보완: docs/decisions.md, docs/ai-delegation.md. 과거 사용자 사고 과정은 창작하지 않고 이번 Codex 판단으로 명시. Opal 생성 프롬프트·개발 평가표·최신 입력은 opal/에 준비.
- 완료: src/ui.html 알림 목록·상세·단위·점수/임계값·합성/최신성 불명 표시. src/feedback.mjs 별도 SQLite 의견 저장. POST /events/{eventId}/feedback, pending_review 고정, 키 재전송 중복 방지와 충돌 409. 원래 사건 DB는 읽기 전용 유지.
- 검증: tools/check.ps1 프로세스 한정 ExecutionPolicy Bypass 실행, 16/16 PASS. 기존 기준선/사건 API + 피드백 파일 DB 재개방·중복/충돌·입력/Origin 검증·사건 보존. 첫 검사는 테스트 임시 폴더 정리 오류 1건으로 실패, rmdirSync 수정 후 통과.
- 실제 Chrome UI: 114개 목록 → 표본 6119(점수 2.332/임계값 2.308) → 실제 변수·단위 → 모름/개발 검증용 메모 저장 성공 확인. 화면 배치 스크린샷 확인. data/feedback.sqlite의 개발 검증 의견은 실제 현장 점검이 아니다.
- 서버: 이번 세션에서 node src/server.mjs를 127.0.0.1:8765로 시작. 브라우저 작업대 유지. 다음 세션 가동 여부는 다시 확인; 중단돼 있으면 같은 명령으로 실행.
- 남은 검증: UI의 빈 목록·오류 문구는 구현했으나 브라우저 오류 주입 검증은 미실행(API 빈 목록/오류는 자동 검사). 실제 작업자 30초 평가 미실행.
- 다음 단계: UI 빈 목록·실패·재시도 브라우저 검증 후 교육용 근거 문서와 검색 기준선. Opal은 create-prompt.txt로 실제 앱 제작하고 evaluation.md 개발 사례 실행. Opal 계정 기능·로그인 상태는 아직 확인하지 않음.
- 아직 미구현: SOP 검색, LLM/Agent, 실제 Opal 앱, 현장 사용자 평가. 자체 LLM 학습과 생산성 향상은 주장하지 않음. 기존 test 표본 튜닝·기준선 변경 없음.

---
아래는 이전 단계 기록이며 위 최신 상태가 우선한다.
# 재개 상태

## 현재 상태 — 2026-09-07

- 완료 단계: **기준선 + SQLite 사건 저장·읽기 API**. 저장/API까지 구현됐으며 다음 단계는 작업자 화면과 검토 대기 피드백이다.
- 현재 코드: `src/events.mjs`, `src/import-events.mjs`, `src/server.mjs`. 원본/설정/기준선 코드 해시 확인, 고정 max_abs_z 계수로 validation만 처리. test 재학습·재평가 없음.
- 실제 저장: `data/events.sqlite`에 validation 임계값 초과 알림 114개. 첫 import 신규 114개, 두 번째 신규 0개/중복 114개. 같은 ID의 다른 내용은 전체 배치 롤백.
- API: GET /health, /events, /events/{eventId}, localhost:8765. SQLite 읽기 전용. 잘못된 ID/쿼리 400, 유효한 없는 ID 404, 미지원 메서드 405, DB 오류 503. `docs/api.md` 참조.
- 출처 표현: equipmentId/observedAt=null, freshness=unknown, severity=unassigned. storedAt은 저장 시각이며 실관측 시간으로 사용하지 않는다. 표본 알림을 실제 고장 확정으로 표현하지 않는다.
- 최종 검증: `tools/check.ps1` 준비 구조 + 14/14 테스트 PASS(기준선 6, 저장/API 8). 실제 파일 DB 재개방, 중복/충돌/롤백, 결측·비유한 값, 목록·상세 HTTP, 오류 계약 검사.
- 실제 CLI 검증: `node src/server.mjs` 시작 후 `node tools/smoke-api.mjs` PASS. 114개 목록과 첫 UDI 6119 상세 일치. 증거 `reports/api-smoke.json`. 확인 후 서버는 종료했으며 재개 시 다시 실행한다.
- 스킬 인계 완료: `references/implementation-status.md`에 현재 구현과 다음 수락 기준을 추가했다. 개인 설치본·프로젝트 사본 SHA256 일치, SKILL.md 필수 머리말과 참조 경로 검사를 확인했다. 최신 STATE.md가 우선이다. 공식 Python quick_validate.py는 이번에 실행하지 않았으며 공식 검사 통과로 표시하지 않는다.
- 다음 행동: 기존 조회 API를 사용하는 작업자 목록·상세 화면과 검토 대기 피드백 저장. 중복 피드백, 빈 목록, API 실패를 검증. 상세 기준은 스킬의 implementation-status.md 참조.
- 아직 미구현: UI·피드백·SOP 검색·LLM Agent·현장 사용자 평가. Opal 앱 생성·실행 미완료.

## 첫 기준선 기록 — 2026-09-07 (저장/API 구현 이전)

- 사용자 요청: 5시간 사용량 제한을 고려해 지금 1인 프로젝트 구현 시작. 계정 잔여량·초기화 시각은 확인하지 못했으므로 한도 내 완료를 보장하지 않음.
- 이번 완료 범위: UCI AI4I 공식 합성 데이터 다운로드·SHA256 고정·스키마 검사·순서 분할·정상 참조 이상 점수 기준선 2개·test 평가·회귀 테스트.
- 환경: Node.js 24.19.0, 외부 패키지 없음. Python 실행기를 현재 도구 환경에서 찾지 못해 첫 통계 기준선은 Node.js로 구현했다. Python/FastAPI 방향은 이후 환경 확인 후 결정.
- 원본: `data/raw/ai4i2020/ai4i2020.csv`, 10,000행. 출처·라이선스·해시는 `docs/data-card.md`와 `experiment.json` 참조. 원본 Git 제외 유지.
- 분할: train 6,000행(정상 5,745), validation 1,900행, test 1,900행(고장 라벨 38), 경계 gap 총 200행. UDI는 실제 시간이 아니고 run 독립성도 검증되지 않음.
- 실험 결과: max_abs_z test TP 15 / FP 59 / FN 23 / TN 1803, AP 0.166246; mean_squared_z TP 16 / FP 75 / FN 22 / TN 1787, AP 0.150477. 고정 정상 validation 95백분위 임계값. Test 결과로 조정하지 않음. 상세 `reports/baseline.json`.
- 발견 사항: 주 고장 라벨과 고장 유형 OR 불일치 27행. 원본을 고치지 않고 주 타깃 유지. 두 기준선의 낮은 recall과 합성 데이터 한계를 보고함.
- 실행 검증: `node --test tests/baseline.test.mjs` 6/6 PASS; 실제 원본을 사용한 `node src/baseline.mjs` 종료 코드 0. 누락/잘못된 값, 분할 경계, test 변경 시 정규화·임계값 불변, 라벨 입력 제외, 동점 AP와 혼동행렬, 재현성 검사.
- 통합 확인: `tools/check.ps1` 준비 파일·12개 시나리오 구조 및 기준선 테스트 6개 PASS. `tools/download-data.ps1` 기존 원본 해시 일치 확인 PASS. 다운로드 스크립트의 신규 다운로드 분기는 별도 미실행이며 최초 다운로드·압축 해제·해시 확인은 직접 명령으로 실행했다.
- Opal: 최신 개인 스킬과 프로젝트 내 스킬 사본을 동기화. `opal/session-input.md`에 실제 결과와 다음 행동을 준비. 앱 생성·실행·메모리 검증은 미실행.
- 아직 미구현: SQLite 사건 저장, API, 화면, SOP 검색, LLM Agent, 실제 작업자 평가. 기준선 실행 성공은 서비스 완성이나 현장 유효성 검증이 아님.
- 다음 행동: 개발용 train/validation 표본 하나를 사건 저장→읽기 API로 연결. 데이터에 없는 설비·시각을 만들어내지 않고, 잘못된 ID·중복 저장을 테스트한다. 기존 test를 튜닝에 쓰지 않으며 최종 시계열 데이터 선정은 별도 검토한다.
- 사용량 운영: 다음 세션은 이 상태와 관련 코드만 읽어 기능 하나를 완성한다. 실행 시각을 제외한 결과는 재현 가능하며 유료 API 호출은 하지 않았다.

## 이전 준비 기록 — 2026-09-06

- 기준일: 2026-09-06
- 단계: 준비 키트 작성. 데이터 선택·모델 학습·API·화면·실제 Agent는 아직 구현하지 않음.
- 사용자 의도: 나중에 제조 데이터 + AI Agent + 현업 사용성 1인 프로젝트를 시작할 수 있도록 스킬과 파이프라인/하네스를 준비.
- 기본 범위: 설비 한 종류, 공개 데이터 한 개, 작업자 화면 하나, 근거 기반 점검 제안, 검토 가능한 피드백.
- 준비된 자료: 재사용 스킬, 데이터/제품 설계, 단계별 평가, 로컬 준비 검증 도구, 개발 회귀 사례.
- 다음 행동: 시작 요청이 오면 공식 데이터 제공처와 라이선스를 확인하고 데이터 적합성 표를 채운 뒤 목표/분할을 결정.
- 검증: 준비 파일 및 회귀 시나리오 구조 검사 실행. 최종 결과는 아래 기록. 공식 quick_validate.py는 PyYAML 미설치로 실행 실패했으며 공식 검사 통과로 간주하지 않음.
- 설치: C:/Users/username/.codex/skills/manufacturing-anomaly-agent에 개인 스킬 설치 완료. 현재 대화의 스킬 목록 반영 여부는 확인하지 못함.

## 나중에 사용할 요청

“$manufacturing-anomaly-agent 제조 이상탐지 프로젝트 시작하자. 기존 STATE.md를 읽고 데이터 선정부터 진행해줘.”

스킬이 목록에 보이지 않으면 이 파일 또는 이 폴더의 SKILL.md 경로를 직접 제공한다.

## 준비 검증 결과

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/check.ps1`: PASS, 필수 파일과 12개 시나리오 정의 확인. 해당 프로세스에만 실행 정책 옵션을 적용했고 전역 정책은 변경하지 않음.
- 첫 실행에서 PowerShell JSON 배열이 중첩되어 사례 수가 1로 집계되는 문제를 발견하고 배열 처리와 필드 타입 검사를 수정한 뒤 재실행함.
- 데이터·모델·API·Agent·화면·사용자 평가는 아직 미실행.
- 스킬 형식은 직접 검토했으나 공식 quick_validate.py는 PyYAML 누락으로 미완료.
- 스킬 구조 참고: https://learn.chatgpt.com/docs/build-skills (2026-09-06 확인).

## 2026-09-07 설명회 메모 기반 스킬 보강
- 개인 스킬과 프로젝트 사본의 SKILL.md, opal-assistant.md, 새 intent-and-evaluation.md 동기화 완료. SHA256 일치 확인.
- 의도·대안·AI 위임·사람의 판단 기록, Opal 파이프라인, 반복 평가 하네스 설계, 보안/RAG/파인튜닝 구분 추가.
- 필수 frontmatter와 Markdown 참조 경로 검사 PASS. 공식 quick_validate.py는 사용 가능한 Python 실행 파일을 찾지 못해 미실행.
- 이번 변경은 스킬 지침이다. Opal 앱 생성이나 평가 하네스 구현·실행, 모델 학습은 수행하지 않았다. 기존 서비스 구현 상태와 다음 단계는 유지한다.


## 학습 목적 구체화 — 2026-09-07
- 사용자 동기를 docs/learning-charter.md에 반영. 새 intentional-ai-project 스킬은 의도 정의→위임→실행→검증→사람의 판단을 안내한다.
- 제조 스킬에 새 목적과 스킬 연결 추가. 기존 구현·검증 결과는 유지한다. 다음 기능 전에 위임 카드를 작성하고 SOP 검색 설계의 작은 A/B 비교를 제안한다.
- Opal 역할은 AI 업무 위임·검토 비서로 구체화. 생성 프롬프트와 수락 검사는 새 스킬 references/opal.md 사용. 기존 opal/create-prompt.txt보다 이 최신 역할 정의를 우선한다.
- 이번 작업은 스킬/계획 작성. 실제 비교 실험·Opal 앱 제작·사용자 이해도 평가는 미실행.
- 새 스킬 frontmatter와 상대 참조 검사 PASS. Python 실행기를 찾지 못해 공식 quick_validate.py 미실행.

## 직접 센서 데이터 기반 Agent 하네스 — 2026-09-14
- `src/agent-harness.mjs` 추가. 실제 센서 입력과 모의 시나리오가 같은 observation schema를 사용하고, JSONL 수집기·특징값 생성·정상 기준 이상 점수·안전 FSM·근거 기반 Agent plan을 연결한다.
- 온도 상승, 동작 불일치, 사람 경고/비상 접근 시나리오를 포함했다. 이상 점수는 고장 확률이 아니며, 안전 정지는 Agent가 아니라 Python-equivalent FSM 계층이 결정한다.
- `tests/agent-harness.test.mjs` 5/5 PASS. 기존 baseline/events/feedback 통합 테스트 16/16 PASS. `node src/agent-harness.mjs` 데모 실행 확인.
- 현재 Agent plan은 결정적 mock/fallback이다. 실제 LLM·SOP 검색·Jetson GPIO 어댑터 연결은 다음 단계이며, 구조화된 event와 tool boundary를 유지한다.
- `searchSop` 기반 승인 SOP 검색 trace와 `verifyRecovery` 후속 확인을 추가했다. Agent는 근거 없는 원인 확정 대신 evidenceRefs와 제한사항을 반환한다. Agent harness 테스트는 6/6 PASS.
- 1순위 외부 PC/API Agent 경로를 `src/agent-api.mjs`로 추가했다. OpenAI 호환 `/v1/chat/completions` 응답을 JSON 검증하고, 미설정·timeout·HTTP 오류·잘못된 응답은 로컬 SOP Agent로 fallback한다. 원격 응답에는 actuator 권한을 주지 않는다. `.env.example`, Agent API 테스트 4개를 추가했다.
- `node src/agent-api.mjs <scenario>`로 이벤트 생성→원격 API 시도→fallback까지 실행 가능하게 했다. Agent API 테스트 6개와 전체 `npm.cmd test` 29/29 PASS.
- 직접 발열 trace 10개를 JSONL로 저장하는 테스트를 추가했다. 원격 Agent는 자유 문장을 그대로 노출하지 않고 event evidence ID와 승인 SOP ID를 검증하는 grounding gate를 통과한 결과만 사용한다. 비정상 ID 응답은 fallback 처리한다.
- 정상 데이터 검증을 `runId` 단위 홀드아웃으로 확장했다. 최신 독립 운전 run을 학습에서 제외하고 holdout false-alarm rate, 표본 부족 상태(`small_sample`), 과적합 경고를 보고한다. IQR 감사는 입력 이상치 후보만 표시하며 고장으로 단정하지 않는다.
- 현재 데모는 학습 9개 window·홀드아웃 3개 window라 false-alarm 0%이지만 `small_sample`이다. 따라서 일반화나 과적합 부재의 증거로 해석하지 않는다. 정상 mock 값이 지나치게 일정해 표준편차 바닥값과 매우 큰 anomaly score가 생기는 데이터 품질 한계도 확인했다.
- `npm.cmd test` 31/31 PASS, `tools/check.ps1` 16/16 PASS. UCI AI4I 고정 baseline은 별도 validation/test를 유지하며 test AP가 max-abs-z 0.1662, mean-squared-z 0.1505로 현장 성능을 주장할 수준이 아니다.
- 온도 외 채널 수집을 확장했다. 초음파 주파수·에코 품질, 카메라 사람/거리, 모터·서보 명령/피드백, LED·버저 관측 상태, 채널별 health를 같은 `runId`로 JSONL에 저장한다. 제어 출력(LED·버저·서보 상태)은 누수 방지를 위해 특징값에서 제외하고, 서보 불일치·카메라/초음파 거리 차이·에코 품질·health만 진단 특징으로 사용한다. 최종 `npm.cmd test` 33/33, `tools/check.ps1` 16/16 PASS.
- 실제 오픈 LLM 실행을 완료했다. 공개 Qwen2.5-0.5B-Instruct Q4_K_M GGUF(491,400,032 bytes, SHA-256 `74A4DA8C9FDBCD15BD1F6D01D621410D31C6FC00986F5EB687824E7B93D7A9DB`)와 llama.cpp 서버를 loopback `127.0.0.1:8000`에 실행했다. `normal`, `temperature_rise`, `person_emergency`, `motion_fault` 모두 `mode: remote_api`, `hallucinationGate: grounded_structured_selection`을 통과했고, 상태·actuator 결정은 로컬 FSM 결과를 유지했다.
- 이전 API 시도는 `192.168.0.10:8000` 엔드포인트가 준비되지 않아 fallback된 것이며, 안전상 실행을 막은 것이 아니었다. 작은 LLM의 JSON 불이행을 줄이기 위해 event별 허용 evidence/SOP ID와 상태를 JSON Schema로 제한하고, 기존 grounding gate를 계속 적용했다.
- 재현 명령을 `npm.cmd run agent:local-llm`와 `npm.cmd run agent:local-run -- temperature_rise`로 추가했다. `.env.example`은 로컬 PC 검증 주소를 기본값으로 하고, Jetson 배포 시 승인된 PC LAN 주소로 교체한다.
