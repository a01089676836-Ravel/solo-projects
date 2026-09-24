# 프로젝트 작업 규칙

- 이 프로젝트는 industrial-automation DT 직무를 겨냥한 별도 1인 프로젝트다. 기존 `manufacturing-agent-kit`의 제조설비 이상탐지·유지보수 Agent와 목적과 코드를 섞지 않는다.
- 현재 MVP는 오프라인 결정론적 코어다. 입력 데이터와 결과가 외부 API로 전송되지 않는다.
- `KPI`는 자동으로 지어내는 값이 아니다. 기준값이 없으면 `baseline_required`로 보류하고 사람에게 측정을 요청한다.
- Copilot은 과제 카드, 우선순위, 로드맵, KPI 초안을 제안할 뿐이다. 예산·목표·추진 여부를 자동 승인하지 않는다.
+ 회사 내부 데이터나 실제 industrial-automation 성과를 사용했다고 주장하지 않는다. `01_입력데이터_실행기록/candidate-initiatives.json`의 값은 합성 포트폴리오 픽스처다.
- 변경 후 `npm.cmd test`와 `npm.cmd run demo`를 실행하고, 결과의 제한사항을 `STATE.md`에 기록한다.
- Astra API 연결은 별도 단계로 다룬다. 키를 저장하거나 복사하지 않으며, 연결 성공을 확인하기 전에는 live 검증으로 표시하지 않는다.
- 최종 목표는 상용화 가능한 제품 후보다. 다만 Phase 0/Phase 1/Phase 2/Phase 3을 구분하고, 보안·운영·고객 검증이 없으면 `commercial` 또는 `production`이라고 주장하지 않는다.
- 제품 기능을 추가할 때는 데이터 경계, 테넌트·사용자 권한, 감사 이벤트, 오류 계약, 복구 방식, 관측 지표를 함께 정의한다.
- 모든 LLM 제안은 구조화 출력·출처·근거 부족 상태·사람 승인 경계를 거쳐야 한다. LLM provider를 바꾸어도 결정론적 정책 계층은 유지한다.
