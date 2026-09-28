# 구매 업무 병목 후보 분석 결과

생성 시각: 2026-09-25T04:44:58.048646+00:00

공식 원본: 251,734 cases / 1,595,923 events.
유형: `3-way match, invoice before GR` — 221,010건 중 비교 코호트 160,642건, 제외 60,368건.

## 관측 결과

주문 항목 생성 → 지급 기록 경과시간: 중앙값 **76.70일**, P90 **126.17일**.
가격 변경 기록이 있는 사례: 6,970건 (4.34%). 오류나 불필요한 재작업으로 확정하지 않음.

| 인접 활동 | 발생 수 | 중앙값(일) | 누적 사례·일 |
|---|---:|---:|---:|
| Record Invoice Receipt → Clear Invoice | 117,394 | 38.04 | 5409094.06 |
| Record Goods Receipt → Record Invoice Receipt | 86,867 | 11.85 | 1679076.43 |
| Remove Payment Block → Clear Invoice | 41,743 | 29.90 | 1637937.94 |
| Create Purchase Order Item → Vendor creates invoice | 83,397 | 5.62 | 937744.36 |
| Vendor creates invoice → Record Invoice Receipt | 71,181 | 4.37 | 825734.57 |
| Record Invoice Receipt → Remove Payment Block | 27,544 | 9.72 | 651043.90 |
| Create Purchase Order Item → Record Goods Receipt | 43,344 | 10.95 | 576602.71 |
| Vendor creates invoice → Record Goods Receipt | 84,058 | 1.43 | 196912.88 |
| Record Goods Receipt → Vendor creates invoice | 59,297 | 0.61 | 186564.34 |
| Receive Order Confirmation → Record Goods Receipt | 13,966 | 4.97 | 90523.74 |

누적 사례·일은 사례별 구간 경과시간의 합입니다. 공장 가동일·노동시간·회수 가능한 비용이 아닙니다.

## 가정 기반 개선 민감도

최소 30개 사례에 나타난 구간 중 누적 경과시간이 가장 큰 구간을 조사 후보로 선정합니다.
선택 구간: `{'source': 'Record Invoice Receipt', 'target': 'Clear Invoice'}`

| 구간 단축 가정 | 전체 코호트 중앙값(일) | 중앙값 차이(일) |
|---|---:|---:|
| 0% | 76.70 | 0.00 |
| 10% | 72.54 | 4.16 |
| 20% | 69.29 | 7.41 |
| 30% | 65.31 | 11.39 |

실행 제안: 해당 구간의 계약 지급조건·배치 실행 주기·예외 보류 사유를 확인한 뒤 변경 가능한 시간을 구분합니다.
현장 검증: 비교 가능한 업무 집단과 관측기간을 정하고 중앙값·P90·오류율을 함께 측정합니다.

## 근거 및 한계

원본 해시: `af63bc687fc4152f2123b05c3af7772b37ef3fce2d3f67f812666c9e356baae7`

`analysis.json`에 전체 전이·사례 근거, `cohort-membership.json`에 사례별 포함/제외 사유, `evidence-cases.json`에 대표 사례 타임라인이 있습니다.

- 이벤트 간 경과시간은 순수 대기시간·작업시간 또는 낭비를 뜻하지 않습니다.
- 단일 생성·입고·송장·지급 기록이 있는 사례만 비교합니다. 전체 구매를 대표하지 않습니다.
- 한 번의 Clear Invoice는 금액 대사나 최종 완납을 증명하지 않습니다.
- 동시각 이벤트 순서는 원본 순서를 보존하며 실제 선후관계를 입증하지 않습니다.
- 반복 입고·송장은 정상 분할 처리일 수 있습니다. 오류·재작업으로 단정하지 않습니다.
- 기간 말 미지급 사례 제외에 따른 선택 편향과 관측기간 제한이 있습니다.
- 시나리오는 다른 구간 고정이라는 가정의 산술 민감도 분석입니다. 실제 절감·인과 효과가 아닙니다.
- 지급조건·계약 납기·서비스 시간 정보가 없어 경과시간이 긴 이유를 확정할 수 없습니다.

출처: van Dongen, Boudewijn (2019). BPI Challenge 2019. 4TU.ResearchData. CC BY 4.0.
https://doi.org/10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1
