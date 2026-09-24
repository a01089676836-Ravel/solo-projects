# Tennessee Eastman 다중 운전 모드 데이터 카드

## 사용 목적

현재 Agent의 소형 센서 채널에 이 데이터를 섞지 않고, 운전 모드가 정상 기준선과 이상 점수에 미치는 영향을 검증한다. 이 데이터는 화학공정 시뮬레이션이므로 반도체 FAB 또는 Jetson 장비 데이터의 대체물이 아니다.

## 출처와 범위

- 저장소: <https://github.com/mv-per/tennessee-eastman-dataset>
- 고정 커밋: `309b944f35ac440ff0c70616947ffe723c766e14`
- 접근일: 2026-09-14
- 라이선스: 원본 저장소의 `LICENSE`가 MIT로 표시된다. 재배포 전 원본 조건을 다시 확인한다.
- 선택 파일: `mode1_normal_50.xlsx`, `mode3_normal_50.xlsx`, `mode4_normal_50.xlsx`
- 원본 형식: Excel 시계열, `Time`과 `xmv-1`~`xmv-41` 채널
- 정규화 형식: `data/normalized/tep/*.jsonl`, `processModeId`, `runId`, `timeSeconds`, `channels`

## 적합성

- 장점: Mode 1·3·4의 정상 운전 시계열을 비교할 수 있고, 시간·다변량 채널·독립 모드가 있다.
- 한계: 화학공정 시뮬레이션이며 현재 온도·초음파·카메라·모터 센서와 물리적 의미가 다르다.
- 현재 단계: 정상 파일만 확보한다. 고장 파일은 fault active 시점과 라벨 의미를 먼저 확인한 뒤 별도 추가한다.
- 평가: 전역 정상 기준선과 모드별 정상 기준선을 비교하고, 모드 전환·모드 미상 상태에서 보류하는지 확인한다.

## 첫 실행 결과

`npm.cmd run mode:baseline`은 9,003행을 모드별 시간 순서 80/20으로 나누었다. 정상 holdout 1,803행에서 mode-aware 기준선의 false-alarm rate는 1.775%(32건), 전역 기준선은 0%(0건)였다. 이 결과만으로 전역 기준선이 더 좋다고 결론내리지 않는다. 전역 기준선은 모드 간 변동을 넓게 흡수했을 수 있고, mode-aware 기준선은 Mode 1 후반 drift를 민감하게 표시했을 수 있다.

운영 판단 규칙도 별도로 확인했다. 한 행의 이상을 즉시 알리지 않고 3행 연속 초과를 요구하면 mode-aware 결과는 10/1,803행(0.555%)·4개 경보 구간으로 집계되었다. 이는 짧은 튐을 보류하는 persistence 규칙의 동작 증거일 뿐이며, fault 데이터가 없으므로 recall·탐지 지연·현장 성능 향상으로 해석하지 않는다.

현재는 모드별 독립 run이 하나씩뿐이고 fault 파일을 포함하지 않았으므로, 이 결과는 모드-aware 파이프라인의 실행 증거이지 일반화·fault recall 성능이 아니다.

## 재현

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/download-tep.ps1
& 'C:\Users\username\AppData\Local\Programs\Python\Python314\python.exe' tools/convert-tep.py
```

원본 파일과 변환 파일의 해시는 각 manifest에 기록한다. 최종 모델 평가용 분할은 모드·run 단위로 별도 결정하며, 변환 결과를 임의로 섞어 시간 누수를 만들지 않는다.
