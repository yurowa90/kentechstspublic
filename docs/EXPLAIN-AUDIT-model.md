# 학생에게 보이는 모형 설명 전수 대조 — 품질 축 E

2026-10-29 기준판 **`194cdf79199659a04bdacb9e61fa45f4b2c12c63` + 이 작업 트리의 rev12 미커밋 변경 + M-E2 표시 수정**. 브랜치 `wip/q8-rev8-fix`. 기존 rev12 변경 위에서 작업했으며 커밋하지 않았다. 아래 새 절의 위치는 이 기준판 작업 파일 기준이다. 기존 359항목은 이전 감사 결과를 승계하고, 이번에는 요청한 rev10·rev11·rev12 문형과 M-E2 세 항목만 후속 대조했다. 374항목 전체를 다시 수동 감사했다는 뜻은 아니다. 이전 머리말·합계·원문·검사·소스 해시는 맨 아래 **이전 판 — 2026-10-28** 절에 보존한다.

**359 + 신규 대조 15 = 374항목. 이번 15항목에서 기본값의 문장–계산 불일치는 0건이다.** 이전 감사의 미해소 0건을 승계하므로 현재 집계도 0건이다. 기존 직접 기재 잔여 S18·S40·B16 가운데 S18·B16을 표시용 입력값으로 계산해 **추적 중인 잔여는 S40 1행**이다. 단위 정의·비교 입력·다른 중복 리터럴까지 모두 없어졌다는 뜻은 아니다. 평점 충족이나 브라우저 검증 완료를 선언하지 않는다.

| 범주 | 기존 | D-87 | D-90·집단 후속 | rev10·11·12 추가 | 현재 항목 | 과거 불일치 해소 | 현재 불일치 | 기존 3행 중 직접 기재 잔여 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 배속표 | 41 | 2 | 0 | 0 | 43 | 0 | 0 | 1 |
| 점수식 | 12 | 0 | 0 | 0 | 12 | 0 | 0 | 0 |
| 원인 분해·결과 설명 | 94 | 3 | 2 | 15 | 114 | 11 | 0 | 0 |
| 공기 주석 | 12 | 1 | 0 | 0 | 13 | 3 | 0 | 0 |
| 사건 출처 | 63 | 1 | 3 | 0 | 67 | 4 | 0 | 0 |
| 기술 카드 효과 | 74 | 0 | 0 | 0 | 74 | 6 | 0 | 0 |
| 집단 만족 이유 | 47 | 1 | 3 | 0 | 51 | 1 | 0 | 0 |
| 합계 | 343 | 8 | 8 | 15 | 374 | 25 | 0 | 1 |

신규 집계 단위는 아래 M01~M15의 설명 대조 항목이다. 요청 1번 2개 + 2번 1개 + 3번 6개 + 4번의 중복 제외 3개(C3·C4·P1) + 5·6·7번 각 1개 = 15개. C5·C6은 요청 3·4번에 중복되므로 M06·M07에서만 센다. 같은 이름·값을 반복 출력하는 일지/장부 경로는 해당 행에 묶었다. S18·S40·B16은 기존 항목의 상태 갱신이며 신규 15개에 다시 더하지 않는다.

## 남은 불일치와 수정 분류 — rev12 기준

| 분류 | 현재 기본값 불일치 | 판단·남은 한계 |
|---|---:|---|
| (a) 문장 숫자를 자료에서 읽게 하는 코드 변경 | 0 | S18·B16 표시 계산 완료. S40 기간은 공유값 없음. M03의 build `outageCut` 및 core `gridFill` 내부 .02/.005 중복은 현재 원장과 같지만 원장 변경에 자동 추종하지 않는다. 후속 개선·변형 검사 대상으로 기록하며 이번에는 수정하지 않음 |
| (b) 문장 뜻 변경 | 0 | 신규 15항목은 아래 조건·단위로 일치. B16은 기존의 v³ 근사 설명으로 유지하며, 정격 포화·cutin·cutout까지 예시 비율을 일반화할 수 없다는 이전 한계도 유지 |
| (c) 계산이 틀림 — 엔진 변경 | 0 | 이번 범위에서 확인한 계산 불일치 없음. 계산 경로는 수정하지 않음 |

기본값 일치와 계수 변형 시 동기화 보장은 다르다. 예컨대 `outageHourShare.v=.04`로 변형하면 core의 `outageFloor`와 S6 문장은 4%를 읽지만 build의 `outageCut`은 여전히 2%다. 이는 현재 기본값의 수치 불일치로 합산하지 않는다. 이전 감사의 외부 근거·근사 한계도 해소된 것으로 간주하지 않는다.

## M-E2 표시 수치의 계산

| ID | 변경 위치·표시 입력 | 기본 문구·표시 규칙 | 처리·근거 |
|---|---|---|---|
| S18 | `ui/league-core.js:528`, `:538`: `REVIEW_TERM_YEARS_DISPLAY=4`, `REVIEW_TERM_MONTHS_DISPLAY=REVIEW_TERM_YEARS_DISPLAY*12` | `주민 평가는 {reviewEvery}턴마다: 현실 임기 {years}년({months}달)을 ×{months/reviewEvery} 압축`. 배수는 `Number((months/reviewEvery).toFixed(1))`: 소수 1자리 반올림, 끝 `.0` 생략. 12→×4, 10→×4.8, 7→×6.9, 16→×3 | 표시만 계산. 근거 `ui/econ-data.js:423`의 reviewEvery note: 임기 4년, 48달×1/4=12턴, 배속 ×4. 값·등급·note 불변. 기본 UTF-8 동일 |
| S40 | `ui/build.js:3963` 연구 서랍 | `리그는 {한 달마다/한 턴마다} {steps}주치 진척, 실증 1{달/턴}, 그다음 {달/턴}부터 효과.` | **유지**. core `advanceResearchAll`의 기존 demo→done·`adoptR=S.round+1`(`:350~355`), 연구 완료→demo(`:388~392`), `researchTurn`(`:400~405`)의 한 턴 단계 전환이며 기간 원장 없음. build 자유모드의 `demoLeft=1`(`:278`)은 별도 주 단위 규칙이라 빌려 쓰지 않음. core는 S18 외 수정 금지 |
| B16 | `ui/build.js:333`, `:336`: `WIND_SPEED_EXAMPLE_RATIO=2` | `풍속이 {ratio}배면 풍력 출력은 약 {ratio**3}배(v³).`. 정수 예시 입력 2→8, VM에서 3→27 확인 | 표시 전용 입력 하나로 계산. 기본 UTF-8 동일. 풍력 계산은 불변. `renOut0`(`:653~658`)의 섬 v³·정격 상한, 도시 cutin 보정·정격 상한, cutout을 넘는 정지는 이 예시의 적용 한계이며 별도 개선 대상 |

수정 전 작업 파일을 `/tmp/rev12-model-{core,build}-before.js`에 보관하고 비교했다. 허용한 표시 문자열·상수·주석만 제거/복원하면 두 파일이 수정 전과 바이트 단위로 동일하다. Node VM으로 기본 `econView` 전체 JSON과 `buildGame.tips()` 전체 JSON의 UTF-8 바이트도 전후 동일함을 확인했다. 따라서 기본 표시뿐 아니라 지정 표시 부분 밖의 계산 소스가 보존되었다. 새 상수는 엔진 계수나 공유 기간 규칙을 추가하지 않는다.

### 같은 econView·배속표에서 남은 직접 기재(수정하지 않음)

- `ui/league-core.js:534` 및 `ui/league.js:494`: `게임 1달 ≈ 현실 약 {speed}달`의 `1달`은 단위 기준.
- `ui/league-core.js:539`: `이주에는 ×1`은 집단 만족 배속과 구분하는 고정 설명.
- `ui/league-core.js:545`, `ui/league.js:500~501`: `정전 1%`/`정전 1% 환산`은 비교 기준. 환산 시간은 `outageHoursPerPercent.v`에서 읽음.
- `ui/league-core.js:548`: `연구 기간 수십 배 압축`·`게임 수 달`은 수치 계수에서 계산하지 않는 정성 근사 표현.
- 배속표가 덧붙이는 `buildLeadHTML`의 `ui/league.js:514`: SMR 기간 `TECH_DATA?.params.smrTurns.v ?? 12`의 `12`는 자료 부재 시 직접 기재 대체값. 정상 로딩 시 원장값 사용.
- S18의 현실 비교 `4년`과 연→개월의 `12`는 새 표시 상수의 비교 입력·단위 정의로 남는다. 계산 결과인 `48달`·`×4`를 각각 직접 적던 중복은 제거했다.

## rev10·rev11·rev12 설명 문형 대조

`{…}`는 현재 코드가 넣는 값이다. 아래의 ‘일치’는 원장·계산·표시 경로의 대조 결과이며, 실제 브라우저의 배치·낭독 실행을 뜻하지 않는다. 기본 자료에서 읽은 경계는 `promiseSameDelta=.5`, `outageHourShare=.02`, `outageHourMinMW=.005`, `outageHighPct=5`, `outageHighDigits=2`다.

| ID·요청 | 현재 문장(변수 중괄호)·코드 위치 | 원장·계산 경로 및 의미 | 판정 |
|---|---|---|---|
| M01 · 1 N1 | `판정 계산: {기준} Δ {Δ}%p · '같음' 범위 ±{tol}%p 미만(게임 비교 기준)` — `ui/league.js:78`, `:1952` | `promiseComparison(:1856)`의 실제 정전율−`outageBaseline` 기준율. 첫 달 시험/이후 지난달 등 실제 `comparison.label`을 사용. tol=`ECON_DATA.params.promiseSameDelta.v`(`econ-data.js:157`). `direction(:1226)`은 절댓값이 tol **미만**이면 same, 경계에서는 up/down. Δ·tol 모두 `calcLineTexts(:273)`를 거침 | 일치 |
| M02 · 1 K5 | `판정 계산: 운영 전 대비 Δ {Δ}억 · '같음' 범위 ±{tol}억 미만(게임 비교 기준)` — `ui/league.js:61`, `:1950` | 공개 월말 `V.econ.cities[id].cash`−`V.econ.before[id].cash`; 빚 한도를 더한 ‘남은 돈’과 구별. tol은 M01과 같은 .5지만 단위는 억. 같은 `direction`과 `calcLineTexts` 사용 | 일치 |
| M03 · 2 정전 시간 | `정전 시간은 도시 안 부족량의 합이 그 시각 도시 수요의 {share*100}%를 넘은 시간{의 합}이에요(최소 판정선 {minMW} MW, {이번 달 최대/누적 최대} {days*24}시간). 정전율은 못 보낸 전력의 비율이라 따로 읽어요.` — `ui/league.js:3311`; 머리 칩 `정전 {h}h` — `ui/build.js:3438`; 낭독은 M07 | 실제 `core.isOutHour(:22~23)` = `uns[k]-del[k] > max(minMW,share*dem[k])`, `run(:1295)`에서 시간 수를 센다. `build.cityOutageHours(:1359)`는 계통 보충 후 `hrDem[k]-hrSup[k] > outageCut(dem)`의 시간 수. 리그 도시 `outageCut(:421)`=.02/.005로 같은 문턱. 머리 칩·C6·시험 저장 `outH(:1369)`가 이 함수를 사용. S6 월 수치는 `outH*resultPeriod.mul`이므로 대표 7일 시간을 월 일수로 환산한 값, 직접 관측한 월 744시간 배열이 아님. 원장 `econ-data.js:177~178`. 자유모드의 수요지별 합 `outTotal`과는 구별 | 기본값 일치; 중복 계수 한계 (a) |
| M04 · 3 건설 일지 | `정전 {out}h · CO₂ 소비(계통 포함) {co2} t · 비용 {cost}억 …` — `ui/build.js:4096` metricLine, `:4099` jStrip, `:4192~4193` 일지·회차 비교 | `addEntry(:3284~3291)`의 `m.co2=Math.round(res.co2)`. 리그 시험에서는 `gridFill`이 외부 계통 배출을 더한 `res.co2`, 자유모드에서는 자체+수입 배출. `res.tot.co2` 생산값으로 바꿔 읽지 않음 | 일치 |
| M05 · 3 활동지 | `정전 {uns}% · CO₂ 소비(계통 포함) {co2} t · 비용 {cost}억` — `ui/league.js:2178` 건설 일지 활동지; build 활동지 `metricLine` 재사용 | 리그 활동지의 `e.m.co2`도 M04의 같은 저장값. 리그 운영 결과 내보내기는 `ui/league.js:6419`의 `CO₂ 생산 {co2Prod} t / CO₂ 소비(계통 포함) {co2Cons} t`로 각각 원값을 분리 | 일치 |
| M06 · 3·4 C5 | `CO₂ 소비(계통 포함)가 {n} t인데 탄소세를 고르지 않았습니다. 왜였나요?` — `ui/build.js:18`, `:1016`; 동일 문형 `ui/league.js:88` | 실제 질문 생성은 build `questions`에서 `R.co2/R.days > 기준`이고 `!R.pol.tax`일 때. n=`fmt(R.co2)`, 즉 소비 배출. league의 COPY 선언만으로 사용을 추정하지 않고 실제 build 호출을 확인 | 일치 |
| M07 · 3·4 C6 | `{d}일 운영 끝. 정전 {h}시간, 총비용 {c}억, CO₂ 소비(계통 포함) {n} t.` — `ui/build.js:19`, `:3277`; 동일 문형 `ui/league.js:89` | d=`R.res.days`; 리그 h=`cityOutageHours(R.res)`, 자유 h=`outTotal`; c=`fmt(cost.total,1)`; n=`fmt(R.res.co2)`. 시험 대표 기간 그대로 낭독하며 월 합계로 오인해 환산하지 않음 | 일치 |
| M08 · 3 진행자 장부 | `CO₂ 생산(t/월)` / `CO₂ 생산 / CO₂ 소비(계통 포함)(t)` — `ui/league.js:3260~3262`, `:3290~3291`; 계절 장부·범례 `:3298~3306` | 월 장부는 `r.co2Prod*mul` / `r.co2Cons*mul`, 계절 장부는 대표 기간 원값. core `run(:1306)`에서 생산=`K.co2+o.co2X-o.saveCo2`, 소비=`생산-o.co2X+o.co2In`; 저장 때 각각 정수 반올림(`:1309`). 구매 배출과 외부 계통 배출은 `co2In`, 판매 추가 발전은 `co2X`로 소비에서 제외 | 일치 |
| M09 · 3 끝 추이 그래프 | `CO₂ 생산 {value} t/일`; `CO₂는 생산(우리 도시 설비 배출) 기준이고, 달마다 일수가 달라 그달 합계를 일수로 나눈 하루 평균이에요.` — `ui/fx-end.js:8`, `:119` | `read(:69~73)`=`co2Prod*period.mul/period.days`, 공개 결과가 없으면 sessionStorage의 `{co2Prod,days}` 사본(`:24~27`). 결국 대표 기간 생산량/대표 일수. 소비값으로 대체하지 않으며 없는 달은 선을 끊음. league `trendHTML`은 정전·주민·지지·현금 그래프이고, CO₂ 그래프는 `KCP.fxEnd.html`(`league.js:2148`) | 일치 |
| M10 · 4 C3 | `기존 {설비}도 전선에 안 닿으면 운영에서 못 써요. {설비} 칸, {마을} 칸을 차례로 누르고 '연결'을 눌러야 넘어가요.` — `ui/league.js:86`, `:667~683` | `BG.planIssues().unlinked[0]`와 `nearestTown`에서 이름을 읽고, 새로 지은 설비가 아닌 기존 시설 분기에서 사용. `network`의 `node.live`(`build.js:579`)는 같은 망에 수요지가 있는지 판정. 코치 자동 전환(`league.js:742`)은 `count>=1 && issues.unlinked===0` 상태를 확인하며 클릭 이력 자체를 판정값으로 저장하지 않음. 연결 방법을 안내하는 문장으로 읽음 | 일치 |
| M11 · 4 C4 새 문형 | `이번 달 '전선에 안 닿은 설비'가 {n}기 있었어요. 다음 달 계획 지도 칩과 '시험 1주'에서 설비·접속 상태를 확인해요.` — `ui/league.js:87`, `:288` | n은 M14의 `operatingUnlinkedCount`; 현재 편집 지도나 접속 대기 수와 혼동하지 않음. 다음 달 계획 칩은 `planIssueCounts`→`BG.planIssues`의 현재 지도 값(`:575~577`, `:611`), 1주 버튼은 `data-run="7"`(`:690`) | 일치 |
| M12 · 4 P1 | `{기준}에도 정전이 컸어요.` — `ui/league.js:93`, `:288` | `highOutageHintText`에서 unlinked≥1 및 `trialHigh`일 때 사용. 기준은 `monthly ? '지난달' : '시험'`; `trialHigh=outageHigh(a.trial)`. 현재 정전도 커야 호출됨(M14) | 일치 |
| M13 · 5 C10 | `시험에는 폭염 때 줄어드는 LNG·일반 태양광 출력과 월말 공공시설 보수비도 들어 있지 않아요.` — `ui/league.js:33`, `:5234` | 아래 C10 경로 검증 참조. ‘일반 태양광’은 **solar·roof 포함, tandem·tandem_roof 제외**. LNG 감산은 기존·신규 LNG 모두. 시험은 사건 없는 mods와 build.simulate만 거치므로 폭염 감산·월말 repair 모두 제외 | 일치(글자뿐 아니라 사실 대조) |
| M14 · 6 S7 요약 | `. 정전 자체는 커요: {기준에도 정전이 컸어요. }이번 달 '전선에 안 닿은 설비'가 {n}기 있었어요. 다음 달 계획 지도 칩과 '시험 1주'에서 설비·접속 상태를 확인해요.` — `ui/league.js:286~290`, `:4118~4120` | n=`operatingUnlinkedCount(:4065)`: 해당 운영의 일치하는 S7 snapshot.plan 우선, 없으면 월 기록 operatingPlan; `BG.network(plan).nodes` 중 town/import 제외·`!live` 개수. 계획 없으면 null, 0/null이면 설비 숫자 없는 대체 문장. 호출 문턱은 `a.target!=='grid' && outageHigh(a.actual)`; `outageHigh(:1571~1572)`는 유한한 값의 소수 `outageHighDigits`자리 반올림 후 `>=outageHighPct`(기본 5%) | 일치 |
| M15 · 7 못 짓는 칸 | `{설비}: {지형}만` — `ui/build.js:446`, `siteRule(:449~461)` | 설비=`BLD[type].name`; 일반 분기 지형은 plain,hill,forest,beach,urban,river,mount 순서로 `Object.hasOwn(B.ok,key)`를 걸러 `BASE_TNAME[key]`를 `·`로 연결. 현 BLD.ok의 허용 지형과 같으며 도시별 TNAME/지명은 쓰지 않음. 지도 밖·냉각수·해상·시설·마을·산·지붕·소수력·물 분기는 기존 우선 규칙 | 일치 |

### 판정 계산의 자릿수·자르기 규칙(M01·M02)

`calcDigits(:256)`는 기본 소수 2자리에서 시작한다. Δ와 tol의 **표시한 절댓값**이 같지만 실제 절댓값은 다르면 3→4자리로 늘린다. 현금은 `cashText`의 `Math.round(x*10**digits)/10**digits`, 정전은 기본 `signed`/`fmt`, 확장 자리에서는 `Number(x.toFixed(digits))`를 쓴다. Δ는 부호 표시, 기본 tol은 끝 0을 생략(`0.5`), 늘린 자리에서는 0을 채운다. 비유한 값은 `–`; 실제 `abs(delta)===tol`이면 기본 자리수를 유지한다.

4자리에서도 충돌하면 Δ만 판정 방향으로 자른다: 실제 `abs(delta)<tol`이면 `floor(abs(delta)*10⁴)/10⁴`, 밖이면 `ceil(...) /10⁴`; 부호를 복원하되 0에는 음수 부호를 붙이지 않는다. tol·실제 Δ·판정값은 변경하지 않는다. 예: ±.499999 → ±.4999, ±.500001 → ±.5001, tol=.5000. 58번·59번 경계/무작위 검증 및 추가 VM 경계 대조가 이를 확인한다.

### C10 사실 확인 경로(M13)

1. 원장 `ui/econ-data.js:213~218`: `heatLngSlope=0.226/30`, `heatAirDelta=3`, `heatPvSlope=.004165`, `heatModuleDelta=5`, `repairHeatwave=4`. 사건 `ui/league-data.js:68`은 오후 수요 배수와 `repairParam: 'repairHeatwave'`를 정의한다.
2. 실제 월운영 `ui/league-core.js:946~949`: 폭염 x에서 LNG 용량 배수=`max(0,1-heatLngSlope*heatAirDelta*x)`, 일반 태양광 배수=`max(0,1-heatPvSlope*heatModuleDelta*x)`. x=1 VM 결과 .9774와 .979175. DR·절전 대응은 수요 손잡이이며 이 두 감산을 완화하지 않는다.
3. 적용 `ui/build.js:635~636`: **solar·roof만** solarHeatMul을 곱한다. tandem·tandem_roof는 제외. 다른 사건의 solarMul(`:633`)이 탠덤도 포함하는 것과 구별한다. LNG는 `simulate`의 기존·신규 공통 gens 경로에서 g.kind==='lng'일 때만 cap에 곱함(`:718~722`). 폭염의 출력 감산은 다른 전원에 적용되지 않는다. 수요 증가에 따른 실제 급전량 변화까지 없다는 의미는 아니다.
4. 시험 `ui/league.js:5202~5204` trialConditions → `core.trialMods(:894~917)` → events=[] → modsFor. `build.startRun(:3085~3089)`가 이를 simulate에 넣고 월 리그에서 gridFill만 더한다. 시험에는 폭염 감산이 없다. VM에서 trial의 lngCapMul·solarHeatMul 부재 및 solar/roof 감산·탠덤 제외를 확인했다.
5. 보수비 `core.repairOf(:178~185)` → 실제 `run cost.repair(:1303)` → `econInputs energy.repair(:1433)` → `ui/econ.js:707`의 월말 `exp.repair`. 보수비는 대표 7일에서 월 일수로 배수 환산하지 않고 사건당 월 1회다. 시험 비용은 `build.js:914~922`의 capex+fuel+policy+research로 repair가 없다. VM에서 폭염 x=1의 repair=4, events=[]에서는 0을 확인했다.

## 현재 기준판에서 실행한 검증

실행일 2026-10-29. macOS **workspace-write 셸**, Node `v24.21.0`, pnpm `11.25.0`. package.json·lockfile·Node 버전 지정 파일 없음. Node 검사와 VM만 실행했다. 사용자 지시로 **브라우저·외부 네트워크·커밋 미실행**, `tests/**` 파일 수정 없음. 아래 결과는 과거 기록을 복사한 것이 아니라 현재 작업 파일에서 새로 실행했다.

| 명령 | 실제 결과 | 종료 |
|---|---|---:|
| `node tests/league/review/56-e-audit.js` | assertions 1009 failures 0 | 0 |
| `node tests/league/review/33-model-explanations.js` | W1 engine: 50 tests, 0 failures | 0 |
| `node tests/league/review/34-model-copy.js` | W1 copy: 174 tests, 0 failures | 0 |
| `node tests/league/review/57-rev10.js` | assertions 36 failures 0 | 0 |
| `node tests/league/review/58-rev11.js` | assertions 2059 passes 2059 failures 0 | 0 |
| `node tests/league/review/59-rev12.js` | assertions 2182 failures 0(e-audit 그룹 71단언 추가 뒤 재실행) | 0 |
| `node tests/league/test-econ.js > /tmp/x` | 시험: 1304321 통과, 0 실패 | 0 |
| `node tests/league/balance.js > /tmp/rev12-model-balance.log` | pass 826 fail 0 | 0 |
| `node --check ui/league-core.js` 및 `node --check ui/build.js` | 문법 오류 없음 | 0 |
| `git diff --check` | 공백 오류 없음 | 0 |
| `node /tmp/rev12-model-check.cjs` | 45단언 / 실패 0: 허용 표시 외 소스 바이트 동일, 기본 econView·tips UTF-8 동일, 주기·풍속 예시 변형, C10 감산·시험·repair, 정전 문턱·판정 표시 경계 | 0 |

`test-econ` 출력의 물리적 마지막 줄은 빈 줄이다. 마지막 비어 있지 않은 줄은 다음과 같다(총괄의 이전 결과 대조용).

```text
국제 지수 36턴: {"lng":0.685,"fx":1.016,"ship":1.02,"semi":0.957,"active":["EU 탄소국경조정(CBAM)","자동차 수출 둔화"]}
```

`balance` 끝줄:

```text
pass 826 fail 0
```

검사 통과와 수동 의미 대조는 별개다. 56번에는 이번 M-E2 신규 단언을 넣지 않았고 다른 세션이 작성한다. 브라우저 레이아웃·실제 낭독·터치와 외부 법령·논문 원문은 미검증이다. B16의 일반화 한계, S40 기간 공유값 부재, 정전 문턱 중복 숫자는 남는다.

## 검사가 확인해야 할 항목 — 새 e-audit 단언 인계

1. **S18 기본 바이트·변형:** 실제 `KCP.leagueCore.econView(S).speeds.items.find(x=>x.key==='reviewEvery').note`를 읽는다. 기본 12의 문구 바이트, `ECON_DATA.params.reviewEvery.v=10/7/16` 변형 때 ×4.8/×6.9/×3, 개월 수=표시 임기년×12를 검증한다. note를 파싱해 계산 계수로 사용하지 않는다. default econView의 다른 필드 불변도 확인한다.
2. **B16·S40:** 실제 `KCP.buildGame.tips()`에서 풍속 문장을 찾고 기본 바이트와 소스 메모리 변형 `WIND_SPEED_EXAMPLE_RATIO=3`→27을 검증한다. `renOut0`의 계수 변경으로 오인하지 않는다. S40은 실제 연구 서랍 기본 글자를 보존하고 `advanceResearchAll/researchTurn`의 demo→done→다음 턴 도입과 대조한다. 자유모드 demoLeft를 리그 기간의 원장으로 쓰지 않는다.
3. **N1·K5:** 원장 `params.promiseSameDelta.v`를 읽고 `promiseComparison`의 정전/현금 Δ와 `direction`을 기준으로 `calcLineTexts`를 대조한다. ±tol 바로 안/같음/밖, 2→3→4자리 충돌, 4자리 floor/ceil, 비유한 값·음의 0을 포함한다. 정전은 toFixed, 현금은 Math.round 경로의 반값 차이까지 확인한다.
4. **정전 시간:** 원장 `outageHourShare/outageHourMinMW`와 실제 core `isOutHour/outageFloor`, build `cityOutageHours`를 VM에서 노출해 경계 초과/같음과 여러 수요지의 합을 대조한다. 머리 칩·C6·rememberTrial·S6가 수요지별 outTotal 대신 도시 outH를 쓰는지도 확인한다. 원장 변형 시 build.outageCut 및 core.gridFill의 .02/.005 비추종은 현재 알려진 개선 대상이므로 통과로 위장하지 않는다. 월 수치는 resultPeriod.mul을 적용한다.
5. **CO₂ 전 경로:** core `co2Prod/co2Cons`, 시험 raw.tot.co2와 gridFill 뒤 res.co2를 서로 다른 값으로 만들어 일지·활동지·C5·C6·진행자 장부·fx-end의 실제 renderer 출력과 비교한다. 원장 normalCo2와 계통 수입을 사용하고, 끝 그래프는 co2Prod/result.days·공개 사본 누락 시 단절을 확인한다. 생산·소비 값을 우연히 같게 둔 표본만 검사하지 않는다.
6. **C10 사실:** `params.heatLngSlope/heatAirDelta/heatPvSlope/heatModuleDelta`에서 배수를 계산해 `modsFor`와 실제 LNG cap·solar/roof 출력을 비교한다. tandem/tandem_roof 및 다른 전원 제외, trialMods(events=[]) 감산 부재, `repairOf`→econInputs→econ.monthStep의 월 1회 비용과 build 시험 비용 제외를 확인한다. C10 글자 포함 검사만으로 대체하지 않는다.
7. **C3·C4·P1·S7:** C3 이름은 `BG.planIssues/nearestTown`, 연결은 `BG.network().nodes[].live`로 대조한다. C4의 n은 운영 당시 snapshot.plan/operatingPlan을 `BG.network`에 넣어 town/import 제외·!live 개수를 센다. 현재 편집 지도와 다르게 만든 표본, 계획 없음(null), 0/1/여러 기, monthly·trialHigh 조합을 포함한다. 문턱은 `outageHighPct/outageHighDigits`, P1의 기준은 monthly 플래그로 읽는다.
8. **siteRule 일반 분기:** 각 지도·도입 기술의 실제 `BG.BLD[type].ok` 키와 허용 지형을 읽고 `BASE_TNAME` 일반 낱말로 기대 목록을 만든다. 지역 지명이 섞이지 않고 순서·구분자가 맞는지, 우선 분기와 일반 분기를 나눠 확인한다. 현재 .ok 값은 모두 양수지만 미래에 0인 키나 새 지형이 추가되면 `Object.hasOwn`·고정 키 목록의 의미도 다시 대조한다.

## 현재 기준 소스 해시 — 194cdf7 + rev12 + M-E2

동시 작업 이후 결과를 구별하기 위한 SHA-256이다. ui/league.js는 코치 8/8 서랍 열기 조건 수정(설명 문장 무관) 뒤 값이다. 이전 판의 해시는 이전 판 안에 그대로 남긴다.

| 파일 | SHA-256 |
|---|---|
| ui/build.js | fe61aaa97acf1b949787dfbe10bd2b312acd79033faf234ccbdc8b606da0adf6 |
| ui/league-core.js | cb1f929a178ebeac1ac393a9a7ba62fef4a1637f55f7e53eedc16dab2def044a |
| ui/league.js | 5e3a8d96f1b81d167e86a360648b1b3e87cb33e8cfb7cabc50ae06f0b4db7ec8 |
| ui/econ.js | 07d8760da006deac93d2b5e7878eb2d1657e4ba428a86ab5272688f1a375bf4a |
| ui/econ-data.js | 1a5b99b0012cf031db0d08e5b50282f33c05e142ba6567cce308f58c90aa03da |
| ui/league-data.js | e5094ea280cc11134159ca93bd8d790b6c0352218bc232a5e54cc26b6ee8854e |
| ui/fx-end.js | e9c88f5e8e1fac50c470bffd175e97525a1cb3100f642752877966677d3d5bfb |

## 이전 판 — 2026-10-28 원문 보존

<details>
<summary>137e0a9 + rev9-E 감사 및 그 이전 기록 펼치기</summary>

2026-10-28 기준판 **`137e0a91d0ccf3a5ff7c57c2ebff003ce8aab10f` + rev9-E E3·E4 작업 변경**. 10-25 `186e182`의 351항목과 10-26 `d8a072d` 작업 파일에서 추가한 D-90·집단 전용 항 8개를 유지했다. 이번에는 직접 기재 14행 및 rev8(`19d4b17`·`9001423`·`6628ef9`)·rev9(`137e0a9`)에서 바뀐 설명을 후속 대조했다. 기존 359항목 전체를 새로 수동 감사했다는 뜻은 아니다.

**기존 343 + D-87 8 + 이번 후속 8 = 359항목. 기존 불일치 25건은 해소됐고, 독립 검토가 찾은 V60도 수정됐다. 이번 추가 8항목의 불일치는 0건이며, 현재 대조표의 남은 불일치 합계도 0건이다.** `56-e-audit.js`(기존 `e-audit-probe.js` 진입 경로 유지)는 현재 작업 파일에서 **1009단언/실패0**. 수치 직접 기재 14행 중 11행을 자료·공유 상수에서 읽도록 바꿔 **3행(S18·S40·B16)이 남는다**. 평점 충족을 선언하지 않는다.

| 범주 | 기존 항목 | D-87 추가 | 이번 후속 | 현재 항목 | 10-21 불일치 | 해소 | 남음(현재 불일치) | 현재 수치 직접 기재 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 배속표 | 41 | 2 | 0 | 43 | 0 | 0 | 0 | 2 |
| 점수식 | 12 | 0 | 0 | 12 | 0 | 0 | 0 | 0 |
| 원인 분해 | 94 | 3 | 2 | 99 | 11 | 11 | 0 | 1 |
| 공기 주석 | 12 | 1 | 0 | 13 | 3 | 3 | 0 | 0 |
| 사건 출처 | 63 | 1 | 3 | 67 | 4 | 4 | 0 | 0 |
| 기술 카드 효과 | 74 | 0 | 0 | 74 | 6 | 6 | 0 | 0 |
| 집단 만족 이유 | 47 | 1 | 3 | 51 | 1 | 1 | 0 | 0 |
| 합계 | 343 | 8 | 8 | 359 | 25 | 25 | 0 | 3 |

항목은 반복 출력 횟수가 아닌 설명 템플릿 기준이다. 동일 `thermalFacts.text`의 반복 출력 경로는 한 행에 묶었다. D07은 석탄·LNG·SMR 배치 때(`ui/build.js:3452` siting 대상 세 전원 공통) 계산하는 민원 건수·영향 시설 수를 따로 센다. B05·B06·B09·B19·B20·B26은 별도 표와 전수 표에 각각 표시하되 합계에서는 한 번만 센다.

`docs/QUALITY-model.md` §3 E행은 W1 42항목과 과거 기술 eff 오류를 근거로 한 이전 평가다. 독립 채점 (비공개 작업 폴더) E는 a29a3e2에서 343표가 갱신되지 않은 점과 #build 여섯 항목의 미확인을 지적했다. 최초 대조는 186e182에서 수행했고, 현재 기준판 후속 대조는 위 137e0a9 + E 변경을 읽었다. QUALITY 문서·평점은 수정하지 않았다. 사건 why는 저장소 자료→표시와 게임 효과의 구분을 대조했다. 외부 관측값·출처 원문의 사실성·URL 생존은 네트워크 금지로 재검증하지 않았다.

## 남은 불일치와 수정 분류

| 분류 | 현재 불일치 수 | ID/위치·화면 문장·계산값·어긋남 |
|---|---:|---|
| (a) 문장 숫자를 자료에서 읽게 하는 코드 변경 | 0 | 현재 기본값의 불일치 없음. 아래 직접 기재·중복 자료는 향후 값 변경에 대한 개선 대상으로 별도 기록 |
| (b) 문장 뜻 변경 — 아르곤 문구 필요 | 0 | 현재 남은 의미 불일치 없음 |
| (c) 계산이 틀림 — 엔진 변경 | 0 | 기준판 351항목 및 이번 추가 8항목에서 확인한 계산 불일치 없음 |

10-26 후속은 thermalFacts의 세 문장을 자료 기반 getter로 바꾸었다. 이번 E3는 build의 기존 경계·가동 가정을 공유 상수로 추출하고 기술 비교 문장·표시용 비율의 원자료를 합쳤다. 기본 계산값·효과 계수·등급·저장·전송 형식은 유지했다. 수정 금지인 econ 계열·league-core·league-net은 변경하지 않았다. 브라우저 실기나 외부 원문 검증은 수행하지 않았다.

## 10-21 불일치 25건의 해소 근거

수정 커밋은 현재 diff·blame과 문장/계산을 맞춰 확인했다. T07·T10은 원본 자료와 리그 renderer 양쪽 변경을 함께 기재한다.

| ID | 현재 위치 | 현재 문장·계산 | 상태 |
|---|---|---|---|
| B01 | ui/build.js:3760 | 배터리 각92.2%·왕복약85%, BMS 뒤 각93.3%·왕복약87% → M.batEff=.922, 왕복 .850084; BMS .933, 왕복 .870489 | 해소(6812f43) |
| B02 | ui/build.js:3748 | 도시 태양광 GHI×성능비0.92×날씨 가중치/월평균 날씨 가중치 → day.eDay=GHI×M.pvYield×wxSun[w]/ew | 해소(6812f43) |
| B04 | ui/build.js:3750 | 조력2MW×0.31×&#124;sin(2πt/12.42h)&#124;, 위상 보정 생략 → renOut0=2×TIDAL_FACTOR(.31)×abs(sin(2π(k+3)/12.42)); 위상 생략을 문장에 명시 | 해소(6812f43) |
| B05 | ui/build.js:3977 | 소수력 평균계수0.25×월강수보정×날씨유량/월평균유량, 맑은 날 사흘째부터 더 감소, 정격 상한 → 정격×min(1,.25×(0.5+0.5×월강수/연평균강수)×flow/flowMean); 맑음 첫·둘째 .85, 사흘째 .7, 비1.3 | 해소(6812f43) |
| B06 | ui/build.js:3751 | 기존 발전소의 연료·용량; 자유수입 총상한/연결점별 상한; 리그 직접수입 없음 → 평택 LNG9.5MW, 자유수입 총2.5/5점=.5MW/점. 당진 석탄26.1MW, 총1.5/3점=.5. 리그 직접0, 월운영 계통상한 수요50% | 해소(6812f43) |
| B09 | ui/build.js:3754 | 자유: 싼 급전원부터 / 리그: 재생→배터리→도시급전원→이웃거래→자동계통수입 → simulate C.DL은 mc 정렬(석탄·SMR 포함); core는 이웃거래·가격대체 후 gridSupply; 고정 LNG우선 순서 아님 | 해소(6812f43) |
| B10 | ui/build.js:3746 | 자유 1MW≈실제100MW / 리그 1MW≈실제230MW → 자유 PK.scale / 리그 region.mwScale, H03·H04와 일치 | 해소(6812f43) |
| B12 | ui/build.js:3758 | 연습섬 풍력2MW×min(1,(풍속/12)³), 25m/s 초과정지 → 정격 상한 min(1,…)과 M.rated/cutout을 읽음 | 해소(6812f43) |
| B19 | ui/build.js:302 | 탄소세: 섬 디젤×1.5 / 도시 디젤×1.3125 → 섬(.01+.005)/.01=1.5; 도시(.016+.005)/.016=1.3125. 국제 fuelMul도 반영 | 해소(6812f43) |
| B20 | ui/build.js:305 | 수요반응 계약·피크감축·일 정책비 일반.05/VPP.025억 → M.drCost=.05×(VPP drCost=.5)=.025; 피크는 peakDemand(off)−peakDemand(on) | 해소(6812f43) |
| B26 | ui/build.js:3626 | 평택 공장5→10MW / 다른5도시 공장 증설 수요 정의 없음 → 평택 dem.base=5/fab2=10; 다른5도시 fab2 없음. 자유모드 버튼은 남지만 잘못된5→10 숫자는 제거 | 해소(6812f43) |
| A07 | ui/build.js:3752 | 바이오 CO₂ 총량에는0, 배출 .1t/MWh는 별도정보 → dispOf(biomass).co2=0,bioCo2=.1, 문장도 같은 객체 읽음 | 해소(6812f43) |
| A08 | ui/build.js:3511 | 연결점 CO₂ .4173t/MWh → dispOf(import).co2=normalCo2=.4173 | 해소(6812f43) |
| A09 | ui/build.js:3751 | 외부 전력망 CO₂ .4173t/MWh → dispOf(import).co2=normalCo2=.4173 | 해소(6812f43) |
| V31 | ui/league-data.js:77 (line_opposition_delay) | text: 주민 반대로 기존 연계선의 이번 라운드 송전이 멈추고 사건비가 들어요. → effect={"tieDown":"dangjin~asan","budgetAdd":-5}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0},"bonus":-5,"down":["dangjin~asan"]} | 해소(0777730) |
| V33 | ui/league-data.js:77 (line_opposition_delay) | talk: 주민 협의·이익공유 / 대응비 6억으로 이번 라운드 송전 중단을 막아요. 사건 도시 당진의 사건비 5억은 대응 후에도 남아요. → 비용 6억; 실제 {"option":"talk","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0},"bonus":-5,"down":[]} | 해소(0777730) |
| V44 | ui/league-data.js:80 (planned_maintenance) | resched: 정비 일정 나눠 하기 / 이번 라운드 출력 감소를 줄여요 → 비용 2억; 실제 {"option":"resched","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"coalCapMul":0.925,"lngCapMul":0.85},"bonus":0,"down":[]} | 해소(0777730) |
| V63 | ui/econ.js:641; ui/econ-data.js intl.events | cbam: 철강 비중과 수출 비중에 따라 산출이 깎여요(EU 몫은 모든 도시 같음, 단계 도입, 공정별 직접배출 차이는 생략한 근사) → steel비중×exportShare×cbamEuShare×cbamDrop×phase×eduCbam; 공통EU몫·직접배출 차이 생략한 근사 명시 | 해소(0777730) |
| T06 | ui/tech-data.js:92; ui/league.js:764 | tandem eff: 새 탠덤 태양광 출력 ×1.2, 건설비 ×1.2 / 리그: 새 탠덤 태양광 출력 ×1.2, 건설비 ×1.2 → tandemOutput=tandemCost=1.2; build; 출력 61.24896431→73.49875717 MWh, 비용 8→9.6 | 해소(0777730) |
| T07 | ui/tech-data.js:93; ui/league.js:764 | nbat eff: 새 배터리 용량 ×1.25 / 리그: 새 배터리 용량 20 MWh(×1.25) → nbatCapacity=1.25; 16×1.25=20MWh; 원본·리그 모두 화재 면역 서술 제거 | 해소(0777730·be73d18) |
| T10 | ui/tech-data.js:96; ui/league.js:764 | h2mix eff: 연결된 수소가 남아 있을 때 LNG CO₂ 최대 12% 감소 / 리그: 연결된 수소가 남아 있을 때 LNG CO₂ 최대 12% 감소 → h2Co2=.88; 같은 망 남은 수소를 방전 한도 내 쓸 때 최대12% CO₂감소. 없으면0 | 해소(0777730·be73d18) |
| T11 | ui/tech-data.js:97; ui/league.js:764 | ccu eff: 석탄 CO₂ ×0.4, 출력 ×0.79 / 리그: 석탄 CO₂ ×0.4, 출력 ×0.79 → ccuCo2=.4, ccuOutput=.79; core; 실제 석탄 출력×.79 | 해소(0777730) |
| T46 | ui/tech-data.js:167; ui/league.js:742 | grid 유레카: 내부 송전선 설치 → core.eurekaMet(ui/league-core.js:274~): plan.lines.length&gt;0(실제 통전 여부를 요구하지 않음) | 해소(0777730) |
| T48 | ui/tech-data.js:167; ui/league.js:742 | scable 유레카: HVDC 연계선 건설 완료 → core.eurekaMet(ui/league-core.js:274~): built hvdc선 있음(내부 연결 여부는 추가 검사 안 함) | 해소(0777730) |
| G47 | ui/league.js:673 | A에서 B보다 시작 대비 변화로 볼 때 … → causeOf의 시작 대비 개선 차이를 migrationReason도 명시. 현재 A70>B40라도 시작80/40이면 A의악화−10이 원인 | 해소(be73d18) |

## 독립 채점의 #build 미확인 6항목

| ID | 현재 위치 | 화면 문장 | 계산 값·대조 | 상태 |
|---|---|---|---|---|
| B05 | ui/build.js:3977 | 소수력 평균계수0.25×월강수보정×날씨유량/월평균유량, 맑은 날 사흘째부터 더 감소, 정격 상한 | 정격×min(1,.25×(0.5+0.5×월강수/연평균강수)×flow/flowMean); 맑음 첫·둘째 .85, 사흘째 .7, 비1.3 | 해소(6812f43) |
| B06 | ui/build.js:3751 | 기존 발전소의 연료·용량; 자유수입 총상한/연결점별 상한; 리그 직접수입 없음 | 평택 LNG9.5MW, 자유수입 총2.5/5점=.5MW/점. 당진 석탄26.1MW, 총1.5/3점=.5. 리그 직접0, 월운영 계통상한 수요50% | 해소(6812f43) |
| B09 | ui/build.js:3754 | 자유: 싼 급전원부터 / 리그: 재생→배터리→도시급전원→이웃거래→자동계통수입 | simulate C.DL은 mc 정렬(석탄·SMR 포함); core는 이웃거래·가격대체 후 gridSupply; 고정 LNG우선 순서 아님 | 해소(6812f43) |
| B19 | ui/build.js:302 | 탄소세: 섬 디젤×1.5 / 도시 디젤×1.3125 | 섬(.01+.005)/.01=1.5; 도시(.016+.005)/.016=1.3125. 국제 fuelMul도 반영 | 해소(6812f43) |
| B20 | ui/build.js:305 | 수요반응 계약·피크감축·일 정책비 일반.05/VPP.025억 | M.drCost=.05×(VPP drCost=.5)=.025; 피크는 peakDemand(off)−peakDemand(on) | 해소(6812f43) |
| B26 | ui/build.js:3626 | 평택 공장5→10MW / 다른5도시 공장 증설 수요 정의 없음 | 평택 dem.base=5/fab2=10; 다른5도시 fab2 없음. 자유모드 버튼은 남지만 잘못된5→10 숫자는 제거 | 해소(6812f43) |

## 직접 기재·근사 표시의 현재 상태

이전 수치 직접 기재 81행 중 67행을 해소한 뒤 남았던 **14행 중 이번 E3에서 11행을 해소하고 3행을 유지**했다. D-87 추가 4행(D02·D05·D06·D07)은 10-26에 별도 해소했다. 외부 관측값·연도·단위 정의는 기존 표 규칙대로 제외한다. 현재 기본값 불일치와 향후 자료 변경 시의 동기화 한계를 구별한다.

| ID | 이번 처리·공유 원장 | 기본 문구 UTF-8 전/후 | 남은 직접 기재·제외 근거 |
|---|---|---|---|
| S18 | 유지: `reviewEvery`는 params에서 읽음 | 같음 | 임기 4년·48달·×4는 `league-core.econView` 공개 설명에 있음. 비교 임기 공유값이 없고 core 수정 금지. `speedsHTML`은 원래부터 짧은 ‘주민 평가 간격: 12달’만 출력함 |
| S40 | 유지: 진척·운영비는 기존 params/RS에서 읽음 | 같음 | 리그 실증 1달/턴은 core의 단계 전환 규칙이며 기간 공유값이 없음. build의 자유모드 `demoLeft=1`과 리그 기간은 별개이므로 연결하지 않음 |
| B05 | `HYDRO_DRY_DAYS`를 weather의 `sunny >=`·월평균 유량 정규화 지수(`기간−1`)·도움말이 공유 | 같음 | 3일은 기존 ‘사흘’ 표기를 유지하며 다른 값은 ‘n일’로 표시 |
| B16 | 유지: ‘풍속이 2배면 풍력 출력은 약 8배(v³).’ | 같음 | 2는 비교 예시의 입력값, 8은 세제곱 결과. 같은 입력값을 쓰는 엔진 공유값이 없어 표시용 상수를 새로 만들지 않음. 정격 포화·cutin 보정 때문에 구간 한정 필요성도 유지 |
| B22 | `MISSION_TARGETS.outageShare/hospitalHours`를 goal·judge가 공유 | 같음 | 기본 0.5%·0시간 유지 |
| B25 | `MISSION_TARGETS.complaints/satisfaction`을 goal·judge가 공유 | 같음 | 기본 1건·60점 유지 |
| B27 | `COMPLAINT_RUN_FRAC`를 complaints 기본 가동률·placementAdvice가 공유 | 같음 | 기본 60% 유지; 실제 운전율이 주어지면 그 값을 사용 |
| B33 | `FORECAST_EVENING.start/end`를 저장 예약 계산·예약 해제·eff가 공유 | 같음 | 계산 구간 [17,23), 화면 17–22시 유지 |
| T62 | `comparisonReferences.scable.multiplier`를 baseline·scale.v가 공유 | 같음 | 외부 비교값 5배를 게임 연계선 배수와 구별 |
| T63 | `comparisonReferences.tandem.from/to/unit`를 baseline·scale.v가 공유 | 같음 | 외부 모듈 효율 22→26.9% 유지 |
| T64 | `comparisonReferences.nbat.increase`를 baseline·scale.v가 공유 | 같음 | 외부 셀 에너지 밀도 증가 40%; 팩 용량과 구별 |
| T65 | `comparisonReferences.h2store.range/midpoint`에서 baseline, midpoint에서 scale.v 생성 | 같음 | 외부 비교 범위 30~40%·가운데 값 35% 유지 |
| T66 | `comparisonReferences.h2mix.reduction/grade`를 baseline·scale.v가 공유 | 같음 | 남은 ‘30 vol%’는 NIST 물성 기반 열량 환산(M)의 외부 비교 조건(`params.h2Co2.note` 근거). 게임 혼소량·효과 계수가 아니므로 집계 제외 |
| T67 | `comparisonReferences.ccu.capture`를 baseline·scale.v가 공유 | 같음 | 외부 포집률 상단 90% 유지 |
| D02 | 기존 해소: `TECH_DATA.params.smrTurns` | 이번 E3 수정 없음 | 기존 probe의 8달 변형 추종 |
| D05 | 기존 해소: `pmNewFuelW/pmFuelW` | 이번 E3 수정 없음 | 기존 probe의 50%·60% 변형 추종 |
| D06·D07 | 기존 해소: `sitingWeights.length−1` | 이번 E3 수정 없음 | 기존 probe의 4칸 변형 추종 |

바이트 비교 명령: `node (비공개 작업 폴더) (비공개 작업 폴더) --mutations`. `git show 137e0a9`와 현재 파일을 각각 Node VM에 적재해 **14/14행 같음**을 확인했다. B05는 실제 도움말 전체, S40은 실제 연구 서랍 전체를 비교하므로 주변 문장도 포함한다. 13 지도/모드의 날씨·가동 민원·미션 24경계·자유모드 연구 및 기술 scale 객체가 같고, 예측 기술 도입 전/후 두 7일 급전 결과도 기준판과 같았다. 공유값 13개 변형에서 실제 표시 추종을 확인했다. 스크립트는 저장소 밖에 보관했다. 스크립트 사본은 저장소 밖 작업 기록 폴더에 둔다.

D01의2040, D02·D03의규모/날짜, D04의1275·1809, D05의 kg/MWh는 외부 근거 문장이다. 기본값은 일치하지만 `thermalFacts`와 `params.thermalMW/thermalCapex`가 자동 동기화되지는 않는다. 조사 변형에서 `thermalCapex.coal=2000`으로 바꾸면 건설비는15.072464억으로 변하고 건설비 !의1809달러 문장은 그대로였다. 기본값 불일치로 세지 않고 (a) 개선 대상으로 남긴다. 원자료를 바꾸는 편집이라면 출처 문장도 검토해야 한다.

이전 ‘근사 표시 없음’ 6행(S10·S11·S14·S25·T13·V59)은 모두 보완됐다. LNG 빈도는 추첨 배수가 아닌 추정 비교값, 정전87.6시간은 미공급 에너지 등가시간, 민원50~200배는 계산 배수가 아닌 비교값, 예보는 clipping을 포함한 최대 폭, 해운은 별도 물류비를 계산하지 않는 단순화로 명시한다. **이전 6행 중 미해소0**이며 앱 전체의 모든 근사 문구를 새로 열거한 수치는 아니다.

## 현재 전수 대조표 — 기존 343항목

위치는 문장을 생성하는 함수/자료 선언 또는 출력 줄이다. 같은 ID의 10-21 숫자·검사 부재 집계는 맨 아래 ‘이전 판’에 보존했다. `자료`는 숫자를 원장/결과에서 읽으면 예, 수치 리터럴이 섞이면 아니오, 정성·외부 관측이면 해당 없음이다. `소스 대조`는 실행 단언과 구별한다. 검사 번호는 `tests/league/review/` 아래 파일이며 probe는 `e-audit-probe.js`다. 근거 열의 번호는 해당 계산에 관련된 실행 결과이지 행 전체의 변형 검사를 보장하는 표지가 아니다. **probe 단언(작성 당시 831, 10-25 보강 뒤 843)을 설명 전부의 독립 회귀 검사로 세지 않는다.**

### 배속표

| ID | 현재 위치 | 현재 화면 문장/설명(요약) | 실제 계산·조건 | 자료 | 판정 | 이번 근거 |
|---|---|---|---|---|---|---|
| S01 | ui/league.js:373 | 이동 시간 | 0.009×4.4=0.0396(주민), 0.005×4.4=0.022(기업); econ.js | 예 | 일치 | 33·42 + probe 값/전달 |
| S02 | ui/league.js:373 | 지지율 회복 | 0.038×4=0.152(회복), 하락은 즉시 1; econ.js | 예 | 일치 | 33·42 + probe 값/전달 |
| S03 | ui/league.js:373 | 주민 평가 간격 | t+1을 12로 나눈 나머지 0; econ.js | 예 | 일치 | 33·42 + probe 값/전달 |
| S04 | ui/league.js:373 | 대기 영향(집단 만족만) | air=80−4×29×PM 증분; 이주는 ×1; econ.js | 예 | 일치 | 33·42 + probe 값/전달 |
| S05 | ui/league.js:373 | 탄소 국경 부담 | cbamPhase×0.046×0.154×5; econ.js | 예 | 일치 | 33·42 + probe 값/전달 |
| S06 | ui/league.js:373 | 전력망 접속 | 0.00375×27=0.10125; league-core.js 접속 증가식 | 예 | 일치 | 33·42 + probe 값/전달 |
| S07 | ui/league.js:373 | 버리는 재생 전기 | curtailP×0.018×3.3=curtailP×0.0594; league-core.js | 예 | 일치 | 33·42 + probe 값/전달 |
| S08 | ui/league.js:373 | 기상 사건 빈도 | hazardReal×0.1; league-core.js(태풍·황사, 모든 사건에 곱하는 값 아님) | 예 | 일치 | 33·42 + probe 값/전달 |
| S09 | ui/league.js:373 | SMR 공사 | readyRound=착공 round+12; league-core.js construction | 예 | 일치 | 33·42 + probe 값/전달 |
| S10 | ui/league.js:373 | LNG 급등이 현실보다 약 3배 자주 나와요(추정 비교값, 추첨 확률에 곱하지 않음) | 표시용 현실 비교값 3; 실제 추첨 intlEventP=0.12·사건 weight(직접 ×3 아님) | 예 | 근사 표시 보완(0777730·be73d18) | 33·42 + probe 값/전달 |
| S11 | ui/league.js:373 | 정전 1%를 같은 수요의 시간으로 바꾼 값: 연 87.6시간(에너지 미공급률의 등가 시간 환산이며, 실제 정전시간과 다름) | 365×24×0.01=87.6; 에너지 미공급률과 정전시간은 별개 | 예 | 근사 표시 보완(0777730·be73d18) | 33·42 + probe 값/전달 |
| S12 | ui/league.js:373 | 연습 섬 송전 손실 | M.lossPerHex 0.015 / 도시 lossPerHex 0.005 =3 | 예 | 일치 | 33·42 + probe 값/전달 |
| S13 | ui/league.js:373 | 연구 기간 비교 | [10,30]년은 비교 자료; 실제 필요량/인력/4.35 + 실증 1턴 | 예 | 근사 표시 있음 | 33·42 + probe 값/전달 |
| S14 | ui/league.js:373 | 마을 민원을 도시 전체 만족에 반영: 지지에 미치는 영향이 현실보다 약 50~200배 커요(추정 비교값, 계산 배수 아님) | [50,200]은 비교 자료; 실제 min(20, 민원점수×1)×집단비중 | 예 | 근사 표시 보완(0777730·be73d18) | 33·42 + probe 값/전달 |
| S15 | ui/league.js:369 | 게임 1달 ≈ 현실 약 4.4달 | eduSpeed=4.4; 이주 관성만 가속, 1년 전체 모사 아님 | 예 | 근사 표시 있음 | 소스 대조 |
| S16 | ui/league-core.js:506 | 주민·기업 이동 시간 ×4.4: 수업 안에서 변화 관찰 | 0.009×4.4=0.0396(주민), 0.005×4.4=0.022(기업); econ.js | 예 | 일치 | 33·42 + probe 공개 items |
| S17 | ui/league-core.js:507 | 지지율 회복 시간 ×4: 회복 시간을 4배 압축 | approvalMemoryReal=.038 × eduMemory=4 = .152; 회복 시간 압축, 평가 주기와 구별 | 예 | 일치 | 33·42 + probe 공개 items |
| S18 | ui/league-core.js:536 | 주민 평가는 12턴마다: 현실 임기 4년(48달)을 ×4 압축 | reviewEvery=12; 임기48달/12=4. 비교4년·48달·×4는 직접 기재 유지(core 수정 금지·비교 임기 공유값 없음) | 아니오 | 일치 | 33·42 + probe 공개 items |
| S19 | ui/league-core.js:509 | 대기 영향 ×4(교육용·집단 만족만, 이주에는 ×1) | air=80−4×29×PM 증분; 이주는 ×1; econ.js | 예 | 일치 | 33·42 + probe 공개 items |
| S20 | ui/league-core.js:510 | CBAM 효과 ×5: 교육용 확대 | cbamPhase×0.046×0.154×5; econ.js | 예 | 일치 | 33·42 + probe 공개 items |
| S21 | ui/league-core.js:511 | 재생 접속 속도 ×27: 수업 기간 안에 접속 | 0.00375×27=0.10125; league-core.js 접속 증가식 | 예 | 일치 | 33·42 + probe 공개 items |
| S22 | ui/league-core.js:512 | 출력제어 손실 ×3.3: 버림을 관찰하도록 확대 | curtailP×0.018×3.3=curtailP×0.0594; league-core.js | 예 | 일치 | 33·42 + probe 공개 items |
| S23 | ui/league-core.js:513 | 기상 사건 빈도 ×0.1: 정책 판단 시간을 확보 | hazardReal×0.1; league-core.js(태풍·황사, 모든 사건에 곱하는 값 아님) | 예 | 일치 | 33·42 + probe 공개 items |
| S24 | ui/league-core.js:514 | LNG 급등이 현실보다 약 3배 자주 나와요(추정 비교값, 추첨 확률에 곱하지 않음) | 표시용 현실 비교값 3; 실제 추첨 intlEventP=0.12·사건 weight(직접 ×3 아님) | 예 | 근사 표시 있음 | 33·42 + probe 공개 items |
| S25 | ui/league-core.js:515 | 정전 1%를 같은 수요의 시간으로 바꾼 값: 연 87.6시간(에너지 미공급률의 등가 시간 환산이며, 실제 정전시간과 다름) | outageHoursPerPercent=87.6; 미공급 에너지 등가시간이며 실제 정전시간과 다르다고 표시 | 예 | 근사 표시 보완(0777730) | 33·42 + probe 공개 items |
| S26 | ui/league-core.js:516 | 섬 연습 지도 송전 손실은 리그의 3배: 짧은 지도에서 손실 관찰 | M.lossPerHex 0.015 / 도시 lossPerHex 0.005 =3 | 예 | 일치 | 33·42 + probe 공개 items |
| S27 | ui/league-core.js:517 | SMR 공사 시간 ×4.4: 현실 비교 약 55개월 → 게임 12달 | 55/4.4=12.5 ≠ 12; ‘약’ 포함, smrTurns=12 | 예 | 근사 표시 있음 | 33·42 + probe 공개 items |
| S28 | ui/league-core.js:518 | 연구 기간 수십 배 압축: 현실 10~30년 → 게임 수 달 | [10,30]년은 비교 자료; 실제 필요량/인력/4.35 + 실증 1턴 | 예 | 근사 표시 있음 | 33·42 + probe 공개 items |
| S29 | ui/league-core.js:519 | 마을 민원을 도시 전체 만족에 반영: 지지에 미치는 영향이 현실보다 약 50~200배 커요(추정 비교값, 계산 배수 아님) | [50,200]은 비교 자료; 실제 min(20, 민원점수×1)×집단비중 | 예 | 근사 표시 있음 | 33·42 + probe 공개 items |
| S30 | ui/league.js:381 | 현실 착공~가동 solar 2년 | buildLeadYears.solar=2; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38 + probe 출력 |
| S31 | ui/league.js:381 | 현실 착공~가동 wind 3년 | buildLeadYears.wind=3; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38 + probe 출력 |
| S32 | ui/league.js:381 | 현실 착공~가동 ess 1년 | buildLeadYears.ess=1; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38 + probe 출력 |
| S33 | ui/league.js:381 | 현실 착공~가동 biomass 4년 | buildLeadYears.biomass=4; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38 + probe 출력 |
| S34 | ui/league.js:381 | 현실 착공~가동 diesel 2년 | buildLeadYears.diesel=2; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38 + probe 출력 |
| S35 | ui/league.js:381 | 현실 착공~가동 smr 6년 | buildLeadYears.smr=6; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38 + probe 출력 |
| S36 | ui/league.js:381 | 27~32개월(계획 기준) | buildLeadKorea.lngMonths=[27,32] | 예 | 일치 | 38 + probe 출력 |
| S37 | ui/league.js:381 | 인허가까지 약 10년 | buildLeadKorea.windPermitYears=10 | 예 | 근사 표시 있음 | 38 + probe 출력 |
| S38 | ui/league.js:381 | 계획·인허가부터 5~15년 | buildLeadKorea.gridYears=[5,15] | 예 | 일치 | 38 + probe 출력 |
| S39 | ui/league.js:381 | SMR만 12달, 다른 설비는 즉시 건설·접속 대기 | SMR readyRound=startRound+12; hostLimited 재생은 접속 대기, 신규 석탄·LNG는 공사 대기 없음. 일반 문장의 접속은 배선 필요까지 포괄 | 예 | 일치 | 38 + probe 출력 |
| S40 | ui/build.js:3893 | 리그 한 달 4.35주 진척·실증 1달; 연구소 3억/달 | roundSteps=4.35, RS.labOpexR=3; 실증1달/턴 후 도입. 기간1은 core 단계 규칙 직접 표기 유지(공유 기간값 없음) | 아니오 | 일치 | 소스 대조 |
| S41 | ui/build.js:3661 | 혼자: 대학 4주 뒤, 연구소 0.3억/주 | RS.uniPrepW=4, labOpexW=.3; researchRun 주차 루프 | 예 | 일치 | 소스 대조 |

### 점수식

| ID | 현재 위치 | 현재 화면 문장/설명(요약) | 실제 계산·조건 | 자료 | 판정 | 이번 근거 |
|---|---|---|---|---|---|---|
| Q01 | ui/econ.js:859 | 균형 점수 공식 | scorePartFloor=1, wScore 합=1; 실제 score 호출값과 독립 계산 비교 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q02 | ui/league.js:866 | 지역 전체 성장 제외 주민·산업 변화 | econ.js score gp/gi; 점수=50+K×상대변화 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q03 | ui/league.js:866 | 주민 부분 점수 | neutralScore=50; 12달 K.pop=711.571022 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q04 | ui/league.js:866 | 산업 부분 점수 | neutralScore=50; 12달 K.ind=1023.165165 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q05 | ui/league.js:866 | 재정 부분 점수 | 채무/(budgetToRevenue=2.2×연세입) .1→100, .25→50; 한도 초과 0; 현금 적립 가점 없음 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q06 | ui/league.js:866 | 탄소 부분 점수 | absolute: 강도 .82→0, .25038→80, 0→100; relative: 시작 대비 감축 0→0, .4→80, 1→100; max(absolute,relative); econ.js | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q07 | ui/league.js:866 | 지지 부분 점수 | approvalWindow=12; 실제 승인 이력 평균(초기엔 기록된 달 수) | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q08 | ui/league.js:866 | 전력 신뢰 부분 점수 | scoreUnsZero=16; clip 0~100, 계통 의존 별도 감점 없음 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q09 | ui/league.js:280 | 가중치 변경·전부 0이면 원래 점수 | reweightScore: total=0이면 r.score; 그 외 엔진과 같은 기하평균 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q10 | ui/league.js:3615 | 공동 보너스 두 목표 달성 시 +2·이번 달만 | coopBonus=2; monthly report 두 목표 AND, E.coop 재대입 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q11 | ui/league.js:881 | 계통 의존은 신뢰 감점 없음·비용과 배출은 반영 | gridImportShare=.5, gridImportMarkup=1.5, normalCost=.008, normalCo2=.4173 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |
| Q12 | ui/league.js:2811 | 공동 보너스는 6개 부분 점수와 별도 | Object.keys(wScore).length=6; 기하평균 뒤 공동 보너스 가산 | 예 | 일치 | 25·31·35·36 + probe 독립 점수식 |

### 원인 분해

| ID | 현재 위치 | 현재 화면 문장/설명(요약) | 실제 계산·조건 | 자료 | 판정 | 이번 근거 |
|---|---|---|---|---|---|---|
| B01 | ui/build.js:3760 | 배터리 각92.2%·왕복약85%, BMS 뒤 각93.3%·왕복약87% | M.batEff=.922, 왕복 .850084; BMS .933, 왕복 .870489 | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B02 | ui/build.js:3748 | 도시 태양광 GHI×성능비0.92×날씨 가중치/월평균 날씨 가중치 | day.eDay=GHI×M.pvYield×wxSun[w]/ew | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B03 | ui/build.js:3749 | 육상풍력3미만0·12정격·25초과정지 | M.cutin/rated/cutout=3/12/25; 보간식 (v³−3³)/(12³−3³) | 예 | 일치 | probe 13모드 실제 출력·값 + 소스 |
| B04 | ui/build.js:3750 | 조력2MW×0.31×&#124;sin(2πt/12.42h)&#124;, 위상 보정 생략 | renOut0=2×TIDAL_FACTOR(.31)×abs(sin(2π(k+3)/12.42)); 위상 생략을 문장에 명시 | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B05 | ui/build.js:3977 | 소수력 평균계수0.25×월강수보정×날씨유량/월평균유량, 맑은 날 사흘째부터 더 감소, 정격 상한 | 정격×min(1,.25×(0.5+0.5×월강수/연평균강수)×flow/flowMean); 맑음 첫·둘째 .85, HYDRO_DRY_DAYS=3부터 .7, 비1.3 | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 + E3 바이트 동일·공유값 변형 |
| B06 | ui/build.js:3751 | 기존 발전소의 연료·용량; 자유수입 총상한/연결점별 상한; 리그 직접수입 없음 | 평택 LNG9.5MW, 자유수입 총2.5/5점=.5MW/점. 당진 석탄26.1MW, 총1.5/3점=.5. 리그 직접0, 월운영 계통상한 수요50% | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B07 | ui/build.js:3752 | 디젤3MW(최소1, CO₂ .75)·바이오2MW(총량0, 별도 바이오배출 .1) | BLD.mw와 dispOf min/co2/bioCo2 읽음 | 예 | 일치 | probe 13모드 실제 출력·값 + 소스 |
| B08 | ui/build.js:3753 | 송전손실 .5%/칸·선2억/칸·하천산×2·바다호수×3 | PK.lossPerHex=.005; lineUnit=2; stepMul 2/3 | 예 | 일치 | probe 13모드 실제 출력·값 + 소스 |
| B09 | ui/build.js:3754 | 자유: 싼 급전원부터 / 리그: 재생→배터리→도시급전원→이웃거래→자동계통수입 | simulate C.DL은 mc 정렬(석탄·SMR 포함); core는 이웃거래·가격대체 후 gridSupply; 고정 LNG우선 순서 아님 | 해당 없음 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B10 | ui/build.js:3746 | 자유 1MW≈실제100MW / 리그 1MW≈실제230MW | 자유 PK.scale / 리그 region.mwScale, H03·H04와 일치 | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B11 | ui/build.js:3757 | 연습섬 태양광2MW×일사(1/.45/.2)×타일 | BLD.solar.mw, M.wxSun을 읽고 시간별 일사 곡선 적용 | 예 | 일치 | probe 13모드 실제 출력·값 + 소스 |
| B12 | ui/build.js:3758 | 연습섬 풍력2MW×min(1,(풍속/12)³), 25m/s 초과정지 | 정격 상한 min(1,…)과 M.rated/cutout을 읽음 | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B13 | ui/build.js:3759 | 연습섬 디젤3MW(최소1)·CO₂.75·연료 .01억/MWh | BLD.diesel.mw와 dispOf(diesel) 읽음 | 예 | 일치 | probe 13모드 실제 출력·값 + 소스 |
| B14 | ui/build.js:3760 | 배터리4MW/16MWh·바닥10%; 효율 B01 참조 | BLD.battery.mw, M.batMWh/socFloor 읽음 | 예 | 일치 | probe 13모드 실제 출력·값 + 소스 |
| B15 | ui/build.js:3761 | 연습섬 손실1.5%/칸·선 .5억/칸·산×2·바다×3 | PK.lossPerHex 또는 M.lossPerHex; lineUnit·stepMul 읽음 | 예 | 일치 | probe 13모드 실제 출력·값 + 소스 |
| B16 | ui/build.js:330 | 풍속2배면 출력 약8배 | 도시 cutin 보정·정격포화·정지, 섬 min 포화. ‘약’은 있으나 구간 한정 필요 | 아니오 | 근사 표시 있음 | 소스 대조 |
| B17 | ui/build.js:323 | 전력량=전력×시간 | simulate 1시간 시간단계 누산 | 해당 없음 | 일치 | 소스 대조 |
| B18 | ui/build.js:329 | 흐린 날 태양광은 맑은 날의 절반 미만(값이 바뀌면 비율 표시) | TIPS0 함수에서 M.wxSun[1]/M.wxSun[0]=.45 계산 | 예 | 일치 | probe 13모드 실제 출력·값 + 소스 |
| B19 | ui/build.js:302 | 탄소세: 섬 디젤×1.5 / 도시 디젤×1.3125 | 섬(.01+.005)/.01=1.5; 도시(.016+.005)/.016=1.3125. 국제 fuelMul도 반영 | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B20 | ui/build.js:305 | 수요반응 계약·피크감축·일 정책비 일반.05/VPP.025억 | M.drCost=.05×(VPP drCost=.5)=.025; 피크는 peakDemand(off)−peakDemand(on) | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B21 | ui/build.js:309 | 이익공유 .1억/일 | M.shareCost=.1을 읽음 | 예 | 일치 | probe 13모드 실제 출력·값 + 소스 |
| B22 | ui/build.js:323 | 정전 미션 ≤.5%·병원0시간 | MISSION_TARGETS: unsTotal&lt;=outageShare(.005)×dem AND hosp===hospitalHours(0) | 예 | 일치 | 소스 대조 + E3 바이트 동일·공유값 변형 |
| B23 | ui/build.js:315·924 | 비용 미션 목표 | PK.goals로 계산; R.cost.total과 비교 | 예 | 일치 | 소스 대조 |
| B24 | ui/build.js:316·925 | CO₂ 미션 하루평균 이하 | PK.goals.co2Day; 도시 생산CO₂와 별도 bio 정보 항목 | 예 | 일치 | 소스 대조 |
| B25 | ui/build.js:326 | 민원≤1·최저만족≥60 | MISSION_TARGETS: R.cp.issues&lt;=complaints(1) AND min(R.sat)&gt;=satisfaction(60) | 예 | 일치 | 소스 대조 + E3 바이트 동일·공유값 변형 |
| B26 | ui/build.js:3626 | 평택 공장5→10MW / 다른5도시 공장 증설 수요 정의 없음 | 평택 dem.base=5/fab2=10; 다른5도시 fab2 없음. 자유모드 버튼은 남지만 잘못된5→10 숫자는 제거 | 예 | 해소(6812f43) | probe 13모드 실제 출력·값 + 소스 |
| B27 | ui/build.js:3629 | 디젤·바이오 사전민원은 가동60% 가정 / 신규 화력·SMR은 가동과 무관 | complaints(st,null)의 f=COMPLAINT_RUN_FRAC(.6); 신규 coal/lng/smr는 runFrac 미사용(D07) | 예 | 근사 표시 있음 | probe 13모드 실제 출력·값 + 소스 + E3 바이트 동일·공유값 변형 |
| B28 | ui/build.js:3467 | 일사배수·숲정리2억 | 타일 sun과 CLEAR_COST=2 | 예 | 일치 | 소스 대조 |
| B29 | ui/build.js:3468 | 예상송전손실 최단거리 | 실제 전선 경로와 다름 명시; 최소 효율 .4 | 예 | 근사 표시 있음 | 소스 대조 |
| B30 | ui/build.js:3480 | 대표월 풍속이3 미만이면 거의 발전 안 함 | M.cutin=3은 순간 풍속 기준. 시간별 변동은 가능, ‘거의’로 완화 | 예 | 근사 표시 있음 | 소스 대조 |
| B31 | ui/build.js:3482 | 축산옆 바이오 연료 감소 | biomassFuel=.012, dispOf.fuel=.02 | 예 | 일치 | 소스 대조 |
| B32 | ui/build.js:3267 | 설비/피크 정의 | PLAIN_DAY.m+1=7월을 읽음; 통전 설비 정격합/최대수요, 기관부하 제외 | 예 | 일치 | 소스 대조 |
| B33 | ui/build.js:257 | 건설 연구 grid·bms·fcst 효과 | gridEffectText/bmsEffectText 읽음; fcst 표시·저장 예약 계산은 FORECAST_EVENING={start:17,end:23} 공유 | 예 | 일치 | 소스 대조 + E3 바이트 동일·공유값 변형 |
| B34 | ui/build.js:999 | 배터리1대12억의 값어치 | BLD.battery.cost=12(차세대15는 별도) | 예 | 일치 | 소스 대조 |
| B35 | ui/build.js:3707 | 총비용=건설+연료+정책+연구 | simulate R.cost.total; 리그 시험은 지도 전체 투자라고 표시 | 예 | 일치 | 소스 대조 |
| B36 | ui/build.js:961·964·968 | 뉴스 버린MWh·수입%·송전손실% | 결과값에서 읽으며 관측 통계가 아닌 모형 결과 | 예 | 일치 | 소스 대조 |
| B37 | ui/build.js:936·950·969 | 뉴스 시설정전h·저녁h·n일무정전 | 시간별 town 결과; 도시 core outH와 다른 시설 기준 | 예 | 일치 | 소스 대조 |
| B38 | ui/build.js:963·984·993 | 뉴스/질문 CO₂t·연료비억·미공급MWh | 리그 뉴스는 tot.co2 생산; 질문은 simulate 결과 | 예 | 일치 | 소스 대조 |
| B39 | ui/build.js:227 | solar 설비 spec: 2 MW | BLD.solar: mw=2, mwh=없음, cost=8; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B40 | ui/build.js:228 | roof 설비 spec: 0.6 MW | BLD.roof: mw=0.6, mwh=없음, cost=4; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B41 | ui/build.js:229 | wind 설비 spec: 2 MW | BLD.wind: mw=2, mwh=없음, cost=10; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B42 | ui/build.js:230 | offshore 설비 spec: 4 MW | BLD.offshore: mw=4, mwh=없음, cost=24; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B43 | ui/build.js:231 | tidal 설비 spec: 2 MW | BLD.tidal: mw=2, mwh=없음, cost=18; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B44 | ui/build.js:232 | hydro 설비 spec: 0.1 MW | BLD.hydro: mw=0.1, mwh=없음, cost=2; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B45 | ui/build.js:233 | diesel 설비 spec: 3 MW | BLD.diesel: mw=3, mwh=없음, cost=6; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B46 | ui/build.js:234 | biomass 설비 spec: 2 MW | BLD.biomass: mw=2, mwh=없음, cost=10; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B47 | ui/build.js:235 | battery 설비 spec: 4 MW/16 MWh | BLD.battery: mw=4, mwh=16, cost=12; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B48 | ui/build.js:237 | uni 설비 spec: 연구인력 2 · 0.3 MW | BLD.uni: mw=0, mwh=없음, cost=40, RS.uniStaff=2, load=.3; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B49 | ui/build.js:238 | lab 설비 spec: 연구석 3 · 0.3억/주 | BLD.lab: mw=0, mwh=없음, cost=25, RS.labSeats=3, labOpexW=.3; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B50 | ui/build.js:1102 | nbat 설비 spec: 4 MW/20 MWh | BLD.nbat: mw=4, mwh=20, cost=15; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| B51 | ui/build.js:1103 | h2store 설비 spec: 4 MW/200 MWh · 왕복 35% | BLD.h2store: mw=4, mwh=200, cost=28; 지도 override 뒤 값 | 예 | 일치 | bldFor/buildingSpec 원장·표시 소스 |
| C01 | ui/league.js:288 | causeBreakdown 기여 막대 | 현재 소비자는 집단 목표 막대이며 other 제거. 끝 화면 기하평균 점수 분해에는 쓰지 않음 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C02 | ui/league.js:1607 | 도시 지지율 원인 상위 3개 | econ.js; causeCount=3, 단순 가중 차이를 엔진 보고에서 읽음 | 예 | 근사 표시 있음 | 29-r3·31·34·36 관련 계산 + 소스 |
| C03 | ui/league.js:1715 | 끝 화면 보고된 달별 기여 합·누락 달 제외 | finalCausesHTML sums; 전체 delta와 합 다를 수 있다고 명시 | 예 | 근사 표시 있음 | 29-r3·31·34·36 관련 계산 + 소스 |
| C04 | ui/league.js:2829 | 정전 시간 정의 | outageHourMinMW=.005, outageHourShare=.02를 표시/판정이 함께 읽음; days×24 상한 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C05 | ui/league.js:1883 | 대표7일×월배수; 모든 주제 ‘생산 CO₂(이번 달)’ t/일·월합 보조 | 월일수/res.days; 모든 주제 생산CO₂=r.co2Prod×mul/days, 소비CO₂ 하루평균 줄은 '예측 자세히' 안 예측 대 실제 섹션의 판정·판정 계산 줄 다음(rev16 #72) | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C06 | ui/league.js:2852 | 시험/실제 월 환산·기간 다르면 시험 추정 | 시험 gridFill 포함, 이웃 거래 없음; 비용 fuel+policy만 비교 | 예 | 근사 표시 있음 | 29-r3·31·34·36 관련 계산 + 소스 |
| C07 | ui/league.js:3611 | CO₂ 선택·계절수요·일수 몫 | co2Attribution 2회 동일 계획 비교; calendar=전월 생산×일수차/대표일수 | 예 | 근사 표시 있음 | 29-r3·31·34·36 관련 계산 + 소스 |
| C08 | ui/league.js:migrationBenefitHTML | 이주 편익·부담 추정 | 주민세=유입×resTax×(1+taxStep×주민세 단계), 엔진 ownRev와 같은 선형식; 서비스=엔진 serviceBase(유입, 고령 몫)×(1+svcStep×서비스 단계), 고령 몫이 유한한 수가 아니면 0 | 예 | 근사 표시 있음 | rev15 #59·63-rev15.js + 소스 |
| C09 | ui/league.js:3633 | H04 정전 피해·실제 돈·현금 제외 | outageHomeWon=3564; industryUSD=.35~.8; Fx=1291.304347826087; 주거몫으로 배분 | 예 | 근사 표시 있음 | 29-r3·31·34·36 관련 계산 + 소스 |
| C10 | ui/league.js:3680 | H03 지역자원시설세·게임 세입 | facilityRate coal=.7,lng=.6,smr=1; moneyScale=28; 수입은 과세 제외 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C11 | ui/league.js:3615 | 실제 공급량 기준 감축 | normalCo2=.4173; 판매 배출 제외·수입 포함·음수 보존 | 예 | 근사 표시 있음 | 29-r3·31·34·36 관련 계산 + 소스 |
| C12 | ui/league.js:3643 | 계통이 메운 전기 MWh/일 · 월합MWh·월비용추정 | gridFillMWh×월배수/월일수; 월비용=mwh×(.008×1.5). 하루평균/월비용 라벨 구별 | 예 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C13 | ui/league.js:2934 | 끝 순위 계통 달 합·1년 평균 | gridTotal; 24/36달에서 연평균 표시, 기록 누락 달 제외 | 예 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C14 | ui/league.js:2955 | 계통약속/S6/S7 하루평균 MWh/일 우선 | 31일310→28일280MWh: 월Δ−30, 하루10→10·deltaPerDay=0. D-82 적용(2452286·9c56325·d72c7f8) | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C15 | ui/league.js:3607 | S7 계산 순서에 따라 몫 달라지는 추정 | outageAttribution/Monthly; 순차 반사실, 총차 보존 | 해당 없음 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C16 | ui/league.js:3853 | S7 폭포: 기준+재현+원인→실제 | outageWaterfallHTML; monthly replayOutsideSum=true면 합 밖. 표시 합을 최대 나머지로 배분하되 최대/공동최대 판정과 달라지면 개별 반올림; 요약·근거 숫자도 같은 표시값 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C17 | ui/league.js:3606 | 재현 차이는 원인 후보 제외 | stored 조건 손실 진단; 분해 합 밖 표시 분기 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C18 | ui/league.js:2990 | 계통 상한·할증 단서 | outageGridClue reads gridImportShare/Markup; gridSupply와 동일 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C19 | ui/league.js:3008 | 평균 풍속(연결된 육상/해상만) | climate wind10×hub 혹은 wind100; 시간 배수 평균, 위치 보정 제외라고 표시 | 예 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C20 | ui/league.js:2992 | 평균 수요·최대 수요 | outageWeatherMetrics | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C21 | ui/league.js:3008 | 하루 재생 공급 변화 | 분모0이면 MWh/일 절대값, 양쪽0이면 공급 없음 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C22 | ui/league.js:3008 | 무더위 일수/비율·28℃ 초과 | M.hotTmax=28℃초과; 기간 다르면 hotDays/days×100 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C23 | ui/league.js:3008 | 단서 순서는 평균 수요·재생 절댓값 | 순서 결정용 근사; 원인 몫은 별도 순차 재계산 | 해당 없음 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C24 | ui/league.js:3934 | 원인 카드 최대 세 개·가장 큼/공동 최대; 생략은 표시 눈금에서 올린 문턱 ‘이하’ | 최대3개; 정전최소.05%p; 계통 max(tolPerDay/10,.05MWh/일); 표시 자릿수 공동최대, 판정상수 params 읽음 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C25 | ui/league.js:1841 | 내 예측이 놓친 것·직접 연결 | 근거 종류→단계 연결표; 풍력은 통전 조건 필요 | 해당 없음 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C26 | ui/league.js:332 | 접속 대기·버린 재생 전기 | grid entries allocation; 월/대표기간 변환, solarMul 사건은 별도 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C27 | ui/league.js:332 | 출력제어 사건 태양광 감소 | 현재 .75, x=1일 때 −25%; VPP curtailP×.8과 별개 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C28 | ui/league.js:4079 | 장부 ‘달 초 + 수입 − 신규 투자 − 연료·운영비 = 달 말’; 도시 서랍 ‘기타 운영’ | r.ledger 동일; 이미 월 값이므로 재환산 안 함 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C29 | ui/league.js:392 | 채무 주의25%·위기40% | 현재 .55/2.2=.25, .88/2.2=.4; engine debtCrisisRatio=.4 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C30 | ui/econ.js:632; ui/league.js:448 | 국가 지원금: 지급 월마다 연액의1/4 | subsidyPayMonths=[1,4,7,10]; 연액/payMonths.length; 설명도 같은 자료 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C31 | ui/econ.js:641 | 국제 사건 이름·기간·설명 | intlStep started의 dur/text, 900 이상은 기간표시 생략 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C32 | ui/econ.js:679·680 | 주민 n명/일자리 n개 이전 | pairFlows 정수 흐름·causeOf; newsMin100 또는 newsFrac=.0005 넘을 때 | 예 | 근사 표시 있음 | 29-r3·31·34·36 관련 계산 + 소스 |
| C33 | ui/econ.js:711 | 재정 주의 채무비율25% 이상 | 100×debtWarnRatio(.55)/budgetToRevenue(2.2)=25; 문구도 동적 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C34 | ui/econ.js:711 | 위기 새 건설·유료 대응 제한·재정점수0 | 한도초과/위기에 새 건설·유료 대응 제한; 재정점수 문구는 finScore 결과0. 재난 특별교부세 예외는 별도 안내 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C35 | ui/econ.js:739·756 | 다른 도시 대비 지지율 회복시 시위 멈춤·평가 시 정책비↑ | 시위 정지 기준 relative&gt;=−4; 시작 relative&lt;−10; 평가 12달마다 | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C36 | ui/econ.js:533·747 | 기업 이전 희망/확정·명/MW/재생% | evalOffer 4조건; acceptOffer 실제 moved | 예 | 일치 | 29-r3·31·34·36 관련 계산 + 소스 |
| C37 | ui/league.js:3431 | 내 선택: 설비 추가·제거·전선·정책 | 지난 사본과 현재 sanitized plan 비교 | 예 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C38 | ui/league.js:3434 | 접속·공사·기술 진행 | 고정 계획에 접속/기술 경과만 반영; 이웃 연계선 변화 따로 | 예 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C39 | ui/league.js:3435 | 도시 성장·연료 값 | 월말 현재값 아닌 운영 당시 facts | 예 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C40 | ui/league.js:3436 | 이웃 구매·판매 변화 | flow 손실 뒤 도착량; 판매대체 sub 포함 | 예 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C41 | ui/league.js:3452 | 사건·대응 단서 | scope와 현지도 발전설비 유무 확인 | 예 | 근사 표시 있음 | 30·32·37·39·40 관련 계산 + 소스 |
| C42 | ui/league.js:442 | 철거30%회수·70%손실 | core SALV=.3; lossOf cost×(1−SALV), 기존 paidCost 사용 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C43 | ui/league.js:915 | 같을 것: 하루평균 변화≤0.05MWh/일과 기준5%중 큰 값 | max(gridSameMwhPerDay=.05,abs(basePerDay)×gridSameSharePerDay=.05); 기준10이면.5MWh/일. 반올림 전 판정 | 예 | 일치 | 30·32·37·39·40 관련 계산 + 소스 |
| C44 | ui/league.js:SUPPLY_ASSUMPTION | 바깥 계통 공급 가정(경제·계절) | 경제: 매시간 수요의 gridImportShare 상한·기준 원가의 gridImportMarkup 배, 나머지는 자체 발전·이웃 연계선; 계절: 바깥 계통 보충 없음, 돌아가는 설비가 없으면 정전 100% 가능 | 예 | 게임 가정 표시 있음 | rev16 #65·league-core gridFill/run + 소스 |

### 공기 주석

| ID | 현재 위치 | 현재 화면 문장/설명(요약) | 실제 계산·조건 | 자료 | 판정 | 이번 근거 |
|---|---|---|---|---|---|---|
| A01 | ui/league.js:262 | 발전 PM2.5 증분·이웃 기여 추정 | kPM=.000007×Σ발전MWh×연료가중; pmGenMWh가 있으면 신구분리(coalNew=.3666667,lngNew=.0233333), 없으면 genMWh. 이웃1회 합산 | 예 | 근사 표시 있음 | 29-r3·34·36 + probe/소스 |
| A02 | ui/league.js:262 | 측정 비율 있는 당진→아산·천안 | airNeighbours 중 grade≠G 쌍; 참가 도시 필터 | 예 | 근사 표시 있음 | 29-r3·34·36 + probe/소스 |
| A03 | ui/league.js:262 | 나머지 이웃 0.2배·근거 없는 게임 가정 | airNeighbours G ratio=.2, 참여 쌍 최솟값~최댓값 | 예 | 근사 표시 있음 | 29-r3·34·36 + probe/소스 |
| A04 | ui/league.js:262 | 전체 대기질이나 관측 농도 아님 | econ.js regionCtx 발전량 기반 증분만 합산 | 해당 없음 | 근사 표시 있음 | 29-r3·34·36 + probe/소스 |
| A05 | ui/league.js:673 | 발전 PM2.5 증분으로 공기가 나빠서 | WHY_L.air; CO₂가 아니라 reg.pm25.delta | 해당 없음 | 근사 표시 있음 | 29-r3·34·36 + probe/소스 |
| A06 | ui/league.js:391 | 바이오 CO₂ 국가 총량 밖·IPCC 정보 항목 | build.dispOf biomass.co2=0, bioCo2=.1; econ 도시 보고 분리 | 예 | 일치 | 29-r3·34·36 + probe/소스 |
| A07 | ui/build.js:3752 | 바이오 CO₂ 총량에는0, 배출 .1t/MWh는 별도정보 | dispOf(biomass).co2=0,bioCo2=.1, 문장도 같은 객체 읽음 | 예 | 해소(6812f43) | 29-r3·34·36 + probe/소스 |
| A08 | ui/build.js:3511 | 연결점 CO₂ .4173t/MWh | dispOf(import).co2=normalCo2=.4173 | 예 | 해소(6812f43) | 29-r3·34·36 + probe/소스 |
| A09 | ui/build.js:3751 | 외부 전력망 CO₂ .4173t/MWh | dispOf(import).co2=normalCo2=.4173 | 예 | 해소(6812f43) | 29-r3·34·36 + probe/소스 |
| A10 | ui/build.js:3751 | 기존 LNG CO₂ .37t/MWh | dispOf(lng).co2=.37 읽음 | 예 | 일치 | 29-r3·34·36 + probe/소스 |
| A11 | ui/build.js:3511 | LNG CO₂ .37t/MWh | dispOf(lng).co2=.37 읽음 | 예 | 일치 | 29-r3·34·36 + probe/소스 |
| A12 | ui/build.js:3752 | 디젤 CO₂ .75t/MWh | dispOf(diesel).co2=.75 읽음 | 예 | 일치 | 29-r3·34·36 + probe/소스 |

### 사건 출처

| ID | 현재 위치 | 현재 화면 문장/설명(요약) | 실제 계산·조건 | 자료 | 판정 | 이번 근거 |
|---|---|---|---|---|---|---|
| V1 | ui/league-data.js:68 (heatwave_peak) | text(경제 모드, rev14 H1): 오후 냉방 수요가 늘고 LNG·일반 태양광 출력이 조금 줄며 공공시설 보수비가 한 번 들어요. 재난이라 특별교부세가 나와요. / textSeason(계절 4라운드, rev14b): 오후 냉방 수요가 늘고 LNG·일반 태양광 출력이 조금 줄어요. | effect={"demandMul":1.12,"hours":[13,19]}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.12,"demandHours":[13,19]},"bonus":10,"down":[]} ; 출력 감산은 두 모드 모두 modsFor(league-core.js 폭염 분기, 경제 블록 밖) lngCapMul·solarHeatMul(solar·roof만, 탠덤 제외); 보수비·교부세는 경제 모드만(grantAmount·repairOf `if (!S.econ) return 0`), 화면은 league.js eventText가 모드로 고름 | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스, 62-rev14b D |
| V2 | ui/league-data.js:68 (heatwave_peak) | why: 역대 최대전력수요는 2024년 8월 20일 97.1GW이며, 2025년 7월 8일에도 95.7GW로 역대 최대는 넘지 않았지만 7월 기준 최고를 기록했다. | 관측/계획 근거(엔진 입력 아님); asOf=["2024-08","2025-07"], published=null; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V3 | ui/league-data.js:68 (heatwave_peak) | dr: 수요반응 계약 / 피크 시간에 공장·건물이 사용을 미루고 보상받는다 | 비용 4억; 실제 {"option":"dr","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.06,"demandHours":[13,19]},"bonus":10,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V4 | ui/league-data.js:68 (heatwave_peak) | save: 절전 캠페인 / 싸지만 참여는 일부만 | 비용 1억; 실제 {"option":"save","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.096,"demandHours":[13,19]},"bonus":10,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V5 | ui/league-data.js:69 (evening_peak_tropical_night) | text: 해가 져도 더위가 계속! 저녁 전기 수요가 늘어요. | effect={"demandMul":1.08,"hours":[17,22]}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.08,"demandHours":[17,22]},"bonus":0,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V6 | ui/league-data.js:69 (evening_peak_tropical_night) | why: 2025년 7월 8일 최대전력 95.7GW는 오후 6시에 발생했고, 정부는 평일 17~20시를 여름철 피크 시간대로 보고 절감 보상 시범사업을 시행했다. | 관측/계획 근거(엔진 입력 아님); asOf=["2025-07"], published=["2026-06"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V7 | ui/league-data.js:69 (evening_peak_tropical_night) | dr: 수요반응 계약 / 피크 시간에 공장·건물이 사용을 미루고 보상받는다 | 비용 3억; 실제 {"option":"dr","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.04,"demandHours":[17,22]},"bonus":0,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V8 | ui/league-data.js:69 (evening_peak_tropical_night) | save: 절전 캠페인 / 싸지만 참여는 일부만 | 비용 1억; 실제 {"option":"save","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.064,"demandHours":[17,22]},"bonus":0,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V9 | ui/league-data.js:70 (monsoon_cloud) | text: 장마로 흐린 날이 이어져요. 태양광 출력이 줄어요. | effect={"solarMul":0.6}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"solarMul":0.6},"bonus":0,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V10 | ui/league-data.js:70 (monsoon_cloud) | why: 흐리거나 비가 오는 날 태양광 출력은 맑은 날보다 크게 떨어진다. 태풍이 북상하던 2024년 8월 20일에는 태양광 설비가 몰린 호남권이 흐려 태양광 발전량이 낮았고 전력 수요는 역대 최대를 기록했다. 2026년 여름 전망에서도 '흐린 날씨+폭염'을 최악 조건(98.8GW)으로 가정했다. | 관측/계획 근거(엔진 입력 아님); asOf=["2024-08"], published=["2026-06"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V11 | ui/league-data.js:70 (monsoon_cloud) | tip: 구름은 못 막는다 — 저장·다른 발전원으로 대비 | effect={"solarMul":0.6}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"solarMul":0.6},"bonus":0,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V12 | ui/league-data.js:71 (typhoon_coast) | text: 태풍 북상! 풍력 출력이 줄고 해안 연계선이 끊길 수 있어요. | effect={"offshoreMul":0.2,"windMul":0.6,"tieDown":"dangjin~asan"}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"windMul":0.6,"offshoreMul":0.19999999999999996},"bonus":10,"down":["dangjin~asan"]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V13 | ui/league-data.js:71 (typhoon_coast) | why: 2020년 태풍 마이삭 때 송전설비의 염분·강풍에 의한 섬락으로 원전 6기의 외부 전원이 끊기고 그중 운전 중이던 4기가 정지했다. 풍력발전기는 한계 풍속을 넘으면 안전을 위해 회전을 멈춘다. | 관측/계획 근거(엔진 입력 아님); asOf=["2020-09"], published=null; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V14 | ui/league-data.js:71 (typhoon_coast) | harden: 송전선 사전 점검·보강 / 선 고장은 막지만, 해상풍력은 강풍 때 안전하게 멈춘다(멈춤 ≠ 파손) | 비용 5억; 실제 {"option":"harden","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"windMul":0.6,"offshoreMul":0.19999999999999996},"bonus":10,"down":["dangjin~asan"]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V15 | ui/league-data.js:72 (coldwave_heating) | text: 매서운 한파! 난방 전기 수요가 늘어요. | effect={"demandMul":1.15,"hours":[8,20]}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.15,"demandHours":[8,20]},"bonus":10,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V16 | ui/league-data.js:72 (coldwave_heating) | why: 2022년 12월 23일 한파로 겨울철 최대전력 94.5GW를 기록했고, 정부는 2025/26 겨울에도 한파·폭설 시 최대 94.5GW를 전망했다. | 관측/계획 근거(엔진 입력 아님); asOf=["2022-12"], published=["2025-12"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V17 | ui/league-data.js:72 (coldwave_heating) | dr: 수요반응 계약 / 피크 시간에 공장·건물이 사용을 미루고 보상받는다 | 비용 4억; 실제 {"option":"dr","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.075,"demandHours":[8,20]},"bonus":10,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V18 | ui/league-data.js:72 (coldwave_heating) | insul: 취약가구 단열 지원 / 효과는 오래 가지만 게임은 이번 라운드만 계산 | 비용 6억; 실제 {"option":"insul","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.105,"demandHours":[8,20]},"bonus":10,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V19 | ui/league-data.js:73 (heavy_snow_solar) | text: 폭설로 패널이 눈에 덮여 태양광 출력이 줄어요. | effect={"solarMul":0.4,"demandMul":1.04}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.04,"solarMul":0.4},"bonus":10,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V20 | ui/league-data.js:73 (heavy_snow_solar) | why: 2022년 12월 22일 산업부는 한파로 겨울철 최대 전력수요가 경신될 것이라고 밝혔다. 전국에 눈이 쌓여 태양광이 전망보다 크게 덜 만든 만큼 전력망에서 받아야 할 전기도 늘었다. 다음 날 수요는 94.5GW로 역대 최대였다. | 관측/계획 근거(엔진 입력 아님); asOf=["2022-12"], published=null; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V21 | ui/league-data.js:73 (heavy_snow_solar) | clear: 패널 제설 인력 / 태양광 손실을 줄인다(눈 자체는 그대로) | 비용 2억; 실제 {"option":"clear","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.04,"solarMul":0.76},"bonus":10,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V22 | ui/league-data.js:74 (finedust_coal_cap) | text: 미세먼지 계절관리제 시행! 석탄발전 출력을 제한해요. | effect={"coalCapMul":0.8}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"coalCapMul":0.8},"bonus":0,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V23 | ui/league-data.js:74 (finedust_coal_cap) | why: 제7차 미세먼지 계절관리제(2025.12~2026.3)는 공공 석탄발전 최대 17기 가동정지, 최대 46기 출력 80% 상한제약(출력을 80% 이하로 제한)을 시행했다. | 관측/계획 근거(엔진 입력 아님); asOf=null, published=["2025-11"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V24 | ui/league-data.js:74 (finedust_coal_cap) | tip: 규제라 선택지가 없다 — 석탄 없이 버틸 계획을 | effect={"coalCapMul":0.8}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"coalCapMul":0.8},"bonus":0,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V25 | ui/league-data.js:75 (spring_dust_haze) | text: 뿌연 하늘! 황사로 햇빛이 약해져 태양광 출력이 줄어요. | effect={"solarMul":0.85}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"solarMul":0.85},"bonus":10,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V26 | ui/league-data.js:76 (spring_dust_haze) | why: 서울대 연구팀은 2015~2017년 서울·전남의 시간당 태양광 발전량과 기상 자료를 분석해, 미세먼지가 태양광 발전량을 최고 20%가량 떨어뜨릴 수 있다고 발표했다. | 관측/계획 근거(엔진 입력 아님); asOf=["2015/2017"], published=null; 자료시점/발표 분리; sources 2개(기사·[P58] doi, rev17) | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V27 | ui/league-data.js:75 (spring_dust_haze) | tip: 황사는 못 막는다 — 다른 발전원·저장으로 | effect={"solarMul":0.85}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"solarMul":0.85},"bonus":10,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V28 | ui/league-data.js:76 (light_load_curtailment) | text: 전기가 남는 시간대에 태양광 출력을 줄여요. | effect={"solarMul":0.75}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"solarMul":0.75},"bonus":0,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V29 | ui/league-data.js:76 (light_load_curtailment) | why: 봄철 경부하기(2025년 3월 1일~6월 1일, 93일)에는 전기가 남아 태양광 출력제어가 잦다. 2025년 1~6월 태양광 출력제어(제주 제외)는 44회였고 호남에서 가장 잦았다(산업부). | 관측/계획 근거(엔진 입력 아님); asOf=["2025-01/2025-06"], published=null; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V30 | ui/league-data.js:76 (light_load_curtailment) | tip: 남는 전기는 저장하거나 이웃에 팔 수 있다 | effect={"solarMul":0.75}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"solarMul":0.75},"bonus":0,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V31 | ui/league-data.js:77 (line_opposition_delay) | text: 주민 반대로 기존 연계선의 이번 라운드 송전이 멈추고 사건비가 들어요. | effect={"tieDown":"dangjin~asan","budgetAdd":-5}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0},"bonus":-5,"down":["dangjin~asan"]} | 해당 없음 | 해소(0777730) | probe effect·대응·bonus 계산 + 소스 |
| V32 | ui/league-data.js:77 (line_opposition_delay) | why: 345kV 북당진–신탕정 송전선로는 주민 반대에 따른 입지 선정 지연과 지자체 인허가 거부로 최초 목표(2012년 6월)보다 크게 늦어져 2024년 11월에야 전력 공급을 시작했고(2025년 4월 준공식), 산업부 집계로 12년 6개월 지연된 국내 최장 지연 전력망 사업이 됐다. | 관측/계획 근거(엔진 입력 아님); asOf=["2024-11"], published=["2024-11","2025-04"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V33 | ui/league-data.js:77 (line_opposition_delay) | talk: 주민 협의·이익공유 / 대응비 6억으로 이번 라운드 송전 중단을 막아요. 사건 도시 당진의 사건비 5억은 대응 후에도 남아요. | 비용 6억; 실제 {"option":"talk","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0},"bonus":-5,"down":[]} | 예 | 해소(0777730) | probe effect·대응·bonus 계산 + 소스 |
| V34 | ui/league-data.js:78 (semiconductor_fab_expansion) | text: 반도체 라인 증설! 밤낮없이 전기 수요가 늘고 세수가 들어와요. | effect={"demandMul":1.08,"budgetAdd":15}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.08},"bonus":15,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V35 | ui/league-data.js:78 (semiconductor_fab_expansion) | why: 2024년 기준 전국 시군구 중 전력 소비 1위는 평택(연 21.77TWh), 2위는 화성(21.37TWh)이었다. | 관측/계획 근거(엔진 입력 아님); asOf=["2024"], published=["2026-05"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V36 | ui/league-data.js:78 (semiconductor_fab_expansion) | cond: 조건부 유치(피크 부하 제한) / 수요 증가폭 ×0.5, 사건 지원금 ×0.6 | 비용 0억; 실제 {"option":"cond","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.04},"bonus":9,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V37 | ui/league-data.js:78 (semiconductor_fab_expansion) | hold: 유치 보류 / 수요도 세수도 없다 | 비용 0억; 실제 {"option":"hold","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1},"bonus":0,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V38 | ui/league-data.js:79 (datacenter_siting) | text: AI 데이터센터 입주! 밤낮없이 전기 수요가 늘고 지원금이 들어와요. | effect={"demandMul":1.06,"budgetAdd":10}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.06},"bonus":10,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V39 | ui/league-data.js:79 (datacenter_siting) | why: 2022년 말 국내 데이터센터 147곳 가운데 약 60%가 수도권에 있고, 앞으로 새로 생길 데이터센터 전력 수요의 약 80%도 수도권에 몰릴 것으로 전망됐다(산업부, 2023). | 관측/계획 근거(엔진 입력 아님); asOf=["2022-12"], published=["2023-03"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V40 | ui/league-data.js:79 (datacenter_siting) | cond: 조건부 유치(부하 제한·폐열 공유) / 수요 증가폭 ×0.5, 사건 지원금 ×0.6 | 비용 0억; 실제 {"option":"cond","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1.03},"bonus":6,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V41 | ui/league-data.js:79 (datacenter_siting) | hold: 유치 보류 / 수요도 지원금도 없다 | 비용 0억; 실제 {"option":"hold","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"demandMul":1},"bonus":0,"down":[]} | 예 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V42 | ui/league-data.js:80 (planned_maintenance) | text: 피크 대비 정비 기간! LNG·석탄 발전 출력이 줄어요. | effect={"lngCapMul":0.7,"coalCapMul":0.85}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"coalCapMul":0.85,"lngCapMul":0.7},"bonus":0,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V43 | ui/league-data.js:80 (planned_maintenance) | why: 발전기는 수요가 낮은 봄·가을에 계획예방정비 일정을 모아 잡으며(원전은 정해진 주기로 정기검사를 받는다), 이 시기에는 공급능력이 낮아진다. | 관측/계획 근거(엔진 입력 아님); asOf=null, published=null; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V44 | ui/league-data.js:80 (planned_maintenance) | resched: 정비 일정 나눠 하기 / 이번 라운드 출력 감소를 줄여요 | 비용 2억; 실제 {"option":"resched","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"coalCapMul":0.925,"lngCapMul":0.85},"bonus":0,"down":[]} | 예 | 해소(0777730) | probe effect·대응·bonus 계산 + 소스 |
| V45 | ui/league-data.js:81 (coal_phaseout) | text: 탈석탄 전환! 석탄 출력이 줄고 전환 지원금이 들어와요. | effect={"coalCapMul":0.8,"budgetAdd":10}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"coalCapMul":0.8},"bonus":10,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V46 | ui/league-data.js:81 (coal_phaseout) | why: 태안화력 1호기가 2025년 12월 31일 가동을 종료했다. 정부는 2025년 11월 탈석탄동맹(PPCA) 가입을 발표하고 2040년 석탄발전 폐지를 목표로 한다고 밝혔으며(기후에너지환경부), 당진화력 1~4호기는 2030년까지 전환 대상이다(산업부, 2024). | 관측/계획 근거(엔진 입력 아님); asOf=["2025-12"], published=["2024-12","2025-11"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V47 | ui/league-data.js:81 (coal_phaseout) | tip: 지원금은 들어오지만 석탄 출력이 줄어든다 | effect={"coalCapMul":0.8,"budgetAdd":10}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"coalCapMul":0.8},"bonus":10,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V48 | ui/league-data.js:82 (re100_buyer) | text: RE100 기업의 재생전기 구매! 예산이 늘고 탄소비용이 붙어요. | effect={"budgetAdd":12,"carbonTaxOn":true}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"tax":true},"bonus":12,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V49 | ui/league-data.js:82 (re100_buyer) | why: 2021년 본격 도입된 한국형 RE100(K-RE100)으로 기업이 녹색프리미엄·REC·제3자 PPA·자가발전으로 재생에너지를 조달할 수 있게 됐다. | 관측/계획 근거(엔진 입력 아님); asOf=null, published=["2021-01"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V50 | ui/league-data.js:82 (re100_buyer) | tip: 탄소 비용이 붙는다 — 재생 비중을 높이면 덜 낸다 | effect={"budgetAdd":12,"carbonTaxOn":true}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0,"tax":true},"bonus":12,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V51 | ui/league-data.js:83 (regional_tariff) | text: 사건 기간 산업용 전기요금이 낮아져 기업 입지 여건이 좋아져요. | effect={"industryPriceMul":0.92}; 실제 {"option":"none","mods":{"essCap":0.9,"hydroMonth":1,"reCap":{},"curtailP":0},"bonus":0,"down":[]} | 해당 없음 | 일치 | probe effect·대응·bonus 계산 + 소스 |
| V52 | ui/league-data.js:83 (regional_tariff) | why: 분산에너지 활성화 특별법(2024.6 시행)에 따라 정부는 2026년 산업용 지역별 차등요금 설계안을 공개했으며, 비수도권은 최대 10% 인하하는 방안이다. | 관측/계획 근거(엔진 입력 아님); asOf=null, published=["2026-08"]; 자료시점/발표 분리 | 해당 없음 | 일치 | probe 16개 sourceHTML 전달·소스(외부 원문 미확인) |
| V53 | ui/league.js:3727 | 사건 크기·예보→확정 | VM evSize 16건; modsFor는 1+(effect−1)×x×dev; 표시는 대응 전 크기 | 예 | 일치 | 30 + probe/소스 |
| V54 | ui/league.js:3727 | 우리 대응 후 확정 효과 | dev가 있고 knobs 없을 때 evSize 호출; 제설은 특정 손잡이라 수치 후표시 생략 | 예 | 일치 | 30 + probe/소스 |
| V55 | ui/league.js:3757 | 사건자료·출처·자료시점·발표·크기G | asOf ISO구간 /→~; null은 자료시점 없음. published 별도 발표. why 연도추출 폐기 | 해당 없음 | 일치 | 30 + probe/소스 |
| V56 | ui/league.js:3727 | 해당 설비 없어 우리 발전 영향 없음(이웃 거래 가능) | effect 키 전부 EVENT_KINDS인 경우 네트워크 kinds 확인; 현재 계획/운영 계획만 | 해당 없음 | 일치 | 30 + probe/소스 |
| V57 | ui/league.js:3727 | 현상 근거 O/O*/P/M, 크기·대응 G | grade·effect 분리. 외부 원문을 이번 감사에서 검증한 뜻 아님 | 해당 없음 | 일치 | 30 + probe/소스 |
| V58 | ui/econ.js:641; ui/econ-data.js intl.events | eu_indirect: 가상 결정: 철강 수출에 전력 탄소도 반영해요 | {"eu_indirect":1}; econ intlStep/outIdx | 예 | 일치 | probe 원장 + intlStep/outIdx 소스 |
| V59 | ui/econ.js:641; ui/econ-data.js intl.events | ship_red: 항구가 있는 도시의 물류 여건과 산업 산출이 줄어요(물류비 지출은 따로 계산하지 않아요) | ship−.3은 항만 logi/out 감소. 별도 물류비 지출 없음이라고 문구에 명시 | 예 | 근사 표시 보완(0777730) | probe 원장 + intlStep/outIdx 소스 |
| V60 | ui/econ.js:641; ui/econ-data.js intl.events | lng_spike: LNG 연료비가 가장 크게 오르고 디젤·석탄도 올라요 (옛 문장 'LNG·디젤 연료비가 크게 올라요'는 석탄 누락 — 10-25 독립 검토가 찾아 아르곤 문구로 고침) | lng+0.5, fx 동시지수로 fuelMul; 디젤·석탄 fuelMul^.6(league-core.js:904); econ intlStep/outIdx | 예 | 해소(10-25) | probe 문장·소스 단언 |
| V61 | ui/econ.js:641; ui/econ-data.js intl.events | export_boom: 반도체 도시 산출이 늘어요 | {"export":{"semi":0.25,"display":0.1}}; econ intlStep/outIdx | 예 | 일치 | probe 원장 + intlStep/outIdx 소스 |
| V62 | ui/econ.js:641; ui/econ-data.js intl.events | auto_slump: 자동차 도시 산출이 줄어요 | {"export":{"auto":-0.2}}; econ intlStep/outIdx | 예 | 일치 | probe 원장 + intlStep/outIdx 소스 |
| V63 | ui/econ.js:641; ui/econ-data.js intl.events | cbam: 철강 비중과 수출 비중에 따라 산출이 깎여요(EU 몫은 모든 도시 같음, 단계 도입, 공정별 직접배출 차이는 생략한 근사) | steel비중×exportShare×cbamEuShare×cbamDrop×phase×eduCbam; 공통EU몫·직접배출 차이 생략한 근사 명시 | 예 | 해소(0777730) | probe 원장 + intlStep/outIdx 소스 |

### 기술 카드 효과

| ID | 현재 위치 | 현재 화면 문장/설명(요약) | 실제 계산·조건 | 자료 | 판정 | 이번 근거 |
|---|---|---|---|---|---|---|
| T01 | ui/tech-data.js:87; ui/league.js:764 | grid eff: 송전 손실 0.50%/칸 → 0.33%/칸 / 리그: 송전 손실 0.50%/칸 → 0.33%/칸 | PK.lossPerHex=.005; ×2/3=.0033333333; build.js | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T02 | ui/tech-data.js:88; ui/league.js:764 | hvdc eff: 연계선 용량 ×1.5로 송전 용량을 늘리고 계통 제약을 푼다, 새 선 건설비 ×1.3 / 리그: 연계선 용량 ×1.5로 송전 용량을 늘리고 계통 제약을 푼다, 새 선 건설비 ×1.3 | hvdcCap=1.5, hvdcCost=1.3, hvdcLoss=.01; effectiveTie: 4→6 MW; core | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T03 | ui/tech-data.js:89; ui/league.js:764 | scable eff: 연계선 용량 ×1.5, 손실 ×0.5, 냉각 월 0.5억/선 / 리그: 연계선 용량 ×1.5, 손실 ×0.5, 냉각 0.5억/선/달 | scableCap=1.5, scableLoss=.5, cooling=.5; 4→6 MW, .01→.005; 양끝 도입 시 .25씩; core | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T04 | ui/tech-data.js:90; ui/league.js:764 | sic eff: 재생 출력 ×1.015 / 리그: 재생 출력 ×1.015 | sicOutput=1.015; core; 실제 61.24896431→62.16769877 MWh | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T05 | ui/tech-data.js:91; ui/league.js:764 | bms eff: 잔량 하한 10% → 5% · 왕복 효율 85% → 87%(한 방향 약 93.3%) / 리그: 잔량 하한 10% → 5% · 왕복 효율 85% → 87%(한 방향 약 93.3%) | bmsFloor=.05; bmsEfficiency=.933; M.batEff=.922; 왕복 .850084→.870489 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T06 | ui/tech-data.js:92; ui/league.js:764 | tandem eff: 새 탠덤 태양광 출력 ×1.2, 건설비 ×1.2 / 리그: 새 탠덤 태양광 출력 ×1.2, 건설비 ×1.2 | tandemOutput=tandemCost=1.2; build; 출력 61.24896431→73.49875717 MWh, 비용 8→9.6 | 예 | 해소(0777730) | 10·33·34·42 + probe 값/출력 |
| T07 | ui/tech-data.js:93; ui/league.js:764 | nbat eff: 새 배터리 용량 ×1.25 / 리그: 새 배터리 용량 20 MWh(×1.25) | nbatCapacity=1.25; 16×1.25=20MWh(명판 용량. 리그의 essCap 0.9 상한으로 실제 저장 상한은 18MWh이며 기존 16MWh에도 같은 상한이 걸림, build.js:655); 원본·리그 모두 화재 면역 서술 제거 | 예 | 해소(0777730·be73d18) | 10·33·34·42 + probe 값/출력 |
| T08 | ui/tech-data.js:94; ui/league.js:764 | mass eff: 새 태양광·배터리 건설비 ×0.92 / 리그: 새 태양광·배터리 건설비 ×0.92 | massCost=.92; core 새 solar/roof/tandem/tandem_roof/battery/nbat paidCost에만 적용 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T09 | ui/tech-data.js:95; ui/league.js:764 | h2store eff: 200 MWh 장주기 저장, 왕복 35% / 리그: 200 MWh 저장, 왕복 35% | h2MWh=200, efficiency=.35; 57.88027127→20.25809495 MWh, 빈 탱크 시작; build | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T10 | ui/tech-data.js:96; ui/league.js:764 | h2mix eff: 연결된 수소가 남아 있을 때 LNG CO₂ 최대 12% 감소 / 리그: 연결된 수소가 남아 있을 때 LNG CO₂ 최대 12% 감소 | h2Co2=.88; 같은 망 남은 수소를 방전 한도 내 쓸 때 최대12% CO₂감소. 없으면0 | 예 | 해소(0777730·be73d18) | 10·33·34·42 + probe 값/출력 |
| T11 | ui/tech-data.js:97; ui/league.js:764 | ccu eff: 석탄 CO₂ ×0.4, 출력 ×0.79 / 리그: 석탄 CO₂ ×0.4, 출력 ×0.79 | ccuCo2=.4, ccuOutput=.79; core; 실제 석탄 출력×.79 | 예 | 해소(0777730) | 10·33·34·42 + probe 값/출력 |
| T12 | ui/tech-data.js:98; ui/league.js:764 | smr eff: 2.96 MW, 39.42억, 건설 12턴 / 리그: 2.957 MW, 39.42억, 공사 12달 | smrMW=680/230=2.956521739, cost=39.420289855, turns=12; build | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T13 | ui/tech-data.js:99; ui/league.js:764 | fcst eff: 저녁 피크에 저장을 남기고 사건 예보 폭 최대 0.7배(원래 범위 안으로 자름) / 리그: 저녁 피크에 저장을 남기고 사건 예보 폭 최대 0.7배(원래 범위 안으로 자름) | fcstWidth=.7은 clipping 전 반폭 계수; 최대0.7배·원래 범위 안으로 자름 명시 | 예 | 근사 표시 보완(0777730) | 10·33·34·42 + probe 값/출력 |
| T14 | ui/tech-data.js:100; ui/league.js:764 | vpp eff: 수요반응 ×1.5·비용 ×0.5, 출력제어 손실 ×0.8 / 리그: 수요반응 ×1.5·비용 ×0.5, 출력제어 손실 ×0.8 | drEffect=1.5, drCost=.5, vppCurtail=.8; core; build demand/정책비 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T15 | ui/tech-data.js:101; ui/league.js:764 | re100 eff: 정책 선택 시 산업 매력 재생 항 가중 ×1.5 / 리그: 정책 선택 시 산업 매력의 재생 항목 가중 ×1.5 | ECON_DATA.re100PolicyWeight=1.5; industryAttract 재생 가중만 ×1.5, 정규화 후 평가 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T16 | ui/tech-data.js:87; ui/league.js:764 | grid why: 선로 상태를 살펴 전기를 보낼 때의 손실을 줄여요. | PK.lossPerHex=.005; ×2/3=.0033333333; build.js | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T17 | ui/tech-data.js:88; ui/league.js:764 | hvdc why: 짧은 거리에서는 변환소 손실 때문에 손실 개선을 기대하지 않아요. | hvdcCap=1.5, hvdcCost=1.3, hvdcLoss=.01; effectiveTie: 4→6 MW; core | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T18 | ui/tech-data.js:89; ui/league.js:764 | scable why: 저항은 작아져도 냉각 전력과 비용이 들어요. | scableCap=1.5, scableLoss=.5, cooling=.5; 4→6 MW, .01→.005; 양끝 도입 시 .25씩; core | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T19 | ui/tech-data.js:90; ui/league.js:764 | sic why: 같은 햇빛과 바람에서 변환 손실을 줄여요. | sicOutput=1.015; core; 실제 61.24896431→62.16769877 MWh | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T20 | ui/tech-data.js:91; ui/league.js:764 | bms why: 배터리 잔량을 더 정확히 읽어 저장한 전기를 넓게 써요. | bmsFloor=.05; bmsEfficiency=.933; M.batEff=.922; 왕복 .850084→.870489 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T21 | ui/tech-data.js:92; ui/league.js:764 | tandem why: 기존 패널은 바뀌지 않아요. | tandemOutput=tandemCost=1.2; build; 출력 61.24896431→73.49875717 MWh, 비용 8→9.6 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T22 | ui/tech-data.js:93; ui/league.js:764 | nbat why: 새 배터리는 더 많이 저장하며, 잔량 관리에는 상태 진단 기술이 필요해요. | nbatCapacity=1.25; 16×1.25=20; build. 화재 사건/피해 상태/면역 분기 없음 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T23 | ui/tech-data.js:94; ui/league.js:764 | mass why: 시장 전체의 가격 하락을 한 도시의 연구 성과로 보지는 않아요. | massCost=.92; core 새 solar/roof/tandem/tandem_roof/battery/nbat paidCost에만 적용 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T24 | ui/tech-data.js:95; ui/league.js:764 | h2store why: 많이 저장하지만 손실이 크고 처음에는 비어 있어요. | h2MWh=200, efficiency=.35; 57.88027127→20.25809495 MWh, 빈 탱크 시작; build | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T25 | ui/tech-data.js:96; ui/league.js:764 | h2mix why: 부피 비율과 열량 비율은 달라요. | h2Co2=.88은 상한; build 남은 연결 수소만 사용. 수소 없으면 LNG CO₂ ×1 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T26 | ui/tech-data.js:97; ui/league.js:764 | ccu why: 포집에도 전기가 들어요. | ccuCo2=.4, ccuOutput=.79; core; 실제 석탄 출력×.79 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T27 | ui/tech-data.js:98; ui/league.js:764 | smr why: 수업 시간에 맞춰 공사 기간을 줄였어요. 실제 인허가 기간과는 달라요. | smrMW=680/230=2.956521739, cost=39.420289855, turns=12; build | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T28 | ui/tech-data.js:99; ui/league.js:764 | fcst why: 예측은 날씨를 바꾸지 않아요. | fcstWidth=.7; core 범위 clipping, build 저녁 저장 예약 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T29 | ui/tech-data.js:100; ui/league.js:764 | vpp why: 효과 크기는 수업을 위한 가정이에요. | drEffect=1.5, drCost=.5, vppCurtail=.8; core; build demand/정책비 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T30 | ui/tech-data.js:101; ui/league.js:764 | re100 why: 재생 전기가 부족하면 기업이 이 도시를 고를 매력이 낮아져요. | ECON_DATA.re100PolicyWeight=1.5; industryAttract 재생 가중만 ×1.5, 정규화 후 평가 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T31 | ui/tech-data.js:87; ui/league.js:764 | grid 필요 연구량 8 / 실증 4억 | TECH_DATA.cards.grid.need=8, demo=4; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T32 | ui/tech-data.js:88; ui/league.js:764 | hvdc 필요 연구량 12 / 실증 4억 | TECH_DATA.cards.hvdc.need=12, demo=4; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T33 | ui/tech-data.js:89; ui/league.js:764 | scable 필요 연구량 24 / 실증 10억 | TECH_DATA.cards.scable.need=24, demo=10; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T34 | ui/tech-data.js:90; ui/league.js:764 | sic 필요 연구량 9 / 실증 3억 | TECH_DATA.cards.sic.need=9, demo=3; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T35 | ui/tech-data.js:91; ui/league.js:764 | bms 필요 연구량 6 / 실증 3억 | TECH_DATA.cards.bms.need=6, demo=3; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T36 | ui/tech-data.js:92; ui/league.js:764 | tandem 필요 연구량 12 / 실증 5억 | TECH_DATA.cards.tandem.need=12, demo=5; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T37 | ui/tech-data.js:93; ui/league.js:764 | nbat 필요 연구량 24 / 실증 10억 | TECH_DATA.cards.nbat.need=24, demo=10; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T38 | ui/tech-data.js:94; ui/league.js:764 | mass 필요 연구량 18 / 실증 8억 | TECH_DATA.cards.mass.need=18, demo=8; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T39 | ui/tech-data.js:95; ui/league.js:764 | h2store 필요 연구량 18 / 실증 8억 | TECH_DATA.cards.h2store.need=18, demo=8; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T40 | ui/tech-data.js:96; ui/league.js:764 | h2mix 필요 연구량 12 / 실증 6억 | TECH_DATA.cards.h2mix.need=12, demo=6; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T41 | ui/tech-data.js:97; ui/league.js:764 | ccu 필요 연구량 18 / 실증 10억 | TECH_DATA.cards.ccu.need=18, demo=10; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T42 | ui/tech-data.js:98; ui/league.js:764 | smr 필요 연구량 36 / 실증 20억 | TECH_DATA.cards.smr.need=36, demo=20; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T43 | ui/tech-data.js:99; ui/league.js:764 | fcst 필요 연구량 6 / 실증 2억 | TECH_DATA.cards.fcst.need=6, demo=2; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T44 | ui/tech-data.js:100; ui/league.js:764 | vpp 필요 연구량 12 / 실증 4억 | TECH_DATA.cards.vpp.need=12, demo=4; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T45 | ui/tech-data.js:101; ui/league.js:764 | re100 필요 연구량 12 / 실증 4억 | TECH_DATA.cards.re100.need=12, demo=4; numbers 복제 값 같음; core·연구 처리 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T46 | ui/tech-data.js:167; ui/league.js:742 | grid 유레카: 내부 송전선 설치 | core.eurekaMet(ui/league-core.js:274~): plan.lines.length&gt;0(실제 통전 여부를 요구하지 않음) | 해당 없음 | 해소(0777730) | 10·33·34·42 + probe 값/출력 |
| T47 | ui/tech-data.js:167; ui/league.js:742 | hvdc 유레카: 연계선 2개 연결 | core.eurekaMet(ui/league-core.js:274~): connectedTie 2개 이상 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T48 | ui/tech-data.js:167; ui/league.js:742 | scable 유레카: HVDC 연계선 건설 완료 | core.eurekaMet(ui/league-core.js:274~): built hvdc선 있음(내부 연결 여부는 추가 검사 안 함) | 해당 없음 | 해소(0777730) | 10·33·34·42 + probe 값/출력 |
| T49 | ui/tech-data.js:167; ui/league.js:742 | sic 유레카: 재생 발전 운영 | core.eurekaMet(ui/league-core.js:274~): result.renPct&gt;0 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T50 | ui/tech-data.js:167; ui/league.js:742 | bms 유레카: 배터리 운영 | core.eurekaMet(ui/league-core.js:274~): 통전 battery/nbat 존재 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T51 | ui/tech-data.js:167; ui/league.js:742 | tandem 유레카: 태양광 10기 운영 | core.eurekaMet(ui/league-core.js:274~): 통전 태양광류&gt;=10 AND renPct&gt;0 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T52 | ui/tech-data.js:167; ui/league.js:742 | nbat 유레카: BMS 도입 후 배터리 운영 | core.eurekaMet(ui/league-core.js:274~): bms 도입 AND 통전 battery/nbat | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T53 | ui/tech-data.js:167; ui/league.js:742 | mass 유레카: 탠덤 또는 차세대 배터리 운영 | core.eurekaMet(ui/league-core.js:274~): 통전 tandem/tandem_roof/nbat | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T54 | ui/tech-data.js:167; ui/league.js:742 | h2store 유레카: 출력제어 발생 | core.eurekaMet(ui/league-core.js:274~): curtailMWh&gt;0 OR 출력제어 사건+renPct&gt;0 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T55 | ui/tech-data.js:167; ui/league.js:742 | h2mix 유레카: 수소 탱크 운영 | core.eurekaMet(ui/league-core.js:274~): 통전 h2store | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T56 | ui/tech-data.js:167; ui/league.js:742 | ccu 유레카: 석탄 발전 운영 | core.eurekaMet(ui/league-core.js:274~): 통전 coal AND co2Prod&gt;0 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T57 | ui/tech-data.js:167; ui/league.js:742 | smr 유레카: 지지율이 시작보다 5%p 넘게 떨어지지 않음 또는 시위 없음 | core.eurekaMet(ui/league-core.js:274~): approval&gt;=approval0−5 OR !unrest | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T58 | ui/tech-data.js:167; ui/league.js:742 | fcst 유레카: 폭염 사건 경험 | core.eurekaMet(ui/league-core.js:274~): 현재 heatwave_peak 존재 | 해당 없음 | 일치 | 10·33·34·42 + probe 값/출력 |
| T59 | ui/tech-data.js:167; ui/league.js:742 | vpp 유레카: 수요반응 정책 3달 운영 | core.eurekaMet(ui/league-core.js:274~): rs.drMonths&gt;=3 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T60 | ui/tech-data.js:167; ui/league.js:742 | re100 유레카: 재생 비중 30% 이상 운영 | core.eurekaMet(ui/league-core.js:274~): renPct&gt;=30 | 예 | 일치 | 10·33·34·42 + probe 값/출력 |
| T61 | ui/tech-data.js:105; ui/league.js:753 | hvdc 교육용 배속·비교 기준: 현실 비교값 없음 · 국내 사례의 목적은 계통 제약 해소 | scale.v=null; 비교 원자료 null; 증가폭 비율은 엔진 효과와 별도 | 해당 없음 | 근사 표시 있음 | probe scale + 소스 |
| T62 | ui/tech-data.js:112 | scable 교육용 배속·비교 기준: 송전 용량 증가폭: 기존의 5배 | scale.v=0.125; 비교 원자료 {"multiplier":5}; baseline·비율 분모는 comparisonReferences 공유; 비율은 엔진 효과와 별도 | 예 | 근사 표시 있음 | probe scale + 소스 + E3 바이트 동일·공유값 변형 |
| T63 | ui/tech-data.js:112 | tandem 교육용 배속·비교 기준: 모듈 효율 증가폭: 일반 22% → 탠덤 26.9% | scale.v=0.8979591836734695; 비교 원자료 {"from":22,"to":26.9,"unit":"%"}; baseline·비율 분모는 comparisonReferences 공유; 비율은 엔진 효과와 별도 | 예 | 근사 표시 있음 | probe scale + 소스 + E3 바이트 동일·공유값 변형 |
| T64 | ui/tech-data.js:112 | nbat 교육용 배속·비교 기준: 셀 에너지 밀도 증가폭 40%(팩 용량과 직접 같지 않아요) | scale.v=0.625; 비교 원자료 {"increase":0.4}; baseline·비율 분모는 comparisonReferences 공유; 비율은 엔진 효과와 별도 | 예 | 근사 표시 있음 | probe scale + 소스 + E3 바이트 동일·공유값 변형 |
| T65 | ui/tech-data.js:112 | h2store 교육용 배속·비교 기준: 왕복 효율 30~40%의 가운데 값 35% | scale.v=1; 비교 원자료 {"range":[0.3,0.4],"midpoint":0.35}; baseline·비율 분모는 comparisonReferences 공유; 비율은 엔진 효과와 별도 | 예 | 근사 표시 있음 | probe scale + 소스 + E3 바이트 동일·공유값 변형 |
| T66 | ui/tech-data.js:112 | h2mix 교육용 배속·비교 기준: 수소 30 vol% 혼소의 열량 환산 CO₂ 감소 12%(M) | scale.v=1; 비교 원자료 {"reduction":0.12,"grade":"M"}; baseline·비율 분모는 comparisonReferences 공유; 비율은 엔진 효과와 별도 | 예 | 근사 표시 있음 | probe scale + 소스 + E3 바이트 동일·공유값 변형 |
| T67 | ui/tech-data.js:112 | ccu 교육용 배속·비교 기준: 포집률 상단 90% | scale.v=0.6666666666666666; 비교 원자료 {"capture":0.9}; baseline·비율 분모는 comparisonReferences 공유; 비율은 엔진 효과와 별도 | 예 | 근사 표시 있음 | probe scale + 소스 + E3 바이트 동일·공유값 변형 |
| T68 | ui/tech-data.js:18; ui/league.js:764 | HVDC 출처 note: 용량×1.5·현실 비교값 없음 | hvdcCap=1.5, loss=.01(기본과 같음), note 직접 출력 | 예 | 일치 | 소스 대조 |
| T69 | ui/tech-data.js:163; ui/league.js:3727 | 예측·VPP 있으면 폭염 피해 줄음 | fcst 저장 예약; vpp는 demandMul=1+.12×.7=1.084; fcst는 수요 자체를 줄이지 않음 | 해당 없음 | 일치 | 소스 대조 |
| T70 | ui/tech-data.js:163; ui/league.js:3727 | 초전도 있으면 태풍 연계선 단절 막음 | core: 태풍 단독 원인·해당 선 끝 도입 시 shield | 해당 없음 | 일치 | 소스 대조 |
| T71 | ui/league.js:764 | 이전 필요량·사용료·한도 | licenseNeed=.5; royalty=.5; royaltyMonths=6; royaltyCap=3; core 연구 처리 | 예 | 일치 | 10 + 소스 |
| T72 | ui/league.js:764 | 공동 실증비 | jointShare=.5; core 연구 처리 | 예 | 일치 | 10 + 소스 |
| T73 | ui/league.js:764 | 유레카 추가 진척 | eurekaFrac=1/3; core 연구 처리 | 예 | 일치 | 10 + 소스 |
| T74 | ui/league.js:690 | 칭호 필요 도입 카드 수 | titleGrid=3,titleOther=2,titleSingle=1; core 연구 처리 | 예 | 일치 | 10 + 소스 |

### 집단 만족 이유

| ID | 현재 위치 | 현재 화면 문장/설명(요약) | 실제 계산·조건 | 자료 | 판정 | 이번 근거 |
|---|---|---|---|---|---|---|
| G1 | ui/league.js:667; ui/econ.js:544 | worker 만족도 목표 항목 막대 | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=1; 지연·별도 감점 전 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G2 | ui/league.js:667; ui/econ.js:544 | youth 만족도 목표 항목 막대 | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=1; 지연·별도 감점 전 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G3 | ui/league.js:667; ui/econ.js:544 | senior 만족도 목표 항목 막대 | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=0.9999999999999999; 지연·별도 감점 전 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G4 | ui/league.js:667; ui/econ.js:544 | business 만족도 목표 항목 막대 | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=1; 지연·별도 감점 전 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G5 | ui/league.js:667; ui/econ.js:544 | farm 만족도 목표 항목 막대 | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=1; 지연·별도 감점 전 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G6 | ui/league.js:667; ui/econ.js:544 | green 만족도 목표 항목 막대 | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=0.9999999999999999; 지연·별도 감점 전 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G7 | ui/league.js:667; ui/econ.js:544 | rel 앞으로 반영될 변화 | lagRate .5; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G8 | ui/league.js:667; ui/econ.js:544 | price 앞으로 반영될 변화 | lagRate .5; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G9 | ui/league.js:667; ui/econ.js:544 | jobs 앞으로 반영될 변화 | lagRate .5; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G10 | ui/league.js:667; ui/econ.js:544 | svc 앞으로 반영될 변화 | lagRate .15; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G11 | ui/league.js:667; ui/econ.js:544 | crowd 앞으로 반영될 변화 | lagRate .15; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G12 | ui/league.js:667; ui/econ.js:544 | air 집단 기여 이름·점수 | lagL.air 대신 즉시 교육용 점수 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G13 | ui/league.js:667; ui/econ.js:544 | tax 집단 기여 이름·점수 | taxSatisfaction | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G14 | ui/league.js:667; ui/econ.js:544 | taxI 집단 기여 이름·점수 | taxSatisfaction(policy.taxInd) | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G15 | ui/league.js:667; ui/econ.js:544 | A 집단 기여 이름·점수 | C.A | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G16 | ui/league.js:667; ui/econ.js:544 | out 집단 기여 이름·점수 | outMin=.5,outMax=1.2 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G17 | ui/league.js:667; ui/econ.js:544 | ren 집단 기여 이름·점수 | reTarget=50, renS .15 지연 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G18 | ui/league.js:667; ui/econ.js:544 | co2 집단 기여 이름·점수 | carbonScore(C,data) | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G19 | ui/league.js:844 | 지지율 전체 변화 이유; ‘민원(입지 m개 포함)이 깎는 몫: 지금 now%p · 다 반영되면 final%p’(혼합) | approvalChangeCause(causes[0]); 집단 비중×회복(.152)/하락(1)×기여차. 민원 몫은 Σ(shares[g]×groupOwnLag[g].complaint)와 Σ(shares[g]×groupOwn[g].complaint)를 구별하며 이미 반영된 지지 민감도를 다시 곱하지 않음 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G20 | ui/league.js:667; ui/econ.js:544 | 최저 만족 집단 불만 | lowestGroupDissatisfaction; 월 변화와 별개, 모형 추정 | 예 | 근사 표시 있음 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G21 | ui/league.js:667; ui/econ.js:544 | 집단 비중·만족 | groupKeys 6개 각각 c.groups[k], share, 0~100 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G22 | ui/league.js:667; ui/econ.js:544 | 지지율 평가선 | approvalRelative=(현재−시작)−참가도시 평균변화; approvalDrop=10 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G23 | ui/league.js:667; ui/econ.js:544 | 평가 간격·다음 평가 | reviewEvery=12; 평가 달 report.review.pass 우선 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G24 | ui/league.js:667; ui/econ.js:544 | 정책 주민세 | resTax×(1+.25×taxRes), livability tax=60−10×상대세율 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G25 | ui/league.js:667; ui/econ.js:544 | 정책 산업세 | indTax×(1+.25×taxInd), industryAttract tax=60−10×상대세율 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G26 | ui/league.js:667; ui/econ.js:544 | 정책 공공서비스 | serviceCurve=[−27,−20,0,10,14], svcStep=.25 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G27 | ui/league.js:667; ui/econ.js:544 | 정책 유치 보조 | inc=100(1−exp(−보조/(.2×ind/10000))); 월 지출 incentive | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G28 | ui/league.js:667; ui/econ.js:544 | 절전 캠페인 | M.save=.05, saveSatPenalty=5 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G29 | ui/league.js:667; ui/econ.js:544 | 주민 이익공유 | shareRelief=.5; noise/view+wind/offshore/solar만 완화, 실제 민원 건수 전체 절반 아님 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G30 | ui/econ.js:468; ui/league.js:673 | L.rel: 정전이 잦아서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G31 | ui/econ.js:468; ui/league.js:673 | L.price: 전기요금이 비싸서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G32 | ui/econ.js:468; ui/league.js:673 | L.air: 공기가 나빠서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G33 | ui/econ.js:468; ui/league.js:673 | L.jobs: 일자리가 적어서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G34 | ui/econ.js:468; ui/league.js:673 | L.svc: 공공서비스가 부족해서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G35 | ui/econ.js:468; ui/league.js:673 | L.tax: 세금이 무거워서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G36 | ui/econ.js:468; ui/league.js:673 | L.crowd: 집값이 올라서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G37 | ui/econ.js:468; ui/league.js:673 | A.rel: 전력이 불안해서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G38 | ui/econ.js:468; ui/league.js:673 | A.price: 전기값이 비싸서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G39 | ui/econ.js:468; ui/league.js:673 | A.re: 재생에너지가 모자라서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G40 | ui/econ.js:468; ui/league.js:673 | A.labor: 인력이 부족해서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G41 | ui/econ.js:468; ui/league.js:673 | A.talent: 인재가 적어서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G42 | ui/econ.js:468; ui/league.js:673 | A.logi: 물류가 불편해서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G43 | ui/econ.js:468; ui/league.js:673 | A.tax: 세금이 무거워서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G44 | ui/econ.js:468; ui/league.js:673 | A.inc: 유치 보조가 적어서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G45 | ui/econ.js:468; ui/league.js:673 | A.land: 산업 용지가 모자라서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G46 | ui/econ.js:468; ui/league.js:673 | A.carbon: 전력 탄소가 많아서 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 29-r3·34 + probe 가중합/원인키 + 소스 |
| G47 | ui/league.js:673 | A에서 B보다 시작 대비 변화로 볼 때 … | causeOf의 시작 대비 개선 차이를 migrationReason도 명시. 현재 A70>B40라도 시작80/40이면 A의악화−10이 원인 | 해당 없음 | 해소(be73d18) | 29-r3·34 + probe 가중합/원인키 + 소스 |

## D-87 추가 8항목

| ID | 범주 | 현재 위치 | 화면 문장 | 실제 계산·조건 | 자료 | 판정 | 이번 근거 |
|---|---|---|---|---|---|---|---|
| D01 | 사건 출처 | ui/econ-data.js:20; ui/league.js:87; ui/build.js:2747 | 석탄 신규 건설: 정부 목표2040, 계획에 없는 새 건설을 비교용으로 가정 | hypothetical=true, phaseoutTargetYear=2040; 리그 coal 도구 허용. 자동 폐지 연도 계산은 없음(역사/가정 안내) | 해당 없음 | 일치 | probe facts + 45/소스 |
| D02 | 배속표 | ui/econ-data.js:21; ui/league.js:385 | 석탄1040MW·2018-03→2022-11 약56개월·게임 즉시 가동(SMR만12달) | (2022−2018)×12+11−3=56; gameTurns=0; 게임MW=1040/230=4.521739. core construction은 SMR만 생성 | 예 | 일치 | probe 날짜/용량 + 38·45/소스 |
| D03 | 배속표 | ui/econ-data.js:22; ui/league.js:385 | LNG561MW·2022-11→2025-06 약31개월(계획)·게임 즉시 가동 | (2025−2022)×12+6−11=31; status=planned, gameTurns=0; 게임MW=561/230=2.439130 | 예 | 일치 | probe 날짜/용량 + 45/소스 |
| D04 | 원인 분해 | ui/econ-data.js:23; ui/build.js:2747 | 건설비 !: 2023 연구 LNG1275·석탄1809달러/kW; 게임 돈 환산비는 G | cost=(realMW/230)×(smrCostBase7.5/smrCapexBase4500)×thermalCapex; 석탄13.633043억·LNG5.183152억 | 해당 없음 | 일치 | probe 원자료/params/BLD + 45 |
| D05 | 공기 주석 | ui/econ-data.js:24; ui/build.js:2747 | 미세먼지 !: 석탄 .120→.044·LNG .015→.007kg/MWh; 신규는 각 평균 약37%·47%, 동네 농도 아님 | 석탄 .044/.120=.366667; LNG .007/.015=.466667. pmNewFuelW는 coal1×ratio=.366667, lng.05×ratio=.0233333; 농도는 kPM·발전량으로 별도 계산 | 예 | 일치 | probe 비율 + 45 신구 분리 |
| D06 | 집단 만족 이유 | ui/econ-data.js:25; ui/build.js:2747 | 입지 민원 !: 석탄·LNG·SMR, 마을·병원·학교3칸 안; 5km 지원구역 근사, 안전거리 아님 | sitingWeights=[1,1,.6,.3], base10 → 거리1/2/3/4칸 10/6/3/0점. senior/youth 감점 min(20,score), 가동률 독립, 기존plant 제외 | 예 | 일치 | probe 거리/운전율 + 45·46/소스 |
| D07 | 원인 분해 | ui/build.js:3449; ui/build.js:3515 | 석탄·LNG·SMR 배치: 입지 민원+n건(예상·가동과 무관)·영향 주변 시설·마을n곳; 공통3칸 안내 | after.issues−before.issues, 영향시설=items.ti 집합. 단일수용자 거리1/2/3/4칸: 민원건수1/1/0/0, 영향시설1/1/1/0. 3칸의3점도 core가 경제cpList에 전달(건수≥5와 구별) | 예 | 일치 | probe placementAdvice + core.cp.items/groupTargets 소스 |
| D08 | 원인 분해 | ui/build.js:436 | 배치 거절: 냉각수: 해안·하천만 | siteRule: ["smr","lng","coal"] 공통, 타일이 river·beach가 아니면 거절(D-87이 SMR 전용에서 세 전원으로 넓힘). 공랭식 등 다른 냉각 방식은 게임 규칙에서 생략(G) | 해당 없음 | 일치 | probe 소스 단언 |

## D-90·집단 전용 항 후속 8항목 (2026-10-26)

범주는 위 합계표에 포함했다. 화면 문장의 기본값·의미를 유지하고 실제 renderer와 계산을 Node VM에서 대조했다. HUD는 원래 `syncMoney` 클로저를 같은 스코프에 노출하여 기존 DOM 노드 대역으로 실행했다. 화면 배치·터치·브라우저 실기를 검증한 결과는 아니다.

| ID | 범주 | 현재 위치 | 화면 문장 | 실제 계산·조건 | 자료 | 판정 | 이번 근거 |
|---|---|---|---|---|---|---|---|
| D09 | 사건 출처 | ui/econ-data.js disasterFacts.rain; ui/league.js evCards | 호우 카드 !: 장마 사건 때 절반 확률로 먹구름 대신, 자연재난, 피해·보수비는 게임 가정 | heavyRainShare=.5; drawParent=monsoon_cloud. 실제 drawEvents의 비율0/1에서 같은 추첨 한 자리를 대체하고 다른 사건·크기는 동일 | 예 | 일치 | probe D09: 카드 !·분기 양끝 추첨 대조 |
| D10 | 사건 출처 | ui/econ-data.js disasterFacts.heat.text; ui/league.js evCards | 폭염 !: 바깥 공기·패널 온도 증가로 LNG·일반 태양광 출력 감소, 온도차는 G | lngCapMul=1−heatLngSlope×heatAirDelta×x; solarHeatMul=1−heatPvSlope×heatModuleDelta×x. 대응은 수요만 완화 | 예 | 일치 | probe D10: 카드 출력·modsFor 실제 배수 |
| D11 | 사건 출처 | ui/econ-data.js disasterFacts.heat.limitation; ui/league.js evCards | 석탄·SMR·디젤·탠덤은 근거 값 미확보로 폭염 출력 감소 생략 | 폭염 전용 감소는 lngCapMul/solarHeatMul만 생성, coal/smr/diesel/tandem 전용 배수 없음. 실제 발전 적용은 52번 계약 검사 범위 | 해당 없음 | 일치 | probe D11: 카드 출력·제외 배수 부재 |
| D12 | 원인 분해 | ui/econ-data.js disasterFacts.repair; ui/league.js cityHTML | 보수비 !: 사건 달에 한 번, 크기에 비례, 대응은 호우 보수비만 감소, 금액은 G | repairOf는 월별 사건의 repairParam×x를 합산. 호우 inspect ×.8, 폭염 dr은 보수비 불변. fiscal.exp.repair를 도시 세출과 !에 표시 | 예 | 일치 | probe D12: 크기1/2·대응 비교·공개 상태→도시 세출 ! |
| D13 | 원인 분해 | ui/econ-data.js disasterFacts.grant; ui/league.js syncMoney·grantMoneyNote·evCards | 남은 특별교부세 n억: 새 설비·선로·재난 대응→월말 재난 보수비 우선→잔액 소멸; 돈 칩·사건 안내 | grantOf의 left를 돈 칩·!에 표시. disasterSettlementOf.repairUsed=min(left,교부대상 보수비), expired=left−repairUsed. 호우 카드도 사용 순서·소멸 안내 | 예 | 일치 | probe D13: 실제 HUD 클로저·사건 카드·정산 대조 |
| G48 | 집단 만족 이유 | ui/econ-data.js groupOwnCopy; ui/league.js groupCauseHTML | 민원 막대 최종 반영 n점 · 현재 반영 m점, 낭독도 같은 값 | 월 정산 groupOwn(지연 전 목표)·groupOwnLag(현재 groupContrib 반올림)를 구분. 목표0·잔여−1.52점도 표시 | 예 | 일치 | probe G48: 실제 monthStep→publicView→renderer, 회복 지연·0목표 |
| G49 | 집단 만족 이유 | ui/econ-data.js groupOwnCopy; ui/econ.js groupTargets; ui/league.js groupCauseHTML | 민원(입지 n건) / 민원 요인 n개 중 입지 m개 · 상한 cap점[에 걸림] / 민원(n건); 입지만·일반은 상한에 걸리면 ‘ · 상한 cap점에 걸림’ 추가 | 집단별 complaintGroups 해당 cpList 길이와 siting 부분집합. cap=params.complaintCap(20); 혼합은 REV9_COPY K8a/K8b, 입지만·일반은 groupOwnCopy 및 K8cap. 만족 목표 감점·민원 건수는 별개 | 예 | 일치 | 56 probe G49: 입지1·혼합2중1·일반1건 및 상한 도달, 실제 월 정산·문구표 조립 |
| G50 | 집단 만족 이유 | ui/econ.js groupTargets; ui/league.js groupCauseHTML | 전력 신뢰와 병원 정전을 별도 막대로 표시 | 공통 rel에서 w.rel×hospRel/Σw를 빼고 병원 전용 항에 한 번 넣음. 노년은 seniorHosp×min(1,hospH/hospPenHours) 추가. 총량 유지 | 예 | 일치 | probe G50: 실제 공개 hospRel·공통 막대·병원 전용 항 산술 대조 |

## rev8·rev9 현재 화면 문구 대조 (2026-10-28)

아래는 기존 ID에 연결한 후속 문구·조건 대조다. UI 배치만 바뀐 9001423·6628ef9의 이름표·끝 화면 DOM/격자 변경은 설명 항목 수를 늘리지 않는다. 19d4b17의 민원 혼합 문구는 137e0a9의 K8로 대체됐으며, 사용하지 않는 REV8_COPY.M9Mixed를 현재 화면으로 기록하지 않는다.

| 기존 ID/경로 | 현재 화면 문장(변수는 중괄호) | 현재 계산·조건/근거 |
|---|---|---|
| G49 / groupCauseHTML | 민원 요인 {n}개 중 입지 {m}개 · 상한 {cap}점 / 민원 요인 {n}개 중 입지 {m}개 · 상한 {cap}점에 걸림 | REV9_COPY K8a/K8b; 목표 민원 감점 절댓값≥complaintCap이면 ‘에 걸림’. 입지만·일반은 기존 건수 문구에 K8cap. 56 probe 실제 출력 |
| G19 / complaintImpactText | 민원(입지 {m}개)이 깎는 몫: 지금 {now}%p · 다 반영되면 {final}%p / 민원(입지 {m}개 포함)이 깎는 몫: 지금 {now}%p · 다 반영되면 {final}%p / 민원이 깎는 몫: 지금 {now}%p · 다 반영되면 {final}%p | K7a/b/c, now=Σ(shares×groupOwnLag.complaint), final=Σ(shares×groupOwn.complaint); 건수가 아닌 %p. 55-rev9 |
| C05 / S6 | 생산 CO₂(이번 달) {n} t/일 / 소비 CO₂(이웃·계통에서 받은 전기 포함) 하루 평균 {n} t/일 | 모든 주제에서 일평균 우선·이번 달 합 보조. 소비 배출에는 계통 수입 포함. 9001423·137e0a9, 55-rev9 |
| C14·C25 / promiseResultHTML | {근거} {근거화살표} → {대상} {예상화살표} 쪽 예상 · 실제 {대상} {실제화살표} → 근거가 가리킨 쪽과 같음(게임 안 단순 비교) / …반대(게임 안 단순 비교) / 실제 {대상} '같음' 범위 안 → 근거 쪽으로 안 움직임(게임 안 단순 비교) | K2/K3/K4. 근거 변화 방향과 부호를 곱한 예상 방향 구별. 현금·계통·정전 대상별 사용. 55-rev9 |
| C14 / 현금 판정 | 판정 계산: 운영 전 대비 Δ {Δ}억 · '같음' 범위 ±{tol}억 미만(게임 비교 기준) | K5, tol=promiseSameDelta를 소수 둘째 자리 표시. 운영 전 현금과 월말 실제 현금 비교. 55-rev9 |
| C16·C24 / S7 | 5%({실제}, 표시 눈금으로 올려 {올림}) / 5%({값}) | 실제 문턱과 올림 문턱을 구별. 생략 안내는 같은 표시 눈금으로 ‘이하’; 총합·최대 판정과 표시의 관계는 위 C16. 19d4b17·9001423·137e0a9, 55-rev9 |
| C28 / 장부·지원금 | 사건 지원금(특별교부세 포함) / 기타 운영 / 연료·운영비 / 보수비에 쓴 교부세 {n}억 (보수비 전체 {m}억) | 지원금 수입·일반 운영비·월 운영비를 해당 표에 구별. 보수비 없는 사건은 ‘남으면 사라져요’; 전체 보수비>0일 때만 전체 금액 괄호. 19d4b17, 56 probe D12 |
| C26 / gridAdvice | 이번 달 접속 가능 {available} MW · 앞선 대기 {ahead} MW · 월 {monthly} MW 처리로 {months}달 대기 | 대기≥2달이고 상한·처리량으로 기간 확정 가능할 때. 확정 불가 시 기존 대기 설명. 137e0a9, 55-rev9 |
| D09~D11 / 시험 안내 | 시험에는 호우 때 줄어드는 태양광 출력과 월말 공공시설 보수비도 들어 있지 않아요. / 시험에는 월말 공공시설 보수비가 들어 있지 않아요. 우리 도시엔 태양광이 없어 호우로 출력이 줄지는 않아요. | K13a/b; 일반 태양광 보유 여부에 따라 안내 분기. 폭염은 LNG·일반 태양광 보유분만 출력 감소 설명. 55-rev9 |

## 현재 기준판에서 실행한 검증 (2026-10-28)

실행 환경: macOS workspace-write 셸, Node `v24.21.0`, pnpm `11.25.0`. package.json·lockfile·Node 버전 지정 파일 없음. 브라우저·네트워크·커밋은 요청에 따라 실행하지 않았다. 기존 E1·E2 검사 파일 변경은 다른 세션 소유이며 이번 작업에서 수정하지 않았다.

| 명령 | 결과 |
|---|---|
| `node --check ui/build.js` | 종료 0 |
| `node --check ui/tech-data.js` | 종료 0 |
| `node tests/league/review/56-e-audit.js` | 1009단언 / 실패 0, 지도/모드 13·기술 15·사건 17·집단 6 |
| `node tests/league/review/33-model-explanations.js` | 50검사 / 실패 0 |
| `node tests/league/review/34-model-copy.js` | 174검사 / 실패 0 |
| `node tests/league/review/55-rev9.js` | 38단언 / 실패 0 |
| `node tests/league/review/42-explain-model.js` (추가 관련 검사) | 415단언 / 실패 0 |
| 저장소 밖 바이트 비교·공유값 변형 스크립트 | 14/14행 같음, 13변형 표시 추종, 13모드 계산·미션 24경계 및 7일 예측 급전 결과 동일 |

아래 10-25 검증 기록은 당시 실행 결과를 보존한다. 현재 실행 결과·현재 소스 해시는 이 절과 아래 현재 기준 소스 해시를 따른다. 화면 배치·터치·브라우저 실기와 외부 출처 원문은 미검증이며 Node VM 문자열 대조와 구별한다.

## 기준판에서 실행한 검증 (2026-10-25 기록)

실행 환경: macOS workspace-write 셸, Node `v24.21.0`, pnpm `11.25.0`. package.json·lockfile·Node 버전 지정 파일은 없다. 아래는 기준판 작업 당시 실행 결과다. 이번 후속의 명령·결과는 `tests/league/review/SCORE3-report.md`에 따로 기록한다. 기존 검사는 파일 쓰기·브라우저·네트워크 호출 여부를 확인해 범위 내 Node 검사만 실행했다. UI 함수는 메모리에서 참조를 노출하고 가짜 DOM에 문자열을 받아 대조했다.

| 명령 (`node tests/league/review/…`) | 이번 결과 |
|---|---|
| 33-model-explanations.js | 50/0 |
| 34-model-copy.js | 174/0 |
| 36-h03-h04.js | 506/0 |
| 37-d80-grid.js | 412/0 |
| 38-d81-buildlead.js | 176/0; 접속 속도 변형 검출 true |
| 42-explain-model.js | 415/0; params 변형93단언 포함 |
| 10-tech.js | 383/0 |
| 29-r3-air.js | 122/0 |
| 31-reweight.js | 3551/0 |
| 25-g6-score-contract.js | 66/0 |
| 35-d73-d74-d79.js | 4704/0 |
| 30-s7-attribution.js | 3074/0 |
| 32-s7-monthly.js | 12428/0 |
| 39-d80-s7.js | 67/0 |
| 40-v5-s7.js | 510/0 |
| 45-d87-engine.js | PASS D-87 engine contracts, 종료0 |
| 46-d87-ai-score.js | PASS D87 score, 종료0 |
| e-audit-probe.js | **831/0**(작성 당시) → 10-25 보강 뒤 **843/0**; 지도/모드13, 기술15, 사건16, 집단6 |

probe는 10-25 독립 검토 반영 뒤 **기본이 현재 작업 파일**이고 `uiDirty`(ui/ 미커밋 변경 여부)를 함께 보고한다. `--ref <sha>`를 주면 그 판본을 `git show`로 읽는다(보강 뒤의 probe로 `--ref 186e182`를 돌리면 V60 옛 문장에서 실패한다 — 그 판의 결함을 잡은 결과이며, 처음 판의 831/0은 보강 전 probe 기록이다). `--detail`은 원장·생성 문장·사건 대응값·해시를 stdout JSON으로 출력한다. 파일 출력은 없다. 새 probe를 작성하는 동안 호출 장치의 함수명/인수·특별교부세 합산·월합과 하루평균 필드 구분 오류를 고쳐 최종831단언을 재실행했다. 중간 조사 코드 실패는 제품 결함이나 해소 수에 넣지 않았다.

대표 실측: 석탄4.521739MW·13.633043억, LNG2.439130MW·5.183152억. 신규 PM 비율은 같은 연료 평균 대비36.6667%/46.6667%; LNG의 절대 게임 가중은0.0233333(기존0.05의46.6667%)이다. 입지 거리1/2/3/4칸 점수10/6/3/0은 세 전원 동일하고 운전율0·1에서 같다. 3칸의 민원표시0건은5점 이상을 건수로 세기 때문이며 경제 지지율 계산은3점도 받는다. D-82는 월310→280MWh여도 하루10→10MWh/일, Δ0, 허용폭0.5다. 조사 fixture·변형은 VM 메모리에만 존재한다.

**미실행:** 요청에 따라 브라우저·네트워크·커밋·stash·nice는 실행하지 않았다. 화면 배치·팝업 조작·실제 렌더링과 외부 원문 재검증은 미검증이다. 장기 전략·운영 데이터 검증은 범위 밖이다. `47-d87.js`는 하위 Python/장기 실행을 포함하므로 이번에는 실행하지 않았고 관련 계산은45·46과 새 probe로 대조했다. probe는 앱 전체 회귀 검사를 대체하지 않는다.

## 10-25 독립 검토 반영

맥락 없는 검토자가 이 판을 다시 대조했다(blocker 0, major 1, minor 6). 반영:
- major: probe 기본이 186e182 고정이라 작업 트리 변경을 못 잡았다 → 기본을 작업 파일로, `--ref`는 선택으로 바꿈.
- minor: 문장 안 파생 숫자(약 56·31개월, 1,275·1,809달러, 지도 3칸)와 B09 급전 순서를 probe가 단언하지 않았다 → 단언 추가. 변형(56→60개월, 3칸→5칸, 1,275→1,000, 재생↔배터리 순서) 네 가지 모두 실패로 잡히는 것을 확인.
- minor: T46~T60의 `eurekaMet:221` 줄 번호 → `ui/league-core.js:274~`.
- minor: D-87 문장 '냉각수: 해안·하천만' 누락 → D08로 추가(351항목).
- minor: D07 범위를 석탄·LNG·SMR 공통으로 고침.
- minor: V60이 석탄 연료비 상승을 빠뜨림(`league-core.js:904` coal fuelMul^0.6) → 아르곤 문구 'LNG 연료비가 가장 크게 오르고 디젤·석탄도 올라요'로 고치고 probe 단언 추가. 이 행은 처음 판에서 '일치'로 잘못 판정했던 것이라 신규 불일치 1건·해소 1건으로 센다.
- 참고: T07의 20MWh는 명판 용량이며 리그 실제 저장 상한(essCap 0.9)은 표에 덧붙임.

## 판본과 동시 작업 — 과거 이력 및 현재 기준

검사·대조 시작 HEAD는186e182였다. 문서 작성 중 다른 작업의 **eb1f88758a6fedd3be3fbc0b94b38034ed8fbaa0**이 들어왔다. 차이는 `ui/econ-data.js:219`의 한국 공사기간 O* 사유와 `ui/league-data.js:81`의 탈석탄 출처 추가·등급 O 승격·gradeNote 두 줄뿐이다. 계산값·why·text·행수는 바뀌지 않았다. 이 커밋은 이번 감사가 작성하거나 되돌린 것이 아니다.

당시에는 표·해시를 186e182로 유지하고 보강 전 probe 831/0을 기록했다. 현재는 **137e0a9 + E 변경**으로 기준판·해시·문구 열을 갱신했다. 탈석탄 사건의 등급 O 승격도 현재 자료에 포함되며 외부 원문 사실성을 새로 검증한 것은 아니다. 현재 probe는 56번 진입점에서 작업 파일을 읽어 1009/0을 확인했다.

## 현재 기준 소스 해시(137e0a9 + E 변경)

| 파일 | SHA-256 |
|---|---|
| ui/build-maps.js | 33a54aed6c537fc5624f172bcd7223f922fe31e5d9f8600e7f5020b81b3e7d04 |
| ui/tech-data.js | 29779bfcad364d607db8478f72b390fdacea37d7294a492fc892c37b1f83ba7d |
| ui/build.js | 2117f2204ef7a03ab636962ae41d690ff9259e687f09ee2a9631027bcbd861c9 |
| ui/econ-data.js | cb4d9ef9b28cdf9bed1de8f42e058058556acea90607732eb2ea02bfb8eb7d85 |
| ui/econ.js | 07d8760da006deac93d2b5e7878eb2d1657e4ba428a86ab5272688f1a375bf4a |
| ui/league-data.js | e5094ea280cc11134159ca93bd8d790b6c0352218bc232a5e54cc26b6ee8854e |
| ui/league-core.js | 9dcdccbbdda9e31af912ee672b0a30e795d034657699f50d200cf1d973a55797 |
| ui/league.js | 733d447e7521da83722df2a4fbaff18447929b3e39df4cad1c6716290e7135c3 |

## 이전 판 — 2026-10-21 원문 보존

아래는 이전 표·불일치25건·직접 기재81건·검사 부재268건과 당시 재현 코드를 보존한 기록이다. 현재 판정과 합산하지 않는다. 이전 재현 코드에는 수정 전 오류를 기대하는 단언이 있으므로 현재 검증에는 위 probe를 사용한다.

<details>
<summary>10-21판 전체 펼치기 (343항목)</summary>

# 학생에게 보이는 모형 설명 전수 대조 — 품질 축 E

2026-10-21 · `wip/q8-af` · 시작 HEAD `6ef6eeaf43cb71be418e5d13b75c41942f831b53` · 최종 대조 HEAD `6238ef05063861669be3e8338de6ef0e0c66e838`. 이 문서는 실행 시점 작업 파일을 감사한 기록이다. **코드를 고치지 않았으며 축 E 8점의 ‘불일치 0’은 충족하지 못한다.**

| 범주 | 항목 수 | 불일치 | 수치 직접 기재(하드코딩) | 단언 검사 없음 | 근사 표시 없음 |
|---|---:|---:|---:|---:|---:|
| 배속표 | 41 | 0 | 5 | 25 | 4 |
| 점수식 | 12 | 0 | 1 | 3 | 0 |
| 원인 분해 | 94 | 11 | 46 | 67 | 0 |
| 공기 주석 | 12 | 3 | 6 | 8 | 0 |
| 사건 출처 | 63 | 4 | 2 | 61 | 1 |
| 기술 카드 효과 | 74 | 6 | 21 | 67 | 1 |
| 집단 만족 이유 | 47 | 1 | 0 | 37 | 0 |
| 합계 | 343 | 25 | 81 | 268 | 6 |

범위는 지정한 파일에 선언된 모형 설명과 그 함수가 내보내는 문자열이다. 일반 버튼 이름·화면 조작 안내·지도 지명/날짜 반복은 제외했다. `build-maps.js`의 전체 지역 역사·기후 원문을 다시 감사한 표가 아니며, build.js가 읽는 수치의 원장은 확인했다. TECH_DATA params.note 전체가 학생에게 보이는 것은 아니므로 실제 출력되는 HVDC note만 별도 행으로 두었다. 사건은 16개 text·16개 why·6개 tip·14개 opts, 국제 사건 뉴스 6개를 각각 열거했다.

집계는 도시·월별 반복 출력 건수가 아니라 **설명 항목/템플릿** 기준이다. 같은 뜻의 동일 문구가 여러 경로에 있으면 한 행에 위치를 함께 적었다. 기술 카드는 **15개 eff를 각각 한 행(T01~T15)**으로 두고, 원본 `TECH_DATA.cards[].eff`와 실제 리그 `techEffectText` 출력을 같은 행에서 비교했다. 그 밖의 why, 필요량·실증비, 유레카, 배속 비교, 사건 힌트는 따로 센다. 배속표의 공개 자료 `speeds.items`도 요청 범위이므로 포함했지만 현재 `speedsHTML`은 이 긴 문장 대신 짧은 행을 출력한다. Q01의 formula는 공개 엔진 계약이며 현재 화면에서 원문 수식으로 직접 출력하는 경로는 없다.

`예`는 화면 수치를 계산에 쓰는 자료 원장(params, M/RS, BLD, 사건 effect/opts) 또는 엔진 결과에서 읽는다는 뜻이다. `아니오`는 수치가 원본 설명 문자열에 직접 들어 있거나 자료 읽기와 리터럴이 섞였다는 뜻이다. 값이 맞아도 하드코딩으로 센다. 단위 정의·외부 관측값·순수 정성 설명에는 `해당 없음`을 사용한다. 0~100 자름·단위 환산과 같은 수학 정의를 모두 새 params로 옮겨야 한다는 뜻은 아니다. 표의 자료 키 값은 Node VM에서 읽었다.

검사 열의 짧은 JS 파일명은 모두 `tests/league/review/` 아래다. 브라우저 검사 파일은 전체 저장소 경로를 적고 ‘미실행’으로 구분했다. `없음(엔진 …)`은 엔진 동작 검사는 있으나 해당 문구/자료 의존성을 직접 단언하는 검사를 찾지 못했다는 뜻이며 ‘없음’ 집계에 넣었다. 파일이 적힌 행도 괄호에 적힌 범위만 보장한다. 일회성 VM 검산을 새 회귀 검사 파일처럼 세지 않았다. **문구 수치가 params를 따라 바뀌는 변형 검사까지 전 항목에 갖춰졌다는 뜻은 아니다.**

사건 why는 역사적 관측·계획 설명이므로 게임의 `effect`와 숫자가 같아야 하는 항목이 아니다. 그 행의 ‘일치’는 저장소 자료→화면 전달과 관측/게임효과 구분의 일치를 뜻한다. **외부 원문의 사실성·URL 생존·출처 등급을 이번에 재검증하지 않았다.** 외부 네트워크와 브라우저는 요청대로 사용하지 않았다. G(게임 가정) 표시만 있는 것을 자동으로 ‘근사 표시’로 간주하지 않았다.

## 10-17 W1 42항목과의 관계

`docs/QUALITY-model.md` §3 E 행의 ‘10-17 W1 42항목’은 당시 판의 대조 실적이다. 이번 표는 당시 외부 (비공개 작업 지시서)의 42행을 재현한 문서가 아니라, 현재 파일에서 일곱 범주를 다시 추출한 확장 목록이므로 항목 수를 직접 증감 비교하면 안 된다. W1의 배속표·SMR 유레카·평가선·PM2.5 이주 이유·집단 지연 표시는 S/T/G/A 행에서 다시 대조했고, 뒤에 붙은 H03 세입(C10)·H04 피해(C09), D-80 계통 비교·끝 순위 누적(Q11, C12~C18), D-81 현실 공사기간·SMR 비대칭(S30~S39)을 추가했다. **D-82 하루 평균은 이 브랜치에 아직 없다**: `gridReliance`와 S7은 월 MWh이고 `league.js:1241`에도 미반영 주석이 남아 있다. 동일한 10 MWh/일을 31일→28일로 비교하면 현재 Δ−30 MWh가 나온다(C14). 이는 문구와 현 엔진끼리의 불일치가 아닌 **D-82 결정 대비 미구현 1건**이므로 위 불일치 합계에서 제외했다. D-82 병합 뒤 하루 평균·허용폭·소비 CO₂·S7 단위와 30/32/37/39/40번 검사까지 재감사해야 한다. 현재 최종 원인 화면은 기하평균 총점의 선형 분해가 아니라 월별 지지율 기여 합이므로 예전 §3 지적을 그대로 재사용하지 않았다.

## 불일치와 수정 제안(수정하지 않음)

| ID | 위치 | 문구와 실제 차이 | 제안 |
|---|---|---|---|
| A07 | ui/build.js:3455 | 바이오 CO₂ 0.1로 셈, 회계상 일부만 → dispOf biomass.co2=0(총량), bioCo2=.1(별도 정보 항목) | 총량 0과 별도 바이오 배출 .1을 구분해 자료에서 표시 |
| A08 | ui/build.js:3236 | 연결점 CO₂ 0.46 t/MWh → dispOf(import).co2=normalCo2=.4173 | normalCo2로 생성 |
| A09 | ui/build.js:3454 | 외부 전력망 CO₂ 0.46 t/MWh → normalCo2=.4173; 리그 자동계통과 자유건설 수입 모두 같은 값 | normalCo2로 생성 |
| T46 | ui/tech-data.js:152; ui/league.js:624 | grid 유레카: 내부 송전선 운영 → core.eurekaMet:221: plan.lines.length&gt;0(실제 통전 여부를 요구하지 않음) | ‘내부 송전선 설치’로 바꾸거나 통전 검사를 추가 |
| T48 | ui/tech-data.js:152; ui/league.js:624 | scable 유레카: HVDC 연계선 운영 → core.eurekaMet:221: built hvdc선 있음(내부 연결 여부는 추가 검사 안 함) | ‘HVDC 연계선 건설 완료’로 바꾸거나 실제 통전 조건을 추가 |
| T06 | ui/tech-data.js:89; ui/league.js:614 | tandem eff: 새 탠덤 태양광 출력·건설비 ×1.15 / 리그: 새 탠덤 태양광 출력 ×1.2, 건설비 ×1.2 → tandemOutput=tandemCost=1.2; build:1073; 출력 61.24896431→73.49875717 MWh, 비용 8→9.6 | 원본 eff도 params로 생성 |
| T07 | ui/tech-data.js:90; ui/league.js:615 | nbat eff: 새 배터리 용량 ×1.25, 화재 면역 / 리그: 새 배터리 용량 20 MWh(×1.25), 화재 면역 → nbatCapacity=1.25; 16×1.25=20; build:1075. 화재 사건/피해 상태/면역 분기 없음 | ‘화재 면역’ 삭제 또는 미구현임을 표시; 용량은 params로 생성 |
| T10 | ui/tech-data.js:93; ui/league.js:618 | h2mix eff: LNG CO₂ ×0.88 / 리그: LNG CO₂ ×0.88 → h2Co2=.88은 상한; build:815 남은 연결 수소만 사용. 수소 없으면 LNG CO₂ ×1 | ‘연결된 수소 잔량이 충분할 때 LNG CO₂ 최대 12% 감소’로 한정 |
| T11 | ui/tech-data.js:94; ui/league.js:619 | ccu eff: 석탄 CO₂ ×0.4, 출력 ×0.85 / 리그: 석탄 CO₂ ×0.4, 출력 ×0.79 → ccuCo2=.4, ccuOutput=.79; core:884; 실제 석탄 출력×.79 | 원본 eff도 params로 생성 |
| V31 | ui/league-data.js:69 (line_opposition_delay) | text: 주민 반대로 대상 연계선 공사가 멈추고 비용이 들어요. → VM modsFor={}; bonus=-5; tieDown=dangjin~asan; core:143·846·907·1336 | ‘공사 중단’ 대신 ‘기존 연계선 이번 달 송전 중단’으로 변경: eventValid는 built선만 인정하고 공사 기간 상태는 안 바꿈 |
| V33 | ui/league-data.js:69 (line_opposition_delay) | talk: 주민 협의·이익공유 / 선로 공사를 이어 간다. 돈으로 모든 반대를 없앨 수는 없다 → VM {}; bonus=-5; 단절=없음; 실제 cost=6 (core respCost) | 공사 재개 대신 기존 선의 송전 재개로 표시; −5 사건비는 대응 후에도 남는다고 명시 |
| V44 | ui/league-data.js:72 (planned_maintenance) | resched: 정비 일정 나눠 하기 / 출력 감소를 줄이지만 정비 기간이 길어진다 → VM {"coalCapMul":0.925,"lngCapMul":0.85}; bonus=0; 단절=없음; 실제 cost=2 (core respCost) | ‘정비 기간이 길어진다’는 구현 없음. 이번 턴 감소 완화만 밝히거나 지속 상태 구현 |
| G47 | ui/league.js:566·1298 | A에서 B보다 … / 이주 이유는 두 도시 사이 가장 큰 차이 하나 → causeOf는 시작 대비 개선 차이를 비교. VM air 현재 A70&gt;B40이나 시작 A80/B40이면 A에서 공기가 나빠서라는 이유 선택. migrationReason은 ‘A에서 B보다 공기가 나빠서’로 출력해 절대 비교로 바꿈 | ‘시작 이후 공기 여건이 상대적으로 나빠져서’처럼 변화 기준 명시 |
| B01 | ui/build.js:319·3463 | 배터리 충·방전 각95% → M.batEff=.922 →92.2%, 왕복85.0084%; BMS 도입 .933 | M.batEff와 bmsParams에서 표시(팁·도움말 두 위치) |
| B02 | ui/build.js:3451 | 도시 태양광 GHI×성능비0.8 → M.pvYield=.92; weather day.eDay=GHI×.92×weatherWeight/ew | M.pvYield를 읽고 날씨 정규화도 설명 |
| B04 | ui/build.js:3453 | 조력 2MW×&#124;sin(2πt/12.42)&#124; → renOut0: 2×.31×abs(sin(2π(k+3)/12.42)); .31과 위상+3 누락 | 실제 계수와 위상까지 식을 표시하거나 단순화임을 명시 |
| B05 | ui/build.js:3453 | 소수력 비×1.3·맑음 사흘 초과×.7 → weather sunny&gt;=3(사흘째)에서 .7; renOut0=정격×min(1,.25×월강수 q×flow/flowMean) | ‘사흘째부터’로 수정하고 계절강수·정규화를 표시 |
| B06 | ui/build.js:3454 | 기존 LNG9.5MW·연결점마다 수입 용량 → 평택 LNG site.cap=9.5; 당진 plant는 coal26.1. 평택 자유건설 수입 총2.5를 5곳에 .5씩, 리그 지도 수입0. 도움말은 연결점마다2.5로 출력 | 수입 총상한/점별 상한 구분·LNG 실제 site.cap 표시 |
| B09 | ui/build.js:3457 | 급전 재생→배터리→싼 연료 → simulate mc로 정렬; 실제 석탄도 포함, 계통 수입은 도시 운영/이웃 거래 뒤 보충 | 모드별 급전 경로를 나누고 가격·탄소세에 따라 순서 변함 표시 |
| B10 | ui/build.js:3458; ui/league-data.js:13 | 게임1MW=실제약100MW / 리그약230MW → build PK.scale의100 vs league region.mwScale=230; H03/H04는230 사용 | 리그 도움말은 region.mwScale을 읽어230으로 표시 |
| B12 | ui/build.js:3461 | 연습섬 풍력2MW×(풍속/12)³ → 2×min(1,(v/12)³), v&gt;25→0; 정격 포화가 설명식에 없음 | min(1,…) 또는 ‘정격2MW 상한’을 명시 |
| B19 | ui/build.js:294 | 탄소세 디젤×1.5 → island(.01+.75×.0066667)/.01=1.5; 도시(.016+.005)/.016=1.3125 | 지도별 연료비와 세율로 배수 계산 |
| B20 | ui/build.js:295 | 수요반응 피크감축·.05억/일 → M.drCost=.05, 실제 하루 max수요 DR 전후 계산; VPP drCost=.5 반영이면 .025 | VPP 도입 후 일 정책비도 실효계수로 표시 |
| B26 | ui/build.js:3346 | 공장5→10MW 증설 → VM 평택 factory_big.dem={base:5,fab2:10}; 다른5도시는 fab2 필드 없음에도 climate 카드가 노출되어 같은 5→10을 표시 | fab2 정의가 있는 지도만 노출하고 해당 base/fab2를 자료에서 표시 |
| V63 | ui/econ.js:613; ui/econ-data.js intl.events | cbam: 철강 공정의 직접배출이 많을수록, EU 수출 비중만큼 산출이 깎여요(단계 도입) → outIdx cbam은 steel비중×exportShare×cbamEuShare×cbamDrop×phase×eduCbam; 직접배출 강도 인수 없음. eu_indirect일 때만 전력 co2Int 사용 | ‘철강 비중과 EU 수출 비중에 따라’로 한정하고 직접배출량 차이를 생략한 근사임을 표시 |

동일 원인이 여러 화면에 남은 경우 별도 행으로 센다(예: A08/A09의 0.46). 탠덤·CCU는 원본 eff만 틀리고 **현재 리그 상세 화면은 올바른 1.2·0.79**다. 실시간 전달/API·다른 소비자 또는 향후 중복 구현에서 원본을 다시 쓰면 오류가 재노출된다. ‘화재 면역’, 무조건 혼소 감축, 운영하지 않은 선의 유레카 등은 숫자 외의 조건 누락도 포함한다.

## 근사인데 화면 표시가 부족한 항목

| ID | 문구 | 실제 의미·제안 |
|---|---|---|
| S10 | LNG 가격 급등 빈도 | 표시용 현실 비교값 3; 실제 추첨 intlEventP=0.12·사건 weight(직접 ×3 아님); 배속표 짧은 행에도 ‘약·현실 비교 추정’ 표시; 실제 사건 추첨 확률과 구분 |
| S11 | 정전 1% 환산 | 365×24×0.01=87.6; 에너지 미공급률과 정전시간은 별개; ‘연 에너지 미공급률을 동일 수요의 시간으로 단순 환산’이라고 표시하고 실제 정전시간과 분리 |
| S14 | 민원이 지지에 미치는 영향 | [50,200]은 비교 자료; 실제 min(20, 민원점수×1)×집단비중; 50~200배를 계산에 곱하는 값처럼 보이지 않게 ‘현실 대비 추정’ 표시 |
| S25 | speeds.items.outageHoursPerPercent: 정전 1% = 연 87.6시간: 한국(최대 상업도시 기준) 연 0.04시간(2019)보다 큰 교육용 눈금 | 87.6은 미공급 에너지의 등가시간; outH는 부족&gt;max(.005, .02×수요) 횟수; 등가시간 근사임을 밝히고 실제 정전시간 통계와 직접 등치하지 않기 |
| T13 | fcst eff: 저녁 피크에 저장을 남기고 사건 예보 범위를 0.7배로 / 리그: 저녁 피크에 저장을 남기고 사건 예보 범위를 0.7배로 | fcstWidth=.7은 자르기 전 반폭계수. monsoon x=.8 고정 VM [.7,.996], 실제폭 .296/기본폭.6=.493333배; 원래범위로 clipping; ‘예보 폭 최대0.7배(원래 범위 안으로 자름)’로 한정 |
| V59 | ship_red: 물류비가 오르고 항만 산출이 줄어요 | ship−.3은 항만 logi/out만 낮춤. 별도 물류비 지출 항목 없음; econ intlStep/outIdx; ‘물류 여건과 산출 감소로 단순화’라고 표시; 별도 물류비 지출은 계산하지 않음 |

## 수치 직접 기재 목록

총 81행. 외부 관측·출처의 연도와 통계 원문은 이 수에 넣지 않았다. 단위/범위 리터럴도 섞인 행은 포함한다. 원본 eff의 고정 수치는 리그 renderer가 덮어써도 원본 감사 항목으로 남겼다.

| ID | 위치 | 고정 수치·식 | 해당 문구 |
|---|---|---|---|
| S17 | ui/league-core.js:454 | 4, 4, 12 | speeds.items.eduMemory: 지지율 회복 기억 ×4: 임기 4년을 게임 12달에 압축 |
| S18 | ui/league-core.js:455 | 12, 4 | speeds.items.reviewEvery: 주민 평가는 12턴마다: 현실 임기 4년 |
| S25 | ui/league-core.js:462 | 1, 87.6, 0.04, 2019 | speeds.items.outageHoursPerPercent: 정전 1% = 연 87.6시간: 한국(최대 상업도시 기준) 연 0.04시간(2019)보다 큰 교육용 눈금 |
| S27 | ui/league-core.js:464 | 4.4, 55, 12 | speeds.items.smrConstruction: SMR 공사 시간 ×4.4: 현실 약 55개월 → 게임 12달 |
| S40 | ui/build.js:3382 | 4.35,1,3 | 리그 한 달 4.35주 진척·실증 1달; 연구소 3억/달 |
| Q12 | ui/league.js:2466 | 6 | 공동 보너스는 6개 부분 점수와 별도 |
| A07 | ui/build.js:3455 | 0.1 | 바이오 CO₂ 0.1로 셈, 회계상 일부만 |
| A08 | ui/build.js:3236 | 0.46 | 연결점 CO₂ 0.46 t/MWh |
| A09 | ui/build.js:3454 | 0.46 | 외부 전력망 CO₂ 0.46 t/MWh |
| A10 | ui/build.js:3454 | 0.37 | 기존 LNG CO₂ 0.37 |
| A11 | ui/build.js:3236 | 0.37 | LNG CO₂ 0.37 |
| A12 | ui/build.js:3455·3462 | 0.75 | 디젤 CO₂ 0.75 |
| T47 | ui/tech-data.js:152; ui/league.js:624 | 2 | hvdc 유레카: 연계선 2개 연결 |
| T03 | ui/tech-data.js:86; ui/league.js:611 | 1.5, 0.5, 0.5 | scable eff: 연계선 용량 ×1.5, 손실 ×0.5, 냉각 월 0.5억/선 / 리그: 연계선 용량 ×1.5, 손실 ×0.5, 냉각 0.5억/선/달 |
| T04 | ui/tech-data.js:87; ui/league.js:612 | 1.015 | sic eff: 재생 출력 ×1.015 / 리그: 재생 출력 ×1.015 |
| T05 | ui/tech-data.js:88; ui/league.js:613 | 10, 5, 85, 87 | bms eff: 하한 10→5%, 왕복 효율 85→87% / 리그: 잔량 하한 10% → 5% · 왕복 효율 85% → 87%(한 방향 약 93.3%) |
| T06 | ui/tech-data.js:89; ui/league.js:614 | 1.15 | tandem eff: 새 탠덤 태양광 출력·건설비 ×1.15 / 리그: 새 탠덤 태양광 출력 ×1.2, 건설비 ×1.2 |
| T51 | ui/tech-data.js:152; ui/league.js:624 | 10 | tandem 유레카: 태양광 10기 운영 |
| T07 | ui/tech-data.js:90; ui/league.js:615 | 1.25 | nbat eff: 새 배터리 용량 ×1.25, 화재 면역 / 리그: 새 배터리 용량 20 MWh(×1.25), 화재 면역 |
| T08 | ui/tech-data.js:91; ui/league.js:616 | 0.92 | mass eff: 새 태양광·배터리 건설비 ×0.92 / 리그: 새 태양광·배터리 건설비 ×0.92 |
| T09 | ui/tech-data.js:92; ui/league.js:617 | 200, 35 | h2store eff: 200 MWh 장주기 저장, 왕복 35% / 리그: 200 MWh 저장, 왕복 35% |
| T10 | ui/tech-data.js:93; ui/league.js:618 | 0.88 | h2mix eff: LNG CO₂ ×0.88 / 리그: LNG CO₂ ×0.88 |
| T11 | ui/tech-data.js:94; ui/league.js:619 | 0.4, 0.85 | ccu eff: 석탄 CO₂ ×0.4, 출력 ×0.85 / 리그: 석탄 CO₂ ×0.4, 출력 ×0.79 |
| T14 | ui/tech-data.js:97; ui/league.js:621 | 1.5, 0.5, 0.8 | vpp eff: 수요반응 ×1.5·비용 ×0.5, 출력제어 ×0.8 / 리그: 수요반응 ×1.5·비용 ×0.5, 출력제어 손실 ×0.8 |
| T59 | ui/tech-data.js:152; ui/league.js:624 | 3 | vpp 유레카: 수요반응 정책 3달 운영 |
| T15 | ui/tech-data.js:98; ui/league.js:622 | 1.5 | re100 eff: 정책 선택 시 산업 매력 재생 항 가중 ×1.5 / 리그: 정책 선택 시 산업 매력의 재생 항목 가중 ×1.5 |
| T60 | ui/tech-data.js:152; ui/league.js:624 | 30 | re100 유레카: 재생 비중 30% 이상 운영 |
| T62 | ui/tech-data.js:103; ui/league.js:637 | 0.125 | scable 교육용 배속·비교 기준: 송전 용량 증가폭: 기존의 5배 |
| T63 | ui/tech-data.js:103; ui/league.js:637 | 0.8979591836734695 | tandem 교육용 배속·비교 기준: 모듈 효율 증가폭: 일반 22% → 탠덤 26.9% |
| T64 | ui/tech-data.js:103; ui/league.js:637 | 0.625 | nbat 교육용 배속·비교 기준: 셀 에너지 밀도 증가폭 40%(팩 용량과 직접 같지 않아요) |
| T65 | ui/tech-data.js:103; ui/league.js:637 | 1 | h2store 교육용 배속·비교 기준: 왕복 효율 30~40%의 가운데 값 35% |
| T66 | ui/tech-data.js:103; ui/league.js:637 | 1 | h2mix 교육용 배속·비교 기준: 수소 30 vol% 혼소의 열량 환산 CO₂ 감소 12%(M) |
| T67 | ui/tech-data.js:103; ui/league.js:637 | 0.6666666666666666 | ccu 교육용 배속·비교 기준: 포집률 상단 90% |
| V36 | ui/league-data.js:70 (semiconductor_fab_expansion) | 비용 0; dev=0.5; grant=0.6; cancel=false | cond: 조건부 유치(피크 부하 제한) / 수요 증가 절반, 세수도 줄어든다 |
| V40 | ui/league-data.js:71 (datacenter_siting) | 비용 0; dev=0.5; grant=0.6; cancel=false | cond: 조건부 유치(부하 제한·폐열 공유) / 수요 증가 절반, 지원금도 줄어든다 |
| C04 | ui/league.js:2486 | 부족&gt;max(.005MW, 수요×.02), 일수×24 | 정전 시간 정의 |
| C22 | ui/league.js:2658 | hotDays/days×100 또는 hotDays | 무더위 일수/비율·28℃ 초과 |
| C24 | ui/league.js:3158 | 3개, 정전.05%p·계통tol/10 | 원인 카드 최대 세 개·가장 큼/공동 최대 |
| C30 | ui/econ.js:604; ui/league.js:342 | 1·4·7·10월,연액/4 | 국가 지원금 분기별 1/4 |
| C33 | ui/econ.js:683 | 25% | 재정 주의 채무비율25% 이상 |
| C34 | ui/econ.js:683 | 0 | 위기 새 건설·유료 대응 제한·재정점수0 |
| B01 | ui/build.js:319·3463 | 95% | 배터리 충·방전 각95% |
| B02 | ui/build.js:3451 | 0.8 | 도시 태양광 GHI×성능비0.8 |
| B03 | ui/build.js:3452 | 3,12,25m/s | 육상풍력 3 미만0·12정격·25넘으면 정지 |
| B04 | ui/build.js:3453 | 2,12.42 | 조력 2MW×&#124;sin(2πt/12.42)&#124; |
| B05 | ui/build.js:3453 | 1.3,.7 | 소수력 비×1.3·맑음 사흘 초과×.7 |
| B06 | ui/build.js:3454 | 9.5, PK.gridCap | 기존 LNG9.5MW·연결점마다 수입 용량 |
| B07 | ui/build.js:3455 | 3,1,2 | 디젤3MW 최소1·바이오2MW |
| B08 | ui/build.js:3456 | 도시 .5%/칸,2억/칸; 산하천×2,바다호수×3 | 송전 손실/칸·선 단가·지형배수 |
| B10 | ui/build.js:3458; ui/league-data.js:13 | 100 / 230 | 게임1MW=실제약100MW / 리그약230MW |
| B11 | ui/build.js:3460 | 2;1,.45,.2 | 연습섬 태양광2MW×날씨×타일 |
| B12 | ui/build.js:3461 | 2,12,25 | 연습섬 풍력2MW×(풍속/12)³ |
| B13 | ui/build.js:3462 | 3MW,min1,.01 | 연습섬 디젤 연료 .01억/MWh |
| B14 | ui/build.js:3463 | 4,16,10% | 배터리4MW/16MWh·바닥10% |
| B15 | ui/build.js:3464 | 1.5%,.5,산×2,바다×3 | 연습섬 송전 손실1.5%·.5억/칸 |
| B16 | ui/build.js:311 | 2³=8 | 풍속2배면 출력 약8배 |
| B18 | ui/build.js:320 | &lt;.5 | 흐린날 태양광 맑은날 절반 미만 |
| B19 | ui/build.js:294 | 1.5 | 탄소세 디젤×1.5 |
| B20 | ui/build.js:295 | .05; peak差 | 수요반응 피크감축·.05억/일 |
| B21 | ui/build.js:299 | .1 | 이익공유 .1억/일 |
| B22 | ui/build.js:304·903 | .5%,0 | 정전 미션 ≤.5%·병원0시간 |
| B25 | ui/build.js:307·906 | 1,60 | 민원≤1·최저만족≥60 |
| B26 | ui/build.js:3346 | 5,10 | 공장5→10MW 증설 |
| B27 | ui/build.js:3187 | 60% | 민원 증가 예상·가동60% 가정 |
| B32 | ui/build.js:3000 | MW합/7월 보통날 최대 시간수요 | 설비/피크 정의 |
| B33 | ui/build.js:3380 | 손실⅔, BMS85→87,저녁17–22 | 건설 연구 grid·bms·fcst 효과 |
| B34 | ui/build.js:979 | 12 | 배터리1대12억의 값어치 |
| B39 | ui/build.js:224 | 2 MW | solar 설비 spec: 2 MW |
| B40 | ui/build.js:225 | 0.6 MW | roof 설비 spec: 0.6 MW |
| B41 | ui/build.js:226 | 2 MW | wind 설비 spec: 2 MW |
| B42 | ui/build.js:227 | 4 MW | offshore 설비 spec: 4 MW |
| B43 | ui/build.js:228 | 2 MW | tidal 설비 spec: 2 MW |
| B44 | ui/build.js:229 | 0.1 MW | hydro 설비 spec: 0.1 MW |
| B45 | ui/build.js:230 | 3 MW | diesel 설비 spec: 3 MW |
| B46 | ui/build.js:231 | 2 MW | biomass 설비 spec: 2 MW |
| B47 | ui/build.js:232 | 4 MW/16 MWh | battery 설비 spec: 4 MW/16 MWh |
| B48 | ui/build.js:234 | 연구인력 2 · 0.3 MW | uni 설비 spec: 연구인력 2 · 0.3 MW |
| B49 | ui/build.js:235 | 연구석 3 · 0.3억/주 | lab 설비 spec: 연구석 3 · 0.3억/주 |
| B50 | ui/build.js:1075 | 4 MW/20 MWh | nbat 설비 spec: 4 MW/20 MWh |
| B51 | ui/build.js:1076 | 4 MW/200 MWh · 왕복 35% | h2store 설비 spec: 4 MW/200 MWh · 왕복 35% |
| C43 | ui/league.js:2603 | max(1 MWh, 기준×5%) | 계통 ‘같을 것’ 판정 허용폭 |

## 전수 대조표

### 배속표

| ID | 범주 | 파일:줄 | 화면 문구(짧게) | 문구 속 수치·식 | 엔진이 실제로 쓰는 값·식 | 수치를 자료에서 읽는가 | 일치 판정 | 이를 단언하는 검사 |
|---|---|---|---|---|---|---|---|---|
| S01 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 이동 시간 | 4.4 | 0.009×4.4=0.0396(주민), 0.005×4.4=0.022(기업); econ.js:645 | 예 | 일치 | 없음 |
| S02 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 지지율 회복 | 4 | 0.038×4=0.152(회복), 하락은 즉시 1; econ.js:701 | 예 | 일치 | 없음 |
| S03 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 주민 평가 간격 | 12 | t+1을 12로 나눈 나머지 0; econ.js:737 | 예 | 일치 | 없음 |
| S04 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 대기 영향(집단 만족만) | 4 | air=80−4×29×PM 증분; 이주는 ×1; econ.js:187·537 | 예 | 일치 | 없음 |
| S05 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 탄소 국경 부담 | 5 | cbamPhase×0.046×0.154×5; econ.js:431 | 예 | 일치 | 없음 |
| S06 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 전력망 접속 | 27 | 0.00375×27=0.10125; league-core.js 접속 증가식 | 예 | 일치 | 없음 |
| S07 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 버리는 재생 전기 | 3.3 | curtailP×0.018×3.3=curtailP×0.0594; league-core.js:857 | 예 | 일치 | 없음 |
| S08 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 기상 사건 빈도 | 0.1 | hazardReal×0.1; league-core.js:793(태풍·황사, 모든 사건에 곱하는 값 아님) | 예 | 일치 | 없음 |
| S09 | 배속표 | ui/league.js:276; ui/league-core.js:447 | SMR 공사 | 12 | readyRound=착공 round+12; league-core.js construction | 예 | 일치 | 없음 |
| S10 | 배속표 | ui/league.js:276; ui/league-core.js:447 | LNG 가격 급등 빈도 | 3 | 표시용 현실 비교값 3; 실제 추첨 intlEventP=0.12·사건 weight(직접 ×3 아님) | 예 | 근사인데 표시 없음 | 33-model-explanations.js [6](자료 전달; 근사 의미 검사는 없음) |
| S11 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 정전 1% 환산 | 87.6 | 365×24×0.01=87.6; 에너지 미공급률과 정전시간은 별개 | 예 | 근사인데 표시 없음 | 33-model-explanations.js [6](자료 전달; 근사 의미 검사는 없음) |
| S12 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 연습 섬 송전 손실 | 3 | M.lossPerHex 0.015 / 도시 lossPerHex 0.005 =3 | 예 | 일치 | 33-model-explanations.js [6](자료 전달; 근사 의미 검사는 없음) |
| S13 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 연구 기간 비교 | [10,30] | [10,30]년은 비교 자료; 실제 필요량/인력/4.35 + 실증 1턴 | 예 | 근사 표시 있음 | 33-model-explanations.js [6](자료 전달; 근사 의미 검사는 없음) |
| S14 | 배속표 | ui/league.js:276; ui/league-core.js:447 | 민원이 지지에 미치는 영향 | [50,200] | [50,200]은 비교 자료; 실제 min(20, 민원점수×1)×집단비중 | 예 | 근사인데 표시 없음 | 33-model-explanations.js [6](자료 전달; 근사 의미 검사는 없음) |
| S15 | 배속표 | ui/league.js:271 | 게임 1달 ≈ 현실 약 4.4달 | 4.4 | eduSpeed=4.4; 이주 관성만 가속, 1년 전체 모사 아님 | 예 | 근사 표시 있음 | tests/league/econui.py:586·692(브라우저 미실행) |
| S16 | 배속표 | ui/league-core.js:453 | speeds.items.eduSpeed: 주민·기업 이동 시간 ×4.4: 수업 안에서 변화 관찰 | 4.4 | 0.009×4.4=0.0396(주민), 0.005×4.4=0.022(기업); econ.js:645 | 예 | 일치 | 없음 |
| S17 | 배속표 | ui/league-core.js:454 | speeds.items.eduMemory: 지지율 회복 기억 ×4: 임기 4년을 게임 12달에 압축 | 4, 4, 12 | 0.038×4=0.152(회복), 하락은 즉시 1; econ.js:701 | 아니오 | 일치 | 없음 |
| S18 | 배속표 | ui/league-core.js:455 | speeds.items.reviewEvery: 주민 평가는 12턴마다: 현실 임기 4년 | 12, 4 | t+1을 12로 나눈 나머지 0; econ.js:737 | 아니오 | 일치 | 없음 |
| S19 | 배속표 | ui/league-core.js:456 | speeds.items.eduAir: 대기 영향 ×4(교육용·집단 만족만, 이주에는 ×1) | 4, 1 | air=80−4×29×PM 증분; 이주는 ×1; econ.js:187·537 | 예 | 일치 | 없음 |
| S20 | 배속표 | ui/league-core.js:457 | speeds.items.eduCbam: CBAM 효과 ×5: 교육용 확대 | 5 | cbamPhase×0.046×0.154×5; econ.js:431 | 예 | 일치 | 없음 |
| S21 | 배속표 | ui/league-core.js:458 | speeds.items.eduConn: 재생 접속 속도 ×27: 수업 기간 안에 접속 | 27 | 0.00375×27=0.10125; league-core.js 접속 증가식 | 예 | 일치 | 없음 |
| S22 | 배속표 | ui/league-core.js:459 | speeds.items.eduCurtail: 출력제어 손실 ×3.3: 버림을 관찰하도록 확대 | 3.3 | curtailP×0.018×3.3=curtailP×0.0594; league-core.js:857 | 예 | 일치 | 없음 |
| S23 | 배속표 | ui/league-core.js:460 | speeds.items.hazardFreq: 기상 사건 빈도 ×0.1: 정책 판단 시간을 확보 | 0.1 | hazardReal×0.1; league-core.js:793(태풍·황사, 모든 사건에 곱하는 값 아님) | 예 | 일치 | 없음 |
| S24 | 배속표 | ui/league-core.js:461 | speeds.items.lngSpikeFrequency: LNG 급등은 현실보다 약 3배 자주: 충격 관찰 | 3 | 표시용 현실 비교값 3; 실제 추첨 intlEventP=0.12·사건 weight(직접 ×3 아님) | 예 | 근사 표시 있음 | 없음 |
| S25 | 배속표 | ui/league-core.js:462 | speeds.items.outageHoursPerPercent: 정전 1% = 연 87.6시간: 한국(최대 상업도시 기준) 연 0.04시간(2019)보다 큰 교육용 눈금 | 1, 87.6, 0.04, 2019 | 87.6은 미공급 에너지의 등가시간; outH는 부족&gt;max(.005, .02×수요) 횟수 | 아니오 | 근사인데 표시 없음 | 없음 |
| S26 | 배속표 | ui/league-core.js:463 | speeds.items.islandLineLoss: 섬 연습 지도 송전 손실은 리그의 3배: 짧은 지도에서 손실 관찰 | 3 | M.lossPerHex 0.015 / 도시 lossPerHex 0.005 =3 | 예 | 일치 | 없음 |
| S27 | 배속표 | ui/league-core.js:464 | speeds.items.smrConstruction: SMR 공사 시간 ×4.4: 현실 약 55개월 → 게임 12달 | 4.4, 55, 12 | 55/4.4=12.5 ≠ 12; ‘약’ 포함, smrTurns=12 | 아니오 | 근사 표시 있음 | 없음 |
| S28 | 배속표 | ui/league-core.js:465 | speeds.items.researchYears: 연구 기간 수십 배 압축: 현실 10~30년 → 게임 수 달 | 10, 30 | [10,30]년은 비교 자료; 실제 필요량/인력/4.35 + 실증 1턴 | 예 | 근사 표시 있음 | 없음 |
| S29 | 배속표 | ui/league-core.js:466 | speeds.items.complaintPoliticalEffect: 민원 정치 효과 약 50~200배 확대: 마을 민원을 도시 전체 만족에 반영 | 50, 200 | [50,200]은 비교 자료; 실제 min(20, 민원점수×1)×집단비중 | 예 | 근사 표시 있음 | 없음 |
| S30 | 배속표 | ui/league.js:284 | 현실 착공~가동 solar 2년 | 2년 | buildLeadYears.solar=2; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38-d81-buildlead.js |
| S31 | 배속표 | ui/league.js:284 | 현실 착공~가동 wind 3년 | 3년 | buildLeadYears.wind=3; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38-d81-buildlead.js |
| S32 | 배속표 | ui/league.js:284 | 현실 착공~가동 ess 1년 | 1년 | buildLeadYears.ess=1; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38-d81-buildlead.js |
| S33 | 배속표 | ui/league.js:284 | 현실 착공~가동 biomass 4년 | 4년 | buildLeadYears.biomass=4; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38-d81-buildlead.js |
| S34 | 배속표 | ui/league.js:284 | 현실 착공~가동 diesel 2년 | 2년 | buildLeadYears.diesel=2; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38-d81-buildlead.js |
| S35 | 배속표 | ui/league.js:284 | 현실 착공~가동 smr 6년 | 6년 | buildLeadYears.smr=6; 비교 자료, 엔진 대기 아님 | 예 | 일치 | 38-d81-buildlead.js |
| S36 | 배속표 | ui/league.js:284 | 27~32개월(계획 기준) | [27,32] | buildLeadKorea.lngMonths=[27,32] | 예 | 일치 | 38-d81-buildlead.js |
| S37 | 배속표 | ui/league.js:284 | 인허가까지 약 10년 | 10 | buildLeadKorea.windPermitYears=10 | 예 | 근사 표시 있음 | 38-d81-buildlead.js |
| S38 | 배속표 | ui/league.js:284 | 계획·인허가부터 5~15년 | [5,15] | buildLeadKorea.gridYears=[5,15] | 예 | 일치 | 38-d81-buildlead.js |
| S39 | 배속표 | ui/league.js:284 | SMR만 12달, 다른 설비는 즉시 건설·접속 대기 | 12 | TECH_DATA.params.smrTurns=12; 태양광 8달 추적에서 착공 즉시·접속 5번째 달 | 예 | 일치 | 38-d81-buildlead.js |
| S40 | 배속표 | ui/build.js:3382 | 리그 한 달 4.35주 진척·실증 1달; 연구소 3억/달 | 4.35,1,3 | roundSteps=4.35, RS.labOpexR=3; core 연구 단계 한 턴 후 도입 | 아니오 | 일치 | 없음 |
| S41 | 배속표 | ui/build.js:3375·3382 | 혼자: 대학 4주 뒤, 연구소 0.3억/주 | 4,0.3 | RS.uniPrepW=4, labOpexW=.3; researchRun 주차 루프 | 예 | 일치 | 없음 |

### 점수식

| ID | 범주 | 파일:줄 | 화면 문구(짧게) | 문구 속 수치·식 | 엔진이 실제로 쓰는 값·식 | 수치를 자료에서 읽는가 | 일치 판정 | 이를 단언하는 검사 |
|---|---|---|---|---|---|---|---|---|
| Q01 | 점수식 | ui/econ.js:811 | 균형 점수 공식 | clamp(exp(Σw ln(max(1,부분))/Σw)+보너스,0,100) | scorePartFloor=1, wScore 합=1; 실제 score 호출값과 독립 계산 비교 | 예 | 일치 | 33-model-explanations.js [9]; 31-reweight.js |
| Q02 | 점수식 | ui/league.js:762 | 지역 전체 성장 제외 주민·산업 변화 | (도시/시작)/(지역/지역시작)−1 | econ.js score gp/gi; 점수=50+K×상대변화 | 예 | 일치 | 없음 |
| Q03 | 점수식 | ui/league.js:762 | 주민 부분 점수 | 0~100 | neutralScore=50; 12달 K.pop=711.571022 | 예 | 일치 | 25-g6-score-contract.js |
| Q04 | 점수식 | ui/league.js:762 | 산업 부분 점수 | 0~100 | neutralScore=50; 12달 K.ind=1023.165165 | 예 | 일치 | 25-g6-score-contract.js |
| Q05 | 점수식 | ui/league.js:762 | 재정 부분 점수 | 0~100 | 채무/(budgetToRevenue=2.2×연세입) .1→100, .25→50; 한도 초과 0; 현금 적립 가점 없음 | 예 | 일치 | 25-g6-score-contract.js |
| Q06 | 점수식 | ui/league.js:762 | 탄소 부분 점수 | 0~100 | absolute: 강도 .82→0, .25038→80, 0→100; relative: 시작 대비 감축 0→0, .4→80, 1→100; max(absolute,relative); econ.js:152 | 예 | 일치 | 35-d73-d74-d79.js |
| Q07 | 점수식 | ui/league.js:762 | 지지 부분 점수 | 최근 12달 평균 | approvalWindow=12; 실제 승인 이력 평균(초기엔 기록된 달 수) | 예 | 일치 | 25-g6-score-contract.js |
| Q08 | 점수식 | ui/league.js:762 | 전력 신뢰 부분 점수 | 100(1−unsS/16) | scoreUnsZero=16; clip 0~100, 계통 의존 별도 감점 없음 | 예 | 일치 | 25-g6-score-contract.js |
| Q09 | 점수식 | ui/league.js:1373 | 가중치 변경·전부 0이면 원래 점수 | wScore=.1,.1,.125,.275,.15,.25 | reweightScore: total=0이면 r.score; 그 외 엔진과 같은 기하평균 | 예 | 일치 | 31-reweight.js |
| Q10 | 점수식 | ui/league.js:3221 | 공동 보너스 두 목표 달성 시 +2·이번 달만 | 2 | coopBonus=2; monthly report 두 목표 AND, E.coop 재대입 | 예 | 일치 | 없음 |
| Q11 | 점수식 | ui/league.js:766 | 계통 의존은 신뢰 감점 없음·비용과 배출은 반영 | 수요 50%, 원가×1.5 | gridImportShare=.5, gridImportMarkup=1.5, normalCost=.008, normalCo2=.4173 | 예 | 일치 | 없음(엔진 35-d73-d74-d79.js) |
| Q12 | 점수식 | ui/league.js:2466 | 공동 보너스는 6개 부분 점수와 별도 | 6 | Object.keys(wScore).length=6; 기하평균 뒤 coop 가산 | 아니오 | 일치 | 33-model-explanations.js [9] |

### 원인 분해

| ID | 범주 | 파일:줄 | 화면 문구(짧게) | 문구 속 수치·식 | 엔진이 실제로 쓰는 값·식 | 수치를 자료에서 읽는가 | 일치 판정 | 이를 단언하는 검사 |
|---|---|---|---|---|---|---|---|---|
| B01 | 원인 분해 | ui/build.js:319·3463 | 배터리 충·방전 각95% | 95% | M.batEff=.922 →92.2%, 왕복85.0084%; BMS 도입 .933 | 아니오 | 불일치 | 없음 |
| B02 | 원인 분해 | ui/build.js:3451 | 도시 태양광 GHI×성능비0.8 | 0.8 | M.pvYield=.92; weather day.eDay=GHI×.92×weatherWeight/ew | 아니오 | 불일치 | 없음 |
| B03 | 원인 분해 | ui/build.js:3452 | 육상풍력 3 미만0·12정격·25넘으면 정지 | 3,12,25m/s | M.cutin=3,rated=12,cutout=25; 도시 (v³−3³)/(12³−3³) | 아니오 | 일치 | 없음 |
| B04 | 원인 분해 | ui/build.js:3453 | 조력 2MW×&#124;sin(2πt/12.42)&#124; | 2,12.42 | renOut0: 2×.31×abs(sin(2π(k+3)/12.42)); .31과 위상+3 누락 | 아니오 | 불일치 | 없음 |
| B05 | 원인 분해 | ui/build.js:3453 | 소수력 비×1.3·맑음 사흘 초과×.7 | 1.3,.7 | weather sunny&gt;=3(사흘째)에서 .7; renOut0=정격×min(1,.25×월강수 q×flow/flowMean) | 아니오 | 불일치 | 없음 |
| B06 | 원인 분해 | ui/build.js:3454 | 기존 LNG9.5MW·연결점마다 수입 용량 | 9.5, PK.gridCap | 평택 LNG site.cap=9.5; 당진 plant는 coal26.1. 평택 자유건설 수입 총2.5를 5곳에 .5씩, 리그 지도 수입0. 도움말은 연결점마다2.5로 출력 | 아니오 | 불일치 | 없음 |
| B07 | 원인 분해 | ui/build.js:3455 | 디젤3MW 최소1·바이오2MW | 3,1,2 | dispOf cap/min=3/1,2/.5; 건설 정격과 일치 | 아니오 | 일치 | 없음 |
| B08 | 원인 분해 | ui/build.js:3456 | 송전 손실/칸·선 단가·지형배수 | 도시 .5%/칸,2억/칸; 산하천×2,바다호수×3 | PK.lossPerHex=.005; lineUnit=2, stepMul=2/3; 최소 전달 효율 .4 | 아니오 | 일치 | 없음 |
| B09 | 원인 분해 | ui/build.js:3457 | 급전 재생→배터리→싼 연료 | LNG→수입→디젤·바이오(탄소세 포함) | simulate mc로 정렬; 실제 석탄도 포함, 계통 수입은 도시 운영/이웃 거래 뒤 보충 | 해당 없음 | 불일치 | 없음 |
| B10 | 원인 분해 | ui/build.js:3458; ui/league-data.js:13 | 게임1MW=실제약100MW / 리그약230MW | 100 / 230 | build PK.scale의100 vs league region.mwScale=230; H03/H04는230 사용 | 아니오 | 불일치 | 없음 |
| B11 | 원인 분해 | ui/build.js:3460 | 연습섬 태양광2MW×날씨×타일 | 2;1,.45,.2 | renOut0는 여기에 낮 시간 sin 곱; 일사라는 항으로 시간 곡선 포함 | 아니오 | 일치 | 없음 |
| B12 | 원인 분해 | ui/build.js:3461 | 연습섬 풍력2MW×(풍속/12)³ | 2,12,25 | 2×min(1,(v/12)³), v&gt;25→0; 정격 포화가 설명식에 없음 | 아니오 | 불일치 | 없음 |
| B13 | 원인 분해 | ui/build.js:3462 | 연습섬 디젤 연료 .01억/MWh | 3MW,min1,.01 | island dispOf diesel.fuel=.01; 도시 .016과 구분 | 아니오 | 일치 | 없음 |
| B14 | 원인 분해 | ui/build.js:3463 | 배터리4MW/16MWh·바닥10% | 4,16,10% | M.batMW=4,batMWh=16,socFloor=.1(효율 오류 B01) | 아니오 | 일치 | 없음 |
| B15 | 원인 분해 | ui/build.js:3464 | 연습섬 송전 손실1.5%·.5억/칸 | 1.5%,.5,산×2,바다×3 | M.lossPerHex=.015,lineUnit=.5,stepMul=2/3 | 아니오 | 일치 | 없음 |
| B16 | 원인 분해 | ui/build.js:311 | 풍속2배면 출력 약8배 | 2³=8 | 도시 cutin 보정·정격포화·정지, 섬 min 포화. ‘약’은 있으나 구간 한정 필요 | 아니오 | 근사 표시 있음 | 없음 |
| B17 | 원인 분해 | ui/build.js:313 | 전력량=전력×시간 | MWh=MW×h | simulate 1시간 시간단계 누산 | 해당 없음 | 일치 | 없음 |
| B18 | 원인 분해 | ui/build.js:320 | 흐린날 태양광 맑은날 절반 미만 | &lt;.5 | M.wxSun cloud=.45 vs sun=1(같은 월·같은 타일) | 아니오 | 일치 | 없음 |
| B19 | 원인 분해 | ui/build.js:294 | 탄소세 디젤×1.5 | 1.5 | island(.01+.75×.0066667)/.01=1.5; 도시(.016+.005)/.016=1.3125 | 아니오 | 불일치 | 없음 |
| B20 | 원인 분해 | ui/build.js:295 | 수요반응 피크감축·.05억/일 | .05; peak差 | M.drCost=.05, 실제 하루 max수요 DR 전후 계산; VPP drCost=.5 반영이면 .025 | 아니오 | 불일치 | 없음 |
| B21 | 원인 분해 | ui/build.js:299 | 이익공유 .1억/일 | .1 | M.shareCost=.1; simulate 정책비 일수 곱 | 아니오 | 일치 | 없음 |
| B22 | 원인 분해 | ui/build.js:304·903 | 정전 미션 ≤.5%·병원0시간 | .5%,0 | unsTotal&lt;=.005×dem AND hosp===0 | 아니오 | 일치 | 없음 |
| B23 | 원인 분해 | ui/build.js:305·904 | 비용 미션 목표 | costBase+days×costPerDay | PK.goals로 계산; R.cost.total과 비교 | 예 | 일치 | 없음 |
| B24 | 원인 분해 | ui/build.js:306·905 | CO₂ 미션 하루평균 이하 | co2/days | PK.goals.co2Day; 도시 생산CO₂와 별도 bio 정보 항목 | 예 | 일치 | 없음 |
| B25 | 원인 분해 | ui/build.js:307·906 | 민원≤1·최저만족≥60 | 1,60 | R.cp.issues&lt;=1 AND min(R.sat)&gt;=60 | 아니오 | 일치 | 없음 |
| B26 | 원인 분해 | ui/build.js:3346 | 공장5→10MW 증설 | 5,10 | VM 평택 factory_big.dem={base:5,fab2:10}; 다른5도시는 fab2 필드 없음에도 climate 카드가 노출되어 같은 5→10을 표시 | 아니오 | 불일치 | 없음 |
| B27 | 원인 분해 | ui/build.js:3187 | 민원 증가 예상·가동60% 가정 | 60% | complaints(st,null) 기본 가동 .6으로 배치 전후 비교 | 아니오 | 근사 표시 있음 | 없음 |
| B28 | 원인 분해 | ui/build.js:3194 | 일사배수·숲정리2억 | tile.sun,2 | 타일 sun과 CLEAR_COST=2 | 예 | 일치 | 없음 |
| B29 | 원인 분해 | ui/build.js:3195 | 예상송전손실 최단거리 | min(.6,loss×distance) | 실제 전선 경로와 다름 명시; 최소 효율 .4 | 예 | 근사 표시 있음 | 없음 |
| B30 | 원인 분해 | ui/build.js:3207 | 대표월 풍속이3 미만이면 거의 발전 안 함 | 평균&lt;3m/s | M.cutin=3은 순간 풍속 기준. 시간별 변동은 가능, ‘거의’로 완화 | 예 | 근사 표시 있음 | 없음 |
| B31 | 원인 분해 | ui/build.js:3209 | 축산옆 바이오 연료 감소 | 1−.012/.02=40% | biomassFuel=.012, dispOf.fuel=.02 | 예 | 일치 | 없음 |
| B32 | 원인 분해 | ui/build.js:3000 | 설비/피크 정의 | MW합/7월 보통날 최대 시간수요 | 접속대기·공사중·저장·외부수입 제외; 기관부하 제외 명시 | 아니오 | 일치 | 없음 |
| B33 | 원인 분해 | ui/build.js:3380 | 건설 연구 grid·bms·fcst 효과 | 손실⅔, BMS85→87,저녁17–22 | grid/bms는 renderer에서 helper 호출; raw TECHS.grid 옛1.5→1.0은 화면에서 대체 | 아니오 | 일치 | 33-model-explanations.js [7](BMS) |
| B34 | 원인 분해 | ui/build.js:979 | 배터리1대12억의 값어치 | 12 | BLD.battery.cost=12(차세대15는 별도) | 아니오 | 일치 | 없음 |
| B35 | 원인 분해 | ui/build.js:3416 | 총비용=건설+연료+정책+연구 | 비용 합 | simulate R.cost.total; 리그 시험은 지도 전체 투자라고 표시 | 예 | 일치 | 없음 |
| B36 | 원인 분해 | ui/build.js:941·944·948 | 뉴스 버린MWh·수입%·송전손실% | curt,import/sup×100,loss/공급×100 | 결과값에서 읽으며 관측 통계가 아닌 모형 결과 | 예 | 일치 | 없음 |
| B37 | 원인 분해 | ui/build.js:943·956·976 | 뉴스 시설정전h·저녁h·n일무정전 | outH,eveH,days | 시간별 town 결과; 도시 core outH와 다른 시설 기준 | 예 | 일치 | 없음 |
| B38 | 원인 분해 | ui/build.js:943·964·973 | 뉴스/질문 CO₂t·연료비억·미공급MWh | R.co2, cost.fuel,town.uns | 리그 뉴스는 tot.co2 생산; 질문은 simulate 결과 | 예 | 일치 | 없음 |
| B39 | 원인 분해 | ui/build.js:224 | solar 설비 spec: 2 MW | 2 MW | BLD.solar: mw=2, mwh=없음, cost=8; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B40 | 원인 분해 | ui/build.js:225 | roof 설비 spec: 0.6 MW | 0.6 MW | BLD.roof: mw=0.6, mwh=없음, cost=4; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B41 | 원인 분해 | ui/build.js:226 | wind 설비 spec: 2 MW | 2 MW | BLD.wind: mw=2, mwh=없음, cost=10; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B42 | 원인 분해 | ui/build.js:227 | offshore 설비 spec: 4 MW | 4 MW | BLD.offshore: mw=4, mwh=없음, cost=24; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B43 | 원인 분해 | ui/build.js:228 | tidal 설비 spec: 2 MW | 2 MW | BLD.tidal: mw=2, mwh=없음, cost=18; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B44 | 원인 분해 | ui/build.js:229 | hydro 설비 spec: 0.1 MW | 0.1 MW | BLD.hydro: mw=0.1, mwh=없음, cost=2; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B45 | 원인 분해 | ui/build.js:230 | diesel 설비 spec: 3 MW | 3 MW | BLD.diesel: mw=3, mwh=없음, cost=6; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B46 | 원인 분해 | ui/build.js:231 | biomass 설비 spec: 2 MW | 2 MW | BLD.biomass: mw=2, mwh=없음, cost=10; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B47 | 원인 분해 | ui/build.js:232 | battery 설비 spec: 4 MW/16 MWh | 4 MW/16 MWh | BLD.battery: mw=4, mwh=16, cost=12; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B48 | 원인 분해 | ui/build.js:234 | uni 설비 spec: 연구인력 2 · 0.3 MW | 연구인력 2 · 0.3 MW | BLD.uni: mw=0, mwh=없음, cost=40, RS.uniStaff=2, load=.3; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B49 | 원인 분해 | ui/build.js:235 | lab 설비 spec: 연구석 3 · 0.3억/주 | 연구석 3 · 0.3억/주 | BLD.lab: mw=0, mwh=없음, cost=25, RS.labSeats=3, labOpexW=.3; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B50 | 원인 분해 | ui/build.js:1075 | nbat 설비 spec: 4 MW/20 MWh | 4 MW/20 MWh | BLD.nbat: mw=4, mwh=20, cost=15; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| B51 | 원인 분해 | ui/build.js:1076 | h2store 설비 spec: 4 MW/200 MWh · 왕복 35% | 4 MW/200 MWh · 왕복 35% | BLD.h2store: mw=4, mwh=200, cost=28; 지도 override 뒤 값 | 아니오 | 일치 | 없음 |
| C01 | 원인 분해 | ui/league.js:188·556 | causeBreakdown 기여 막대 | (after−before)×w/Σw, residual=actual−Σ기여 | 현재 소비자는 집단 목표 막대이며 other 제거. 끝 화면 기하평균 점수 분해에는 쓰지 않음 | 예 | 일치 | 없음 |
| C02 | 원인 분해 | ui/league.js:1298 | 도시 지지율 원인 상위 3개 | Σ집단비중×memory×기여차; top3 | econ.js:697; causeCount=3, 단순 가중 차이를 엔진 보고에서 읽음 | 예 | 근사 표시 있음 | 없음(계산 29-r3-air.js) |
| C03 | 원인 분해 | ui/league.js:1418 | 끝 화면 보고된 달별 기여 합·누락 달 제외 | 달별 top3 합 | finalCausesHTML sums; 전체 delta와 합 다를 수 있다고 명시 | 예 | 근사 표시 있음 | 없음 |
| C04 | 원인 분해 | ui/league.js:2486 | 정전 시간 정의 | 부족&gt;max(.005MW, 수요×.02), 일수×24 | core run outH 동일; 31일 최대744시간, 연습 섬 정전선과 별도 | 아니오 | 일치 | 없음 |
| C05 | 원인 분해 | ui/league.js:3260 | 대표 7일×월 배수·CO₂ 생산 기준 | 31/7=4.428571,28/7=4 | resultPeriod; econ.weekMul; %는 늘리지 않음 | 예 | 일치 | 36-h03-h04.js |
| C06 | 원인 분해 | ui/league.js:2515 | 시험/실제 월 환산·기간 다르면 시험 추정 | 월일수/각 운전일수 | 시험 gridFill 포함, 이웃 거래 없음; 비용 fuel+policy만 비교 | 예 | 근사 표시 있음 | 37-d80-grid.js |
| C07 | 원인 분해 | ui/league.js:3215 | CO₂ 선택·계절수요·일수 몫 | choice=total−seasonalDemand−calendar | co2Attribution 2회 동일 계획 비교; calendar=전월 생산×일수차/대표일수 | 예 | 근사 표시 있음 | 없음 |
| C08 | 원인 분해 | ui/league.js:3233 | 이주 편익·부담 추정 | 유입×주민세,유입/현재인구,유입×서비스 | resTax=.00003, taxStep=.25, svcCost=.00003, svcStep=.25; 고령 추가비는 이 근사에서 제외 | 예 | 근사 표시 있음 | 없음 |
| C09 | 원인 분해 | ui/league.js:3242 | H04 정전 피해·실제 돈·현금 제외 | uns×월배수×230×1000×가중단가/1e8 | outageHomeWon=3564; industryUSD=.35~.8; Fx=1291.304347826087; 주거몫으로 배분 | 예 | 근사 표시 있음 | 36-h03-h04.js |
| C10 | 원인 분해 | ui/league.js:3276·538 | H03 지역자원시설세·게임 세입 | Σ발전MWh×230×1000×단가×.65/1e8/28 | facilityRate coal=.7,lng=.6,smr=1; moneyScale=28; 수입은 과세 제외 | 예 | 일치 | 36-h03-h04.js |
| C11 | 원인 분해 | ui/league.js:3222 | 실제 공급량 기준 감축 | served×normalCo2−co2Cons | normalCo2=.4173; 판매 배출 제외·수입 포함·음수 보존 | 예 | 근사 표시 있음 | 35-d73-d74-d79.js |
| C12 | 원인 분해 | ui/league.js:3248 | 계통이 메운 전기·약 비용 | (고립uns−실제uns−imp+sub)×월배수 | gridFillMWh; normalCost×markup=.008×1.5=.012억/MWh | 예 | 근사 표시 있음 | 37-d80-grid.js |
| C13 | 원인 분해 | ui/league.js:2598 | 끝 순위 계통 달 합·1년 평균 | ΣMWh, 합×12/수신달수 | gridTotal; 24/36달에서 연평균 표시, 기록 누락 달 제외 | 예 | 근사 표시 있음 | 없음 |
| C14 | 원인 분해 | ui/league.js:2610·1241 | D-82 계통 약속/S6/S7 비교 단위 | 현재 월 MWh; 요구 하루 평균 | 현 문구 MWh와 계산은 월 합계로 일치. VM 대표70MWh/7일→31일310,28일280, Δ−30. D-82 요구(하루평균 Δ0)는 별도 미구현 | 예 | 일치 | 없음(37·39·40은 기존 월 계약) |
| C15 | 원인 분해 | ui/league.js:3209 | S7 계산 순서에 따라 몫 달라지는 추정 | 시험4/월6 단계 차분 | outageAttribution/Monthly; 순차 반사실, 총차 보존 | 해당 없음 | 근사 표시 있음 | 30-s7-attribution.js;32-s7-monthly.js;39-d80-s7.js |
| C16 | 원인 분해 | ui/league.js:3091 | S7 폭포: 기준+재현+원인→실제 | Σparts=total(재현 진단 제외 옵션) | outageWaterfallHTML; monthly replayOutsideSum=true면 합 밖 | 예 | 일치 | 30-s7-attribution.js;32-s7-monthly.js |
| C17 | 원인 분해 | ui/league.js:3208 | 재현 차이는 원인 후보 제외 | trial−replay, monthly snapshot 차 | stored 조건 손실 진단; 분해 합 밖 표시 분기 | 예 | 일치 | 32-s7-monthly.js |
| C18 | 원인 분해 | ui/league.js:2630 | 계통 상한·할증 단서 | 50%,1.5배 | outageGridClue reads gridImportShare/Markup; gridSupply와 동일 | 예 | 일치 | 37-d80-grid.js |
| C19 | 원인 분해 | ui/league.js:2645 | 평균 풍속(연결된 육상/해상만) | m/s | climate wind10×hub 혹은 wind100; 시간 배수 평균, 위치 보정 제외라고 표시 | 예 | 근사 표시 있음 | 30-s7-attribution.js |
| C20 | 원인 분해 | ui/league.js:2648 | 평균 수요·최대 수요 | tot.dem/H; max(hrDem) | outageWeatherMetrics | 예 | 일치 | 30-s7-attribution.js |
| C21 | 원인 분해 | ui/league.js:2649 | 하루 재생 공급 변화 | tot.ren/days; after/before−1 | 분모0이면 MWh/일 절대값, 양쪽0이면 공급 없음 | 예 | 일치 | 30-s7-attribution.js |
| C22 | 원인 분해 | ui/league.js:2658 | 무더위 일수/비율·28℃ 초과 | hotDays/days×100 또는 hotDays | build.weather day.hot는 Tmax&gt;28; 기간 다르면 비율 | 아니오 | 일치 | 30-s7-attribution.js |
| C23 | 원인 분해 | ui/league.js:2660 | 단서 순서는 평균 수요·재생 절댓값 | abs(Δdemand) vs abs(ΔrenPerDay/24) | 순서 결정용 근사; 원인 몫은 별도 순차 재계산 | 해당 없음 | 근사 표시 있음 | 30-s7-attribution.js |
| C24 | 원인 분해 | ui/league.js:3158 | 원인 카드 최대 세 개·가장 큼/공동 최대 | 3개, 정전.05%p·계통tol/10 | outageCardCandidates/outagePartRanking; 소수 자리 동점 판정 | 아니오 | 일치 | 39-d80-s7.js;40-v5-s7.js |
| C25 | 원인 분해 | ui/league.js:3208 | 내 예측이 놓친 것·직접 연결 | 날씨/사건/선택/진행/성장/거래 | 근거 종류→단계 연결표; 풍력은 통전 조건 필요 | 해당 없음 | 근사 표시 있음 | 40-v5-s7.js |
| C26 | 원인 분해 | ui/league.js:248·544 | 접속 대기·버린 재생 전기 | 대기MW, 월curtailMWh, 수요 대비% | grid entries allocation; 월/대표기간 변환, solarMul 사건은 별도 | 예 | 일치 | 37-d80-grid.js(계통; 문구 전체는 없음) |
| C27 | 원인 분해 | ui/league.js:239 | 출력제어 사건 태양광 감소 | 1+(solarMul−1)×x×dev | 현재 .75, x=1일 때 −25%; VPP curtailP×.8과 별개 | 예 | 일치 | 없음 |
| C28 | 원인 분해 | ui/league.js:3273 | 장부 달 초+수입−투자−운영=달 말 | open+income−invest−opex | r.ledger 동일; 이미 월 값이므로 재환산 안 함 | 예 | 일치 | 36-h03-h04.js(원장) |
| C29 | 원인 분해 | ui/league.js:294 | 채무 주의25%·위기40% | debtWarnRatio/2.2; debtCapRatio/2.2 | 현재 .55/2.2=.25, .88/2.2=.4; engine debtCrisisRatio=.4 | 예 | 일치 | 없음 |
| C30 | 원인 분해 | ui/econ.js:604; ui/league.js:342 | 국가 지원금 분기별 1/4 | 1·4·7·10월,연액/4 | yearStart/subsidyPay 분기 지급; 연액과 월 지급 구분 | 아니오 | 일치 | 없음 |
| C31 | 원인 분해 | ui/econ.js:613 | 국제 사건 이름·기간·설명 | s.dur 달 | intlStep started의 dur/text, 900 이상은 기간표시 생략 | 예 | 일치 | 없음 |
| C32 | 원인 분해 | ui/econ.js:651·652 | 주민 n명/일자리 n개 이전 | flow.n | pairFlows 정수 흐름·causeOf; newsMin100 또는 newsFrac=.0005 넘을 때 | 예 | 근사 표시 있음 | 없음 |
| C33 | 원인 분해 | ui/econ.js:683 | 재정 주의 채무비율25% 이상 | 25% | debtWarnRatio=.55 / budgetToRevenue=2.2=.25; 문구는 고정25 | 아니오 | 일치 | 없음 |
| C34 | 원인 분해 | ui/econ.js:683 | 위기 새 건설·유료 대응 제한·재정점수0 | 0 | debtStage ratio&gt;=.4 OR 한도초과; scoreFinDebtMarks [.1,.25] 선형식은 ratio=.4에서 이미 clamp→0. VM revYear100,cap88,cash−88에서 fin0 | 아니오 | 일치 | 없음 |
| C35 | 원인 분해 | ui/econ.js:727·744 | 다른 도시 대비 지지율 회복시 시위 멈춤·평가 시 정책비↑ | relative,unrestOffDrop=4,polChangeCost=2 | 시위 정지 기준 relative&gt;=−4; 시작 relative&lt;−10; 평가 12달마다 | 예 | 일치 | 34-model-copy.js [2](평가선) |
| C36 | 원인 분해 | ui/econ.js:527·735 | 기업 이전 희망/확정·명/MW/재생% | of.workers,of.mw,of.rePct,moved | evalOffer 4조건; acceptOffer 실제 moved | 예 | 일치 | 없음 |
| C37 | 원인 분해 | ui/league.js:3049 | 내 선택: 설비 추가·제거·전선·정책 | 집합 차이 개수, 접속 감소MW | 지난 사본과 현재 sanitized plan 비교 | 예 | 근사 표시 있음 | 32-s7-monthly.js;30-s7-attribution.js |
| C38 | 원인 분해 | ui/league.js:3050 | 접속·공사·기술 진행 | ΔMW,완료기수,도입개수,curtail% | 고정 계획에 접속/기술 경과만 반영; 이웃 연계선 변화 따로 | 예 | 근사 표시 있음 | 32-s7-monthly.js;30-s7-attribution.js |
| C39 | 원인 분해 | ui/league.js:3051 | 도시 성장·연료 값 | 주민·산업 전후, fuel지수 | 월말 현재값 아닌 운영 당시 facts | 예 | 근사 표시 있음 | 32-s7-monthly.js;30-s7-attribution.js |
| C40 | 원인 분해 | ui/league.js:3052 | 이웃 구매·판매 변화 | MWh 월환산 | flow 손실 뒤 도착량; 판매대체 sub 포함 | 예 | 근사 표시 있음 | 32-s7-monthly.js;30-s7-attribution.js |
| C41 | 원인 분해 | ui/league.js:3064 | 사건·대응 단서 | 실현x,dev,남은 배수 | scope와 현지도 발전설비 유무 확인 | 예 | 근사 표시 있음 | 32-s7-monthly.js;30-s7-attribution.js |
| C42 | 원인 분해 | ui/league.js:337 | 철거30%회수·70%손실 | 30/70% | core SALV=.3; lossOf cost×(1−SALV), 기존 paidCost 사용 | 예 | 일치 | 없음 |
| C43 | 원인 분해 | ui/league.js:2603 | 계통 ‘같을 것’ 판정 허용폭 | max(1 MWh, 기준×5%) | GRID_SAME_MWH=1, GRID_SAME_SHARE=.05; 기준310에서15.5MWh. D-82 하루평균 문턱 미적용 | 아니오 | 일치 | 37-d80-grid.js |

### 공기 주석

| ID | 범주 | 파일:줄 | 화면 문구(짧게) | 문구 속 수치·식 | 엔진이 실제로 쓰는 값·식 | 수치를 자료에서 읽는가 | 일치 판정 | 이를 단언하는 검사 |
|---|---|---|---|---|---|---|---|---|
| A01 | 공기 주석 | ui/league.js:154·167 | 발전 PM2.5 증분·이웃 기여 추정 | PM2.5 | kPM=.000007×생산MWh×pmFuelW; 자체+이웃 1회; 전체 농도 아님 | 예 | 근사 표시 있음 | 29-r3-air.js; 34-model-copy.js [8] |
| A02 | 공기 주석 | ui/league.js:168 | 측정 비율 있는 당진→아산·천안 | 자료의 ratio | airNeighbours 중 grade≠G 쌍; 참가 도시 필터 | 예 | 근사 표시 있음 | 없음(자료 29-r3-air.js) |
| A03 | 공기 주석 | ui/league.js:169 | 나머지 이웃 0.2배·근거 없는 게임 가정 | 0.2 | airNeighbours G ratio=.2, 참여 쌍 최솟값~최댓값 | 예 | 근사 표시 있음 | 없음 |
| A04 | 공기 주석 | ui/league.js:170 | 전체 대기질이나 관측 농도 아님 | 없음 | econ.js regionCtx 발전량 기반 증분만 합산 | 해당 없음 | 근사 표시 있음 | tests/league/econui.py:955(브라우저 미실행) |
| A05 | 공기 주석 | ui/league.js:561 | 발전 PM2.5 증분으로 공기가 나빠서 | 없음 | WHY_L.air; CO₂가 아니라 reg.pm25.delta | 해당 없음 | 근사 표시 있음 | 34-model-copy.js [8] |
| A06 | 공기 주석 | ui/league.js:291·3270 | 바이오 CO₂ 국가 총량 밖·IPCC 정보 항목 | bioCo2 | build.dispOf biomass.co2=0, bioCo2=.1; econ 도시 보고 분리 | 예 | 일치 | 36-h03-h04.js(분리 보존); 29-r3-air.js; tests/league/econui.py:589(표시·미실행) |
| A07 | 공기 주석 | ui/build.js:3455 | 바이오 CO₂ 0.1로 셈, 회계상 일부만 | 0.1 | dispOf biomass.co2=0(총량), bioCo2=.1(별도 정보 항목) | 아니오 | 불일치 | 없음 |
| A08 | 공기 주석 | ui/build.js:3236 | 연결점 CO₂ 0.46 t/MWh | 0.46 | dispOf(import).co2=normalCo2=.4173 | 아니오 | 불일치 | 없음 |
| A09 | 공기 주석 | ui/build.js:3454 | 외부 전력망 CO₂ 0.46 t/MWh | 0.46 | normalCo2=.4173; 리그 자동계통과 자유건설 수입 모두 같은 값 | 아니오 | 불일치 | 없음 |
| A10 | 공기 주석 | ui/build.js:3454 | 기존 LNG CO₂ 0.37 | 0.37 | dispOf(lng).co2=.37 | 아니오 | 일치 | 없음 |
| A11 | 공기 주석 | ui/build.js:3236 | LNG CO₂ 0.37 | 0.37 | dispOf(lng).co2=.37 | 아니오 | 일치 | 없음 |
| A12 | 공기 주석 | ui/build.js:3455·3462 | 디젤 CO₂ 0.75 | 0.75 | dispOf(diesel).co2=.75 | 아니오 | 일치 | 없음 |

### 사건 출처

| ID | 범주 | 파일:줄 | 화면 문구(짧게) | 문구 속 수치·식 | 엔진이 실제로 쓰는 값·식 | 수치를 자료에서 읽는가 | 일치 판정 | 이를 단언하는 검사 |
|---|---|---|---|---|---|---|---|---|
| V1 | 사건 출처 | ui/league-data.js:60 (heatwave_peak) | text: 폭염경보! 오후 냉방 수요가 크게 늘어요. | {"demandMul":1.12,"hours":[13,19]} | VM modsFor={"demandMul":1.12,"demandHours":[13,19]}; bonus=0; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V2 | 사건 출처 | ui/league-data.js:60 (heatwave_peak) | why: 역대 최대전력수요는 2024년 8월 20일 97.1GW이며, 2025년 7월 8일에도 95.7GW로 7월 기준 최고를 기록하는 등 폭염 때 피크가 반복 경신된다. | 2024, 8, 20, 97.1, 2025, 7, 8, 95.7, 7 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 5개, 저장소 gradeNote와 연결. 게임 크기는 {"demandMul":1.12,"hours":[13,19]}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V3 | 사건 출처 | ui/league-data.js:60 (heatwave_peak) | dr: 수요반응 계약 / 피크 시간에 공장·건물이 사용을 미루고 보상받는다 | 비용 4; dev=0.5; grant=없음; cancel=false | VM {"demandMul":1.06,"demandHours":[13,19]}; bonus=0; 단절=없음; 실제 cost=4 (core respCost) | 예 | 일치 | 없음 |
| V4 | 사건 출처 | ui/league-data.js:60 (heatwave_peak) | save: 절전 캠페인 / 싸지만 참여는 일부만 | 비용 1; dev=0.8; grant=없음; cancel=false | VM {"demandMul":1.096,"demandHours":[13,19]}; bonus=0; 단절=없음; 실제 cost=1 (core respCost) | 예 | 일치 | 없음 |
| V5 | 사건 출처 | ui/league-data.js:61 (evening_peak_tropical_night) | text: 해가 져도 더위가 계속! 저녁 전기 수요가 늘어요. | {"demandMul":1.08,"hours":[17,22]} | VM modsFor={"demandMul":1.08,"demandHours":[17,22]}; bonus=0; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V6 | 사건 출처 | ui/league-data.js:61 (evening_peak_tropical_night) | why: 2025년 7월 8일 최대전력 95.7GW는 오후 6시에 발생했고, 정부는 평일 17~20시를 여름철 피크 시간대로 보고 절감 보상 시범사업을 시행했다. | 2025, 7, 8, 95.7, 6, 17~20 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 4개, 저장소 gradeNote와 연결. 게임 크기는 {"demandMul":1.08,"hours":[17,22]}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V7 | 사건 출처 | ui/league-data.js:61 (evening_peak_tropical_night) | dr: 수요반응 계약 / 피크 시간에 공장·건물이 사용을 미루고 보상받는다 | 비용 3; dev=0.5; grant=없음; cancel=false | VM {"demandMul":1.04,"demandHours":[17,22]}; bonus=0; 단절=없음; 실제 cost=3 (core respCost) | 예 | 일치 | 없음 |
| V8 | 사건 출처 | ui/league-data.js:61 (evening_peak_tropical_night) | save: 절전 캠페인 / 싸지만 참여는 일부만 | 비용 1; dev=0.8; grant=없음; cancel=false | VM {"demandMul":1.064,"demandHours":[17,22]}; bonus=0; 단절=없음; 실제 cost=1 (core respCost) | 예 | 일치 | 없음 |
| V9 | 사건 출처 | ui/league-data.js:62 (monsoon_cloud) | text: 장마로 흐린 날이 이어져요. 태양광 출력이 줄어요. | {"solarMul":0.6} | VM modsFor={"solarMul":0.6}; bonus=0; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V10 | 사건 출처 | ui/league-data.js:62 (monsoon_cloud) | why: 흐리거나 비가 오는 날 태양광 출력은 맑은 날보다 크게 떨어지며, 2026년 여름 전망에서도 '흐린 날씨+폭염'을 최악 조건(98.8GW)으로 가정했다. | 2026, 98.8 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 4개, 저장소 gradeNote와 연결. 게임 크기는 {"solarMul":0.6}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V11 | 사건 출처 | ui/league-data.js:62 (monsoon_cloud) | tip: 구름은 못 막는다 — 저장·다른 발전원으로 대비 | 없음 | 선택지 0개; {"solarMul":0.6} | 해당 없음 | 일치 | 없음 |
| V12 | 사건 출처 | ui/league-data.js:63 (typhoon_coast) | text: 태풍 북상! 풍력 출력이 줄고 해안 연계선이 끊길 수 있어요. | {"offshoreMul":0.2,"windMul":0.6,"tieDown":"dangjin~asan"} | VM modsFor={"windMul":0.6,"offshoreMul":0.19999999999999996}; bonus=0; tieDown=dangjin~asan; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V13 | 사건 출처 | ui/league-data.js:63 (typhoon_coast) | why: 2020년 태풍 마이삭 때 송전설비의 염분·강풍에 의한 섬락으로 원전 6기의 외부 전원이 끊기고 그중 운전 중이던 4기가 정지했다. 풍력발전기는 한계 풍속을 넘으면 안전을 위해 회전을 멈춘다. | 2020, 6, 4 | 관측·계획 근거 문장(엔진 입력 아님); grade=O*; sources 4개, 저장소 gradeNote와 연결. 게임 크기는 {"offshoreMul":0.2,"windMul":0.6,"tieDown":"dangjin~asan"}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V14 | 사건 출처 | ui/league-data.js:63 (typhoon_coast) | harden: 송전선 사전 점검·보강 / 선 고장은 막지만, 해상풍력은 강풍 때 안전하게 멈춘다(멈춤 ≠ 파손) | 비용 5; dev=없음; grant=없음; cancel=true | VM {"windMul":0.6,"offshoreMul":0.19999999999999996}; bonus=0; 단절=없음; 실제 cost=5 (core respCost) | 예 | 일치 | 없음 |
| V15 | 사건 출처 | ui/league-data.js:64 (coldwave_heating) | text: 매서운 한파! 난방 전기 수요가 늘어요. | {"demandMul":1.15,"hours":[8,20]} | VM modsFor={"demandMul":1.15,"demandHours":[8,20]}; bonus=0; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V16 | 사건 출처 | ui/league-data.js:64 (coldwave_heating) | why: 2022년 12월 23일 한파로 겨울철 최대전력 94.5GW를 기록했고, 정부는 2025/26 겨울에도 한파·폭설 시 최대 94.5GW를 전망했다. | 2022, 12, 23, 94.5, 2025, 26, 94.5 | 관측·계획 근거 문장(엔진 입력 아님); grade=M; sources 2개, 저장소 gradeNote와 연결. 게임 크기는 {"demandMul":1.15,"hours":[8,20]}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V17 | 사건 출처 | ui/league-data.js:64 (coldwave_heating) | dr: 수요반응 계약 / 피크 시간에 공장·건물이 사용을 미루고 보상받는다 | 비용 4; dev=0.5; grant=없음; cancel=false | VM {"demandMul":1.075,"demandHours":[8,20]}; bonus=0; 단절=없음; 실제 cost=4 (core respCost) | 예 | 일치 | 없음 |
| V18 | 사건 출처 | ui/league-data.js:64 (coldwave_heating) | insul: 취약가구 단열 지원 / 효과는 오래 가지만 게임은 이번 라운드만 계산 | 비용 6; dev=0.7; grant=없음; cancel=false | VM {"demandMul":1.105,"demandHours":[8,20]}; bonus=0; 단절=없음; 실제 cost=6 (core respCost) | 예 | 일치 | 없음 |
| V19 | 사건 출처 | ui/league-data.js:65 (heavy_snow_solar) | text: 폭설로 패널이 눈에 덮여 태양광 출력이 줄어요. | {"solarMul":0.4,"demandMul":1.04} | VM modsFor={"demandMul":1.04,"solarMul":0.4}; bonus=0; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V20 | 사건 출처 | ui/league-data.js:65 (heavy_snow_solar) | why: 2022년 12월 22일 산업부는 한파로 겨울철 최대 전력수요가 경신될 것이라고 밝혔다. 전국에 눈이 쌓여 태양광이 전망보다 크게 덜 만든 만큼 전력망에서 받아야 할 전기도 늘었다. 다음 날 수요는 94.5GW로 역대 최대였다. | 2022, 12, 22, 94.5 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 3개, 저장소 gradeNote와 연결. 게임 크기는 {"solarMul":0.4,"demandMul":1.04}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V21 | 사건 출처 | ui/league-data.js:65 (heavy_snow_solar) | clear: 패널 제설 인력 / 태양광 손실을 줄인다(눈 자체는 그대로) | 비용 2; dev=0.4; grant=없음; cancel=false | VM {"demandMul":1.04,"solarMul":0.76}; bonus=0; 단절=없음; 실제 cost=2 (core respCost) | 예 | 일치 | 없음 |
| V22 | 사건 출처 | ui/league-data.js:66 (finedust_coal_cap) | text: 미세먼지 계절관리제 시행! 석탄발전 출력을 제한해요. | {"coalCapMul":0.8} | VM modsFor={"coalCapMul":0.8}; bonus=0; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V23 | 사건 출처 | ui/league-data.js:66 (finedust_coal_cap) | why: 제7차 미세먼지 계절관리제(2025.12~2026.3)는 공공 석탄발전 최대 17기 가동정지, 최대 46기 출력 80% 상한제약을 시행한다. | 7, 2025.12~2026, 3, 17, 46, 80 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 4개, 저장소 gradeNote와 연결. 게임 크기는 {"coalCapMul":0.8}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V24 | 사건 출처 | ui/league-data.js:66 (finedust_coal_cap) | tip: 규제라 선택지가 없다 — 석탄 없이 버틸 계획을 | 없음 | 선택지 0개; {"coalCapMul":0.8} | 해당 없음 | 일치 | 없음 |
| V25 | 사건 출처 | ui/league-data.js:67 (spring_dust_haze) | text: 뿌연 하늘! 황사로 햇빛이 약해져 태양광 출력이 줄어요. | {"solarMul":0.85} | VM modsFor={"solarMul":0.85}; bonus=0; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V26 | 사건 출처 | ui/league-data.js:76 (spring_dust_haze) | why: 연세대 연구팀은 2010~2018년 자료 분석에서 미세먼지가 태양광 발전 효율을 20% 가까이 떨어뜨린다고 보고했다. | 2010~2018, 20 | 관측·계획 근거 문장(엔진 입력 아님); grade=P; sources 2개(기사·[P58] doi), 저장소 gradeNote와 연결. 게임 크기는 {"solarMul":0.85}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V27 | 사건 출처 | ui/league-data.js:67 (spring_dust_haze) | tip: 황사는 못 막는다 — 다른 발전원·저장으로 | 없음 | 선택지 0개; {"solarMul":0.85} | 해당 없음 | 일치 | 없음 |
| V28 | 사건 출처 | ui/league-data.js:68 (light_load_curtailment) | text: 전기가 남는 시간대에 태양광 출력을 줄여요. | {"solarMul":0.75} | VM modsFor={"solarMul":0.75}; bonus=0; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V29 | 사건 출처 | ui/league-data.js:68 (light_load_curtailment) | why: 봄철 경부하기(2025년 3월 1일~6월 1일, 93일)에는 전기가 남아 태양광 출력제어가 잦다. 2025년 1~6월 태양광 출력제어(제주 제외)는 44회였고 호남에서 가장 잦았다(산업부). | 2025, 3, 1, 6, 1, 93, 2025, 1~6, 44 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 2개, 저장소 gradeNote와 연결. 게임 크기는 {"solarMul":0.75}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V30 | 사건 출처 | ui/league-data.js:68 (light_load_curtailment) | tip: 남는 전기는 저장하거나 이웃에 팔 수 있다 | 없음 | 초과 발전은 저장·이웃 판매 가능. 단 이 사건은 solarMul=.75로 생산 전 감소하며, 사건 감소분 자체를 회수하는 효과는 없음 | 해당 없음 | 일치 | 없음 |
| V31 | 사건 출처 | ui/league-data.js:69 (line_opposition_delay) | text: 주민 반대로 대상 연계선 공사가 멈추고 비용이 들어요. | {"tieDown":"dangjin~asan","budgetAdd":-5} | VM modsFor={}; bonus=-5; tieDown=dangjin~asan; core:143·846·907·1336 | 해당 없음 | 불일치 | 없음 |
| V32 | 사건 출처 | ui/league-data.js:69 (line_opposition_delay) | why: 345kV 북당진–신탕정 송전선로는 주민 반대에 따른 입지 선정 지연과 지자체 인허가 거부로 최초 목표(2012년 6월)보다 12년 6개월 늦게 2024년 말 운전을 시작해(2025년 준공식) 국내 최장 지연 전력망 사업이 됐다. | 345, 2012, 6, 12, 6, 2024, 2025 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 5개, 저장소 gradeNote와 연결. 게임 크기는 {"tieDown":"dangjin~asan","budgetAdd":-5}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V33 | 사건 출처 | ui/league-data.js:69 (line_opposition_delay) | talk: 주민 협의·이익공유 / 선로 공사를 이어 간다. 돈으로 모든 반대를 없앨 수는 없다 | 비용 6; dev=없음; grant=없음; cancel=true | VM {}; bonus=-5; 단절=없음; 실제 cost=6 (core respCost) | 예 | 불일치 | 없음 |
| V34 | 사건 출처 | ui/league-data.js:70 (semiconductor_fab_expansion) | text: 반도체 라인 증설! 밤낮없이 전기 수요가 늘고 세수가 들어와요. | {"demandMul":1.08,"budgetAdd":15} | VM modsFor={"demandMul":1.08}; bonus=15; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V35 | 사건 출처 | ui/league-data.js:70 (semiconductor_fab_expansion) | why: 전국 시군구 중 전력 소비 1위는 평택(연 21.77TWh), 2위는 화성(21.37TWh)이며 모두 반도체 공장이 있는 도시다. | 1, 21.77, 2, 21.37 | 관측·계획 근거 문장(엔진 입력 아님); grade=P; sources 3개, 저장소 gradeNote와 연결. 게임 크기는 {"demandMul":1.08,"budgetAdd":15}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V36 | 사건 출처 | ui/league-data.js:70 (semiconductor_fab_expansion) | cond: 조건부 유치(피크 부하 제한) / 수요 증가 절반, 세수도 줄어든다 | 비용 0; dev=0.5; grant=0.6; cancel=false | VM {"demandMul":1.04}; bonus=9; 단절=없음; 실제 cost=0 (core respCost) | 아니오 | 일치 | 없음 |
| V37 | 사건 출처 | ui/league-data.js:70 (semiconductor_fab_expansion) | hold: 유치 보류 / 수요도 세수도 없다 | 비용 0; dev=0; grant=0; cancel=false | VM {"demandMul":1}; bonus=0; 단절=없음; 실제 cost=0 (core respCost) | 예 | 일치 | 없음 |
| V38 | 사건 출처 | ui/league-data.js:71 (datacenter_siting) | text: AI 데이터센터 입주! 밤낮없이 전기 수요가 늘고 지원금이 들어와요. | {"demandMul":1.06,"budgetAdd":10} | VM modsFor={"demandMul":1.06}; bonus=10; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V39 | 사건 출처 | ui/league-data.js:71 (datacenter_siting) | why: 2022년 말 국내 데이터센터 147곳 가운데 약 60%가 수도권에 있고, 앞으로 새로 생길 데이터센터 전력 수요의 약 80%도 수도권에 몰릴 것으로 전망됐다(산업부, 2023). | 2022, 147, 60, 80, 2023 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 1개, 저장소 gradeNote와 연결. 게임 크기는 {"demandMul":1.06,"budgetAdd":10}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V40 | 사건 출처 | ui/league-data.js:71 (datacenter_siting) | cond: 조건부 유치(부하 제한·폐열 공유) / 수요 증가 절반, 지원금도 줄어든다 | 비용 0; dev=0.5; grant=0.6; cancel=false | VM {"demandMul":1.03}; bonus=6; 단절=없음; 실제 cost=0 (core respCost) | 아니오 | 일치 | 없음 |
| V41 | 사건 출처 | ui/league-data.js:71 (datacenter_siting) | hold: 유치 보류 / 수요도 지원금도 없다 | 비용 0; dev=0; grant=0; cancel=false | VM {"demandMul":1}; bonus=0; 단절=없음; 실제 cost=0 (core respCost) | 예 | 일치 | 없음 |
| V42 | 사건 출처 | ui/league-data.js:72 (planned_maintenance) | text: 피크 대비 정비 기간! LNG·석탄 발전 출력이 줄어요. | {"lngCapMul":0.7,"coalCapMul":0.85} | VM modsFor={"coalCapMul":0.85,"lngCapMul":0.7}; bonus=0; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V43 | 사건 출처 | ui/league-data.js:72 (planned_maintenance) | why: 발전기는 수요가 낮은 봄·가을에 계획예방정비 일정을 모아 잡으며(원전은 정해진 주기로 정기검사를 받는다), 이 시기에는 공급능력이 낮아진다. | 없음 | 관측·계획 근거 문장(엔진 입력 아님); grade=O*; sources 3개, 저장소 gradeNote와 연결. 게임 크기는 {"lngCapMul":0.7,"coalCapMul":0.85}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V44 | 사건 출처 | ui/league-data.js:72 (planned_maintenance) | resched: 정비 일정 나눠 하기 / 출력 감소를 줄이지만 정비 기간이 길어진다 | 비용 2; dev=0.5; grant=없음; cancel=false | VM {"coalCapMul":0.925,"lngCapMul":0.85}; bonus=0; 단절=없음; 실제 cost=2 (core respCost) | 예 | 불일치 | 없음 |
| V45 | 사건 출처 | ui/league-data.js:73 (coal_phaseout) | text: 탈석탄 전환! 석탄 출력이 줄고 전환 지원금이 들어와요. | {"coalCapMul":0.8,"budgetAdd":10} | VM modsFor={"coalCapMul":0.8}; bonus=10; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V46 | 사건 출처 | ui/league-data.js:73 (coal_phaseout) | why: 태안화력 1호기가 2025년 12월 31일 가동을 종료했다. 정부는 탈석탄동맹(PPCA)에 가입해 2040년 탈석탄 목표를 밝혔고, 당진화력 1~4호기는 2030년까지 전환 대상이다(산업부, 2024). | 1, 2025, 12, 31, 2040, 1~4, 2030, 2024 | 관측·계획 근거 문장(엔진 입력 아님); grade=O*; sources 3개, 저장소 gradeNote와 연결. 게임 크기는 {"coalCapMul":0.8,"budgetAdd":10}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V47 | 사건 출처 | ui/league-data.js:73 (coal_phaseout) | tip: 지원금은 들어오지만 석탄 출력이 줄어든다 | 없음 | 선택지 0개; {"coalCapMul":0.8,"budgetAdd":10} | 해당 없음 | 일치 | 없음 |
| V48 | 사건 출처 | ui/league-data.js:74 (re100_buyer) | text: RE100 기업의 재생전기 구매! 예산이 늘고 탄소비용이 붙어요. | {"budgetAdd":12,"carbonTaxOn":true} | VM modsFor={"tax":true}; bonus=12; tieDown=없음; core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V49 | 사건 출처 | ui/league-data.js:74 (re100_buyer) | why: 2021년 본격 도입된 한국형 RE100(K-RE100)으로 기업이 녹색프리미엄·REC·제3자 PPA·자가발전으로 재생에너지를 조달할 수 있게 됐다. | 2021, 100, 100, 3 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 4개, 저장소 gradeNote와 연결. 게임 크기는 {"budgetAdd":12,"carbonTaxOn":true}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V50 | 사건 출처 | ui/league-data.js:74 (re100_buyer) | tip: 탄소 비용이 붙는다 — 재생 비중을 높이면 덜 낸다 | 없음 | 선택지 0개; {"budgetAdd":12,"carbonTaxOn":true} | 해당 없음 | 일치 | 없음 |
| V51 | 사건 출처 | ui/league-data.js:75 (regional_tariff) | text: 사건 기간 산업용 전기요금이 낮아져 기업 입지 여건이 좋아져요. | {"industryPriceMul":0.92} | VM modsFor={}; bonus=0; tieDown=없음; econMonth priceMul=.92 → 산업 price 50→56.666667(동일 원가); core:143·846·907·1336 | 해당 없음 | 일치 | 없음 |
| V52 | 사건 출처 | ui/league-data.js:75 (regional_tariff) | why: 분산에너지 활성화 특별법(2024.6 시행)에 따라 정부는 2026년 산업용 지역별 차등요금 설계안을 공개했으며, 비수도권은 최대 10% 인하하는 방안이다. | 2024.6, 2026, 10 | 관측·계획 근거 문장(엔진 입력 아님); grade=O; sources 2개, 저장소 gradeNote와 연결. 게임 크기는 {"industryPriceMul":0.92}로 별도 | 해당 없음 | 일치 | 없음(원문 사실 재검증 금지 범위) |
| V53 | 사건 출처 | ui/league.js:3293 | 사건 크기·예보→확정 | 100×(effect−1)×x; 예보 x=1±fc | VM evSize 16건; modsFor는 1+(effect−1)×x×dev; 표시는 대응 전 크기 | 예 | 일치 | 없음 |
| V54 | 사건 출처 | ui/league.js:3324 | 우리 대응 후 확정 효과 | x×dev | dev가 있고 knobs 없을 때 evSize 호출; 제설은 특정 손잡이라 수치 후표시 생략 | 예 | 일치 | 없음 |
| V55 | 사건 출처 | ui/league.js:3335 | 사건 자료·출처·기준연월·크기 G | why 속 연도 추출 | 출처 URL 목록은 자료에서 읽음. 기준연월은 why의 모든 연도이며 발행일과 구분 안 됨 | 해당 없음 | 일치 | tests/league/econui.py:1087(외부링크·기준연월 표시; 미실행) |
| V56 | 사건 출처 | ui/league.js:3331 | 해당 설비 없어 우리 발전 영향 없음(이웃 거래 가능) | 없음 | effect 키 전부 EVENT_KINDS인 경우 네트워크 kinds 확인; 현재 계획/운영 계획만 | 해당 없음 | 일치 | 30-s7-attribution.js |
| V57 | 사건 출처 | ui/league.js:3331 | 현상 근거 O/O*/P/M, 크기·대응 G | 없음 | grade·effect 분리. 외부 원문을 이번 감사에서 검증한 뜻 아님 | 해당 없음 | 일치 | 없음 |
| V58 | 사건 출처 | ui/econ.js:613; ui/econ-data.js intl.events | eu_indirect: 가상 결정: 철강 수출에 전력 탄소도 반영해요 | 기간999~999; fx={"eu_indirect":1} | {"eu_indirect":1}; econ intlStep/outIdx | 예 | 일치 | 없음 |
| V59 | 사건 출처 | ui/econ.js:613; ui/econ-data.js intl.events | ship_red: 물류비가 오르고 항만 산출이 줄어요 | 기간3~6; fx={"ship":-0.3} | ship−.3은 항만 logi/out만 낮춤. 별도 물류비 지출 항목 없음; econ intlStep/outIdx | 예 | 근사인데 표시 없음 | 없음 |
| V60 | 사건 출처 | ui/econ.js:613; ui/econ-data.js intl.events | lng_spike: LNG·디젤 연료비가 크게 올라요 | 기간2~5; fx={"lng":0.5} | lng+0.5, fx 동시지수로 fuelMul; 디젤·석탄 fuelMul^.6; econ intlStep/outIdx | 예 | 일치 | 없음 |
| V61 | 사건 출처 | ui/econ.js:613; ui/econ-data.js intl.events | export_boom: 반도체 도시 산출이 늘어요 | 기간4~8; fx={"export":{"semi":0.25,"display":0.1}} | {"export":{"semi":0.25,"display":0.1}}; econ intlStep/outIdx | 예 | 일치 | 없음 |
| V62 | 사건 출처 | ui/econ.js:613; ui/econ-data.js intl.events | auto_slump: 자동차 도시 산출이 줄어요 | 기간3~6; fx={"export":{"auto":-0.2}} | {"export":{"auto":-0.2}}; econ intlStep/outIdx | 예 | 일치 | 없음 |
| V63 | 사건 출처 | ui/econ.js:613; ui/econ-data.js intl.events | cbam: 철강 공정의 직접배출이 많을수록, EU 수출 비중만큼 산출이 깎여요(단계 도입) | 기간999~999; fx={"cbam":1} | outIdx cbam은 steel비중×exportShare×cbamEuShare×cbamDrop×phase×eduCbam; 직접배출 강도 인수 없음. eu_indirect일 때만 전력 co2Int 사용 | 예 | 불일치 | 없음 |

### 기술 카드 효과

| ID | 범주 | 파일:줄 | 화면 문구(짧게) | 문구 속 수치·식 | 엔진이 실제로 쓰는 값·식 | 수치를 자료에서 읽는가 | 일치 판정 | 이를 단언하는 검사 |
|---|---|---|---|---|---|---|---|---|
| T01 | 기술 카드 효과 | ui/tech-data.js:84; ui/league.js:609 | grid eff: 송전 손실 0.50%/칸 → 0.33%/칸 / 리그: 송전 손실 0.50%/칸 → 0.33%/칸 | 0.50, 0.33 | PK.lossPerHex=.005; ×2/3=.0033333333; build.js:276·742 | 예 | 일치 | 없음 |
| T02 | 기술 카드 효과 | ui/tech-data.js:85; ui/league.js:610 | hvdc eff: 연계선 용량 ×1.5로 송전 용량을 늘리고 계통 제약을 푼다, 새 선 건설비 ×1.3 / 리그: 연계선 용량 ×1.5로 송전 용량을 늘리고 계통 제약을 푼다, 새 선 건설비 ×1.3 | 1.5, 1.3 | hvdcCap=1.5, hvdcCost=1.3, hvdcLoss=.01; effectiveTie: 4→6 MW; core:109·896 | 예 | 일치 | 33-model-explanations.js [10];35-d73-d74-d79.js; tests/league/econui.py:983(용량 변형·미실행) |
| T03 | 기술 카드 효과 | ui/tech-data.js:86; ui/league.js:611 | scable eff: 연계선 용량 ×1.5, 손실 ×0.5, 냉각 월 0.5억/선 / 리그: 연계선 용량 ×1.5, 손실 ×0.5, 냉각 0.5억/선/달 | 1.5, 0.5, 0.5 | scableCap=1.5, scableLoss=.5, cooling=.5; 4→6 MW, .01→.005; 양끝 도입 시 .25씩; core:896·900 | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T04 | 기술 카드 효과 | ui/tech-data.js:87; ui/league.js:612 | sic eff: 재생 출력 ×1.015 / 리그: 재생 출력 ×1.015 | 1.015 | sicOutput=1.015; core:883; 실제 61.24896431→62.16769877 MWh | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T05 | 기술 카드 효과 | ui/tech-data.js:88; ui/league.js:613 | bms eff: 하한 10→5%, 왕복 효율 85→87% / 리그: 잔량 하한 10% → 5% · 왕복 효율 85% → 87%(한 방향 약 93.3%) | 10, 5, 85, 87 | bmsFloor=.05; bmsEfficiency=.933; M.batEff=.922; 왕복 .850084→.870489 | 아니오 | 일치 | 33-model-explanations.js [7](동적 화면만) |
| T06 | 기술 카드 효과 | ui/tech-data.js:89; ui/league.js:614 | tandem eff: 새 탠덤 태양광 출력·건설비 ×1.15 / 리그: 새 탠덤 태양광 출력 ×1.2, 건설비 ×1.2 | 1.15 | tandemOutput=tandemCost=1.2; build:1073; 출력 61.24896431→73.49875717 MWh, 비용 8→9.6 | 아니오 | 불일치 | 없음(원본 eff); tests/league/econui.py:983(리그 tandemOutput 변형·미실행) |
| T07 | 기술 카드 효과 | ui/tech-data.js:90; ui/league.js:615 | nbat eff: 새 배터리 용량 ×1.25, 화재 면역 / 리그: 새 배터리 용량 20 MWh(×1.25), 화재 면역 | 1.25 | nbatCapacity=1.25; 16×1.25=20; build:1075. 화재 사건/피해 상태/면역 분기 없음 | 아니오 | 불일치 | 없음 |
| T08 | 기술 카드 효과 | ui/tech-data.js:91; ui/league.js:616 | mass eff: 새 태양광·배터리 건설비 ×0.92 / 리그: 새 태양광·배터리 건설비 ×0.92 | 0.92 | massCost=.92; core:600 새 solar/roof/tandem/tandem_roof/battery/nbat paidCost에만 적용 | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T09 | 기술 카드 효과 | ui/tech-data.js:92; ui/league.js:617 | h2store eff: 200 MWh 장주기 저장, 왕복 35% / 리그: 200 MWh 저장, 왕복 35% | 200, 35 | h2MWh=200, efficiency=.35; 57.88027127→20.25809495 MWh, 빈 탱크 시작; build:715 | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T10 | 기술 카드 효과 | ui/tech-data.js:93; ui/league.js:618 | h2mix eff: LNG CO₂ ×0.88 / 리그: LNG CO₂ ×0.88 | 0.88 | h2Co2=.88은 상한; build:815 남은 연결 수소만 사용. 수소 없으면 LNG CO₂ ×1 | 아니오 | 불일치 | 없음(엔진 10-tech.js 빈 탱크 ×1) |
| T11 | 기술 카드 효과 | ui/tech-data.js:94; ui/league.js:619 | ccu eff: 석탄 CO₂ ×0.4, 출력 ×0.85 / 리그: 석탄 CO₂ ×0.4, 출력 ×0.79 | 0.4, 0.85 | ccuCo2=.4, ccuOutput=.79; core:884; 실제 석탄 출력×.79 | 아니오 | 불일치 | 없음(원본 eff·출력계수); tests/league/econui.py:983(리그 ccuCo2 변형·미실행) |
| T12 | 기술 카드 효과 | ui/tech-data.js:95; ui/league.js:620 | smr eff: 2.96 MW, 39.42억, 건설 12턴 / 리그: 2.957 MW, 39.42억, 공사 12달 | 2.96, 39.42, 12 | smrMW=680/230=2.956521739, cost=39.420289855, turns=12; build:1077 | 예 | 일치 | 38-d81-buildlead.js(공사; 전체 문구 검사는 없음) |
| T13 | 기술 카드 효과 | ui/tech-data.js:96; ui/league.js:623 | fcst eff: 저녁 피크에 저장을 남기고 사건 예보 범위를 0.7배로 / 리그: 저녁 피크에 저장을 남기고 사건 예보 범위를 0.7배로 | 0.7 | fcstWidth=.7은 자르기 전 반폭계수. monsoon x=.8 고정 VM [.7,.996], 실제폭 .296/기본폭.6=.493333배; 원래범위로 clipping | 예 | 근사인데 표시 없음 | 33-model-explanations.js [5](엔진 구간; 원본 텍스트 검사는 없음) |
| T14 | 기술 카드 효과 | ui/tech-data.js:97; ui/league.js:621 | vpp eff: 수요반응 ×1.5·비용 ×0.5, 출력제어 ×0.8 / 리그: 수요반응 ×1.5·비용 ×0.5, 출력제어 손실 ×0.8 | 1.5, 0.5, 0.8 | drEffect=1.5, drCost=.5, vppCurtail=.8; core:886; build demand/정책비 | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T15 | 기술 카드 효과 | ui/tech-data.js:98; ui/league.js:622 | re100 eff: 정책 선택 시 산업 매력 재생 항 가중 ×1.5 / 리그: 정책 선택 시 산업 매력의 재생 항목 가중 ×1.5 | 1.5 | ECON_DATA.re100PolicyWeight=1.5; industryAttract 재생 가중만 ×1.5, 정규화 후 평가 | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T16 | 기술 카드 효과 | ui/tech-data.js:84; ui/league.js:662 | grid why: 선로 상태를 살펴 전기를 보낼 때의 손실을 줄여요. | 없음 | PK.lossPerHex=.005; ×2/3=.0033333333; build.js:276·742 | 해당 없음 | 일치 | 없음 |
| T17 | 기술 카드 효과 | ui/tech-data.js:85; ui/league.js:662 | hvdc why: 짧은 거리에서는 변환소 손실 때문에 손실 개선을 기대하지 않아요. | 없음 | hvdcCap=1.5, hvdcCost=1.3, hvdcLoss=.01; effectiveTie: 4→6 MW; core:109·896 | 해당 없음 | 일치 | 없음 |
| T18 | 기술 카드 효과 | ui/tech-data.js:86; ui/league.js:662 | scable why: 저항은 작아져도 냉각 전력과 비용이 들어요. | 없음 | scableCap=1.5, scableLoss=.5, cooling=.5; 4→6 MW, .01→.005; 양끝 도입 시 .25씩; core:896·900 | 해당 없음 | 일치 | 없음 |
| T19 | 기술 카드 효과 | ui/tech-data.js:87; ui/league.js:662 | sic why: 같은 햇빛과 바람에서 변환 손실을 줄여요. | 없음 | sicOutput=1.015; core:883; 실제 61.24896431→62.16769877 MWh | 해당 없음 | 일치 | 없음 |
| T20 | 기술 카드 효과 | ui/tech-data.js:88; ui/league.js:662 | bms why: 배터리 잔량을 더 정확히 읽어 저장한 전기를 넓게 써요. | 없음 | bmsFloor=.05; bmsEfficiency=.933; M.batEff=.922; 왕복 .850084→.870489 | 해당 없음 | 일치 | 없음 |
| T21 | 기술 카드 효과 | ui/tech-data.js:89; ui/league.js:662 | tandem why: 기존 패널은 바뀌지 않아요. | 없음 | tandemOutput=tandemCost=1.2; build:1073; 출력 61.24896431→73.49875717 MWh, 비용 8→9.6 | 해당 없음 | 일치 | 없음 |
| T22 | 기술 카드 효과 | ui/tech-data.js:90; ui/league.js:662 | nbat why: 새 배터리는 더 많이 저장하며, 잔량 관리에는 상태 진단 기술이 필요해요. | 없음 | nbatCapacity=1.25; 16×1.25=20; build:1075. 화재 사건/피해 상태/면역 분기 없음 | 해당 없음 | 일치 | 없음 |
| T23 | 기술 카드 효과 | ui/tech-data.js:91; ui/league.js:662 | mass why: 시장 전체의 가격 하락을 한 도시의 연구 성과로 보지는 않아요. | 없음 | massCost=.92; core:600 새 solar/roof/tandem/tandem_roof/battery/nbat paidCost에만 적용 | 해당 없음 | 일치 | 없음 |
| T24 | 기술 카드 효과 | ui/tech-data.js:92; ui/league.js:662 | h2store why: 많이 저장하지만 손실이 크고 처음에는 비어 있어요. | 없음 | h2MWh=200, efficiency=.35; 57.88027127→20.25809495 MWh, 빈 탱크 시작; build:715 | 해당 없음 | 일치 | 없음 |
| T25 | 기술 카드 효과 | ui/tech-data.js:93; ui/league.js:662 | h2mix why: 부피 비율과 열량 비율은 달라요. | 없음 | h2Co2=.88은 상한; build:815 남은 연결 수소만 사용. 수소 없으면 LNG CO₂ ×1 | 해당 없음 | 일치 | 없음 |
| T26 | 기술 카드 효과 | ui/tech-data.js:94; ui/league.js:662 | ccu why: 포집에도 전기가 들어요. | 없음 | ccuCo2=.4, ccuOutput=.79; core:884; 실제 석탄 출력×.79 | 해당 없음 | 일치 | 없음 |
| T27 | 기술 카드 효과 | ui/tech-data.js:95; ui/league.js:662 | smr why: 수업 시간에 맞춰 공사 기간을 줄였어요. 실제 인허가 기간과는 달라요. | 없음 | smrMW=680/230=2.956521739, cost=39.420289855, turns=12; build:1077 | 해당 없음 | 일치 | 없음 |
| T28 | 기술 카드 효과 | ui/tech-data.js:96; ui/league.js:662 | fcst why: 예측은 날씨를 바꾸지 않아요. | 없음 | fcstWidth=.7; core:426 범위 clipping, build:726·794 저녁 저장 예약 | 해당 없음 | 일치 | 없음 |
| T29 | 기술 카드 효과 | ui/tech-data.js:97; ui/league.js:662 | vpp why: 효과 크기는 수업을 위한 가정이에요. | 없음 | drEffect=1.5, drCost=.5, vppCurtail=.8; core:886; build demand/정책비 | 해당 없음 | 일치 | 없음 |
| T30 | 기술 카드 효과 | ui/tech-data.js:98; ui/league.js:662 | re100 why: 재생 전기가 부족하면 기업이 이 도시를 고를 매력이 낮아져요. | 없음 | ECON_DATA.re100PolicyWeight=1.5; industryAttract 재생 가중만 ×1.5, 정규화 후 평가 | 해당 없음 | 일치 | 없음 |
| T31 | 기술 카드 효과 | ui/tech-data.js:84; ui/league.js:663 | grid 필요 연구량·실증비 | 8 / 4억 | TECH_DATA.cards.grid.need=8, demo=4; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T32 | 기술 카드 효과 | ui/tech-data.js:85; ui/league.js:663 | hvdc 필요 연구량·실증비 | 12 / 4억 | TECH_DATA.cards.hvdc.need=12, demo=4; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T33 | 기술 카드 효과 | ui/tech-data.js:86; ui/league.js:663 | scable 필요 연구량·실증비 | 24 / 10억 | TECH_DATA.cards.scable.need=24, demo=10; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T34 | 기술 카드 효과 | ui/tech-data.js:87; ui/league.js:663 | sic 필요 연구량·실증비 | 9 / 3억 | TECH_DATA.cards.sic.need=9, demo=3; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T35 | 기술 카드 효과 | ui/tech-data.js:88; ui/league.js:663 | bms 필요 연구량·실증비 | 6 / 3억 | TECH_DATA.cards.bms.need=6, demo=3; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T36 | 기술 카드 효과 | ui/tech-data.js:89; ui/league.js:663 | tandem 필요 연구량·실증비 | 12 / 5억 | TECH_DATA.cards.tandem.need=12, demo=5; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T37 | 기술 카드 효과 | ui/tech-data.js:90; ui/league.js:663 | nbat 필요 연구량·실증비 | 24 / 10억 | TECH_DATA.cards.nbat.need=24, demo=10; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T38 | 기술 카드 효과 | ui/tech-data.js:91; ui/league.js:663 | mass 필요 연구량·실증비 | 18 / 8억 | TECH_DATA.cards.mass.need=18, demo=8; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T39 | 기술 카드 효과 | ui/tech-data.js:92; ui/league.js:663 | h2store 필요 연구량·실증비 | 18 / 8억 | TECH_DATA.cards.h2store.need=18, demo=8; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T40 | 기술 카드 효과 | ui/tech-data.js:93; ui/league.js:663 | h2mix 필요 연구량·실증비 | 12 / 6억 | TECH_DATA.cards.h2mix.need=12, demo=6; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T41 | 기술 카드 효과 | ui/tech-data.js:94; ui/league.js:663 | ccu 필요 연구량·실증비 | 18 / 10억 | TECH_DATA.cards.ccu.need=18, demo=10; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T42 | 기술 카드 효과 | ui/tech-data.js:95; ui/league.js:663 | smr 필요 연구량·실증비 | 36 / 20억 | TECH_DATA.cards.smr.need=36, demo=20; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T43 | 기술 카드 효과 | ui/tech-data.js:96; ui/league.js:663 | fcst 필요 연구량·실증비 | 6 / 2억 | TECH_DATA.cards.fcst.need=6, demo=2; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T44 | 기술 카드 효과 | ui/tech-data.js:97; ui/league.js:663 | vpp 필요 연구량·실증비 | 12 / 4억 | TECH_DATA.cards.vpp.need=12, demo=4; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T45 | 기술 카드 효과 | ui/tech-data.js:98; ui/league.js:663 | re100 필요 연구량·실증비 | 12 / 4억 | TECH_DATA.cards.re100.need=12, demo=4; numbers 복제 값 같음; core:205·연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T46 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | grid 유레카: 내부 송전선 운영 | 없음 | core.eurekaMet:221: plan.lines.length&gt;0(실제 통전 여부를 요구하지 않음) | 해당 없음 | 불일치 | 없음(엔진 10-tech.js) |
| T47 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | hvdc 유레카: 연계선 2개 연결 | 2 | core.eurekaMet:221: connectedTie 2개 이상 | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T48 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | scable 유레카: HVDC 연계선 운영 | 없음 | core.eurekaMet:221: built hvdc선 있음(내부 연결 여부는 추가 검사 안 함) | 해당 없음 | 불일치 | 없음(엔진 10-tech.js) |
| T49 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | sic 유레카: 재생 발전 운영 | 없음 | core.eurekaMet:221: result.renPct&gt;0 | 해당 없음 | 일치 | 없음(엔진 10-tech.js) |
| T50 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | bms 유레카: 배터리 운영 | 없음 | core.eurekaMet:221: 통전 battery/nbat 존재 | 해당 없음 | 일치 | 없음(엔진 10-tech.js) |
| T51 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | tandem 유레카: 태양광 10기 운영 | 10 | core.eurekaMet:221: 통전 태양광류&gt;=10 AND renPct&gt;0 | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T52 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | nbat 유레카: BMS 도입 후 배터리 운영 | 없음 | core.eurekaMet:221: bms 도입 AND 통전 battery/nbat | 해당 없음 | 일치 | 없음(엔진 10-tech.js) |
| T53 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | mass 유레카: 탠덤 또는 차세대 배터리 운영 | 없음 | core.eurekaMet:221: 통전 tandem/tandem_roof/nbat | 해당 없음 | 일치 | 없음(엔진 10-tech.js) |
| T54 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | h2store 유레카: 출력제어 발생 | 없음 | core.eurekaMet:221: curtailMWh&gt;0 OR 출력제어 사건+renPct&gt;0 | 해당 없음 | 일치 | 없음(엔진 10-tech.js) |
| T55 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | h2mix 유레카: 수소 탱크 운영 | 없음 | core.eurekaMet:221: 통전 h2store | 해당 없음 | 일치 | 없음(엔진 10-tech.js) |
| T56 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | ccu 유레카: 석탄 발전 운영 | 없음 | core.eurekaMet:221: 통전 coal AND co2Prod&gt;0 | 해당 없음 | 일치 | 없음(엔진 10-tech.js) |
| T57 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | smr 유레카: 지지율이 시작보다 5%p 넘게 떨어지지 않음 또는 시위 없음 | 5 | core.eurekaMet:221: approval&gt;=approval0−5 OR !unrest | 예 | 일치 | 33-model-explanations.js [4];34-model-copy.js [4] |
| T58 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | fcst 유레카: 폭염 사건 경험 | 없음 | core.eurekaMet:221: 현재 heatwave_peak 존재 | 해당 없음 | 일치 | 없음(엔진 10-tech.js) |
| T59 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | vpp 유레카: 수요반응 정책 3달 운영 | 3 | core.eurekaMet:221: rs.drMonths&gt;=3 | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T60 | 기술 카드 효과 | ui/tech-data.js:152; ui/league.js:624 | re100 유레카: 재생 비중 30% 이상 운영 | 30 | core.eurekaMet:221: renPct&gt;=30 | 아니오 | 일치 | 없음(엔진 10-tech.js) |
| T61 | 기술 카드 효과 | ui/tech-data.js:103; ui/league.js:637 | hvdc 교육용 배속·비교 기준: 현실 비교값 없음 · 국내 사례의 목적은 계통 제약 해소 | 비교값 없음 | scale.v=null; 비교 원자료 null; 증가폭 비율은 엔진 효과와 별도 | 해당 없음 | 근사 표시 있음 | 없음(비율값); tests/league/tech.py:402(형식·미실행) |
| T62 | 기술 카드 효과 | ui/tech-data.js:103; ui/league.js:637 | scable 교육용 배속·비교 기준: 송전 용량 증가폭: 기존의 5배 | 0.125 | scale.v=0.125; 비교 원자료 {"multiplier":5}; 증가폭 비율은 엔진 효과와 별도 | 아니오 | 근사 표시 있음 | 없음(비율값); tests/league/tech.py:402(형식·미실행) |
| T63 | 기술 카드 효과 | ui/tech-data.js:103; ui/league.js:637 | tandem 교육용 배속·비교 기준: 모듈 효율 증가폭: 일반 22% → 탠덤 26.9% | 0.8979591836734695 | scale.v=0.8979591836734695; 비교 원자료 {"from":22,"to":26.9,"unit":"%"}; 증가폭 비율은 엔진 효과와 별도 | 아니오 | 근사 표시 있음 | 없음(비율값); tests/league/tech.py:402(형식·미실행) |
| T64 | 기술 카드 효과 | ui/tech-data.js:103; ui/league.js:637 | nbat 교육용 배속·비교 기준: 셀 에너지 밀도 증가폭 40%(팩 용량과 직접 같지 않아요) | 0.625 | scale.v=0.625; 비교 원자료 {"increase":0.4}; 증가폭 비율은 엔진 효과와 별도 | 아니오 | 근사 표시 있음 | 없음(비율값); tests/league/tech.py:402(형식·미실행) |
| T65 | 기술 카드 효과 | ui/tech-data.js:103; ui/league.js:637 | h2store 교육용 배속·비교 기준: 왕복 효율 30~40%의 가운데 값 35% | 1 | scale.v=1; 비교 원자료 {"range":[0.3,0.4],"midpoint":0.35}; 증가폭 비율은 엔진 효과와 별도 | 아니오 | 근사 표시 있음 | 없음(비율값); tests/league/tech.py:402(형식·미실행) |
| T66 | 기술 카드 효과 | ui/tech-data.js:103; ui/league.js:637 | h2mix 교육용 배속·비교 기준: 수소 30 vol% 혼소의 열량 환산 CO₂ 감소 12%(M) | 1 | scale.v=1; 비교 원자료 {"reduction":0.12,"grade":"M"}; 증가폭 비율은 엔진 효과와 별도 | 아니오 | 근사 표시 있음 | 없음(비율값); tests/league/tech.py:402(형식·미실행) |
| T67 | 기술 카드 효과 | ui/tech-data.js:103; ui/league.js:637 | ccu 교육용 배속·비교 기준: 포집률 상단 90% | 0.6666666666666666 | scale.v=0.6666666666666666; 비교 원자료 {"capture":0.9}; 증가폭 비율은 엔진 효과와 별도 | 아니오 | 근사 표시 있음 | 없음(비율값); tests/league/tech.py:402(형식·미실행) |
| T68 | 기술 카드 효과 | ui/tech-data.js:18; ui/league.js:645 | HVDC 출처 note: 용량×1.5·현실 비교값 없음 | 1.5 | hvdcCap=1.5, loss=.01(기본과 같음), note 직접 출력 | 예 | 일치 | 35-d73-d74-d79.js |
| T69 | 기술 카드 효과 | ui/tech-data.js:148; ui/league.js:3330 | 예측·VPP 있으면 폭염 피해 줄음 | 없음 | fcst 저장 예약; vpp는 demandMul=1+.12×.7=1.084; fcst는 수요 자체를 줄이지 않음 | 해당 없음 | 일치 | 없음 |
| T70 | 기술 카드 효과 | ui/tech-data.js:149; ui/league.js:3330 | 초전도 있으면 태풍 연계선 단절 막음 | 없음 | core:1189: 태풍 단독 원인·해당 선 끝 도입 시 shield | 해당 없음 | 일치 | 10-tech.js 태풍 실측 |
| T71 | 기술 카드 효과 | ui/league.js:675 | 이전 필요량·사용료·한도 | 50%, .5억, 6달, 3억 | licenseNeed=.5; royalty=.5; royaltyMonths=6; royaltyCap=3; core 연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T72 | 기술 카드 효과 | ui/league.js:676 | 공동 실증비 | 50%씩 | jointShare=.5; core 연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T73 | 기술 카드 효과 | ui/league.js:664 | 유레카 추가 진척 | 남은 양 33.3% | eurekaFrac=1/3; core 연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |
| T74 | 기술 카드 효과 | ui/league.js:574 | 칭호 필요 도입 카드 수 | 3/2/1 | titleGrid=3,titleOther=2,titleSingle=1; core 연구 처리 | 예 | 일치 | 없음(엔진 10-tech.js) |

### 집단 만족 이유

| ID | 범주 | 파일:줄 | 화면 문구(짧게) | 문구 속 수치·식 | 엔진이 실제로 쓰는 값·식 | 수치를 자료에서 읽는가 | 일치 판정 | 이를 단언하는 검사 |
|---|---|---|---|---|---|---|---|---|
| G1 | 집단 만족 이유 | ui/league.js:553 | worker 만족도 목표 항목 막대 | {"rel":0.35,"jobs":0.25,"price":0.05,"tax":0.15,"svc":0.15,"crowd":0.05} | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=1; 지연·별도 감점 전 | 예 | 일치 | 없음(34-model-copy.js는 pending 키만) |
| G2 | 집단 만족 이유 | ui/league.js:553 | youth 만족도 목표 항목 막대 | {"rel":0.3,"jobs":0.25,"crowd":0.1,"svc":0.15,"tax":0.15,"air":0.05} | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=1; 지연·별도 감점 전 | 예 | 일치 | 없음(34-model-copy.js는 pending 키만) |
| G3 | 집단 만족 이유 | ui/league.js:553 | senior 만족도 목표 항목 막대 | {"rel":0.35,"svc":0.35,"tax":0.1,"price":0.1,"air":0.1} | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=0.9999999999999999; 지연·별도 감점 전 | 예 | 일치 | 없음(34-model-copy.js는 pending 키만) |
| G4 | 집단 만족 이유 | ui/league.js:553 | business 만족도 목표 항목 막대 | {"rel":0.25,"A":0.2,"out":0.2,"taxI":0.25,"svc":0.1} | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=1; 지연·별도 감점 전 | 예 | 일치 | 없음(34-model-copy.js는 pending 키만) |
| G5 | 집단 만족 이유 | ui/league.js:553 | farm 만족도 목표 항목 막대 | {"rel":0.3,"tax":0.25,"svc":0.25,"price":0.1,"air":0.1} | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=1; 지연·별도 감점 전 | 예 | 일치 | 없음(34-model-copy.js는 pending 키만) |
| G6 | 집단 만족 이유 | ui/league.js:553 | green 만족도 목표 항목 막대 | {"rel":0.2,"svc":0.15,"tax":0.1,"air":0.2,"ren":0.2,"co2":0.15} | econ.groupTargets: Σ(part[k]×w[k]/Σw); 현재 Σw=0.9999999999999999; 지연·별도 감점 전 | 예 | 일치 | 없음(34-model-copy.js는 pending 키만) |
| G7 | 집단 만족 이유 | ui/league.js:557 | rel 앞으로 반영될 변화 | (목표−현재 lagL)×집단 가중 | lagRate .5; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 34-model-copy.js [1] |
| G8 | 집단 만족 이유 | ui/league.js:557 | price 앞으로 반영될 변화 | (목표−현재 lagL)×집단 가중 | lagRate .5; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 34-model-copy.js [1] |
| G9 | 집단 만족 이유 | ui/league.js:557 | jobs 앞으로 반영될 변화 | (목표−현재 lagL)×집단 가중 | lagRate .5; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 34-model-copy.js [1] |
| G10 | 집단 만족 이유 | ui/league.js:557 | svc 앞으로 반영될 변화 | (목표−현재 lagL)×집단 가중 | lagRate .15; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 34-model-copy.js [1] |
| G11 | 집단 만족 이유 | ui/league.js:557 | crowd 앞으로 반영될 변화 | (목표−현재 lagL)×집단 가중 | lagRate .15; pending 텍스트는 전체 남은 차이, 이번 달 변화 아님 | 예 | 일치 | 34-model-copy.js [1] |
| G12 | 집단 만족 이유 | ui/league.js:154·557; ui/econ.js:537 | air 집단 기여 이름·점수 | 80−4×29×PM증분 | lagL.air 대신 즉시 교육용 점수 | 예 | 일치 | 29-r3-air.js |
| G13 | 집단 만족 이유 | ui/league.js:154·557; ui/econ.js:537 | tax 집단 기여 이름·점수 | clamp(60−8×(step−.5×평균)×(증세면1.955)) | taxSatisfaction | 예 | 일치 | 없음 |
| G14 | 집단 만족 이유 | ui/league.js:154·557; ui/econ.js:537 | taxI 집단 기여 이름·점수 | 산업 세금도 같은 상대세율 식 | taxSatisfaction(policy.taxInd) | 예 | 일치 | 없음 |
| G15 | 집단 만족 이유 | ui/league.js:154·557; ui/econ.js:537 | A 집단 기여 이름·점수 | 현재 산업 매력 | C.A | 예 | 일치 | 없음 |
| G16 | 집단 만족 이유 | ui/league.js:154·557; ui/econ.js:537 | out 집단 기여 이름·점수 | 100×(out−.5)/(.7) | outMin=.5,outMax=1.2 | 예 | 일치 | 없음 |
| G17 | 집단 만족 이유 | ui/league.js:154·557; ui/econ.js:537 | ren 집단 기여 이름·점수 | 100×renS/50 | reTarget=50, renS .15 지연 | 예 | 일치 | 없음 |
| G18 | 집단 만족 이유 | ui/league.js:154·557; ui/econ.js:537 | co2 집단 기여 이름·점수 | B80 탄소 부분 점수 | carbonScore(C,data) | 예 | 일치 | 35-d73-d74-d79.js |
| G19 | 집단 만족 이유 | ui/league.js:543·545; ui/econ.js:568 | 지지율 전체 변화 이유 | 최대 &#124;delta&#124; 1개 | approvalChangeCause(causes[0]); 집단 비중×회복(.152)/하락(1)×기여차 | 예 | 일치 | 없음 |
| G20 | 집단 만족 이유 | ui/league.js:543·545; ui/econ.js:568 | 최저 만족 집단 불만 | 현재 만점 기여 대비 최대 부족 | lowestGroupDissatisfaction; 월 변화와 별개, 모형 추정 | 예 | 근사 표시 있음 | 없음 |
| G21 | 집단 만족 이유 | ui/league.js:543·545; ui/econ.js:568 | 집단 비중·만족 | share×100; sat | groupKeys 6개 각각 c.groups[k], share, 0~100 | 예 | 일치 | 없음 |
| G22 | 집단 만족 이유 | ui/league.js:543·545; ui/econ.js:568 | 지지율 평가선 | 평균 대비 −10%p | approvalRelative=(현재−시작)−참가도시 평균변화; approvalDrop=10 | 예 | 일치 | 34-model-copy.js [2] |
| G23 | 집단 만족 이유 | ui/league.js:543·545; ui/econ.js:568 | 평가 간격·다음 평가 | 12−t%12 | reviewEvery=12; 평가 달 report.review.pass 우선 | 예 | 일치 | 34-model-copy.js [2] |
| G24 | 집단 만족 이유 | ui/league.js:547; ui/build.js:296 | 정책 주민세 | 세입↑ / 주민 매력↓ | resTax×(1+.25×taxRes), livability tax=60−10×상대세율 | 예 | 일치 | 없음 |
| G25 | 집단 만족 이유 | ui/league.js:547; ui/build.js:296 | 정책 산업세 | 세입↑ / 기업 매력↓ | indTax×(1+.25×taxInd), industryAttract tax=60−10×상대세율 | 예 | 일치 | 없음 |
| G26 | 집단 만족 이유 | ui/league.js:547; ui/build.js:296 | 정책 공공서비스 | 생활 만족↑ / 지출↑ | serviceCurve=[−27,−20,0,10,14], svcStep=.25 | 예 | 일치 | 없음 |
| G27 | 집단 만족 이유 | ui/league.js:547; ui/build.js:296 | 정책 유치 보조 | 기업 매력↑ / 지출↑ | inc=100(1−exp(−보조/(.2×ind/10000))); 월 지출 incentive | 예 | 일치 | 없음 |
| G28 | 집단 만족 이유 | ui/league.js:547; ui/build.js:296 | 절전 캠페인 | 수요−5%·만족−5 | M.save=.05, saveSatPenalty=5 | 예 | 일치 | 없음 |
| G29 | 집단 만족 이유 | ui/league.js:547; ui/build.js:296 | 주민 이익공유 | 풍력·태양광 민원 ½ | shareRelief=.5; noise/view+wind/offshore/solar만 완화, 실제 민원 건수 전체 절반 아님 | 예 | 일치 | 없음 |
| G30 | 집단 만족 이유 | ui/econ.js:442; ui/league.js:559 | L.rel: 정전이 잦아서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G31 | 집단 만족 이유 | ui/econ.js:442; ui/league.js:559 | L.price: 전기요금이 비싸서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G32 | 집단 만족 이유 | ui/econ.js:442; ui/league.js:559 | L.air: 공기가 나빠서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 34-model-copy.js [8] |
| G33 | 집단 만족 이유 | ui/econ.js:442; ui/league.js:559 | L.jobs: 일자리가 적어서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G34 | 집단 만족 이유 | ui/econ.js:442; ui/league.js:559 | L.svc: 공공서비스가 부족해서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G35 | 집단 만족 이유 | ui/econ.js:442; ui/league.js:559 | L.tax: 세금이 무거워서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G36 | 집단 만족 이유 | ui/econ.js:442; ui/league.js:559 | L.crowd: 집값이 올라서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G37 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.rel: 전력이 불안해서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G38 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.price: 전기값이 비싸서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G39 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.re: 재생에너지가 모자라서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G40 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.labor: 인력이 부족해서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G41 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.talent: 인재가 적어서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G42 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.logi: 물류가 불편해서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G43 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.tax: 세금이 무거워서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G44 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.inc: 유치 보조가 적어서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G45 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.land: 산업 용지가 모자라서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G46 | 집단 만족 이유 | ui/econ.js:445; ui/league.js:559 | A.carbon: 전력 탄소가 많아서 | 가장 큰 가중 차이 1개 | causeOf: argmax w[k]×((lagTo−anchor×baseTo)−(lagFrom−anchor×baseFrom)), A 설명 anchor=1; 생활/산업 점수 자체는 현재값이 아닌 시작 대비 변화 | 예 | 일치 | 없음 |
| G47 | 집단 만족 이유 | ui/league.js:566·1298 | A에서 B보다 … / 이주 이유는 두 도시 사이 가장 큰 차이 하나 | 1; 시작 대비 차이와 현재 수준의 차이 | causeOf는 시작 대비 개선 차이를 비교. VM air 현재 A70&gt;B40이나 시작 A80/B40이면 A에서 공기가 나빠서라는 이유 선택. migrationReason은 ‘A에서 B보다 공기가 나빠서’로 출력해 절대 비교로 바꿈 | 해당 없음 | 불일치 | 없음(기존 econui.py:1101은 보고 문구 전달만) |

## 실제 검산·검사 결과

실행 환경: 현재 workspace-write 셸, Node `v24.21.0`, pnpm `11.25.0`. 이 저장소에 package.json·lockfile·Node 버전 파일은 없다. Node 내장 `vm`으로 코드 전체를 적재하고 비공개 함수의 참조만 메모리에서 노출했다. 원본 함수 본문이나 파일은 바꾸지 않았다. 브라우저·네트워크·Git 커밋은 실행하지 않았다.

| 실행 | 결과 |
|---|---|
| node tests/league/review/33-model-explanations.js | 50 통과, 0 실패 |
| node tests/league/review/34-model-copy.js | 174 통과, 0 실패 |
| node tests/league/review/36-h03-h04.js | 506 통과, 0 실패 |
| node tests/league/review/37-d80-grid.js | 412 통과, 0 실패 |
| node tests/league/review/38-d81-buildlead.js | 173 통과, 0 실패 |
| node tests/league/review/30-s7-attribution.js | 3054 통과, 0 실패 |
| node tests/league/review/32-s7-monthly.js | 12460 통과, 0 실패 |
| node tests/league/review/39-d80-s7.js | 67 통과, 0 실패 |
| node tests/league/review/40-v5-s7.js | 289 통과, 0 실패 |
| node tests/league/review/10-tech.js | 381 통과, 0 실패 |
| node tests/league/review/29-r3-air.js | 122 통과, 0 실패 |
| node tests/league/review/31-reweight.js | 3551 통과, 0 실패 |
| node tests/league/review/25-g6-score-contract.js | 66 통과, 0 실패 |
| node tests/league/review/35-d73-d74-d79.js | 4704 통과, 0 실패 |
| 문서 아래 재현용 VM 검산 | 91 단언 통과; 버그 재현값을 확인한 조사 검사이며 수정 완료 검사가 아님 |

대표 실측: 태양광 61.2489643101 → 탠덤 73.4987571721 MWh(×1.2), SiC 62.1676987747 MWh(×1.015); 수소 입력57.8802712730 → 출력20.2580949456 MWh(왕복35%); HVDC4→6 MW, 초전도 결합9 MW·손실.005; BMS 왕복 .922²=.850084 → .933²=.870489. 태풍 보강 시 `tieMods.down=[]`, 풍력 배수는 .6/.2 그대로. 제설 뒤 solarMul=.76, demandMul=1.04 그대로. 반도체 조건부 유치는 demandMul1.04·지원9억, 보류1·0억. 데이터센터는1.03·6억, 보류1·0억. 주민반대 대응 뒤 단절은 없어져도 사건비 −5억은 남는다. 정비 분산은 LNG.85·석탄.925이고 이후 기간을 늘리는 상태는 없다.

한 차례 재정 경계 검산에서 초기 상태의 반올림된 debtCap을 그대로 사용해 ‘위기’ 기대값이 틀렸고, 비교를 revYear=100·cap=88·cash=−88로 명시해 다시 계산했다. 실제 fin=0이어서 불일치로 기록하지 않았다. CBAM은 직접배출 입력을100배로 바꿔도 현재 cbam 차감이 같음을 검산했다. 이는 V63 판정 근거다.

**미실행/미완료:** 브라우저 화면 배치·접힘·도달 경로 실기 검증과 외부 출처 원문 재검증은 요청상 금지하여 미실행. 장기 전략 검사 `11-tech-balance.js`는 설명 감사에 불필요한 추가 실행이었다. 기본 설정이 `/tmp/kcp-tech-balance.json`에 진행 보고를 기록하는 것을 뒤늦게 확인하여 중단했다(종료 130, 통과로 집계하지 않음). 문서 하나만 쓰라는 범위를 벗어난 임시 보고서 기록이며, 코드·저장소 파일은 이 검사로 변경되지 않았다. 이 보고서는 감사 근거로 사용하지 않는다. 기존 검사가 모두 통과해도 위 불일치를 잡지 못하므로 ‘불일치 0’ 또는 E 8점 통과로 해석할 수 없다.

## 판본과 동시 작업

시작 당시 git status는 비어 있었다. 감사 중 다른 세션의 `docs/QUALITY-model.md`, `ui/econ.js`, `ui/econ-data.js`, `ui/league-data.js` 변경이 나타났다. 이 파일들은 수정·되돌림하지 않았다. econ 원장 반올림의 params 이동과 league-data asOf 추가를 현재 파일에서 다시 확인했으며 값·문구 대조는 아래 해시 기준이다. asOf가 생겨도 현재 eventSourceHTML은 why에서 연도를 추출한다. 최종 확인 때 다른 세션의 커밋 `d8e8e17`·`6238ef0`이 반영되어 있었고, 마지막 차이는 coal_phaseout gradeNote의 asOf/published 설명 추가였다. 이 차이로 본 표의 문구·효과 판정은 변하지 않으며, 현재 파일로 문서의 VM 91단언과 343행 집계를 다시 검증했다. 이후 동시 변경은 이 감사 결과에 자동으로 반영되지 않는다.

| 파일 | SHA-256 |
|---|---|
| ui/build-maps.js | 894a732e45d6c2087a7d51e30a29ab33e801ca8844e5b9bbeb0fc779a6ccc1b7 |
| ui/tech-data.js | 8ff4ffc3c5218f16c64df2b393ba78c0456ab7637ea13520188221dc4460d7e1 |
| ui/build.js | 2117f2204ef7a03ab636962ae41d690ff9259e687f09ee2a9631027bcbd861c9 |
| ui/econ-data.js | af20f6f26df08d10fbc135ef7547bbbc9f1d8a113daa0d14023cf407378a9ef1 |
| ui/econ.js | 9bdb56b706b55e7a2be115bf5bc4a73bb97d64adc03f9c716d398cf56985c66e |
| ui/league-data.js | a06e018370f7c9ea6f76ad6197da1519258caffab0d917b57de5ac2bc0982583 |
| ui/league-core.js | 26769d1f86d9b975f11caa01eddeeac4e20e0893ae2b91fe2e2ef525cc52f99e |
| ui/league.js | 733d447e7521da83722df2a4fbaff18447929b3e39df4cad1c6716290e7135c3 |

## 재현용 VM 검산(파일 생성 없음)

저장소 루트에서 아래 명령을 실행한다. 코드를 고치지 않고 실제 함수·카드 renderer를 불러 현재 수치와 알려진 어긋남을 재현한다. 조사 당시 기대값을 고정했으므로 수정 뒤에는 일부 재현 단언이 의도적으로 실패할 수 있다. 이 코드를 기존 회귀 검사 존재로 집계하지 않았다.

```sh
node <<'NODE'

const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const ctx=vm.createContext({console,structuredClone,URL,performance,document:{documentElement:{},addEventListener(){}},addEventListener(){},KCP:{route(){},on(){},esc:s=>String(s),leagueNet:{}}});ctx.window=ctx;
const names=['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league'];
const expose={
build:'KCP._B={M,RS,BLD0,dispOf,gridLossPerHex,bmsParams,tips,researchRun,renOut0,weather};',
econ:'KCP._E={groupTargets,causeOf,approvalChangeCause,lowestGroupDissatisfaction,carbonScore,debtStage};',
'league-core':'KCP._C={eurekaMet,fcxOf,econView,modsFor,bonusOf,coolingCost,tieMods};',
league:'KCP._U={techEffectText,techEurekaText,speedsHTML,buildLeadHTML,airNoteHTML,evSize,evCards,eventSourceHTML,gridReliance,gridTotalText,outageWeatherClue,groupCauseHTML,migrationReason};KCP._setL=x=>L=x;'
};
for(const name of names){
let s=fs.readFileSync('ui/'+name+'.js','utf8');
if(expose[name]) s=s.replace(/\}\)\(\);\s*$/,expose[name]+'\n})();');
vm.runInContext(s,ctx,{filename:name});
}
const K=ctx.KCP,B=K.buildGame,D=K.ECON_DATA,T=K.TECH_DATA,C=K.leagueCore,U=K._U,P=Object.fromEntries(Object.entries(D.params).map(([k,x])=>[k,x.v]));

const assert=require('node:assert/strict');let checks=0;
const eq=(a,b)=>{assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)));checks++};
const near=(a,b)=>{assert.ok(Math.abs(a-b)<1e-8, a+' != '+b);checks++};
const ids=Object.keys(D.start),R=C.regionOf('south'),S=C.newState('AUDIT','south',0,ids,{turns:12});
K._setL({room:'AUDIT',team:'pyeongtaek',snap:S});S.round=7;
const packResults={};
for(const id of ['island',...ids]){
B.selectPack(id,id==='island'?undefined:'league');
const PK=B.PACKS[id],tile=B.TILES.find(t=>!t.out&&t.t==='plain')||B.TILES[0];
const day={mult:1,noise:Array(24).fill(1),m:6,w:0,dayLen:12,eDay:4,flow:1,flowMean:1};
const tidal=K._B.renOut0({kind:'tidal',tile:tile.i},day,0,0);
near(tidal,B.BLD.tidal.mw*.31*Math.abs(Math.sin(2*Math.PI*3/B.M.tidalPeriod)));
const bio=K._B.dispOf('biomass');eq([bio.co2,bio.bioCo2],[0,.1]);
const di=K._B.dispOf('diesel');
packResults[id]={dieselTaxMul:(di.fuel+di.co2*B.M.taxPerT)/di.fuel,
tidal,LNG:B.SITES.filter(s=>s.kind==='plant').map(s=>({cap:s.cap,fuel:s.fuel})),
fab:B.SITES.filter(s=>s.dem?.fab2).map(s=>({name:s.name,dem:s.dem})),
scale:PK.scale,gridCap:PK.gridCap,gridSites:B.SITES.filter(s=>s.kind==='gridpt').length,importCap:K._B.dispOf('import').cap};
}
B.selectPack('pyeongtaek');
packResults.pyeongtaekFree={importCap:K._B.dispOf('import').cap,gridSites:B.SITES.filter(s=>s.kind==='gridpt').length};
near(B.M.batEff**2,.850084);near(T.params.bmsEfficiency.v**2,.870489);
B.selectPack('pyeongtaek','league');
near(B.BLD.tandem.mw/B.BLD.solar.mw,1.2);near(B.BLD.tandem.cost/B.BLD.solar.cost,1.2);
const rendered=T.cards.map(c=>({id:c.id,raw:c.eff,screen:U.techEffectText(c,{econ:true})}));
eq(rendered.length,15);
eq(U.techEffectText(T.cards.find(c=>c.id==='tandem'),{econ:true}).includes('×1.2'),true);
eq(U.techEffectText(T.cards.find(c=>c.id==='ccu'),{econ:true}).includes('×0.79'),true);
for(const which of ['L','A']){
const w=which==='L'?P.wL:P.wA;
for(const key of Object.keys(w)){
const z=Object.fromEntries(Object.keys(w).map(k=>[k,0])),one={...z,[key]:10};
const a={lagL:z,baseL:z,lagA:z,baseA:z},b={lagL:one,baseL:z,lagA:one,baseA:z};
eq(K._E.causeOf(a,b,which,w,D).part,key);
}}

const inp={energy:{demMWh:100,servedMWh:100,co2:10,co2Local:10,unsPct:0},assets:{port:1}};
const city0=S.econ.cities.dangjin,I={export:{},lng:1,fx:1,ship:1,cbam:1};
const a=K.econ.outIdx(city0,inp,I,D,2027);
inp.energy.co2=1000;inp.energy.co2Local=1000;
const b=K.econ.outIdx(city0,inp,I,D,2027);near(a.cbam,b.cbam);


const baseZero=Object.fromEntries(Object.keys(P.wL).map(k=>[k,0]));
const from={lagL:{...baseZero,air:70},baseL:{...baseZero,air:80}};
const to={lagL:{...baseZero,air:40},baseL:{...baseZero,air:40}};
const picked=K._E.causeOf(from,to,'L',P.wL,D);
eq(picked.part,'air');eq(picked.why,'공기가 나빠서');
eq(from.lagL.air>to.lagL.air,true);
const forecast=structuredClone(S);forecast.seedKey='W1-forecast';forecast.round=1;
forecast.teams.hwaseong.research={adopted:['fcst']};
forecast.events=[{id:'monsoon_cloud',round:1,x:.8}];
const interval=K._C.fcxOf(forecast,'hwaseong').monsoon_cloud;
eq(interval,[.7,.996]);near((interval[1]-interval[0])/.6,.49333333333333335);
const groupCity=S.econ.cities.pyeongtaek;
const groupInput=K.econ.cleanInput({energy:{unsPct:0,hospH:0,cpList:[],demMWh:100,servedMWh:100,co2:10},policy:{},assets:{}},groupCity,D.start.pyeongtaek,D);
const groups=K._E.groupTargets(groupCity,groupInput,1,D,{pm25:{pyeongtaek:{delta:.01}},taxResAvg:0,taxIndAvg:0});
for(const [key,w] of Object.entries(P.groupW)){
const z=Object.values(w).reduce((a,b)=>a+b,0);
for(const [part,weight] of Object.entries(w)){
if(part==='rel') continue;
near(groups.contrib[key][part],weight*groups.parts[part]/z);
}
near(groups.tg[key],Math.min(100,Math.max(0,Object.values(groups.contrib[key]).reduce((a,b)=>a+b,0))));
}
near(groups.parts.air,80-4*29*.01);
const city=S.econ.cities.pyeongtaek;
city.revYear=100;city.debtCap=88;city.cash=-88;
eq(K._E.debtStage(city,D),'crisis');
const boundary=K.econ.score(S.econ).by.pyeongtaek.parts.fin;
eq(boundary,0);
const scores=K.econ.score(S.econ);
for(const row of scores.rank){
const geo=Math.exp(Object.entries(P.wScore).reduce((s,[k,w])=>s+w*Math.log(Math.max(P.scorePartFloor,row.parts[k])),0)/Object.values(P.wScore).reduce((a,b)=>a+b,0));
near(row.score,Math.round(Math.min(100,Math.max(0,geo+row.coop))*10)/10);
}
const r=days=>({round:days===31?1:2,days:7,team:{pyeongtaek:{uns:0,imp:0,sub:0,isolated:{uns:70}}}});
const prev=r(31),curr=r(28),V={region:'south',rounds:[{days:7,mdays:31},{days:7,mdays:28}],results:[prev,curr]};
const grid=U.gridReliance(V,curr,'pyeongtaek');near(grid.mwh,280);near(grid.base.mwh,310);near(grid.delta,-30);
const zeroPlan={builds:[],lines:[{p:[0,1]}]};S.teams.pyeongtaek.plan=zeroPlan;
eq(K._C.eurekaMet(S,R,B,'pyeongtaek','grid',{},{}),true);
S.ties=[{a:'pyeongtaek',b:'dangjin',kind:'hvdc',st:'built',cap:4}];
eq(K._C.eurekaMet(S,R,B,'pyeongtaek','scable',{},{}),true);
console.log(JSON.stringify({checks,packResults,boundaryFin:boundary,grid,rendered,hashes:Object.fromEntries(names.map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync('ui/'+n+'.js')).digest('hex')]))}));

NODE
```

</details>


</details>
