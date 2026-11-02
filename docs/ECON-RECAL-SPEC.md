# 경제 층 근거 재보정 구현 명세(2026-10-06, G4·결정 v1.0.3)

[ECON-REFERENCES.md](ECON-REFERENCES.md)(이하 REF)의 근거를 엔진에 옮기는 계약이다. 엔진 담당은 이 문서만 보고 구현한다. 근거·계산 과정은 REF의 해당 절에 있고, 표의 '근거' 열은 REF 절 번호다. 이 문서가 [ECON-BALANCE](ECON-BALANCE.md)의 수치와 어긋나면 이 문서를 따르되, ECON-BALANCE의 목표(B1·B2·B3·B9·B16 등)는 §7의 방식으로 유지한다.

## 0. 범위와 순서

**원칙.** 값은 근거를 우선한다. 기존 검사가 옛 값을 단언해서 깨지는 경우는 검사를 고친다. 불변 조건(총량 보존·현금 항등식·결정성·유한값·범위)은 반드시 지킨다. 밸런스(한 전략이 6도시를 독식하지 않음)는 G 손잡이로만 맞춘다. 근거 값을 밸런스 때문에 되돌려야 하면 되돌리지 말고 §8 충돌 목록에 적고 총괄에게 보고한다.

**단계.**
- **R1 — 값만 바꿈.** 식은 그대로, params·상수만. 각 행이 독립이며 바로 검사할 수 있다.
- **R2 — 식 바꿈.** `ui/econ.js`·`ui/league-core.js`·`ui/build.js`의 함수. 이주·살기 좋음 묶음(§2의 F01~F05)은 함께 넣어야 검산값이 성립한다.
- **R3 — 호스트 입력이나 자료가 더 필요함.** 연료별 발전량 전달, 도시별 자료 필드, 큰 물리 변경.
- **결정 필요(§9).** 근거는 있으나 게임 규칙의 의미가 바뀌어 새 D-번호가 필요한 것. 기본 구현에 넣지 않는다.

**순서.** R1 → 검사 → R2 이주 묶음 → 검사 → R2 나머지 → 검사 → R3. 단계마다 §10의 명령을 돌리고, R2·R3 끝에 전략 봇 36달을 돌린다.

## 1. 바꿀 계수

### 1.1 `ui/econ-data.js` params — 값·등급을 바꾸는 키

| 키 | 이전 | 새 값 | 등급 | 근거 | 단계 |
|---|---|---|---|---|---|
| betaPopReal | 0.02 (M) | 0.12, eduSpeed를 곱하지 않음 | M | REF 2.3 | R2(F01) |
| eduSpeed | 4.8 (G), β에 곱함 | 4.4, 주민·산업 κ에만 곱함 | G | 2.4 | R2(F01) |
| betaIndReal | 0.02 (G) | 0.08, eduSpeed를 곱하지 않음 | M | 2.7 | R2(F01) |
| startMix | 0.9 | 1 | P | 2.5 | R1 |
| anchor | 0.9 | 1 | P | 2.6 | R1 |
| gpYear | 0.01 (M) | 0.01 (note만) | M | 2.9 | R1 |
| giYear | 0.012 (G) | 0.012 (note만) | M | 2.10 | R1 |
| wL | {rel .26, price .08, air .12, jobs .22, svc .10, tax .10, crowd .12} | {rel .26, price .08, air .04, jobs .30, svc .09, tax .04, crowd .19} | M | 3.2 | R2(F02와 함께) |
| serviceCurve | [−30, −12, 0, 10, 16] | [−27, −20, 0, 10, 14] | M | 3.8 | R1 |
| taxPoints | 10 (G) | 10 (note: L 가중 0.04와 짝, A는 β_ind 0.08과 짝) | M | 3.10, 4.6 | R1 |
| unsZeroA | 3 (G) | 3 (note: u₀ = 0.6 × 요금/VoLL = 1.8~4.0%) | M | 4.1 | R1 |
| priceWeightBase | 0.5 | 0.1 | M | 4.3 | R2(F07과 함께) |
| sectorRe100 | {semi .5, display .4, auto .3, bio .2, chem .15, steel .15, other .1} | {semi .29, display .29, auto .29, chem .17, steel .17, bio .17, other .10} | G | 4.4 | R1 |
| reWeightBase | 0.3 | 0.1 | G | 4.4 | R1 |
| seekRate | 0.05 (G) | 0.05 (note 근거 식) | M | 4.10 | R1 |
| normalCo2 | 0.4 | 0.4567 | O | 9.7 | R1 |
| co2IntRef | 0.45 | 0.4567 | O | 9.7 | R1 |
| co2IntDef | 0.45 | 0.4567 | O | 9.7 | R1 |
| normalCost | 0.012 | 0.008 | M | 7.11 | R1 |
| outRel | 0.006 (M) | 0.006 (note 출처 교체) | M | 5.1 | R1 |
| indTaxK | 3 | 1.7 | M | 5.3 | R1 |
| subRevenueRate | 0.8 (O\*) | 0.8 | O | 6.5 | R1 |
| taxStep | 0.4 | 0.25 | O | 6.4 | R1 |
| svcCost | 3.3e-5 | 3.0e-5(주민 몫, 노령 몫은 새 키) | M | 6.11 | R2(F12) |
| svcStep | 0.5 | 0.25 | M | 6.11 | R1 |
| fsrRef | 0.6 | 0.486 | G(값은 O) | 6.7 | R1 |
| debtRate | 0.003 | 0.0024 | M | 6.13 | R1 |
| debtCapRatio | 0.5 | 0.88 | M | 6.12 | R1 |
| fxExport | 0.1 (M) | 0.1 (note 출처 교체) | M | 7.12 | R1 |
| carbonWeight | 0.3 | 0(실제 CBAM). 가상 사건 eu_indirect 때만 0.3 | O | 7.15 | R2(F16) |
| curtailKnee | 0.72 | 0.64 | M | 8.13 | R1 |
| curtailSlope | 1.7 | 1.3 | M | 8.13 | R1 |
| hostCapMul | 0.4 (G) | 0.4 (note: 국가 계통 최저/최고 비율) | M | 8.11 | R1 |
| hostEssMul | 1 (G) | 1 (note: 4시간형 흡수 물리) | M | 8.11 | R1 |
| essCap | 0.9 (O\*) | 0.9 (note 정정) | O\* | 8.8 | R1 |
| groupW.worker | {rel .35, jobs .10, price .05, tax .25, svc .20, crowd .05} | {rel .35, jobs .25, price .05, tax .15, svc .15, crowd .05} | G | 11.3 | R1 |
| groupW.youth | {rel .30, jobs .15, crowd .10, svc .25, tax .15, air .05} | {rel .30, jobs .25, crowd .10, svc .15, tax .15, air .05} | G | 11.3 | R1 |
| approvalWindow | 12 (G) | 12 (note) | P | 11.7 | R1 |
| reviewEvery | 12 (G) | 12 (note: 임기 4년 × 1/4) | O | 11.8 | R1 |
| wScore | {pop .20, ind .20, fin .10, co2 .15, appr .15, rel .20} | G7 D4 보류: {pop .10, ind .10, fin .125, co2 .275, appr .15, rel .25} 유지(동일 가중 미채택) | G | 13.1 | R1·G6 |

### 1.2 `ui/econ-data.js` params — 새 키

| 새 키 | 값 | 등급 | 근거 | 대체하는 키 | 단계 |
|---|---|---|---|---|---|
| kappaPopReal | 0.009/달 | M | 2.2 | kappaPop(삭제) | R2(F01) |
| kappaIndReal | 0.005/달 | M | 2.8 | kappaInd(삭제) | R2(F01) |
| jobsJ | 3(점/1%) | M | 3.7 | jobsSlope(삭제) | R2(F02) |
| crowdK | 3.5(점/1%) | G | 3.11 | crowdCapMul(삭제, 주민 혼잡만) | R2(F03) |
| hospPenHours | 8(시간) | G | 5.6 | — | R2(F08) |
| priceSteelMul | 4 | M | 4.3 | — | R2(F07) |
| taxGain | 8(점/단계) | G | 11.4 | taxCurve(삭제) | R2(F09) |
| lossAversion | 1.955 | P | 3.8, 11.4 | — | R2(F09) |
| taxYardstick | 0.5 | G | 11.4 | — | R2(F09) |
| approvalMemoryReal | 0.038/달 | P | 11.6 | — | R2(F10) |
| eduMemory | 4 | G | 11.6 | — | R2(F10) |
| svcCostSenior | 2.0e-5 억/노령인구·월 | M | 6.11 | — | R2(F12) |
| fiscalTargetRev | 0.5(× 시작 연 세입) | G | 6.10 | fiscalTarget(삭제) | R2(F13) |
| debtWarnRatio | 0.55 | M | 6.12 | — | R2(F14) |
| indTaxLag | 12(달) | O(구조) | 5.3 | — | R2(F11) |
| cbamEuShare | 0.154 | M | 7.13 | cbamRate(삭제) | R2(F16) |
| cbamDrop | 0.046 | P | 7.13 | — | R2(F16) |
| cbamPhase | {2026: .025, 2027: .05, 2028: .10, 2029: .225, 2030: .485, 2031: .61, 2032: .735, 2033: .86, 2034: 1} | O | 7.13 | — | R2(F16) |
| eduCbam | 5 | G | 7.13 | — | R2(F16) |
| scoreUnsZero | 16 | G | 5.10 | 점수의 unsZeroL 재사용 | R2(F18) |
| scoreCo2Worst | 0.82 t/MWh | M | 13.5 | scoreCo2Ref(삭제) | R2(F19) |
| scoreCo2Best | 0.274 t/MWh(= 0.4567 × 0.6) | M | 13.5 | — | R2(F19) |
| coopCo2Cut | 0.40(2030, 2018 대비) | O | 13.6 | coopCo2Goal(삭제) | R2(F20) |
| coopEase | 1.0으로 시작(봇으로 정함) | G | 13.6 | — | R2(F20) |
| hazardFreq | 0.1 | G | 13.7 | — | R2(F21) |
| connPerMonthReal | 0.00375 | M | 8.12 | connPerMonth(삭제, 곱으로 계산) | R2(F22) |
| eduConn | 27 | G | 8.12 | — | R2(F22) |
| curtailLossReal | 0.018 | M | 8.14 | curtailLoss(삭제, 곱으로 계산) | R2(F22) |
| eduCurtail | 3.3 | G | 8.14 | — | R2(F22) |
| aiVollMul | 5 | M | 5.8 | aiTieValue(삭제, aiVollMul × normalCost) | R2(F23) |
| budgetToRevenue | 2.2(실제 예산 ÷ (게임 연 세입 × moneyScale)) | M | 6.12 | F14 식의 2.2 | R2(F14) |
| moneyScale | 28 | M | 6.1 | — | R1(정보용, 화면·환산) |
| airBase | 80 | G | 9.10 | airDefault(삭제) | R3(H01) |
| airSlope | 29(점/㎍·m⁻³) | M | 9.10 | airRef(삭제) | R3(H01) |
| kPM | 7e-6(㎍·m⁻³/게임 MWh·월) | M | 9.10 | — | R3(H01) |
| pmFuelW | {coal 1, diesel 0.8, biomass 0.8, lng 0.05} | M | 9.10 | — | R3(H01) |
| airNeighbours[].ratio | P: 0.059/0.092·0.45, G: 0.2 | P·G | 9.11 | airSpill(삭제) | R3(H01), D-69 확정 |
| eduAir | 4 | G | 9.10 | — | R3(H01) |

삭제하는 키(15개): kappaPop, kappaInd, jobsSlope, taxCurve, crowdCapMul, airRef, airDefault, cbamRate, fiscalTarget, scoreCo2Ref, sat0, coopCo2Goal, connPerMonth, curtailLoss, aiTieValue. 산업 용지가 쓰는 crowdKnee·crowdBase·crowdSlope와 landCapMul(도시별 값이 없을 때의 기본값)은 남긴다. 삭제한 키를 읽는 검사는 새 키나 곱으로 고친다.

### 1.3 다른 파일의 상수·자료

| 파일·위치 | 이전 | 새 값 | 등급 | 근거 | 단계 |
|---|---|---|---|---|---|
| `ui/build.js` dispOf coal fuel | 0.006 | 0.0045 | M | 7.1 | R1 |
| `ui/build.js` dispOf import co2 | 0.46 | 0.4567 | O | 9.4 | R1 |
| `ui/build.js` dispOf biomass co2 | 0.1 | 0, 바이오 CO₂는 정보 항목으로 따로 집계·표시 | O | 9.5 | R2(F17) |
| `ui/build.js` M.pr | 0.8 | 0.92(이름 pvYield) | M | 8.1 | R1 |
| `ui/build.js` M.batEff | 0.95 | 0.922(√0.85) | P | 8.6 | R1 |
| `ui/build.js` TECHS.bms 효율 | 0.955 | 0.933 | G | 8.6 | R1 |
| `ui/league-core.js` TIE_LOSS | 0.02 | 0.01 | G | 8.10 | R1 |
| `ui/league-core.js` PRICE | {min .005, max .05, def .015} | {min .004, max .025, def .009} | M | 7.11 | R1 |
| `ui/league-core.js` modsFor fuelMul 탄력 | coal √, diesel 1 | coal·diesel 모두 ^0.6 | M | 7.3 | R1 |
| `ui/league-core.js` 예측 기술 사건 예보 범위 | ½ | 0.7 | P | 12.7 | R1 |
| `ui/league-data.js` coldwave_heating demandMul | 1.10 | 1.15 | M | 8.17 | R1 |
| `ui/league-data.js` light_load_curtailment 문구 | '약 30회, 호남·제주 주 대상' | '봄철 경부하기 93일 중 30일(제주 제외 비중앙 태양광), 태양광 밀집 지역일수록 잦음' | — | 8.15 | R1 |
| `ui/league-data.js` regional_tariff | budgetAdd +10, 등급 P, 법무법인 뉴스레터 출처 | §2 F24 효과, 등급 O\*, 뉴스레터 출처 삭제·[L09]·[X14] | O\* | 7.17 | R2(F24) |
| `ui/econ-data.js` intl.events ship_red | fx {ship −0.3, lng 0.1} | {ship −0.3} | M | 7.9 | R1 |
| `ui/econ-data.js` intl.schedule | [{t: 12, id: cbam}] | [{t: 0, id: cbam}] | O | 7.14 | R2(F16과 함께) |
| `ui/econ-data.js` intl.events cbam text | '철강 수출 도시는 쓰는 전력의 탄소 배출이 많을수록…' | '철강 공정의 직접배출이 많을수록, EU 수출 비중만큼 산출이 깎여요(단계 도입)' | — | 7.14 | R1 |
| `ui/econ-data.js` intl.theta | 0.15(하나) | {lng 0.03, fx 0.015, ship 0.15, export 0.05} | M(ship·export G — 대장 §7.7, 2026-10-21 정정) | 7.5–7.7 | R2(F15) |
| `ui/econ-data.js` intl.sigma | {lng .05, fx .02, ship .03, export .04} | {lng .07, fx .019, ship .012, export .025}(표준화 잡음 기준) | M(ship·export G) | 7.5–7.7 | R2(F15) |
| `ui/econ-data.js` start.* | — | natShare(화성·평택·안성 0, 아산·천안 0.45, 당진 0.65), landCapMul(충남 1.3, 화성·평택 1.15, 안성 1.1), univ0·lab0(실제 대학·연구소 수, 기존 uni·lab에서 이름 변경) | O·G·O\* | 4.7, 4.9, 4.8 | R2 |
| `ui/league-data.js` 지역 | scale 문자열('게임 1 MW ≈ 실제 약 230 MW')만 | 숫자 필드 mwScale 230 추가 | G(지도 설계) | 5.9, 6.14 | R3(H03·H04) |
| `ui/tech-data.js` tandemOutput | 1.15 | 1.2 | P | 12.2 | R1 |
| `ui/tech-data.js` tandemCost | 1.15 | 1.2 | G | 12.2 | R1 |
| `ui/tech-data.js` h2Cost | 40 | 28 | M | 12.4 | R1 |
| `ui/tech-data.js` ccuOutput | 0.85 | 0.79 | M | 12.5 | R1 |
| `ui/tech-data.js` sicOutput | 1.015 (G) | 1.015(note: 현실 1.01 × 배속 1.5) | P | 12.3 | R1 |
| `ui/tech-data.js` smrCost·smrTurns·smrFuel | 150·6·0.002 (G) | 값 유지, note·등급(M·P·M) | M·P·M | 12.6 | R1 |
| `ui/tech-data.js` roundSteps | 4 | 4.35 | M | 12.7 | R2(정수 가정 검사 확인) |

### 1.4 params 등급 집계(구현 뒤 예상)

| 자료 | 키 수 | O | O\* | P | M | G |
|---|---|---|---|---|---|---|
| `econ-data.js` params 지금 | 145 | 0 | 2 | 0 | 4 | 139(96%) |
| `econ-data.js` params 재보정 뒤 | 168 | 10 | 1 | 6 | 40 | 111(66%) |
| `tech-data.js` params 지금 | 46 | 0 | 0 | 1 | 1 | 44 |
| `tech-data.js` params 재보정 뒤 | 46 | 0 | 0 | 4 | 6 | 36 |

남는 G는 컴퓨터 도시 성향(ai\*), 교육용 배속(edu\*), 표시 문턱, 카드·연구 체계 같은 설계 선택이 대부분이다(REF §16). 항목 기준 집계는 REF §14.

## 2. 바꿀 식

이주·살기 좋음 묶음 F01~F05는 함께 넣는다. 나머지는 독립이다.

| ID | 함수(파일) | 이전 | 새 꼴 | 근거 |
|---|---|---|---|---|
| F01 | `monthStep()` 이동 단계(econ.js) | `move(E,"pop",…, betaPopReal*eduSpeed, kappaPop, …)`, 산업도 같은 꼴 | `move(E,"pop",…, betaPopReal, kappaPopReal*eduSpeed, …)`, 산업은 `betaIndReal`, `kappaIndReal*eduSpeed`. publicView의 배속 표시는 새 정의(시간) | REF 2.2–2.4, 2.7–2.8 |
| F02 | `livability()` jobs(econ.js) | 50 + 50·tanh(jobsSlope·(j − 1)), j = (ind/pop)/지역 평균 | clamp(50 + jobsJ·100·ln(j/j₀)), j₀ = (ind0/pop0)/(시작 지역 ind0 합/pop0 합). 시작 지역 평균은 initCities에서 E.totals로 저장. `regionCtx()`의 대체값 0.42 삭제 | 3.7 |
| F03 | `livability()` crowd(econ.js) | crowdScore(pop/(houseCap ‖ pop0 × crowdCapMul)) | clamp(50 − crowdK·100·(pop/pop0 − popT/popT0)). popT0는 활성 도시 시작 인구 합. 산업 land는 기존 crowdScore 유지 | 3.11 |
| F04 | 이주 이유 문구(econ.js WHY_L·GW) | crowd '집이 비좁아서', GW '집값·혼잡' | crowd '집값이 올라서', 이유 옆에 근거 등급(REF 기준) | 3.11, 3.12 |
| F05 | 대학·연구소 자산 기준(league-core.js `econInput()`·첫 달 보정) | 보정은 자료의 시작 수, 달 입력은 지은 수만 | 달 입력 assets.uni = univ0 + 지은 대학 수, assets.lab = lab0 + 지은 연구소 수. 보정도 같은 함수로 만든 입력을 쓴다 | 3.9, 4.8 |
| F06 | `industryAttract()` talent·svc 교육 가산 | 위 결함의 영향 | F05로 해결(식 변경 없음) | 4.8 |
| F07 | `industryAttract()` w.price | wA.price × (priceWeightBase + steel + semi + chem) | wA.price × (priceWeightBase + priceSteelMul × steel) | 4.3 |
| F08 | `livability()` rel·`groupTargets()` hospital | 병원 정전 > 0이면 −hospPen, 노년 −seniorHosp | −hospPen × min(1, hospH/hospPenHours), 노년 −seniorHosp × min(1, hospH/hospPenHours). hospRel 분리 계산도 같은 꼴 | 5.6 |
| F09 | `taxSatisfaction()`(econ.js) | taxBase + taxCurve[step + 2] | Δ = step − taxYardstick × 참가 도시 평균 단계, g = −Δ(Δ ≤ 0) 또는 −lossAversion·Δ(Δ > 0), 값 = c100(taxBase + taxGain·g). 주민세(taxRes)·산업세(taxInd) 각각. 함수 인자에 지역 평균 추가 | 11.4 |
| F10 | `monthStep()` 7단계 집단 만족 지연(econ.js) | sat += lambdaFast·(목표 − sat), 기여 분해도 lambdaFast | 목표 < sat이면 sat = 목표(λ_on = 1), 아니면 sat += λ_off·(목표 − sat), λ_off = approvalMemoryReal × eduMemory = 0.152. 기여 분해(groupContrib)도 같은 규칙으로. 부분 점수 지연(lagRate)은 그대로 | 11.6 |
| F11 | `ownRev()` indTax·standardRevenueHistory(econ.js) | out^indTaxK(같은 달) | 도시별 out 이력(최대 indTaxLag달)을 저장하고 그 평균^indTaxK. 이력이 없으면 out 1 | 5.3 |
| F12 | 서비스 비용(econ.js 6단계) | pop × svcCost × (1 + svcStep × 단계) | (pop × svcCost + pop × 노년 비중 × svcCostSenior) × (1 + svcStep × 단계) | 6.11 |
| F13 | `equalizeOf()`·`setBase()` | 보통 조건 연 운영 수지 목표 = fiscalTarget × cash0 | 목표 = fiscalTargetRev × 시작 연 세입(12 × (pop0 × resTax + ind0 × indTax) + 시작 지원금) | 6.10 |
| F14 | 지방채 한도·재정 점수(econ.js) | debtCap = debtCapRatio × revYear(매달 연환산), fin = 100 × (1 + cash/debtCap) | revYear: 첫해 = 12 × 표준세입 + 연 지원금으로 고정, 매년 1월 직전 12달 세금·지원금으로 한 번 갱신. debtCap = debtCapRatio × revYear(새 건설·유료 대응 금지), debtWarn = debtWarnRatio × revYear(뉴스). fin: d = max(0, −cash)/(budgetToRevenue × revYear), d ≤ 0.10이면 100, 0.10~0.25 직선 100→50, 0.25~0.40 직선 50→0 | 6.12, 6.13, 13.4 |
| F15 | `intlStep()`(econ.js) | n = R() + R() − 1, rev(x, m, σ) = x + θ(m − x) + σn, θ 하나, lng 범위 [0.4, 3] | n = (R() + R() − 1) × √6, θ를 계열별로(D.theta[k]), lng 범위 [0.4, 2.5]. 씨앗·호출 순서는 유지(결정성) | 7.5–7.7 |
| F16 | `outIdx()` cbam·`industryAttract()` w.carbon·intl 사건 | 0.02 × steel × xs × (co2Int/0.45), CBAM이면 w.carbon += 0.3 × steelX | cbam = steel × xs × cbamEuShare × cbamDrop × cbamPhase[연도] × eduCbam(연도 키가 없으면 가장 가까운 값). 실제 CBAM에서 w.carbon = wA.carbon(가중 추가 없음). 가상 사건 eu_indirect(이름 'EU, 철강 간접배출 포함 결정(가상)', sched 아님, 기본 꺼짐 또는 진행자 선택)일 때만 carbonWeight × steelX를 더하고 전력 탄소 연동을 켠다 | 7.13–7.15 |
| F17 | 바이오매스 CO₂(build.js·league-core.js) | 0.1t/MWh를 co2에 합산 | co2에는 0, 별도 bioCo2(정보 항목)로 집계해 화면에 '바이오 CO₂(국가 총량 밖)' | 9.5 |
| F18 | `score()` rel(econ.js) | 100 × (1 − unsS/unsZeroL) | 100 × (1 − unsS/scoreUnsZero) | 5.10 |
| F19 | `score()` co2·`groupTargets()` co2(econ.js) | 100 × exp(−co2pc/scoreCo2Ref) | I = 소비 CO₂/공급 MWh(λslow 지연). G10: 시작 지도의 기존 설비만 고정 전선으로 연결해 첫 달 운전한다. 부족 MWh에 normalCo2·normalCost를 곱해 실제 탄소·연료비에 각각 더하고 전체 수요 MWh로 나눈 값을 시작 탄소·원가로 저장한다. 무발전 네 도시는 같은 혼합 규칙의 공급 0 특수 경우이며 대체값임을 명시한다. 공급 0인 달은 직전 집약도 유지, 직전 값이 없을 때만 시작값을 쓴다. D-73: 값 = max(절대 세 기준점 눈금, 시작 대비 감축 세 기준점 눈금). 절대 기준 0.82/0.25038/0에 0/80/100점, 상대 감축 0/0.4/1에 0/80/100점; 현재·시작 결측 규칙은 ECON-SPEC §9.1. co2pc는 화면용으로 남겨도 된다 | 13.5 |
| F20 | 지역 CO₂ 목표(econ.js `monthStep()` region, league-core.js `goalsOf()`) | 대표 7일 3,000t × 달 일수/7(호스트는 실제 TWh 몫으로 축소) | goal = 지역 수요 MWh(demMWh 합) × normalCo2 × (1 − coopCo2Cut × min(1, (연도 − 2018)/12)) × coopEase. 2027년 계수 0.70. 호스트 goalsOf와 단독 기본값이 같은 식을 쓴다 | 13.6 |
| F21 | 사건 추첨(league-core.js) | monthEventP로 0/1개를 정한 뒤 weight로 고름. finedust_coal_cap은 겨울 무작위, typhoon은 tieDown 선이 있는 방에서만 | 두 단계 추첨은 유지하고, 기상 사건의 weight를 '함의 빈도 = monthEventP × w_e ÷ Σw(그 계절 유효 사건) = P_real × hazardFreq'가 되게 다시 정한다: 태풍 여름 0.056·가을 0.026, 황사 봄 0.077(P_real 0.56·0.26·0.77). P_real이 없는 사건은 지금 weight 유지. finedust_coal_cap은 12·1·2·3월 확정 일정(추첨·B9 집계에서 제외). typhoon은 선이 없어도 발생하고 tieDown 효과만 선이 있을 때 | 13.7, 9.13 |
| F22 | 접속·출력제어(league-core.js) | connPerMonth, curtailLoss 키 | connPerMonthReal × eduConn, curtailLossReal × eduCurtail. 경제 모드에서는 light_load_curtailment를 추첨하지 않는다 | 8.12, 8.14, 8.15 |
| F23 | AI 연계선 판단(league-ai.js) | aiTieValue | aiVollMul × normalCost | 5.8 |
| F24 | regional_tariff 사건(league-data.js·league-core.js) | 충남 3개 시 예산 +10억 | 사건 기간 충남 3개 시 산업 매력 price 계산의 원가를 × 0.92(경기 3개 시 변화 없음). 대상 도시는 자료의 도(prov) 필드로 고른다(이름 직접 쓰지 않음) | 7.17 |
| F25 | `ownRev()` tariff·`regionCtx()`(econ.js) | 지역 평균 원가(자기 포함) | 자기 도시를 뺀 공급량 가중 평균. 다른 활성 도시가 없으면 normalCost | 7.16 |
| F26 | 지원금 지급(econ.js `yearStart()`·`monthStep()` 1단계) | 1월 연액 일시 지급 | 1월에 연액 결정·공지, 1·4·7·10월에 1/4씩 지급. paidYear 가드는 분기별로 | 6.9 |
| F27 | 국비 매칭(econ.js 6단계) | exp.incentive = 보조 전액 | 보조 × (1 − start.natShare) | 4.7 |
| F28 | 산업 용지(econ.js `industryAttract()`) | ind0 × landCapMul(공통) | ind0 × (start.landCapMul ‖ landCapMul) | 4.9 |
| F29 | `co2IntOf()`(econ.js) | co2/demMWh | co2/servedMWh(공급 0이면 co2IntDef) | 9.8 |
| F30 | 연계선 CO₂ 귀속(league-core.js settle) | 구매자 co2In = 받은 양 × co2i | 보낸 양 × co2i(손실분도 구매자) | 9.9 |
| F31 | 이익공유 범위(econ.js `groupTargets()`, build.js `complaints()`) | terms.share = −terms.complaint × shareRelief(모든 민원) | cpList 항목에 src(설비 종류) 추가. share = shareRelief × min(complaintCap, complaintScale × Σ 소음·경관 중 src ∈ {wind, offshore, solar}) | 10.4 |
| F32 | 민원 수용자(build.js) | TOWNS 전체 | 주거지(village·town_s·city·city_m·city_l)와 hospital·school. farm·livestock은 소음·경관만 | 10.3 |
| F33 | 민원 거리·크기(build.js `complaints()`) | REF 10.1 현재 | 풍력 경관 5 → 3, 태양광 경관: 인접 주거지가 city 계열이면 2, 그 밖 4, 해상풍력 경관: 해안 주거지 d ≤ 3에서 2, 디젤·바이오매스 매연: d ≤ 3 × w(d) = 1·0.6·0.3, 디젤 소음·매연은 같은 수용자에 중복 부여하지 않음, 디젤 '동쪽 마을' 조건 삭제, 숲 훼손: 설비당 한 번 3점 | 10.1, 10.2, 10.8 |
| F34 | 병원 정전 판정(build.js:778·league-core.js:912) | 부족 > 0.0001MW | 부족 > max(0.005, 병원 수요의 2%) | 5.7 |
| F35 | 조력·소수력 출력(build.js `renOut0()`) | 조력 정격 × \|sin\|, 소수력 정격 × 날씨 배수 | 조력 정격 × 0.31 × \|sin\|. 소수력 정격 × min(1, 0.25 × q_m × f_w), q_m = 0.5 + 0.5 × 월 강수/연평균 강수(climate에 월 강수 표 추가), f_w = 지금 날씨 배수 ÷ 그 달 평균 배수 | 8.4, 8.5 |
| F36 | 화면 세금 부분 점수(league-core.js groupParts) | 독자 선형식 | 엔진 report.groups 기여 분해를 그대로 읽음 | 11.5 |
| F37 | 평가·시위 판정(econ.js 7·9단계) | approval < approval0 − approvalDrop | rel = (approval − approval0) − 활성 도시 평균(approval_j − approval0_j). 시위 시작 rel < −approvalDrop, 종료 rel ≥ −unrestOffDrop, 연말 평가 pass = rel ≥ −approvalDrop. 도시 하나뿐이면 지금 식 | 11.7 |
| F38 | SMR 유레카·sat0(tech-data.js·league-core.js·econ.js) | 절대 지지율 ≥ 55, sat0 미사용 | approval ≥ approval0 − 5 또는 시위 없음(G). sat0 삭제(initCities는 neutralScore로 초기화 후 setBase) | 11.8 |
| F39 | 점수 집계(econ.js `score()`) | wsum(가중 산술평균) + coop | G7 D4 보류: S = exp(Σ w_k·ln max(scorePartFloor, x_k) / Σw), scorePartFloor=1(G, G7 복원; G6 하한30 보류). 표시 부분점수는 0~100 유지. 화면 이름 '균형 점수', 식 공개 | 13.2 |
| F40 | 성장 눈금(econ.js `score()`) | K = 500 공통 | K_pop(L), K_ind(L) 표(L = 게임 길이 12·24·36). 임시값: 12달 pop 1000·ind 3300, 24달 pop 700·ind 2000, 36달 pop 500·ind 1250. R2 묶음 뒤 bots36에서 \|g\|의 97.5 백분위 B로 K = 50/B를 다시 산출해 교체 | 13.3 |
| F41 | HVDC·초전도 적용 범위(league-core.js `effectiveTie()`) | 양 끝 중 한 도시라도 도입하면 기존 선 전체 | D-79: kind === 'hvdc'인 선만 용량 ×1.5(G), 손실 .01(G, 기본 교류선과 같음), 새 선 비용 ×1.3 유지. scable·사건 배수는 계속 곱함 | 12.1 |
| F42 | 수소 혼소(league-core.js 기술 효과) | 도입하면 LNG 전체 CO₂ × 0.88 | 그 달 수소 탱크 방전량(또는 저장 잔량)이 있을 때만, 혼소 가능량만큼 적용. 소비한 수소 몫의 LNG 연료비·CO₂를 함께 차감하고 재고·시간별 방전 상한을 지킨다. 혼소량과 CO₂ 감축 >0 검사 포함 | 9.12 |
| F43 | heatDamage 조건(league-core.js) | 예측 또는 VPP | VPP만 | 12.8 |

## 3. 호스트 입력·자료 추가(R3)

| ID | 무엇 | 위치 | 내용 | 근거 |
|---|---|---|---|---|
| H01 | 대기 점수 PM2.5 증분 | `econInput()` energy, econ.js `livability()`·`groupTargets()` | energy.genMWh = {coal, lng, diesel, biomass}(그 달, 생산 기준, × wk). ΔPMᵢ = kPM × Σ pmFuelW_f × genMWh_f, 대기 수용 도시(econ-data.airNeighbours의 from→to, D-69 확정; 현재 참가 도시만)는 쌍별 ratio × 발원 도시 자체 ΔPM을 더함. L의 air = clamp(airBase − airSlope × ΔPM). 집단 만족의 air = clamp(airBase − eduAir × airSlope × ΔPM). airRef·airDefault 삭제 | REF 9.10, 9.11 |
| H02 | fossilMWh 전달 | `econInput()` | energy.fossilMWh = coal + lng + diesel(H01과 같은 값)으로 lngMarket 대리값을 없앤다 | 7.18 |
| H03 | 지역자원시설세 | econ.js 6단계 rev, 새 항목 rev.facility | rev.facility = 0.65 × (coal 0.7 · lng 0.6 · smr 1.0원/kWh) × genMWh × mwScale × 1,000 ÷ 1e8 ÷ moneyScale. mwScale은 league-data 지역의 새 숫자 필드(230). 세율 단계 대상 아님 | 6.14 |
| H04 | 정전 피해 추정 표시 | 도시 서랍·결과 화면 | 미공급 게임 MWh × 230 × 1,000 × [주거 몫 × 3,564 + 산업 몫 × 452~1,033]원, 범위로 표시, 현금 미반영 | 5.9 |
| H05 | 계절 수요 | build.js `demand()` | 폭염·겨울 규칙 대신 v ×= 1 + 0.04·max(0, T − 18) + 0.012·max(0, 15 − T)(T = 월평균기온). 극값은 사건으로. 리그·혼자 하기 지도 모두. 큰 변경이므로 단독 커밋 | 8.16 |
| H06 | 육상풍력 | build.js `renOut0()`·`weather()`, build-maps climate | 날마다 배수 = √(−(4/π)·ln(1 − u))(레일리), 허브 평균 = WS50M(월, climate에 표 추가) × 1.088 × siteF(평지·도시 0.8, 해안·언덕 1.0, 능선 1.1, G). 풍력이 실제 선택지가 되므로 단독 커밋·봇 재확인 | 8.2 |
| H07 | 이격 조례 정책 | 정책 카드·build.js 입지 규칙 | 켜면 풍력은 주거지 d ≤ 1 건설 금지, 이익공유 카드·지붕형 면제 | 10.6 |
| H08 | 송전선 민원·연계선 공사 | build.js `complaints()`, league-core.js 연계선 | 선이 주거지 칸을 지나면 경관 4, 인접하면 2(G). 연계선 공사 기간 = ceil(T_real ÷ 5)달, T_real 3달(G) → 1달. 공사 중 반대 사건 확률 0.15/달(G), 발생하면 완공 +2달, 주민 협의를 고르면 확률 × 0.9 | 10.7 |
| H09 | 이익공유 비용 | build.js shareCost, `econInput()` costPerMWh | shareCost = 0.03 × normalCost × E_elig(월 MWh), opex에만 넣고 costPerMWh 계산에서 뺀다 | 10.5 |
| H10 | 집단 비중 원자료 | econ-data start.*.groups | 청년 19~34세·농어가·사업체·임금근로자 비중을 KOSIS로 채움(지금은 G) | 11.1 |

## 4. 남기는 것(바꾸지 않음)

근거를 확인했지만 값이 맞아 바꾸지 않는 것: outRel 0.006, unsZeroL 16, priceFloor 0.5, priceSlopeA, fxExport 0.1, gpYear 0.01, giYear 0.012, lossPerHex(리그 0.005), 석탄 최소출력 30%, CO₂ 원단위(석탄 0.82·LNG 0.37·디젤 0.75), 디젤 연료비 0.016, 수입 단가 0.012, outageSatThreshold·Penalty, lambdaFast(부분 점수), lambdaSlow, h2Efficiency 0.35, h2Co2 0.88(F42 조건만), essCap 0.9, hostTieMul 0.5, curtailMax·curtailOffSeason, 해상풍력 표, spring_dust 0.85, finedust 석탄 0.8, coopUnsGoal 0.5. 이유는 REF 각 절.

보류(근거가 보조 자료 하나뿐이거나 결정이 필요): 만족용 정전 문턱 분리(REF 5.4), 교부세 수요 구조 전면 교체(6.7), 이주 주민:종사자 비 1.96(2.12), priceSlopeA 250(4.3).

## 5. 교육용 배속: 분리와 화면 표시

현실 값과 배속을 한 숫자에 섞지 않는다. 배속 키는 `edu` 접두사(또는 hazardFreq·mapScale처럼 성격이 드러나는 이름)로 params에 두고, publicView(`econ.speeds`)에 아래 표를 실어 디브리핑 화면과 도시 서랍에 보인다. 문구는 '무엇을 · 몇 배 · 빠르게/드물게/크게 · 왜'.

| 키 | 값 | 종류 | 화면 문구 | 근거 |
|---|---|---|---|---|
| eduSpeed | 4.4 | 시간 압축 | 주민·기업 이동 시간 ×4.4(게임 1달 ≈ 현실 약 4.4달) | REF 2.4 |
| eduMemory | 4 | 시간 압축 | 지지율 회복 기억 4배속(임기 4년 → 게임 12달) | 11.6 |
| reviewEvery | 12 | 시간 압축 | 주민 평가는 12턴마다(현실 임기 4년) | 11.8 |
| eduAir | 4 | 크기 확대(집단 만족만) | S4: PM 계산 구현. S8: 호스트 입력·시작 보정·공개 배속표 연결 | 9.10, §8 #26·#38 |
| eduCbam | 5 | 크기 확대 | CBAM 효과 ×5(교육용) | 7.13 |
| eduConn | 27 | 속도 확대 | 재생 접속 속도는 현실보다 약 27배 빠름 | 8.12 |
| eduCurtail | 3.3 | 크기 확대 | 출력제어 손실 ×3.3(교육용) | 8.14 |
| hazardFreq | 0.1 | 빈도 축소 | 기상 사건은 현실보다 약 10배 드물게 | 13.7 |
| (표시만) LNG 급등 빈도 | 약 3 | 빈도 확대 | LNG 급등은 현실보다 약 3배 자주 | 7.8 |
| (표시만) 정전 눈금 | 정전 1% = 연 87.6시간 | 크기 확대 | 한국 평균 정전은 연 0.04시간(2019) | 3.3 |
| (표시만) 섬 지도 손실 | ×3 | 크기 확대 | 섬 연습 지도의 송전 손실은 리그의 3배 | 8.9 |
| (표시만) SMR 공사 | ×4.4 | 시간 압축 | round(55 / eduSpeed)=12달, 1월 착공 시 이듬해 1월 가동 | 12.6, 결정 v1.0.3 |
| (표시만) 연구 기간 | 수십 배 | 시간 압축 | 현실 10~30년 → 게임 수 달 | 12.8 |
| (표시만) 민원 정치 효과 | 약 50~200배 | 크기 확대 | 마을 민원이 도시 전체 집단 만족에 걸림(교육용 확대) | 10.8 |
| (표시만) 기술 효과 | sicOutput ×1.5, scableCap ×0.1 | 크기 조정 | 현실 효과 대비 배율 | 12.3, 12.8 |

화면 규칙은 D-60(실제 자료 값만 출처와 함께, 표시 없는 계수는 G)을 따른다. 배속은 'G'가 아니라 '교육용 배속'으로 별도 줄에 보인다.

## 6. params note에 넣는 출처 문자열 형식

`p(v, grade, note)`의 note는 아래 형식을 따르고, 선택 인자 `refs`(REF §1의 번호 배열)를 추가한다. 화면의 출처 줄은 refs를 REF §1의 기관·연도로 풀어 보인다(D-63: 공공기관·공기업·언론 이름 허용, 민간 기업명 금지).

```
p(값, 등급, "<무엇> · <근거 요지와 수치> · 계산: <식(있으면)> · 배속: <키 또는 없음> · REF <절>", ["<번호>", ...])
```

- 근거 요지에는 기관·저자와 연도, 그 출처의 수치를 그대로 적는다. 추측이나 해석은 '가정'으로 표시한다.
- 등급이 G인 키는 '근거 없음: <이유>' 또는 '설계 선택: <설계 근거>'로 시작한다.
- 120자 안팎. 길면 REF 절 번호로 넘긴다.

예시

```js
kappaPopReal: p(0.009, M, "주민 이동 현실 속도 · 김현우·이두헌 2021 첫해 0.095, Amior–Manning DP1357 10년 0.66 · 계산: 1−e^(−12κ)=0.095→0.0083, 1−e^(−120κ)=0.66→0.0090 · 배속: eduSpeed · REF 2.2", ["P06", "P07", "P08"]),
taxStep: p(0.25, "O", "세율 단계당 세입 변화 · 지방세법 §92②·§103의20② 표준세율의 100분의 50 범위 가감 · 계산: ±2단계 = ±50% · 배속: 없음 · REF 6.4", ["L01"]),
crowdK: p(3.5, G, "설계 선택: 지역 성장 대비 초과 인구 1%당 집값·혼잡 −3.5점 · 방향 Saiz 2007(유입 1% → 임대료 약 1%) · 배속: 없음 · REF 3.11", ["P21", "P16"]),
eduSpeed: p(4.4, G, "교육용 배속(시간 압축): 게임 κ 0.0396 ÷ 현실 κ 0.009 · κ에만 곱함 · REF 2.4", []),
```

`ui/tech-data.js`의 `p(v, grade, note, sources)`는 이미 네 번째 인자가 있으므로 sources에 URL 대신 REF 번호를 넣거나 둘 다 넣는다.

## 7. 수용 기준

### 7.1 반드시 유지하는 불변 조건
- `node tests/league/test-econ.js` 전부 통과: 주민·종사자 총량 보존(정수), 현금 항등식 cashBefore + revTotal − expTotal = cashAfter와 다음 달 연결, 같은 씨앗 같은 결과, 모든 값 유한, 점수·부분 점수 0~100.
- `tests/league/review/` 1-invariants, 2-extremes, 3-policy-grid, 4-drift, 5-exploits, 6-ind-jump, 7-fiscal-approval, 8-offers, 9-grid, 10-tech, 11-tech-balance, 12-next, 13-confirmed: 불변 조건 단언은 통과해야 한다. 옛 값(예: taxStep 0.4, debtCapRatio 0.5, eduSpeed 4.8)을 직접 단언하는 줄만 새 값으로 고친다.
- `node tests/league/next.js`, `node tests/league/tech.js` 통과(같은 원칙).
- 국제 지수 걷기는 씨앗·R() 호출 순서를 바꾸지 않는다(F15는 잡음 크기만).

### 7.2 근거 목표(새 검사로 `tests/league/balance.js`에 추가)
검산 절차는 REF §0·§2와 같다: `tests/league/review/lib.js` 근사 입력, 씨앗 3개, 첫 달 보정 뒤. '현실 모드'는 eduSpeed = 1·eduMemory = 1로 바꾼 데이터 사본.

**정전·회복 행의 측정 정의(v1.0.1, 2026-10-06 총괄).** 1차 구현과 독립 검사가 '몫 변화'와 '절대 인구 변화'를 서로 다르게 읽어 같은 실행이 한쪽에서는 통과, 다른 쪽에서는 실패했다. 근거([X04] 푸에르토리코 '추세 초과 −1.3%p')가 반사실 차이이므로 이 표의 정전·회복 행은 **같은 씨앗의 무충격 실행 대비 그 도시 인구의 상대 차이** `pop_충격/pop_무충격 − 1`로 잰다. 지역 성장과 다른 도시 변화가 빠진다. 회복은 이 차이의 최대 손실 대비 마지막 손실의 회복 비율이다. ECON-BALANCE B1의 단언(절대 인구 증감)은 그대로 두고 둘 다 통과해야 한다.

**게임 기준 재산출(v1.0.2, 2026-10-06 총괄).** 이 범위 확대는 독립 검토의 실행 결과를 확인한 뒤 이루어진 사후 변경이다. 사전 등록된 별도 검증의 통과로 해석하지 않는다. `recal.js`의 해당 범위도 그 결정 이후 넓어졌으며 G9에서는 파일을 수정하지 않는다. REF §2의 게임 검산(정전 5% −2.20%, 100% −6.69%, 회복 89%)은 산업 이동을 끈 채 계산한 값이다. F01은 시간 압축(eduSpeed)을 주민·산업 κ에 똑같이 곱한다 — 흐름마다 다른 시간 비율을 쓰면 '게임 1달 = 현실 약 4.4달'이라는 정의가 무너지므로 이 원칙을 유지한다. 그 결과 정전 도시에서 기업이 빠지고 일자리 감소가 주민 유출을 키워(독립 검토 재현: 평택 5% −2.70%, 100% −7.14%, 회복 74.5%) 옛 게임 기준을 약 0.5%p 넘는다. 게임 열은 교육용 가시성 기준(G)이므로 산업 경로를 포함해 위와 같이 넓힌다. 현실 열과 B1 단언은 바꾸지 않는다.

| 검사 | 방법 | 기준(현실 모드) | 기준(게임) | 근거 |
|---|---|---|---|---|
| 일자리 고리 | 한 도시 종사자 +1% 영구(다른 도시 비례 차감, 산업 이동 끔), 주민 로그 변화 ÷ ln 1.01 | 12달 0.07~0.13(목표 0.095, 검산 0.100) | 12달 > 현실 12달 × 2 | REF 2.3 |
| 정전 교차 점검 | 한 도시 정전 100% 12달, 무충격 대비 인구 차이(v1.0.1) | −1.3%~−3.9%(검산 −2.08%) | −3~−9%(v1.0.2, 산업 경로 포함) | 2.3, B1 |
| 정전 5% | 12달 | — | −0.5~−3.5%(v1.0.2, 산업 경로 포함) | B1 |
| 회복 | 정전 100% 6달 뒤 18달 정상 | — | B1 회복 ≥ 40%(검산 89%) | B1 |
| 무변화 표류 | 모든 도시 보통 조건 36달 | 최대 몫 변화 ≤ 0.1% | ≤ 0.6%(검산 0.00%) | 2.6, B1 |
| 세금 고리 순서 | 주민 세율 +1단계 12달 몫 변화 | \|세율 1단계\| < \|일자리 1%\| | 같음 | 3.10 |
| 산업 세금 | 산업세 −1단계, 산업 몫 장기값(κ_ind를 0.05로 올려 수렴) | +0.15~+0.45%(검산 +0.24%) | — | 2.7, 4.6 |
| 요금 업종 차 | 원가 −10%, 산업 몫 장기값 | 철강 비중 큰 도시 > 저집약 도시의 5배(검산 0.90% 대 0.06%) | — | 4.3 |
| 배속 정의(B15 교체) | params | eduSpeed × kappaPopReal = 실제 move에 쓴 κ(±1e-9), β에는 eduSpeed가 곱해지지 않음 | — | 2.4 |
| 세율 범위 | ownRev | taxRes ±2에서 resTax가 기준의 50~150% | — | 6.4 |
| 재정 점수 문턱 | fin | 예산 환산 채무비율 0.10 → 100, 0.25 → 50, 0.40 → 0 | — | 13.4 |
| 지원금 분기 지급 | 12달 | 1·4·7·10월에 연액의 1/4씩, 합 = 연액 | — | 6.9 |
| 대학 자산 | '아무것도 안 함' 36달 | 대학 도시의 svc·talent 부분 점수가 시작값에서 ±1 안 | — | 3.9, 4.8 |
| 정전 시 대기 | H01 뒤, 전면 정전 달 | air 상승 ≤ airSlope × 시작 ΔPM | — | 9.10 |
| CBAM | 2027년 | cbam 산출 감소 > 0, 전력 탄소집약도를 바꿔도 cbam 불변 | — | 7.13 |

### 7.3 기존 밸런스 목표의 처리

| 목표 | 처리 |
|---|---|
| B1(이주 속도·회복·표류) | 유지. 위 7.2로 검산했다. balance.js B1 단언은 그대로 통과해야 한다 |
| B2(지지율이 원인을 보이게: 정전 5%+세율 +2+서비스 −2+재생 0% 12달 탈락, 보통 조건 통과) | 유지. F10(악화 즉시)·F37(야드스틱)로 탈락은 더 쉬워진다. 보통 조건 도시 통과는 반드시 확인(다른 도시가 모두 보통이면 rel = 자기 변화 − 평균) |
| B3(세율 −2·서비스 +2면 모든 도시 연 운영 수지 < 0) | 유지 목표. taxStep 0.25·svcStep 0.25에서 F13(fiscalTargetRev)으로 맞춘다. G4에서 정책0 대비 첫해 수지·36달 현금 감소와 절대 적자를 함께 확인. taxStep을 0.4로 되돌리지 않는다 |
| B5(현금 비축 점수 아님) | 단언을 F14의 새 fin 식으로 바꾼다 |
| B7·v1.3(지방채 한도 연환산) | F14로 대체. 옛 '1월 지원금 한 번만' 단언은 지운다 |
| B9(달 사건 평균 0.4~0.6) | 계절관리제는 확정 일정이라 집계에서 뺀다. 기상 사건 빈도가 바뀌면 monthEventP를 조정해 0.4~0.6 유지 |
| B11(공급량 기준 원가·차익) | F25(자기 제외 평균)로 Σ차익 = 총원가 × 0.02 단언은 성립하지 않는다. '도시마다 tariff = 공급량 × (남의 평균 × 1.02 − 자기 원가)' 단언으로 바꾼다 |
| B12·B13·B14 | 유지 |
| B15(배속 표기) | 7.2 '배속 정의'로 교체 |
| B16(전략 봇: 한 전략이 6도시 독식 금지) | 유지. 아래 7.4 |
| B18(접속·출력제어) | 유지. connPerMonth·curtailLoss 값은 같고 키만 곱으로 |

### 7.4 전략 봇 36달
- `tests/.venv/bin/python tests/league/bots36.py --months 36`(README 리그 절의 정확한 명령). R2 묶음 뒤와 R3 뒤 각각.
- 기준: 6도시 각각의 1위 전략이 한 전략으로 모두 같지 않다. 정전 0% 전략의 평균 점수가 '아무것도 안 함'보다 높다(F39 기하평균에서 특히 확인). 연료 가격 위험이 커졌으므로(F15) 디젤·LNG 의존 전략의 점수 분산을 함께 보고한다.
- 독식이 생기면 G 손잡이만 조정한다: wScore, coopEase·coopBonus, smrFuelMul, monthEventP, aiStyles, 연구 카드 need·demo, eduAir·eduCbam. 근거 키(O·P·M)는 건드리지 않고 §8에 적는다.
- F40의 성장 눈금 K를 이 결과로 다시 산출해 넣고 봇을 한 번 더 돌린다.

### 7.5 화면·문구
- `econui.py`·`solo.py`·`ai-check.py`·rules·e2e3·econint 문제 0, 콘솔 오류 0, 가로 스크롤 0, 1280×900·390×844 × 밝음·어두움 캡처.
- 배속 문구 '×4.8'을 단언하는 검사는 새 문구로 고친다.
- §5 배속표가 디브리핑과 도시 서랍에 보인다. 사건 문구(CBAM·경부하 출력제어·지역 요금·계절관리제)가 REF 정정 내용과 같다.

## 8. 충돌 목록(근거 반영과 기존 설계·검사)

| # | 충돌 | 근거 쪽 | 기존 쪽 | 처리 |
|---|---|---|---|---|
| 1 | 장기 일자리 탄력 | [P07] 10년 0.66 | 모형 10년 0.36(일자리 비율 꼴의 자기 희석) | 한국 첫해 값([P06])을 우선, 미달로 남김 |
| 2 | 요금 탄력 크기 | [P25] 철강 몫 × −0.64~−0.85 → 당진 −0.35~−0.47 | 점수 포화로 −0.09 | 미달로 남김. priceSlopeA 250이면 −0.28이나 점수 절벽 — 결정 사항 |
| 3 | 돈 눈금 | 연료비 기준 1:41(230MW 축척) | 세입 기준 1:28 | moneyScale 28을 공식값으로 두고 에너지 원가는 현행. 두 계정을 직접 비교하는 화면 문구를 피한다. 통일은 후속. 각주(10-22): 1:41은 LNG 연료비단가 2024 연평균 141.1원/kWh([S16], ECON-REFERENCES 「눈금」 문단) 기준이다(0.32453억÷normalCost 0.008=40.6). normalCost의 근거인 2025 평균 구입단가 124.1원/kWh([S18])로는 1:35.7이다(0.28543억÷0.008). 세입 눈금 1:28과는 각각 1.45배·1.27배 어긋난다 |
| 4 | CBAM 효과 | 법정 단계 도입이면 2027년 당진 영향 ≈ 0.01% | CBAM 사건이 수업에서 보였음 | 근거대로 작게. 보이고 싶으면 가상 사건 eu_indirect(G) |
| 5 | 바이오매스 CO₂ 0 | IPCC 인벤토리 기준 | 바이오매스가 '무료 탄소'가 됨 | 근거대로. 독식이 생기면 바이오매스 연료비·축산 칸 제약(G)으로 조정 |
| 6 | 지방채 한도 0.88 | 재정위기 40% 문턱의 환산 | 건설 여력이 커짐 | 근거대로. 봇에서 과잉 건설이 보이면 debtWarn 뉴스·fin 감점(이미 있음)을 확인하고 보고 |
| 7 | 세율 단계 0.25 | 법정 ±50% | B3 정책 격자 | fiscalTargetRev로 맞춤(§7.3) |
| 8 | 국제 변동 확대 | 현실 월 변동 7%·36달 폭 0.64~1.55 | 화석 전략의 점수 분산 증가 | 근거대로, 봇 보고에 분산 추가 |
| 9 | 석탄 연료비 인하 | EPSIS 0.54~0.59 | 석탄 보유 도시(당진) 원가 하락 | 근거대로, 봇 확인 |
| 10 | 육상풍력 실용화(H06) | 전국 이용률 19.2% | 지금 풍력은 사실상 무용 | R3 단독 커밋, 봇 확인 |
| 11 | 계절 수요 ±30%(H05) | EPSIS 월 비율 | 공급 계획 전반이 달라짐 | R3 단독 커밋, 정전율·봇 확인 |
| 12 | 지지율 악화 즉시(F10) | 재해 직후 지지 하락 | 시위가 더 자주 켜질 수 있음 | 야드스틱(F37)으로 공통 충격은 상쇄. 시위 빈도를 봇 보고에 추가 |
| 13 | 자기 제외 평균 차익(F25) | 야드스틱 | B11 단언 | B11 단언 교체 |
| 14 | HVDC 손실 | 짧은 선에서는 HVDC가 더 손실 | 연구 카드 효과 | §9 D2 결정 전까지 값 유지, 적용 범위만 고침 |
| 15 | 공동 보너스 | 집단 간 경쟁 없는 협력이 낫다([P108]) | D-61 공동 보너스 +2 | §9 D3 결정 |
| 16 | eduSpeed 문서 5·코드 4.8 | — | ECON-EVIDENCE·B15 | 4.4로 재정의, ECON-EVIDENCE·ECON-BALANCE B15 문구는 총괄이 정리 |
| 17 | 탄소중립기본법 §8① | 헌법불합치 주석(효력 미확인) | 40% 목표를 공동목표·점수 상한에 사용 | 시행령 40%를 쓰되 화면 출처에 '개정 중' 표시 |
| 18 | REF §2.7·4.6 산업세 검산 | 문헌 환산 +.22%, 허용 .15~.45% | 기존 +.577772% | G4: G인 wA.tax .07→.025, +.214903%로 보정. β_ind .08·taxPoints 10 유지; recal.js 수정 없음 |
| 19 | 법정 탄력세율·F13과 B3·B12 | taxStep .25·서비스 손실회피·공급 유인 | G3 감세 독식 해소를 위한 음의 판매 가산율 | G4: G3 네 값 철회. B3 상대·절대 기준 함께 통과; B3/B12 격자는 실제 호스트 입력으로 통일 |
| 20 | F12 노령 비용·도시별 원가와 B14 | 주민 기여에는 주민 수요 몫 전기 차익 포함 | G3 보고에서 차익 누락 | G4 반영. 보통 조건 지역 평균 ≥0, 도시별 음수 허용. 실제 호스트 첫달 지역 평균 −365.82원/명·달은 별도 보고(§8 #27); 정액 보정 상한 유지 |
| 21 | 높은 탄소 가중과 무공급 대조군 | G2 중간 co2 .35에서 무공급 도시1위 발생 | 정전 전략 방지 | G2 최종 wScore 유지: pop .10/ind .10/fin .125/co2 .275/appr .15/rel .25. G3는 가중·신뢰 문턱을 바꾸지 않음 |
| 22 | 검사 옛 키·사건 집계 | connPerMonthReal×eduConn, 계절관리 확정 사건 제외 | ai-check 옛 키, bots B9 혼합 집계·기상 반복 | G4: 검사 키 정정, 확정 사건 집계 제외, 기상도 연속 발생 금지 복원 |

| 23 | 설비별 공사 시간 압축 | F01과 같은 ×4.4, SMR 55개월/4.4≈12턴 | 나머지 설비는 즉시 건설·접속 대기 B18 | 결정 v1.0.3: SMR만 12턴, 다른 설비 기간은 이번에 바꾸지 않는 비대칭 유지 |
| 24 | F13 목표와 보정 하한 | 목표 .3×시작 연 세입 | 음의 보정(지원금 회수)은 허용하지 않음 | B6 기본 조건 하한 6·상한 0, 목표 달성으로 세지 않음. 비제약 검사에서는 목표 직접 일치 |
| 25 | 시작 탄소 기준과 무공급 상대 점수 | 무공급으로 탄소 개선 금지 | 빈 계획은 4도시에서 공급0으로 비율 정의 불가 | G9: 기존 지도 설비만 같은 전선으로 운전, 탄소·원가 분모를 공급 MWh로 통일. 발전소 없는 네 도시는 명시적 대체값. 공급0이면 직전 집약도 유지. 당진 작은 감축의 절대 점수0 구간은 남음 |
| 26 | 배속표의 H01 | eduAir ×4는 집단 만족에만 | S8 해소: 시작·거래 후 월 genMWh, publicView 배속×4·화면 문구 연결 | 추가 발전은 CO₂와 같은 용량 가중, 감발은 대체 가능 출력 가중. 시간별 연료 급전 정밀화와 대기 방향 목록 범위는 남은 한계. #38·D-69 참조 |
| 27 | 실제 호스트 주민 기여와 SMR 상위 집중 | B14 보통 조건과 실제 원가 차이, SMR 1위 ≤3 목표 | G4 첫달 −365.82원, SMR5/6 | G5: B14는 lib 평균≥0·실제 호스트 부호 무단언으로 확정. SMR 규모만 변경하면 6/6으로 증가하여 규모가 주원인이라는 추정을 지지하지 않음. 아래 #28 및 G5 보고 참조 |
| 28 | v1.0.4 SMR 근거 규모와 B16 | 4×170MWe/230, 기존 MW당 단가 유지 | 3MW도 저탄소·차익 이득, 낮아진 총건설비로 안성 착공 빨라짐 | G5 최종 SMR6/6: B16 실패·추가 목표≤3 미달을 그대로 보고. smrFuelMul4 진단도 6/6. 근거 값·단언 유지, 다음 G 후보는 SMR 연구량 need36→72/144/216의 지연·기회비용 민감도(미검증) |
| 29 | AI 부채 대응과 지속 운영 적자 | 세금·서비스·건설은 사람과 같은 요청 | 기존 균형2·공격2/6 한도 초과 | G5 warn/crisis 대응 후 균형 아산1/6만 잔여. 연구·기존 전력 운영비는 연구 큐를 비워도 남으며 자동 철거하지 않음. 연료·서비스·건설 원인과 초과 시점은 G5 보고 |
| 30 | G8 기술 전략 비교의 투자 기회비용 | SMR과 같은 달까지의 누적 건설·연구비를 재생+저장·연계선·혼합에도 배정 | 기존 기술4전략에는 같은 예산 탈탄소 대안이 없어 SMR6/6을 기술 자체의 불균형으로 단정할 수 없음 | G9: 양쪽 모두36달 건설+운영·연료+구매. 공개 계획 급전의 거래 비용 예상·비용만의 사전 반복으로 한도 맞춤. 7전략 B16 필수·SMR≤3 관찰, 결과·미집행은 G9 보고·비교표 |
| 31 | 설비 공사 기간 비대칭(D-81) | EIA AEO2022 lead time(P): 태양광 2년·육상풍력 3년·ESS 1년·바이오매스 4년·내연기관 2년·SMR 6년, 한국 LNG 복합 27~32개월·육상풍력 인허가 포함 약 10년(O*) | SMR만 공사 12달(55개월 ×4.4), 다른 설비는 즉시 건설·접속 대기(×27) | 사용자 결정(D-81)으로 비대칭 유지. SMR을 현실보다 상대적으로 불리하게 그린다는 점을 배속표(#lg-build-lead·#lg-build-rule)에 밝힌다. 균일 적용은 12달 판의 월별 학습 고리를 약하게 하고 근거 빈 칸(지붕 태양광·소형 디젤·한국 ESS)을 G로 채워야 해서 보류. 연계선 공사(H08)는 미구현으로 함께 공개 대상 |


**G3 보정 이력 — 아래 네 값 조정은 G4에서 철회(나머지 보고 필드·REF 정정은 유지).**

**G3 보정(2026-10-06; §7.3의 옛 B3 절대 적자 목표보다 이 결정 우선).** `fiscalTargetRev` .3→.1, `tariffMarkup` .02→−.24, `subBase` 45→70억/년, `serviceCurve` 중 G 이득 칸(+2) 14→20. 판매가는 자기 제외 지역 평균 원가의 76%라는 게임 가정이며 실제 공공요금의 추정치가 아니다. 주민 지원 단가와 M/P/O 계수(서비스 손실 칸 −27·−20 포함)는 유지한다. 지원금을 삭감하거나 45억으로 유지한 후보는 안성 SMR 착공 실패 때문에 폐기했다. 기본지원금을 70억으로 올려 작은 도시의 기술 착공 여력을 보전한다. 보통 조건 재정 목표를 낮추고 판매 차익을 줄여 감세 재정 여유를 제한하는 동시에 서비스 +2의 G 보상을 올려, 재정 제약을 피하려는 서비스 +1·최대 감세 조합이 항상 이기지 않게 한다. B5 재정 점수식과 현금 비축 보상 금지는 그대로다.

검증·도시별 격자·폐기 후보 수치는 `tests/league/review/G3-report.md`를 따른다. B14는 연초에 정액분을 따로 저장하고 공지 연액의 인구 배분분을 매달 나눈 값이다. 분기 선지급·직렬화 후에도 같은 값을 내며 음수를 0으로 자르지 않는다.

**G4 결정(2026-10-06).** tariffMarkup −.24→+.02, serviceCurve +2 20→14, fiscalTargetRev .1→.3, subBase 70→45. 판매 차익 정상화 뒤 실제 호스트 입력의 B12와 T5를 통과하므로 3차 재정 보완을 남기지 않는다. B12의 125×6 격자는 실제 호스트 월별 입력 위에서 정책만 바꾸며, 건설·에너지 고정의 한계와 정책 재투자 포함 봇 결과를 함께 보고한다. B3의 25칸 격자도 같은 입력의 대각선이며 문턱은 유지한다. smrTurns 6→12(55/4.4=12.5에서 선택 G; 55개월 P), smrFuelMul 4→1.25(G). wA.tax .07→.025(G), 나머지 M 사슬 유지. B14는 주민 수요 몫 전기 차익까지 포함한다. 재현 명령·실제 결과와 남은 충돌은 `tests/league/review/G4-report.md`를 따른다.

**G5 결정 v1.0.4(2026-10-06).** SMR 한 건설 단위는 i-SMR 공개 기본 구성인 4모듈 발전소다. [사업단 리플릿](https://ismr.or.kr/source/file/i-SMR_leaflet_kr.pdf) 2·6쪽의 4×170=680MWe를 지역 축척 230으로 나눈 `smrMW = 2.956521739`(M), `smrCost = (150/20)×smrMW = 22.173913043`(M)로 바꾼다. [X16]은 모듈당170을 명시하며 모듈 수 근거는 사업단 원문에서 보완했다. IEA 4,500$/kW의 기존 환산 단가, smrMin .8, smrFuel .002, smrFuelMul 1.25, smrTurns12는 유지한다. 도시당1기 제한은 없으며 해금·예산·냉각수 부지·개별 공사 대기 규칙을 그대로 적용한다. 약3MW로 반올림한 값을 물리 계산에 쓰지 않는다.

**G5 당시 계약(시작 배치·무공급 처리는 아래 G9로 대체).** F19 시작 기준은 게임 내부 정상 공급 계획의 운전 결과이다. `normalStartPlans`는 8d3fc8f 균형 AI의 첫 달 기본 공급 배치에서 연구 설비를 뺀 고정 G 기준이다. 여섯 도시 모두 전량 공급을 검사하며 탄소량 자체는 저장된 새 실측 통계가 아니라 매번 시뮬레이터에서 읽는다. 정상 재정·지원금 보정 입력은 유지하고 탄소 집약도만 이 결과를 쓴다. AI 로드 여부·성향·방 씨앗·학생 계획과 독립이며 기존 저장의 기준을 소급 변경하지 않는다. 기준 지도의 설비·타일을 바꾸면 합법성·공급 검사를 함께 갱신해야 한다.

B14(a)는 lib 보통 조건의 인구 가중 평균 ≥0, (b)는 실제 호스트 `perResidentNet`을 부호 단언 없이 계산·보고·화면 표시하는 계약이다. 주민 유치의 보상은 주민 점수·세입·지원금이며 도시에 따라 재정 부담이 된다. 서비스·노령 비용·세율의 근거 계수는 변경하지 않는다.

**G5 당시 부채 대응(운영 적자 보완 예외는 아래 G9 추가).** 부채 대응은 사람과 같은 행동으로 제한한다. AI는 경제 모듈과 같은 `debtStage`를 읽고 warn에서 선택 건설·연구·새 연계선을 보류하되 부족한 확정 공급은 보강한다. crisis에서는 건설도 보류한다. 두 단계 모두 세율은 매달 +1(최소+1·최대+2), 서비스 목표는 신중 −1/−2, 균형 −1/−1, 공격 0/−1(warn/crisis, G)이다. 사람 봇의 고정 세금·서비스 선택은 변경하지 않는다.

SMR 규모 단독 변경과 전체 변경의 T5·B16, 시작 탄소 표, AI·사람 봇의 부채 원인·남은 충돌은 `tests/league/review/G5-report.md`와 `G5-results.json`에 기록한다. §8 #27의 G4 추정은 후속 측정으로 평가하며 SMR 우세의 원인을 규모 하나로 단정하지 않는다.

**G9 결정(2026-10-07, 사용자 승인 기본안).** B12는 두 세율이 모두 같은 방향(0 허용, 하나 이상 변경)인 감세·증세 계열 각각 ≤3도시로 대칭화한다. 정책0의 실제 호스트 기본 계획은 36달 전 구간 지방채 한도 안에 있어야 한다. G 손잡이는 `aiLocalFuelWeight=4`, `aiConnectionMonths=4`, `aiBoldExpansion .3→0`, `aiDebtRepair=.6`이다. 기존 저렴한 축산 인접 연료 입지를 우선하고, 새 발전소의 최소출력 때문에 생기는 불필요한 추가 화력을 줄인다. 현금 음수·전월 운영 적자일 때 신중·균형은 신중 재생 목표까지 보완하며 공격은 기존 목표를 유지한다. 월 접속량·접속 상한·단가·부채 문턱은 그대로다.

기존 AI 검사 '계획 뒤 대기 ≤ 피크10%·운영 뒤 대기0'은 옛 G 건설 목표이며, 천안의 2MW 설비를 월 약 .52MW로 접속할 수 없게 만들었다. 승인된 건설 페이스 범위에서 최대4달로 바꾸고 **기존 미처리 대기 중 새 묶음 금지·매달 실제 처리량 준수·각 설비 4달 내 전량 접속**을 검사한다. 확정 공급·평균 정전≤5%·합법 예산·원 상태 불변·결정성·성향 순서는 유지한다.

시작 기준은 기존 발전소(평택 LNG·당진 석탄)만 같은 고정 전선으로 운전한다. 나머지 네 지도에는 기존 발전소가 없어 소비량당 비율을 계산할 수 없다. 가상 디젤을 추가하지 않고 기존 `normalCo2=.4567`, `normalCost=.008`을 대체값으로 문서에 명시한다. 탄소와 원가는 같은 배치·급전의 공급 MWh를 분모로 쓴다. 보정은 이전처럼 보통 조건의 전량 공급 수요로 단가를 환산하며 학생에게 자산을 지급하지 않는다. 공급0 달은 직전 탄소 성과를 보존한다.

T5는 양쪽 모두 36달 건설+운영·연료+구매 총지출로 맞춘다. 실제 거래 예상의 추가 연료·구매 예약(25% 예상 여유 G)과 비용만을 사용한 사전 반복으로 동일 한도에 맞춘 뒤 B16·SMR 순위를 판정한다. 점수로 반복을 선택하지 않으며 미집행을 공개한다. 상세 절차는 ECON-TECH-SPEC T5, 실제 키 전후·표·수용 결과는 G9 보고·비교표다.

**G9 검증 결과.** 호스트 정책 격자 감세2/6·증세3/6, 정책0 호스트36달 및 일반 기본 봇 지방채 초과0. 일반 재생71.783>디젤46.600, nothing은12·24·36달 모두6도시 꼴찌다. T5 B16 통과, 연구 이득+9.417점, SMR1위4/6으로 희망 목표≤3은 미달이다. balance807/0·test-econ1,286,685/0·next/tech/sec/review 실패0·ai-check6,589/0·bots36 18,098/0. recal.js는 파일과 실패 상세까지 기존과 같은251/8을 유지한다.

남은 충돌: (31) 기존 발전소가 없는 네 도시의 시작 비율은 실측 운전값이 아닌 명시적 대체값, (32) 당진 석탄 최소출력으로 시작 집약도1.062581이 절대 최악 기준 .82를 넘어 작은 감축은 여전히0점(30% 감축12달은0→5.7), (33) 7.5억/게임MW는 구형150/20의 G 가격지수이며 환율 유도값이 아님, (34) v1.0.2 허용 범위 확대는 결과를 본 뒤의 사후 변경, (35) 공통 총지출 한도의7전략에서도 SMR1위4/6으로 희망 목표≤3 미달이다. O·P·M 값·기하평균·부분점수 하한·recal.js를 이 충돌을 가리기 위해 바꾸지 않는다.


**G10 독립 검토 보완(2026-10-07).** F19 시작 보정의 부분 공급 도시도 부족분을 normalCo2=.4567·normalCost=.008로 보충한 가중 평균을 쓴다. 발전소가 없는 도시는 같은 규칙의 공급 0 특수 경우이다. 학생 운영 중 공급 0인 달의 직전 집약도 보존은 유지한다. B12는 계열별 ≤3 외에 세율 축별 한 방향의 6도시 독식을 금지한다. G10 결과는 감세·증세 계열 각각 3/6, 주민세 인상/인하 4/6·2/6, 산업세 인상/인하 3/6·5/6이다. `aiLocalFuelWeight=4`는 종류 내 입지에만 쓰고 종류 간 비교는 실제 연료비 차이×예상 발전량+건설비로 바꾼다. `aiFuelMonths=36`, `aiResearchDebtShare=0`(새 연구 인력의 차입 금지)을 사용하며 `aiDebtRepair`는 삭제한다. 공급 여유·접속량·보완 페이스 값은 유지한다. T5는 월별 누계+부동소수 허용 오차 0.000001억으로 단언을 복원한다. 최종 연구 이득 +4.483점·B16 통과·SMR 1위 2/6으로 G9의 충돌 (35)는 이 비교 집합에서 해소됐다. 탄소 100 상한과 추가 씨앗의 부채 초과는 아래에 남긴다. 실제 수치·변경 키·검사는 G10 보고를 따른다.

**충돌 (36)의 후속 결정 D-73(2026-10-20).** 종전 절대 기준의 100점 포화는 B80으로 바꾼다. 절대 눈금 0.82→0점·0.25038→80점·0→100점과 시작 대비 감축 눈금 0%→0점·40%→80점·100%→100점 중 큰 값을 쓴다. 각 구간은 선형이며 중간 점수·감축률은 params로 둔다. `normalCo2`·`co2IntDef`는 0.4173(O, [S36])으로 갱신한다. F19의 종전 단일 선형식은 이 결정으로 대체하며 집단 만족에도 같은 탄소 점수를 쓴다. `bioCo2`의 총량 밖 정보 항목 처리는 유지한다. 상세 식·결측 규칙은 [ECON-SPEC §9.1](ECON-SPEC.md#91-d-73d-74-탄소-눈금제한-수입-2026-10-20)을 따른다. T5 기술 전략과 씨앗 강건성은 후속 측정이다.

**D-74·D-79(2026-10-20).** 경제 운영에서 이웃 연계선 정산 후 시간별 잔여 부족에 현재 수요의 50%까지 외부 계통 공급을 더한다. 단가 normalCost×1.5(G), 소비 탄소 normalCo2, 지역 생산·PM 추가 0이다. C1 측정기의 고정 시작 수요 상한과 다르다. F41의 HVDC 효과는 kind가 hvdc인 선에만 용량 ×1.5(G), 손실은 기본 교류선과 같은 .01(G), 건설비 ×1.3(G)으로 확정했다. 초전도·사건 배수는 유지한다. 시험 운전 연결과 AI 예측의 적용 여부·한계는 최초 구현 보고와 [독립 검토 반영·정정](D73-INDEPENDENT-REVIEW.md)에 기록한다.

**남은 충돌 (37): 정책0의 씨앗 간 재정 안정성.** 지정된 공통 씨앗에서는 호스트·기본 봇 36달 초과 0이지만 별도 alpha/beta/gamma/delta/epsilon에서 화성의 초과 달은 0/8/11/3/10이다. 다른 다섯 도시는 초과 0이다. 고정 씨앗 수용 결과를 모든 씨앗의 안전 보증으로 확대하지 않는다.

**S4 구현·S8 연결 해소 (38): H01 입력 경계와 H03/H04 숫자 축척(2026-10-09).** 경제 엔진에 `airBase=80(G)`, `airSlope=29(M)`, `kPM=7e-6(M)`, `pmFuelW={coal:1,diesel:.8,biomass:.8,lng:.05}(M; .8은 G 포함)`, `eduAir=4(G)`를 넣고 airRef·airDefault를 삭제했다. 생산 월 발전량에 연료 가중을 적용하고, S8부터 econ-data.airNeighbours(D-69)의 방향별 참가 도시 자체 증분만 한 번 합산한다. S8b는 공통 airSpill을 삭제하고 P 비율 0.059/0.092·0.45, 나머지 land·bay G 0.2로 확정했다(sea 제외). 이주용 air=clamp(80−29ΔPM), 집단 만족용 air=clamp(80−4×29ΔPM)이다. EEA 표의 SO₂ 외 저감 가정·천안 동남/서북 구분은 REFERENCES §9 정정에 기록했다. 새로 더한 근거 키 외의 기존 O·P·M이나 G 밸런스 손잡이는 바꾸지 않았다.

S4 당시 `recal.js` 파일 그대로 **262/0**, 미구현0이다(이전251/8; 8건 해소 뒤 3씨앗의 후속 유효충격 단언도 실행되어 예상259보다3 많음). 정전 대기 행의 세 씨앗 모두 시작ΔPM=.078648㎍/㎥, air 상승2.280795점≤상한2.280795점이다. `mwScale:230`은 지역 필드에 G 지도 설계로 추가했고 scale 문구에서 숫자를 파싱하는 사용처는 없었다. H03·H04의 세수·피해 추정식은 별도 호스트/화면 작업이다.

**S8 해소(수정 1 포함):** 시작 보정에는 `tot.by × wk`, 월 입력에는 `max(0, tot.by + byX − saveBy) × wk`를 전달한다. 추가 급전·감발을 CO₂와 같은 거래에서 연료별로 누적하며 import는 제외한다. 중간 연료량은 공개 결과·36달 저장에 싣지 않는다. 입력 누락과 실제 무발전은 계속 구별한다(`pm25.own=null`, `complete=false`). 공기 이름표는 '발전 PM2.5 증분·이웃 기여, 추정', publicView 배속은 집단 만족에만 ×4다. 남은 한계는 기존 CO₂ 정산의 추가 발전 용량 가중 근사(정밀 시간별 연료 급전 아님), 수소 혼소 PM 가중, P61 사례의 다른 연료 적용과 G 0.2의 실제 수송 오차다(D-69 확정). G 기여의 화면 '게임 가정' 표시는 league.js 담당 후속 작업이다. S4 보고의 미연결 조건 검사는 당시 이력이며 현재 연결 상태와 구별한다.

S4 36개월 봇 전체9회전은18,326건/실패0이다. 재생68.800 > 디젤48.717, nothing은12·24·36개월 전 도시9/9위, B16 도시 독식 없음(storage2/6, base·renew·ties·dm 각1/6), 정책0 base 지방채 초과0달이다. 이 S4 과거 수치는 당시 호스트 genMWh 미연결 조건이며, 연결은 S8에서 해소했다.

S4 당시 최종 검증은 balance826/0·test-econ1,289,071/0·next575/0·tech167/0·sec524/0, 번호 review30개 종료0·단언 실패0이다. T5는22,030/0·SMR1위2/6·연구 이득4.617점이다. 재개 마지막 recal 재실행도262/0·미구현0이며, node --check 및 diff 공백 검사도 통과했다. 브라우저·실제 호스트 PM 전달 통합은 미검증이다.

보존 검사27·28은 재보정 9·10차 전용 범위 가드로 2026-10-10 은퇴했다(기본 실행은 건너뜀, `KCP_RUN_RETIRED=1`로 당시 검사 재현). 다음 재보정 차수는 시작 커밋 기준 새 가드를 만든다. 다른 근거 키·기술·build 및 recal의 H01 밖 보존 단언은 유지한다. 새 balance H01 및 review29에서 연료별 값·인접·정전 상한·입력 불변·결정성·결측·축척 독립성을 검사한다.

## 9. 결정이 필요한 항목(새 D-번호 후보)

| 후보 | 내용 | 근거 | 기본 구현 |
|---|---|---|---|
| D1 | 배속 재정의(β → κ 시간 압축)와 배속표 공개 | REF 2.4, 13.8 | 이 명세대로 구현(B15 문구 교체 포함) — 총괄이 D-번호로 기록 |
| D2 | HVDC 카드 의미(장거리·해저 전용 또는 송전량 제어), 초전도의 기존 선 자동 적용 → 선 교체 행동 | REF 12.1, 12.8 | 적용 범위만 고침(F41), 의미는 보류 |
| D3 | 공동 보너스(D-61) → 학급 공동 판정 또는 기여 조건부 | REF 13.6 | coopBonus 2 유지, CO₂ 목표 경로만 바꿈(F20) |
| D4 | 점수 기하평균·가중 | REF 13.1, 13.2 | 보류 — 7차 근거 보정 뒤 재판정. G6 하한30·need360 미채택, 기본 하한1·SMR need36 복원. G6 비교표와 민감도 결과는 그대로 보존 |
| D5 | RE100 산단 → 에너지산업융복합단지(수도권 제외)로 이름·효과 맞추기 | REF 4.5 | 보류 |
| D6 | CCU를 CCS로 바꿀지(ccuCo2 0.4 대 0.13) | REF 12.5 | 0.4 유지, r = 0.69를 화면에 표시 |
| D7 | 교부세 수요 구조 전면 교체(법 산식) | REF 6.7 | 자료 확보 뒤 |

**G8 결정(2026-10-06), T5 v1.1.** SMR 연구량·연료·점수 하한을 추가 조정하지 않고 비교 집합을 먼저 보완한다. 기존 기술4전략과 같은 씨앗에서 재생+저장·연계선 협력·혼합을 추가하고, 기존 `leagueAI.plan`의 신중·공격 성향과 균형 이웃을 재사용한다. 재생 묶음의 ESS는 저장 비율뿐 아니라 실제 접속 여유도 확보하며 월별 접속 대기는 유지한다. 연계선은 AI가 제안·수락한 경우만 건설하고 자동 거래의 미래 구매 상한을 예약한다. 예약과 실제 지출을 구분하고 매달 누적 지출을 SMR 누계 이하로 제한한다. 독식 필수 기준은 B16이며 SMR≤3은 관찰 목표다. 연구 이득 `(0,15]`, 일반 재생>디젤, nothing 꼴찌의 회귀를 별도 확인한다. G8 보고와 비교표를 따른다. D4 보류와 G5~G7 이력은 유지한다.

## 10. 구현 순서와 검사 명령

1. R1(§1.1 R1 행, §1.3 R1 행) → `node tests/league/test-econ.js`, `node tests/league/balance.js`, `node tests/league/next.js`, `node tests/league/tech.js`, `cd tests/league/review && for f in *.js; do [ "$f" = lib.js ] || node "$f"; done`.
2. R2 이주 묶음 F01~F06 → 같은 node 검사 + §7.2 새 검사.
3. R2 나머지(F07~F43, 파일별로 나눠 커밋) → node 검사, 브라우저 검사(`python3 tests/srv.py 9430 .` 띄우고 `tests/.venv/bin/python tests/league/{rules,e2e3,econint,econui,solo}.py http://127.0.0.1:9430/index.html`, `ai-check.py`).
4. 전략 봇 36달, F40 성장 눈금 재산출, 봇 재실행.
5. R3(H01~H10, 각각 단독 커밋) → node·브라우저·봇.
6. 회귀 14종(`tests/run.sh`) 기준선 비교, 캡처 보고, ECON-BALANCE·HANDOFF-econ·PROGRESS 갱신(총괄).

보고에는 단계마다 바뀐 키, 검사 결과(통과/실패 수), §7.2 표의 실제 값, 봇 결과표, §8에 새로 생긴 충돌을 적는다.


### G6 D4 제안 이력(보류): 하한30 + SMR 연구량360

**G7 총괄 판정 우선.** 아래는 6차 당시 제안과 측정 이력이며 현재 채택안이 아니다. 하한30은 화석 구간의 감축 신호를 가리고, need360은 근거 없는 지연이므로 철회했다.

기하평균의 집계 투입값만 `max(30, parts[k])`로 바꾸고, 탄소 절대식·부분점수 표시·여섯 가중·공동 보너스·0~100 제한은 유지한다. `scorePartFloor`는 G이며 SMR 카드 `need`는36→360(G), 실증비20·공사12턴·물리 규모·MW당 단가·연료비는 그대로다. 연구량은 실제 연구기간 추정이 아닌 이36달 게임의 기회비용이다.

요청한 네 안의 단독 비교(하한10, 탄소 절대/개선1:1, 지역 최대 시작 집약도×1.01, 연구량72/144)는 모두 SMR6/6이었다. 혼합 탄소와 지역 기준은 T5도 실패했다. 최대 시작값 자체를 최악 기준으로 쓰면 최대 도시가0점이므로 (다)는1% 여유를 둔 G 안으로 측정했다. M `scoreCo2Worst=.82`와 `scoreCo2Best=.274`는 수정하지 않았다.

연구량 단독288·360도SMR5/6이며,396·432는 아산의 실제 착공 검사를 실패했다. 실행 가능한360과 항목 하한30을 결합하면SMR3/6(평택·안성·천안), 연구 몰빵−연구0 +0.067점, nothing은12·24·36달 전 도시9/9위다. 연구 이득이 양수인 여유는 작고, 다른 씨앗·전략·게임 길이에 대한 일반적 균형을 보장하지 않는다.

REF13.1·13.2의 가치판단·비보상성·기하 집계 원칙은 참고하지만, **HDI의 원지표 최소 goalpost와 정규화 후 부분점수30점 하한은 다른 조작**이다. 이 값이 UNDP 기준이라는 뜻이 아니다. 하한 미만에서 추가 악화·작은 개선이 총점에 반영되지 않는 절충도 공개한다(탄소 약0.6562t/MWh 이상 구간). 하한 위 탄소 감축은 같은 조건에서 계속 보상하며, 실제 저탄소 연계선 전략 평균도 디젤보다 높다.

모든 안의 전략 평균·도시별1위·SMR 횟수·nothing 점수 순위·연구 이득은 G6 비교표, 검증·남은 문제는 G6 보고에 보존한다. §8 #28의 G5 실패는 이 결정 이전의 이력이다.

### G7 근거 보정(2026-10-06)

REF §12.6 정정에 따라 SMR 비용은 DOE FOAK overnight 범위6,000~10,000$/kW의 중간값8,000으로 환산한39.420289855억(M)이다. 4모듈2.956521739게임MW를 유지한다. i-SMR3,500$/kW는 설계 목표, UAMPS20,129.87$/kW는 금융 포함 사업 추정치여서 직접 건설비로 쓰지 않는다. 입지 우려 방향은 확인했으나 D-62 감점 크기의 근거가 없어 민원은 추가하지 않는다. scorePartFloor30→1, SMR need360→36. 나머지 근거 키·G 키는 유지하며 남은 G 후보는 진단만 한다. 현재 수용 여부·검사 결과·LMDI는 G7 보고와 비교표를 따른다. G6 표와 민감도는 이력으로 보존한다.

**S8 연결(2026-10-10).** §8 #26·#38의 호스트 `genMWh` 누락과 공개 ×1 표기를 해소했다. 시작 보정은 `tot.by`, 월 운영은 거래 후 `max(0, tot.by + byX − saveBy)`를 월 MWh로 전달하며 import는 제외한다. 추가·감발 구성은 기존 CO₂ 정산과 동일하며 정밀 연료별 급전과 대기 이웃 범위는 D-69의 한계로 남는다. 대기 이웃은 D-69 확정의 P61 비율·land/bay G 0.2 명시 목록으로 분리했다(sea 제외). 계획 화면은 이미 확정된 월 `goals.co2Plan`을 그대로 표시하고 `co2Basis`를 함께 보인다. 브라우저 검사는 총괄 담당이다.

### D-90 사건 범위 추가 (2026-10-25, 총괄 승인)

| 구현 키 | 승인값 | 등급 | 근거·단위·적용 범위 |
|---|---:|---|---|
| heatLngSlope | 0.007533333333333333 | M | REF 19.1 [D90-R1], 0.226 / 30 /℃. 폭염 사건의 유효 외기차에 곱함. 현재 LNG cap과 원문 기준출력의 연결은 G 근사. |
| heatPvSlope | 0.004165 | P | REF 19.1 [D90-R2], /℃. 실리콘 모듈 두 계수 0.00387·0.00446의 승인 가운데값. solar·roof만 적용. |

장마 묶음에서 호우를 q=.5(G)로 분기한다. 기존 무게·전월 묶음 제외·주 난수열·다른 사건 확률을 보존한다. 폭염 달에만 LNG 기울기 0.226/30(M)×유효 외기차 3℃(G), 실리콘 PV 기울기 .004165(P)×유효 모듈차 5℃(G)에 사건 x를 한 번 곱한다. LNG 기존·신규 cap 구분은 D-87 그대로다. 석탄·SMR·디젤·탠덤은 근거 부족으로 미감산한다(REF §19).

고온 PV 배수 `solarHeatMul`은 엔진의 공통 사건 배수 목록 `MUL`에도 등록한다. S7의 월별 사본·사건 교체 단계가 이 목록을 읽기 때문에 누락하면 폭염 감산 일부가 진행 몫으로 섞인다. 재개 검증의 32-s7-monthly가 이 누락을 검출해 엔진 목록 한 곳을 보완했으며, 화면 함수와 기존 검사 단언은 수정하지 않았다.

호우 12억·폭염 4억(G)의 보수비를 사건당 한 번 정산한다. inspect/drain은 보수비만, 폭염 dr/save는 수요만 완화한다. 남은 교부세의 월말 보수비 사용은 총괄 승인 범위다. 계획 승인·새 유료 행동의 채무 예외는 확대하지 않으며 숨은 x를 사용하지 않는다. cost.repair → energy.opex 포함/energy.repair 부분항 → fiscal.exp.repair 분리, 자산·전력원가와 분리한다. 실제 운영만 현금을 변경하고 시험·S7 사건 제거는 보수비 0이다.

제외: weather의 round/year 온도 offset, 겨울 수요 ×1.1 변경, 사건 없는 달 고온 감산, 연도별 사건확률 상승, 상시 svcCost 상승. aiScoreValue=35를 유지한다. 현재 AI에는 자동 사건 대응 선택 경로가 없어 추가하지 않았다. 네 조건·B18·sec careful·D-62·5씨앗·도시별 교부/사용/소멸·감산 MWh는 D90-report.md에 실제 실행 결과와 미검증을 구분해 기록한다. 값이 목표를 깨도 근거계수를 조정하지 않는다.
