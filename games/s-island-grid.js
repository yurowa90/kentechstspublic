/* 섬 전력망 24시: 계산·저장 검증과 화면을 분리한다. */
(function () {
  const KCP = window.KCP;
  const esc = KCP.esc;
  const id = "s-island-grid";
  const MODEL = "ig-8-v2";
  const EPS = 1e-9;
  const D = [6.7, 7, 9.2, 11, 12, 11.6, 9.9, 8];
  const T = [26, 27, 30, 33, 35.5, 34, 31, 28];
  const F = [0, .05, .42, .78, .80, .42, .04, 0];
  const WIND = [.9, .9, .8, .7, .7, .8, .9, 1];
  const scenarioIds = ["S1", "S2", "S3"];
  const prob = [.5, .3, .2];
  const scenarios = { S1: "S1 예보대로", S2: "S2 오후 구름", S3: "S3 더 더움", none: "세 날씨 모두 정전 없음" };
  const criteria = { outage: "정전 최소", emission: "배출·대기오염 최소", cost: "비용 최소", fair: "피해의 공정한 분배", tomorrow: "내일 대비 잔량" };
  const shedNames = { R1: "균등(부하 비례)", R2: "취약성 보호", R3: "경제 피해 최소(항구 우선 가정)" };
  const curtNames = { C1: "용량 비례", C2: "협동조합 보호" };
  const feeders = ["F1 필수시설", "F2 서부 마을", "F3 동부 신도시", "F4 항구 산업"];
  const times = Array.from({ length: 8 }, (_, b) => `${String(b * 3).padStart(2, "0")}–${String((b + 1) * 3).padStart(2, "0")}시`);
  const heatLimit = "사망자나 환자 수를 계산하지 않는 비교용 지수";
  const heatBias = "F4는 이 지수에 넣지 않았고 F3의 가중치가 가장 작으므로, F3·F4를 먼저 줄이는 R2에서 이 지수가 늘 가장 작게 나옵니다. 지수가 작다는 것이 그 원칙이 옳다는 뜻은 아닙니다.";
  const weightHelp = "F1: 2·3·4 중 선택, F2: 1.2·1.5·2.0 중 선택, F3: 1 고정. 초기값은 3, 1.5, 1입니다. 이 가중치 자체가 가치 판단입니다. F4를 이 지수에서 제외한 것은 항구 노동자의 위험이 없다는 뜻이 아닙니다. 지수 밖의 피해도 따로 설명하세요.";
  const timelineHelp = "←→ 시간 구간 이동, ↑↓ 값 바꾸기, Home·End 처음·끝 구간";
  const sum = a => a.reduce((s, x) => s + x, 0);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const clone = x => JSON.parse(JSON.stringify(x));
  const object = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const integer = (x, min, max) => Number.isSafeInteger(x) && x >= min && x <= max;
  const finite = (x, min, max) => Number.isFinite(x) && x >= min && x <= max;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const assert = ok => { if (!ok) throw new Error("IG 모형 불변식 위반"); };
  const display2 = x => {
    if (Math.abs(x) < EPS) return "0.00";
    if (Math.abs(x) < .005) return x > 0 ? "0.01 미만" : "−0.01 미만";
    return x.toFixed(2).replace("-", "−");
  };
  const signed = x => (x > EPS ? "+" : "") + display2(x);
  const correctionKey = (s, b, type, requested) => `${s}:${b}:${type}:${requested}`;
  const approvalMatches = (approvals, proposal) => Array.isArray(approvals) && approvals.some(a => object(a) && a.key === proposal.key && Number.isFinite(a.proposed) && Math.abs(a.proposed - proposal.proposed) <= EPS);
  function weather(s, b) {
    const w = s === "S2" ? [1, 1, 1, 1, .45, .35, .50, 1][b] : 1;
    const t = T[b] + (s === "S3" && b >= 3 && b <= 6 ? 2 : 0);
    const d = D[b] * (s === "S3" && b >= 3 && b <= 6 ? 1.08 : 1);
    const cell = t + 25 * F[b] * w;
    const pv = 20 * F[b] * w * (1 - .004 * Math.max(0, cell - 25));
    return { w, t, d, cell, pv, r: pv + WIND[b] };
  }
  function allocate(load, u, rule) {
    const cut = [0, 0, 0, 0];
    let left = u;
    const groups = rule === "R1" ? [[0, 1, 2, 3]] : rule === "R2" ? [[2, 3], [1], [0]] : [[1, 2], [3], [0]];
    for (const ids of groups) {
      const cap = sum(ids.map(i => load[i]));
      const take = Math.min(left, cap);
      if (cap > 0) for (const i of ids) cut[i] += take * load[i] / cap;
      left = Math.max(0, left - take);
    }
    assert(left < 1e-7);
    return cut;
  }
  function simulate(p, s, consent = () => false, { preview = false } = {}) {
    let soc = 8;
    const rows = [], pendingCorrections = [];
    let provisionalFrom = null;
    for (let b = 0; b < 8; b++) {
      const { w, t, d, cell, pv, r } = weather(s, b), n = p.n[b], dr = p.dr[b] ? 1.5 : 0;
      const L = d - dr, before = soc, v = p.bat[b];
      const capCh = v > 0 ? Math.min(v, 4, (16 - soc) / (.95 * 3)) : 0;
      const capDis = v < 0 ? Math.min(-v, 4, (soc - 1.6) * .95 / 3) : 0;
      let ch = capCh, dis = capDis, x0 = L + ch - r - dis, type = null;
      if (x0 > 3 * n + EPS && ch > EPS) { type = "charge"; ch -= Math.min(ch, x0 - 3 * n); }
      else if (x0 < n - EPS && dis > EPS) { type = "discharge"; dis -= Math.min(dis, n - x0); }
      if (type) {
        const pending = { s, b, type, requested: v, capBefore: type === "charge" ? capCh : capDis, proposed: type === "charge" ? ch : dis, beforeSOC: before, capCh, capDis, ch, dis, before, x0 };
        pending.key = correctionKey(s, b, type, v);
        if (!consent(pending)) {
          if (!preview) return { complete: false, rows, pending };
          pendingCorrections.push(pending);
          if (provisionalFrom === null) provisionalFrom = b;
        }
      }
      const x = L + ch - r - dis, g = n ? clamp(x, n, 3 * n) : 0;
      const e = r + dis + g - L - ch, u = Math.max(0, -e), curt = Math.max(0, e);
      const load = [1, .3 * (d - 1), .4 * (d - 1), .3 * (d - 1) - dr];
      const cut = allocate(load, u, p.shed);
      const ext = p.curt === "C1" ? curt * .7 : Math.min(curt, pv * .7), coop = curt - ext;
      soc = clamp(soc + ch * .95 * 3 - dis * 3 / .95, 1.6, 16);
      // 충전하지 않았다면 줄었을 디젤 발전량(한계 기준). 최소 출력에 묶였거나 출력제한 중이면 0.
      const dcharge = n ? Math.max(0, g - clamp(x - ch, n, 3 * n)) : 0;
      const heat = t >= 33 ? cut[0] * p.weights[0] + cut[1] * p.weights[1] + cut[2] : 0;
      const starts = Math.max(0, n - (b ? p.n[b - 1] : 0));
      rows.push({ b, w, t, d, cell, pv, r, L, n, before, capCh, capDis, ch, dis, x0, x, g, e, u, curt, ext, coop, soc, cut, heat, dcharge, starts, type, clip: Math.abs(v) > capCh + capDis + EPS });
      assert(soc >= 1.6 - EPS && soc <= 16 + EPS);
      assert(curt <= pv + 1e-7 && coop <= pv * .3 + 1e-7);
      assert(load.every((v, i) => v >= 0 && cut[i] <= v + EPS));
      assert(Math.abs(r - curt + dis + g - (L - u + ch)) < 1e-7);
    }
    if (preview) return { complete: false, preview: true, rows, pendingCorrections, provisionalFrom };
    const total = k => sum(rows.map(v => v[k] * 3));
    return { complete: true, rows, u: total("u"), heat: total("heat"), diesel: total("g"), co2: total("g") * .75, curt: total("curt"), ext: total("ext"), coop: total("coop"), soc, delta: soc - 8, cut: [0, 1, 2, 3].map(i => sum(rows.map(v => v.cut[i] * 3))), ch: total("ch"), dis: total("dis"), dcharge: total("dcharge"), h: 3 * p.n.filter(v => v >= 2).length, starts: sum(rows.map(v => v.starts)), cost: total("g") + 2 * sum(rows.map(v => v.starts)) + 3 * p.dr.filter(Boolean).length + .05 * (total("ch") + total("dis")), corrections: rows.filter(v => v.type).map(v => v.b) };
  }
  const expected = rs => Object.fromEntries(["u", "heat", "diesel", "co2", "curt", "soc", "delta", "cost"].map(k => [k, rs.reduce((a, r, i) => a + prob[i] * r[k], 0)]));
  function worstIds(rs) {
    const mx = Math.max(...rs.map(r => r.u));
    return mx <= EPS ? ["none"] : scenarioIds.filter((s, i) => Math.abs(rs[i].u - mx) <= EPS);
  }
  const predictionMatches = (predict, rs) => worstIds(rs).includes(predict);
  const meetsBaseline = (baseline, rs) => rs[scenarioIds.indexOf(baseline.scenario)].u <= baseline.limit + EPS;
  function individualKeys(P, crit, rs, correctionCount) {
    const s1 = rs[0], hasCut = Math.max(...rs.map(r => r.u)) > EPS;
    const firstTrue = (items, fallback) => items.find(([, ok]) => ok)?.[0] || fallback;
    // 가중치는 폭염 구간 차단이 실제로 있을 때만 결과를 바꾼다.
    const weightsMatter = (P.weights[0] !== 3 || P.weights[1] !== 1.5) && rs.some(r => r.heat > EPS);
    return [
      hasCut ? "ig-b-outage" : "ig-b-reserve",
      firstTrue([["ig-b-weights", weightsMatter], ["ig-b-cost", crit.includes("cost")], ["ig-b-correction", correctionCount > 0], ["ig-b-tomorrow", s1.delta <= -2 + EPS], ["ig-b-dcharge", rs.some(r => r.dcharge > EPS)], ["ig-b-curtail", s1.curt >= 4 - EPS], ["ig-b-diesel-long", s1.h >= 15], ["ig-b-diesel-short", s1.h <= 6], ["ig-b-dr", P.dr.filter(Boolean).length > 0]], "ig-b-uncertainty")
    ];
  }
  function defaults() {
    return { version: 2, modelVersion: MODEL, bat: Array(8).fill(0), n: Array(8).fill(0), dr: Array(8).fill(false), shed: "", curt: "", crit: ["", ""], weights: [3, 1.5], baseline: { scenario: "", limit: null }, predict: "", firstPredict: null, firstRun: null, rev: 0, approvals: [], correctionLog: [], tests: 0, history: [], latestRun: null, locked: null, oneLine: "", tab: "weather", activeRow: "bat", activeB: { bat: 0, n: 0, dr: 0 } };
  }
  const validArray = (a, test, length = 8) => Array.isArray(a) && a.length === length && Array.from(a).every(test);
  const validBat = a => validArray(a, v => integer(v, -4, 4));
  const validN = a => validArray(a, v => integer(v, 0, 3));
  const validDr = a => validArray(a, v => typeof v === "boolean") && a.filter(Boolean).length <= 2;
  const validWeights = a => validArray(a, Number.isFinite, 2) && [2, 3, 4].includes(a[0]) && [1.2, 1.5, 2].includes(a[1]);
  const validCrit = (a, empty = false) => validArray(a, v => typeof v === "string" && (Object.hasOwn(criteria, v) || (empty && v === "")), 2) && (a[0] !== a[1] || (empty && a[0] === ""));
  const validBaseline = (a, empty = false) => object(a) && (scenarioIds.includes(a.scenario) || (empty && a.scenario === "")) && ((empty && a.limit === null) || (finite(a.limit, 0, 300) && Math.abs(a.limit * 10 - Math.round(a.limit * 10)) < EPS));
  const validPlan = (p, empty = false) => object(p) && validBat(p.bat) && validN(p.n) && validDr(p.dr) && validWeights(p.weights) && typeof p.shed === "string" && typeof p.curt === "string" && (Object.hasOwn(shedNames, p.shed) || (empty && p.shed === "")) && (Object.hasOwn(curtNames, p.curt) || (empty && p.curt === ""));
  const planSnapshot = p => ({ bat: p.bat.slice(), n: p.n.slice(), dr: p.dr.slice(), shed: p.shed, curt: p.curt, weights: p.weights.slice() });
  const baselineSnapshot = b => ({ scenario: b.scenario, limit: b.limit });
  function validApproval(a) {
    return object(a) && typeof a.key === "string" && /^S[123]:[0-7]:(?:charge:[1-4]|discharge:-[1-4])$/.test(a.key) && finite(a.proposed, 0, 4);
  }
  const validApprovals = a => Array.isArray(a) && a.every(validApproval) && new Set(a.map(v => v.key)).size === a.length;
  function validCorrection(c) {
    return validApproval(c) && integer(c.rev, 0, Number.MAX_SAFE_INTEGER) && scenarioIds.includes(c.s) && integer(c.b, 0, 7) && ["charge", "discharge"].includes(c.type) && integer(c.requested, -4, 4) && c.key === correctionKey(c.s, c.b, c.type, c.requested) && finite(c.capBefore, 0, 4) && finite(c.beforeSOC, 1.6 - EPS, 16 + EPS) && c.proposed <= c.capBefore + EPS;
  }
  function correctionRecord(q, rev) {
    return { key: q.key, rev, s: q.s, b: q.b, type: q.type, requested: q.requested, capBefore: q.capBefore, proposed: q.proposed, beforeSOC: q.beforeSOC };
  }
  function compute(plan, approvals = [], rev = 0) {
    const corrections = [], rs = [];
    for (const s of scenarioIds) {
      const r = simulate(plan, s, q => {
        const ok = approvalMatches(approvals, q);
        if (ok) corrections.push(correctionRecord(q, rev));
        return ok;
      });
      rs.push(r);
      if (!r.complete) return { complete: false, pending: r.pending, rs, corrections };
    }
    return { complete: true, rs, corrections, mean: expected(rs) };
  }
  function validateRun(r) {
    if (!object(r) || r.modelVersion !== MODEL || !integer(r.seq, 1, Number.MAX_SAFE_INTEGER) || !integer(r.rev, 0, Number.MAX_SAFE_INTEGER) || !validPlan(r.plan) || !validCrit(r.crit) || !validBaseline(r.baseline) || !validApprovals(r.corrections) || !r.corrections.every(validCorrection) || !Array.isArray(r.approvalKeys)) return null;
    const result = compute(r.plan, r.corrections, r.rev);
    if (!result.complete || !same(r.approvalKeys, result.corrections.map(c => c.key)) || result.corrections.length !== r.corrections.length) return null;
    for (let i = 0; i < result.corrections.length; i++) {
      const a = result.corrections[i], b = r.corrections[i];
      if (["key", "s", "b", "type", "requested", "rev"].some(k => a[k] !== b[k]) || ["capBefore", "proposed", "beforeSOC"].some(k => Math.abs(a[k] - b[k]) > EPS)) return null;
    }
    return { seq: r.seq, modelVersion: MODEL, rev: r.rev, plan: planSnapshot(r.plan), crit: r.crit.slice(), baseline: baselineSnapshot(r.baseline), approvalKeys: result.corrections.map(c => c.key), corrections: result.corrections };
  }
  function runMatches(r, g) {
    return !!r && same(r.plan, planSnapshot(g)) && same(r.crit, g.crit) && same(r.baseline, baselineSnapshot(g.baseline));
  }
  function normalize(raw) {
    const g = defaults();
    if (!object(raw) || Object.keys(raw).length === 0) return { game: g, reset: raw != null && !object(raw) };
    let reset = raw.version !== 2 || raw.modelVersion !== MODEL;
    const checks = { bat: validBat, n: validN, dr: validDr, weights: validWeights, shed: v => typeof v === "string" && (v === "" || Object.hasOwn(shedNames, v)), curt: v => typeof v === "string" && (v === "" || Object.hasOwn(curtNames, v)) };
    for (const [k, check] of Object.entries(checks)) {
      if (check(raw[k]) && raw.version === 2 && raw.modelVersion === MODEL) g[k] = clone(raw[k]);
      else reset = true;
    }
    if (validCrit(raw.crit, true)) g.crit = raw.crit.slice(); else reset = true;
    if (validBaseline(raw.baseline, true)) g.baseline = baselineSnapshot(raw.baseline); else reset = true;
    if (typeof raw.predict === "string" && (Object.hasOwn(scenarios, raw.predict) || raw.predict === "")) g.predict = raw.predict;
    if (typeof raw.firstPredict === "string" && Object.hasOwn(scenarios, raw.firstPredict)) { g.firstPredict = raw.firstPredict; g.predict = raw.firstPredict; }
    if (integer(raw.rev, 0, Number.MAX_SAFE_INTEGER)) g.rev = raw.rev;
    if (integer(raw.tests, 0, Number.MAX_SAFE_INTEGER)) g.tests = raw.tests;
    if (typeof raw.oneLine === "string") g.oneLine = raw.oneLine.slice(0, 400);
    if (["weather", "assets", "people", "model"].includes(raw.tab)) g.tab = raw.tab;
    if (["bat", "n", "dr"].includes(raw.activeRow)) g.activeRow = raw.activeRow;
    if (object(raw.activeB)) for (const k of ["bat", "n", "dr"]) if (integer(raw.activeB[k], 0, 7)) g.activeB[k] = raw.activeB[k];
    const approvalOK = validApprovals(raw.approvals);
    const logOK = Array.isArray(raw.correctionLog) && raw.correctionLog.every(validCorrection);
    if (!approvalOK || !logOK) reset = true;
    if (!reset) g.approvals = raw.approvals.map(a => ({ key: a.key, proposed: a.proposed }));
    if (logOK) g.correctionLog = raw.correctionLog.map(c => correctionRecord(c, c.rev));
    if (Array.isArray(raw.history)) g.history = raw.history.map(validateRun).filter(Boolean).slice(-20);
    g.firstRun = validateRun(raw.firstRun);
    if (g.firstRun && !g.firstPredict) g.firstRun = null;
    if (!reset) {
      const latest = validateRun(raw.latestRun);
      if (latest && runMatches(latest, g) && g.firstRun && g.firstPredict) g.latestRun = latest;
      const locked = validateRun(raw.locked);
      if (locked && g.firstRun && g.firstPredict) g.locked = locked;
    }
    if (raw.locked && !g.locked) reset = true;
    return { game: g, reset };
  }
  function lockedContext(state) {
    const g = normalize(object(state) ? state.game : null).game;
    if (!g.locked) return null;
    return { g, run: g.locked, ...compute(g.locked.plan, g.locked.corrections, g.locked.rev), first: compute(g.firstRun.plan, g.firstRun.corrections, g.firstRun.rev).rs };
  }

  KCP.ORIGINAL_ORDER = KCP.ORIGINAL_ORDER || [];
  KCP.YEARS[id] = {
    title: "섬 전력망 24시",
    format: "급전 계획 수립",
    desc: "배터리와 발전기의 하루 계획을 그려 세 날씨로 시험하고, 안정·배출·피해 분배 사이에서 판단합니다.",
    prep: 25,
    answer: 15,
    mode: "창작 · 8구간 계획, 날씨 시나리오 3종",
    original: true,
    topics: ["에너지", "환경·기후", "분배와 공정성"],
    concepts: ["전력과 전력량", "에너지 전환과 효율", "발전과 신재생 에너지", "전력 수급과 예비력", "태양 복사와 대기", "체온 조절과 항상성"],
    rubric: {
      "발산적 사고력": [
        "배터리·디젤 이외의 저장이나 수요 조절 방법을 섬의 조건에 맞게 제안하는가.",
        "날씨나 피해 분배 조건이 달라질 때 기존 계획을 유연하게 바꾸는가.",
        "한 집단에 집중된 부담을 줄일 새로운 운영 원칙을 제안하는가."
      ],
      "문제해결 능력": [
        "전력과 전력량, 충전·방전 효율을 구분해 계획을 설명하는가.",
        "세 날씨의 결과와 보정 내역을 수치로 짚어 판단 근거를 제시하는가.",
        "먼저 선언한 기준선과 결과를 비교하고 계획 또는 기준을 수정할 이유를 밝히는가."
      ],
      "인문적 통찰 역량": [
        "정전·대기오염·출력제한을 겪는 서로 다른 사람의 부담을 구체적으로 살피는가.",
        "반문을 듣고 답을 고치거나 유지하는 이유와 자기 판단의 한계를 설명하는가.",
        "오늘의 공급 안정과 다음 날의 잔량, 장기 배출 부담 사이의 형평을 고려하는가."
      ]
    },
    intent: [
      "시간축의 앞선 충전·방전이 뒤 구간의 선택을 제약함을 경험하게 한다.",
      "판단 기준을 먼저 정하고 미공급 기준선을 결과와 대조하게 한다.",
      "같은 계획을 세 날씨로 시험해 기대값과 최악의 경우를 구분하게 한다.",
      "차단 원칙·출력제한 분담·폭염 가중치에 들어 있는 가치 판단을 설명하게 한다.",
      "얻는 것과 잃는 것을 한 문장에 담고 반문 뒤 수정 또는 유지의 이유를 말하게 한다."
    ]
  };
  if (!KCP.ORIGINAL_ORDER.includes(id)) KCP.ORIGINAL_ORDER.push(id);

  const brief = () => `
    <div class="scenario ig-brief">
      <p class="label">상황과 역할</p>
      <p>연습섬 IG-24는 육지 전력망과 연결되지 않은 섬입니다. 내일은 폭염이 예보되어 있습니다. 당신은 섬 전력 운영센터의 급전 계획 담당자입니다. 발전기 기동 준비와 연료 배정 때문에 내일의 운영 계획을 오늘 정해야 합니다.</p>
      <p>태양광·풍력의 발전량은 날씨에 따라 달라집니다. 배터리는 앞 구간에 남겨 둔 에너지만 뒤 구간에 쓸 수 있습니다. 디젤은 부족한 공급을 메우지만 배출과 발전기 옆 마을의 부담을 늘립니다.</p>
      <ul class="rules">
        <li>하루를 3시간씩 8구간으로 나눕니다. 배터리는 −4~+4 MW, 디젤은 0~3기, 항구 수요반응은 하루 최대 2구간을 정합니다. 배터리의 양수는 충전, 음수는 방전입니다.</li>
        <li>세 날씨에 같은 계획을 적용합니다. 디젤 대수, 수요반응 시간, 배터리 충전·방전 요청은 모두 전날 정한 대로 갑니다. 날씨를 본 뒤 충전을 방전으로 바꾸거나 방전을 늘릴 수 없고, 잔량 한도와 수급 때문에 요청보다 줄이는 것만 가능합니다. 수급 때문에 줄일 때는 내용을 확인한 뒤 승인하거나 계획을 고칩니다. 잔량 한도 제한은 즉시 표시합니다.</li>
        <li>선택한 원칙에 따라 필수시설도 공급이 끊길 수 있습니다. R1은 부족이 작아도 모든 급전선을 같은 비율로 줄이고, R2·R3은 부족이 클 때 마지막에 필수시설을 줄입니다. 이 게임은 부족분을 급전선마다 연속된 양으로 나누어 줄이며, 급전선을 통째로 차례차례 끊는 실제 순환 정전과는 다릅니다. 차단과 출력제한의 분담 원칙을 골라 부담을 누구에게 어떻게 나눌지 설명합니다.</li>
        <li>설비 고장과 송전 손실은 없다고 가정합니다. 자료에 없는 대안을 제안할 수 있습니다. 그 대안이 결과를 바꾼다고 말할 때는 계산에 넣지 않은 가정임을 밝히세요.</li>
        <li>계획은 여러 번 시험할 수 있습니다. 확정한 계획으로 면접 질문을 만듭니다. 다시 계획하기를 누르면 수정할 수 있습니다.</li>
      </ul>
    </div>
    <div class="task ig-task">
      <b>준비실에서 만들 답</b>
      <ol>
        <li>첫째·둘째 판단 기준과 폭염 노출 가중치를 정하세요.</li>
        <li>하루 운영 계획과 부족·출력제한 분담 원칙을 만드세요.</li>
        <li>어느 날씨에서 미공급 전력량을 얼마 이하로 둘지 선언하고, 정전이 가장 클 날씨를 예측하세요.</li>
        <li>세 날씨의 결과를 비교한 뒤 계획을 확정하세요. 얻는 것과 잃는 것을 한 문장으로 쓰고, 가장 부담을 지는 집단에게 설명할 근거를 준비하세요.</li>
      </ol>
    </div>`;

  const weatherCopy = [
    ["S1 · 예보대로 · 50%", "표의 수요·기온·일사와 같습니다. 구름 계수 w는 모든 구간에서 1입니다."],
    ["S2 · 오후 구름 · 30%", "12–15시, 15–18시, 18–21시의 구름 계수는 차례로 0.45, 0.35, 0.50입니다. 나머지 구간은 1입니다. 기온·수요·풍력은 S1과 같다고 가정합니다. 구름에 따른 냉방 수요 감소는 이 모형에서 계산하지 않습니다."],
    ["S3 · 더 더움 · 20%", "09–21시 네 구간의 기온은 표보다 2 °C 높고 총수요는 1.08배입니다. 나머지 구간은 S1과 같습니다. 일사·풍력은 S1과 같습니다. F1은 1 MW를 유지하며 추가 수요는 F2·F3·F4로 나눕니다."]
  ];
  const assetsCopy = [
    ["태양광 20 MW", "외부 사업자 14 MW, 주민 협동조합 6 MW입니다. 같은 일사·온도 조건을 적용하므로 발전량도 70:30입니다. 남는 전력은 태양광부터 줄입니다. 20 MW는 기준 조건에서의 정격입니다."],
    ["풍력 2 MW 1기", "구간별 출력은 이 게임이 정한 가정값으로 자료표에 있습니다. 정격의 35~50%여서 바람이 약한 날로 보기에는 넉넉한 값입니다. 이번 모형에서는 풍력을 줄이지 않습니다."],
    ["배터리 16 MWh · 최대 4 MW", "시작 잔량은 8 MWh, 하한은 1.6 MWh입니다. 충전·방전 때 각각 5%가 손실됩니다. 4 MW로 3시간 요청해도 잔량과 수급 조건 때문에 실제 충전·방전은 더 작을 수 있습니다. 이 게임에서는 배터리도 전날 정한 구간별 요청대로만 움직입니다. 부족이 생겨도 남은 잔량을 자동으로 꺼내 쓰지 않습니다."],
    ["디젤 3기", "기당 출력은 가동 중 1~3 MW입니다. 1기를 켜 두면 수요가 적어도 최소 1 MW를 냅니다(최소 출력). 가동 대수는 전날 정하고, 그 안에서 실제 출력은 날씨별 부족량에 맞춥니다. 발전기는 서부 마을 옆에 있습니다."],
    ["항구 수요반응", "선택한 구간에 항구 냉동창고가 1.5 MW를 줄입니다. 하루 최대 2구간, 최대 9 MWh입니다. 계약 보상이 운영비 지수에 들어갑니다. 이 감축은 합의한 조절이며 미공급에 넣지 않습니다. 이후 반동 수요와 상품 손상은 없다고 가정합니다."],
    ["MW와 MWh", "MW는 전력의 단위입니다. 전력은 단위 시간 동안 쓰거나 만드는 전기 에너지, 곧 에너지를 전환하는 빠르기입니다. MWh는 전력량의 단위로, 일정 시간 동안 쓰거나 만든 전기 에너지의 양입니다. 2 MW로 3시간 쓰면 6 MWh입니다. 배터리는 에너지원이 아니라 저장 장치입니다."],
    ["F1 필수시설 · 1.0 MW", "병원·요양원·무더위쉼터입니다. 냉방과 필수 장비에 쓰는 수요입니다. 병원 같은 시설은 보통 비상 발전기를 갖추지만, 이 모형은 이를 계산하지 않습니다. F1 차단은 냉방과 일부 시설 공급의 중단으로 해석합니다."],
    ["F2 서부 마을 · 0.3 × (D−1) MW", "고령층 비율이 높은 마을입니다. 디젤 발전기와 가까워 정전과 대기오염의 부담을 함께 집니다."],
    ["F3 동부 신도시 · 0.4 × (D−1) MW", "주거와 생활시설의 수요입니다. 젊은 가구가 중심이지만 냉방 중단의 불편과 건강 위험이 없다는 뜻은 아닙니다."],
    ["F4 항구 산업 · 0.3 × (D−1) − DR MW", "냉동창고·수산 가공 수요입니다. 합의한 수요반응 외의 차단은 보관과 생업에 부담을 줍니다."]
  ];
  const peopleCopy = [
    ["필수시설 운영자", "폭염 중 냉방 중단은 건강 위험을 높입니다. 필수시설에 얼마만큼의 공급을 남길지 먼저 설명해 주세요."],
    ["서부 마을 주민", "정전이 줄어드는 것은 필요합니다. 발전기 옆 공기의 부담도 같은 마을에 쌓인다는 점을 함께 봐 주세요."],
    ["동부 신도시 주민", "다른 곳을 보호할 이유는 이해합니다. 우리에게 차단이 반복된다면 분담 기준과 보완책을 설명해 주세요."],
    ["항구 산업 대표", "수산물 보관과 일자리도 섬의 생활을 지탱합니다. 계약한 수요반응과 갑작스러운 차단은 구분해 주세요."],
    ["주민 태양광 협동조합", "주민이 함께 투자한 설비입니다. 출력을 줄일 때 수입 감소를 어떻게 나눌지 알고 싶습니다."],
    ["외부 태양광 사업자", "설비 용량에 비해 더 많은 출력을 줄여야 한다면 투자 비용을 회수할 조건도 논의해야 합니다."],
    ["운영센터", "정전, 연료 사용, 다음 날 잔량을 함께 설명할 수 있는 계획이 필요합니다."],
    ["섬 행정 담당자", "배출을 줄일 목표와 폭염 중 생활을 지킬 책임을 함께 검토하겠습니다."]
  ];
  const shedCopy = {
    R1: "모든 급전선에서 현재 부하의 같은 비율을 줄입니다. 각자의 중단 비율을 같게 보는 원칙입니다. 취약성 차이를 직접 반영하지 않습니다.",
    R2: "F3·F4를 부하 비례로 먼저 줄이고, 부족이 남으면 F2, 마지막에 F1을 줄입니다. F1·F2의 필요를 우선하되 F3·F4에 부담이 집중됩니다.",
    R3: "F2·F3을 부하 비례로 먼저 줄이고, 다음 F4, 마지막 F1을 줄입니다. 수산물 보관과 생업을 우선합니다. 실제 경제 피해 최소를 계산한 원칙은 아닙니다."
  };
  const curtCopy = {
    C1: "외부 사업자 70%, 협동조합 30%로 줄입니다. 두 집단의 발전량 대비 제한 비율이 같습니다.",
    C2: "외부 사업자의 그 구간 발전량부터 줄이고, 그것만으로 부족하면 협동조합도 줄입니다. 외부 사업자의 발전량보다 많이 배정하지 않습니다."
  };
  const cards = items => items.map(([title, copy]) => `<section class="ig-card"><h4>${esc(title)}</h4><p>${esc(copy)}</p></section>`).join("");
  const table = (heads, rows, caption) => `<table class="ig-table"><caption>${esc(caption)}</caption><thead><tr>${heads.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((v, i) => i ? `<td>${esc(String(v))}</td>` : `<th scope="row">${esc(String(v))}</th>`).join("")}</tr>`).join("")}</tbody></table>`;
  const sourceLink = (url, title) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`;
  function modelData() {
    return `<h4>일반 인용값(공개 자료로 범위·조건 확인)</h4>
      <p>공개 자료를 참고해 이 게임에 채택한 대표값. 확인일 2026-10-02.</p>
      <p>아래 세 값만 공개 자료를 참고한 대표값이고, 나머지는 이 게임이 정한 값입니다.</p>
      <section class="ig-card"><h5>결정질 실리콘 출력 온도 계수의 크기 · 0.004 /°C</h5><p>온도가 오를 때 감소하는 부호는 식의 1−…에 있다. SAM/PVWatts 공개 자료의 결정질 실리콘 계수는 버전·모듈에 따라 약 −0.35~−0.47 %/°C. −0.40 %/°C를 교육용 대표값으로 채택한다. 실측·보편 상수 아님.</p><p>${sourceLink("https://samrepo.nlr.gov/help/pvwatts_system_design.html", "현행 시스템 설계")} · ${sourceLink("https://docs.nrel.gov/docs/fy14osti/62641.pdf", "PVWatts v5 설명서")}</p></section>
      <section class="ig-card"><h5>충전·방전 효율 · 각각 0.95, 무차원</h5><p>곱 0.9025. 약 90% 왕복 효율을 채택한 공개 연구 사례는 있으나 모든 설치 시스템의 효율이 같지 않다. 각각 정확히 0.95로 나눈 것은 게임 가정이다.</p><p>${sourceLink("https://docs.nrel.gov/docs/fy15osti/64841.pdf", "NREL 저장 연구")} · ${sourceLink("https://atb-archive.nrel.gov/electricity/2020/index.php?t=st", "ATB의 별도 85% 가정")}</p></section>
      <section class="ig-card"><h5>디젤 직접 CO₂ 배출 · 0.75 t/MWh(발전 전력량 기준)</h5><p>연료 기준 배출계수와 전기 효율을 결합한 대표 근삿값이다. EIA의 증류유 74.14 kg-CO₂/MMBtu와 가정 전기 효율 약 0.337을 쓰면 74.14×3.412141633/0.337/1000 ≈ 0.751 t/MWh. 게임에서는 0.75로 고정. 전기 효율 0.337은 가정이며 자료의 실측 발전 효율이 아니다. 전 과정 배출·대기오염 농도는 포함하지 않는다.</p><p>${sourceLink("https://www.eia.gov/environment/emissions/co2_vol_mass.php", "EIA 계수표")}</p></section>
      <h4>이 게임이 정한 값</h4>${table(["항목", "값·단위"], [
        ["시간·설비", "Δt=3 h, 8구간, PV 정격 20 MW(14+6), 풍력 정격 2 MW, 디젤 3기·각 1~3 MW"],
        ["배터리", "Emax=16 MWh, Emin=1.6 MWh, 시작 8 MWh, 계통 측 Pmax=4 MW"],
        ["전지 온도 근사", "Tcell=T+25fw (°C); 25는 25 °C 상승/일사비 1의 가상 단순화 계수"],
        ["기준 온도", "식의 25 °C는 표준 시험 조건의 전지 온도에 맞춘 기준값. 이번 입력에서는 모든 Tcell≥25이므로 저온 효율 상승은 다루지 않음"],
        ["시나리오 확률", "S1 0.5, S2 0.3, S3 0.2; 합 1, 가상 예보"],
        ["기상·수요", "날씨 탭의 배열 전부; S2 w와 S3 증분·1.08배 포함"],
        ["수요반응", "F4에서 1.5 MW/구간, 하루 0~2구간, 반동 없음"],
        ["급전선", "F1=1 MW 고정, 나머지 30:40:30, 총수요에서 DR 별도 차감"],
        ["폭염 지수", "기온 문턱 33 °C, F1 선택값 2/3/4, F2 1.2/1.5/2.0, F3=1, F4=0. 임상 문턱·역학 추정값 아님"],
        ["운영비 지수", "디젤 1점/MWh + 새 기동 2점/기 + DR 3점/구간 + 배터리 계통 측 처리량 0.05점/MWh. 돈이나 종합 평가 점수가 아님"],
        ["수산물 손실 지수", "F4 미공급 1 MWh당 1. 수요반응 감축은 제외"],
        ["시작 가동 대수", "전날 마지막 구간의 가동 대수를 0기로 가정해 b0의 n기 모두 새 기동으로 셈. 전날 밤 수요를 재생 발전과 배터리만으로 채웠다는 뜻이 되어 실제와 맞지 않을 수 있는 단순화이며, 운영비 지수에만 영향"],
        ["수치 허용오차", "EPS=10⁻⁹. 값 비교용, 계산 결과를 구간마다 반올림하지 않음"]
      ], "모형의 계수와 가정")}
      <p>PV=20fw×(1−0.004×max(0,Tcell−25)), 재생 발전 R=PV+풍력. 실제 충전 ch·방전 dis로 배터리 잔량(저장 에너지) E를 E+ch×0.95×3−dis×3/0.95로 바꿉니다. 디젤 배정 충전량은 그 구간에 충전하지 않았다면 줄었을 디젤 발전량, 곧 g−clamp(L−R−dis, n, 3n)입니다.</p>
      <h4>실제 관계·값</h4><p>1 h=3600 s, 1 kWh=3.6×10⁶ J(단위 환산), 물 1톤의 질량=1000 kg, 양수 예시의 지표면 중력가속도 근삿값 g=9.8 m/s²(실제 위치에 따라 다름). 이 항목은 게임이 만든 물성이 아니다. 높이 100 m와 저장량 16 MWh는 발산 문항에서 정한 사례 조건이다.</p>`;
  }
  function dataPanes() {
    return `<div id="ig-pane-weather" class="ig-pane" role="tabpanel" aria-labelledby="ig-tab-weather">
      <p>이 표의 수요·기온·일사·풍력은 연습용 가상 자료입니다. 각 값은 그 3시간 구간의 평균입니다. 일사 비율은 기준 일사에 대한 비율이며 발전 효율이 아닙니다. 03–06시에는 구간 끝의 여명·일출 무렵을 포함한다고 가정합니다. 기온은 12–15시 구간에서 가장 높고 오후 늦게 낮아집니다. 위도·계절을 재현한 관측 자료는 아닙니다.</p>
      ${table(["시간", "수요 (MW)", "기온 (°C)"], times.map((t, b) => [t, D[b], T[b]]), "수요·기온")}
      ${table(["시간", "일사 비율", "풍력 (MW)"], times.map((t, b) => [t, F[b], WIND[b]]), "일사·풍력")}
      <p><b>가상 날씨, 실제 확률 아님</b></p>${cards(weatherCopy)}
      <p>풍력은 이 게임이 정한 가정 출력입니다. 2 MW 풍력기의 구간 평균은 0.7~1.0 MW로, 정격의 35~50%입니다. 실제로 폭염을 부르는 정체 고기압 아래에서는 바람이 훨씬 잔잔해 출력이 이보다 크게 낮을 수 있습니다. 세 시나리오의 풍력은 같게 두었습니다. 이 값은 풍속으로 환산하지 않습니다.</p>
    </div>
    <div id="ig-pane-assets" class="ig-pane" role="tabpanel" aria-labelledby="ig-tab-assets" hidden>${cards(assetsCopy)}</div>
    <div id="ig-pane-people" class="ig-pane" role="tabpanel" aria-labelledby="ig-tab-people" hidden>${cards(peopleCopy)}${cards(Object.entries(shedNames).map(([k, n]) => [`${k} · ${n}`, shedCopy[k]]))}${cards(Object.entries(curtNames).map(([k, n]) => [`${k} · ${n}`, curtCopy[k]]))}</div>
    <div id="ig-pane-model" class="ig-pane" role="tabpanel" aria-labelledby="ig-tab-model" hidden>${modelData()}</div>`;
  }

  function questions(state) {
    const ctx = lockedContext(state);
    if (!ctx) return [];
    const { g, run, rs, mean, first } = ctx, P = run.plan, s1 = rs[0];
    const maxU = Math.max(...rs.map(r => r.u)), hasCut = maxU > EPS;
    const widx = hasCut ? rs.findIndex(r => Math.abs(r.u - maxU) <= EPS) : 0, wr = rs[widx];
    const fi = wr.cut.indexOf(Math.max(...wr.cut));
    const bi = wr.rows.findIndex(r => r.cut[fi] === Math.max(...wr.rows.map(v => v.cut[fi])));
    const crit1 = criteria[run.crit[0]], crit2 = criteria[run.crit[1]];
    const Rname = shedNames[P.shed], Cname = curtNames[P.curt];
    const j = (w, p) => KCP.josa(w, p).slice(w.length);
    const bn = scenarios[run.baseline.scenario], bu = rs[scenarioIds.indexOf(run.baseline.scenario)].u;
    const ids = worstIds(first), actual = ids.map(s => scenarios[s]).join(" · ");
    const tie = ids[0] === "none" ? "세 날씨 모두 미공급이 없었습니다. " : ids.length > 1 ? `${actual}의 미공급량이 같았습니다. ` : "";
    const within = meetsBaseline(run.baseline, rs), hit = predictionMatches(g.firstPredict, first);
    const replanned = !same(g.firstRun.plan, P);
    const predicted = scenarios[g.firstPredict];
    const gap = g.firstPredict === "none" ? "정전 위험을 실제보다 작게 본 셈입니다." : ids[0] === "none" ? "정전 위험을 실제보다 크게 본 셈입니다." : "정전 위험이 어느 날씨에 몰릴지를 다르게 본 셈입니다.";
    const firstResult = ids[0] === "none" ? "세 날씨 모두 정전이 없었습니다." : `미공급이 가장 컸던 날씨는 ‘${actual}’입니다.`;
    const planNote = replanned ? "확정한 계획은 첫 시험 뒤 고친 계획입니다." : "확정한 계획은 첫 시험 계획과 같습니다.";
    const q = [
      { k: "ig-c1", tag: "공통 1 · 기준 먼저 · 얻는 것과 잃는 것", q: `첫째 기준 ‘${crit1}’${j(crit1, "와/과")} 둘째 기준 ‘${crit2}’ 가운데 어떤 기준을 앞세웠는지 먼저 밝히고, 이 계획으로 얻는 것과 잃는 것을 한 문장으로 말해 주세요.` },
      within ? { k: "ig-c2-in", tag: "공통 2 · 기준선", q: `${bn}에서 미공급을 ${display2(run.baseline.limit)} MWh 이하로 두겠다고 먼저 선언했고, 결과는 ${display2(bu)} MWh로 기준선 이내였습니다. 다른 날씨에 남는 부담까지 생각할 때, 이 기준을 충분하다고 본 근거는 무엇인가요?` } : { k: "ig-c2-over", tag: "공통 2 · 기준선", q: `${bn}에서 미공급을 ${display2(run.baseline.limit)} MWh 이하로 두겠다고 먼저 선언했지만, 결과는 ${display2(bu)} MWh였습니다. 기준과 계획 가운데 무엇을 바꿀지 그 이유를 말해 주세요.` },
      hit ? { k: "ig-c3-hit", tag: "공통 3 · 예측", q: `첫 예측 ‘${predicted}’${j(predicted, "은/는")} 처음 완료한 시험의 결과와 맞았습니다. ${tie}예측이 맞았다는 것만으로 결정도 적절했다고 말할 수 있을까요?` } : { k: "ig-c3-miss", tag: "공통 3 · 예측", q: `첫 예측으로 ‘${predicted}’${j(predicted, "을/를")} 골랐습니다. 처음 완료한 시험에서 ${firstResult} ${gap} ${planNote} 예측을 빗나가게 한 변수나 제약은 무엇이었다고 보나요?` }
    ];
    const keys = individualKeys(P, run.crit, rs, run.corrections.length);
    const c = run.corrections[0];
    const di = rs.findIndex(r => r.dcharge > EPS);
    const hi = rs.reduce((best, r, i) => r.heat > rs[best].heat + EPS ? i : best, 0);
    const defaultHeat = simulate({ ...P, weights: [3, 1.5] }, scenarioIds[hi], v => approvalMatches(run.corrections, v)).heat;
    const dieselSentence = P.n[bi] === 0 ? `그 급전선의 차단이 가장 컸던 ${times[bi]}에는 디젤을 한 대도 켜 두지 않았습니다.` : `그 급전선의 차단이 가장 컸던 ${times[bi]}에는 디젤 ${P.n[bi]}기가 가동 중이었습니다.`;
    const candidates = {
      "ig-b-outage": ["개별 · 정전", () => `${scenarios[scenarioIds[widx]]}에서 ${display2(wr.u)} MWh가 부족했습니다. ‘${Rname}’에 따라 ${feeders[fi]}의 하루 차단량은 ${display2(wr.cut[fi])} MWh였습니다. ${dieselSentence} 그 구간이 시작될 때 배터리 잔량은 ${display2(wr.rows[bi].before)} MWh였습니다. 해당 급전선 대표 앞에서 이 결정을 어떻게 설명하겠습니까?`],
      "ig-b-reserve": ["개별 · 여유", () => `세 날씨 모두 미공급이 없었습니다. 예보대로인 S1에서는 디젤 ${display2(s1.diesel)} MWh, CO₂ ${display2(s1.co2)} t, 태양광 출력제한 ${display2(s1.curt)} MWh였습니다. 이 여유가 지나친지 적당한지 무엇으로 판단했나요?`],
      "ig-b-correction": ["개별 · 보정", () => `확정 계획에서 수급 보정을 승인한 구간은 ${run.corrections.length}개입니다. 첫 기록인 ${scenarios[c.s]} · ${times[c.b]}에서 요청 ${c.type === "charge" ? "충전" : "방전"} ${signed(c.requested)} MW는 잔량 한도 뒤 ${display2(c.capBefore)} MW, 수급 보정 뒤 ${display2(c.proposed)} MW가 되었습니다. 직접 계획을 바꾸는 대신 보정을 승인한 이유는 무엇인가요?`],
      "ig-b-diesel-long": ["개별 · 서부 마을", () => `디젤을 2기 이상 켜 둔 시간은 ${s1.h}시간이고, S1 발전량은 ${display2(s1.diesel)} MWh입니다. 이 시간만으로 실제 대기오염 피해를 알 수는 없습니다. 발전기 옆 서부 마을의 공기와 공급 안정을 어떻게 저울질했나요?`],
      "ig-b-diesel-short": ["개별 · 서부 마을", () => `디젤을 2기 이상 켜 둔 시간은 ${s1.h}시간이고, 최악 날씨 미공급은 ${display2(maxU)} MWh입니다. 날씨 오차가 더 커지면 이 가동 대수의 부담은 누구에게 먼저 돌아갈까요?`],
      "ig-b-curtail": ["개별 · 출력제한", () => `S1의 출력제한은 ${display2(s1.curt)} MWh입니다. ‘${Cname}’에 따라 외부 사업자 ${display2(s1.ext)} MWh, 협동조합 ${display2(s1.coop)} MWh를 줄였습니다. 절대량과 발전량 대비 비율 가운데 무엇을 공정성의 기준으로 삼았나요?`],
      "ig-b-tomorrow": ["개별 · 내일", () => `S1의 하루 끝 잔량은 ${display2(s1.soc)} MWh로 시작보다 ${display2(-s1.delta)} MWh 적습니다. 폭염이 다음 날까지 이어진다면 이 계획은 어떤 부담을 남기나요?`],
      "ig-b-dcharge": ["개별 · 저장 효율", () => `${scenarios[scenarioIds[di]]}에서 충전 때문에 더 돌린 디젤 발전량은 ${display2(rs[di].dcharge)} MWh입니다. 그 구간에 충전하지 않았다면 줄일 수 있었던 양입니다. 왕복 효율이 90.25%인데도 디젤 전력을 저장해 뒤 구간에 쓴 이유는 무엇인가요?`],
      "ig-b-weights": ["개별 · 가중치", () => `폭염 가중치를 F1 ${P.weights[0]}, F2 ${P.weights[1]}, F3 1로 정했습니다. ${scenarios[scenarioIds[hi]]}의 폭염 노출 지수는 현재 가중치에서 ${display2(rs[hi].heat)}, 기본값에서 ${display2(defaultHeat)}입니다. ${Math.abs(rs[hi].heat - defaultHeat) <= EPS ? `‘${Rname}’에서는 폭염 구간에 F1·F2가 차단되지 않아 두 값이 같지만, 가중치 비교 표의 다른 원칙에서는 달라질 수 있습니다. ` : ""}기본값 대신 이 가중치를 고른 근거는 무엇인가요?`],
      "ig-b-dr": ["개별 · 수요 조절", () => `수요반응을 ${times.filter((_, b) => P.dr[b]).join(" · ")}에 배치해 총 ${display2(P.dr.filter(Boolean).length * 4.5)} MWh를 줄이기로 했습니다. 자발적인 계약 감축과 비자발적인 차단은 어떤 점에서 다르다고 보나요?`],
      "ig-b-cost": ["개별 · 비용", () => `비용을 판단 기준에 넣었습니다. S1 운영비 지수는 ${display2(s1.cost)}이며 새로 켠 발전기는 누적 ${s1.starts}기입니다. 이 지수에 들어 있지 않은 비용 가운데 계획을 바꿀 만큼 큰 것은 무엇인가요?`],
      "ig-b-uncertainty": ["개별 · 불확실성", () => `확정 계획의 평균 미공급은 ${display2(mean.u)} MWh, 최악은 ${display2(maxU)} MWh입니다. 첫째 기준 ‘${crit1}’에 비추어 평균과 최악 가운데 어느 쪽을 더 무겁게 보았나요?`]
    };
    keys.forEach(k => q.push({ k, tag: candidates[k][0], q: candidates[k][1]() }));
    const objections = {
      R1: "필수시설 운영자의 반문입니다. ‘부하 비례 차단은 요양원의 냉방도 줄입니다. 같은 비율로 나누는 것을 공정하다고 볼 근거는 무엇입니까?’ 답을 고치거나 유지할 이유를 말해 주세요.",
      R2: "동부 신도시 주민의 반문입니다. ‘취약한 곳을 보호할 이유는 알겠습니다. 그런데 왜 우리는 늘 먼저 끊기는 쪽입니까?’ 답을 고치거나 유지할 이유를 말해 주세요.",
      R3: "서부 마을 주민의 반문입니다. ‘냉동 수산물보다 사람의 냉방이 먼저여야 하지 않습니까? 우리 마을은 발전기 옆 공기의 부담도 집니다.’ 답을 고치거나 유지할 이유를 말해 주세요."
    };
    q.push({ k: `ig-r-${P.shed.toLowerCase()}`, tag: "반문 · 고침·유지와 이유", q: objections[P.shed] });
    q.push({ k: "ig-storage-alt", tag: "발산 · 저장", q: "배터리 말고 섬에 둘 만한 에너지 저장 방법 하나를, 그 규모가 섬에서 현실적인지 어림한 근거와 함께 제안해 주세요. 양수 발전을 고른다면 16 MWh, 높이 100 m를 가정할 수 있습니다(g≈9.8 m/s², 1 kWh=3.6×10⁶ J, 손실 무시)." });
    return q;
  }
  const batteryText = v => `${v > 0 ? "충전" : v < 0 ? "방전" : "정지"} ${Math.abs(v)} MW`;
  const planText = p => times.map((t, b) => `${t} | 배터리 요청 ${batteryText(p.bat[b])} | 디젤 ${p.n[b]}기 | 수요반응 ${p.dr[b] ? "켬" : "끔"}`).join("\n");
  const correctionText = c => `${c.s} · ${times[c.b]}: 요청 ${c.type === "charge" ? "충전" : "방전"} ${display2(Math.abs(c.requested))} → 잔량 한도 ${display2(c.capBefore)} → 수급 보정 ${display2(c.proposed)} MW. 보정 승인됨.`;
  const resultText = r => `미공급 ${display2(r.u)} MWh / 폭염 ${display2(r.heat)} 가중 MWh / 디젤 ${display2(r.diesel)} MWh·CO₂ ${display2(r.co2)} t / 출력제한 ${display2(r.curt)} MWh / 끝 잔량 ${display2(r.soc)} MWh(변화 ${signed(r.delta)})`;
  const cutText = r => r.cut.map((v, i) => `F${i + 1} ${display2(v)}`).join(" · ") + " MWh";
  function recap(state) {
    const ctx = lockedContext(state);
    if (!ctx) return [{ t: "계획 상태", d: "아직 확정하지 않음. 준비실에서 시험을 완료하고 계획을 확정하세요." }];
    const { g, run, rs, mean, first } = ctx, P = run.plan;
    const bt = `${scenarios[run.baseline.scenario]}: 미공급 ${display2(run.baseline.limit)} MWh 이하\n결과 ${display2(rs[scenarioIds.indexOf(run.baseline.scenario)].u)} MWh · ${meetsBaseline(run.baseline, rs) ? "기준선 이내" : "기준선 초과"}`;
    return [
      { t: "계획 상태", d: "급전 계획 확정 · 3시간씩 8구간 · 단순화한 모형" },
      { t: "판단 기준", d: `첫째: ${criteria[run.crit[0]]}\n둘째: ${criteria[run.crit[1]]}` },
      { t: "설계 기준선", d: bt },
      { t: "운영 계획", d: planText(P), text: planText(P) },
      { t: "피해 분담", d: `${shedNames[P.shed]} / ${curtNames[P.curt]}\n폭염 가중치 F1 ${P.weights[0]}, F2 ${P.weights[1]}, F3 1` },
      { t: "세 날씨 결과", d: rs.map((r, i) => `${scenarios[scenarioIds[i]]}: ${resultText(r)}`).join("\n") + `\n확률 가중 평균: ${resultText(mean)}\n폭염 노출 지수: ${heatLimit}` },
      { t: "급전선별 차단", d: rs.map((r, i) => `${scenarioIds[i]}: ${cutText(r)}`).join("\n") },
      { t: "첫 예측과 첫 시험", d: `예측 ${scenarios[g.firstPredict]}\n첫 완료 시험의 최대 미공급 날씨 ${worstIds(first).map(s => scenarios[s]).join(" · ")}\n${predictionMatches(g.firstPredict, first) ? "일치" : "불일치"}\n첫 시험 계획: ${planText(g.firstRun.plan)}` },
      { t: "보정과 시험", d: `현재 확정 계획 수급 보정 ${run.corrections.length}건\n${run.corrections.map(correctionText).join("\n")}\n완료 시험 ${g.tests}회` },
      { t: "얻는 것과 잃는 것", d: g.oneLine || "(미작성)" }
    ];
  }

  const examplePlans = {
    A: { bat: [0, 0, 0, 3, 2, 0, -2, -2], n: [3, 2, 1, 1, 2, 3, 3, 3], dr: [4, 5] },
    B: { bat: [-1, -1, 0, 4, 4, -1, -2, -2], n: [2, 2, 1, 0, 0, 2, 3, 3], dr: [4, 5] },
    C: { bat: [0, 0, 0, 2, 0, 0, -1, 0], n: [3, 2, 1, 1, 1, 3, 3, 3], dr: [4, 5] }
  };
  const exampleTable = k => {
    const p = examplePlans[k];
    return table(["시간", "배터리 요청", "디젤 (기)", "수요반응"], times.map((t, b) => [t, batteryText(p.bat[b]), p.n[b], p.dr.includes(b) ? "켬" : "끔"]), `계획 ${k} · 구간별 요청`);
  };
  function reflectExtra(state) {
    if (!lockedContext(state)) return "<p>계획을 확정한 뒤 예시와 비교할 수 있습니다.</p>";
    return `<section id="ig-reflect" class="ig-reflect stack">
      <details id="ig-example-a" class="reveal ig-reveal">
        <summary>A · 안정 우선 <span class="tag-mine">가상의 답</span></summary>
        <p><b>기준과 무게.</b> 정전 최소를 첫째, 피해의 공정한 분배를 둘째에 둡니다. 미공급이 생길 때에는 각 급전선의 부하 차단 비율을 같게 한다는 절차적 평등을 택합니다. 그 기준에서 R1을 지지하지만 취약성이 같다는 뜻으로 받아들이지는 않습니다.</p>
        <p><b>선택.</b> 아래 계획 A처럼 낮에도 디젤을 켜고 09–15시에 충전해 18–24시에 방전합니다. R1과 C1을 선택합니다. 켜 둔 발전기는 수요가 적어도 최소 출력을 내므로 발전과 배출이 있습니다. S2 미공급 0 MWh를 기준선으로 둡니다.</p>
        ${exampleTable("A")}
        <p><b>얻는 것과 잃는 것.</b> 세 날씨에서 미공급은 0 MWh입니다. S1 디젤은 87.41 MWh, CO₂는 65.55 t, 출력제한은 29.85 MWh이며 그중 협동조합 몫은 8.95 MWh입니다. 공급 안정을 얻는 대신 배출과 발전기 주변 부담, 태양광 수입 기회를 잃습니다.</p>
        <p><b>약점.</b> 하루 끝 잔량은 세 날씨 모두 3.37 MWh로 시작보다 4.63 MWh 적습니다. 내일의 여유를 줄였습니다. 이번 시험에서 R1의 차단 피해가 실제로 나타나지 않았으므로 균등 원칙의 타당성까지 검증했다고 말할 수 없습니다. 고장이나 더 큰 예측 오차에도 무정전을 보장하지 않습니다.</p>
      </details>
      <details id="ig-example-b" class="reveal ig-reveal">
        <summary>B · 배출·지역 환경 우선 <span class="tag-mine">가상의 답</span></summary>
        <p><b>기준과 무게.</b> 배출·대기오염 최소를 첫째, 피해의 공정한 분배를 둘째에 둡니다. 부담을 똑같이 나누기보다 필수시설과 고령층의 필요를 먼저 봅니다. 그 기준에서 R2를 택하지만 F3·F4의 생활과 생업도 보호할 이유가 있음을 인정합니다.</p>
        <p><b>선택.</b> 아래 계획 B처럼 새벽에 방전해 낮의 저장 공간을 만들고 09–15시 디젤을 끕니다. 12–18시 두 구간에 수요반응을 쓰며 R2와 C2를 택합니다. 잔량 한도 제한을 확인하고 수급 보정은 승인합니다. S2 미공급 10 MWh를 기준선으로 둡니다.</p>
        ${exampleTable("B")}
        <p><b>얻는 것과 잃는 것.</b> S1 디젤 69.41 MWh, CO₂ 52.05 t로 A보다 작습니다. S2에서는 미공급 9.48 MWh가 생겨 F3이 6.73 MWh, F4가 2.75 MWh를 부담합니다. 배출 감소와 협동조합 보호를 얻는 대신 구름 날씨의 공급 안정과 외부 사업자의 수입 기회를 잃습니다.</p>
        <p><b>약점.</b> 가상 확률 30%의 날씨에 부담을 몰았습니다. S2의 미공급 9.48 MWh는 모두 12–15시 한 구간에서 생겼는데, 그 구간이 시작될 때 배터리에는 11.90 MWh가 남아 있었습니다. 이 게임은 배터리가 전날 요청대로만 움직이게 했기 때문입니다. 남은 잔량으로 부족을 먼저 메우게 했다면 S2 하루 미공급은 약 1.23 MWh였을 것이므로, 이 부담의 상당 부분은 계획보다 운영 규칙에서 나왔습니다. S2 끝 잔량은 하한 1.60 MWh입니다. 실제 대기오염 농도는 계산하지 않아 배출 감소가 주민 건강에 주는 효과의 크기를 말할 수 없습니다. R2의 낮은 폭염 지수가 항구 노동자와 신도시의 피해를 지워 주지는 않습니다.</p>
      </details>
      <details id="ig-example-c" class="reveal ig-reveal">
        <summary>C · 내일까지 보는 관점 <span class="tag-mine">가상의 답</span></summary>
        <p><b>기준과 무게.</b> 내일 대비 잔량을 첫째, 비용 최소를 둘째에 둡니다. 세 날씨 모두 끝 잔량을 시작 이상으로 남기는 조건을 먼저 둡니다. F1을 보호하면서 항구의 보관·생업을 지킬 경제적 필요를 중시해 R3을 택하지만 실제 사회적 비용의 최솟값을 구했다고 주장하지 않습니다.</p>
        <p><b>선택.</b> 아래 계획 C처럼 09–12시에 충전하고 18–21시에는 1 MW만 방전합니다. 낮에도 디젤을 켜 두고 수요반응은 12–18시에 씁니다. R3과 C1을 택합니다. S2 미공급 0.5 MWh를 기준선으로 두고 다음 날 저장량을 남깁니다.</p>
        ${exampleTable("C")}
        <p><b>얻는 것과 잃는 것.</b> 끝 잔량은 세 날씨 모두 10.54 MWh입니다. S1 디젤 93.41 MWh, CO₂ 70.05 t로 A·B보다 큽니다. S2의 부족 0.48 MWh는 F2 0.21 MWh, F3 0.28 MWh에 배분됩니다. 내일의 저장 여유와 항구 보호를 얻는 대신 오늘의 배출·연료 부담을 늘립니다. 운영비 지수는 S1 109.86으로 세 예시 가운데 가장 큽니다. 첫째 조건인 끝 잔량 유지를 지키느라 둘째 기준인 비용을 양보했습니다.</p>
        <p><b>약점.</b> 잔량을 남긴 효과는 다음 날 수요·날씨를 알아야 평가할 수 있습니다. 서부 마을은 차단과 발전기 주변 부담을 함께 집니다. 운영비 지수에는 상품 손상이나 건강 부담의 실제 금액이 없습니다. 같은 잔량 조건에서도 디젤 대수를 줄여 운영비를 더 낮출 여지가 있고, F2 주민의 반문에 보완책을 제시해야 합니다.</p>
      </details>
      <details id="ig-science" class="reveal ig-reveal">
        <summary>과학 개념 해설 <span class="tag-mine">연습용 해설</span></summary>
        <p><b>전력과 전력량.</b> 전력은 에너지를 전환하는 속도입니다. 1 MW를 3시간 유지하면 3 MWh입니다. 태양광 20 MW와 배터리 16 MWh는 다른 종류의 양이라 크기만 비교할 수 없습니다. 이 배터리는 계통 측에서 최대 4 MW를 내지만, 가득 찬 상태에서도 하한 잔량과 방전 효율 때문에 계통으로 낼 수 있는 전력량은 (16−1.6)×0.95=13.68 MWh이므로, 4 MW로는 약 3.4시간만 낼 수 있습니다.</p>
        <p><b>저장과 효율.</b> 배터리는 새 에너지를 만드는 장치가 아닙니다. 1 MWh를 충전하면 저장량이 0.95 MWh 늘고, 그 증가분을 다시 꺼낼 때 계통에 0.9025 MWh를 돌려줍니다. 두 효율을 더하거나 5%만 한 번 빼지 않습니다. 시작 잔량도 쓰는 하루의 방전량을 그날 충전량으로 나눈 값은 왕복 효율과 다를 수 있습니다.</p>
        <p><b>일사와 전지 온도.</b> 태양 고도와 구름은 전지에 들어오는 복사 에너지에 영향을 줍니다. 일사가 강해지면 발전량이 늘 수 있지만 전지 온도도 올라갑니다. 결정질 실리콘의 출력은 같은 일사에서 전지 온도가 올라갈수록 대체로 감소합니다. 기온과 전지 온도는 같지 않으며, 이 식은 바람·설치 방식·인버터를 자세히 계산하지 않는 근사입니다.</p>
        <p><b>연소와 배출.</b> 디젤 연료의 탄소가 산소와 반응해 CO₂를 만듭니다. 디젤은 필요한 때 공급을 늘릴 수 있지만 직접 배출을 남깁니다. CO₂는 국지 대기오염 물질의 농도와 같지 않습니다. 질소산화물·입자상 물질, 배기가스 처리, 바람과 거리에 따라 주변 영향이 달라지며 이 모형은 그 농도를 구하지 않습니다.</p>
        <p><b>폭염과 체온 조절.</b> 몸은 피부 쪽 혈류를 늘리고 땀의 증발로 열을 내보냅니다. 습도가 높으면 증발이 어려워질 수 있습니다. 고령층은 체온 조절의 변화, 건강 상태와 복용 약물 등으로 폭염에 더 취약할 수 있으나 개인차가 큽니다. 이 게임의 가중치는 그 차이를 의학적으로 추정한 수치가 아닙니다.</p>
        <p><b>다른 저장 방법.</b> 양수는 물의 위치 에너지, 수소는 전기분해 등으로 만든 물질의 화학 에너지, 축열·축냉은 온도나 상변화를 이용한 저장입니다. 수소 생산에는 에너지가 들며 수소 자체를 무한한 에너지원으로 보지 않습니다. 물 1톤을 100 m 올리면 1000×9.8×100=980000 J, 약 0.2722 kWh밖에 저장되지 않습니다. 섬 배터리와 같은 16 MWh는 16000×3.6×10⁶=5.76×10¹⁰ J이므로, 손실을 무시해도 필요한 물은 m=E/(gh)=5.76×10¹⁰÷(9.8×100)≈5.9×10⁷ kg, 약 5.9만 톤입니다. 길이 50 m 수영장(약 2500 m³) 20여 개를 채우는 양입니다. 실제 회수 전력량은 펌프·수로·터빈·발전기 손실 때문에 더 작아서, 같은 전력량을 되돌려 받으려면 물이 더 필요합니다. 섬에서는 지형, 물, 토지, 생태, 누출·안전, 사용 목적과 저장 규모를 함께 검토해야 합니다.</p>
      </details>
      <details id="ig-limits" class="reveal ig-reveal">
        <summary>실제 전력망과 모형의 차이 <span class="tag-mine">연습용 해설</span></summary>
        <p>이 게임은 3시간 평균으로 공급과 수요를 맞춥니다. 실제 계통은 초 단위와 그보다 짧은 시간에도 균형을 유지해야 하며, 어긋나면 주파수가 변합니다. 동기 발전기의 회전 관성은 급격한 주파수 변화를 늦추지만 부족한 에너지를 계속 공급하는 해결책은 아닙니다. 켜 둔 발전기의 남은 출력 여유는 예측 오차에 대응할 수 있는 자원입니다. 실제로는 주파수 조정, 이미 연결된 설비의 운전 예비력, 정해진 시간 안에 투입하는 대기 설비의 예비력처럼 반응 시간과 역할을 구분합니다. 배터리·제어되는 수요도 대응 자원이 될 수 있습니다. 이 모형의 3n−g는 출력 여유일 뿐, 이런 예비력의 성능이나 충분성을 계산한 값은 아닙니다.</p>
        <p>이 게임은 배터리 충전·방전도 전날 계획대로만 움직이게 했습니다. 실제 섬 전력망에서는 배터리가 가장 빨리 출력을 바꿀 수 있는 자원이어서, 남은 잔량으로 예상 밖의 부족을 메우도록 운영하는 경우가 많습니다. 계획 B의 오후 구름 날씨 12–15시에는 잔량 11.90 MWh가 남아 계산상 최대 3.26 MW를 더 낼 수 있었고, 부족은 3.16 MW였습니다. 남은 잔량으로 부족을 먼저 메우게 하면 이 구간의 부족은 사라지고, 대신 잔량이 일찍 바닥나 15–18시에 부족이 조금 생겨 S2 하루 미공급은 9.48 MWh에서 약 1.23 MWh로 줄어듭니다. 이 게임의 미공급은 ‘전날 계획만으로 대응할 때’의 값입니다. 송전 제약·설비 고장·주파수·관성·전압·순간 출력 변화는 계산하지 않습니다. 디젤의 기동 시간, 출력 변화 속도, 최소 운전 시간과 부하별 연비를 생략합니다. 하루를 시작할 때 전날 밤 가동 대수를 0기로 두어 첫 구간의 발전기를 모두 새 기동으로 세는 것도 단순화입니다. 배터리 열화·온도 영향·자기 방전, 태양광 인버터 손실도 따로 다루지 않습니다. 세 날씨의 풍력은 같고, 오후 구름으로 수요가 줄어드는 효과도 없습니다. 수요반응 뒤 반동 수요나 가격 반응은 없으며 미공급 뒤의 부하 반응도 계산하지 않습니다.</p>
        <p>이 게임은 부족한 전력을 고른 원칙에 따라 각 급전선에서 조금씩, 연속된 양으로 줄인다고 계산합니다. 실제 순환 정전은 급전선 단위로 공급을 통째로 끊고 끊는 차례를 돌리며, 병원처럼 필수 부하가 연결된 급전선은 보통 순환 대상에서 뺍니다. 따라서 같은 MWh의 미공급이라도 실제로는 일부 지역이 한동안 완전히 정전되는 모습으로 나타납니다.</p>
        <p>배출계수는 직접 CO₂의 대표값입니다. 건설·연료 생산·폐기까지의 배출과 국지 오염 농도는 포함하지 않습니다. 폭염 노출 지수는 사망자나 환자 수를 계산하지 않는 비교용 지수입니다. 실내 온도·습도·노출 시간의 세부 변화·개인 건강·노동 환경·집단별 인구를 넣지 않았습니다. F4를 지수에서 뺀 것도 한계입니다. 운영비·수산물 손실 지수는 화폐나 실제 손상량이 아닙니다.</p>
        <p>확률과 가중치는 실제 관측·예측값이 아닙니다. 세 날씨만 시험했다고 모든 불확실성을 다룬 것은 아닙니다. 같은 결과도 무엇을 우선하느냐에 따라 다르게 판단할 수 있고, 예측이 맞아도 결정의 근거를 따로 설명해야 합니다. 과목 연계는 통합과학의 에너지 전환·효율·발전과 신재생, 물리학의 전기 에너지, 지구과학의 대기, 생명과학의 항상성 수준입니다. 단원명은 교과서마다 다를 수 있습니다.</p>
      </details>
      <details id="ig-values" class="reveal ig-reveal">
        <summary>같은 계획, 다른 피해 분담 <span class="tag-mine">연습용 해설</span></summary>
        <p>B의 S2를 같은 입력으로 계산하면 미공급은 세 원칙 모두 9.4848 MWh입니다. R1의 F1·F2·F3·F4 차단량은 0.9033·2.9809·3.9746·1.6260 MWh, R2는 0·0·6.7311·2.7537 MWh, R3는 0·4.0649·5.4199·0 MWh입니다. 한 원칙이 모든 사람에게 부담을 덜 주지는 않습니다.</p>
        <p>기본 가중치에서 폭염 지수는 R1 11.1559, R2 6.7311, R3 11.5173입니다. F1=4, F2=1.2로 바꾸면 R1 11.1650, R2 6.7311, R3 10.2978로 R1과 R3의 대소가 바뀝니다. 물리적 차단량은 그대로입니다. 가중치를 바꾸면 무엇을 비교하는지도 달라집니다.</p>
        <p>B에서 12–15시에 디젤 1기만 더 켜 둔 계획(B′)을 계산하면 오후 구름 날씨의 미공급은 9.48 MWh에서 0.48 MWh로, 가상 확률 가중 평균은 2.85 MWh에서 0.15 MWh로 줄어듭니다. 대신 디젤 발전량의 가중 평균은 74.96 MWh에서 79.76 MWh로, CO₂는 56.22 t에서 59.82 t로 늘고, 예보대로인 날에도 디젤을 3.00 MWh 더 돌리며 태양광을 3.00 MWh 더 줄입니다. 확률 30%인 날씨에 대비하는 값을 나머지 날씨에도 치르는 셈입니다. 어떤 위험을 얼마의 배출로 줄일지는 기준을 먼저 밝혀야 정할 수 있습니다.</p>
      </details>
    </section>`;
  }

  const list = pairs => `<dl class="ig-list">${pairs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join("")}</dl>`;
  const ratio = (a, b) => b <= EPS ? "해당 없음" : `${display2(100 * a / b)}%`;
  function runDetail(run, rs) {
    return `<p>폭염 노출 지수: ${heatLimit}</p>${rs.map((r, i) => {
      const p = run.plan, s = scenarioIds[i];
      const loads = [0, 1, 2, 3].map(f => sum(r.rows.map(row => [1, .3 * (row.d - 1), .4 * (row.d - 1), .3 * (row.d - 1) - (p.dr[row.b] ? 1.5 : 0)][f] * 3)));
      const pv = sum(r.rows.map(row => row.pv * 3));
      return `<section class="ig-scenario-detail"><h4>${esc(scenarios[s])}</h4>
        ${table(["급전선", "차단 (MWh)", "하루 부하 대비"], feeders.map((name, f) => [name, display2(r.cut[f]), ratio(r.cut[f], loads[f])]), "급전선별 차단")}
        ${table(["사업자", "제한 (MWh)", "발전량 대비"], [["외부 사업자", display2(r.ext), ratio(r.ext, pv * .7)], ["협동조합", display2(r.coop), ratio(r.coop, pv * .3)]], "태양광 출력제한")}
        ${list([
          ["폭염 노출 지수", `${display2(r.heat)} 가중 MWh · ${heatLimit}`],
          ["운영비 지수", `${display2(r.cost)} (돈이나 종합 점수가 아님)`],
          ["디젤 발전", `${display2(r.diesel)} MWh × 1 = ${display2(r.diesel)}`],
          ["새 기동", `${r.starts}기 × 2 = ${display2(2 * r.starts)}`],
          ["수요반응", `${p.dr.filter(Boolean).length}구간 × 3 = ${display2(3 * p.dr.filter(Boolean).length)}`],
          ["배터리 처리량", `(${display2(r.ch)} + ${display2(r.dis)}) MWh × 0.05 = ${display2(.05 * (r.ch + r.dis))}`],
          ["새로 켠 대수", `${r.rows.map(row => `${times[row.b]} ${row.starts}기`).join(" / ")} · 총 ${r.starts}기`],
          ["2기 이상 가동 시간", `${r.h}시간`],
          ["배터리 계통 측 충전·방전량", `충전 ${display2(r.ch)} MWh / 방전 ${display2(r.dis)} MWh`],
          ["디젤 배정 충전량", `${display2(r.dcharge)} MWh`],
          ["수산물 손실 지수", `${display2(r.cut[3])} · F4 차단 1 MWh당 1. 실제 손상량·금액을 뜻하지 않습니다.`]
        ])}
        <p class="small muted">디젤 배정 충전량은 그 구간에 충전하지 않았다면 줄일 수 있었던 디젤 발전량입니다. 디젤이 최소 출력에 묶여 있거나 태양광을 줄이는 중이라면 충전해도 디젤이 늘지 않으므로 0입니다. 실제 전자의 출처를 측정한 양이 아니라 추가분을 기준으로 한 회계 규칙입니다.</p>
        <h5>승인한 보정</h5><p>${run.corrections.filter(c => c.s === s).map(c => esc(correctionText(c))).join("<br>") || "없음"}</p>
        <div class="ig-time-cards">${r.rows.map(row => `<section class="ig-time-card"><h5>${esc(times[row.b])}</h5>${list([
          ["수요 / 수요반응 후", `${display2(row.d)} / ${display2(row.L)} MW`],
          ["기온 / 전지 온도", `${display2(row.t)} / ${display2(row.cell)} °C`],
          ["태양광 / 재생 발전", `${display2(row.pv)} / ${display2(row.r)} MW`],
          ["디젤 공급 기여", `발전 ${display2(row.g)} MW / 남은 출력 여유 ${display2(3 * row.n - row.g)} MW`],
          ["디젤 최소 출력 / 새 기동", `${row.n} MW / ${row.starts}기`],
          ["배터리 요청", batteryText(p.bat[row.b])],
          ["잔량 한도 후 충전 / 방전", `${display2(row.capCh)} / ${display2(row.capDis)} MW${row.clip ? " · 한도 제한" : ""}`],
          ["실제 충전 / 방전", `${display2(row.ch)} / ${display2(row.dis)} MW`],
          ["잔량(저장 에너지) 시작 / 끝", `${display2(row.before)} / ${display2(row.soc)} MWh`],
          ["부족 / 출력제한", `${display2(row.u)} / ${display2(row.curt)} MW`],
          ["급전선 차단", row.cut.map((v, f) => `F${f + 1} ${display2(v)}`).join(" · ") + " MW"],
          ...(row.u > EPS ? [["부족 구간 시작 잔량", `${display2(row.before)} MWh`], ["잔량으로 낼 수 있는 최대 방전", `${display2(Math.min(4, (row.before - 1.6) * .95 / 3))} MW · 잔량·출력 한도만으로 계산한 값이며 전날 요청과 별개입니다.`]] : [])
        ])}</section>`).join("")}</div>
      </section>`;
    }).join("")}`;
  }
  function resultHTML(run, rs) {
    const mean = expected(rs), all = [...rs, mean];
    const groups = [
      ["u", "미공급 전력량 (MWh)", "계약한 수요반응을 뺀 수요 중 공급하지 못한 전력량입니다."],
      ["heat", `폭염 노출 지수 (가중 MWh) · ${heatLimit}`, `기온 33 °C 이상인 구간의 F1·F2·F3 차단에 선택한 가중치를 곱했습니다. 체감온도나 건강 예측값이 아닙니다. ${heatBias}`],
      ["diesel", "디젤 발전량·CO₂", "같은 계획에서 실제 디젤 출력은 날씨에 따라 달라집니다."],
      ["curt", "태양광 출력제한량 (MWh)", "수급을 맞추기 위해 생산을 줄인 전력량입니다. 저장 후 폐기한 에너지가 아닙니다."],
      ["delta", "하루 잔량 변화 (MWh)", "증가가 항상 좋거나 감소가 항상 나쁜 것은 아닙니다."]
    ];
    const ymax = Math.max(1, Math.ceil(Math.max(...rs.map(r => r.u)) / 5) * 5);
    return `<h3>시험 결과 <span class="tag-mine">가상 자료</span></h3><p><b>가상 날씨, 실제 확률 아님</b></p><p class="small muted">기준선 대조는 참고용입니다.</p>
      ${groups.map(([k, title, copy]) => `<section id="ig-metric-${k}" class="ig-metric"><h4>${esc(title)}</h4><p>${esc(copy)}</p><dl>${all.map((r, i) => {
        const s = i < 3 ? scenarioIds[i] : "mean";
        let value = `${display2(r[k])} ${k === "heat" ? "가중 MWh" : "MWh"}`;
        if (k === "diesel") value = `발전량 ${display2(r.diesel)} MWh / <span data-ig-field="co2">CO₂ ${display2(r.co2)} t</span>`;
        if (k === "delta") value = `<span data-ig-field="soc">끝 ${display2(r.soc)}</span> / 시작 8.00 / 변화 ${signed(r.delta)} MWh`;
        if (k === "u" && i < 3) value += `<span class="ig-cut-line">${esc(cutText(r))}</span>`;
        return `<div data-ig-s="${s}" data-ig-value="${esc(String(r[k]))}"><dt>${i < 3 ? esc(scenarios[s]) : "확률 가중 평균"}</dt><dd>${value}</dd></div>`;
      }).join("")}</dl>${k === "diesel" && run.crit.includes("cost") ? `<p>운영비 지수 S1 ${display2(rs[0].cost)} / S2 ${display2(rs[1].cost)} / S3 ${display2(rs[2].cost)} / 평균 ${display2(mean.cost)}(돈이나 종합 점수가 아님)</p>` : ""}</section>`).join("")}
      <div id="ig-result-bars" class="ig-chart">${KCP.vbar(scenarioIds, [{ name: "미공급", color: "var(--accent)", data: rs.map(r => r.u) }], { max: ymax, ticks: [0, ymax / 2, ymax], ylabel: "MWh", aria: "세 날씨의 미공급 전력량" })}</div>
      <p id="ig-baseline-result" class="ig-note">선언: ${esc(scenarios[run.baseline.scenario])}에서 미공급 ${display2(run.baseline.limit)} MWh 이하. 결과: ${display2(rs[scenarioIds.indexOf(run.baseline.scenario)].u)} MWh. ${meetsBaseline(run.baseline, rs) ? "기준선 이내" : "기준선 초과"}.</p>
      <details id="ig-detail" class="ig-details"><summary>상세 내역</summary>${runDetail(run, rs)}</details>`;
  }
  function sensitivityHTML(run) {
    return `<summary>가중치 비교</summary><p>폭염 노출 지수: ${heatLimit}</p><p>현재 가중치 F1 ${run.plan.weights[0]}, F2 ${run.plan.weights[1]}, F3 1 / 기본 가중치 F1 3, F2 1.5, F3 1. 대소는 건강 피해 순위를 뜻하지 않습니다.</p>${scenarioIds.map(s => table(["차단 원칙", "기본 가중치", "현재 가중치"], Object.keys(shedNames).map(shed => {
      const p = { ...run.plan, shed };
      return [shed, display2(simulate({ ...p, weights: [3, 1.5] }, s, q => approvalMatches(run.corrections, q)).heat), display2(simulate(p, s, q => approvalMatches(run.corrections, q)).heat)];
    }), `${scenarios[s]} · 가중 MWh`)).join("")}`;
  }
  function previewHTML(p, preview) {
    const rows = preview.rows, xs = Array.from({ length: 8 }, (_, b) => b * 3), boundaries = [...xs, 24];
    const soc = [8, ...rows.map(r => r.soc)], start = preview.provisionalFrom;
    const series = start === null ? [{ name: "배터리 잔량", color: "var(--ink)", data: soc }] : [
      { name: "배터리 잔량", color: "var(--ink)", data: soc.slice(0, start + 1), xs: boundaries.slice(0, start + 1) },
      { name: "임시 제안값", color: "var(--ink)", data: soc.slice(start), xs: boundaries.slice(start), dash: true }
    ];
    return {
      power: KCP.lines(xs, [{ name: "수요(수요반응 후)", color: "var(--ink)", data: rows.map(r => r.L), step: true }, { name: "재생 발전", color: "var(--accent)", data: rows.map(r => r.r), step: true, dash: true }], { xmin: 0, xmax: 24, min: 0, max: 20, ticks: [0, 5, 10, 15, 20], xticks: [0, 6, 12, 18, 24], ylabel: "MW", aria: "예보대로 수요와 재생 발전" }),
      soc: KCP.lines(boundaries, series, { xmin: 0, xmax: 24, min: 0, max: 16, ticks: [0, 4, 8, 12, 16], xticks: [0, 6, 12, 18, 24], hline: 1.6, ylabel: "MWh", aria: "예보대로 배터리 잔량" }) + (start !== null ? "<p class=\"small muted\">점선: 미승인 제안값을 임시 적용한 잔량</p>" : ""),
      table: `<summary>미리보기 수치</summary>${table(["경계 시각", "잔량 (MWh)", "상태"], boundaries.map((t, b) => [`${String(t).padStart(2, "0")}시`, display2(soc[b]), start !== null && b > start ? "임시 제안값" : "잔량"]), "S1 배터리 잔량 경계값")}${table(["시간", "수요 L (MW)", "재생 R (MW)", "부족 (MW)"], rows.map(r => [times[r.b], display2(r.L), display2(r.r), display2(r.u)]), "S1 구간 평균 · 미승인 보정 이후 부족은 임시 제안값")}${!p.shed || !p.curt ? "<p>급전선·분담·지수: 원칙 선택 전</p>" : ""}`
    };
  }
  function batterySVG(p, preview) {
    const pending = new Set(preview.pendingCorrections.map(q => q.b));
    return `<defs><pattern id="ig-hatch" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="var(--sheet-2)"/><path d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6" stroke="var(--ink-2)" stroke-width="2"/></pattern></defs>
      <line x1="0" x2="800" y1="90" y2="90" stroke="var(--ink-2)" stroke-width="2"/>
      ${p.bat.map((v, b) => `<rect x="${b * 100 + 8}" y="${v >= 0 ? 90 - v * 18 : 90}" width="84" height="${Math.max(2, Math.abs(v) * 18)}" fill="${preview.rows[b].clip ? "url(#ig-hatch)" : "var(--accent-soft)"}" stroke="var(--ink-2)" stroke-width="2"/>${pending.has(b) ? `<rect x="${b * 100 + 3}" y="4" width="94" height="172" fill="none" stroke="var(--ink)" stroke-dasharray="7 4" stroke-width="3"/>` : ""}`).join("")}`;
  }

  let cancelSession = null;
  if (typeof KCP.on === "function") ["route:change", "phase:change", "storage:clear"].forEach(event => KCP.on(event, () => { if (cancelSession) cancelSession(); cancelSession = null; }));
  function renderPrep(root, state, save, next) {
    if (cancelSession) cancelSession();
    const restored = normalize(state.game);
    const G = state.game = restored.game;
    let pendingTest = false, warning = null, dismissed = false, alive = true, preview = null;
    let renderedRun = null, drag = null;
    const heard = new Set();
    cancelSession = () => { alive = false; pendingTest = false; warning = null; drag = null; };
    const $ = selector => root.querySelector(selector);
    const $$ = selector => Array.from(root.querySelectorAll(selector));
    const live = text => { if (alive) $("#ig-live").textContent = text; };
    const emit = (name, payload) => { if (alive && typeof KCP.emit === "function") KCP.emit(name, payload); };
    const persist = () => { if (alive) save(); };
    const plan = () => G.locked ? G.locked.plan : G;
    const displayRun = () => G.locked || G.latestRun;
    const settings = () => G.locked || G;
    const consent = q => approvalMatches(G.locked ? G.locked.corrections : G.approvals, q);
    const editable = () => alive && !G.locked;
    const ready = () => validPlan(G) && validCrit(G.crit) && validBaseline(G.baseline) && Object.hasOwn(scenarios, G.predict);
    const options = (dict, empty) => `<option value="">${esc(empty)}</option>${Object.entries(dict).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join("")}`;
    const rowLabels = { bat: "배터리 요청(MW)", n: "디젤 가동(기)", dr: "항구 수요반응" };
    const rowHTML = row => `<h4 id="ig-${row}-label">${rowLabels[row]}</h4><div id="ig-${row}-row" class="ig-control-row" tabindex="0" role="slider" aria-labelledby="ig-${row}-label" aria-roledescription="시간축 조절" aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End" aria-describedby="ig-timeline-help" aria-valuemin="${row === "bat" ? -4 : 0}" aria-valuemax="${row === "bat" ? 4 : row === "n" ? 3 : 1}" aria-valuenow="0" aria-valuetext="">${row === "bat" ? '<svg id="ig-bat-svg" class="ig-bat-svg" viewBox="0 0 800 180" role="img" aria-label="배터리 요청: 양수 충전, 음수 방전"></svg>' : ""}<div class="ig-cells">${times.map((_, b) => `<div class="ig-cell" data-ig-b="${b}"></div>`).join("")}</div></div>`;
    root.innerHTML = `<div id="ig-prep" class="ig-root stack">
      <p id="ig-restore" class="caution ig-note"${restored.reset ? "" : " hidden"}>저장된 계획 형식이 달라 운영 계획을 초기화했습니다.</p>
      <div id="ig-context" class="ig-context">
        <section id="ig-data" class="panel ig-data"><h3>운영 자료 <span class="tag-mine">가상 자료</span></h3>
          <div class="tabs ig-tabs" role="tablist" aria-label="운영 자료">${[["weather", "날씨"], ["assets", "설비·급전선"], ["people", "사람·원칙"], ["model", "계수와 가정"]].map(([k, name]) => `<button type="button" id="ig-tab-${k}" class="ig-tab" role="tab" data-ig-tab="${k}" aria-controls="ig-pane-${k}" aria-selected="false" tabindex="-1">${name}</button>`).join("")}</div>${dataPanes()}
        </section>
        <section id="ig-criteria" class="panel ig-criteria"><h3>판단 기준</h3>
          <label for="ig-crit1">첫째 기준</label><select id="ig-crit1">${options(criteria, "기준 선택")}</select>
          <label for="ig-crit2">둘째 기준</label><select id="ig-crit2">${options(criteria, "기준 선택")}</select>
          <p class="small muted">첫째 기준을 둘째보다 더 무겁게 봅니다. 순위는 기준 사이의 상대적 무게이며 수치 점수로 합산하지 않습니다.</p>
          <div id="ig-weights" class="ig-weights"><h4>폭염 노출 지수 <span class="small">${heatLimit}</span></h4>
            <label for="ig-weight-f1">F1 가중치</label><select id="ig-weight-f1" aria-describedby="ig-weight-help">${[2, 3, 4].map(v => `<option value="${v}">${v}</option>`).join("")}</select>
            <label for="ig-weight-f2">F2 가중치</label><select id="ig-weight-f2" aria-describedby="ig-weight-help">${[1.2, 1.5, 2].map(v => `<option value="${v}">${v.toFixed(1)}</option>`).join("")}</select><p>F3=1 고정</p><p id="ig-weight-help" class="small muted">${weightHelp}</p>
          </div>
        </section>
      </div>
      <section id="ig-timeline" class="panel ig-timeline"><h3>단순화한 모형</h3><p>3시간 평균으로 계산합니다. 실제 전력망은 초 단위로 수급을 맞추며, 이 결과가 순간적인 공급 안정까지 보장하지는 않습니다.</p>
        <h4>예보대로 미리보기</h4><div id="ig-preview-power" class="ig-chart"></div><div id="ig-preview-soc" class="ig-chart"></div>
        <details id="ig-preview-detail" class="ig-details"></details>
        <p id="ig-timeline-help" class="small muted">${timelineHelp}</p>
        <div class="ig-hours" aria-hidden="true">${Array.from({ length: 8 }, (_, b) => `<span>${String(b * 3).padStart(2, "0")}</span>`).join("")}<span class="ig-end-hour">24</span></div>
        ${["bat", "n", "dr"].map(rowHTML).join("")}
        <p id="ig-active" class="ig-active"></p>
        <div class="row ig-step-controls"><button type="button" id="ig-prev" class="btn ig-step">이전 구간</button><button type="button" id="ig-next" class="btn ig-step">다음 구간</button><button type="button" id="ig-minus" class="btn ig-step">값 감소</button><button type="button" id="ig-plus" class="btn ig-step">값 증가</button></div>
      </section>
      <section id="ig-warning" class="caution ig-warning" hidden><p id="ig-warning-text"></p><div class="row"><button type="button" id="ig-accept" class="btn">이대로 보정</button><button type="button" id="ig-edit" class="btn">내가 고치기</button></div></section>
      <section id="ig-principles" class="panel ig-principles"><h3>차단·출력제한 원칙</h3>
        ${[["shed", shedNames, shedCopy, "차단 원칙"], ["curt", curtNames, curtCopy, "출력제한 원칙"]].map(([field, names, copy, title]) => `<h4>${title}</h4><div class="seg ig-options">${Object.entries(names).map(([k, name]) => `<button type="button" id="ig-${field}-${k}" class="btn" data-ig-principle="${field}" data-ig-choice="${k}" aria-pressed="false" aria-describedby="ig-help-${k}">${k} · ${esc(name)}</button>`).join("")}</div>${Object.keys(names).map(k => `<p id="ig-help-${k}" class="small muted"><b>${k}</b> · ${esc(copy[k])}</p>`).join("")}`).join("")}
      </section>
      <section id="ig-baseline" class="panel ig-baseline"><h3>미공급 기준선</h3><p>선택한 날씨에서 미공급 전력량을 ___ MWh 이하로 두겠다.</p><label for="ig-baseline-s">날씨</label><select id="ig-baseline-s">${options(Object.fromEntries(scenarioIds.map(s => [s, scenarios[s]])), "날씨 선택")}</select><label for="ig-baseline-limit">미공급 기준 (MWh)</label><input id="ig-baseline-limit" type="number" min="0" max="300" step="0.1" inputmode="decimal" aria-describedby="ig-baseline-msg"><p id="ig-baseline-msg" class="small ig-baseline-msg" role="status" hidden>미공급 기준은 0~300 사이에서 0.1 MWh 단위로 입력하세요. 이 값으로는 시험 운전을 시작할 수 없습니다.</p></section>
      <section id="ig-predict" class="panel ig-predict"><h3>정전이 가장 클 날씨는?</h3><div class="ig-pred-options">${Object.entries(scenarios).map(([s, name]) => `<label for="ig-pred-${s}"><input id="ig-pred-${s}" type="radio" name="ig-predict" value="${s}"> ${esc(name)}</label>`).join("")}</div><p class="small muted">첫 예측은 처음 완료한 시험 결과와 비교합니다.</p></section>
      <div class="row"><button type="button" id="ig-test" class="btn ig-test" disabled>세 날씨로 시험 운전</button><span id="ig-tests"></span></div>
      <section id="ig-results" class="panel ig-results" hidden></section>
      <details id="ig-history" class="ig-details"><summary>이전 시험</summary><div id="ig-history-body"></div></details>
      <details id="ig-sensitivity" class="ig-details" hidden></details>
      <section class="panel ig-final"><p id="ig-lock-status" class="ig-note">편집 중</p><div class="row"><button type="button" id="ig-lock" class="btn primary ig-lock" disabled>급전 계획 확정</button><button type="button" id="ig-unlock" class="btn ghost ig-unlock" hidden>다시 계획하기</button></div><label for="ig-one-line">얻는 것과 잃는 것 한 문장</label><textarea id="ig-one-line" class="note ig-one-line" maxlength="400" placeholder="___을 얻는 대신 ___을 잃었다" disabled>${esc(G.oneLine)}</textarea></section>
      ${KCP.memoPanel(state, save, "ig-memo")}
      <button type="button" id="ig-go" class="btn primary ig-go" disabled>면접실로 이동</button><div id="ig-live" class="sr-only ig-live" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>`;

    function paintTabs() {
      $$('[data-ig-tab]').forEach(button => {
        const active = button.dataset.igTab === G.tab;
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
        $(`#ig-pane-${button.dataset.igTab}`).hidden = !active;
      });
    }
    function chooseTab(tab, focus = false) {
      if (!alive || !["weather", "assets", "people", "model"].includes(tab)) return;
      G.tab = tab;
      paintTabs();
      persist();
      if (focus) $(`#ig-tab-${tab}`).focus();
    }
    function rowValueText(row, b) {
      const p = plan();
      if (row === "bat") return `${times[b]} ${batteryText(p.bat[b])}`;
      if (row === "n") return `${times[b]} 디젤 ${p.n[b]}기`;
      return `${times[b]} 수요반응 ${p.dr[b] ? "켬" : "끔"}, 하루 2구간 중 ${p.dr.filter(Boolean).length}구간`;
    }
    function paintActive() {
      const p = plan(), row = G.activeRow, b = G.activeB[row];
      for (const key of ["bat", "n", "dr"]) {
        const slider = $(`#ig-${key}-row`), at = G.activeB[key];
        slider.setAttribute("aria-valuenow", String(Number(p[key][at])));
        slider.setAttribute("aria-valuetext", rowValueText(key, at));
        slider.setAttribute("aria-disabled", String(!!G.locked));
        slider.tabIndex = G.locked ? -1 : 0;
        slider.classList.toggle("ig-active-row", row === key);
        slider.querySelectorAll(".ig-cell").forEach((cell, index) => {
          cell.classList.toggle("ig-selected", index === at);
        });
      }
      let text = row === "bat" ? `${times[b]} 배터리 요청: ${batteryText(p.bat[b])}` : rowValueText(row, b);
      if (row === "bat") {
        const actual = preview.rows[b];
        text += ` · 실제: 충전 ${display2(actual.ch)} / 방전 ${display2(actual.dis)} MW`;
        if (actual.clip) text += " / 한도 제한";
        if (preview.provisionalFrom !== null && b >= preview.provisionalFrom) text += " / 보정 미확정 · 임시 제안값";
      }
      if (row === "n") text += ` · 최소 출력 ${p.n[b]} MW / 새 기동 ${Math.max(0, p.n[b] - (b ? p.n[b - 1] : 0))}기`;
      $("#ig-active").textContent = text;
      $("#ig-prev").disabled = !!G.locked || b === 0;
      $("#ig-next").disabled = !!G.locked || b === 7;
      const v = Number(p[row][b]);
      $("#ig-minus").disabled = !!G.locked || v <= (row === "bat" ? -4 : 0);
      $("#ig-plus").disabled = !!G.locked || v >= (row === "bat" ? 4 : row === "n" ? 3 : 1);
    }
    function paintWarning() {
      $("#ig-warning").hidden = !warning || !!G.locked;
      if (!warning) return;
      const q = warning;
      $("#ig-warning-text").textContent = `${scenarios[q.s]} · ${times[q.b]}: 요청 ${q.type === "charge" ? "충전" : "방전"} ${display2(Math.abs(q.requested))} MW, 잔량 한도 후 ${display2(q.capBefore)} MW입니다. ${q.type === "charge" ? "충전 요청이 공급 여유보다 큽니다." : "방전 요청을 그대로 실행하면 전력이 남습니다."} ${display2(q.proposed)} MW로 줄이는 보정을 승인하겠습니까? 승인 전에는 하루 결과가 미확정입니다. S1 미리보기의 점선은 제안값을 임시 적용한 잔량이며 확정 결과가 아닙니다.`;
    }
    function paintResults() {
      const run = displayRun();
      $("#ig-results").hidden = !run;
      $("#ig-sensitivity").hidden = !run;
      if (run !== renderedRun) {
        renderedRun = run;
        if (run) {
          const result = compute(run.plan, run.corrections, run.rev);
          $("#ig-results").innerHTML = resultHTML(run, result.rs);
          $("#ig-sensitivity").innerHTML = sensitivityHTML(run);
          $("#ig-sensitivity").open = false;
        } else {
          $("#ig-results").innerHTML = "";
          $("#ig-sensitivity").innerHTML = "";
        }
        $("#ig-history-body").innerHTML = G.history.length ? G.history.map(r => {
          const rs = compute(r.plan, r.corrections, r.rev).rs;
          return `<section class="ig-history-entry"><h4>이전 시험 ${r.seq}회</h4><p class="ig-pre">${esc(planText(r.plan))}</p><p>첫째 ${esc(criteria[r.crit[0]])} / 둘째 ${esc(criteria[r.crit[1]])}</p><p>${esc(scenarios[r.baseline.scenario])} · 미공급 ${display2(r.baseline.limit)} MWh 이하</p><p>${rs.map((v, i) => esc(`${scenarioIds[i]}: ${resultText(v)}`)).join("<br>")}</p><p>${r.corrections.map(c => esc(correctionText(c))).join("<br>")}</p></section>`;
        }).join("") : "<p>완료한 시험 0회</p>";
      }
    }
    function paint() {
      if (!alive) return;
      const p = plan(), selected = settings();
      const temp = { ...planSnapshot(p), shed: p.shed || "R1", curt: p.curt || "C1" };
      preview = simulate(temp, "S1", consent, { preview: true });
      const charts = previewHTML(p, preview);
      $("#ig-preview-power").innerHTML = charts.power;
      $("#ig-preview-soc").innerHTML = charts.soc;
      $("#ig-preview-detail").innerHTML = charts.table;
      $("#ig-bat-svg").innerHTML = batterySVG(p, preview);
      for (const row of ["bat", "n", "dr"]) {
        $(`#ig-${row}-row`).querySelectorAll(".ig-cell").forEach((cell, b) => {
          const clip = row === "bat" && preview.rows[b].clip;
          const pending = row === "bat" && preview.pendingCorrections.some(q => q.b === b);
          cell.classList.toggle("ig-clipped", clip);
          cell.classList.toggle("ig-pending", pending);
          cell.innerHTML = `<span>${row === "dr" ? p.dr[b] ? "켬" : "끔" : esc(String(p[row][b]).replace("-", "−"))}</span>${clip ? '<span class="ig-marker">한도</span>' : ""}${pending ? '<span class="ig-marker">확인</span>' : ""}`;
        });
      }
      for (let i = 0; i < 2; i++) {
        const select = $(`#ig-crit${i + 1}`);
        select.value = selected.crit[i];
        select.disabled = !!G.locked;
        Array.from(select.options).forEach(option => { option.disabled = !!option.value && option.value === selected.crit[1 - i]; });
        const weight = $(`#ig-weight-f${i + 1}`);
        weight.value = String(p.weights[i]);
        weight.disabled = !!G.locked;
      }
      $("#ig-baseline-s").value = selected.baseline.scenario;
      $("#ig-baseline-s").disabled = !!G.locked;
      const limit = $("#ig-baseline-limit"), limitMsg = $("#ig-baseline-msg");
      if (G.locked) limitMsg.hidden = true;
      // 잘못 입력한 값은 안내가 떠 있는 동안 지우지 않고 그대로 보여 준다.
      if (document.activeElement !== limit && limitMsg.hidden) limit.value = selected.baseline.limit === null ? "" : String(selected.baseline.limit);
      limit.disabled = !!G.locked;
      $$('[data-ig-principle]').forEach(button => {
        button.setAttribute("aria-pressed", String(p[button.dataset.igPrinciple] === button.dataset.igChoice));
        button.disabled = !!G.locked;
      });
      $$('input[name="ig-predict"]').forEach(input => { input.checked = G.predict === input.value; input.disabled = !!G.locked || G.firstPredict !== null; });
      if (!pendingTest) warning = !dismissed && !G.locked ? preview.pendingCorrections[0] || null : null;
      paintWarning();
      paintActive();
      paintResults();
      $("#ig-test").disabled = !!G.locked || pendingTest || !ready();
      $("#ig-tests").textContent = `완료한 시험 ${G.tests}회`;
      $("#ig-lock").hidden = !!G.locked;
      $("#ig-lock").disabled = !!G.locked || !G.latestRun || !runMatches(G.latestRun, G);
      $("#ig-unlock").hidden = !G.locked;
      $("#ig-lock-status").textContent = G.locked ? runMatches(G.locked, G) ? "계획 확정" : "계획 확정 · 확정 계획을 표시합니다" : "편집 중";
      $("#ig-one-line").disabled = !G.locked;
      $("#ig-go").disabled = !G.locked || !G.oneLine.trim();
      emit("ig:paint", { G, preview, run: displayRun() });
    }
    function invalidate(physical) {
      if (physical) G.rev++;
      G.latestRun = null;
      G.locked = null;
      pendingTest = false;
      warning = null;
      dismissed = false;
    }
    function selectCell(row, b) {
      if (!editable()) return;
      G.activeRow = row;
      G.activeB[row] = clamp(b, 0, 7);
      paintActive();
      persist();
    }
    function setCell(row, b, value) {
      if (!editable() || !["bat", "n", "dr"].includes(row) || !integer(b, 0, 7)) return;
      const min = row === "bat" ? -4 : 0, max = row === "bat" ? 4 : row === "n" ? 3 : 1;
      if (!integer(value, min, max)) { live("한도 도달"); return; }
      const v = row === "dr" ? !!value : value;
      if (G[row][b] === v) return;
      if (row === "dr" && v && G.dr.filter(Boolean).length >= 2) {
        KCP.toast("수요반응은 하루 2구간까지입니다.");
        live("수요반응은 하루 2구간까지입니다.");
        return;
      }
      G[row][b] = v;
      invalidate(true);
      paint();
      persist();
      if (warning) live("보정 미확정. 요청과 제안값을 확인하세요.");
      else if (row === "bat" && preview.rows[b].clip) live("한도 제한");
    }
    function move(delta) { const row = G.activeRow; selectCell(row, G.activeB[row] + delta); }
    function step(delta) { const row = G.activeRow, b = G.activeB[row]; setCell(row, b, Number(G[row][b]) + delta); }
    function advanceTest() {
      if (!editable() || !pendingTest || !ready()) return;
      const result = compute(planSnapshot(G), G.approvals, G.rev);
      if (!result.complete) {
        warning = result.pending;
        dismissed = false;
        paint();
        live("보정 미확정. 요청과 제안값을 확인하세요.");
        return;
      }
      const run = { seq: G.tests + 1, modelVersion: MODEL, rev: G.rev, plan: planSnapshot(G), crit: G.crit.slice(), baseline: baselineSnapshot(G.baseline), approvalKeys: result.corrections.map(c => c.key), corrections: result.corrections };
      G.tests++;
      G.history.push(clone(run));
      G.history = G.history.slice(-20);
      G.latestRun = run;
      if (!G.firstRun) G.firstRun = clone(run);
      pendingTest = false;
      warning = null;
      dismissed = false;
      paint();
      persist();
      live(`완료한 시험 ${G.tests}회`);
    }
    $$('[data-ig-tab]').forEach(button => {
      button.onclick = () => chooseTab(button.dataset.igTab);
      button.onkeydown = e => {
        const tabs = ["weather", "assets", "people", "model"], at = tabs.indexOf(G.tab);
        let target;
        if (e.key === "ArrowLeft") target = (at + 3) % 4;
        else if (e.key === "ArrowRight") target = (at + 1) % 4;
        else if (e.key === "Home") target = 0;
        else if (e.key === "End") target = 3;
        else return;
        e.preventDefault();
        chooseTab(tabs[target], true);
      };
    });
    for (const row of ["bat", "n", "dr"]) {
      const slider = $(`#ig-${row}-row`);
      slider.onfocus = () => {
        if (!editable()) return;
        selectCell(row, G.activeB[row]);
        if (!heard.has(row)) { heard.add(row); live(timelineHelp); }
      };
      slider.onkeydown = e => {
        if (!editable()) return;
        const b = G.activeB[row], v = Number(G[row][b]);
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", ...(row === "bat" ? [] : ["Enter", " "])].includes(e.key)) return;
        e.preventDefault();
        if (e.key === "ArrowLeft") selectCell(row, b - 1);
        else if (e.key === "ArrowRight") selectCell(row, b + 1);
        else if (e.key === "Home") selectCell(row, 0);
        else if (e.key === "End") selectCell(row, 7);
        else if (e.key === "ArrowUp") setCell(row, b, v + 1);
        else if (e.key === "ArrowDown") setCell(row, b, v - 1);
        else setCell(row, b, row === "n" ? (v + 1) % 4 : 1 - v);
      };
      slider.onclick = e => {
        if (!editable()) return;
        const cell = e.target.closest(".ig-cell");
        if (!cell) return;
        const b = Number(cell.dataset.igB);
        selectCell(row, b);
        slider.focus({ preventScroll: true });
        if (row === "n") setCell(row, b, (G.n[b] + 1) % 4);
        else if (row === "dr") setCell(row, b, Number(!G.dr[b]));
      };
    }
    const svg = $("#ig-bat-svg");
    function point(e) {
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const p = svg.createSVGPoint();
      p.x = e.clientX; p.y = e.clientY;
      const local = p.matrixTransform(matrix.inverse());
      return { b: clamp(Math.floor(local.x / 100), 0, 7), v: clamp(Math.round((90 - local.y) / 18), -4, 4) };
    }
    svg.onpointerdown = e => {
      if (!editable() || (e.pointerType !== "touch" && e.button !== 0)) return;
      const pt = point(e);
      if (!pt) return;
      if (e.pointerType === "touch") {
        drag = { id: e.pointerId, touch: true, x: e.clientX, y: e.clientY, pt };
        return;
      }
      e.preventDefault();
      drag = { id: e.pointerId, touch: false, b: pt.b, v: pt.v };
      svg.setPointerCapture(e.pointerId);
      selectCell("bat", pt.b);
      $("#ig-bat-row").focus({ preventScroll: true });
      setCell("bat", pt.b, pt.v);
    };
    svg.onpointermove = e => {
      if (!editable() || !drag || e.pointerId !== drag.id) return;
      if (drag.touch) {
        if (Math.abs(e.clientX - drag.x) > 10 || Math.abs(e.clientY - drag.y) > 10) drag = null;
        return;
      }
      const pt = point(e);
      if (!pt || (pt.b === drag.b && pt.v === drag.v)) return;
      drag.b = pt.b; drag.v = pt.v;
      selectCell("bat", pt.b);
      setCell("bat", pt.b, pt.v);
    };
    svg.onpointerup = e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (editable() && drag.touch) {
        selectCell("bat", drag.pt.b);
        setCell("bat", drag.pt.b, drag.pt.v);
      }
      if (svg.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
      drag = null;
    };
    svg.onpointercancel = () => { drag = null; };
    $("#ig-prev").onclick = () => move(-1);
    $("#ig-next").onclick = () => move(1);
    $("#ig-minus").onclick = () => step(-1);
    $("#ig-plus").onclick = () => step(1);
    for (let i = 0; i < 2; i++) {
      $(`#ig-crit${i + 1}`).onchange = e => {
        if (!editable()) return;
        const v = e.target.value;
        if (v !== "" && (!Object.hasOwn(criteria, v) || v === G.crit[1 - i])) return;
        if (G.crit[i] === v) return;
        G.crit[i] = v;
        invalidate(false); paint(); persist();
      };
      $(`#ig-weight-f${i + 1}`).onchange = e => {
        if (!editable()) return;
        const v = Number(e.target.value);
        if (!(i ? [1.2, 1.5, 2] : [2, 3, 4]).includes(v) || G.weights[i] === v) return;
        G.weights[i] = v;
        invalidate(true); paint(); persist();
      };
    }
    $$('[data-ig-principle]').forEach(button => {
      button.onclick = () => {
        if (!editable()) return;
        const field = button.dataset.igPrinciple, value = button.dataset.igChoice;
        if (G[field] === value) return;
        G[field] = value;
        invalidate(true); paint(); persist();
      };
    });
    $("#ig-baseline-s").onchange = e => {
      if (!editable() || !["", ...scenarioIds].includes(e.target.value) || G.baseline.scenario === e.target.value) return;
      G.baseline.scenario = e.target.value;
      invalidate(false); paint(); persist();
    };
    $("#ig-baseline-limit").oninput = e => {
      if (!editable()) return;
      const input = e.target;
      let v = input.value === "" || !input.validity.valid ? null : input.valueAsNumber;
      if (v !== null && !validBaseline({ scenario: "S1", limit: v })) v = null;
      const bad = v === null && (input.value !== "" || input.validity.badInput);
      $("#ig-baseline-msg").hidden = !bad;
      if (G.baseline.limit === v) return;
      G.baseline.limit = v;
      invalidate(false); paint(); persist();
    };
    $$('input[name="ig-predict"]').forEach(input => {
      input.onchange = () => {
        if (!editable() || G.firstPredict !== null || !Object.hasOwn(scenarios, input.value)) return;
        G.predict = input.value;
        paint(); persist();
      };
    });
    $("#ig-test").onclick = () => {
      if (!editable() || pendingTest || !ready()) return;
      if (G.firstPredict === null) G.firstPredict = G.predict;
      G.latestRun = null;
      pendingTest = true;
      dismissed = false;
      persist();
      advanceTest();
    };
    $("#ig-accept").onclick = () => {
      if (!editable() || !warning) return;
      const q = warning;
      G.approvals = G.approvals.filter(a => a.key !== q.key);
      G.approvals.push({ key: q.key, proposed: q.proposed });
      G.correctionLog.push(correctionRecord(q, G.rev));
      warning = null;
      persist();
      if (pendingTest) advanceTest(); else paint();
      if (warning) $("#ig-accept").focus({ preventScroll: true });
      else $("#ig-test").focus({ preventScroll: true });
    };
    $("#ig-edit").onclick = () => {
      if (!editable() || !warning) return;
      const b = warning.b;
      pendingTest = false;
      warning = null;
      dismissed = true;
      G.activeRow = "bat";
      G.activeB.bat = b;
      paint(); persist();
      $("#ig-bat-row").focus();
    };
    $("#ig-lock").onclick = () => {
      if (!editable() || !G.latestRun || !runMatches(G.latestRun, G)) return;
      const valid = validateRun(G.latestRun);
      if (!valid || !G.firstRun || !G.firstPredict) return;
      G.locked = clone(valid);
      warning = null;
      paint(); persist();
      $("#ig-one-line").focus();
    };
    $("#ig-unlock").onclick = () => {
      if (!alive || !G.locked) return;
      const r = G.locked;
      if (!same(planSnapshot(G), r.plan)) G.rev++;
      Object.assign(G, planSnapshot(r.plan));
      G.crit = r.crit.slice();
      G.baseline = baselineSnapshot(r.baseline);
      G.locked = null;
      G.latestRun = null;
      pendingTest = false;
      dismissed = false;
      paint(); persist();
      $("#ig-bat-row").focus();
    };
    $("#ig-one-line").oninput = e => {
      if (!alive || !G.locked) return;
      G.oneLine = e.target.value.slice(0, 400);
      $("#ig-go").disabled = !G.oneLine.trim();
      persist();
    };
    $("#ig-go").onclick = () => {
      if (!alive || !G.oneLine.trim() || !lockedContext(state)) return;
      next();
    };
    const strip = document.getElementById("strip");
    if (strip) {
      const margin = strip.offsetHeight + (parseFloat(getComputedStyle(strip).top) || 0) + 12;
      $$("button, select, input, textarea, summary, [role=slider]").forEach(el => { el.style.scrollMarginTop = `${margin}px`; });
    }
    paintTabs();
    // 섬 장면(games/s-island-grid-scene.js)은 이 계약으로만 계획을 읽고, 사용자가 장면에서 누른 조작만 아래 함수로 전달한다.
    emit("ig:prep", { root, api: {
      G, editable, plan, displayRun,
      alive: () => alive,
      preview: () => preview,
      select: (row, b) => selectCell(row, b),
      set: (row, b, value) => setCell(row, b, value),
      status: () => ({
        crit: validCrit(G.crit),
        plan: G.bat.some(v => v !== 0) || G.n.some(v => v > 0) || G.dr.some(Boolean),
        principles: !!(G.shed && G.curt),
        baseline: validBaseline(G.baseline) && Object.hasOwn(scenarios, G.predict),
        tested: G.tests > 0,
        locked: !!G.locked,
        oneLine: !!G.oneLine.trim()
      })
    } });
    // 최초 렌더에서도 이전 시험은 복원하되 시험 완료를 새로 만들지 않는다.
    renderedRun = undefined;
    paint();
    if (restored.reset) { KCP.toast("저장된 계획 형식이 달라 운영 계획을 초기화했습니다."); live("저장된 계획 형식이 달라 운영 계획을 초기화했습니다."); }
  }

  KCP.games[id] = {
    brief, renderPrep, questions, recap, reflectExtra,
    model: { EPS, weather, allocate, simulate, compute, display2, expected, worstIds, predictionMatches, meetsBaseline, correctionKey, approvalMatches, individualKeys, defaults, normalize, validateRun, planSnapshot, correctionRecord, runMatches, questionKeys: state => questions(state).map(q => q.k),
      labels: { D, T, F, WIND, scenarioIds, scenarios, criteria, shedNames, curtNames, feeders, times } }
  };
})();
