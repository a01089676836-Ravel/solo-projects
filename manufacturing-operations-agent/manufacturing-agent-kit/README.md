# 제조 이상탐지·점검 지원 프로젝트

## 현재 런타임 — Astra (2026-09-21)

연결 오류는 `reports/astra-smoke.json`의 `reason`과 `apiError`로 확인한다. `api_http_429`만으로는 원인을 단정하지 않는다. `credit_balance_exhausted`는 API 크레딧 부족이므로 계정 Billing에서 확인하고 해결 전 반복 호출하지 않는다. 오류 메시지 원문은 저장하지 않으며 알려진 코드/유형만 기록한다. 실연결 성공 여부는 `liveVerified`를 확인한다.

기본 모델은 `config/agent-runtime.json`의 `gpt-6-astra`, 기본 API는 `https://api.openai.com/v1`이다. Codex 로그인과 별개인 OpenAI API 키가 필요하다. `.env.example`을 참고해 로컬 `.env`에 `OPENAI_API_KEY`를 설정한다. 키는 대화·로그·저장소에 공개하지 않는다. 환경변수가 `.env`보다 우선하므로 이전 Qwen 환경변수가 남았다면 `agent:api-config`로 확인한다.

```powershell
npm.cmd run agent:api-config
npm.cmd run agent:smoke
npm.cmd run agent:run -- temperature_rise
npm.cmd run maintenance:check
```

`agent:api-config`는 네트워크 호출 없이 모델·키 존재 여부만 출력한다. `agent:smoke`는 합성 사건 하나로 실제 유료 API 호출을 수행한다. 키 누락이면 `blocked`(종료 코드 2), 호출/응답 실패이면 종료 코드 1이며 fallback을 Astra 성공으로 세지 않는다. 결과는 `reports/astra-smoke.json`이다. 호출은 1회, 기본 60초, 최대 completion 2,048 토큰(추론 포함), reasoning low다. `store:false`는 응답 저장 옵션이며 모든 제공자 로그의 보관 없음 보장은 아니다.

API 크레딧 없이 개발할 때는 다음 명령을 사용한다.

```powershell
npm.cmd run agent:offline-run -- temperature_rise
npm.cmd run agent:local-llm
npm.cmd run agent:local-check
npm.cmd run agent:reliability-compare
```

`agent:offline-run`은 외부 API와 로컬 LLM을 모두 호출하지 않고 결정론적 fallback·근거·사람 승인·로컬 액추에이터 경계를 확인한다. `agent:local-check`는 별도로 실행 중인 loopback Qwen을 다섯 합성 시나리오에 연결한다. `agent:reliability-compare`는 과거 커밋을 복원한 결과가 아니라, 느슨한 pre-gate 비교 정책과 현재 grounding gate를 같은 악성 응답에 적용해 경계의 개선을 측정한다. 결과는 `reports/`에 저장하며 Astra의 실제 품질이나 현장 성능으로 해석하지 않는다.

향후 업데이트 점검은 [유지보수 스킬](skill/runtime-maintenance/SKILL.md)에 정의했다. Codex가 이 프로젝트 작업을 재개하면 AGENTS.md를 통해 적용한다. 로컬 버전·관련 파일 변경 또는 7일 경과 시 공식 문서 검토 → 필요한 보완 → 테스트 → 기록을 수행한다. 앱 종료 중 상시 감시나 무조건 최신 모델 교체는 하지 않는다.

아래 로컬 LLM 설명과 명령은 Qwen을 명시적으로 선택할 때 사용하는 기존 경로다.

현재는 **공개 합성 데이터 기준선 + SQLite 사건 저장·조회 API + 직접 센서 수집 Agent 하네스 + 로컬 LLM 연결**까지 구현했다. 센서 수집 하네스는 온도뿐 아니라 초음파·카메라·모터/서보·LED·버저 피드백을 같은 `runId`로 기록하고, 로컬 안전 FSM과 근거 기반 Agent plan을 연결한다. llama.cpp와 Qwen GGUF는 설명·점검 제안에만 사용하며, 안전 상태와 액추에이터 명령은 로컬 FSM이 결정한다. Jetson 실제 GPIO/I2C 드라이버 연결과 현장 성능 검증은 별도 단계다.

## 실행

검증 환경: Node.js **24.19.0**, Windows PowerShell. 외부 npm 의존성 없음. 오프라인 회귀에는 API 크레딧과 키가 필요하지 않으며, Astra live 호출에만 별도 API 크레딧이 필요하다.

```powershell
cd .
powershell.exe -NoProfile -File tools/download-data.ps1
node --test tests/baseline.test.mjs tests/events.test.mjs
node src/baseline.mjs
node src/import-events.mjs
node src/server.mjs
```

첫 명령은 공식 UCI 데이터 다운로드와 SHA256 검사를 수행한다. 이미 일치하는 파일이 있으면 재다운로드하지 않는다. 실행 결과는 `reports/baseline.md`와 `reports/baseline.json`에 저장된다. 동일 데이터·코드·설정에서는 생성 시각 외 실험 결과가 같다.

마지막 명령은 `http://127.0.0.1:8765/events`에서 읽기 API를 실행한다. import를 반복해도 같은 사건은 중복되지 않는다. API 사용법과 오류 계약은 [실행 안내](docs/api.md)를 참고한다.

로컬 LLM 재현·검증:

```powershell
npm.cmd run llm:verify
npm.cmd run agent:local-llm
npm.cmd run agent:local-run -- temperature_rise
npm.cmd run agent:local-run -- temperature_rise -VirtualMes
npm.cmd run agent:audit
```

`llm:verify`는 Downloads의 llama.cpp ZIP과 프로젝트에 보관된 실행 파일을 SHA-256으로 대조하고, Qwen GGUF 모델 해시와 llama.cpp 빌드도 확인한다. 로컬 LLM이 없거나 호출에 실패해도 결정적 SOP fallback으로 사건 조회와 점검 안내가 중단되지 않는다. 이 프로젝트는 모델을 학습·파인튜닝한 것이 아니다.

`agent:audit`는 5개 시나리오와 악의적인 근거 ID 응답을 실행해 evidence·SOP 참조·가상 MES 일치·액추에이터 권한 분리를 확인하고 `reports/agent-grounding-audit.json`에 남긴다.

신뢰 가능한 Agent 파이프라인과 런타임 스킬:

```powershell
npm.cmd test
npm.cmd run agent:harness
npm.cmd run pipeline:check
```

`agent-skills/manifest.json`과 각 `SKILL.md`는 verification-first, grounding-gate, safe-escalation, recovery-verification 규칙을 정의한다. `src/reliable-pipeline.mjs`는 관측 → 로컬 안전 결정 → 근거 게이트 → 사람 승인 → 회복 재검증 단계를 하나의 trace로 반환한다. `tools/reliability-harness.mjs`는 오프라인 fallback, 무근거 evidence/SOP 선택, 비상 접근, 실제 관측 window 입력 조건, Astra 요청 호환성을 외부 API 없이 회귀 검사한다. 상세 경계는 [Agent 시스템 설계](docs/reliable-agent-system.md)를 참고한다.

런타임 기본 모델은 `gpt-6-astra`이지만, 오프라인 하네스가 확인하는 것은 요청 계약과 권한 경계다. Astra 자체의 품질·지연·비용은 실제 API 권한과 고정 평가 사례로 별도 측정해야 한다. Codex 개발 모델 변경은 이 저장소의 런타임 모델 설정을 자동으로 변경하지 않는다.

가상 MES와 공개 다중 운전 모드 기준선:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/download-tep.ps1
& 'C:\Users\username\AppData\Local\Programs\Python\Python314\python.exe' tools/convert-tep.py
npm.cmd run mode:baseline
```

`MES-lite`는 실제 MES가 아니라 Work Order·Lot·Operation·Equipment·운전 모드를 사건 문맥으로 검증하는 최소 통합 경계다. Tennessee Eastman 데이터는 현재 센서 채널과 물리적으로 섞지 않고, 모드별 기준선과 시간 holdout을 검증하는 별도 벤치마크로 사용한다. 자세한 제한은 [MES-lite 안내](docs/mes-lite.md)와 [TEP 데이터 카드](docs/tep-data-card.md)를 참고한다.

TEP 보고서는 행 단위 기준선과 함께 3행 persistence·모드 전환 보류 결과도 기록한다. 이는 단일 점수 튐을 운영 알림으로 바로 승격하지 않는 판단 규칙의 검증이며, fault 라벨이 없는 현재 데이터에서 recall이나 현장 성능을 주장하지 않는다.

## 확인할 자료

- [실험 결과](reports/baseline.md): 두 기준선의 test 지표와 한계.
- [데이터 카드](docs/data-card.md): 출처·라이선스·분할·누수 방지 결정.
- [API 실행 안내](docs/api.md): 사건 저장·조회·검증 명령과 필드 의미.
- [재개 상태](STATE.md): 완료한 작업, 검증, 다음 행동.
- [Opal 인계 입력](opal/session-input.md): 실제 진행 상태를 비서에 전달하는 자료. Opal 앱 자체는 아직 생성하지 않았다.
- [경험 정리](docs/experience-summary.md): 시작 계기부터 확인·판단·결과·AX/PI 연결 범위까지 사용자의 말투로 정리.
- [코드-의도 해설](docs/code-intent-guide.md): 초보자도 모듈·함수·입출력·안전 경계를 코드와 함께 읽는 안내.
- [industrial-automation DT 1인 프로젝트 후보](docs/industrial-automation-dt-solo-project-options.md): 현재 프로젝트의 다음 포트폴리오 후보 3개와 선택 기준.
- [이전 AX/PI 초안](docs/electronics-manufacturer-axpi-experience.md): 현재 문서로 대체된 과거 초안.

`tools/check.ps1`은 준비 자료 확인 뒤 기준선·SQLite·HTTP 및 Agent/유지보수 회귀 테스트를 실행한다. 모의 응답과 로컬 HTTP 검사를 실제 Astra·현장 성능 검증으로 해석하지 않는다.
