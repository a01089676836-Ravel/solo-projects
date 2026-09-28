# 구매 업무 로그 기반 병목 분석·개선 검증

실제 공개 구매 업무 로그에서 처리 흐름과 시간이 오래 걸리는 구간을 찾고, 원본 사례를 확인한 뒤 개선 가정을 비교하는 1인 프로젝트입니다.

**현재 단계: 실제 원본 전체 분석을 완료한 로컬 MVP. 현장 개선 효과를 입증한 제품은 아닙니다.**

처음에는 [제작 과정과 판단 근거](00_처음읽기_제작과정과판단근거.md)를 읽고, `실행.cmd`를 두 번 클릭하세요. 서버 실행 후 브라우저에서 <http://127.0.0.1:8770>을 여세요. 서버를 종료할 때는 실행 창에서 Ctrl+C를 누릅니다. 브라우저를 닫아도 서버는 종료되지 않습니다.

## 이번에 확인한 결과

| 항목 | 결과 |
|---|---:|
| 원본 구매 항목 | 251,734건 |
| 원본 이벤트 | 1,595,923건 |
| 선택 구매 유형 | 3-way match, invoice before GR |
| 해당 유형 | 221,010건 |
| 비교 조건을 충족한 사례 | 160,642건 |
| 제외 사례 | 60,368건 |
| 생성 → 지급 기록 중앙값 | 76.70일 |
| P90 | 126.17일 |
| 가격 변경 기록이 있는 사례 | 6,970건, 4.34% |

가장 큰 조사 후보는 **송장 접수 기록 → 지급 기록**입니다. 그 구간의 경과시간을 20% 줄이고 다른 구간은 그대로라고 가정하면 전체 코호트 중앙값은 69.29일로 계산됩니다. **7.41일 차이는 가정 기반 계산이며 실제 절감 실적이 아닙니다.** 계약 지급조건을 준수하는 정상 기간도 포함되어 있을 수 있습니다.

## 구현 범위

- 공식 XES 원본의 파일 크기·MD5 검사와 SHA-256 기록
- 전체 데이터를 스트리밍 변환하여 SQLite에 저장
- 구매 유형 분리, 사례별 포함·제외 사유 보존
- 활동 간 직접 전이(DFG), 대표 경로, 중앙값·P90·가격 변경 기록 집계
- 원본 사례 ID와 이벤트 순번·시간을 이용한 근거 추적
- 조사 후보 구간의 0/10/20/30% 단축 가정 비교
- 읽기 전용 웹 화면, 활동 검색, 사례 타임라인, 개선 가정 선택
- 독립 SQL 집계, 자동 테스트, 데이터·분석·검증 보고서

첫 버전은 Python 표준 라이브러리로 직접 전이를 집계합니다. PM4Py 설치, Petri net 기반 정합성 검사, 예측 모델, LLM 호출은 이 버전에 포함하지 않았습니다. 데이터가 어떻게 수치로 바뀌는지 확인하기 쉽고 유료 API 없이 재현되도록 선택했습니다.

## 실행 및 재현

Python 3.11 이상이 필요합니다. 검증 환경은 Python 3.14.6, SQLite 3.50.4, Windows입니다. 분석 실행에는 외부 Python 패키지가 필요하지 않습니다. Node.js는 화면 로직의 개발 테스트에만 사용합니다.

프로젝트 폴더에서:

```powershell
# 포함된 DB·보고서를 이용해 화면 실행
.\run.ps1

# 원본이 없을 때만 공식 데이터 다운로드: 약 729 MB
.\download.ps1

# Python 실행기를 지정해 전체 재현
python pipeline.py all

# 이미 DB가 있으면 분석과 검증만 재실행
python pipeline.py analyze
python pipeline.py verify

# 로직·HTTP 테스트
python -m unittest discover -s tests -v

# 생성된 보고서를 사용하는 화면 로직 테스트
node --test tests/test_web.mjs

# 위 검증을 실행하고 로그·종료 코드를 reports에 기록
python verify_project.py
```

현재 PC에서 `python`을 찾지 못하는 셸은 다음 경로를 사용할 수 있습니다.

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" pipeline.py verify
```

`run.ps1`은 설치된 Python 경로를 찾아 실행합니다. 원본/DB/분석 결과가 없으면 자동으로 임의 샘플을 만들지 않고 필요한 명령을 안내합니다. 8770 포트를 이미 사용하고 있다면 기존 화면을 확인하거나 `python pipeline.py serve --port 8771`처럼 다른 포트를 사용하세요.

실제 브라우저 검증도 완료했습니다. Chrome 153에서 표시·검색·사례 선택·시나리오 변경·오류 복구·데스크톱/모바일 폭을 10개 항목으로 확인했습니다. [화면 검증 결과](reports/browser/검증결과.md)에 캡처와 수정 내용을 기록했습니다.

개발자가 다시 브라우저 검사를 실행하려면 Chrome과 Node.js가 설치된 상태에서:

```powershell
npm ci --ignore-scripts
# 먼저 별도 터미널에서 python pipeline.py serve 실행
$env:DASHBOARD_URL = 'http://127.0.0.1:8770'
npm run test:browser
```

Playwright는 개발 검증용 의존성이며 대시보드 일반 실행에는 필요하지 않습니다. 별도 headless Chrome을 사용하므로 사용자의 열린 탭·로그인 정보를 사용하지 않습니다. 구현 기준은 [Playwright 공식 브라우저 안내](https://playwright.dev/docs/browsers#google-chrome--microsoft-edge)를 참고했습니다.

다른 구매 유형을 분석할 수 있으나 기본 코호트는 입고를 요구합니다. 입고가 없는 2-way·Consignment를 그대로 분석하면 비교 코호트가 비게 되므로 유형별 규칙을 먼저 설계해야 합니다.

## 파일 안내

| 파일 | 역할 |
|---|---|
| `pipeline.py` | 원본 변환·코호트·지표·시나리오·독립 SQL 검증 |
| `server.py` | loopback 읽기 전용 서버·사례 조회 API |
| `web/` | 한국어 사용자 화면 |
| `tests/` | 계산·시간·누락·반복 처리·HTTP·화면 로직 테스트 |
| `data/raw/source-metadata.json` | 공식 출처·이용 조건·원본 MD5 |
| `data/raw/BPI_Challenge_2019.xes` | 변경하지 않은 공식 원본 |
| `data/events.sqlite` | 정규화한 사례·이벤트·변환 기록 |
| `reports/data-manifest.json` | 원본 해시·행 수·환경·변환 규칙 |
| `reports/analysis.md` | 읽기 쉬운 결과 보고서 |
| `reports/analysis.json` | 전체 지표·전이·근거·가정 계산 |
| `reports/cohort-membership.json` | 모든 대상 사례의 포함·제외 사유 |
| `reports/evidence-cases.json` | 상위 조사 후보의 대표 사례 |
| `reports/verification.json` | 독립 검증 결과 |
| `reports/test-results.txt` | 실제 테스트 출력 |
| `docs/metrics-and-decisions.md` | 지표 정의·대안·해석 한계 |
| `docs/evidence-log.md` | 실제 작업과 확인 결과 |
| `STATE.md` | 현재 상태와 다음 개발 단계 |

## 출처 및 이용 조건

van Dongen, Boudewijn (2019). **BPI Challenge 2019**. 4TU.ResearchData. CC BY 4.0.

- DOI: https://doi.org/10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1
- 공식 메타데이터 API: https://api.figshare.com/v2/articles/12715853
- 라이선스: https://creativecommons.org/licenses/by/4.0/

원본은 네덜란드 소재 다국적 도료·코팅 기업의 익명화된 구매 기록입니다. 어떤 특정 기업의 내부 데이터도 아닙니다. 이 프로젝트는 UTC 정렬, 일부 필드 선택, 코호트 필터링 및 집계를 수행했습니다. 원본과 변환물을 재배포할 때 출처·라이선스·변경 내용을 함께 유지하세요. 금액 및 사용자별 평가는 구현하지 않았습니다.

## 해석에서 지킬 경계

긴 경과시간만으로 비효율이나 원인을 확정하지 않습니다. 반복 이벤트는 분할 처리일 수 있고, 한 번의 지급 기록은 완납을 증명하지 않습니다. 전체 데이터 중 관측 가능한 단순 사례만 비교하므로 미지급·복잡한 사례가 제외되는 선택 편향이 있습니다. 성과는 공개 로그의 분석 및 가정 검증으로 표현합니다.
