# 켄텍 창의성 면접 연습실

한국에너지공과대학교(KENTECH) 수시 창의성 면접을 연습하는 정적 웹앱입니다. 과학·사회 쟁점을 다루는 창작 게임과 에너지 정책 시뮬레이션(전력 리그)으로 세 가지 말하기 습관을 연습합니다. 판단 기준을 먼저 말하기, 얻는 것과 잃는 것을 한 문장에 담기, 반문을 받은 뒤 답을 고치거나 유지하는 이유를 말하기입니다.

**비공식 안내.** 이 저장소는 대학과 관계없는 개인이 학습용으로 만든 비공식 연습 도구입니다. 대학의 출제 경향이나 채점 기준을 대신하지 않습니다.

**이 공개 사본에는 기출 원문이 없습니다.** 원래 앱에는 2022~2026학년도 기출을 옮긴 게임이 있지만, 이 사본에서는 문항·제시문·자료를 모두 뺐습니다. 홈의 기출 카드나 리그의 '2022 기출로 연습하기'를 누르면 그 사실을 알리는 안내만 나옵니다. 기출 원문은 대학이 공개하는 선행학습 영향평가 보고서에서 확인하세요.

## 들어 있는 것

| 화면 | 내용 |
|---|---|
| 창작 쟁점 게임 5종 | 섬 전력망, 시멘트 공장 탄소 장부, 변이 판독대, 자율주행 셔틀 허가, 강 가뭄 협상. 배경과 수치는 가상이며 과학 원리는 실제를 따릅니다 |
| 연습 도구 | 판단 노트, 반문 카드와 말해 보기, 짝 면접, 짧은 판단 훈련장(`#drill`), 시간 설정 |
| 섬 전력망 건설(`#build`) | 지도에 설비를 짓고 송전선을 이은 뒤 1주·1달·3달을 돌려 정전·비용·CO₂·민원을 봅니다 |
| 전력 리그(`#league`) | 2~6팀이 도시 하나씩 맡아 전력망·재정·이주·지지율을 함께 운영합니다. 혼자 하기(`#league/solo`)는 컴퓨터 도시와 겨룹니다 |

도시 이름은 실제 지명을 쓰지만 시설 배치·정책 효과·점수 가중은 연습용 가정입니다. 근거 등급(O/O*/P/M/G)은 화면과 아래 근거 문서에 밝혔습니다. 입력한 내용은 브라우저 localStorage에만 저장되며, 리그를 여러 기기에서 할 때만 같은 방 기기 사이에 계획·숫자가 오갑니다.

## 실행

빌드 단계가 없는 정적 파일입니다. 저장소 폴더에서 정적 서버를 띄우고 브라우저로 엽니다.

```bash
python3 -m http.server 8000
```

그다음 `http://127.0.0.1:8000/`을 엽니다. 서로 다른 태블릿으로 리그를 할 때는 https 주소로 접속해야 합니다(요청 서명에 WebCrypto가 필요합니다).

## 검사

저장소 루트에서 실행합니다. Node 24와 Python 3(Playwright 1.63)을 씁니다.

```bash
for f in *.js ext/*.js games/*.js ui/*.js; do node --check "$f"; done
bash tests/ci/node-all.sh --check && bash tests/ci/browser.sh --check
bash tests/ci/node-all.sh --part rest --out /tmp/node-rest
python3 tests/ci/judge.py --kind node --logs /tmp/node-rest
```

브라우저 검사와 판정 규칙은 [tests/ci/README.md](tests/ci/README.md)에 있습니다. 옛 판의 소스와 비교하는 검사는 `tests/ci/git-fixtures/`의 사본을 읽습니다(`tests/ci/git-shim/git`을 PATH 앞에 둡니다). CI(`.github/workflows/ci.yml`)도 같은 방식으로 돕니다.

## 근거 문서

| 문서 | 내용 |
|---|---|
| [docs/ECON-REFERENCES.md](docs/ECON-REFERENCES.md) | 경제 층 모형의 근거 대장(출처 목록과 계수별 근거) |
| [docs/ECON-SPEC.md](docs/ECON-SPEC.md) | 경제 층 설계 |
| [docs/ECON-DATA.md](docs/ECON-DATA.md) | 시작 통계와 보정표 |
| [docs/ECON-EVIDENCE.md](docs/ECON-EVIDENCE.md) | 실제 자료 조사 |
| [docs/ECON-BALANCE.md](docs/ECON-BALANCE.md) | 밸런스 목표와 계약 |
| [docs/ECON-RECAL-SPEC.md](docs/ECON-RECAL-SPEC.md) | 근거 재보정 명세 |
| [docs/ECON-UI.md](docs/ECON-UI.md) | 경제 화면 명세 |
| [docs/ECON-TECH.md](docs/ECON-TECH.md), [docs/ECON-TECH-SPEC.md](docs/ECON-TECH-SPEC.md) | 기술 카드 조사와 명세 |
| [docs/RESEARCH-2026-10-14.md](docs/RESEARCH-2026-10-14.md) | 연계선·기술 카드 추가 조사 |
| [docs/LEAGUE-CANON.md](docs/LEAGUE-CANON.md) | 리그 확정 규칙 한 쪽 요약 |
| [docs/EXPLAIN-AUDIT-model.md](docs/EXPLAIN-AUDIT-model.md) | 화면 설명 문장과 모형 계산의 대조표 |
| [docs/student-manual.md](docs/student-manual.md) | 학생용 사용 설명 |

변경 이력은 [CHANGELOG.md](CHANGELOG.md)에 있습니다.
