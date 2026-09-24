# MES-lite와 운전 모드 연결

## 목적

실제 MES 계정이나 FAB 생산 데이터가 없는 상태에서, 이상 이벤트를 단순 센서 숫자가 아니라 작업·Lot·공정·설비·운전 상태와 함께 해석하는 최소 문맥을 만든다. 이 구현은 실제 MES가 아니며, 가상 통합 경계를 검증하기 위한 것이다.

## 현재 구현

`src/mes-lite.mjs`는 다음 문맥을 검증한다.

- Work Order, Lot, Product, Recipe, Operation
- Equipment와 `runId` 일치 여부
- `processModeId`와 `operationMode`
- `executionState`와 허용된 상태 전이
- 계획/실제 시작 시각, 작업자 확인 여부

현재 Agent 이벤트에는 `mesContext`가 선택적으로 포함된다. Agent는 이 문맥을 사실로 읽을 수 있지만 Work Order·Lot·운전 모드·설비 제어를 생성하거나 변경할 수 없다.

로컬 실행에서도 `npm.cmd run agent:local-run -- temperature_rise -VirtualMes`로 이 선택적 경계를 재현할 수 있다. 이 플래그는 가상 문맥만 붙이며 실제 MES 조회나 생산 설비 연결을 수행하지 않는다.

## 운전 모드 구분

`operationMode`는 장비 실행 환경(`AUTO`, `SEMIAUTO`, `MANUAL`, `SIMULATE`)을 나타내고, `processModeId`는 외부 공정 데이터의 운전 조건(`MODE_1`, `MODE_3`, `MODE_4`)을 나타낸다. 둘을 같은 필드로 합치지 않은 이유는 장비 실행 방식과 공정 운전 조건이 서로 다른 개념이기 때문이다.

## 공개 데이터 적용

`src/tep-mode.mjs`는 Tennessee Eastman 정상 시계열을 별도 스키마로 읽어 전역 기준선과 모드별 robust 기준선을 비교한다. 현재 데이터는 `data/raw/tep`의 원본과 `data/normalized/tep`의 JSONL로 분리되어 있다.

`scoreTepSeries`는 행 단위 점수와 운영 판정을 분리한다. 이상 점수가 한 번 초과되면 `PENDING_ANOMALY`로 관찰하고, 기본 3행 연속 초과일 때만 `ANOMALY`로 올린다. `processModeId`가 바뀌면 기본 2행을 `MODE_TRANSITION`으로 보류하며, 모드가 기준선에 없으면 `INSUFFICIENT_EVIDENCE`를 반환한다. 이 규칙은 실제 설비 제어가 아니라 시계열 해석과 판단 보류를 검증하기 위한 것이다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/download-tep.ps1
& 'C:\Users\username\AppData\Local\Programs\Python\Python314\python.exe' tools/convert-tep.py
npm.cmd run mode:baseline
```

이번 첫 실행은 Mode 1·3·4 정상 9,003행을 시간 순서로 80/20 분리했다. 모드별 기준선 holdout false-alarm rate는 1.775%, 전역 기준선은 0%였지만, 이는 모드별 기준선이 더 우수하다는 증거가 아니다. Mode 1 후반부 변동을 모드별 기준선이 더 민감하게 표시했고, 전역 기준선은 범위가 넓어 이를 놓쳤을 가능성이 있다. 현재는 모드별 독립 run이 하나씩뿐이므로 일반화 결론을 내리지 않는다.

3행 persistence를 적용한 temporal 결과는 mode-aware 10/1,803행(0.555%)·4개 경보 구간, global 0/1,803행이다. fault가 없는 정상 holdout 결과이므로 탐지 성능 비교가 아니라 운영 보류 규칙의 실행 확인으로만 사용한다.

## 다음 연결 단계

1. 모드별 정상 독립 run을 추가해 시간·run holdout을 분리한다.
2. fault 시나리오와 onset label을 추가해 mode-aware·global 기준선을 오경보·탐지 지연·recall로 비교한다.
3. 모드 미상·MES와 센서 `equipmentId` 불일치 시 Agent가 판단을 보류하게 한다.
4. `get_equipment_state`, `get_recent_trend`, `search_sop`, `verify_recovery`를 읽기 전용 도구로 연결하고 trace를 저장한다.

BaSyx의 AAS·Digital Twin·운전 모드 개념을 참고할 수 있지만, 이 프로젝트에서 BaSyx를 실제 설치하거나 운영했다고 표현하지 않는다. 참고: <https://eclipse.dev/basyx/about/>, <https://wiki.basyx.org/en/latest/content/user_documentation/API/control-components.html>.
