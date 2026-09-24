# 첫 기준선 실험 결과

UCI AI4I 합성 데이터의 표형 이상 점수 실험. 실제 공장 성능이 아님.

| 방법 | Test precision | Test recall | 정상 표본 오경보율 | Average precision |
|---|---:|---:|---:|---:|
| max_abs_z | 20.27% | 39.47% | 3.17% | 0.1662 |
| mean_squared_z | 17.58% | 42.11% | 4.03% | 0.1505 |

Test 표본 1900개, 고장 라벨 38개.
목표 라벨과 고장 유형 OR의 불일치: 27개. 원본을 수정하지 않고 Machine failure를 평가 기준으로 유지.

AP는 동점 점수를 묶은 비보간 average precision이며 사다리꼴 PR-AUC와 구분한다.
임계값은 정상 validation 점수의 95백분위에서 고정했다. Test 결과를 보고 조정하지 않았다.
정상 데이터의 평균·표준편차는 train에서만 계산했다. 두 방법은 동일한 다섯 센서·운전 변수와 분할을 사용한다.
UDI 순서 블록과 100행 gap은 실험 설계이며 실제 시간·설비 독립성을 보증하지 않는다.

재현: `node src/baseline.mjs` / 검증: `node --test tests/baseline.test.mjs`
상세 지표·분할·정규화 계수·데이터/코드/설정 해시는 baseline.json 참조.
