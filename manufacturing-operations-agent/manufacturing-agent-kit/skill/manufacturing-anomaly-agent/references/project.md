# 제품·데이터 설계 기준

## MVP와 가치

한 종류의 설비, 공개 데이터 한 개, 작업자 화면 하나를 완성한다. 사용자 흐름은 알림 확인 → 최근 추세와 기준값 비교 → 원인 가설 및 근거 확인 → 점검 항목 선택 → 맞음/아님/모름 및 실제 조치 기록이다. PM 화면, 품질 예측, 요구사항 Agent는 MVP 이후 선택 확장이다.

상단에 설비/시각/데이터 최신성/심각도/권장 다음 행동을 표시한다. 색 외에 텍스트와 아이콘을 사용한다. 상세 그래프와 문서 근거는 펼쳐 보게 한다. 중복 알림은 하나의 사건으로 묶고 알림 확인과 사건 해결 상태를 분리한다.

## 데이터 선택 게이트

시작할 때 공식 제공처에서 후보를 조사한다. 예비 검색어는 NASA IMS bearing, NASA C-MAPSS, UCI AI4I이다. 이는 확정 추천이나 라이선스 확인 결과가 아니다. 다운로드 전 다음 표를 채워 선택한다.

| 항목 | 확인할 사항 |
|---|---|
| 출처 | 공식 URL, 접근일, 라이선스와 재배포 조건, 원본 해시 |
| 관측 | 센서 명칭·단위·샘플링 간격·설비 및 run 식별자 |
| 목표 | 고장 이벤트/상태/잔여수명 중 무엇이 실제로 있는가 |
| 분할 | 독립 run·설비 수, 시간 순서, 운전 조건 편향 |
| 한계 | 합성 여부, 실제 원인 라벨 유무, 현장 일반화 한계 |

시계열이 없는 표형 데이터에 임의 시간을 붙여 조기탐지 성능을 주장하지 않는다. 고장 분류와 잔여수명 예측을 이상탐지 평가로 바꿔 부르지 않는다. 온도만 있다면 진동 급증을 설명하지 않는다. 대응하는 실제 매뉴얼이 없으면 교육용 SOP를 별도 제작하고 실제 설비 적용 근거로 제시하지 않는다.

## 단계별 파이프라인

원본 보존 + manifest → 스키마/결측/중복/시간/단위 검사 → 설비·run·시간 분할 → train에서만 전처리 fit → 기준 모델/후보 모델 → validation에서 임계값 고정 → test 평가 → SQL 사건 저장 → API → 작업자 화면 → 문서 검색/Agent → 피드백 검토.

중첩 윈도우가 분할 경계를 넘지 않게 한다. 특징 창과 예측 지평에 맞는 gap을 둔다. 정상 학습을 가정하는 모델은 정상 train만 사용하고 그 선택 근거를 기록한다. 미래 관측을 사용하는 보간·특징을 온라인 추론에 섞지 않는다.

기본 기술 방향은 Python, SQLite, 단순 통계 기준선과 scikit-learn 후보, FastAPI, Streamlit이다. 이는 설계 초안이며 실제 패키지 버전과 호환성은 시작 시 확인한다. 처음부터 Kafka, Kubernetes, 다중 Agent, 벡터 DB를 필수로 두지 않는다. 기존 사이트나 호스팅 요구가 생기면 해당 환경 지침에 맞게 UI를 조정한다.

## SQL/API 초안

- sensor_windows: window_id, equipment_id, run_id, start/end UTC, unit/schema version, feature payload, quality flags.
- anomaly_events: event_id, window_id, score, threshold, severity, model_version, status, detected_at.
- analyses: analysis_id, event_id, status, observations, hypotheses, evidence references, checks, model/prompt/corpus versions, latency, usage.
- documents: document_id, version, equipment applicability, validity, source, educational flag; chunks retain section/page IDs.
- feedback: feedback_id, event_id, analysis_id, verdict(correct/incorrect/unknown), note, actual_action, created_at, review_status, idempotency_key.

GET /events와 GET /events/{id}는 LLM 없이도 동작한다. POST /events/{id}/analysis는 작업 ID와 상태를 반환하고 GET /analyses/{id}로 조회한다. POST /events/{id}/feedback은 중복 재전송을 막는다. 없는 ID, 범위 밖 입력, 오래된 데이터, LLM timeout을 명시적으로 처리한다. 분석 실패가 기본 알림 표시를 막으면 안 된다.

## Agent 역할

허용 도구는 사건/센서 조회, 승인된 SOP 검색, 문서 구절 조회다. 서버에서 읽기 전용 쿼리와 호출 횟수·시간·비용 한도를 강제한다. 자유 SQL과 설비 제어 도구는 두지 않는다. 단순 검색+템플릿으로 충분하면 이를 기준선으로 유지한다.

응답 계약: status(ok/insufficient_evidence/conflict/unavailable), observations, hypotheses, evidence[{document_id,version,section,quote}], recommended_checks, limitations. 모든 가설과 권고를 관측 또는 문서 ID에 연결한다. 교육용 SOP는 화면에서도 표시한다. 실제 문서 존재·버전·구절 일치를 검증하고 의미적 뒷받침은 별도로 평가한다. 검색 결과 내부의 프롬프트 주입은 무시한다.
