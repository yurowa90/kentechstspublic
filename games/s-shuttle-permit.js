(function () {
  "use strict";
  const KCP = window.KCP;
  const ID = "s-shuttle-permit";
  const C = {
    clear: {name:"맑은 밤", short:"맑음", share:.65, R:80, lo:6.5, hi:7, a:6.8, a0:.8, opKm:30000, opX:3},
    rain: {name:"비 오는 밤", short:"비", share:.25, R:45, lo:3, hi:5, a:3.5, a0:1.6, opKm:2000, opX:0},
    fog: {name:"안개 낀 밤", short:"안개", share:.10, R:20, lo:4, hi:5.5, a:4.5, a0:3.5, opKm:300, opX:0}
  };
  const ORDER = ["clear", "rain", "fog"];
  const UT = [3, 4.74, 6.30, 7.75, 9.15, 10.51, 11.84, 13.15, 14.43, 15.71, 16.96];
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const fmt = (n, d = 2) => { const p = 10 ** d; return (Math.round((n + Number.EPSILON) * p) / p).toFixed(d); };
  const defaults = () => ({v:{clear:40, rain:40, fog:30}, tests:[], useOp:false, rule:"R1", liab:"L1", assume:{auto:.10, staff:.05, proof:.4, alt:1.5}});
  const gameDefaults = () => ({version:1, decisions:0, ...defaults(), testV:{clear:40, rain:40, fog:30}, tab:"vehicle", band:"rain", reason:"", prev:null, locked:null});
  function safe(R, a) { return R <= 5 ? 0 : 3.6 * a * (-.5 + Math.sqrt(.25 + 2 * (R - 5) / a)); }
  function distance(v, a) { const w = v / 3.6; return w * .5 + w * w / (2 * a) + 5; }
  function rate(c, v) { if (v === 0) return 0; const z = C[c]; return z.a0 + .4 * Math.max(0, v - safe(z.R, z.a)) + .05 * Math.max(0, 30 - v); }
  function fnv1a(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function uniform(key) {
    let t = fnv1a(key) + 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function poisson(lambda, u) {
    if (lambda === 0) return 0;
    let x = 0, p = Math.exp(-lambda), F = p;
    while (u > F) { x++; p *= lambda / x; F += p; if (x > 1000) throw new Error("poisson range"); }
    return x;
  }
  function cdf(x, mu) { if (x < 0) return 0; let p = Math.exp(-mu), F = p; for (let k = 1; k <= x; k++) { p *= mu / k; F += p; } return F; }
  function upperExact(x) {
    let lo = 0, hi = Math.max(4, x + 1);
    while (cdf(x, hi) > .05) hi *= 2;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (cdf(x, m) > .05) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  const upper = x => x <= 10 ? UT[x] : upperExact(x);
  const eligible = (testV, v) => v > 0 && testV >= v && (v >= 30 || testV === v);
  const validSpeed = (v, min) => finite(v) && v >= min && v <= 60 && v % 5 === 0;
  function testRecord(tests, c, v) {
    const n = 1 + tests.filter(t => t.c === c).length;
    return {c, v, x:poisson(.2 * rate(c, v), uniform(`sp1|t|${c}|${n}`)), n};
  }
  function snap(value, fallback, min, max, step) {
    return finite(value) ? Number((Math.round(Math.min(max, Math.max(min, value)) / step) * step).toFixed(6)) : fallback;
  }
  function normalizePlan(input) {
    const p = object(input) ? input : {}, d = defaults(), a = object(p.assume) ? p.assume : {};
    for (const c of ORDER) d.v[c] = snap(object(p.v) ? p.v[c] : undefined, d.v[c], 0, 60, 5);
    if (Array.isArray(p.tests)) {
      for (const t of p.tests) {
        if (d.tests.length === 10) break;
        if (object(t) && ORDER.includes(t.c) && validSpeed(t.v, 5)) d.tests.push(testRecord(d.tests, t.c, t.v));
      }
    }
    d.useOp = typeof p.useOp === "boolean" ? p.useOp : false;
    d.rule = ["R1", "R2", "R3"].includes(p.rule) ? p.rule : "R1";
    d.liab = ["L1", "L2", "L3"].includes(p.liab) ? p.liab : "L1";
    d.assume.auto = snap(a.auto, .10, 0, .20, .01);
    d.assume.staff = Math.min(d.assume.auto, snap(a.staff, .05, 0, .20, .005));
    d.assume.proof = snap(a.proof, .4, 0, 1, .1);
    d.assume.alt = snap(a.alt, 1.5, 0, 3, .1);
    return d;
  }
  // 시험 실행도 원본을 바꾸지 않아 검산과 화면이 같은 계산을 사용한다.
  function addTest(input, c, v) {
    const s = normalizePlan(input);
    if (s.tests.length < 10 && ORDER.includes(c) && validSpeed(v, 5)) s.tests.push(testRecord(s.tests, c, v));
    return s;
  }
  function evidenceRaw(s, c) {
    const included = s.tests.filter(t => t.c === c && eligible(t.v, s.v[c]));
    const op = s.useOp && eligible(40, s.v[c]);
    const km = 2000 * included.length + (op ? C[c].opKm : 0);
    const X = included.reduce((sum, t) => sum + t.x, 0) + (op ? C[c].opX : 0), N = km / 10000;
    const lowX = s.v[c] >= 30 ? s.tests.filter(t => t.c === c && t.v >= 30 && t.v < s.v[c]).reduce((sum, t) => sum + t.x, 0) : 0;
    return {km, N, X, lowX, point:N ? X / N : null, upper:N ? upper(X) / N : null, included:included.length, excluded:s.tests.filter(t => t.c === c).length - included.length, op};
  }
  function evidence(input, c) { return evidenceRaw(normalizePlan(input), ORDER.includes(c) ? c : "clear"); }
  function permit(s, c, e) {
    if (s.v[c] === 0) return "ban";
    if (e.N === 0) return "none";
    if (e.upper <= 3) return "auto";
    if (e.point > 3) return "deny";
    return s.rule === "R1" ? "deny" : s.rule === "R2" ? "auto" : "staff";
  }
  function evaluate(input) { return evaluatePlan(normalizePlan(input)); }
  function evaluateAssumptions(input, patch) {
    const s = normalizePlan(input);
    s.assume = {...s.assume, ...patch};
    return evaluatePlan(s);
  }
  // 민감도 비교의 절반 값은 입력 간격으로 다시 반올림하지 않는다.
  function evaluatePlan(s) {
    let share = 0, expected = 0, actual = 0, benefit = 0;
    const opShare = s.liab === "L1" ? 1 : s.liab === "L2" ? s.assume.proof : .5;
    const rows = ORDER.map(c => {
      const e = evidenceRaw(s, c), mode = permit(s, c, e), allowed = mode === "auto" || mode === "staff", r = rate(c, s.v[c]);
      const p = allowed ? s.assume[mode] : 0, cost = r * p * 30 * opShare + (mode === "staff" ? 4 : 0);
      const provide = allowed && cost <= 10, Nyear = provide ? 10 * C[c].share : 0, lambda = Nyear * r * p;
      const y = poisson(lambda, uniform(`year|${c}`));
      if (provide) { share += C[c].share; benefit += 100 * C[c].share * Math.min(1, s.v[c] / 40); }
      expected += lambda; actual += y;
      return {c, ...e, mode, r, p, cost, provide, Nyear, lambda, y};
    });
    // 결함 5: 시험 뒤 확정한 제공 비율의 운행을 시험 기간에도 했다고 가정한 상한 비교.
    // 기존 저장의 result는 normalizedCopy에서 plan으로 재계산하므로 저장 버전/키는 유지한다.
    return {rows, share, expected, actual, benefit, comp:s.liab === "L2" ? s.assume.proof : 1, operatorCost:rows.reduce((sum, e) => sum + e.lambda * 30 * opShare, 0), tailPct:100 * (1 - cdf(actual - 1, expected)), publicCost:s.liab === "L3" ? expected * 30 * .5 : 0, delay:s.tests.length, waitAlt:s.assume.alt * .6 * share * s.tests.length / 12, waitShuttle:expected * s.tests.length / 12, waitNet:(s.assume.alt * .6 * share - expected) * s.tests.length / 12, altReduced:s.assume.alt * .6 * share, altRemaining:s.assume.alt * (1 - .6 * share)};
  }
  function planOf(g) { return {...normalizePlan(g), reason:g.reason, decisions:g.decisions}; }
  function validLockedPlan(p) {
    if (!object(p) || !object(p.v) || !object(p.assume) || !ORDER.every(c => validSpeed(p.v[c], 0))) return false;
    if (!Array.isArray(p.tests) || p.tests.length > 10 || !p.tests.every(t => object(t) && ORDER.includes(t.c) && validSpeed(t.v, 5))) return false;
    if (typeof p.useOp !== "boolean" || !["R1", "R2", "R3"].includes(p.rule) || !["L1", "L2", "L3"].includes(p.liab) || typeof p.reason !== "string" || p.reason.length > 3000) return false;
    const a = normalizePlan(p).assume;
    return Object.keys(a).every(k => finite(p.assume[k]) && Math.abs(a[k] - p.assume[k]) < 1e-10);
  }
  function normalizedCopy(input) {
    const G = gameDefaults();
    if (!object(input) || input.version !== 1) return G;
    Object.assign(G, normalizePlan(input));
    G.decisions = Number.isSafeInteger(input.decisions) && input.decisions >= 0 ? input.decisions : 0;
    for (const c of ORDER) G.testV[c] = snap(object(input.testV) ? input.testV[c] : undefined, G.testV[c], 5, 60, 5);
    G.tab = ["vehicle", "evidence", "people"].includes(input.tab) ? input.tab : "vehicle";
    G.band = ORDER.includes(input.band) ? input.band : "rain";
    G.reason = typeof input.reason === "string" ? input.reason.slice(0, 3000) : "";
    // 다시 심사 직전에 확정했던 계획. 재결정 질문이 계획 변경 여부를 구분하는 데만 쓴다.
    G.prev = object(input.prev) && validLockedPlan({...input.prev, reason:""}) ? normalizePlan(input.prev) : null;
    const locked = input.locked;
    if (object(locked) && locked.modelVersion === 1 && validLockedPlan(locked.plan)) {
      const p = locked.plan, legacy = !Object.hasOwn(p, "decisions");
      const decisions = legacy ? 1 : p.decisions;
      if (Number.isSafeInteger(decisions) && decisions >= 1 && (legacy || G.decisions === decisions)) {
        const plan = {...normalizePlan(p), reason:p.reason, decisions};
        const current = {...planOf(G), decisions};
        if (JSON.stringify(plan) === JSON.stringify(current)) {
          G.decisions = decisions;
          G.locked = {modelVersion:1, plan, result:evaluate(plan)};
        }
      }
    }
    return G;
  }
  function decide(input) {
    const G = normalizedCopy(input);
    if (G.locked) return G;
    G.decisions = Math.min(Number.MAX_SAFE_INTEGER, G.decisions + 1);
    const plan = clone(planOf(G));
    G.locked = {modelVersion:1, plan, result:evaluate(plan)};
    return G;
  }
  const RULES = {
    R1: {name:"R1 엄격", verdict:"상한≤3이면 무인 허가, 그 밖은 불허", gain:"위험률의 큰 값까지 검토하며 허가 근거를 요구함", cost:"시험과 기다림이 늘 수 있고 서비스 공백이 남음"},
    R2: {name:"R2 점추정", verdict:"점추정≤3이면 무인 허가, 그 밖은 불허", gain:"짧은 시험으로도 이동수단을 제공할 여지가 있음", cost:"짧은 무사건 자료를 과신할 수 있음. 매월 조건별 거리·위험 상황·사고 기록 공개와 12개월 뒤 재심사를 의무로 붙임"},
    R3: {name:"R3 이중 기준", verdict:"상한≤3이면 무인, 점추정만≤3이면 요원 탑승, 그 밖은 불허", gain:"증거 수준에 따라 단계적으로 운행할 여지가 있음", cost:"요원 비용이 들고 요원 효과도 가정임. 매월 기록 공개와 12개월 뒤 재심사 때 무인 전환 여부를 판단함"}
  };
  const LIABS = {
    L1: {name:"L1 운영사 무과실", text:"사고와 피해가 확인되면 피해자가 기술 결함까지 입증하지 않아도 운영사가 보상합니다.", cost:"피해자의 입증 부담은 줄지만 운영사 부담 때문에 일부 조건에서 운행을 제공하지 않을 수 있습니다."},
    L2: {name:"L2 피해자 입증 과실", text:"피해자가 결함을 입증한 경우에 운영사가 보상합니다. 기록 접근과 설명을 요구할 수 있는지가 쟁점입니다.", cost:"운영사 부담은 줄지만 입증하지 못한 피해자의 부담이 남습니다."},
    L3: {name:"L3 공동 기금", text:"사고와 피해가 확인되면 결함 입증 없이 기금에서 보상하고 운영사와 공공이 절반씩 부담합니다.", cost:"보상 경로를 넓히지만 공공 부담과 안전 투자 유인 문제가 남습니다."}
  };
  const MODE = {ban:"운행 금지 선택", none:"증거 부족으로 불허", deny:"기준 미충족으로 불허", auto:"무인 허가", staff:"요원 탑승 허가"};
  const permits = mode => mode === "auto" || mode === "staff";
  const provideText = e => e.provide ? "운영사 제공" : permits(e.mode) ? "허가됐지만 운영사 미제공" : "불허로 미제공";
  function zone(c, v) { return v === 0 ? "ban" : v <= safe(C[c].R, C[c].lo) ? "below" : v <= safe(C[c].R, C[c].hi) ? "band" : "above"; }
  const ZONE = {ban:"운행 금지 선택", below:"감속도 범위 전체에서 정지 조건 충족", band:"감속도에 따라 정지 조건 달라짐", above:"감속도 범위 전체에서 정지 조건 초과"};
  KCP.ORIGINAL_ORDER = KCP.ORIGINAL_ORDER || [];
  KCP.YEARS[ID] = {
    title:"심야 자율주행 셔틀 허가 심사", format:"정지 경계와 시험 증거 설계",
    desc:"날씨별 허용 속도와 시험 주행을 정하고, 안전 증거와 이동권을 함께 고려해 심야 셔틀을 심사합니다.",
    prep:25, answer:15, mode:"조건·속도 시험 카드 · 허가 심사 · 선택에 따른 면접", original:true,
    topics:["인공지능 규제", "표준과 인증", "이동권", "사고 책임"],
    concepts:["등가속도 운동", "반응 거리와 제동 거리", "마찰력", "빛의 산란", "측정과 불확실성", "독립 시행", "표본 편향", "증거에 근거한 의사결정"],
    rubric:{
      "발산적 사고력":["시험 주행 이외의 안전 증거 수집 방법을 두 가지 이상 제안하고 각각의 한계를 설명한다.", "감속도나 사고 전환 가정이 달라질 때 허가 조건을 어떻게 바꿀지 설명한다.", "운행 허가와 금지 외에 서비스 공백과 위험을 함께 줄일 대안을 제안한다."],
      "문제해결 능력":["판단 기준 세 가지와 우선순위를 먼저 밝히고 허가 조건에 연결한다.", "정지 거리, 시험 속도, 누적 거리, 점추정과 상한을 구분해 증거를 해석한다.", "실현 사고 한 번의 결과와 결정 당시 증거의 질을 구분하고 재심사 조건을 제시한다."],
      "인문적 통찰 역량":["이동권, 보행자의 위험, 피해자의 입증 부담을 놓고 얻는 것과 잃는 것을 함께 설명한다.", "책임 규칙에 따라 운영사와 피해자와 공공이 부담하는 것이 어떻게 달라지는지 설명한다.", "반대 입장의 질문을 들은 뒤 결정을 고치거나 유지하는 이유와 남은 한계를 밝힌다."]
    },
    intent:["정지 거리의 물리적 조건과 시험 자료의 통계적 불확실성을 구분한다.", "한정된 시험을 어느 조건과 속도에 쓸지 선택하며 증거의 적용 범위를 검토한다.", "허가와 금지가 서로 다른 사람에게 남기는 위험과 서비스 공백을 함께 살핀다.", "근거 없는 세 가정을 드러내고 가정 변경이 판단에 미치는 영향을 비교한다.", "기준을 먼저 말하고, 얻는 것과 잃는 것을 함께 설명하며, 반문 뒤 판단을 재검토한다."]
  };
  // 검토 결함 8: 카드마다 요청 하나. 인증 기준 비교는 성찰로 옮겨 책임 질문과 분리한다.
  const card = (k, tag, main) => ({k, tag, main});
  const text = c => ({k:c.k, tag:c.tag, q:c.main});
  const samePlan = (a, b) => JSON.stringify(normalizePlan(a)) === JSON.stringify(normalizePlan(b));
  function questions(state) {
    const G = normalizedCopy(state && state.game);
    const c1 = {k:"sp-c1", tag:"공통 1 · 기준 먼저 · 얻는 것과 잃는 것", q:"어떤 허가 기준을 앞세웠는지 먼저 밝히고, 그 선택에서 얻는 것과 잃는 것을 한 문장에 담아 주세요."};
    const c2 = {k:"sp-c2", tag:"공통 2 · 가정", q:"가정판의 사고 전환 비율, 결함 입증 비율, 대안 이동 위험 가운데 결론을 가장 크게 좌우한 것은 무엇인가요?"};
    const counter = {k:"sp-counter", tag:"반문 · 고침·유지와 이유", q:"한 위원은 “허가하지 않는 것이 가장 안전하다”고 말하고, 다른 위원은 “야간 노동자의 귀갓길이 지금 위험하다”고 말합니다. 두 의견을 듣고 답을 고치거나 유지할 이유를 말해 주세요."};
    const div = {k:"sp-div", tag:"발산 · 새로운 증거", q:"시험 주행 말고 안전 증거를 얻는 방법 하나를 제안해 주세요."};
    if (!G.locked) return [c1, c2,
      {k:"sp-hum", tag:"공통 3 · 인문적 통찰", q:"자율주행 셔틀은 사람 운전자보다 얼마나 더 안전해야 허가받아야 할까요?"},
      {k:"sp-prep", tag:"준비 확인", q:"아직 허가를 확정하지 않았습니다. 어떤 증거를 더 확인하고 어떤 조건에서 결정을 내릴지 설명해 주세요."}, counter, div];
    const P = G.locked.plan, R = G.locked.result, row = c => R.rows.find(r => r.c === c);
    const kind = mode => mode === "auto" ? "무인" : "요원 탑승";
    let place;
    const over = ORDER.filter(c => P.v[c] > safe(C[c].R, C[c].lo)).sort((a, b) => (P.v[b] - safe(C[b].R, C[b].lo)) - (P.v[a] - safe(C[a].R, C[a].lo)) || ORDER.indexOf(a) - ORDER.indexOf(b));
    if (over.length) {
      const c = over[0];
      place = card("sp-boundary", "개별 · 정지 경계", `${C[c].name}의 허용 속도는 ${P.v[c]} km/h이고, 감속도 범위 하한으로 계산한 정지 경계는 ${fmt(safe(C[c].R, C[c].lo))} km/h입니다. 감속도가 낮은 쪽이면 여유 거리를 남겨 멈출 수 없는데, 이 선택을 유지하나요?`);
    } else if (P.v.fog === 0) {
      place = card("sp-fog-ban", "개별 · 운행 금지", "안개 낀 밤은 운행 금지를 선택했습니다. 그 밤의 귀갓길과 이동 비용은 누가 맡나요?");
    } else if (permits(row("fog").mode)) {
      const e = row("fog");
      place = card("sp-fog-permit", "개별 · 안개 증거", `안개 낀 밤의 인증에는 ${e.km} km, 위험 상황 ${e.X}건이 포함되어 ${kind(e.mode)} 허가가 나왔습니다(점추정 ${fmt(e.point)}, 상한 ${fmt(e.upper)}건/1만 km). 이 증거가 충분하다고 본 이유는 무엇인가요?`);
    } else {
      const e = row("fog");
      place = card("sp-fog-denied", "개별 · 증거 부족과 공백", `안개 낀 밤에 ${P.v.fog} km/h를 제안했지만 ${e.N === 0 ? "포함할 증거가 없어" : "선택한 인증 기준을 충족하지 못해"} 불허되었습니다. 기준을 유지하며 어떤 증거를 더 모으겠습니까?`);
    }
    const counts = ORDER.map(c => P.tests.filter(t => t.c === c).length), top = Math.max(...counts), low = Math.min(...counts), n = P.tests.length;
    const excluded = R.rows.find(e => permits(e.mode) && e.lowX > 0), opRows = R.rows.filter(e => e.op && permits(e.mode));
    let evidenceCard;
    if (R.expected > 0 && R.actual >= 1.5 * R.expected) {
      evidenceCard = card("sp-outlier", "개별 · 결과와 운", `실현 사고는 ${R.actual}건으로 모형의 예상 ${fmt(R.expected)}건보다 1.5배 이상 많았습니다. 이 모형에서 예상 ${fmt(R.expected)}건일 때 ${R.actual}건 이상이 나올 확률은 약 ${fmt(R.tailPct, 1)}%입니다. 이 한 번의 결과만으로 앞선 판단을 평가해도 될까요?`);
    } else if (excluded) {
      const e = excluded;
      evidenceCard = card("sp-excluded", "개별 · 빠진 기록", `${C[e.c].name}에서 허용 속도보다 느린 시험의 위험 상황 ${e.lowX}건이 증거에서 빠진 채 ${kind(e.mode)} 허가가 나왔습니다. 빠진 기록까지 넣으면 판단이 달라지나요?`);
    } else if (P.useOp && opRows.length) {
      evidenceCard = card("sp-op", "개별 · 운영사 자료", `독립 검증 없는 운영사 자료를 반영해 ${opRows.map(e => C[e.c].name).join(", ")}의 허가 근거로 썼습니다. 쉬운 구간에 치우쳤을 가능성이 있습니다. 허용 속도 조건 때문에 운영사 자료 중 실제로 증거에 들어간 부분은 어디까지였나요?`);
    } else if (top >= 7) {
      evidenceCard = card("sp-concentrate", "개별 · 시험 집중", `추가 시험 ${n}회 중 ${top}회를 ${C[ORDER[counts.indexOf(top)]].name}에 썼습니다. 다른 조건의 증거는 무엇으로 확보하나요?`);
    } else if (low > 0 && top - low <= 1) {
      const strict = R.rows.filter(e => P.v[e.c] > 0 && e.N > 0 && e.upper <= 3).length;
      evidenceCard = card("sp-spread", "개별 · 시험 분산", `추가 시험을 맑음 ${counts[0]}회, 비 ${counts[1]}회, 안개 ${counts[2]}회로 나눴고 상한 기준을 충족한 조건은 ${strict}개입니다. 집중과 분산 중 어떤 증거 전략이 더 적절했을까요?`);
    } else if (n === 0) {
      evidenceCard = card("sp-evidence", "개별 · 자료 선택", `추가 시험을 하지 않았습니다. ${P.useOp ? "운영사 자료로 허가된 조건도 없었습니다." : "운영사 자료도 제외했습니다."} 증거가 없는 조건을 어떻게 다루었나요?`);
    } else {
      evidenceCard = card("sp-evidence", "개별 · 자료 선택", `추가 시험에 ${n}개월을 썼습니다. 그 기다림의 비용은 누가 지나요?`);
    }
    // 재결정이면 증거 질문 대신 결정을 바꾸었는지(또는 유지했는지) 묻는다.
    if (P.decisions >= 2) {
      const redo = !G.prev ? "앞선 결정의 1년 결과를 본 뒤 다시 결정했습니다. 무엇을 보고 바꾸거나 그대로 두었나요?"
        : samePlan(G.prev, P) ? "앞선 결정의 1년 결과를 본 뒤에도 같은 계획으로 다시 결정했습니다. 무엇을 보고 그대로 두었나요?"
        : "앞선 결정의 1년 결과를 본 뒤 계획을 바꾸었습니다. 무엇을 보고 바꾸었나요?";
      evidenceCard = card(evidenceCard.k, "개별 · 재결정", redo);
    }
    const withdrawn = R.rows.filter(e => permits(e.mode) && !e.provide), loss = withdrawn.map(e => C[e.c].name).join(", ");
    const liabQ = P.liab === "L1" ? (withdrawn.length ? `무과실 책임을 선택한 이 모형에서 ${KCP.josa(loss, "은/는")} 허가됐지만 운영사가 제공하지 않습니다. 피해자 보호를 유지하면서 이 공백을 줄일 방안은 무엇인가요?` : "무과실 책임으로 피해자의 입증 부담을 줄였습니다. 운영사 부담이 커져 일부 운행을 포기한다면 이 규칙을 유지하겠습니까?") : P.liab === "L2" ? "피해자가 결함을 입증해야 보상받습니다. 알고리즘과 운행 기록에 접근하기 어렵다면 어떤 절차를 추가하겠습니까?" : "공동 기금에서 공공이 보상의 절반을 부담합니다. 운영사의 안전 투자 유인이 약해지지 않게 할 장치는 무엇인가요?";
    const governance = card(`sp-governance-${P.rule}-${P.liab}${P.liab === "L1" && withdrawn.length ? "-withdraw" : ""}`, "개별 · 사고 책임", liabQ);
    return [c1, c2, ...[place, evidenceCard, governance].map(text), counter, div];
  }
  function recap(state) {
    const G = normalizedCopy(state && state.game), P = G.locked ? G.locked.plan : G, R = G.locked && G.locked.result;
    const lines = ORDER.map(c => { const e = evidence(P, c); return `${C[c].name}: 포함 ${e.km} km·${e.X}건 / 점추정 ${e.point === null ? "증거 없음" : fmt(e.point)} / 상한 ${e.upper === null ? "증거 없음" : fmt(e.upper)}건/1만 km · 제외 시험의 위험 상황 ${e.lowX}건`; }).join("\n");
    const items = [
      {t:"상태", d:R ? `허가 결정 확정 · ${P.decisions}번째 결정` : "아직 확정하지 않음"},
      {t:"허용 속도", d:`맑은 밤 ${P.v.clear} km/h · 비 오는 밤 ${P.v.rain} km/h · 안개 낀 밤 ${P.v.fog} km/h · 0은 운행 금지`},
      {t:"시험과 제출 자료", d:`추가 시험 ${P.tests.length}/10회 · ${P.tests.length}개월 · 운영사 자료 ${P.useOp ? "반영 선택" : "제외 선택"}`},
      {t:"인증 규칙", d:`${RULES[P.rule].name}. ${RULES[P.rule].cost}`},
      {t:"책임 규칙", d:`${LIABS[P.liab].name}. ${LIABS[P.liab].text}`},
      {t:"선택한 가정", d:`사고 전환: 무인 ${fmt(P.assume.auto)}, 요원 ${fmt(P.assume.staff, 3)}. 결함 입증 ${fmt(P.assume.proof)}. 대안 이동 위험 ${fmt(P.assume.alt)}건/년 × 감소 계수 0.60. 모두 근거 없는 가정.`},
      {t:"조건별 증거", d:lines, text:lines}
    ];
    if (R) {
      const decisions = R.rows.map(e => `${C[e.c].name}: ${MODE[e.mode]} · ${provideText(e)}`).join("\n");
      items.push({t:"조건별 결정", d:decisions, text:decisions}, {t:"가정에 따라 달라지는 1년 결과", d:`제공 ${fmt(R.share * 100, 1)}% · 예상 사고 ${fmt(R.expected)}건/년 · 실현 ${R.actual}건 · 예상 공공 보상 부담 ${fmt(R.publicCost)} 가상 비용단위/년 · 예상 운영사 배상 부담 ${fmt(R.operatorCost)} 가상 비용단위/년. 보상 대상 비율은 ${fmt(R.comp * 100, 1)}%라는 모형 값. 시험 기간에 줄일 수 있었던 대안 이동 사고 상한 ${fmt(R.waitAlt)}건 · 같은 기간 셔틀 예상 사고 ${fmt(R.waitShuttle)}건 · 순감소 상한 ${fmt(R.waitNet)}건(가정 비교).`});
    }
    items.push({t:"판단 설명", d:P.reason || "아직 적지 않음"});
    return items;
  }
  const BRIEF = `<div class="scenario">
    <p class="label">문제 상황</p>
    <p>새벽시의 공단과 주거지를 잇는 노선은 밤 11시부터 새벽 5시까지 대중교통이 끊깁니다. 야간 노동자와 교통약자는 걷거나 비용이 큰 다른 이동수단을 이용합니다. 새벽셔틀(가상 운영사)이 이 시간대에 무인 자율주행 셔틀을 운행하겠다고 신청했습니다.</p>
    <p>당신은 교통안전 인증위원회의 심사관입니다. 맑은 밤, 비 오는 밤, 안개 낀 밤의 허용 속도와 시험 계획, 인증 규칙, 사고 책임 규칙을 정합니다. 운행을 기다리는 사람과 도로의 위험을 함께 지는 사람의 입장을 모두 고려해야 합니다.</p>
    <p><b>단순화한 모형</b>입니다. 정지 거리에는 실제 물리 원리를 쓰지만 차량 조건, 위험률, 비용과 세 가정은 이 게임이 정한 값입니다. 실제 자율주행 성능이나 실제 법 제도를 설명하지 않습니다.</p>
    <ul class="rules">
      <li>허용 속도는 0~60 km/h에서 5 km/h씩 바꿉니다. 0은 운행 금지입니다. 정지 경계를 넘는 선택도 가능하며, 경고와 결과를 근거로 설명해야 합니다.</li>
      <li>추가 시험은 최대 10회입니다. 카드 한 장을 실행하면 그 조건과 속도에서 2,000 km를 시험하고 1개월을 씁니다. 시험은 순서대로 진행하며 실행한 기록을 지우거나 속도를 바꿀 수 없습니다.</li>
      <li>시험 속도가 허용 속도보다 느리면 인증 증거로 쓰지 않지만, 30 km/h 이상인 느린 시험의 위험 상황은 별도로 표시하고 판단 근거를 묻습니다. 30 km/h 미만을 허용하려면 그 속도와 같은 시험이 필요합니다. 조건이 다른 시험은 합치지 않습니다.</li>
      <li>운영사 자료는 반영하거나 제외할 수 있습니다. 독립 검증을 거치지 않았고 교통량이 적은 구간에 치우쳤을 가능성이 있습니다.</li>
      <li>사고 전환 비율, 결함 입증 비율, 대안 이동 위험은 근거가 없는 가정입니다. 세 가정을 바꿔 보고, 대안 이동 위험을 0으로 두었을 때도 판단을 설명하세요.</li>
      <li>자료에 없는 노선 운영, 대체 교통, 감시 방법은 합리적으로 제안할 수 있습니다. 제안한 조건과 그 근거를 밝히며, 제안은 별도 계산에 자동 반영되지 않습니다.</li>
      <li>허가 결정 뒤 1년 운행 결과가 공개됩니다. 같은 선택에는 같은 결과가 나옵니다. 실현 사고는 조건마다 고정된 난수 하나로 셔틀 운행에서만 뽑습니다. 이 난수는 비·안개에서 나쁜 쪽 끝(비 상위 약 15%, 안개 상위 약 11%)에, 맑음에서 평균보다 조금 좋은 쪽에 놓여 있어, 비나 안개를 허가하면 예상 사고가 작아도 실현 사고가 1건 이상 나오기 쉽습니다. 대안 이동의 위험은 뽑지 않고 예상값으로만 보여 줍니다. 다시 심사해 조건을 바꿀 수 있지만 앞선 시험 기록과 사용한 예산은 유지됩니다.</li>
    </ul>
  </div><div class="task"><b>준비할 답</b><ol>
    <li>판단 기준 세 가지와 우선순위를 먼저 정하세요.</li>
    <li>조건별 허용 속도와 시험 증거를 제시하고 인증 규칙과 책임 규칙을 선택하세요.</li>
    <li>얻는 것과 잃는 것을 한 문장에 담고, 가장 약한 가정과 재심사 조건을 적으세요.</li>
    <li>허가를 반대하는 의견과 서비스 공백을 우려하는 의견을 모두 듣고 답을 고치거나 유지할 이유를 준비하세요.</li>
  </ol></div>`;
  const VEHICLE = [
    "밤의 비율은 이 모형의 값이고, 감지 거리와 감속도는 이 차량·이 모형의 값입니다. 모든 조건에서 도로는 평지이며 반응 뒤 일정한 감속도로 멈춘다고 가정합니다.",
    "감지한 뒤 제동이 시작되기까지 0.5초, 정지 뒤 남길 여유 거리는 5 m로 둡니다. 0.5초는 이 차량의 가정이며 사람의 보편적 반응 시간이 아닙니다. 제동력이 최대에 이르기까지 걸리는 시간은 넣지 않았으므로 실제 정지 거리는 이 계산보다 조금 깁니다.",
    "감지 거리는 장애물을 알아차리는 거리입니다. 기상 관측의 가시거리와 같지 않습니다. 물방울의 산란과 신호 약화로 카메라·라이다의 감지가 어려워질 수 있지만, 정도는 센서와 대상에 따라 다릅니다. 전파를 쓰는 레이더는 안개의 영향을 덜 받고, 실제 차량은 여러 센서를 함께 쓰는 센서 융합으로 서로의 약점을 보완하므로 안개가 곧 ‘보이지 않음’은 아닙니다.",
    "안개 조건의 감속도는 습기를 포함한 노면을 가정한 값입니다. 안개 자체가 이 감속도를 정하는 것은 아닙니다.",
    "주변 차량 흐름은 50 km/h로 가정합니다. 흐름보다 지나치게 느린 차와 뒤따르는 차의 속도 차는 접근·추월 상황을 늘릴 수 있어, 이 모형은 30 km/h 미만에서 추가 위험을 둡니다. 30이라는 문턱과 위험 증가량은 검증된 교통 공식이 아닙니다.",
    "정지 경계 아래에 있어도 인식 실패 등 다른 위험은 남습니다. 경계 위에 있다는 것은 이 정지 모형의 조건을 만족하지 못한다는 뜻이며, 매번 사고가 난다는 뜻은 아닙니다."
  ];
  const PHYSICS = "속도를 m/s로 바꾼 뒤 반응 거리 = 속도 × 0.5, 제동 거리 = 속도² ÷ (2 × 감속도)를 계산합니다. 두 거리와 여유 5 m를 더한 값이 감지 거리 이하여야 정지 조건을 만족합니다.";
  const STATISTICS = "점추정은 포함된 위험 상황 수를 포함 거리(1만 km 단위)로 나눈 값입니다. 단측 95% 상한은 위험률이 이 값보다 크다면 이 거리에서 지금처럼 적은 건수가 나올 확률이 5%보다 작아지는 경계입니다. 0건은 위험률 0의 확인이 아닙니다. 2,000 km에서 0건이면 상한은 15.00건/1만 km입니다. 같은 거리의 시험을 새로 하는 일을 여러 번 되풀이하면, 이렇게 구한 상한이 실제 위험률 이상인 경우가 95% 이상이라는 것이 95%의 뜻입니다. 지금 위험률이 상한 아래일 확률이 95%라는 뜻은 아닙니다. 표본 편향이나, 결과를 보고 시험을 멈추는 문제는 해결해 주지 않습니다.";
  const COSTS = "연간 주행은 모든 조건에서 제공하면 10만 km이며 날씨 비율대로 나눕니다. 제공하지 않는 조건의 주행을 다른 조건으로 옮기지 않습니다. 1만 km당 수입 10, 요원 인건비 4, 사고당 보상 규모 30은 모두 가상 비용단위입니다. 예상 배상과 요원 비용의 합이 수입 이하면 운영사가 참여한다고 둡니다. 초기 투자, 시험의 금전 비용, 감시 비용은 계산하지 않습니다.";
  const EVIDENCE_RULE = "시험 속도가 허용 속도보다 느리면 증거로 쓰지 않습니다. 더 느린 조건에서 위험 상황이 없었다는 사실은 더 빠른 운행의 안전을 보증하지 않습니다. 다만 30 km/h 미만에서는 속도 차로 인한 위험 항이 커지므로 같은 속도의 시험만 인정합니다. 조건이 다른 자료는 합치지 않습니다. 더 빠른 시험을 합친 수치는 현재 속도의 정확한 위험률 추정이 아니라 이 게임의 증거 심사 지표입니다. 30 km/h 이상인 느린 시험의 위험 상황은 포함 수치에서 빠져도 별도로 표시합니다. 이 모형에서 30 km/h 이상의 위험률은 속도가 높을수록 같거나 크므로 빠진 사건을 무시해도 좋다는 뜻은 아닙니다.";
  const RULE_NOTE = "N=0이면 모든 규칙에서 증거 부족입니다. 0 km/h는 선택에 의한 운행 금지입니다. 통과는 이 인증 규칙의 결과이며 물리적 정지 조건 충족이나 현실의 안전 인증을 뜻하지 않습니다. 세 규칙 모두 자료의 대표성과 물리적 정지 조건은 따로 검토해야 합니다.";
  const FOLLOWUP = "사후 감시와 재심사는 허가 조건에 기록됩니다. 이 게임은 운영 첫해의 고정된 정책만 계산하므로 감시가 사고를 얼마나 줄이는지, 12개월 뒤 어떤 결정을 내릴지는 계산하지 않습니다.";
  const PEOPLE = [
    ["야간 노동자·교통약자", "현재의 귀갓길에도 시간과 비용의 부담이 있습니다. 운행하지 않는 밤에는 어떤 이동수단을 마련할지 함께 심사해 주세요."],
    ["보행자·인근 주민", "셔틀을 타지 않는 사람도 도로의 위험을 나눠 집니다. 시험에 드러나지 않은 위험을 누가 받아들이기로 했는지 묻고 싶습니다."],
    ["운영사", "시험에는 시간과 비용이 듭니다. 배상과 요원 비용을 감당할 수 있는 조건에서 운행하겠습니다. 자료 공개 의무도 정해 주세요."],
    ["사고 피해자 측", "기술 내부를 모르는 사람이 결함을 입증할 수 있을까요? 운행 기록에 접근하고 설명을 받을 수 있는 절차가 필요합니다."],
    ["납세자", "공공이 보상을 맡는 이유와 범위가 분명해야 합니다. 이동 지원과 보상에 쓰는 자원을 누가 결정하는지도 묻고 싶습니다."],
    ["택시·심야버스 노동자", "서비스 공백을 메우는 방안과 기존 일자리의 변화도 함께 논의해 주세요. 자율주행만이 가능한 대안인지 검토해 주세요."],
    ["인증위원회", "적은 증거로 허가하면 위험을 놓칠 수 있고, 기다리기만 하면 이동의 부담이 이어집니다. 어느 불확실성을 누가 지게 되는지 공개하겠습니다."]
  ];
  const esc = value => KCP.esc(String(value));
  const paragraphs = texts => texts.map(t => `<p>${esc(t)}</p>`).join("");
  const kmText = n => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} km`;
  function cell(label, html, id) { return `<td><span class="sp-cell-label" aria-hidden="true">${esc(label)}</span><span${id ? ` id="${id}" class="sp-value num"` : ""}>${html}</span></td>`; }
  function table(id, caption, headers, rows) {
    return `<table id="${id}" class="sp-table"><caption>${esc(caption)}</caption><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }
  function ruleTable(selected, selectable) {
    const headers = ["규칙", "판정", "얻는 것", "잃는 것·후속 의무"];
    return table(selectable ? "sp-rule-table" : "sp-rule-costs", "세 규칙 대가 비교", headers, Object.entries(RULES).map(([k, r]) => `<tr data-sp-rule-row="${k}" class="${selected === k ? "sp-selected" : ""}"><th scope="row">${selectable ? `<button type="button" id="sp-rule-${k}" class="sp-choice btn" aria-pressed="${selected === k}">${r.name}</button>` : r.name}</th>${cell(headers[1], r.verdict)}${cell(headers[2], r.gain)}${cell(headers[3], r.cost)}</tr>`));
  }
  function stepper(c, test) {
    const prefix = test ? "tv" : "v", title = test ? "시험 속도" : "허용 속도";
    return `<label for="sp-${prefix}-${c}">${C[c].name} ${title} (km/h)</label><div class="sp-stepper"><button type="button" id="sp-${prefix}-dec-${c}" class="sp-step btn" aria-label="${C[c].name} ${title} 5 낮추기">−</button><input id="sp-${prefix}-${c}" class="sp-number" type="number" min="${test ? 5 : 0}" max="60" step="5"><button type="button" id="sp-${prefix}-inc-${c}" class="sp-step btn" aria-label="${C[c].name} ${title} 5 높이기">+</button></div>`;
  }
  function boundarySVG(G) {
    const c = G.band, z = C[c], X = r => 48 + 392 * r / 100, Y = v => 30 + 230 * (1 - v / 60);
    const points = a => Array.from({length:101}, (_, r) => [X(r), Y(safe(r, a))]);
    const low = points(z.lo), high = points(z.hi);
    const path = pts => pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
    const labels = [];
    const shapes = ORDER.map(key => {
      const x = X(C[key].R), y = Y(G.v[key]), status = zone(key, G.v[key]);
      const attr = `id="sp-point-${key}" class="sp-point" data-sp-zone="${status}"`;
      const shape = status === "ban" ? `<rect ${attr} x="${x - 5}" y="${y - 5}" width="10" height="10"/>` : status === "below" ? `<circle ${attr} cx="${x}" cy="${y}" r="5"/>` : status === "band" ? `<polygon ${attr} points="${x},${y - 7} ${x + 7},${y} ${x},${y + 7} ${x - 7},${y}"/>` : `<polygon ${attr} points="${x},${y - 7} ${x + 7},${y + 6} ${x - 7},${y + 6}"/>`;
      let ly = y + 4;
      while (labels.some(v => Math.abs(v - ly) < 14)) ly += 14;
      labels.push(ly);
      const right = key === "fog", lx = Math.min(430, Math.max(58, x + (right ? 10 : -10)));
      return `${shape}<text class="sp-point-label" x="${lx}" y="${ly}" text-anchor="${right ? "start" : "end"}">${C[key].short} ${G.v[key]}</text>`;
    }).join("");
    return `<h4>${z.name}의 정지 경계 · 다른 점의 판단은 조건별 문구 참고</h4>
      <svg id="sp-boundary-svg" class="sp-chart chart" viewBox="0 0 460 300" role="img" aria-labelledby="sp-chart-title sp-chart-desc">
        <title id="sp-chart-title">${z.name}의 정지 경계</title><desc id="sp-chart-desc">가로축 감지 거리 0~100 m, 세로축 속도 0~60 km/h. 실선은 하한 감속도 경계, 점선은 상한 감속도 경계입니다. 조건별 허용점과 수치는 아래 문구를 참고하세요.</desc>
        <defs><clipPath id="sp-plot-clip"><rect x="48" y="30" width="392" height="230"/></clipPath></defs>
        <g clip-path="url(#sp-plot-clip)"><path class="sp-exceed-area" d="M48,30 L440,30 ${path([...high].reverse()).replace(/^M/, "L")} Z"/><path class="sp-band-area" d="${path(low)} ${path([...high].reverse()).replace(/^M/, "L")} Z"/><rect class="sp-exceed-area" x="48" y="30" width="19.6" height="230"/>
        <path class="sp-bound-low" d="${path(low)}"/><path class="sp-bound-high" d="${path(high)}"/></g>
        ${[0, 20, 40, 60, 80, 100].map(t => `<line class="sp-grid" x1="${X(t)}" x2="${X(t)}" y1="30" y2="260"/><text x="${X(t)}" y="277" text-anchor="middle">${t}</text>`).join("")}
        ${[0, 10, 20, 30, 40, 50, 60].map(t => `<line class="sp-grid" x1="48" x2="440" y1="${Y(t)}" y2="${Y(t)}"/><text x="40" y="${Y(t) + 4}" text-anchor="end">${t}</text>`).join("")}
        <path class="sp-axis" d="M48,30 V260 H440"/><text x="5" y="16">속도(km/h)</text><text x="244" y="298" text-anchor="middle">감지 거리(m)</text><text x="61" y="155" transform="rotate(-90 61 155)">여유 거리 부족</text>${shapes}
      </svg><p class="small muted">실선: 하한 감속도 경계 · 점선: 상한 감속도 경계 · 띠: 감속도에 따라 정지 조건이 달라지는 범위</p>
      <p>이 위치의 경계 ${fmt(safe(z.R, z.lo))}~${fmt(safe(z.R, z.hi))} km/h${safe(z.R, z.lo) > 60 ? " · 표시 범위 밖" : ""}</p>`;
  }
  function exclusion(t, v) {
    return v === 0 ? "운행 금지 선택으로 제외" : eligible(t.v, v) ? "포함" : t.v < v ? "허용 속도보다 느려 제외" : "저속 운행에는 같은 속도 시험 필요";
  }
  function evidenceTable(G) {
    const headers = ["조건", "포함 거리", "위험 상황 합계", "점추정", "단측 95% 상한", "제외 시험 수", "제외 시험의 위험 상황"];
    return table("sp-evidence-table", "조건별 증거 · 건/1만 km", headers, ORDER.map(c => {
      const e = evidence(G, c);
      return `<tr><th scope="row">${C[c].name}</th>${cell(headers[1], kmText(e.km), `sp-km-${c}`)}${cell(headers[2], `${e.X}건`, `sp-x-${c}`)}${cell(headers[3], e.point === null ? "증거 없음" : fmt(e.point), `sp-est-${c}`)}${cell(headers[4], e.upper === null ? "증거 없음" : fmt(e.upper), `sp-upper-${c}`)}${cell(headers[5], `${e.excluded}회`, `sp-excluded-${c}`)}${cell(headers[6], `${e.lowX}건`, `sp-lowx-${c}`)}</tr>`;
    }));
  }
  function assumptionInputs() {
    return `<section id="sp-assumptions" class="sp-panel panel"><h3>이 게임이 정한 값</h3>
      <p>아래 세 묶음에는 경험 자료의 근거가 없습니다. 모두 ‘가장 불확실’로 표시합니다. 값이 작거나 크다고 더 좋은 답이 되지 않습니다.</p>
      <div id="sp-assumption-conversion" class="sp-assumption"><h4>위험 상황이 사고로 이어지는 비율</h4><span class="chip">가장 불확실</span>
        <p id="sp-conversion-desc">무인 기본 0.10, 요원 탑승 기본 0.05입니다. 위험 상황 10건마다 반드시 사고 1건이 난다는 뜻은 아닙니다. 요원이 위험 상황 자체의 빈도를 줄이는 효과는 따로 계산하지 않습니다. 요원≤무인은 이 게임이 추가한 가정입니다.</p>
        <label for="sp-auto">무인 전환 비율</label><input id="sp-auto" class="sp-number" type="number" min="0" max="0.20" step="0.01" aria-describedby="sp-conversion-desc sp-auto-range sp-assumption-impact"><p id="sp-auto-range" class="small muted">0~0.20, 0.01 간격</p>
        <label for="sp-staff">요원 전환 비율</label><input id="sp-staff" class="sp-number" type="number" min="0" max="0.10" step="0.005" aria-describedby="sp-conversion-desc sp-staff-range sp-assumption-impact"><p id="sp-staff-range" class="small muted"></p>
      </div>
      <div id="sp-assumption-proof" class="sp-assumption"><h4>피해자가 결함을 입증하는 비율</h4><span class="chip">가장 불확실</span>
        <p id="sp-proof-desc">기본 0.40입니다. L2의 보상 대상 비율과 운영사 부담에만 씁니다. 개인의 능력이나 실제 재판의 승소 확률이 아닙니다.</p>
        <label for="sp-proof">결함 입증 비율</label><input id="sp-proof" class="sp-number" type="number" min="0" max="1" step="0.10" aria-describedby="sp-proof-desc sp-proof-range sp-assumption-impact"><p id="sp-proof-range" class="small muted">0~1, 0.10 간격</p>
      </div>
      <div id="sp-assumption-alt" class="sp-assumption"><h4>대안 이동 위험</h4><span class="chip">가장 불확실</span>
        <p id="sp-alt-desc">셔틀이 없을 때 다른 귀갓길에서 생기는 예상 사고를 노선 전체의 1년당 1.50건으로 가정합니다. 학생이 0~3.00에서 0.10씩 바꿀 수 있습니다. 셔틀을 제공한 밤에 이 위험이 60% 줄어든다는 계수 0.60도 근거 없는 고정 가정입니다. 감소량은 ‘입력값 × 0.60 × 운행 제공 밤 비율’입니다. 0을 선택하면 감소도 0입니다.</p>
        <label for="sp-alt">대안 이동 위험 (건/년)</label><input id="sp-alt" class="sp-number" type="number" min="0" max="3" step="0.10" aria-describedby="sp-alt-desc sp-assumption-impact"><div class="row"><button type="button" id="sp-alt-zero" class="sp-action btn ghost">대안 위험을 0으로</button><button type="button" id="sp-alt-default" class="sp-action btn ghost">기본값 1.50</button></div>
      </div>
      <p>운행 제공, 예상·실현 사고, 보상 대상 비율과 공공·운영사 부담도 가정에 따라 달라집니다. 이동 편익 지수와 대안 이동 위험은 별도의 비교 영역에서만 봅니다. 하나의 점수로 합치지 않습니다.</p><p id="sp-assumption-impact" class="small muted"></p>
    </section>`;
  }
  function resultsHTML(locked) {
    const P = locked.plan, R = locked.result;
    const headers = ["조건", "선택한 속도", "정지 조건", "포함 거리", "X", "점추정", "상한", "인증 판정", "제외 시험의 위험 상황"];
    const decision = table("sp-decision-table", "허가 결정 · 건/1만 km", headers, R.rows.map(e => `<tr><th scope="row">${C[e.c].name}</th>${cell(headers[1], `${P.v[e.c]} km/h`)}${cell(headers[2], ZONE[zone(e.c, P.v[e.c])])}${cell(headers[3], kmText(e.km))}${cell(headers[4], `${e.X}건`)}${cell(headers[5], e.point === null ? "증거 없음" : fmt(e.point))}${cell(headers[6], e.upper === null ? "증거 없음" : fmt(e.upper))}${cell(headers[7], MODE[e.mode], `sp-permit-${e.c}`)}${cell(headers[8], `${e.lowX}건`)}</tr>`));
    const warnings = R.rows.filter(e => permits(e.mode) && e.lowX > 0).map(e => `<p class="small muted">${C[e.c].name}: 허용 속도보다 느린 시험에서 위험 상황 ${e.lowX}건이 있었지만 증거 규칙상 빠졌습니다. 이 모형에서 30 km/h 이상의 위험률은 속도가 높을수록 같거나 큽니다.</p>`).join("");
    const metrics = [
      ["share", "운행 제공 밤 비율", `${fmt(R.share * 100, 1)}%`], ["expected", "예상 사고", `${fmt(R.expected)}건/년`], ["actual", "실현 사고", `${R.actual}건`],
      ["public", "예상 공공 보상 부담", `${fmt(R.publicCost)} 가상 비용단위/년`], ["operator", "예상 운영사 배상 부담", `${fmt(R.operatorCost)} 가상 비용단위/년`]
    ];
    const compare = [["chosen", "선택한 가정", R], ["zero", "대안 위험 0", evaluate({...P, assume:{...P.assume, alt:0}})], ["default", "대안 위험 기본값 1.50", evaluate({...P, assume:{...P.assume, alt:1.5}})]];
    const unit = {benefit:"", wait:"건", waitShuttle:"건", waitNet:"건"}, tag = " <span class=\"chip\">근거 없는 가정</span>";
    const compareRows = [["expected", "셔틀 예상 사고(건/년)", "expected", ""], ["benefit", "이동 편익 지수(0~100)", "benefit", ""], ["reduced", "대안 이동 예상 사고 감소(건/년)", "altReduced", tag], ["remaining", "대안 이동 예상 사고 잔여(건/년)", "altRemaining", tag], ["wait", "시험 기간에 셔틀이 줄일 수 있었던 대안 이동 사고 상한(건)", "waitAlt", tag], ["waitShuttle", "같은 기간 셔틀 예상 사고(건)", "waitShuttle", ""], ["waitNet", "같은 기간 예상 사고 순감소 상한(건)", "waitNet", tag]].map(([key, label, field, chip]) => `<tr><th scope="row">${label}${chip}</th>${compare.map(([id, title, value]) => cell(title, `${fmt(value[field], key === "benefit" ? 1 : 2)}${Object.hasOwn(unit, key) ? unit[key] : "건/년"}`, `sp-cmp-${id}-${key}`)).join("")}</tr>`);
    const sensitivity = [
      ["선택값 그대로", {}], ["전환 비율 둘 다 절반", {auto:P.assume.auto / 2, staff:P.assume.staff / 2}],
      ["전환 비율 둘 다 두 배(무인 최대 0.20)", {auto:Math.min(.20, 2 * P.assume.auto), staff:Math.min(.20, 2 * P.assume.auto, 2 * P.assume.staff)}],
      ["입증 비율 0", {proof:0}], ["입증 비율 1", {proof:1}]
    ];
    const sh = ["가정", "제공 밤 비율", "예상 사고", "모형 보상 대상 비율", "예상 공공 보상 부담", "예상 운영사 배상 부담"];
    return `<h3 id="sp-results-heading" tabindex="-1">허가 결정</h3>${decision}${warnings}<p>시험에 쓴 기간 <span id="sp-out-delay" class="sp-value num">${R.delay}개월</span></p><p>${RULES[P.rule].name}: ${RULES[P.rule].cost}</p>${ruleTable(P.rule, false)}<p class="small muted">${RULE_NOTE}</p><p class="small muted">${FOLLOWUP}</p>
      <section id="sp-dependent" class="sp-dependent" aria-labelledby="sp-dependent-heading"><h3 id="sp-dependent-heading">가정에 따라 달라지는 값 · 운영 첫 1년</h3>
        <p>시험 종료 뒤의 12개월입니다. 시험 기간만큼 운행 기간을 빼지 않습니다. 시험 기간에는 셔틀이 다니지 않으므로, 그동안의 대안 이동 위험은 아래 가정 비교 표에서 따로 봅니다. 다음은 실제 예측이 아니라 숨겨 둔 모형과 선택한 가정으로 만든 결과입니다.</p>
        ${R.rows.map(e => `<p>${C[e.c].name}: <span id="sp-provide-${e.c}" class="sp-result-text">${provideText(e)}</span></p>`).join("")}
        <dl class="sp-metrics">${metrics.map(([id, title, value]) => `<div><dt>${title}</dt><dd id="sp-out-${id}" class="sp-value num">${value}</dd></div>`).join("")}</dl>
        <p id="sp-out-sampled" class="sp-note small muted">실현 사고는 셔틀 운행에서만 고정된 난수로 뽑은 한 번의 결과입니다. 대안 이동의 위험은 뽑지 않고 예상값으로만 보여 주므로, 셔틀의 실현 사고 수와 대안 이동의 예상 사고를 같은 무게로 견주지 마세요.</p>
        ${R.expected > 0 && R.actual > 0 ? `<p id="sp-out-tail" class="sp-note small muted">이 모형에서 예상 ${fmt(R.expected)}건일 때 ${R.actual}건 이상이 나올 확률은 약 ${fmt(R.tailPct, 1)}%입니다.</p>` : ""}
        <p>${LIABS[P.liab].text}</p><p class="small muted">모형의 보상 대상 비율: <span id="sp-out-comp" class="sp-value num">${fmt(R.comp * 100, 1)}%</span></p>${R.actual === 0 ? "<p class=\"small muted\">올해 관측한 보상률은 계산하지 않음 · 위 비율은 규칙과 가정의 값</p>" : ""}
        <p>사고 수가 적다는 사실만으로 좋은 결정이었다고 판단할 수 없습니다. 운행하지 않은 조건의 다른 이동 위험은 아래 가정 비교에서 확인합니다.</p>
      </section>
      <section id="sp-compare" class="sp-compare"><h3>가정을 바꾸면 이렇게 달라진다</h3>${table("sp-alt-compare", "대안 이동 위험 가정 비교", ["비교 항목", ...compare.map(r => r[1])], compareRows)}
        <p class="small muted">지수 100은 이 계산식의 범위이며 점수·만족도·권리 충족률이 아닙니다.</p>
        <p id="sp-wait-note" class="small muted">시험 기간에 줄일 수 있었던 대안 이동 사고 상한 = 0.6 × 대안 이동 위험 × 시험 개월 수 ÷ 12 × 제공 비율입니다. 시험 뒤 확정한 허가와 제공 비율로 처음부터 운행했다고 가정한 비교입니다. 같은 기간 셔틀 예상 사고를 빼면 순감소 상한이며, 음수이면 예상 사고가 늘어납니다. 시험 없이 같은 허가를 받을 수 있었다는 뜻은 아닙니다.</p>
        ${table("sp-sensitivity", "다른 두 가정도 바꾸어 보기", sh, sensitivity.map(([title, patch]) => {
          const e = evaluateAssumptions(P, patch);
          return `<tr><th scope="row">${title}</th>${cell(sh[1], `${fmt(e.share * 100, 1)}%`)}${cell(sh[2], `${fmt(e.expected)}건/년`)}${cell(sh[3], `${fmt(e.comp * 100, 1)}%`)}${cell(sh[4], `${fmt(e.publicCost)} 가상 비용단위/년`)}${cell(sh[5], `${fmt(e.operatorCost)} 가상 비용단위/년`)}</tr>`;
        }))}
        <p class="small muted">L1·L3에서는 입증 비율을 바꿔도 계산 결과가 같습니다. 변화가 없다는 것도 규칙의 성질입니다.</p>
      </section>`;
  }
  function renderPrep(root, state, save, next) {
    const changedVersion = object(state.game) && Object.hasOwn(state.game, "version") && state.game.version !== 1;
    const G = normalizedCopy(state.game);
    state.game = G;
    const tabs = [["vehicle", "노선과 차량"], ["evidence", "증거 읽기"], ["people", "사람들의 입장"]];
    const vehicleTable = table("sp-vehicle-table", "노선과 차량 조건", ["조건", "밤의 비율", "감지 거리 R", "최대 감속도 범위 a", "기본 허용 속도"], ORDER.map(c => `<tr><th scope="row">${C[c].name}</th>${cell("밤의 비율", `${fmt(C[c].share * 100, 0)}%`)}${cell("감지 거리 R", `${C[c].R} m`)}${cell("최대 감속도 범위 a", `${fmt(C[c].lo, 1)}~${fmt(C[c].hi, 1)} m/s²`)}${cell("기본 허용 속도", `${defaults().v[c]} km/h`)}</tr>`));
    root.innerHTML = `<div id="sp-prep" class="sp-desk desk"><div class="sp-column stack">
      <section id="sp-materials" class="sp-panel panel"><h3>자료</h3><div id="sp-tabs" class="sp-tabs tabs" role="tablist" aria-label="자료">${tabs.map(([k, title]) => `<button type="button" id="sp-tab-${k}" class="sp-tab" data-sp-tab="${k}" role="tab" aria-controls="sp-pane-${k}" aria-selected="${G.tab === k}" tabindex="${G.tab === k ? 0 : -1}">${title}</button>`).join("")}</div>
        <div id="sp-pane-vehicle" class="sp-pane" role="tabpanel" aria-labelledby="sp-tab-vehicle"${G.tab === "vehicle" ? "" : " hidden"}><h4>노선과 차량</h4><p>${VEHICLE[0]}</p>${vehicleTable}${paragraphs(VEHICLE.slice(1))}</div>
        <div id="sp-pane-evidence" class="sp-pane" role="tabpanel" aria-labelledby="sp-tab-evidence"${G.tab === "evidence" ? "" : " hidden"}><h4>정지 경계 읽기</h4><p>${PHYSICS}</p><h4>증거 읽기</h4><p>${STATISTICS}</p><p>상한은 X≤10에서 표 근사값을 씁니다. 각 조건 단독 표본의 상한이며 세 조건 동시 신뢰도 95%, 순차적 시험 중단 전체의 신뢰도 95%를 보장하지 않습니다.</p><p>${COSTS}</p></div>
        <div id="sp-pane-people" class="sp-pane" role="tabpanel" aria-labelledby="sp-tab-people"${G.tab === "people" ? "" : " hidden"}><h4>사람들의 입장</h4>${PEOPLE.map(([name, text]) => `<article class="sp-person"><h4>${name}</h4><p>${text}</p></article>`).join("")}</div>
      </section>
      <section id="sp-physics" class="sp-panel panel"><h3>정지 경계와 허용 속도</h3><p>${PHYSICS}</p><label for="sp-band">경계 보기 조건</label><select id="sp-band" class="sp-control">${ORDER.map(c => `<option value="${c}">${C[c].name}</option>`).join("")}</select><div id="sp-boundary" class="sp-boundary"></div>
        ${ORDER.map(c => `<div class="sp-speed">${stepper(c, false)}<p id="sp-zone-${c}" class="sp-zone"></p></div>`).join("")}
      </section>
      <section id="sp-tests" class="sp-panel panel"><h3>증거를 만드는 시험</h3><p>카드를 고르면 그 조건과 속도로 시험 1회를 실행합니다. 한 회는 2,000 km·1개월입니다. <span id="sp-budget-prose"></span> 기록의 건수는 사고 건수가 아니라 급제동·회피 조작·원격 개입처럼 사고로 이어질 수 있었던 위험 상황 건수입니다.</p>
        <p id="sp-budget" class="sp-summary"></p><p id="sp-live" class="sp-live" role="status" aria-live="polite" aria-atomic="true"></p>
        ${ORDER.map(c => `<article id="sp-test-card-${c}" class="sp-test-card"><h4>${C[c].name} 시험</h4>${stepper(c, true)}<p id="sp-test-speed-${c}"></p><p>2,000 km · 1개월 · 예산 1회</p><p id="sp-test-current-${c}"></p><p id="sp-test-eligible-${c}"></p><div class="row"><button type="button" id="sp-match-${c}" class="sp-action btn ghost">허용 속도와 맞추기</button><button type="button" id="sp-run-${c}" class="sp-run btn"></button></div></article>`).join("")}
        <div id="sp-log-wrap"></div>
      </section>
      <section id="sp-operator" class="sp-panel panel"><h3>운영사 제출 자료</h3>${table("sp-operator-table", "운영사 제출 자료", ["조건", "제출 시험 속도", "시험 거리", "위험 상황"], ORDER.map(c => `<tr><th scope="row">${C[c].name}</th>${cell("제출 시험 속도", "40 km/h")}${cell("시험 거리", kmText(C[c].opKm))}${cell("위험 상황", `${C[c].opX}건`)}</tr>`))}
        <label class="sp-check" for="sp-use-op"><input id="sp-use-op" class="sp-control" type="checkbox">운영사 제출 자료를 인증에 반영</label><p class="small muted">독립 검증 없음. 교통량이 적은 구간 위주로 시험했습니다. 반영해도 대표성이 검증되는 것은 아닙니다. 제출 자료는 추가 시험 예산과 월수에 포함하지 않습니다.</p><p>${EVIDENCE_RULE}</p>
      </section>
      <section id="sp-evidence" class="sp-panel panel"><h3>누적 증거</h3><p>비교 기준 3.00건/1만 km · 사람이 운전하는 심야 버스에서 같은 기준으로 센 위험 상황의 가상 추정치이며 확정된 안전선이 아닙니다.</p><div id="sp-evidence-wrap"></div><div id="sp-risk-chart" class="sp-risk-chart"></div><p class="small muted">위 막대: 단측 95% 상한 · 아래 막대: 점추정 · 점선: 기준 3.00</p></section>
    </div><div class="sp-column stack">
      <section id="sp-certification" class="sp-panel panel"><h3>어떤 증거로 허가할까</h3><p class="small muted">연습용 규칙에 따른 참고용 판정입니다.</p><div id="sp-rules" class="sp-choices seg" role="group" aria-label="인증 규칙">${ruleTable(G.rule, true)}</div><p id="sp-rule-detail"></p><p class="small muted">${RULE_NOTE}</p><p class="small muted">${FOLLOWUP}</p></section>
      <section id="sp-liability" class="sp-panel panel"><h3>책임 규칙</h3><p id="sp-liability-note" class="sp-note">책임 규칙은 단순화한 세 유형이며 실제 법 제도의 해설이 아닙니다.</p><div id="sp-liabs" class="sp-choices seg" role="group" aria-label="책임 규칙">${Object.entries(LIABS).map(([k, l]) => `<button type="button" id="sp-liab-${k}" class="sp-choice btn" aria-pressed="${G.liab === k}"><b>${l.name}</b><span>${l.text}</span><span>${l.cost}</span></button>`).join("")}</div><p id="sp-liab-detail"></p></section>
      ${assumptionInputs()}
      <section id="sp-judgment" class="sp-panel panel"><h3><label for="sp-reason">판단 설명</label></h3><textarea id="sp-reason" class="sp-note-input note" maxlength="3000" placeholder="기준 세 가지와 우선순위 → 선택한 조건과 증거 → 얻는 것과 잃는 것 → 약한 가정과 재심사 조건">${esc(G.reason)}</textarea><p id="sp-lock-status" class="sp-summary"></p><p id="sp-pending-note" class="small muted">아직 허가를 결정하지 않았습니다. 시험 자료와 정지 조건을 검토한 뒤 결정하세요.</p><p id="sp-seed-note" class="small muted">실현 사고는 조건마다 고정된 난수 하나로 셔틀 운행에서만 뽑습니다. 이 난수는 비·안개에서 나쁜 쪽 끝(비 상위 약 15%, 안개 상위 약 11%)에, 맑음에서 평균보다 조금 좋은 쪽에 놓여 있어, 비나 안개를 허가하면 예상 사고가 작아도 실현 사고가 1건 이상 나오기 쉽습니다. 대안 이동의 위험은 뽑지 않고 예상값으로만 보여 줍니다.</p><div class="row"><button type="button" id="sp-lock" class="sp-action btn primary">허가 결정</button><button type="button" id="sp-unlock" class="sp-action btn ghost" hidden>다시 심사</button></div><p id="sp-review-note" class="small muted" hidden></p></section>
      <section id="sp-results" class="sp-panel panel" hidden></section>
      ${KCP.memoPanel(state, save, "sp-memo")}
      <button type="button" id="sp-go" class="sp-action btn primary" disabled>면접실로 이동</button>
    </div></div>`;
    const $ = id => root.querySelector(`#${id}`);
    const announce = text => { $("sp-live").textContent = text; };
    const setText = (id, value) => { $(id).textContent = value; };
    function paintBoundary() {
      $("sp-boundary").innerHTML = boundarySVG(G);
      for (const c of ORDER) {
        const z = C[c];
        setText(`sp-zone-${c}`, `${ZONE[zone(c, G.v[c])]} · 정지 경계 ${fmt(safe(z.R, z.lo))}~${fmt(safe(z.R, z.hi))} km/h · 필요 감지 거리 ${fmt(distance(G.v[c], z.hi))}~${fmt(distance(G.v[c], z.lo))} m`);
      }
    }
    function paintEvidence() {
      $("sp-evidence-wrap").innerHTML = evidenceTable(G);
      const rows = ORDER.map(c => ({c, ...evidence(G, c)})).filter(e => e.N > 0);
      if (!rows.length) { $("sp-risk-chart").innerHTML = "<p>아직 포함할 증거가 없습니다.</p>"; return; }
      const max = Math.max(6, Math.ceil(Math.max(...rows.map(e => e.upper), 0) / 3) * 3);
      $("sp-risk-chart").innerHTML = KCP.hbar(rows.map(e => ({label:C[e.c].name, v:e.point, v2:e.upper})), {v2:true, max, w:460, labelW:100, ticks:[0, 3, max], c1:"var(--accent)", c2:"var(--ink-2)", aria:"포함 자료의 위험 상황 점추정과 단측 95% 상한, 건/1만 km"});
      const line = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "line"), x = 100 + (3 / max) * (460 - 100 - 44);
      for (const [key, value] of Object.entries({x1:x, x2:x, y1:14, y2:18 + rows.length * 30 + 8 - 6, stroke:"var(--ink)", "stroke-dasharray":"4 3", class:"sp-reference"})) line.setAttribute(key, String(value));
      $("sp-risk-chart").querySelector("svg").appendChild(line);
    }
    function paintTests() {
      setText("sp-budget", `남은 시험 ${10 - G.tests.length}/10회 · 사용 ${G.tests.length}개월`);
      setText("sp-budget-prose", `남은 예산은 ${10 - G.tests.length}회입니다.`);
      for (const c of ORDER) {
        setText(`sp-test-speed-${c}`, `시험 속도: ${G.testV[c]} km/h`);
        setText(`sp-test-current-${c}`, `현재 허용 속도: ${G.v[c]} km/h${G.v[c] === 0 ? " · 운행 금지" : ""}`);
        setText(`sp-test-eligible-${c}`, eligible(G.testV[c], G.v[c]) ? "현재 허가의 증거로 포함" : "현재 허가의 증거에서 제외");
        setText(`sp-run-${c}`, `${C[c].name} ${G.testV[c]} km/h에서 1회 시험`);
        $(`sp-run-${c}`).disabled = !!G.locked || G.tests.length >= 10;
        $(`sp-match-${c}`).disabled = !!G.locked || G.v[c] === 0;
      }
      const headers = ["회차", "조건", "시험 속도", "거리", "위험 상황", "증거 반영"];
      $("sp-log-wrap").innerHTML = `${G.tests.length ? "" : "<p>아직 실행한 시험이 없습니다.</p>"}${table("sp-log", "시험 기록", headers, G.tests.map((t, i) => `<tr data-sp-test-index="${i + 1}"><th scope="row">${i + 1}</th>${cell(headers[1], C[t.c].name)}${cell(headers[2], `${t.v} km/h`)}${cell(headers[3], "2,000 km")}${cell(headers[4], `${t.x}건`)}${cell(headers[5], exclusion(t, G.v[t.c]))}</tr>`))}`;
    }
    function paintChoices() {
      for (const k of Object.keys(RULES)) {
        $(`sp-rule-${k}`).setAttribute("aria-pressed", String(G.rule === k));
        $(`sp-rule-${k}`).closest("tr").classList.toggle("sp-selected", G.rule === k);
      }
      for (const k of Object.keys(LIABS)) $(`sp-liab-${k}`).setAttribute("aria-pressed", String(G.liab === k));
      setText("sp-rule-detail", RULES[G.rule].cost);
      setText("sp-liab-detail", LIABS[G.liab].text);
    }
    function paintInputs() {
      for (const c of ORDER) { $(`sp-v-${c}`).value = G.v[c]; $(`sp-tv-${c}`).value = G.testV[c]; }
      for (const key of ["auto", "staff", "proof", "alt"]) $(`sp-${key}`).value = fmt(G.assume[key], key === "staff" ? 3 : 2);
      $("sp-staff").max = String(G.assume.auto);
      setText("sp-staff-range", `0~${fmt(G.assume.auto)}, 0.005 간격`);
      $("sp-use-op").checked = G.useOp;
      $("sp-band").value = G.band;
    }
    function paintLock() {
      const locked = !!G.locked;
      root.querySelectorAll(".sp-number, #sp-band, #sp-use-op, .sp-step, .sp-choice, #sp-alt-zero, #sp-alt-default").forEach(el => { el.disabled = locked; });
      $("sp-reason").readOnly = locked;
      $("sp-lock").hidden = locked;
      $("sp-unlock").hidden = !locked;
      $("sp-go").disabled = !locked;
      $("sp-pending-note").hidden = locked;
      setText("sp-lock-status", locked ? "허가 결정 확정" : "미확정");
      $("sp-results").innerHTML = locked ? resultsHTML(G.locked) : "";
      $("sp-results").hidden = !locked;
      paintTests();
    }
    const numeric = [];
    function bindNumber(id, getter, setter, min, max, step, digits, after) {
      const el = $(id), upperLimit = () => typeof max === "function" ? max() : max;
      let errorShown = false;
      const display = () => { el.value = digits === undefined ? String(getter()) : fmt(getter(), digits); };
      const commit = () => {
        if (G.locked) { display(); return; }
        const n = el.value.trim() === "" ? NaN : el.valueAsNumber, hi = upperLimit();
        const invalid = !Number.isFinite(n) || n < min || n > hi || Math.abs(n / step - Math.round(n / step)) > 1e-8;
        if (invalid && !errorShown) { announce(`${min}~${hi}, ${step} 간격으로 입력하세요.`); errorShown = true; }
        if (!Number.isFinite(n)) { display(); return; }
        const value = snap(n, getter(), min, hi, step), previous = getter();
        setter(value); display();
        if (value !== previous) { after(); save(); }
      };
      el.addEventListener("input", () => { errorShown = false; });
      el.addEventListener("change", commit);
      el.addEventListener("blur", commit);
      el.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          if (G.locked) return;
          el.value = String(snap(getter() + (event.key === "ArrowUp" ? step : -step), getter(), min, upperLimit(), step));
          commit();
        }
      });
      numeric.push({el, commit});
      return delta => {
        if (G.locked) return;
        el.value = String(snap(getter() + delta, getter(), min, upperLimit(), step));
        commit();
      };
    }
    for (const c of ORDER) {
      let beforeExcluded = 0;
      const changeSpeed = bindNumber(`sp-v-${c}`, () => G.v[c], value => {
        beforeExcluded = G.tests.filter(t => !eligible(t.v, G.v[t.c])).length;
        G.v[c] = value;
      }, 0, 60, 5, undefined, () => {
        paintBoundary(); paintTests(); paintEvidence();
        const excluded = G.tests.filter(t => !eligible(t.v, G.v[t.c])).length;
        if (excluded !== beforeExcluded) announce(`허용 속도 변경으로 ${excluded}개의 시험이 현재 증거에서 제외되었습니다.`);
      });
      $(`sp-v-dec-${c}`).onclick = () => changeSpeed(-5);
      $(`sp-v-inc-${c}`).onclick = () => changeSpeed(5);
      const changeTest = bindNumber(`sp-tv-${c}`, () => G.testV[c], value => { G.testV[c] = value; }, 5, 60, 5, undefined, paintTests);
      $(`sp-tv-dec-${c}`).onclick = () => changeTest(-5);
      $(`sp-tv-inc-${c}`).onclick = () => changeTest(5);
      $(`sp-match-${c}`).onclick = () => { if (G.locked || G.v[c] === 0) return; G.testV[c] = G.v[c]; $(`sp-tv-${c}`).value = G.testV[c]; paintTests(); save(); };
      $(`sp-run-${c}`).onclick = () => {
        if (G.locked || G.tests.length >= 10) return;
        G.tests = addTest(G, c, G.testV[c]).tests;
        const t = G.tests[G.tests.length - 1];
        save(); paintTests(); paintEvidence();
        announce(`${C[c].name} ${t.v} km/h 시험: 위험 상황 ${t.x}건. 남은 시험 ${10 - G.tests.length}회.`);
        if (G.tests.length === 10) { $("sp-live").tabIndex = -1; $("sp-live").focus(); }
      };
    }
    const impacts = {
      auto:"이 가정에 따라 운행 제공, 예상·실현 사고, 공공·운영사 부담이 달라집니다.",
      staff:"이 가정에 따라 운행 제공, 예상·실현 사고, 공공·운영사 부담이 달라집니다.",
      proof:"L2에서는 이 가정에 따라 보상 대상 비율, 운영사 부담과 운행 제공이 달라집니다.",
      alt:"이 가정에 따라 대안 이동 예상 사고 감소와 잔여가 달라집니다."
    };
    for (const [key, max, step] of [["auto", .2, .01], ["staff", () => G.assume.auto, .005], ["proof", 1, .1], ["alt", 3, .1]]) {
      let adjusted = false;
      bindNumber(`sp-${key}`, () => G.assume[key], value => {
        G.assume[key] = value;
        adjusted = key === "auto" && G.assume.staff > value;
        if (adjusted) G.assume.staff = value;
      }, 0, max, step, key === "staff" ? 3 : 2, () => {
        $("sp-staff").max = String(G.assume.auto);
        setText("sp-staff-range", `0~${fmt(G.assume.auto)}, 0.005 간격`);
        if (adjusted) { $("sp-staff").value = fmt(G.assume.staff, 3); announce(`요원 전환 비율을 ${fmt(G.assume.staff, 3)}으로 함께 조정했습니다.`); }
        setText("sp-assumption-impact", impacts[key]);
      });
    }
    for (const [id, value] of [["sp-alt-zero", 0], ["sp-alt-default", 1.5]]) $(id).onclick = () => {
      if (G.locked) return;
      G.assume.alt = value; $("sp-alt").value = fmt(value); setText("sp-assumption-impact", impacts.alt); save();
    };
    $("sp-use-op").onchange = () => { if (G.locked) return; G.useOp = $("sp-use-op").checked; paintEvidence(); save(); };
    $("sp-band").onchange = () => { G.band = $("sp-band").value; paintBoundary(); save(); };
    for (const k of Object.keys(RULES)) $(`sp-rule-${k}`).onclick = () => { if (G.locked) return; G.rule = k; paintChoices(); save(); };
    for (const k of Object.keys(LIABS)) $(`sp-liab-${k}`).onclick = () => { if (G.locked) return; G.liab = k; paintChoices(); save(); };
    function selectTab(k, focus) {
      G.tab = k;
      for (const [key] of tabs) {
        $(`sp-tab-${key}`).setAttribute("aria-selected", String(k === key));
        $(`sp-tab-${key}`).tabIndex = k === key ? 0 : -1;
        $(`sp-pane-${key}`).hidden = key !== k;
      }
      if (focus) $(`sp-tab-${k}`).focus();
      save();
    }
    tabs.forEach(([k], i) => {
      $(`sp-tab-${k}`).onclick = () => selectTab(k, false);
      $(`sp-tab-${k}`).onkeydown = event => {
        const index = event.key === "ArrowRight" ? (i + 1) % 3 : event.key === "ArrowLeft" ? (i + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
        if (index >= 0) { event.preventDefault(); selectTab(tabs[index][0], true); }
      };
    });
    $("sp-reason").oninput = () => { if (G.locked) return; G.reason = $("sp-reason").value.slice(0, 3000); save(); };
    $("sp-lock").onclick = () => {
      if (G.locked) return;
      numeric.forEach(n => n.commit());
      Object.assign(G, decide(G));
      setText("sp-lock-status", "허가 결정 확정");
      save(); paintInputs(); paintLock();
      $("sp-review-note").hidden = true;
      announce("허가 결정을 확정했습니다.");
      KCP.toast("허가 결정을 확정했습니다.");
      $("sp-results-heading").focus();
    };
    $("sp-unlock").onclick = () => {
      if (!G.locked) return;
      G.prev = normalizePlan(G.locked.plan);
      G.locked = null; save(); paintLock();
      setText("sp-review-note", "앞선 시험과 사용한 예산은 유지됩니다. 조건을 바꾼 뒤 다시 결정하세요.");
      $("sp-review-note").hidden = false;
      $("sp-v-clear").focus();
    };
    $("sp-go").onclick = () => { if (!G.locked) return; next(); };
    paintInputs(); paintBoundary(); paintEvidence(); paintChoices(); paintLock();
    if (changedVersion) { KCP.toast("계산 규칙이 달라 게임 계획을 초기화했습니다. 메모는 남아 있습니다."); save(); }
  }
  // 검토 결함 3: Kalra·Groves(2017) 요약은 2차 출처만 확인된 상태다. 외부 네트워크를 쓰지 않았으며 원문 대조가 필요하다.
  const REFLECT = `<div id="sp-reflect" class="sp-reflect stack">
    <p>다음은 서로 다른 기준에 무게를 둔 가상의 답입니다. 같은 자료를 보고 다른 결정을 할 수 있습니다. 예시의 약점까지 자신의 답과 비교하세요.</p>
    <details id="sp-example-mobility" class="reveal sp-reveal">
      <summary>이동권을 먼저 둔 판단 <span class="tag-mine">가상의 답</span></summary>
      <p><b>기준과 무게:</b> 귀가 수단의 접근성은 높음, 피해자 보호와 사전 입증은 중간으로 두었습니다.</p>
      <p><b>선택:</b> 맑음 40, 비 40, 안개 30 km/h를 제안하고 운영사 자료를 반영했습니다. 추가 시험 없이 R2 점추정 기준과 L3 공동 기금을 골랐습니다. 매월 조건별 기록 공개와 12개월 뒤 재심사를 의무로 붙였고 기본 가정을 썼습니다.</p>
      <p><b>모형 결과:</b> 세 조건 모두 무인 허가·제공, 제공 100.0%, 예상 사고 1.27건/년, 실현 사고 2건, 보상 대상 100.0%입니다. 예상 공공 보상 부담과 운영사 배상 부담은 각각 19.05 가상 비용단위/년입니다. 대안 이동 예상 사고 감소는 0.90건/년, 잔여는 0.60건/년입니다.</p>
      <p><b>얻는 것과 잃는 것:</b> 모든 밤에 운행하고 피해자의 결함 입증 부담을 덜지만, 짧고 편향될 수 있는 자료로 허가해 도로 이용자에게 미확인 위험을 남기고 공공 부담과 운영사 안전 투자 유인 약화 문제를 만듭니다.</p>
      <p><b>약점:</b> 안개 자료 300 km·0건은 점추정 0이지만 상한은 100.00건/1만 km입니다. 안개의 숨은 기저 위험 상황률 3.5는 비교 기준 3.0건/1만 km보다 높습니다. 자료 공개는 이미 겪은 위험을 없애지 못합니다. 대안 이동 위험을 0으로 두면 사고 감소라는 수치 근거는 사라지고, 이동 접근성 자체를 얼마나 중시하는지 다시 설명해야 합니다.</p>
      <p><b>반문 뒤:</b> 운행 기록에 대한 피해자의 접근권과 독립 검증 절차를 추가하겠습니다. 이 절차의 효과가 계산에 이미 들어 있다고 주장하지는 않겠습니다. 이 예시는 공공 기금이 위험한 운행을 떠받친다는 비판을 해결하지 못했습니다.</p>
    </details>
    <details id="sp-example-proof" class="reveal sp-reveal">
      <summary>사전 입증을 먼저 둔 판단 <span class="tag-mine">가상의 답</span></summary>
      <p><b>기준과 무게:</b> 도로 이용자에게 위험을 부과하기 전의 입증과 피해자 보상은 높음, 빠른 도입은 낮음으로 두었습니다.</p>
      <p><b>선택:</b> 맑음 40 km/h, 비와 안개는 0으로 정했습니다. 운영사 자료는 제외하고 맑음 40 km/h 시험에 10회를 썼습니다. R1 엄격 기준과 L1 운영사 무과실 책임, 기본 가정을 택했습니다. 20,000 km에서 위험 상황 1건, 상한 2.37건/1만 km로 맑음만 무인 허가했고 비와 안개는 금지로 남았습니다.</p>
      <p><b>모형 결과:</b> 제공 65.0%, 예상 사고 0.52건/년, 실현 사고 0건, 보상 대상 100.0%, 예상 공공 보상 부담 0.00, 운영사 배상 부담 15.60 가상 비용단위/년입니다. 이동 편익 지수는 65.0, 대안 이동 예상 사고 감소는 0.59건/년, 잔여는 0.92건/년입니다. 시험 10개월 동안 줄일 수 있었던 대안 이동 사고 상한은 0.49건, 같은 기간 셔틀 예상 사고는 0.43건, 순감소 상한은 0.05건입니다(반올림 전 계산).</p>
      <p><b>얻는 것과 잃는 것:</b> 정한 증거 기준을 일관되게 적용하고 보상 입증 부담을 줄이는 원칙을 세웠지만, 시험에 10개월을 쓰고도 비와 안개가 낀 밤의 서비스 공백은 남았습니다.</p>
      <p><b>약점:</b> 특정 조건에 집중한 시험으로 다른 날씨의 증거는 얻지 못했습니다. 실현 사고가 0건이어도 예상 사고는 0.52건/년이며 도시 전체의 위험이 0이라는 뜻으로 읽을 수 없습니다. 엄격한 시험 비용이 작은 사업자의 진입에 미칠 영향도 따로 검토해야 합니다. 같은 허가로 처음부터 운행했다고 가정하면 시험 10개월의 대안 이동 사고 감소 상한은 0.49건이지만 셔틀 사고도 0.43건 예상되어, 순감소 상한은 약 0.05건입니다. 이 가정 비교만으로 시험을 생략할 수 있다고 판단할 수는 없습니다.</p>
      <p><b>반문 뒤:</b> 증거 기준은 유지하되 귀가 지원과 다른 교통수단을 병행하겠습니다. 추가 시험의 독립성뿐 아니라 노선 대표성도 확인하겠습니다. 그 비용과 대안의 위험은 현재 모형이 알려 주지 않습니다.</p>
    </details>
    <details id="sp-example-staged" class="reveal sp-reveal">
      <summary>단계적 허가와 감시를 택한 판단 <span class="tag-mine">가상의 답</span></summary>
      <p><b>기준과 무게:</b> 증거의 양과 이동 접근성은 높음, 공공 부담의 최소화는 중간으로 두었습니다.</p>
      <p><b>선택:</b> 맑음 40, 비 40, 안개 30 km/h, 운영사 자료 반영, 추가 시험 없음, R3 이중 기준과 L3 공동 기금, 기본 가정을 골랐습니다. 제출 자료만으로 맑음은 무인, 비와 안개는 요원 탑승 허가가 됩니다. 매월 기록을 공개하고 12개월 뒤 무인 전환·유지·중단을 재심사하겠습니다.</p>
      <p><b>모형 결과:</b> 제공 100.0%, 예상 사고 0.90건/년(원값 0.895), 실현 사고 2건, 보상 대상 100.0%입니다. 예상 공공 보상 부담과 운영사 배상 부담은 각각 13.43 가상 비용단위/년입니다. 대안 이동 예상 사고 감소는 0.90건/년, 잔여는 0.60건/년입니다. 앞의 이동권 예시와는 공동 기금 선택이 같고, R2와 R3의 증거 단계 구분에서 차이가 납니다.</p>
      <p><b>얻는 것과 잃는 것:</b> 운행하면서 증거를 보완할 기회를 얻고 피해자의 결함 입증 부담을 줄이지만, 시범 기간의 위험은 이미 도로 이용자가 지며 요원과 공공 보상의 부담도 생깁니다.</p>
      <p><b>약점:</b> 안개의 숨은 기저 위험 상황률 3.5는 비교 기준 3.0건/1만 km보다 높습니다. 요원 탑승은 사고 전환 비율을 낮추는 가정이며 이 기저율 자체를 낮추지는 않습니다. 요원이 사고 전환 비율을 절반으로 낮춘다는 근거는 없습니다. 운영사 자료의 편향도 그대로 남습니다. 서비스가 시작된 뒤에는 중단 결정을 정치적으로 되돌리기 어려울 수 있습니다.</p>
      <p><b>반문 뒤:</b> 재심사 전에 거리·위험 상황·보상 접근 절차의 점검 항목과 중단 절차를 공개하겠습니다. 어떤 지표를 얼마만큼 충족해야 하는지 별도로 합의하겠습니다. 사후 감시가 위험을 자동으로 줄인다고 계산하지는 않겠습니다.</p>
    </details>
    <details id="sp-science" class="reveal sp-reveal">
      <summary>정지 거리와 증거의 양 <span class="tag-mine">연습용 해설</span></summary>
      <p><b>정지 거리:</b> 속도 v를 m/s로 바꾸면 반응 거리는 v·t, 일정한 감속도 크기 a에서 제동 거리는 v²/(2a)입니다. 여유 m을 남기려면 v·t+v²/(2a)+m≤R이어야 합니다. 양의 해를 풀면 v=a(−t+√(t²+2(R−m)/a))가 됩니다.</p>
      <p><b>속도를 올리면:</b> 다른 조건이 같을 때 속도를 10% 올리면 제동 거리는 1.1²=1.21배입니다. 예를 들어 36 km/h는 10 m/s이고 a=4 m/s²이면 제동 거리 12.5 m입니다. 39.6 km/h는 11 m/s라서 15.125 m입니다. 반응 거리는 10% 늘므로 반응 거리까지 더한 전체 정지 거리가 언제나 21% 느는 것은 아닙니다.</p>
      <p><b>마찰과 감속도:</b> 미끄러지지 않고 낼 수 있는 최대 감속도는 대략 μg입니다(μ: 타이어와 노면 사이 마찰 계수, g=9.8 m/s²). 이 게임의 맑음 6.5~7.0 m/s²는 μ≈0.66~0.71, 비 3.0~5.0 m/s²는 μ≈0.31~0.51, 안개(젖은 노면) 4.0~5.5 m/s²는 μ≈0.41~0.56에 해당하는 설정입니다.</p>
      <p><b>노면과 감지:</b> 젖은 노면에서는 타이어와 노면의 마찰 조건이 바뀌어 가능한 감속도가 줄 수 있습니다. 비와 안개의 물방울은 빛을 산란시키고 신호를 약화시켜 감지를 어렵게 할 수 있습니다. 실제 효과는 수막, 타이어, 센서 파장, 대상 반사 특성 등에 따라 달라집니다. 안개가 있다는 사실만으로 노면 마찰이나 감지 거리가 하나로 결정되지는 않습니다. 젖은 노면의 마찰 계수는 속도가 높을수록 더 떨어지는 경향이 있어(수막이 생기기 쉬움), 속도와 관계없이 일정한 감속도를 두는 이 계산은 빠른 속도에서 낙관적입니다. 0.5초의 반응 시간에는 제동력이 최대에 이르는 시간이 빠져 있어 이 점에서도 정지 거리가 짧게 나옵니다. 카메라·라이다가 약해지는 안개에서도 전파를 쓰는 레이더는 영향을 덜 받으므로, 실제 차량은 여러 센서를 묶는 센서 융합으로 감지 거리를 지킵니다.</p>
      <p><b>0건의 뜻:</b> 서로 독립인 n번의 기회에서 사건 확률이 p로 같다면 0건일 확률은 (1−p)ⁿ입니다. 이를 0.05로 놓으면 p=1−0.05^(1/n)이고, p가 작을 때 ln(1−p)≈−p를 써서 p≈−ln(0.05)/n≈3/n입니다. n이 작을 때 3/n이 확률 범위를 넘으면 근사식을 그대로 쓰면 안 됩니다.</p>
      <p><b>거리로 셀 때:</b> 이 게임은 이항 시행 횟수 대신 거리 노출 N(1만 km)에서 포아송 사건 수를 셉니다. 0건일 확률 exp(−rN)=0.05를 풀면 r의 상한은 2.9957/N입니다. 게임 표는 이를 3.00/N으로 근사합니다. 300 km는 N=0.03이므로 0건이어도 상한은 100.00건/1만 km입니다. km를 이항 시행 수와 무조건 같다고 둘 수는 없습니다.</p>
      <p><b>왜 사고가 아니라 위험 상황을 셀까:</b> 사망 사고처럼 심각한 사고는 너무 드물어 시험 주행으로 직접 입증하기 어렵습니다. 미국 RAND 연구소의 계산(Kalra·Paddock, 2016)에 따르면, 사람 운전자의 사망 사고율(1억 마일당 1.09건)보다 낮다는 것을 95% 신뢰로 보이려면 사고 없이 약 2억 7,500만 마일을 달려야 합니다. 이 게임의 3/N 근사와 같은 계산입니다(3 ÷ 1.09건/1억 마일 ≈ 2.75억 마일). 그래서 이 게임은 더 자주 일어나는 위험 상황을 세고, 위험 상황이 사고로 이어지는 비율은 검증되지 않은 가정으로 따로 둡니다. 증거의 사슬에서 가장 약한 고리가 이 전환입니다.</p>
      <p><b>예산의 한계:</b> 비 오는 밤의 숨은 기저율 1.6건/1만 km는 기준 3.0보다 낮습니다. 그래도 정지 경계 아래 속도에서 10회 예산을 모두 써서 2만 km를 시험하면 위험 상황은 평균 3.2건이고, R1 상한 기준(2만 km에서 1건 이하)을 통과할 확률은 약 17%입니다. 이 게임의 고정된 시험 결과는 40 km/h에서 5건, 상한 5.26건/1만 km입니다. 평균적인 결과로 통과를 기대하려면 4만 km 안팎이 필요합니다. 엄격한 기준의 불허는 ‘위험하다’가 아니라 ‘아직 보이지 못했다’는 뜻일 수 있습니다. RAND의 다른 연구(Kalra·Groves, 2017)는 사람보다 조금 더 안전할 때 도입하는 쪽이 훨씬 안전해질 때까지 기다리는 쪽보다 장기적으로 더 많은 생명을 구할 수 있다고 추정했습니다. 그 차이의 크기는 운행 중 기술이 얼마나 빨리 나아지는지와 보급 속도에 크게 달려 있으며, 이른 허가가 신뢰를 잃게 할 위험은 따로 남습니다.</p>
      <p><b>시험의 적용 범위:</b> 느린 시험의 무사건 기록은 빠른 운행을 보증하지 않습니다. 반대로 이 모형은 30 km/h 미만에서 느린 속도의 추가 위험 항을 더하므로 매우 느린 운행도 빠른 시험만으로 판단할 수 없습니다. 그래서 그 구간은 같은 속도 시험을 요구합니다. 여러 속도를 합친 점추정은 그 시험들의 거리 가중 평균이고, 현재 허용 속도의 정확한 추정치라고 단정하지 않습니다.</p>
      <p><b>표본 편향과 95%:</b> 쉬운 구간에 치우친 자료는 길어도 전체 노선을 대표하지 못할 수 있습니다. 통상적인 95% 상한은 같은 시험 설계로 표본을 새로 뽑는 일을 반복할 때의 절차적 성질이며, 현재 위험률이 그 아래일 확률이 반드시 95%라는 뜻은 아닙니다. 결과를 보고 시험 조건과 중단 시점을 고르는 이 게임의 운영에는 결과를 본 뒤의 선택이 신뢰 수준을 흐리는 문제가 남습니다. 사람 운전자 기준 3.0도 가상 추정치입니다.</p>
    </details>
    <details id="sp-model-limits" class="reveal sp-reveal">
      <summary>숨은 설정과 빠진 것 <span class="tag-mine">연습용 해설</span></summary>
      <p>숨은 감속도는 맑음 6.8, 비 3.5, 안개 4.5 m/s²입니다. 숨은 기저 위험 상황률은 각각 0.8, 1.6, 3.5건/1만 km입니다. 안개의 기저율 3.5는 비교 기준 3.0보다 높아, 이 모형에서는 어느 속도에서도 안개의 숨은 위험 상황률이 기준 아래로 내려가지 않습니다. 안개를 허가한 판정은 모두 기준보다 위험한 운행을 허가한 셈입니다. 모두 이 차량·이 모형의 값이며 실제 자율주행 성능 측정값이 아닙니다.</p>
      <p>위험 상황률 r(v)는 기저율에 0.4×max(0,v−정지 경계)와 0.05×max(0,30−v)를 더합니다. 이때 v는 km/h이고 경계도 km/h입니다. 0 km/h는 운행 금지로 따로 처리합니다. 두 증가량은 교육용 설정입니다. 시험은 r×0.2를 평균으로 사건 수를 만들고, 운행은 제공한 거리×r×사고 전환 비율을 평균으로 사고 수를 만듭니다.</p>
      <p>위험 상황은 급제동·회피 조작·원격 개입처럼 사고로 이어질 수 있었던 상황으로 단순화했습니다. 사고 심각도와 피해의 차이를 다루지 않았고 사건이 서로 독립이라고 가정했습니다. 충돌 에너지는 ½mv²로 속도의 제곱에 비례해, 같은 차가 50 km/h로 부딪칠 때의 운동 에너지는 30 km/h일 때의 약 2.8배입니다. 보행자의 사망 위험도 충돌 속도가 높아질수록 가파르게 커지지만, 이 모형은 사고 하나하나를 속도와 관계없이 같은 무게로 셉니다. 감속도와 감지 거리는 조건 안에서 일정하며 경사, 노선별 차이, 보행자 행동, 다른 차량의 대응을 제외했습니다.</p>
      <p>운영사 제출 자료는 숨은 위험률로 만든 값이 아니라 고정된 가상 자료입니다. 이 모형은 쉬운 구간 편향의 크기를 계산하지 않으므로, 숨은 기저율과 비교해 편향이 있었는지 판정할 수 없습니다.</p>
      <p>해킹, 통신 장애, 소프트웨어 업데이트 뒤 성능 변화, 장애 유형의 군집, 데이터 누락도 빠졌습니다. 운영사는 모형의 평균 비용을 안다고 가정하며 장기 평판, 보험, 초기 투자와 현금 흐름은 고려하지 않습니다. 초저속에서도 연간 주행과 밤의 제공을 유지할 수 있다고 보므로 실제 배차 계획과 다릅니다.</p>
      <p>사고 전환, 입증 비율, 대안 이동 위험은 모두 근거 없는 가정입니다. 이동 편익 지수는 거리·시간·접근성을 제대로 측정한 지표가 아닙니다. 대안 이동 위험을 0으로 두어도 비용·시간·접근성의 쟁점은 남고, 반대로 기본값을 썼다는 이유로 허가가 정답이 되지 않습니다.</p>
      <p>책임 규칙은 단순화한 세 유형이며 실제 법 제도의 해설이 아닙니다. 보상 대상 비율은 개인별 결과나 실제 보상 통계가 아닙니다. R2·R3의 감시·재심사 의무가 첫해 사고를 줄이는 효과는 계산하지 않았습니다.</p>
      <p id="sp-teacher-link"><b>교사용 연결:</b> 날씨와 속도에 따라 허가 범위를 나누는 이 게임의 설계는, 자율주행 시스템이 안전하게 작동하도록 설계된 조건의 범위인 운행가능영역(ODD, Operational Design Domain) 개념과 닮았습니다. SAE 분류의 레벨 4는 이 영역 안에서 사람의 개입 없이 주행하는 단계입니다. 한국에서는 「자율주행자동차 상용화 촉진 및 지원에 관한 법률」 개정으로 2025년 3월 20일부터 안전기준이 없는 레벨 4 이상 자율주행차의 성능을 정부가 인증하는 제도가 시행되었습니다. 실제 인증의 절차와 기준은 이 게임과 다르며, 이 문장은 실제 법 제도의 해설이 아닙니다.</p>
      <p>1년 결과의 실현 사고는 조건마다 고정된 난수 하나로 뽑습니다. 이 난수는 비에서 나쁜 쪽 상위 약 15%, 안개에서 약 11%, 맑음에서 평균보다 조금 좋은 쪽(하위 약 37%)에 놓여 있어, 비는 그 조건의 예상 사고가 약 0.16건, 안개는 약 0.11건만 넘어도 실현 사고가 1건 이상 나옵니다. 이 사실은 결정 전에도 문제 상황과 판단 설명 칸에 공개했습니다. 실현 사고는 셔틀에서만 뽑고 대안 이동의 위험은 예상값으로만 보여 주므로, 두 값은 같은 무게로 견줄 수 없습니다. 같은 시드의 같은 선택은 같은 결과를 만듭니다. 이것은 비교를 위한 장치이며 앞으로 현실에서 일어날 일을 예측한 것이 아닙니다. 좋은 결과가 나왔다는 이유만으로 결정의 근거가 충분했다고 결론 내리지 마세요.</p>
    </details>
    <p class="sp-reflect-prompt">사람 운전자의 위험도가 추정치라는 점을 고려하면, 셔틀은 얼마나 더 안전해야 허가받아야 할까요?</p><p class="sp-reflect-prompt">선택한 인증 기준의 약점 가운데 12개월 재심사로도 남는 것은 무엇인가요?</p><p class="sp-reflect-prompt">예시와 달리 무게를 둔 기준은 무엇인가요? 다음 심사에서 바꿀 조건 한 가지와, 그대로 유지할 기준 한 가지를 공통 성찰 메모에 적으세요.</p>
  </div>`;
  function reflectExtra(state) {
    return normalizedCopy(state && state.game).locked ? REFLECT : `<p class="sp-note small muted">아직 허가를 확정하지 않았습니다. 준비실에서 결정한 뒤 예시와 모형 해설을 비교하세요.</p>`;
  }
  KCP.games[ID] = {
    brief:() => BRIEF, renderPrep, questions, recap, reflectExtra,
    model:{defaults, gameDefaults, normalizePlan, normalizedCopy, addTest, decide, safe, distance, rate, uniform, poisson, cdf, upper, upperExact, eligible, evidence, evaluate, compute:evaluate, evaluateAssumptions, fmt, zone, questionKeys:state => questions(state).map(q => q.k)}
  };
  if (!KCP.ORIGINAL_ORDER.includes(ID)) KCP.ORIGINAL_ORDER.push(ID);
})();
