# PCB 최종검사 AI: 불량 검출과 성능 분석

pcb-manufacturer **PCB 최종검사 AI 엔지니어** 직무를 겨냥한 1인 실습 프로젝트입니다. 공개 PCB 이미지를 YOLO 형식으로 변환하고, 여섯 종류의 결함을 검출하는 모델을 학습한 뒤, 보류한 PCB 그룹에서 미탐과 오탐을 분석합니다. 한 장의 검사 이미지를 입력하면 결함 위치와 검토용 HTML 화면을 만듭니다.

> 이 결과는 공개 연구 데이터에 대한 실험입니다. 실제 pcb-manufacturer 생산 데이터나 현장 검사 성능을 나타내지 않으며, 자동 합격 판정에 사용하지 않습니다.

## 직무와 기존 조별 프로젝트의 연결

| pcb-manufacturer 공고의 업무 | 이 프로젝트의 산출물 |
| --- | --- |
| 최종검사 AI 성능 및 소프트웨어 개선 | 결함 검출 학습 코드, 재현 가능한 실행 기록, 검사 화면 |
| 최종검사 통계 분석 및 보고 | 클래스별 정밀도·재현율, 정상 이미지 오탐률, 결함 이미지 무검출률, 오류 사례 JSON |
| AI 성능 향상을 위한 개별 프로그램 개발 | 원천 자료 변환, 그룹 단위 분할, 평가 및 단일 이미지 검토 CLI |

사용자의 기존 조별 프로젝트는 Jetson 기반 안전 제어 시스템으로, 센서 시계열·FSM 이벤트를 SQLite에 남기고 Agent가 비동기로 분석하는 흐름입니다. 이 프로젝트는 **PCB 이미지의 결함 종류와 위치를 학습·검출·평가**합니다. 공통된 제조 AI 맥락을 유지하면서 본인의 비전 모델 개발 역량을 별도로 보여 줍니다.

## 데이터와 평가 설계

- 원천: [DeepPCB 공식 저장소](https://github.com/tangsanli5201/DeepPCB)의 이미지 쌍 1,500개와 결함 주석. 원본 보관 파일의 SHA-256은 `188ce2f58e0d53081ef8559263e34d745ac1d5e2f46e875002f5de68d8cc43dd`입니다. 데이터는 연구 용도로 제공되며, 합성된 결함이 포함됩니다.
- 결함 종류: `open`, `short`, `mousebite`, `spur`, `spurious_copper`, `pin_hole`.
- 분할 단위: 이미지가 아닌 **원천 PCB 그룹**. 같은 그룹의 인접한 이미지와 정상 템플릿이 학습·검증·테스트에 동시에 나타나지 않게 합니다. 이 분할은 DeepPCB의 공식 분할과 다르므로 그 논문의 성능 수치와 직접 비교할 수 없습니다.
- 학습: 결함 이미지 1,059장, 정상 템플릿 265장. 검증: 결함 74장, 정상 74장. 테스트: 결함 367장, 정상 367장. 전체 결함 이미지는 1,500장입니다.
- 정상 템플릿은 결함이 없는 이미지로 사용합니다. 학습에는 정상 템플릿의 25%를 고정 해시 기준으로 넣고, 검증·테스트에는 모두 넣어 정상 이미지의 오탐도 측정합니다.
- 테스트 그룹은 모델·임계값 선택에 사용하지 않습니다. 학습 결과의 `validation_metrics`와 테스트 평가 JSON을 구분합니다.

표준 mAP는 Ultralytics 평가기로 보류 테스트 그룹에서 별도로 측정합니다. 운영 지표 평가 코드는 신뢰도 `0.25`, 클래스 일치, IoU `0.5`를 기준으로 예측 결함과 정답을 **일대일 매칭**합니다. `precision = TP/(TP+FP)`, `recall = TP/(TP+FN)`입니다. 정상 이미지 오탐률은 정상 이미지 중 검출이 한 건이라도 나온 비율입니다. 결함 이미지 무검출률은 정답과 일치한 예측이 한 건도 없는 결함 이미지의 비율입니다. `mean_inference_ms`는 Ultralytics가 보고한 모델 추론 시간 평균으로, 파일 읽기·전처리·후처리·화면 생성 시간을 포함한 전체 처리 시간은 아닙니다.

## 이번 실행 결과 (2026-09-24)

10회 학습의 최고 가중치 기준 검증 mAP50은 **79.4%**였습니다. 보류 테스트 그룹 734장에서는 표준 **mAP50 90.8%**, **mAP50–95 62.8%**였습니다. 고정 신뢰도 0.25와 IoU 0.5에서 결함 객체 2,561개 중 2,329개를 맞춰 재현율 **90.9%**, 정밀도 **67.4%**였습니다. 그러나 정상 이미지 367장 중 **165장(45.0%)**에서 한 건 이상 오탐이 발생했습니다. 따라서 현 임계값의 결과를 현장 자동 판정 성능으로 해석할 수 없습니다. 결함 이미지 단위로는 367장 모두 적어도 한 결함이 일치했지만, 개별 결함 232개는 놓쳤습니다.

검증 그룹에서 신뢰도를 0.25 → 0.50 → 0.75로 올리면 정상 이미지 오탐률은 **48.6% → 23.0% → 6.8%**로 줄고, 결함 객체 재현율은 **81.4% → 70.2% → 53.2%**로 낮아졌습니다. 이번 실행에서는 신뢰도 0.25의 테스트 결과를 먼저 확인한 뒤 이 임계값 탐색을 수행했습니다. 0.50·0.75의 독립 테스트 성능을 주장하지 않으며, 새 임계값을 채택하려면 새로운 보류 데이터로 확인해야 합니다. 자세한 클래스별 결과는 `reports/analysis.md`, 학습 추이는 `reports/training-curve.png`에 있습니다.

## 실행 환경 및 재현 방법

검증 환경: Windows, Python 3.12, CPU, `torch 2.13.0+cpu`, `ultralytics 8.4.152`. GPU는 필요하지 않지만 CPU에서 전체 학습에 시간이 걸립니다.

프로젝트 루트에서 다음을 실행합니다. 원본 데이터 파일과 모델 가중치는 Git에 넣지 않습니다.

```powershell
python -m pip install -r requirements.txt
curl.exe -fL "https://github.com/tangsanli5201/DeepPCB/archive/refs/heads/master.zip" -o .\DeepPCB-source.zip
Get-FileHash .\DeepPCB-source.zip -Algorithm SHA256
python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"
python -m pcb_inspection.dataset --archive .\DeepPCB-source.zip
python -m pcb_inspection.audit
python -m unittest discover -s tests -v
python -m pcb_inspection.train --name candidate_cpu_320 --epochs 10 --imgsz 320 --batch 8 --device cpu
python -m pcb_inspection.plot_training --history .\runs\candidate_cpu_320\results.csv --output .\reports\training-curve.png
python -m pcb_inspection.evaluate --model .\runs\candidate_cpu_320\weights\best.pt --split val --conf 0.25 --imgsz 320 --output .\reports\val-conf-025.json
python -m pcb_inspection.evaluate --model .\runs\candidate_cpu_320\weights\best.pt --split val --conf 0.50 --imgsz 320 --output .\reports\val-conf-050.json
python -m pcb_inspection.evaluate --model .\runs\candidate_cpu_320\weights\best.pt --split val --conf 0.75 --imgsz 320 --output .\reports\val-conf-075.json
python -m pcb_inspection.benchmark --model .\runs\candidate_cpu_320\weights\best.pt --imgsz 320 --output .\reports\test-map.json
python -m pcb_inspection.evaluate --model .\runs\candidate_cpu_320\weights\best.pt --split test --imgsz 320 --output .\reports\test-evaluation.json
python -m pcb_inspection.report --run .\runs\candidate_cpu_320\run-record.json --benchmark .\reports\test-map.json --evaluation .\reports\test-evaluation.json --validation .\reports\val-conf-025.json .\reports\val-conf-050.json .\reports\val-conf-075.json --output .\reports\analysis.md
python -m pcb_inspection.inspect --model .\runs\candidate_cpu_320\weights\best.pt --image .\data\processed\deeppcb_group_holdout_v1\images\test\group00041_00041000_defect.jpg --output .\reports\inspection-demo --imgsz 320
python -m pcb_inspection.inspect --model .\runs\candidate_cpu_320\weights\best.pt --image .\data\processed\deeppcb_group_holdout_v1\images\test\group00041_00041001_normal.jpg --output .\reports\false-alarm-example --imgsz 320
```

원본 ZIP을 다시 받았을 때 해시가 위 값과 다르면 저장소 내용이 바뀌었을 수 있습니다. 변환기는 이미지 수와 보류 그룹을 확인하고, 데이터 변환 기록을 `data/processed/deeppcb_group_holdout_v1/manifest.json`에 남깁니다. 학습 설정·라이브러리 버전·검증 수치는 `runs/candidate_cpu_320/run-record.json`에 남습니다.

## 폴더 안내

| 폴더 | 용도 |
| --- | --- |
| `pcb_inspection/` | 데이터 변환, 학습, 평가, 검사 화면 생성 코드 |
| `data/processed/deeppcb_group_holdout_v1/` | PCB 그룹별로 나눈 이미지·주석·데이터 기록 |
| `runs/candidate_cpu_320/` | CPU에서 320px로 학습한 후보 모델과 학습 기록 |
| `runs/smoke/` | 전체 학습 전에 실행한 소규모 동작 확인 결과 |
| `runs/detect/` | Ultralytics가 생성한 검출 실행 결과 |
| `reports/` | 성능 지표, 분석 문서, 검사 화면 및 오류 사례 |
| `tests/` | 데이터 변환과 평가 로직의 자동 검사 |

## 결과물

| 경로 | 내용 |
| --- | --- |
| `pcb_inspection/dataset.py` | 원천 ZIP 검증, 결함 상자 변환, 그룹별 데이터 분할 |
| `pcb_inspection/audit.py` | 전체 변환 데이터의 파일·주석·그룹·결함 수 확인 |
| `pcb_inspection/train.py` | YOLO11n 학습과 실행 기록 |
| `pcb_inspection/plot_training.py` | 학습 회차별 검증 mAP 변화 그림 |
| `pcb_inspection/benchmark.py` | 보류 테스트 그룹의 표준 YOLO mAP 측정 |
| `pcb_inspection/evaluate.py` | 테스트 결함 매칭, 오탐·미탐 및 클래스별 통계 |
| `pcb_inspection/report.py` | 학습 기록과 평가 JSON으로 통계 보고서 생성 |
| `pcb_inspection/inspect.py` | 원본·검출 결과 비교 HTML, 좌표 및 신뢰도 JSON |
| `tests/test_pipeline.py` | 변환·분할·매칭에 대한 회귀 검사 |
| `reports/test-evaluation.json` | 보류 데이터의 실제 평가 수치. 학습과 평가를 실행하면 생성 |
| `reports/test-map.json` | 테스트 그룹의 표준 검출 mAP. 실행하면 생성 |
| `reports/training-curve.png` | 모델 학습 중 검증 성능 변화. 학습 기록으로 생성 |
| `reports/analysis.md` | 검증·테스트 지표와 클래스별 오류를 요약한 보고서. 실행하면 생성 |
| `reports/inspection-demo/index.html` | 사람이 확인하는 단일 이미지 검사 화면. 실행하면 생성 |
| `reports/false-alarm-example/index.html` | 정상 템플릿에 3건을 잘못 검출한 오류 사례. 이번 실행에서 생성 |

## 해석과 다음 실험

현재 공개 데이터에는 실제 생산 라인의 카메라·조명·불량 발생률·판정 비용이 반영되어 있지 않습니다. 이 실험의 모델을 현장에 쓰려면 실제 정상·불량 샘플로 분포 차이를 확인하고, 사람 검토를 포함한 미탐·오탐 기준과 처리 속도를 다시 검증해야 합니다. 다음 개선 후보는 원본 크기 학습, 결함별 오류 분석, 검증 그룹에서 신뢰도 임계값 조정, 템플릿 비교 방식과의 성능 비교입니다. 모든 개선안은 테스트 그룹을 한 번만 최종 평가하는 방식으로 확인합니다.

모델은 [Ultralytics YOLO11 문서](https://docs.ultralytics.com/models/yolo11/)와 [학습 문서](https://docs.ultralytics.com/modes/train/)를 기준으로 실행했습니다. pcb-manufacturer 직무 범위는 [채용 공고](https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=54931415)를 참고했습니다.
