/* ECON-TECH-SPEC T1–T3가 계약. G7 SMR 첫 호기 비용 원문 정정은 REF §12.6.
 * 값의 단위·게임 축소는 각 params의 note, need/demo는 카드 numbers에 기록한다. */
(function () {
  "use strict";
  const KCP = window.KCP;
  if (!KCP) return;
  const source = "docs/ECON-TECH-SPEC.md", evidence = "docs/ECON-TECH.md";
  const p = (v, grade, note, sources = [source, evidence]) => ({ v, grade, note, sources, refs: sources.filter(s => /^[A-Z]\d+$/.test(s)) });
  const params = {
    roundSteps: p(4.35, "M", "연구 달 환산 · 계산: 365.25/12/7≈4.35주 · 배속: 없음 · REF 12.7", [source]),
    eurekaFrac: p(1 / 3, "G", "조건 달에 남은 연구량의 1/3, 카드당 한 번"),
    licenseNeed: p(0.5, "G", "기술 이전의 필요 연구량 비율"),
    royalty: p(0.5, "G", "이전 연구 중 원 개발 도시에 월 사용료, 억"),
    royaltyMonths: p(6, "G", "이전 연구의 사용료 최대 지급 달 수"),
    royaltyCap: p(3, "G", "도시별 월 사용료 수입 상한, 억"),
    jointShare: p(0.5, "G", "공동 실증비를 두 도시가 절반씩 부담"),
    hvdcLoss: p(0.01, "G", "손실 개선 없음: 기본 연계선과 같은 1%로 두는 선택(G) · 수십 km에서는 변환소 손실 때문에 HVDC가 교류보다 손실이 작지 않다(P, [P94]·Tosatto 외 2020 [P114]) · D-79 REF 12.1", ["P94", "P114", "docs/ECON-REFERENCES.md#121-hvdc-연계선-손실hvdclosseffectivetie"]),
    hvdcCap: p(1.5, "G", "HVDC 용량 배수는 교육용 선택(G), 현실 비교값 없음 · 짧은 선의 손실 개선을 기대하지 않는 근거(P): [P94] Alassi 외 2019·[P114] Tosatto 외 2020 · 국내 북당진–고덕 35km 사례의 목적은 계통 제약 해소·공급 신뢰도(조사 §3) · D-79 REF 12.1", ["P94", "P114", "docs/ECON-REFERENCES.md#121-hvdc-연계선-손실hvdclosseffectivetie", "docs/RESEARCH-2026-10-14.md#3-d2-hvdc-카드-의미"]),
    hvdcCost: p(1.3, "G", "새 HVDC 연계선 건설비; 조사 초안 1.5보다 계약 T1 우선"),
    scableCap: p(1.5, "G", "초전도 용량; 보도 5배 대비 증가폭 배속 0.125"),
    scableLoss: p(0.5, "G", "초전도 연계선 손실 절반; 보도 1/4보다 보수적"),
    scableCooling: p(0.5, "G", "연계선당 월 냉각비 억; 양 끝이 도입하면 절반씩"),
    sicOutput: p(1.015, "P", "SiC 출력 · Hatanaka 외(2015) 최고 효율 99.1% 초과 [P95], 현실 개선 약 1% 추정 · 계산: 1+0.01×1.5 · 배속: 개선폭 ×1.5(G) · REF 12.3", ["P95"]),
    tandemOutput: p(1.2, "P", "탠덤 출력 · Fraunhofer ISE(2026) 2024Q4 결정질 22.7%·optics.org(2024) 탠덤 모듈 26.9%, 2030 전망 29/24 [I21][X19][I13] · 계산: 1.18~1.21 · 배속: 없음 · REF 12.2", ["I21", "X19", "I13"]),
    tandemCost: p(1.2, "G", "설계 선택: 탠덤 W당 프리미엄 0 · NREL ATB(2025) 효율비 약 1.2 [I21][I13] · 계산: 출력 1.2×(1+프리미엄 0) · 배속: 없음 · REF 12.2", ["I21", "I13"]),
    nbatCapacity: p(1.25, "G", "새 배터리 16→20 MWh; 밀도 +40% 발표의 0.625배"),
    nbatCost: p(15, "G", "차세대 배터리 건설비 억"),
    massCost: p(0.92, "G", "도입 뒤 새 태양광·배터리 건설비, 시장 가격 하락의 인과값 아님"),
    h2Efficiency: p(0.35, "P", "전기→수소→전기 왕복 효율 · DOE H2IQ 예시 가정 35% 안팎 [I18], Sandia 약 40%(실험실 50%) [I17] · REF 12.4", [evidence, "https://www.sandia.gov/app/uploads/sites/163/2022/03/ESHB_Ch11_Hydrogen_Headley.pdf", "I17", "I18"]),
    h2MWh: p(200, "G", "수소 저장 정격 MWh, 시작 잔량 0"),
    h2MW: p(4, "G", "수소 충전·방전 MW"),
    h2Cost: p(28, "M", "수소 저장 건설비 · Sandia(2022) 수전해 740$/kW·연료전지 500$/kW·저장 35$/kWh [I17][I14] · 계산: 11.96M$→18.6~27.5억 상단 · 배속: 없음 · REF 12.4", ["I17", "I14"]),
    h2Co2: p(0.88, "M", "수소 30 vol% 혼소의 열량 약 12% 환산 · NIST 메탄 연소열·물 생성열 [S35]로 열량 몫 고위 12.1%·저위 11.4%, 도시가스 순발열량 38.9MJ/N㎥ [L14] · REF 9.12", [source, evidence, "S35", "L14"]),
    ccuCo2: p(0.4, "G", "포집 60%; P 포집률 85–90%를 축소"),
    ccuOutput: p(0.79, "M", "포집 후 석탄 출력 · NETL(2022) 순효율 40.2→31.7% [I19][I07] · 계산: 31.7/40.2≈0.79 · 배속: 없음 · REF 12.5", ["I19", "I07"]),
    smrMW: p(4 * 170 / 230, "M", "i-SMR 발전소 4모듈×170MWe=680MWe(사업단 공개 기본 구성) [X16] · 지도 축척 230(선택 G)으로 나눠 2.956522 게임MW · 결정 v1.0.4 · REF 12.6", ["X16", "https://ismr.or.kr/source/file/i-SMR_leaflet_kr.pdf"]),
    smrCost: p((150 / 20) * (8000 / 4500) * (4 * 170 / 230), "M", "SMR 첫 호기 건설비 · DOE(2023) FOAK overnight 6,000~10,000$/kW 중간값 8,000 [I34] · 기존 기준 150억/20MW=7.5억/게임MW(G 가격지수), 7.5×(8000/4500)=13.333333억/게임MW × (4×170/230)=39.420290억 · 금융비 제외, 미국 첨단원전 범위의 대리값이며 한국 i-SMR 견적 아님 · G7 REF 12.6", ["I34", "https://www.energy.gov/ne/articles/commercializing-advanced-nuclear-reactors-explained-five-charts"]),
    smrTurns: p(12, "P", "SMR 공사 · NREL ATB(2024) 시나리오 43/55/71개월 [I13] · 계산: 55/4.4=12.5 → 12달은 선택(G), 55개월 근거(P)와 구분 · 배속: 이동과 같은 시간 ×4.4 · 결정 v1.0.3 · REF 12.6", ["I13"]),
    smrMin: p(0.8, "G", "SMR 최소 출력 비율"),
    smrFuel: p(0.002, "M", "SMR 연료비 · EIA 2022–24 원자력/가스터빈 연료비 0.16~0.34 [S33] · 계산: LNG 0.008×비=0.0013~0.0027 · 배속: 없음, smrFuelMul은 별도 G · REF 12.6", ["S33"]),
    // build.js simulate의 BMS 도입 값(bEff 0.933, 잔량 하한 저장량×0.05)과 같아야 한다. bmsEffectText가 이 값을 먼저 읽는다.
    bmsFloor: p(0.05, "G", "BMS 잔량 하한 10%→5%"),
    bmsEfficiency: p(0.933, "G", "BMS 왕복 효율 85→87%의 한 방향 √0.87≈0.933 [I13][I14] · REF 8.6", ["I13", "I14"]),
    drEffect: p(1.5, "G", "VPP 수요반응 감축량 배수; 실측 효과 미확인"),
    fcstWidth: p(0.7, "P", "사건 예보 폭은 원래 범위의 최대 0.7배(원래 범위 안으로 자름); 예측 NRMSE 30.6% 감소 [P101] · REF 12.7", ["P101"]),
    drCost: p(0.5, "G", "VPP 수요반응 정책비 배수"),
    vppCurtail: p(0.8, "G", "VPP 출력제어 손실 배수"),
    heatDamage: p(0.7, "G", "VPP 폭염 추가 수요 피해 30% 감소 근사(중복 적용 없음)"),
    re100Need: p(30, "G", "RE100 연구 시작은 직전 운영 재생 비중 30% 이상"),
    eurekaSolar: p(10, "G", "탠덤 유레카 태양광 운영 기수"),
    eurekaTies: p(2, "G", "HVDC 유레카 내부 망까지 연결된 연계선 수"),
    eurekaDr: p(3, "G", "VPP 유레카 수요반응 운영 달 수"),
    eurekaApproval: p(5, "G", "설계 선택: SMR 유레카는 시작 지지율 대비 허용 하락 5점 또는 시위 없음 · REF 11.8"),
    titleGrid: p(3, "G", "그리드 칭호 도입 장수"),
    titleOther: p(2, "G", "신소재·수소·AI 칭호 도입 장수"),
    titleSingle: p(1, "G", "환경·원자핵 갈래는 v1 카드 한 장"),
    aiLabs: p(2, "G", "컴퓨터 연구소 목표 수"),
    aiUnis: p(1, "G", "컴퓨터 대학 목표 수"),
    aiResearchReserve: p(2, "G", "컴퓨터는 연구소 운영비 두 턴분을 남긴다"),
    aiOrder: p({ cautious: ["bms", "fcst", "tandem", "nbat", "vpp", "mass", "sic"], balanced: ["grid", "fcst", "hvdc", "vpp", "sic", "scable", "re100"], bold: ["hvdc", "smr", "grid", "sic", "fcst", "vpp", "ccu"] }, "G", "성향별 연구 우선순위")
  };
  // ECON-TECH §1의 공식 목록(O). 카드 배치는 수업용 해석(G)이며 모든 분야를 채울 의무는 없다.
  const fields = [
    "인공지능 알고리즘 및 시스템", "인공지능 기반 응용", "스마트 그리드 및 전력시스템", "전력전자 및 반도체",
    "태양 에너지 응용", "배터리 소재 및 시스템", "나노소재 제조 및 분석", "수소에너지 소재",
    "수소에너지 공정", "탄소자원화 기술", "에너지 화학공학", "원자핵 에너지 시스템"
  ];
  const concentrations = ["지능형 전기안전 융합전공", "연료전지 융합전공", "전력반도체 융합전공", "차세대 SMR 융합전공", "에너지정책 융합전공"];
  const branches = [
    { id: "ai", name: "에너지AI" }, { id: "materials", name: "에너지신소재" },
    { id: "grid", name: "차세대그리드" }, { id: "hydrogen", name: "수소에너지" },
    { id: "climate", name: "환경·기후기술" }, { id: "nuclear", name: "원자핵 에너지" }
  ];
  const card = (id, branch, field, name, need, demo, req, eff, grade, why) => ({
    id, branch, field, name, need, demo, req, get eff() { return typeof eff === "function" ? eff() : eff; }, grade, why,
    // 공식 명칭과 게임 카드의 대응, 실제 근거와 게임 효과 크기를 각각 표시한다.
    fieldCategory: id === "re100" ? "concentration" : "research", fieldGrade: "O", mappingGrade: "G",
    evidenceGrade: grade.split("·").filter(g => g !== "G").join("·") || "G",
    effectGrade: id === "h2mix" ? "M" : id === "h2store" ? "P·G" : "G",
    sources: [source, evidence, "https://gs.kentech.ac.kr/process/research_field"],
    numbers: { need: p(need, "G", "필요 연구량; 기존 3종은 보존"), demo: p(demo, "G", "실증비 억, 실증 한 턴 뒤 도입") }
  });
  const cards = [
    card("grid", "grid", "스마트 그리드 및 전력시스템", "스마트 송전 운영", 8, 4, [], "현재 지도의 송전 손실을 ⅔로", "M·G", "선로 상태를 살펴 전기를 보낼 때의 손실을 줄여요."),
    card("hvdc", "grid", "스마트 그리드 및 전력시스템", "HVDC 연계선", 12, 4, [], () => `연계선 용량 ×${+params.hvdcCap.v.toFixed(2)}로 송전 용량을 늘리고 계통 제약을 푼다, 새 선 건설비 ×${+params.hvdcCost.v.toFixed(2)}`, "P·G", "짧은 거리에서는 변환소 손실 때문에 손실 개선을 기대하지 않아요."),
    card("scable", "grid", "스마트 그리드 및 전력시스템", "초전도 케이블", 24, 10, ["hvdc"], () => `연계선 용량 ×${+params.scableCap.v.toFixed(2)}, 손실 ×${+params.scableLoss.v.toFixed(2)}, 냉각 월 ${+params.scableCooling.v.toFixed(2)}억/선`, "P·G", "저항은 작아져도 냉각 전력과 비용이 들어요."),
    card("sic", "grid", "전력전자 및 반도체", "SiC 전력변환", 9, 3, [], () => `재생 출력 ×${+params.sicOutput.v.toFixed(3)}`, "P·G", "같은 햇빛과 바람에서 변환 손실을 줄여요."),
    card("bms", "materials", "배터리 소재 및 시스템", "배터리 상태 진단·고효율 변환", 6, 3, [], "", "M·G", "배터리 잔량을 더 정확히 읽어 저장한 전기를 넓게 써요."),
    card("tandem", "materials", "태양 에너지 응용", "탠덤 태양전지", 12, 5, [], () => `새 탠덤 태양광 출력 ×${+params.tandemOutput.v.toFixed(2)}, 건설비 ×${+params.tandemCost.v.toFixed(2)}`, "P·G", "기존 패널은 바뀌지 않아요."),
    card("nbat", "materials", "배터리 소재 및 시스템", "차세대 배터리", 24, 10, ["bms"], () => `새 배터리 용량 ×${+params.nbatCapacity.v.toFixed(2)}`, "P·G", "새 배터리는 더 많이 저장하며, 잔량 관리에는 상태 진단 기술이 필요해요."),
    card("mass", "materials", "나노소재 제조 및 분석", "대량 공정", 18, 8, ["tandem", "nbat"], () => `새 태양광·배터리 건설비 ×${+params.massCost.v.toFixed(2)}`, "G", "시장 전체의 가격 하락을 한 도시의 연구 성과로 보지는 않아요."),
    card("h2store", "hydrogen", "수소에너지 소재", "수전해·수소 탱크", 18, 8, [], () => `${params.h2MWh.v} MWh 장주기 저장, 왕복 ${+(params.h2Efficiency.v * 100).toFixed(2)}%`, "P·G", "많이 저장하지만 손실이 크고 처음에는 비어 있어요."),
    card("h2mix", "hydrogen", "수소에너지 공정", "수소 혼소", 12, 6, ["h2store"], () => `연결된 수소가 남아 있을 때 LNG CO₂ 최대 ${+((1 - params.h2Co2.v) * 100).toFixed(2)}% 감소`, "M", "부피 비율과 열량 비율은 달라요."),
    card("ccu", "climate", "탄소자원화 기술", "CCU 개조", 18, 10, [], () => `석탄 CO₂ ×${+params.ccuCo2.v.toFixed(2)}, 출력 ×${+params.ccuOutput.v.toFixed(2)}`, "P·G", "포집에도 전기가 들어요."),
    card("smr", "nuclear", "원자핵 에너지 시스템", "SMR", 36, 20, [], "", "P·G", "수업 시간에 맞춰 공사 기간을 줄였어요. 실제 인허가 기간과는 달라요."),
    card("fcst", "ai", "인공지능 알고리즘 및 시스템", "기상·수요 예측", 6, 2, [], () => `저녁 피크에 저장을 남기고 사건 예보 폭 최대 ${+params.fcstWidth.v.toFixed(2)}배(원래 범위 안으로 자름)`, "M·G", "예측은 날씨를 바꾸지 않아요."),
    card("vpp", "ai", "스마트 그리드 및 전력시스템", "가상발전소", 12, 4, ["fcst"], () => `수요반응 ×${+params.drEffect.v.toFixed(2)}·비용 ×${+params.drCost.v.toFixed(2)}, 출력제어 손실 ×${+params.vppCurtail.v.toFixed(2)}`, "G", "효과 크기는 수업을 위한 가정이에요."),
    card("re100", "ai", "에너지정책 융합전공", "RE100 산단", 12, 4, [], "", "G", "재생 전기가 부족하면 기업이 이 도시를 고를 매력이 낮아져요.")
  ];
  // 효과 계수는 그대로 둔다. scale은 효과 증가/감소 폭을 현실 비교 폭으로 나눈 표시값(G).
  // tandem 기준은 ECON-TECH와 ECON-DATA의 일반 모듈 22% → 상용 탠덤 26.9%다.
  const comparisons = {
    hvdc: { v: null, baseline: "현실 비교값 없음 · 국내 사례의 목적은 계통 제약 해소", reference: null },
    scable: { v: (params.scableCap.v - 1) / (5 - 1), baseline: "송전 용량 증가폭: 기존의 5배", reference: { multiplier: 5 } },
    tandem: { v: (params.tandemOutput.v - 1) / (26.9 / 22 - 1), baseline: "모듈 효율 증가폭: 일반 22% → 탠덤 26.9%", reference: { from: 22, to: 26.9, unit: "%" } },
    nbat: { v: (params.nbatCapacity.v - 1) / .4, baseline: "셀 에너지 밀도 증가폭 40%(팩 용량과 직접 같지 않아요)", reference: { increase: .4 } },
    h2store: { v: params.h2Efficiency.v / .35, baseline: "왕복 효율 30~40%의 가운데 값 35%", reference: { range: [.3, .4], midpoint: .35 } },
    h2mix: { v: (1 - params.h2Co2.v) / .12, baseline: "수소 30 vol% 혼소의 열량 환산 CO₂ 감소 12%(M)", reference: { reduction: .12, grade: "M" } },
    ccu: { v: (1 - params.ccuCo2.v) / .9, baseline: "포집률 상단 90%", reference: { capture: .9 } }
  };
  cards.forEach(c => { c.scale = { v: null, baseline: null, reference: null, grade: "G", ...comparisons[c.id] }; });
  // 외부 자료는 기존 조사 기록에서 옮긴다. 연도가 없는 자료는 추정하지 않는다.
  const referenceNotes = {
    hvdc: ["2019·2020", "D-79: [P94]·Tosatto 외 2020 [P114]·국내 북당진–고덕 사례(조사 §3)", "https://strathprints.strath.ac.uk/68378/1/Alassi_etal_RSER_2019_HVDC_transmission_technology_review_market_trends_and_future_outlook.pdf"],
    scable: ["2025", "초전도 케이블 운영 보도", "https://www.hankyung.com/article/202507072966i"],
    sic: ["자료 없음", "전력변환 비교 설계", "https://minds.wisc.edu/items/299cade1-bc94-4a3b-8a19-85a24ae2aea2"],
    tandem: ["2024-06", "상용 모듈 효율 보도", "https://optics.org/news/oxford-pv-debuts-commercial-solar-module-with-record-26.9-efficiency"],
    nbat: ["2024", "차세대 배터리 발표 보도", "https://www.ddaily.co.kr/page/view/2024072314310111898"],
    mass: ["2025", "배터리 시장 가격 조사", "https://about.bnef.com/insights/clean-energy/lithium-ion-battery-pack-prices/"],
    h2store: ["자료 없음", "수소 저장 핸드북", "https://www.sandia.gov/app/uploads/sites/163/2022/03/ESHB_Ch11_Hydrogen_Headley.pdf"],
    h2mix: ["자료 없음", "수소 혼소는 물성값으로 어림한 모형(M)", "https://gs.kentech.ac.kr/process/research_field"],
    ccu: ["2024", "발전소 탄소 포집 보고", "https://www.crugroup.com/en/communities/thought-leadership/2024/Challenges-in-achieving-90percent-carbon-capture-Technical-vs-economic-factors/"],
    smr: ["2026-03", "소형 원자로 인허가 계획 보도", "https://www.hankyung.com/article/202603048316i"]
  };
  cards.forEach(c => {
    const ref = referenceNotes[c.id];
    c.year = "2026 모집요강";
    c.effectSources = ref ? [ref[2]] : [];
    c.numbers.need.note = ref ? ref[1] + " · " + ref[2] : "분야 이름 자료 · https://gs.kentech.ac.kr/process/research_field · 효과 크기는 게임 가정(G)";
    c.numbers.need.year = ref ? ref[0] : "2026 모집요강";
  });
  params.hvdcCap.year = "2019·2020(국내 사례 연도 미기재)";
  params.h2Efficiency.year = "자료 없음";
  params.sicOutput.year = "자료 없음";
  params.ccuCo2.year = "2024";
  // build.js가 나중에 로드된다. 표시할 때 현재 PK.lossPerHex에서 읽는다.
  Object.defineProperty(cards.find(c => c.id === "grid"), "eff", {
    enumerable: true,
    get: () => KCP.buildGame?.gridEffectText?.() || "현재 지도의 송전 손실을 ⅔로"
  });
  Object.defineProperty(cards.find(c => c.id === "bms"), "eff", {
    enumerable: true,
    get: () => KCP.buildGame?.bmsEffectText?.() || `잔량 하한 ${+(params.bmsFloor.v * 100).toFixed(2)}% · 왕복 효율 약 ${Math.round(params.bmsEfficiency.v ** 2 * 100)}%`
  });
  Object.defineProperty(cards.find(c => c.id === "re100"), "eff", {
    enumerable: true,
    get: () => {
      const weight = KCP.ECON_DATA?.params.re100PolicyWeight.v;
      return `정책 선택 시 산업 매력 재생 항 가중${weight == null ? "을 높여요" : ` ×${weight}`}`;
    }
  });
  Object.defineProperty(cards.find(c => c.id === "smr"), "eff", {
    enumerable: true,
    get: () => `${+params.smrMW.v.toFixed(2)} MW, ${+params.smrCost.v.toFixed(2)}억, 건설 ${params.smrTurns.v}턴`
  });
  cards.forEach(c => {
    c.unlock = ({ hvdc: { tie: "hvdc" }, tandem: { builds: ["tandem", "tandem_roof"] },
      nbat: { builds: ["nbat"] }, h2store: { builds: ["h2store"] }, smr: { builds: ["smr"] }, re100: { policy: "re100" } })[c.id] || null;
  });
  const eventHints = {
    heatwave_peak: { cards: ["fcst", "vpp"], text: "예측·가상발전소 기술이 있으면 폭염 피해가 줄어요" },
    typhoon_coast: { cards: ["scable"], text: "초전도 기술이 있으면 연계선 단절을 막아요" }
  };
  const eureka = {
    grid: "내부 송전선 설치", get hvdc() { return `연계선 ${params.eurekaTies.v}개 연결`; }, scable: "HVDC 연계선 건설 완료", sic: "재생 발전 운영",
    bms: "배터리 운영", get tandem() { return `태양광 ${params.eurekaSolar.v}기 운영`; }, nbat: "BMS 도입 후 배터리 운영", mass: "탠덤 또는 차세대 배터리 운영",
    h2store: "출력제어 발생", h2mix: "수소 탱크 운영", ccu: "석탄 발전 운영", get smr() { return `지지율이 시작보다 ${params.eurekaApproval.v}%p 넘게 떨어지지 않음 또는 시위 없음`; },
    fcst: "폭염 사건 경험", get vpp() { return `수요반응 정책 ${params.eurekaDr.v}달 운영`; }, get re100() { return `재생 비중 ${params.re100Need.v}% 이상 운영`; }
  };
  const titles = branches.map(b => ({ id: b.id, branch: b.id,
    name: ({ grid: "그리드 개척자", materials: "신소재 개척자", hydrogen: "수소 선도 도시", climate: "탄소 순환 도시", nuclear: "원자핵 개척자", ai: "에너지AI 선도 도시" })[b.id],
    need: params[b.id === "grid" ? "titleGrid" : ["climate", "nuclear"].includes(b.id) ? "titleSingle" : "titleOther"]
  }));
  KCP.TECH_DATA = { fields, concentrations, branches, cards, pairs: [["ccu", "h2store"], ["smr", "scable"]], titles, eureka, eventHints, params };
})();
