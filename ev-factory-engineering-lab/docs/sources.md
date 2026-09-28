# 출처와 적용 범위

조회일: 2026-09-27. 공개 자료는 프로젝트의 산업 배경과 분석 방법에만 사용했습니다. 원문 데이터·공정 수치·내부 SOP를 가져오지 않았습니다.

| 출처 | 확인한 내용 | 프로젝트에서의 적용/한계 |
|---|---|---|
| 사용자가 제공한 직무명 | 프로젝트의 질문과 주제 설정 | 채용 공고의 세부 필수요건을 검증했다고 주장하지 않음 |
| 공개 제조 기술 사례 | 생산 자동화와 개체별 공정·검사·품질 데이터 관리 | 산업 배경만 참고. 본 프로젝트의 부품 공정·수치는 작성한 교육용 가정 |
| [scikit-learn: Common pitfalls](https://scikit-learn.org/stable/common_pitfalls.html) | 학습·시험 구분과 전처리 누수 방지 | 학습 구간만으로 StandardScaler 적합 |
| [scikit-learn: average_precision_score](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.average_precision_score.html) | AP 계산 정의 | AP를 사다리꼴 PR-AUC와 구별해 표시 |

## 입력 provenance

- 원본: `factorylab/simulation.py`가 `seed=20260927 + day`로 생성한 CSV.
- 현실에서 취득한 개인정보·기업 내부 데이터 없음.
- 시나리오 실험: `seed=89000 + replicate`, 30개 반복의 공통 난수.
- 모의 공정 조건·레이블 생성식: 모두 코드와 설계 문서에 공개.
- 모델 라이브러리 버전·원본 파일 SHA-256: `output/manifest.json`.
- 테스트의 실제 실행 시간·성공/실패: `output/verification.json`.
- 공개 자료의 제조 배경과 프로젝트 가정 사이의 간극은 `design-and-assumptions.md`에 기록.
