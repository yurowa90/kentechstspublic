(function () {
  const KCP = window.KCP;
  const esc = KCP.esc;
  const id = "s-riverdeal", VERSION = "rd-v2";
  const P = ["dam", "ag", "city", "eco"];
  const NAMES = ["은여울댐 공사", "들녘 농민조합", "여울시 상수도사업소", "하구 어민·생태 단체"];
  const SHORT = ["공사", "농민", "도시", "하구"];
  const STATUS = {accept: "수용", conditional: "조건부", reject: "거부"};
  const SCENARIOS = {dry: "건조", normal: "평년", wet: "습윤"};
  const ORD = {proportional: null, agFirst: ["ag", "city", "env"], cityFirst: ["city", "env", "ag"], envFirst: ["env", "ag", "city"]};
  const ORDER_NAMES = {proportional: "미지정(비례 감량)", agFirst: "농업→도시→하천", cityFirst: "도시→하천→농업", envFirst: "하천→농업→도시"};
  const FINAL_NAMES = {unanimous: "만장일치안", majority: "다수 합의안", administrative: "결렬 후 행정 결정 요청"};
  const K = 1e6 / (90 * 86400), EPS = 1e-9;
  const BASE = {ag: 50, city: 35, env: 20, f: 0, save: false, link: false, pulse: false, order: "proportional"};
  const WANT = [
    ["지금의 방류를 다시 나누어 평년 비축을 늘려 주세요.", "연계 이송을 넣어 다음 계절의 물을 보완해 주세요."],
    ["농업에 실제로 공급되는 물을 늘려 주세요.", "휴경과 보상을 다시 조합하여 농가 소득을 높여 주세요."],
    ["도시의 실제 공급량을 늘려 주세요.", "취수 지점의 수질 지표를 낮춰 주세요."],
    ["하구에 도달하는 평균 유량을 늘려 주세요.", "산소 조건을 개선해 주세요."]
  ];
  const THRESHOLD = ["110→111", "0.85→0.86", "공급률 0.95→0.96 및 C 0.90→0.89", "Q 4→4.1(펄스 3→3.1) 및 DO 5→5.1"];
  const clone = x => JSON.parse(JSON.stringify(x));
  const obj = x => x !== null && typeof x === "object" && !Array.isArray(x);
  const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
  const str = (x, max) => typeof x === "string" ? x.slice(0, max) : "";
  const textOK = (x, max, required = true) => typeof x === "string" && x.length <= max && (!required || x.trim().length > 0);
  const lineOK = (x, required = true) => textOK(x, 200, required) && !/[\r\n]/.test(x);
  const planOK = p => obj(p) && ["ag", "city", "env"].every(k => Number.isInteger(p[k]) && p[k] >= 0 && p[k] <= 80) && [0, .1, .2, .3].includes(p.f) && ["save", "link", "pulse"].every(k => typeof p[k] === "boolean") && own(ORD, p.order);
  const planCopy = p => Object.fromEntries(Object.keys(BASE).map(k => [k, p[k]]));
  const repairPlan = p => Object.fromEntries(Object.keys(BASE).map(k => {
    const test = {...BASE, [k]: obj(p) ? p[k] : undefined};
    return [k, planOK(test) ? test[k] : BASE[k]];
  }));
  const samePlan = (a, b) => planOK(a) && planOK(b) && Object.keys(BASE).every(k => a[k] === b[k]);
  const costOf = p => 150 * p.f + 5 * Number(p.save) + 25 * Number(p.link);
  const f = (x, d = 3) => x === null ? "계산 불가(유량 0)" : x.toFixed(d);
  const qf = (x, d = 3) => x === null ? "계산 불가" : x.toFixed(d);
  function doSat(t) {
    const rows = [[0, 14.6], [10, 11.3], [20, 9.1], [25, 8.3], [30, 7.6]];
    t = Math.max(0, Math.min(30, Number.isFinite(t) ? t : 30));
    for (let i = 1; i < rows.length; i++) {
      const [x0, y0] = rows[i - 1], [x1, y1] = rows[i];
      if (t <= x1) return y0 + (y1 - y0) * (t - x0) / (x1 - x0);
    }
    return 7.6;
  }
  function simulate(p, inflow) {
    const cost = costOf(p);
    const req = {ag: p.ag, city: p.city, env: p.env + (p.pulse ? 4 : 0)};
    const Rplan = req.ag + req.city + req.env;
    const rawEnd = 130 + inflow + (p.link ? 10 : 0) - 6 - Rplan;
    const shortage = Math.max(0, 40 - rawEnd);
    const v = {...req};
    if (shortage > 0) {
      if (p.order === "proportional") {
        const scale = (Rplan - shortage) / Rplan;
        for (const k of ["ag", "city", "env"]) v[k] *= scale;
      } else {
        let rem = shortage;
        for (const k of ORD[p.order]) {
          const d = Math.min(rem, v[k]); v[k] -= d; rem -= d;
        }
      }
    }
    const cut = {ag: req.ag - v.ag, city: req.city - v.city, env: req.env - v.env};
    const pulseActual = p.pulse ? Math.max(0, 4 - cut.env) : 0;
    const pulseEffective = !!p.pulse && pulseActual >= 4 - EPS;
    const R = v.ag + v.city + v.env;
    const end = 130 + inflow + (p.link ? 10 : 0) - 6 - R;
    const needAg = 55 * (1 - p.f);
    const ratioAg = Math.min(1, v.ag / needAg);
    const Y = Math.max(0, 1 - 1.2 * (1 - ratioAg));
    const income = (1 - p.f) * Y + p.f * .6;
    const needCity = 36 * (p.save ? .9 : 1);
    const supply = Math.min(1, v.city / needCity);
    const Vc = v.city + v.env + .25 * v.ag;
    const L = .5 * v.ag + 20;
    const C = Vc > 0 ? L / Vc : null;
    const Ve = v.env + .25 * v.ag + .30 * v.city;
    const Qe = Ve * K;
    const T = 30 - 6 * Math.min(1, Qe / 6);
    const sat = doSat(T);
    const consumption = Ve > 0 ? 2 * (L + .15 * v.city) / Ve : null;
    const doRaw = Ve > 0 ? sat - consumption : null;
    const DO = doRaw === null ? null : Math.max(0, doRaw);
    const H = 20 + .15 * ((130 + end) / 2 - 40);
    const MWh = 1000 * 9.8 * H * R * 1e6 * .85 / 3.6e9;
    return {cost, req, Rplan, rawEnd, shortage, v, cut, pulseActual, pulseEffective, R, end, needAg, ratioAg, Y, income, needCity, supply, Vc, Qc: Vc * K, L, C, Ve, Qe, T, sat, consumption, doRaw, DO, H, MWh, Qdam: R * K};
  }
  function checks(r, dry, mask = 0) {
    const up = i => (mask >> i) & 1;
    const item = (key, label, value, threshold, upper = false) => ({key, label, value, threshold, upper, met: value !== null && (upper ? value <= threshold + EPS : value >= threshold - EPS)});
    return [
      [item("end", "비축", r.end, 110 + up(0)), item("dry-cut", "건조 감량", dry.shortage, 0, true)],
      [item("income", "농가 소득", r.income, .85 + .01 * up(1))],
      [item("supply", "도시 공급률", r.supply, .95 + .01 * up(2)), item("C", "수질 지표 C", r.C, .90 - .01 * up(2), true)],
      [item("Qe", "하구 Q", r.Qe, (r.pulseEffective ? 3 : 4) + .1 * up(3)), item("DO", "모형 DO", r.DO, 5 + .1 * up(3))]
    ];
  }
  function severe(r) {
    return [r.end < 80 - EPS, r.income < .70 - EPS, r.supply < .85 - EPS || (r.C !== null && r.C > 1 + EPS), r.Qe < (r.pulseEffective ? 2 : 3) - EPS || (r.DO !== null && r.DO < 4 - EPS)];
  }
  function response(r, dry, mask = 0) {
    const up = i => (mask >> i) & 1;
    const criteria = [
      [r.end >= 110 + up(0) - EPS, dry.shortage <= EPS],
      [r.income >= .85 + .01 * up(1) - EPS],
      [r.supply >= .95 + .01 * up(2) - EPS, r.C !== null && r.C <= .90 - .01 * up(2) + EPS],
      [r.Qe >= (r.pulseEffective ? 3 : 4) + .1 * up(3) - EPS, r.DO !== null && r.DO >= 5 + .1 * up(3) - EPS]
    ];
    const s = severe(r);
    return criteria.map((a, i) => {
      const missing = a.filter(x => !x).length;
      return missing === 0 ? "accept" : (missing >= 2 || s[i] ? "reject" : "conditional");
    });
  }
  function evaluate(p, mask = 0) {
    const dry = simulate(p, 15), normal = simulate(p, 55), wet = simulate(p, 100);
    return Object.fromEntries(Object.entries({dry, normal, wet}).map(([k, r]) => [k, {...r, responses: response(r, dry, mask)}]));
  }
  function masksFromDecisions(rounds) {
    let mask = 0, previous = null;
    const used = [];
    for (const round of Array.isArray(rounds) ? rounds : []) {
      used.push(mask);
      const d = round && round.decision;
      const party = d && d.action === "reject" && P.includes(d.party) ? d.party : null;
      if (party !== null && party === previous) mask |= 1 << P.indexOf(party);
      previous = party;
    }
    return {used, next: mask};
  }
  function improves(beforeP, afterP, party, option) {
    if (!planOK(beforeP) || !planOK(afterP) || !P.includes(party) || !["a", "b"].includes(option)) return false;
    const b = simulate(beforeP, 55), a = simulate(afterP, 55);
    return ({dam: [a.end > b.end + EPS, !beforeP.link && afterP.link], ag: [a.v.ag > b.v.ag + EPS, afterP.f !== beforeP.f && a.income > b.income + EPS], city: [a.v.city > b.v.city + EPS, a.C !== null && (b.C === null || a.C < b.C - EPS)], eco: [a.Qe > b.Qe + EPS, a.DO !== null && (b.DO === null || a.DO > b.DO + EPS)]})[party][option === "a" ? 0 : 1];
  }
  const emptyHuman = () => Object.fromEntries(P.map(k => [k, {status: "", line: ""}]));
  const humanOK = h => obj(h) && P.every(k => obj(h[k]) && own(STATUS, h[k].status) && lineOK(h[k].line, h[k].status === "reject"));
  const humanCopy = h => Object.fromEntries(P.map(k => [k, {status: h[k].status, line: h[k].line}]));
  const actual = (round, mode) => mode === "role" ? (humanOK(round.human) ? P.map(k => round.human[k].status) : []) : evaluate(round.proposal, round.mask).normal.responses;
  const modesFor = responses => ({unanimous: responses.length === 4 && responses.every(s => s === "accept"), majority: responses.filter(s => s === "accept").length >= 3, administrative: responses.length === 4});
  const finished = (round, mode) => !!round && actual(round, mode).length === 4 && (round.decision ? round.decision.action === "reject" : actual(round, mode).every(s => s === "accept"));
  function finalCopy(x) {
    const a = obj(x) ? x : {};
    return {mode: own(FINAL_NAMES, a.mode) ? a.mode : "", gain: str(a.gain, 200), loss: str(a.loss, 200), text: str(a.text, 1000), hardDecisionId: str(a.hardDecisionId, 40)};
  }
  function validateRounds(raw, mode) {
    if (!Array.isArray(raw) || raw.length > 4) return null;
    const rounds = [], masks = masksFromDecisions(raw);
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      if (!obj(r) || r.n !== i + 1 || !planOK(r.proposal) || costOf(r.proposal) > 60 || r.mask !== masks.used[i]) return null;
      if (mode === "auto" ? r.human !== null : r.human !== null && !humanOK(r.human)) return null;
      if (i > 0) {
        const previous = rounds[i - 1];
        if (actual(previous, mode).length !== 4 || (!previous.decision && !finished(previous, mode))) return null;
        if (previous.decision && previous.decision.action === "apply" && !samePlan(previous.decision.afterP, r.proposal)) return null;
      }
      const out = {n: r.n, proposal: planCopy(r.proposal), mask: r.mask, human: r.human === null ? null : humanCopy(r.human), decision: null};
      if (r.decision !== null) {
        const d = r.decision;
        if (!obj(d) || d.id !== `rd-r${r.n}-decision` || !["apply", "reject"].includes(d.action) || !P.includes(d.party) || !lineOK(d.reason) || d.beforeMask !== r.mask || !samePlan(d.beforeP, r.proposal) || !planOK(d.afterP) || costOf(d.afterP) > 60 || actual(out, mode).length !== 4 || actual(out, mode)[P.indexOf(d.party)] === "accept") return null;
        if (d.action === "apply" ? (r.n === 4 || !improves(d.beforeP, d.afterP, d.party, d.option)) : (d.option !== null || !samePlan(d.afterP, d.beforeP))) return null;
        out.decision = {id: d.id, action: d.action, party: d.party, option: d.option, beforeP: planCopy(d.beforeP), afterP: planCopy(d.afterP), reason: d.reason, beforeMask: d.beforeMask};
      }
      rounds.push(out);
    }
    return rounds;
  }
  function validateLocked(x) {
    if (!obj(x) || x.version !== VERSION || !["role", "auto"].includes(x.mode) || !planOK(x.proposal) || !lineOK(x.criterion)) return null;
    const rounds = validateRounds(x.rounds, x.mode);
    if (!rounds || !rounds.length) return null;
    const last = rounds[rounds.length - 1];
    if (!samePlan(x.proposal, last.proposal) || x.mask !== last.mask || !finished(last, x.mode)) return null;
    const a = x.final;
    if (!obj(a) || !own(FINAL_NAMES, a.mode) || !modesFor(actual(last, x.mode))[a.mode] || !textOK(a.gain, 200) || !textOK(a.loss, 200) || !textOK(a.text, 1000)) return null;
    const decisions = rounds.map(r => r.decision).filter(Boolean);
    if (decisions.length ? !decisions.some(d => d.id === a.hardDecisionId) : a.hardDecisionId !== "") return null;
    return {version: VERSION, proposal: planCopy(x.proposal), mode: x.mode, criterion: x.criterion, mask: x.mask, rounds, final: finalCopy(a)};
  }
  function fresh() {
    return {version: VERSION, mode: "role", tab: "basin", scenario: "normal", criterion: "", stage: "draft", proposal: {...BASE}, mask: 0, rounds: [], humanDraft: emptyHuman(), counter: null, final: finalCopy(null), locked: null, previousLocked: null};
  }
  function restore(raw) {
    const g = fresh();
    if (!obj(raw)) return {game: g, repaired: raw != null};
    if (Object.keys(raw).length === 0) return {game: g, repaired: false};
    g.proposal = repairPlan(raw.proposal);
    g.criterion = str(raw.criterion, 200).replace(/[\r\n]/g, " ");
    g.mode = raw.mode === "auto" ? "auto" : "role";
    g.tab = ["basin", "parties", "clauses", "model"].includes(raw.tab) ? raw.tab : "basin";
    g.scenario = own(SCENARIOS, raw.scenario) ? raw.scenario : "normal";
    g.final = finalCopy(raw.final);
    g.previousLocked = validateLocked(raw.previousLocked);
    const reset = () => ({game: {...g, stage: "draft", rounds: [], mask: 0, counter: null, locked: null, humanDraft: emptyHuman(), final: {...g.final, hardDecisionId: ""}}, repaired: true});
    if (raw.version !== VERSION || !planOK(raw.proposal)) return reset();
    const rounds = validateRounds(raw.rounds, g.mode);
    if (!rounds || raw.mask !== (rounds.length ? rounds[rounds.length - 1].mask : 0)) return reset();
    g.rounds = rounds; g.mask = raw.mask;
    if (!["draft", "responses", "ready", "counter", "awaitSubmit", "locked"].includes(raw.stage)) return reset();
    g.stage = raw.stage;
    if (obj(raw.humanDraft)) P.forEach(k => {
      if (obj(raw.humanDraft[k])) g.humanDraft[k] = {status: own(STATUS, raw.humanDraft[k].status) ? raw.humanDraft[k].status : "", line: str(raw.humanDraft[k].line, 200).replace(/[\r\n]/g, " ")};
    });
    const last = rounds[rounds.length - 1];
    if (raw.locked !== null) {
      g.locked = validateLocked(raw.locked);
      if (!g.locked || g.stage !== "locked" || g.mode !== g.locked.mode || g.mask !== g.locked.mask || !samePlan(g.proposal, g.locked.proposal) || JSON.stringify(rounds) !== JSON.stringify(g.locked.rounds) || g.criterion !== g.locked.criterion || JSON.stringify(g.final) !== JSON.stringify(g.locked.final)) return reset();
    }
    if (g.stage === "locked" && !g.locked) return reset();
    if (g.stage !== "draft" && !last) return reset();
    if (g.stage === "draft" && last && (rounds.length === 4 || !finished(last, g.mode))) return reset();
    if (g.stage === "responses" && (g.mode !== "role" || last.human !== null || last.decision !== null || !samePlan(g.proposal, last.proposal))) return reset();
    if (g.stage === "ready" && (actual(last, g.mode).length !== 4 || (last.decision && last.decision.action === "apply") || !samePlan(g.proposal, last.proposal))) return reset();
    if (g.stage === "awaitSubmit" && (!last.decision || last.decision.action !== "apply" || !samePlan(g.proposal, last.decision.afterP))) return reset();
    if (g.stage === "counter") {
      const c = raw.counter;
      if (!obj(c) || !last || last.n === 4 || last.decision || c.round !== last.n || !samePlan(c.beforeP, last.proposal) || !P.includes(c.party) || !["a", "b"].includes(c.option) || !lineOK(c.reason, false) || actual(last, g.mode).length !== 4 || actual(last, g.mode)[P.indexOf(c.party)] === "accept" || (c.party === "dam" && c.option === "b" && c.beforeP.link)) return reset();
      g.counter = {round: c.round, party: c.party, option: c.option, beforeP: planCopy(c.beforeP), reason: c.reason};
    } else if (raw.counter !== null) return reset();
    return {game: g, repaired: false};
  }
  // 7.2·8·9·10절: 읽기 함수는 확정 스냅샷만 검증한다. 초안 복원은 renderPrep에서 한다.
  const lockedFrom = state => validateLocked(obj(state) && obj(state.game) ? state.game.locked : null);

  KCP.ORIGINAL_ORDER = KCP.ORIGINAL_ORDER || [];
  KCP.YEARS[id] = {
    title: "은여울강 가뭄 협상",
    desc: "물을 나누고 역제안을 주고받으며, 지금의 생활·생계와 하구 생태, 미래의 비축 사이에서 합의안을 만듭니다.",
    format: "제안·역제안 협상", prep: 25, answer: 15,
    mode: "역할극 기본 · 개인 연습용 자동 반응 선택", original: true,
    topics: ["물 배분", "생태계", "에너지", "합의와 책임"],
    concepts: ["물 수지", "질량 보존", "물의 순환", "위치 에너지", "에너지 전환 효율", "희석", "회귀수", "기체 용해도와 온도", "용존 산소", "부영양화", "환경 요인과 생물", "작물의 물 부족 반응"],
    rubric: {
      "발산적 사고력": ["역제안에 물·비용·감량 순서를 새롭게 조합한 교환 조건을 제시한다.", "유입 전망이나 회귀수 가정이 달라질 때 기존 안을 고치거나 유지할 이유를 설명한다.", "재이용수 등 모형 밖 대안을 제시하고 그 대안에서 새로 생기는 부담도 짚는다."],
      "문제해결 능력": ["물 수지와 감량 전후 수치를 구분하여 배분안의 실행 가능성을 설명한다.", "유량·수온·희석·용존 산소의 관계를 실제 원리와 모형 가정으로 나누어 설명한다.", "조정 기준을 먼저 밝히고 얻는 것과 잃는 것을 함께 말하며 역제안 처리에 같은 기준을 적용한다."],
      "인문적 통찰 역량": ["말할 수 없는 생물과 미래 사용자, 유역 밖 납세자에게 돌아가는 부담을 살핀다.", "수용하지 않은 당사자의 생계와 생활 조건을 존중하며 다시 협상할 방법을 제안한다.", "합의 절차의 정당성과 배분 결과의 정당성을 구분하고 자신의 결정에 남는 약점을 인정한다."]
    },
    intent: ["누구도 모든 요구를 얻기 어려운 상황에서 손실을 나누는 기준을 세운다.", "역제안을 받아들인 순간과 거절 이유를 기록하여 반문 뒤 판단을 설명한다.", "물 배분의 변화가 다른 당사자의 기준에 미치는 연쇄를 읽는다.", "유입의 불확실성을 감량 순서로 다루고 그 조항의 비용도 살핀다.", "생물·미래 사용자·테이블 밖 납세자를 판단에 포함한다.", "실제 물성과 창작 모형을 구분하고 숫자만으로 협상을 판정하는 한계를 성찰한다."]
  };
  if (!KCP.ORIGINAL_ORDER.includes(id)) KCP.ORIGINAL_ORDER.push(id);
  const INDIV_MAX = 3; // 공통 3 + 개별 최대 3 + 마지막 1 = 최대 7문항
  function questions(state) {
    const L = lockedFrom(state);
    if (!L) return [];
    const E = evaluate(L.proposal, L.mask), N = E.normal, D = E.dry, W = E.wet;
    const last = L.rounds[L.rounds.length - 1];
    const responses = actual(last, L.mode);
    const diss = NAMES.filter((_, i) => responses[i] !== "accept");
    const missing = i => N.responses[i] !== "accept";
    const decisions = L.rounds.map(r => r.decision).filter(Boolean);
    const rejects = decisions.filter(d => d.action === "reject");
    const latestReject = rejects[rejects.length - 1];
    const hard = decisions.find(d => d.id === L.final.hardDecisionId) || decisions[decisions.length - 1];
    const applied = decisions.filter(d => d.action === "apply").length;
    const hardText = hard ? `${NAMES[P.indexOf(hard.party)]}의 역제안을 가장 다루기 어려운 요구로 골랐습니다. 이를 ${hard.action === "apply" ? "반영" : "거절"}했습니다.` : "이번 역할극에서는 역제안 처리 없이 동의가 모였습니다.";
    const rejectText = latestReject ? ` ${latestReject.id === hard?.id ? "그때 거절 이유로" : NAMES[P.indexOf(latestReject.party)] + "의 요구를 거절하며"} “${latestReject.reason}”라고 적었습니다.` : "";
    const qs = [
      {k: "rd-c1", tag: "공통 1 · 기준 먼저 · 얻는 것과 잃는 것", q: "어떤 배분 기준을 앞세웠는지 먼저 밝히고, 이 안으로 얻는 것과 잃는 것을 한 문장으로 말해 주세요."},
      {k: "rd-c2", tag: "공통 2 · 고침·유지와 이유", q: hardText + rejectText + " 상대가 다시 반문한다면, 수용·거절 기준 하나에 비추어 이 안을 고치거나 유지할 이유를 말해 주세요."},
      {k: "rd-c3", tag: "공통 3", q: "물고기와 갯벌 생물은 협상 테이블에서 말할 수 없습니다. 이 안에서 그들의 몫을 대변한 방식의 한계는 무엇인가요?"}
    ];
    const indiv = [], situ = [];
    const damMissing = Number(N.end < 110 + (L.mask & 1) - EPS) + Number(D.shortage > EPS);
    const cityMissing = [];
    if (N.supply < .95 + .01 * ((L.mask >> 2) & 1) - EPS) cityMissing.push("공급량 부족");
    if (N.C === null || N.C > .90 - .01 * ((L.mask >> 2) & 1) + EPS) cityMissing.push("수질 기준 미달");
    const cityIssueText = cityMissing.length === 2 ? KCP.josa(cityMissing[0], "와/과") + " " + cityMissing[1] : (cityMissing[0] || "");
    // 당사자 질문: 정해진 당사자 순서가 아니라 미충족의 심각도(심각 미달 거부 > 거부 > 조건부)로 줄을 세우고,
    // 같은 단계에서는 기준에서 상대적으로 더 먼 당사자를 앞에 둔다. 심각 미달 당사자는 모두 자리를 받는다.
    const sv = severe(N), cs = checks(N, D, L.mask);
    const gapOf = c => c.value === null ? Infinity : c.key === "dry-cut" ? c.value / Math.max(D.Rplan, EPS) : c.upper ? (c.value - c.threshold) / c.threshold : (c.threshold - c.value) / c.threshold;
    const othersMissing = [1, 2, 3].some(missing);
    const partyText = [
      () => ({k: "rd-dam-future", tag: "개별 · 미래 비용", q: `평년 기말 저수량은 ${qf(N.end, 2)}백만 m³이며 공사의 모형 기준 2개 가운데 ${damMissing}개를 채우지 못했습니다. ${othersMissing ? "미래 사용자는 직접 반대할 수 없습니다. 가을에도 비가 오지 않을 때 그들이 질 비용을 고려해, 비축을 깎는 것이 지금 당사자들 사이에서 쉬운 타협이 되지 않았는지 설명해 주세요." : "가을에도 비가 오지 않으면 이 결정의 비용은 누가 지나요?"}`}),
      () => ({k: "rd-ag", tag: "개별 · 생계 부담", q: `농가 소득 지수는 ${qf(N.income)}입니다. 이 배분에서 농가가 지는 부담을 줄일 대안 하나를 제안해 주세요.`}),
      () => ({k: "rd-city", tag: "개별 · 생활 부담", q: `도시 공급률은 ${qf(100 * N.supply, 1)}%, 취수 수질 지표는 ${qf(N.C)}입니다. 이 안의 미충족 항목인 ${KCP.josa(cityIssueText, "을/를")} 감수할 때 가장 먼저 영향을 받는 시민은 누구인가요?`}),
      () => ({k: "rd-eco", tag: "개별 · 생태 부담", q: `하구 모형 유량은 ${qf(N.Qe)}m³/s, 수온은 ${qf(N.T, 2)}℃, DO는 ${N.DO === null ? "계산 불가" : qf(N.DO) + "mg/L"}입니다. ${N.DO === null ? "물이 흐르지 않아 DO를 계산할 수 없다는 한계를 근거로," : "수온·유량·산소 소모가 이 DO 값에 미친 영향을 근거로,"} 생물과 어업인에게 돌아가는 부담을 설명해 주세요.`})
    ];
    const ranked = [0, 1, 2, 3].filter(missing).map(i => ({i, rank: sv[i] ? 0 : N.responses[i] === "reject" ? 1 : 2, gap: Math.max(...cs[i].filter(c => !c.met).map(gapOf))}))
      .sort((a, b) => a.rank - b.rank || b.gap - a.gap || a.i - b.i);
    const partyQs = ranked.map(x => partyText[x.i]());
    // 반드시 묻는 당사자 질문: 심각 미달 당사자 전부, 미충족 당사자가 둘 이상이면 적어도 두 곳.
    const must = Math.max(ranked.filter(x => x.rank === 0).length, Math.min(2, ranked.length));
    // 상황 질문 순서: 비축의 대표성 → 학생 자신의 처리 이력(반복 거절·3회 반영) → 상정 절차 → 건조 감량 → 대책비 → 습윤 의존.
    // 공사만 미충족일 때는 비축의 대표성 질문을 따로 둔다. 다른 당사자도 미충족이면 미래 비용 질문에 합쳤다.
    if (missing(0) && !othersMissing) situ.push({k: "rd-dam-structure", tag: "개별 · 비축의 대표성", q: "미래를 위한 비축을 깎는 것이 지금의 당사자들 사이에서 쉬운 타협이 될 수 있습니다. 미래 사용자의 몫을 고려해 이 안을 고치거나 유지할 이유를 말해 주세요."});
    if (L.mask) situ.push({k: "rd-repeat", tag: "개별 · 반복 거절", q: `${NAMES.filter((_, i) => (L.mask >> i) & 1).join(", ")}의 요구를 연속으로 거절해 모형 기준이 올랐습니다. 같은 쪽의 요구를 거듭 거절한 이유는 무엇인가요?`});
    if (applied >= 3) situ.push({k: "rd-applied-three", tag: "개별 · 조정의 일관성", q: `역제안을 ${applied}번 반영했습니다. 요구를 받아들이면서도 유지하려 한 기준은 무엇인가요?`});
    const dissentText = L.mode === "role" ? `최종 역할극 반응에서 ${KCP.josa(diss.join(", "), "이/가")} 수용하지 않았습니다.` : `최종 자동 반응에서 ${diss.join(", ")}의 모형 기준을 채우지 못했습니다.`;
    if (diss.length) situ.push({k: "rd-dissent", tag: "개별 · 상정 절차", q: dissentText + " 그 당사자가 수용하지 않은 안을 상정할 절차적 근거는 무엇인가요?"});
    if (D.shortage > EPS) situ.push({k: "rd-dry-cut", tag: "개별 · 건조 감량", q: `건조 전망에서 계획대로 방류하면 사수위 저수량(40백만 m³)보다 ${qf(D.shortage, 2)}백만 m³가 부족해 그만큼 감량됩니다. ${L.proposal.order === "proportional" ? "같은 비율로 줄이는 방식을" : ({agFirst: "농업부터 줄이는 순서를", cityFirst: "도시부터 줄이는 순서를", envFirst: "하천유지부터 줄이는 순서를"})[L.proposal.order]} 택했습니다. 감량 부담을 지는 사람·생물에게 이 방식의 근거를 설명해 주세요.`});
    if (N.cost >= 50) situ.push({k: "rd-tax", tag: "개별 · 테이블 밖 비용", q: `대책비 ${qf(N.cost, 0)}억 원을 쓰는 안입니다. 유역 밖 납세자에게 어떤 참여 기회를 제공하겠습니까?`});
    if (W.responses.every(x => x === "accept") && !N.responses.every(x => x === "accept") && !D.responses.every(x => x === "accept")) situ.push({k: "rd-wet-only", tag: "개별 · 비에 기대는 합의", q: "이 안은 습윤 전망에서만 네 당사자의 모형 기준을 모두 채웁니다. 비가 적으면 비용을 누가 지도록 약속하겠습니까?"});
    // 반드시 묻는 당사자 질문 → 상황 질문 → 남은 당사자 질문 순으로 개별 질문을 INDIV_MAX개까지 고른다.
    indiv.push(...[...partyQs.slice(0, must), ...situ, ...partyQs.slice(must)].slice(0, INDIV_MAX));
    if (indiv.length < 2) indiv.push({k: "rd-order-reason", tag: "개별 · 감량의 원칙", q: `부족 시 ‘${ORDER_NAMES[L.proposal.order]}’ 방식으로 감량하기로 했습니다. 이 방식 때문에 계획을 세우기 어려워지는 부담은 누가 지나요?`});
    const lastQ = (applied > 0 || L.mask !== 0)
      ? {k: "rd-divergent", tag: "발산 · 모형 밖 대안", q: "대기에서 산소가 다시 녹아드는 재폭기와 산소를 소비하는 유기물 분해는 이 모형에서 빠져 있습니다. 이 과정이나 하수 재이용·해수 담수화 중 하나를 고려해, 이 안을 고치거나 유지할 이유를 말해 주세요."}
      : {k: "rd-science", tag: "과학 · 회귀수와 희석", q: "같은 물이라도 도시가 쓸 때와 농업이 쓸 때 이 모형의 하구로 돌아오는 양이 다릅니다. 회귀수와 희석을 근거로, 회귀수 비율이 달라질 때 자신의 배분을 고치거나 유지할 이유를 말해 주세요."};
    return qs.concat(indiv, lastQ);
  }
  const clausesText = p => `휴경 ${p.f * 100}% / 절수 ${p.save ? "켬" : "끔"} / 연계 이송 ${p.link ? "켬" : "끔"} / 펄스 ${p.pulse ? "켬" : "끔"} / 감량 ${ORDER_NAMES[p.order]}`;
  const planText = p => `농업 ${p.ag}, 도시 ${p.city}, 하천유지 ${p.env}백만 m³ · 펄스 추가 ${p.pulse ? 4 : 0}백만 m³`;
  const thresholdText = mask => P.map((_, i) => (mask >> i) & 1 ? `${NAMES[i]} · ${THRESHOLD[i]}` : "").filter(Boolean).join(" / ") || "없음";
  const decisionText = (d, n) => `제안 ${n} · ${NAMES[P.indexOf(d.party)]} · ${d.option === null ? WANT[P.indexOf(d.party)].join(" / ") + " (option=null)" : WANT[P.indexOf(d.party)][d.option === "a" ? 0 : 1]} · ${d.action === "apply" ? "반영" : "거절"} · 이유: ${d.reason}`;
  function recapLocked(L) {
    const E = evaluate(L.proposal, L.mask), N = E.normal, last = L.rounds[L.rounds.length - 1];
    return [
      {t: "상태", d: `상정안 확정 · ${L.mode === "role" ? "역할극" : "개인 연습용 자동 반응"}`},
      {t: "판단 기준과 무게", d: L.criterion}, {t: "90일 배분", d: planText(L.proposal)},
      {t: "부속 조항", d: clausesText(L.proposal)}, {t: "대책비", d: `${N.cost} / 60억 원`},
      {t: "전망별 물 수지", d: Object.keys(SCENARIOS).map(k => `${SCENARIOS[k]} · 계획 기준 부족 ${f(E[k].shortage, 2)}, 감량 뒤 기말 ${f(E[k].end, 2)}백만 m³`).join("\n")},
      {t: "평년 지표", d: `농가 소득 ${f(N.income)} / 도시 공급 ${f(N.supply * 100, 1)}% / 수질 지표 ${qf(N.C)} / 하구 유량 ${f(N.Qe)}m³/s / 수온 ${f(N.T, 2)}℃ / 모형 DO ${N.DO === null ? "계산 불가" : f(N.DO) + "mg/L"} / 발전량 ${f(N.MWh, 2)}MWh. DO는 실제 수질 예측이 아닙니다. C는 임의 부하 단위/백만 m³인 비교 지표. 실제 오염물 농도나 먹는 물 기준이 아닙니다.`},
      {t: "최종 반응", d: P.map((k, i) => `${NAMES[i]} · ${L.mode === "role" ? `사람: ${STATUS[last.human[k].status]} · 모형: ${STATUS[N.responses[i]]}${last.human[k].line ? " · 역할극 발언: " + last.human[k].line : ""}` : "자동 반응: " + STATUS[N.responses[i]]}`).join("\n")},
      {t: "기준 상승", d: thresholdText(L.mask)},
      {t: "역제안 처리", d: L.rounds.filter(r => r.decision).map(r => decisionText(r.decision, r.n)).join("\n") || "역제안 없음"},
      {t: "상정 방식", d: FINAL_NAMES[L.final.mode]}, {t: "얻는 것", d: L.final.gain}, {t: "잃는 것", d: L.final.loss}, {t: "합의문 요지", d: L.final.text}
    ];
  }
  function recap(state) {
    const L = lockedFrom(state);
    return L ? recapLocked(L) : [{t: "상태", d: "아직 확정하지 않음 · 준비실에서 상정안을 확정하세요."}];
  }
  const BRIEF = `<div class="scenario">
  <p class="label">상황과 역할</p>
  <p>은여울강 유역에 초여름 가뭄이 들었습니다. 은여울댐에는 물 1억 3천만 m³(이 게임의 단위로 130백만 m³)가 있고, 앞으로 90일(6~8월) 동안 얼마나 비가 올지는 알 수 없습니다. 이 하천과 기관은 이 활동을 위해 만든 가상 배경입니다.</p>
  <p>당신은 유역 물관리위원회의 조정위원입니다. 댐 공사, 농민조합, 도시 상수도사업소, 하구 어민·생태 단체와 방류 배분안 및 부속 조항을 협상하고 위원회에 상정하세요.</p>
  <ul class="rules">
    <li>배분은 농업·도시·하천유지 각각 0~80백만 m³, 1백만 m³ 단위로 정합니다. 조항 비용은 대책비 60억 원 이내입니다. 금액과 범위는 이 게임에서 정했습니다.</li>
    <li>제안은 최대 네 번 제출할 수 있습니다. 역제안을 반영하려면 원하는 것 하나를 고르고, 바꿀 물량과 조항은 직접 정하세요. 거절할 때는 이유를 한 문장 적으세요.</li>
    <li>같은 당사자의 역제안을 두 제출 연속 거절하면 다음 제출부터 그 당사자의 모형 기준이 한 단계 올라갑니다.</li>
    <li>사수위 아래로 내려갈 계획은 정한 순서에 따라 감량됩니다. 감량 순서를 정하지 않으면 각 용도에 같은 비율을 적용합니다. 이것은 현실 법령의 용수 우선순위가 아닌 이 활동의 약속입니다.</li>
    <li>역할극에서는 사람이 동의 여부와 이유를 정하고, 앱은 계산 기준을 함께 보여 줍니다. 개인 연습에서는 자동 반응을 선택할 수 있습니다. 수업 시간이 짧으면 두 번 제안한 뒤 상정해도 됩니다.</li>
    <li>자료 밖 대안을 제안할 수 있습니다. 가정과 필요한 근거를 밝히고, 계산에 포함되지 않은 효과를 이미 얻은 것으로 적지 마세요.</li>
  </ul>
</div>
<div class="task"><b>준비할 답</b><ol>
  <li>판단 기준과 그 무게를 먼저 정하고, 배분량·조항·건조 시 감량 순서를 제시하세요.</li>
  <li>역제안을 고치거나 유지한 이유와, 그 변경으로 다른 당사자가 얻거나 잃는 것을 설명하세요.</li>
  <li>상정 방식과 합의문 요지를 적고, 얻는 것과 잃는 것을 한 문장으로 연결해 말하세요.</li>
</ol></div>`;
  const RAIN = "이 모형에서 비는 저수지로만 들어갑니다. 댐 아래 지류·강우 유출과 비에 따른 작물 물 요구 변화는 0으로 두었으므로, 감량이 없으면 세 전망의 하류 지표는 같게 나옵니다.";
  const ASSUMPTIONS = "단순화한 모형. 포화 용존 산소는 실제 담수 물성의 반올림값입니다. 산소 소모식·수온식·낙차 선형 가정·발전 효율 0.85는 이 게임에서 정한 값입니다. 하구 수온 24~30℃는 여름 저유량기를 가정한 이 모형의 90일 평균값입니다.";
  const C_CAUTION = "임의 부하 단위/백만 m³인 비교 지표. 실제 오염물 농도나 먹는 물 기준이 아닙니다.";
  const DO_CAUTION = "mg/L 단위로 보이지만 실제 수질 예측이 아닙니다.";
  const DO_THRESHOLD = "종·수온·노출 시간에 따라 다르며 이 게임이 정한 기준입니다.";
  const COEFFICIENTS = "농업 회귀수 25%, 도시 회귀수 30%, 산소 소모 계수 2.0은 가상 값이며 결과와 수용 여부를 크게 바꿉니다.";
  const BUDGET = "대책비가 60억 원을 넘었습니다. 조항을 조정해야 제안하거나 역제안을 반영할 수 있습니다.";
  const RECOVERY = "저장한 협상 기록의 형식이 달라 초안부터 다시 확인합니다.";
  const MODEL_RULE = "상태 이름은 못 채운 기준의 수와 심각 미달 여부로 정한 게임 규칙입니다. 실제 사람의 태도를 예측하지 않습니다.";
  const PARTY_TEXT = [
    "가을 가뭄과 내년 봄에 쓸 물을 남기려 합니다. 발전 수입도 필요하지만 미래 사용자의 몫을 지금 대신 말합니다. 현재 방류 확대를 논의할 수 있으나 비축 감소의 책임도 함께 정해야 합니다.",
    "생육기에 물이 끊기면 올해 소득이 줄어듭니다. 휴경과 보상을 논의할 수 있지만 다음 해 배분의 예측 가능성도 필요합니다.",
    "생활과 위생에 쓸 물, 취수 지점의 수질이 필요합니다. 절수 캠페인을 제안할 수 있지만 절수가 어려운 시민도 있습니다.",
    "산란기 어류와 갯벌의 변화는 생태계와 어업 생계에 함께 영향을 줍니다. 생물은 직접 말할 수 없으므로 그 몫을 대변합니다."
  ];
  const LINES = [
    {accept: "남겨 둔 물로 다음 계절의 사용자를 준비하겠습니다.", conditional: "지금 쓰는 물이 다음 계절의 부담이 되지 않도록 설명이 더 필요합니다.", reject: "비축 감소와 건조 시 공급 변경을 함께 감당하기 어렵습니다."},
    {accept: "이 배분을 바탕으로 올해 농사 계획을 세우겠습니다.", conditional: "소득이 줄어드는 농가가 다음 해에도 농사를 이어 갈 방법이 필요합니다.", reject: "올해 소득과 다음 농사 준비를 함께 지키기 어렵습니다."},
    {accept: "생활용수를 공급하면서 절수가 어려운 시민도 살피겠습니다.", conditional: "공급이나 취수 수질의 부담이 어느 시민에게 먼저 돌아가는지 정해야 합니다.", reject: "물의 양과 취수 수질을 함께 확보할 대책이 필요합니다."},
    {accept: "산란기와 어업 생계를 함께 살피며 이 안을 논의하겠습니다.", conditional: "평균값이 기준에 가까워도 특정 시기의 생물 피해는 남을 수 있습니다.", reject: "유량이나 산소 조건의 큰 부족을 하구만 감수하기 어렵습니다."}
  ];
  const CLAUSES = [
    ["휴경 보상", "0·10·20·30%, 비용 0·15·30·45억 원", "휴경만큼 농업 필요량이 줄어듭니다. 휴경한 면적의 소득은 기준 소득의 60%를 보상합니다. 휴경 농지의 생산은 수확 지수와 별개입니다."],
    ["도시 절수 캠페인", "끔/켬, 켜면 5억 원", "도시 필요량을 36에서 32.4백만 m³로 줄입니다. 공급률 100%여도 캠페인의 생활 부담은 사라지지 않습니다."],
    ["이웃 댐 연계 이송", "끔/켬, 켜면 25억 원", "세 전망 모두 저수지 유입에 10백만 m³를 더합니다. 이웃 댐의 물은 확보되어 있다고 가정하며 그 유역의 피해와 이송 전력은 계산하지 않습니다."],
    ["산란기 펄스 방류", "끔/켬, 돈 0, 물 4백만 m³", "하천유지 배분에 4를 더해 하류로 보냅니다. 온전히 이행하면 하구 유량 수용 기준을 4에서 3m³/s로 바꿉니다. 생물 효과를 물리적으로 계산한 결과가 아닌 게임의 협상 조건입니다."],
    ["부족 시 감량 순서", "미지정(비례 감량), 농업→도시→하천, 도시→하천→농업, 하천→농업→도시. 비용 0", "사수위에 닿는 전망에서 앞의 용도부터 줄입니다. 재조정 기능을 이 조항에 포함합니다. 사전에 알 수 있는 순서지만 실제 공급량은 비에 따라 바뀝니다. 실제 우리나라 다목적댐은 정부의 댐 용수공급 조정기준에 따라 가뭄 단계(관심→주의→경계→심각)가 오르면 하천유지용수(주의), 농업용수(경계), 생활·공업용수(심각) 순으로 감량 범위를 넓힙니다. 생활용수 공급을 우선하는 가치 판단이 담긴 순서이며, 하천유지용수를 먼저 줄이는 생태 비용도 있습니다. 이 게임은 여러 선택지 가운데 하나로 둡니다."]
  ];
  const PULSE_NOTE = "90일 평균 모형은 방류의 시기·지속시간을 재현하지 않습니다. 하천 몫을 감량하면 추가한 펄스 물부터 줄이며, 4가 전부 남지 않으면 완화 기준을 적용하지 않습니다.";
  const MODEL_MATERIAL = `<p>같은 총 방류량도 취수 위치와 돌아오는 물의 비율에 따라 하구에 도달하는 양이 달라집니다. 이 게임에서는 농업의 25%, 도시의 30%가 해당 하류로 돌아옵니다. 도시의 30% 회귀 가정 때문에 도시 사용과 하구 사이에도 갈등이 생깁니다. 이 비율은 현장의 일반값이 아닙니다. C는 부하를 통과 부피로 나눈 비교 지표입니다. 실제 순간 농도를 구하려면 같은 시간 단위의 부하율과 유량을 사용해야 합니다.</p>
  <p>산소 포화량은 같은 기압·염분에서 수온이 높아지면 줄어듭니다. 이 모형의 유량→수온 식은 그 하천에서 관측한 관계가 아닙니다. 부하에 따른 산소 감소도 실제 반응속도식이 아닙니다. 질산염·인산염 같은 영양염은 그 자체로 산소를 소비하지 않지만, 조류 증식과 사체의 분해를 거쳐 산소 부족으로 이어질 수 있습니다. 암모늄은 미생물이 질산염으로 바꾸는 과정에서 산소를 소비합니다. 생물 생산과 유기물의 분해·호흡으로 이어지는 복잡한 과정을 하나의 대리지표로 묶었습니다.</p>`;
  function materialHTML() {
    return `<div class="tabs" role="tablist" aria-label="자료">${[["basin", "유역과 전망"], ["parties", "당사자"], ["clauses", "조항"], ["model", "계산 근거"]].map(([k, n]) => `<button type="button" id="rd-tab-${k}" role="tab" aria-controls="rd-pane-${k}" aria-selected="false" tabindex="-1">${n}</button>`).join("")}</div>
    <div id="rd-pane-basin" class="rd-material" role="tabpanel" aria-labelledby="rd-tab-basin" hidden>
      <p>물은 댐 → 농업 취수 → 도시 취수 → 하구 순으로 흐릅니다. 그림의 위치와 거리는 실제 지형을 나타내지 않습니다. 물 사용이 많은 여름 90일을 다룹니다. 숫자는 90일 총량 또는 그 총량에서 환산한 평균 유량입니다. 어느 날의 갈수량이나 홍수량을 뜻하지 않습니다.</p>
      <dl class="rd-data">${[
        ["현재 저수량", "130백만 m³ · 90일의 출발점"], ["사용하지 못하는 저수량", "40백만 m³ · 게임의 사수위 저수량. 물 높이 단위가 아닙니다."], ["90일 증발", "6백만 m³ · 세 전망에 같은 값을 적용"], ["건조 유입", "15백만 m³, 35% · 적은 비가 이어지는 전망"], ["평년 유입", "55백만 m³, 45% · 협상의 기본 비교 전망"], ["습윤 유입", "100백만 m³, 20% · 비가 비교적 많이 오는 전망"], ["대책비", "60억 원 · 유역 밖 납세자도 부담하는 가상 예산"]
      ].map(([n, v]) => `<dt>${n}</dt><dd>${v}</dd>`).join("")}</dl><p>${RAIN}</p>
      <p>전망 확률은 이 게임에서 정한 정보입니다. 가중 평균, 기대 점수, 추첨에는 쓰지 않습니다. 세 전망을 나란히 비교하세요.</p>
    </div>
    <div id="rd-pane-parties" class="rd-material" role="tabpanel" aria-labelledby="rd-tab-parties" hidden>
      ${P.map((k, i) => `<section class="rd-party"><h4>${NAMES[i]}</h4><p>${PARTY_TEXT[i]}</p><p id="rd-party-threshold-${k}"></p></section>`).join("")}
      <p>발전량은 나란히 읽는 지표이며 수용 문턱은 아닙니다. 심각 미달 기준은 단계 상승과 무관합니다.</p>
      <p>심각 미달은 공사 평년 기말 저수량 &lt;80, 농가 소득 지수 &lt;0.70, 도시 공급률 &lt;0.85 또는 C &gt;1.00, 하구 Q &lt;3m³/s(펄스 온전 이행 시 2) 또는 DO &lt;4입니다. 모두 게임이 정한 값이며 단계 상승과 무관합니다. 전망별 표에서는 해당 전망의 지표로 같은 규칙을 적용합니다.</p>
      <p>대책비를 내는 유역 밖 납세자와 다음 계절·다음 세대의 사용자도 영향을 받습니다. 공사가 미래 사용자를 대변하더라도 그들의 이해를 모두 대신한다고 볼 수는 없습니다.</p>
    </div>
    <div id="rd-pane-clauses" class="rd-material" role="tabpanel" aria-labelledby="rd-tab-clauses" hidden>${CLAUSES.map(([n, c, d]) => `<section class="rd-party"><h4>${n}</h4><p>${c}</p><p>${d}</p></section>`).join("")}<p>${PULSE_NOTE}</p></div>
    <div id="rd-pane-model" class="rd-material" role="tabpanel" aria-labelledby="rd-tab-model" hidden>
      ${MODEL_MATERIAL}<p>1기압(760mmHg), 염분 0인 담수의 대기와 평형인 산소 포화 농도. 실제 물성의 소수 첫째 자리 반올림값을 노드로 사용하고 중간은 게임에서 선형 보간합니다.</p>
      <div class="rd-chart">${KCP.lines([0, 10, 20, 25, 30], [{name: "담수 포화 용존 산소", color: "var(--accent)", data: [14.6, 11.3, 9.1, 8.3, 7.6]}], {min: 0, max: 16, ticks: [0, 4, 8, 12, 16], xlabel: "수온(℃)", ylabel: "mg/L", aria: "수온별 담수 포화 용존 산소. 같은 값의 표가 이어집니다."})}</div>
      <dl class="rd-data">${[[0, 14.6], [10, 11.3], [20, 9.1], [25, 8.3], [30, 7.6]].map(([t, d]) => `<dt>수온 ${t}℃</dt><dd>DO_sat ${d.toFixed(1)}mg/L</dd>`).join("")}</dl>
      <p><a href="https://pubs.usgs.gov/twri/twri9a6/twri9a62/twri9a6_6.2_ver3.pdf">USGS 담수 산소 용해도 표, 760mmHg 열</a> · <a href="https://water.usgs.gov/water-resources/memos/documents/WQ.2011.03.pdf">USGS 산소 용해도 산정의 기압·염분 조건</a>. 외부 자료는 물성 근거이며 가상 유역 자료의 출처가 아닙니다.</p>
      <p>저수지 물 수지: 130+유입+이송−6 = 기말 저수량+실제 방류량. 하류 물 수지: R = Ve+0.75a+0.70c. 회귀수를 새로운 저수지 유입으로 다시 더하지 않습니다.</p>
      <dl class="rd-data"><dt>공급량과 단위 환산</dt><dd>a·c·e는 감량 후 농업·도시·하천유지 공급량입니다. K = 10⁶/(90×86400). Qc = Vc×K, Qe = Ve×K.</dd><dt>회귀수·희석</dt><dd>Vc = c+e+0.25a, Ve = e+0.25a+0.30c, L = 0.5a+20, C = L/Vc.</dd><dt>수온·산소</dt><dd>T = 30−6min(1,Qe/6). DO = max(0,DO_sat−2.0×(L+0.15c)/Ve). 유량 0일 때 C·DO는 계산 불가입니다.</dd><dt>수확·소득</dt><dd>농업 필요량 = 55×(1−휴경률). Y = max(0,1−1.2×(1−min(1,a/필요량))). 소득 = (1−휴경률)×Y+휴경률×0.6.</dd><dt>낙차·발전</dt><dd>H = 20+0.15×((130+기말 저수량)/2−40). 발전량 = 1000×9.8×H×R×10⁶×0.85/(3.6×10⁹)MWh.</dd></dl>
      <p>발전 물은 취수 전에 댐을 통과한 모든 실제 방류량 R입니다. 평균 낙차는 기초·기말 저수량의 산술평균에서 근사합니다. 기간 내 유입·방류의 시간 변화는 없습니다. 계산상 저수량 상한은 두지 않으며, 이 영역의 최대 기말 234까지 담을 수 있다고 가정합니다. 월류량은 0입니다. 실제 댐은 여름 홍수기에 홍수를 받아 낼 빈 공간을 남기려고 홍수기 제한수위 아래로 운영하므로, 습윤 전망의 큰 기말 저수량을 모두 남겨 둘 수 있다는 뜻이 아닙니다.</p>
      <p>재폭기·유기물 분해, 지하수와의 교환, 염분 침입, 작물 생육 단계별 물 요구, 펄스의 실제 시기와 지속시간, 발전 설비 용량, 이송 전력과 이웃 유역의 비용은 계산하지 않습니다. 이 담수 DO 식으로 갯벌의 상태를 계산하지 않습니다. 하굿둑이 없는 열린 하구에서는 염분 침입이 가뭄의 큰 영향일 수 있습니다. 강물이 줄면 바닷물이 상류로 더 올라와 민물과 바닷물이 섞이는 기수역이 위로 옮겨 가고, 그 기수역에 기대는 산란장과 어린 물고기의 서식지가 줄어들 수 있습니다.</p>
      <p>참고용 모형 반응은 협상 동의도, 생태 안전 인증도 아닙니다. 역할극에서는 사람이 기준 미달을 감수하고 수용할 수 있습니다.</p>
    </div>`;
  }
  function mapHTML(r) {
    const points = [["댐 방류", r.Qdam], ["농업 취수 직전", r.Qdam], ["도시 취수 직전", r.Qc], ["하구 담수 지점", r.Qe]];
    return `<svg id="rd-map" class="rd-map" viewBox="0 0 320 420" role="img" aria-labelledby="rd-map-title rd-map-desc">
      <title id="rd-map-title">은여울강 물 흐름</title><desc id="rd-map-desc">댐에서 농업, 도시, 하구로 흐릅니다. 취수와 회귀수는 가지 화살표로 표시합니다. 같은 수치와 설명이 그림 아래에 있습니다.</desc>
      <defs><marker id="rd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="var(--accent)"/></marker></defs>
      <path d="M140 48 V378" stroke="var(--accent)" stroke-width="3" marker-end="url(#rd-arrow)" aria-hidden="true"/>
      ${points.map(([n, v], i) => `<text x="4" y="${22 + i * 112}" fill="var(--ink)">${n} · ${f(v)}m³/s</text>`).join("")}
      <path d="M140 150 H286 M286 166 V196 H145 M140 262 H286 M286 278 V308 H145" fill="none" stroke="var(--accent)" stroke-width="2" marker-mid="url(#rd-arrow)" marker-end="url(#rd-arrow)" aria-hidden="true"/>
      <text x="154" y="147" fill="var(--ink)">a = ${f(r.v.ag, 2)}</text><text x="154" y="188" fill="var(--ink)">0.25a = ${f(.25 * r.v.ag, 2)}</text>
      <text x="154" y="259" fill="var(--ink)">c = ${f(r.v.city, 2)}</text><text x="154" y="300" fill="var(--ink)">0.30c = ${f(.30 * r.v.city, 2)}</text>
      <text x="4" y="408" fill="var(--ink)">취수·회귀수 단위: 백만 m³</text>
    </svg>
    <dl class="rd-data">${points.map(([n, v]) => `<dt>${n}</dt><dd>${f(v)}m³/s${n === "농업 취수 직전" ? " · 수질 계산 없음" : n === "도시 취수 직전" ? ` · C ${f(r.C)}` : ""}</dd>`).join("")}<dt>농업 취수 / 회귀수</dt><dd>${f(r.v.ag, 2)} / ${f(.25 * r.v.ag, 2)}백만 m³</dd><dt>도시 취수 / 회귀수</dt><dd>${f(r.v.city, 2)} / ${f(.30 * r.v.city, 2)}백만 m³</dd></dl>
    <p class="rd-notice">농업의 나머지 75%: 이 구간으로 돌아오지 않는 물(주로 증발산으로 소비)</p><p class="rd-notice">도시의 나머지 70%: 하구 담수 지점을 우회하는 해양 방류관</p><p class="rd-notice">이 비율은 실제 농업·도시의 일반적 비율이 아닙니다. 하구는 염분이 섞이기 전 담수 지점이며 갯벌의 해수 DO를 계산하는 것이 아닙니다.</p>`;
  }
  const metricDefs = [
    ["end", "감량 뒤 기말 저수량", "end", 2, "백만 m³"], ["raw-end", "계획대로 방류할 때의 기말 계산값", "rawEnd", 2, "백만 m³"], ["shortage", "감량량", "shortage", 2, "백만 m³"], ["r", "실제 방류량", "R", 2, "백만 m³"],
    ["qe", "하구 Q", "Qe", 3, "m³/s"], ["qc", "도시 취수 직전 Q", "Qc", 3, "m³/s"], ["temp", "하구 수온", "T", 2, "℃"], ["sat", "포화 DO", "sat", 1, "mg/L"], ["do", "모형 DO", "DO", 3, "mg/L"], ["c", "수질 지표 C", "C", 3, "임의 부하 단위/백만 m³"], ["income", "농가 소득 지수", "income", 3, ""], ["yield", "수확 지수", "Y", 3, ""], ["supply", "도시 공급률", "supply", 1, "%"], ["head", "평균 낙차", "H", 2, "m"], ["energy", "발전량", "MWh", 2, "MWh"]
  ];
  function resultsHTML() {
    return `<h3 id="rd-results-heading">단순화한 모형 · 평년</h3><label for="rd-scenario">현재 자세히 볼 전망</label><select id="rd-scenario">${Object.entries(SCENARIOS).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select>
    <p id="rd-preview-note" class="rd-notice"></p><div id="rd-map-wrap"></div>
    <p id="rd-assumptions" class="rd-notice">${ASSUMPTIONS}</p>
    <div class="rd-metrics">${metricDefs.map(([key, label, , , unit]) => `<div class="field"><label for="rd-${key}">${label}${unit ? " (" + unit + ")" : ""}</label><output id="rd-${key}" class="rd-value" aria-live="off"></output>${key === "do" ? `<p id="rd-do-caution" class="rd-notice">${DO_CAUTION}</p><p class="rd-notice">판정은 반올림 전 값</p><p id="rd-do-threshold" class="rd-notice"></p>` : key === "c" ? `<p class="rd-notice">${C_CAUTION}</p>` : ""}</div>`).join("")}</div>
    <p id="rd-coefficients" class="rd-notice">${COEFFICIENTS}</p><p id="rd-zero-do" class="rd-notice" hidden>산소 감소식이 포화값을 넘었습니다. 0으로 제한한 모형값입니다.</p><p id="rd-zero-flow" class="rd-notice" hidden>유량 0의 수온 30℃와 포화값은 계산식의 한계값이며 현장 측정 가능한 수온·DO가 아닙니다.</p>
    <p class="rd-notice">계획대로 방류할 때의 기말 계산값은 실제 저수량이 아닙니다. 음수이면 사수위에 못 미치는 계획이며 실제 공급은 감량 후 값입니다.</p>
    <div id="rd-allocation-chart" class="rd-chart"></div>
    <section id="rd-scenarios" class="rd-scenarios"><h3>세 전망 비교</h3><p class="rd-notice">${RAIN}</p><div id="rd-scenario-cards" class="rd-scenario-cards"></div></section>`;
  }
  function checkText(c) {
    const scale = c.key === "supply" ? 100 : 1, unit = c.key === "supply" ? "%" : "";
    const v = c.value === null ? null : c.value * scale, t = c.threshold * scale;
    let digits = ["end", "dry-cut"].includes(c.key) ? 2 : c.key === "supply" ? 1 : 3;
    // 판정은 반올림 전 값으로 한다. 미충족인데 반올림한 값이 기준과 같아 보이면 자릿수를 늘려 차이를 보인다.
    while (!c.met && v !== null && digits < 6 && f(v, digits) === f(t, digits)) digits++;
    const tie = !c.met && v !== null && f(v, digits) === f(t, digits);
    const delta = v === null ? "계산 불가(유량 0)" : c.upper ? `초과량 ${f(Math.max(0, v - t), digits)}${unit}` : `${v - t < -EPS ? "−" : "+"}${f(Math.abs(v - t), digits)}${unit}`;
    return `${f(v, digits)}${unit} / ${f(t, digits)}${unit} (${c.upper ? "이하" : "이상"}) · ${delta} · ${c.met ? "충족" : "미충족"}${tie ? " (반올림 전 미달)" : ""}`;
  }
  function checkListHTML(list) {
    return `<dl class="rd-data">${list.map(c => `<dt>${esc(c.label)}</dt><dd>${esc(checkText(c))}${c.key === "DO" ? `<p class="rd-notice">${DO_THRESHOLD}</p>` : ""}</dd>`).join("")}</dl>`;
  }
  const lastRound = g => g.rounds[g.rounds.length - 1];
  const canEditPlan = g => !g.locked && g.rounds.length < 4 && (g.stage === "draft" || g.stage === "counter" || (g.stage === "ready" && finished(lastRound(g), g.mode)));
  const canSubmit = g => !g.locked && g.rounds.length < 4 && planOK(g.proposal) && costOf(g.proposal) <= 60 && lineOK(g.criterion) && (["draft", "awaitSubmit"].includes(g.stage) || (g.stage === "ready" && finished(lastRound(g), g.mode)));
  const canDecide = (g, party) => !g.locked && ["ready", "counter"].includes(g.stage) && !!lastRound(g) && !lastRound(g).decision && P.includes(party) && actual(lastRound(g), g.mode).length === 4 && actual(lastRound(g), g.mode)[P.indexOf(party)] !== "accept";
  function canLock(g) {
    const r = lastRound(g);
    return !g.locked && g.stage === "ready" && finished(r, g.mode) && samePlan(g.proposal, r.proposal) && costOf(g.proposal) <= 60 && lineOK(g.criterion) && validateLocked({version: VERSION, proposal: g.proposal, mode: g.mode, criterion: g.criterion, mask: g.mask, rounds: g.rounds, final: g.final}) !== null;
  }
  function transition(input, action) {
    const g = restore(input).game;
    const r = lastRound(g);
    if (!obj(action)) return {game: g, changed: false};
    let changed = false;
    if (action.type === "submit" && canSubmit(g)) {
      g.mask = masksFromDecisions(g.rounds).next;
      g.rounds.push({n: g.rounds.length + 1, proposal: planCopy(g.proposal), mask: g.mask, human: null, decision: null});
      g.humanDraft = emptyHuman(); g.counter = null; g.stage = g.mode === "role" ? "responses" : "ready"; changed = true;
    } else if (action.type === "human" && g.stage === "responses" && humanOK(g.humanDraft)) {
      r.human = humanCopy(g.humanDraft); g.stage = "ready"; changed = true;
    } else if (action.type === "start" && g.stage === "ready" && g.rounds.length < 4 && canDecide(g, action.party) && ["a", "b"].includes(action.option) && !(action.party === "dam" && action.option === "b" && r.proposal.link)) {
      g.counter = {round: r.n, party: action.party, option: action.option, beforeP: planCopy(r.proposal), reason: str(action.reason, 200).replace(/[\r\n]/g, " ")};
      g.proposal = planCopy(r.proposal); g.stage = "counter"; changed = true;
    } else if (action.type === "cancel" && g.stage === "counter") {
      g.proposal = planCopy(g.counter.beforeP); g.counter = null; g.stage = "ready"; changed = true;
    } else if (action.type === "apply" && g.stage === "counter" && g.rounds.length < 4 && canDecide(g, g.counter.party) && lineOK(g.counter.reason) && costOf(g.proposal) <= 60 && improves(g.counter.beforeP, g.proposal, g.counter.party, g.counter.option)) {
      r.decision = {id: `rd-r${r.n}-decision`, action: "apply", party: g.counter.party, option: g.counter.option, beforeP: planCopy(r.proposal), afterP: planCopy(g.proposal), reason: g.counter.reason.trim(), beforeMask: r.mask};
      if (!g.rounds.some(x => x !== r && x.decision && x.decision.id === g.final.hardDecisionId)) g.final.hardDecisionId = r.decision.id; g.stage = "awaitSubmit"; g.counter = null; changed = true;
    } else if (action.type === "reject" && canDecide(g, g.counter ? g.counter.party : action.party) && lineOK(action.reason)) {
      r.decision = {id: `rd-r${r.n}-decision`, action: "reject", party: g.counter ? g.counter.party : action.party, option: null, beforeP: planCopy(r.proposal), afterP: planCopy(r.proposal), reason: action.reason.trim(), beforeMask: r.mask};
      g.proposal = planCopy(r.proposal); if (!g.rounds.some(x => x !== r && x.decision && x.decision.id === g.final.hardDecisionId)) g.final.hardDecisionId = r.decision.id; g.counter = null; g.stage = "ready"; changed = true;
    } else if (action.type === "lock" && canLock(g)) {
      g.locked = clone({version: VERSION, proposal: g.proposal, mode: g.mode, criterion: g.criterion, mask: g.mask, rounds: g.rounds, final: g.final});
      g.stage = "locked"; changed = true;
    } else if (action.type === "unlock" && g.locked) {
      g.previousLocked = clone(g.locked); g.proposal = planCopy(g.locked.proposal); g.rounds = []; g.mask = 0; g.counter = null; g.locked = null; g.stage = "draft"; g.humanDraft = emptyHuman(); g.final.hardDecisionId = ""; changed = true;
    }
    return {game: g, changed};
  }
  function renderPrep(root, state, save, next) {
    const loaded = restore(state.game);
    let g = loaded.game;
    state.game = g;
    let party = "dam", option = null, reason = "", invalid = false;
    const $ = selector => root.querySelector(selector);
    const all = selector => Array.from(root.querySelectorAll(selector));
    const button = (key, text, cls = "") => `<button type="button" id="rd-${key}" class="btn ${cls}">${text}</button>`;
    const field = (key, label, max, textarea = false) => `<div class="field"><label for="rd-${key}">${label} · 필수</label>${textarea ? `<textarea id="rd-${key}" class="note" maxlength="${max}" aria-required="true"></textarea>` : `<input id="rd-${key}" class="note" maxlength="${max}" aria-required="true">`}</div>`;
    root.innerHTML = `<div id="rd-root" class="rd-root" data-rd-version="${VERSION}"><div class="desk rd-desk">
      <section class="panel rd-mode-area"><h3>모드와 기준 <span class="tag-mine">연습용 도구</span></h3><div class="row">${button("mode-role", "역할극")}${button("mode-auto", "개인 연습용 자동 반응")}</div>${field("criterion", "내 판단 기준과 무게 한 줄", 200)}<p class="rd-notice">모형 반응과 실제 역할극 발언은 별개입니다. 수치 기준 충족은 협상 동의도, 생태 안전 인증도 아닙니다. 모형의 4자 합의 가능성 검사는 자동 반응·공개 기준에만 관한 것입니다.</p></section>
      <section class="panel rd-material-area"><h3>자료 <span class="tag-mine">연습용 자료</span></h3>${materialHTML()}</section>
      <section class="panel rd-proposal-area"><h3>제안 편집</h3><div class="rd-inputs">${[["ag", "농업"], ["city", "도시"], ["env", "하천유지"]].map(([k, n]) => `<div class="field"><label for="rd-${k}">${n} 배분 (백만 m³) · 필수</label><div class="rd-stepper">${button(k + "-minus", "−", "rd-step")}<input id="rd-${k}" class="rd-number" type="number" min="0" max="80" step="1" aria-required="true" aria-describedby="rd-error">${button(k + "-plus", "+", "rd-step")}</div></div>`).join("")}</div>
      <div class="field"><label for="rd-f">휴경 보상</label><select id="rd-f">${[0, .1, .2, .3].map(v => `<option value="${v}">${v * 100}%</option>`).join("")}</select></div>
      ${[["save", "도시 절수 캠페인"], ["link", "이웃 댐 연계 이송"], ["pulse", "산란기 펄스 방류"]].map(([k, n]) => `<label class="rd-toggle"><input id="rd-${k}" type="checkbox">${n}</label>`).join("")}
      <div class="field"><label for="rd-order">부족 시 감량 순서</label><select id="rd-order">${Object.entries(ORDER_NAMES).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></div>
      <p class="rd-notice">${PULSE_NOTE}</p><output id="rd-cost" aria-live="off"></output><p id="rd-budget" class="rd-error" hidden>${BUDGET}</p><p id="rd-next-threshold" class="rd-notice"></p>${button("submit", "제안하기", "primary")}</section>
      <section id="rd-results" class="panel rd-results rd-results-area">${resultsHTML()}</section>
      <section class="panel rd-response-area"><div id="rd-responses" class="rd-responses"><h3 id="rd-responses-heading" tabindex="-1">현재 반응 · 평년</h3><p class="rd-notice">${MODEL_RULE}</p><p class="rd-notice">참고용 모형 반응입니다. 실제 사람의 태도를 예측하지 않습니다.</p><p class="rd-notice">판정은 반올림 전 값으로 합니다. 반올림한 값이 기준과 같아 보이면 소수 자릿수를 늘려 표시합니다.</p>
      ${P.map((k, i) => `<section id="rd-response-${k}" class="rd-party"><h4>${NAMES[i]}</h4><div id="rd-response-model-${k}"></div><div id="rd-human-${k}"><label for="rd-human-${k}-status">역할극 반응 · 필수</label><select id="rd-human-${k}-status" aria-required="true"><option value="">미입력</option>${Object.entries(STATUS).map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select><label for="rd-human-${k}-line" id="rd-human-${k}-label">역할극 발언 · 거부일 때 필수</label><input class="note" id="rd-human-${k}-line" maxlength="200"><p id="rd-human-${k}-record" class="rd-notice"></p></div></section>`).join("")}${button("record-human", "네 반응 기록")}</div>
      <div id="rd-counter"><h3>역제안과 연쇄</h3><label for="rd-counter-party">역제안을 논의할 당사자</label><select id="rd-counter-party">${P.map((k, i) => `<option value="${k}">${NAMES[i]}</option>`).join("")}</select><p id="rd-counter-note" class="rd-notice"></p><div class="rd-wants">${button("want-a", "", "rd-want")}${button("want-b", "", "rd-want")}</div><p id="rd-link-note" class="rd-notice" hidden>이미 이송 중입니다. 다른 요구를 선택하거나 거절 이유를 적으세요.</p>${button("counter-start", "역제안 편집 시작")}
      <div id="rd-cascade" class="rd-cascade" hidden><h4 id="rd-cascade-heading" tabindex="-1">변경 전 / 변경 후</h4><p class="rd-notice">판정은 반올림 전 값으로 합니다.</p><div id="rd-cascade-body"></div></div>
      <label for="rd-decision-reason">반영 또는 거절 이유 한 문장 · 필수</label><input id="rd-decision-reason" class="note" maxlength="200" aria-required="true" aria-describedby="rd-reason-note"><p id="rd-reason-note" class="rd-notice">거절 이유 한 문장을 적으세요.</p><div class="row">${button("apply", "반영")}${button("reject", "거절하고 현재안 유지")}${button("counter-cancel", "편집 취소")}</div><p id="rd-fourth-note" class="rd-notice" hidden>네 번의 제안을 마쳤습니다. 남은 역제안을 거절한 이유를 적은 뒤 상정 방식을 고르세요.</p></div></section>
      <section class="panel rd-final-area"><h3>상정</h3><div class="field"><label for="rd-final-mode">상정 방식 · 필수</label><select id="rd-final-mode" aria-required="true"><option value="">미선택</option>${Object.entries(FINAL_NAMES).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></div>${field("gain", "얻는 것", 200, true)}${field("loss", "잃는 것", 200, true)}${field("final-text", "합의문 요지", 1000, true)}
      <div class="field"><label for="rd-hard-decision">가장 받아들이기 어려웠던 역제안 기록</label><select id="rd-hard-decision"></select></div><p id="rd-lock-note" class="rd-notice"></p><div class="row">${button("lock", "상정안 확정")}${button("unlock", "다시 계획하기")}</div><p class="rd-notice">확정을 풀고 새 4회 협상을 시작합니다. 기존 메모와 면접 메모는 남습니다.</p><p id="rd-previous-note" class="rd-notice" hidden>이전 협상의 면접 메모가 남아 있습니다. 새 질문에 맞춰 확인하세요.</p></section>
      <div class="rd-memo-area">${KCP.memoPanel(state, save, "rd-memo")}<div class="row">${button("go", "면접실로 이동", "primary")}</div></div>
      </div><div id="rd-status" class="rd-status" role="status" aria-live="polite"></div><div id="rd-error" class="rd-error" role="alert" hidden></div><section id="rd-history" class="rd-history"></section></div>`;
    function persist() { state.game = g; save(); }
    function notify(message, focus) { $("#rd-status").textContent = message; if (focus) $(focus).focus(); }
    function resetSelection() {
      const r = lastRound(g), a = r ? actual(r, g.mode) : [];
      party = g.counter ? g.counter.party : P[Math.max(0, a.findIndex(s => s !== "accept"))];
      option = g.counter ? g.counter.option : null;
      reason = g.counter ? g.counter.reason : "";
      $("#rd-decision-reason").value = reason;
    }
    function syncInputs() {
      Object.keys(BASE).forEach(k => {
        const el = $("#rd-" + k);
        if (["save", "link", "pulse"].includes(k)) el.checked = g.proposal[k]; else el.value = String(g.proposal[k]);
      });
      $("#rd-criterion").value = g.criterion;
      $("#rd-scenario").value = g.scenario;
      $("#rd-final-mode").value = g.final.mode;
      [["gain", "gain"], ["loss", "loss"], ["final-text", "text"]].forEach(([key, name]) => { $("#rd-" + key).value = g.final[name]; });
      P.forEach(k => {
        const h = g.mode === "role" && lastRound(g) && lastRound(g).human ? lastRound(g).human[k] : g.humanDraft[k];
        $("#rd-human-" + k + "-status").value = h.status;
        $("#rd-human-" + k + "-line").value = h.line;
      });
      invalid = false;
      all(".rd-number").forEach(el => el.setAttribute("aria-invalid", "false"));
    }
    function paintTabs() {
      ["basin", "parties", "clauses", "model"].forEach(k => {
        const b = $("#rd-tab-" + k), active = g.tab === k;
        b.setAttribute("aria-selected", String(active)); b.tabIndex = active ? 0 : -1;
        $("#rd-pane-" + k).hidden = !active;
      });
    }
    function paintResults() {
      const E = evaluate(g.proposal, g.mask), r = E[g.scenario];
      $("#rd-results-heading").textContent = `단순화한 모형 · ${SCENARIOS[g.scenario]}`;
      $("#rd-preview-note").textContent = invalid ? "입력 수정 중 · 아래 값은 마지막 유효 입력 기준" : r.cost > 60 ? "제출할 수 없는 초안" : "";
      $("#rd-map-wrap").innerHTML = mapHTML(r);
      metricDefs.forEach(([key, , prop, digits]) => { $("#rd-" + key).textContent = f(prop === "supply" ? r[prop] * 100 : r[prop], digits); });
      $("#rd-do-threshold").textContent = `모형 DO 기준 ${g.mask & 8 ? "5.1" : "5"}mg/L · ${DO_THRESHOLD}`;
      $("#rd-zero-do").hidden = !(r.doRaw !== null && r.doRaw < 0);
      $("#rd-zero-flow").hidden = r.Ve !== 0;
      $("#rd-allocation-chart").innerHTML = KCP.hbar(["ag", "city", "env"].map((k, i) => ({label: ["농업", "도시", "하천유지"][i], v: r.v[k], v2: r.req[k]})), {max: 84, ticks: [0, 28, 56, 84], v2: true, unit: "백만 m³", c1: "var(--accent)", c2: "var(--ink-3)", aria: "선택한 전망의 계획량과 실제 공급량"}) + `<p class="rd-notice">각 줄의 위 막대: 계획량 / 아래 막대: 실제 공급량</p><dl class="rd-data">${["ag", "city", "env"].map((k, i) => `<dt>${["농업", "도시", "하천유지"][i]}</dt><dd>계획량 ${f(r.req[k], 2)} / 공급량 ${f(r.v[k], 2)} / 감량량 ${f(r.cut[k], 2)}백만 m³</dd>`).join("")}<dt>펄스 잔여</dt><dd>${f(r.pulseActual, 2)}백만 m³ · ${r.pulseEffective ? "온전 이행" : "완화 기준 미적용"}</dd></dl>`;
      $("#rd-scenario-cards").innerHTML = Object.keys(SCENARIOS).map(k => {
        const s = E[k];
        return `<section data-rd-scenario="${k}"><h4>${SCENARIOS[k]}</h4><dl class="rd-data">${[["end", "감량 뒤 기말 저수량"], ["rawEnd", "계획대로 방류할 때의 기말 계산값"], ["shortage", "감량량"]].map(([metric, n]) => `<dt>${n}</dt><dd data-rd-metric="${metric}">${f(s[metric], 2)}백만 m³</dd>`).join("")}${["ag", "city", "env"].map((v, i) => `<dt>${["농업", "도시", "하천유지"][i]} 실제 공급</dt><dd data-rd-metric="${v}">${f(s.v[v], 2)}백만 m³</dd>`).join("")}${P.map((p, i) => `<dt>${NAMES[i]}</dt><dd data-rd-metric="${p}">${STATUS[s.responses[i]]}</dd>`).join("")}</dl></section>`;
      }).join("");
      const thresholds = ["해당 전망 기말 저수량 ≥110, 별도로 건조 전망 감량량=0", "농가 소득 지수 ≥0.85", "도시 공급률 ≥0.95, 수질 지표 C≤0.90", "하구 Q≥4m³/s(펄스 온전 이행 시 3), 모형 DO≥5mg/L"];
      P.forEach((k, i) => { $("#rd-party-threshold-" + k).textContent = thresholds[i] + ((g.mask >> i) & 1 ? ` · 현재 기준 ${THRESHOLD[i]}` : "") + (i === 3 ? ` · ${DO_THRESHOLD}` : ""); });
    }
    function paintResponses() {
      const last = lastRound(g), E = evaluate(last ? last.proposal : g.proposal, last ? last.mask : g.mask), N = E.normal;
      const cs = checks(N, E.dry, last ? last.mask : g.mask), sv = severe(N);
      $("#rd-responses-heading").textContent = last ? `제안 ${last.n} · 현재 반응 · 평년` : "제출 전 모형 미리보기 · 평년";
      P.forEach((k, i) => {
        $("#rd-response-model-" + k).innerHTML = `<p><b>${g.mode === "auto" ? "자동 반응" : "모형 반응"}: ${STATUS[N.responses[i]]}</b></p>${((last ? last.mask : g.mask) >> i) & 1 ? `<p>기준 상승: ${THRESHOLD[i]}</p>` : ""}${checkListHTML(cs[i])}<p>미충족 기준: ${cs[i].filter(c => !c.met).map(c => esc(c.label)).join(", ") || "없음"}</p><p>심각 미달: ${sv[i] ? "해당" : "없음"}</p>${g.mode === "auto" ? `<p>모형 발언: ${LINES[i][N.responses[i]]}</p>` : ""}`;
        $("#rd-human-" + k).hidden = g.mode !== "role";
        $("#rd-human-" + k + "-record").textContent = last && last.human ? `기록된 사람 반응: ${STATUS[last.human[k].status]}${last.human[k].line ? " · 역할극 발언: " + last.human[k].line : ""}` : "";
      });
    }
    function paintCascade() {
      const last = lastRound(g), decision = last && last.decision;
      const c = g.counter || (g.stage === "awaitSubmit" && decision ? decision : null);
      $("#rd-cascade").hidden = !c;
      if (!c) return;
      const before = evaluate(c.beforeP, last.mask), after = evaluate(g.proposal, last.mask);
      const bc = checks(before.normal, before.dry, last.mask), ac = checks(after.normal, after.dry, last.mask);
      $("#rd-cascade-body").innerHTML = P.map((k, i) => `<section class="rd-cascade-party" data-rd-party="${k}"><h4>${NAMES[i]}</h4><p>모형: ${STATUS[before.normal.responses[i]]}→${STATUS[after.normal.responses[i]]}</p>${g.mode === "role" ? `<p>변경 전 사람 반응: ${STATUS[last.human[k].status]}${last.human[k].line ? " · 역할극 발언: " + esc(last.human[k].line) : ""}</p><p>사람 반응: 재확인 필요</p>` : ""}<dl>${bc[i].map((b, j) => {
        const a = ac[i][j], change = b.met === a.met ? "유지" : b.met ? "충족→미충족" : "미충족→충족";
        const delta = a.value === null || b.value === null ? "계산 불가" : (a.value - b.value >= 0 ? "+" : "−") + (b.key === "supply" ? f(Math.abs(a.value - b.value) * 100, 1) + "%p" : f(Math.abs(a.value - b.value), ["end", "dry-cut"].includes(b.key) ? 2 : 3));
        return `<div data-rd-check="${b.key}" class="rd-check${b.met && !a.met ? " rd-new-missing" : ""}"><dt>${esc(b.label)} · ${change}${b.met && !a.met ? " · 새로 미충족" : ""}</dt><dd><span>변경 전 ${esc(checkText(b))}</span><span>변경 후 ${esc(checkText(a))}</span><span>변화 ${esc(delta)}</span></dd></div>`;
      }).join("")}</dl></section>`).join("");
    }
    function paintHistory() {
      const decisions = g.rounds.filter(r => r.decision);
      $("#rd-hard-decision").innerHTML = decisions.length ? decisions.map(r => `<option value="${r.decision.id}">제안 ${r.n} · ${NAMES[P.indexOf(r.decision.party)]} · ${r.decision.action === "apply" ? "반영" : "거절"}</option>`).join("") : '<option value="">역제안 없음</option>';
      $("#rd-hard-decision").value = g.final.hardDecisionId;
      $("#rd-history").innerHTML = `<h3>라운드 이력</h3><ol>${g.rounds.map(r => {
        const n = evaluate(r.proposal, r.mask).normal;
        return `<li><details class="rd-round"><summary>제안 ${r.n}</summary><p>${planText(r.proposal)}</p><p>${clausesText(r.proposal)}</p><p>기준 상승: ${thresholdText(r.mask)}</p>${P.map((k, i) => `<p>${NAMES[i]} · 모형: ${STATUS[n.responses[i]]}${g.mode === "role" ? r.human ? ` · 사람: ${STATUS[r.human[k].status]}${r.human[k].line ? " · 역할극 발언: " + esc(r.human[k].line) : ""}` : " · 사람 반응: 미입력" : ""}</p>`).join("")}<p>${r.decision ? esc(decisionText(r.decision, r.n)) : "역제안 결정 없음"}</p>${r.decision && r.decision.action === "apply" ? `<p>반영안: ${planText(r.decision.afterP)}</p><p>${clausesText(r.decision.afterP)}</p>` : ""}</details></li>`;
      }).join("")}</ol>${g.previousLocked ? `<details class="rd-round"><summary>이전 협상 · 읽기 전용</summary><dl class="rd-data">${recapLocked(g.previousLocked).map(r => `<dt>${esc(r.t)}</dt><dd>${esc(r.d)}</dd>`).join("")}</dl></details>` : ""}`;
    }
    function thresholdNotice() {
      const last = lastRound(g), masks = masksFromDecisions(g.rounds);
      const notes = [];
      P.forEach((k, i) => {
        if ((g.mask >> i) & 1) notes.push(`${SHORT[i]} 기준 ${THRESHOLD[i]} · 이미 오른 기준은 추가 상승이 없습니다.`);
        else if ((masks.next >> i) & 1) notes.push(`다음 제출부터 ${SHORT[i]} 기준이 ${THRESHOLD[i]}로 오릅니다.`);
      });
      const previous = last && !last.decision ? g.rounds[g.rounds.length - 2] : last;
      if (previous && previous.decision && previous.decision.action === "reject") {
        const i = P.indexOf(previous.decision.party);
        if (!((masks.next >> i) & 1)) notes.push(`직전 제출에서 ${SHORT[i]}의 요구를 거절했습니다. 이번에도 거절하면 다음 제출부터 ${SHORT[i]} 기준이 ${THRESHOLD[i]}로 오릅니다.`);
      }
      return notes.join(" ") || "기준 변화 없음";
    }
    function paintControls() {
      const locked = !!g.locked, last = lastRound(g), edit = canEditPlan(g);
      ["role", "auto"].forEach(k => { const b = $("#rd-mode-" + k); b.disabled = locked || g.rounds.length > 0; b.setAttribute("aria-pressed", String(g.mode === k)); });
      $("#rd-criterion").disabled = locked;
      Object.keys(BASE).forEach(k => { $("#rd-" + k).disabled = !edit; });
      ["ag", "city", "env"].forEach((k, i) => {
        const el = $("#rd-" + k), n = el.valueAsNumber;
        ["minus", "plus"].forEach(dir => {
          const b = $("#rd-" + k + "-" + dir);
          b.disabled = !edit || !Number.isInteger(n) || n < 0 || n > 80 || (dir === "minus" ? n <= 0 : n >= 80);
          b.setAttribute("aria-label", `${["농업", "도시", "하천유지"][i]} 배분 1백만 m³ ${dir === "minus" ? "줄이기" : "늘리기"}`);
        });
      });
      $("#rd-cost").textContent = `대책비 ${costOf(g.proposal)} / 60억 원`;
      $("#rd-budget").hidden = costOf(g.proposal) <= 60;
      $("#rd-next-threshold").textContent = thresholdNotice();
      $("#rd-submit").textContent = g.rounds.length ? "다음 제안 제출" : "제안하기";
      $("#rd-submit").disabled = invalid || !canSubmit(g);
      P.forEach(k => {
        $("#rd-human-" + k).hidden = g.mode !== "role";
        $("#rd-human-" + k + "-status").disabled = g.stage !== "responses" || locked;
        $("#rd-human-" + k + "-line").disabled = g.stage !== "responses" || locked;
        $("#rd-human-" + k + "-line").setAttribute("aria-required", String(g.humanDraft[k].status === "reject"));
        $("#rd-human-" + k + "-label").textContent = "역할극 발언" + (g.humanDraft[k].status === "reject" ? " · 필수" : " · 선택");
      });
      $("#rd-record-human").hidden = g.mode !== "role";
      $("#rd-record-human").disabled = g.stage !== "responses" || !humanOK(g.humanDraft) || locked;
      $("#rd-counter-party").value = party;
      $("#rd-counter-party").disabled = locked || g.stage === "counter" || !last || !["ready"].includes(g.stage) || !!last.decision;
      const discuss = canDecide(g, party), i = P.indexOf(party);
      ["a", "b"].forEach((k, j) => {
        const b = $("#rd-want-" + k);
        b.textContent = WANT[i][j]; b.setAttribute("aria-pressed", String(option === k));
        b.disabled = locked || g.stage !== "ready" || !last || !!last.decision || (party === "dam" && k === "b" && last.proposal.link);
      });
      $("#rd-link-note").hidden = !(last && party === "dam" && last.proposal.link);
      $("#rd-counter-note").textContent = g.stage === "responses" ? "네 반응을 기록한 뒤 역제안을 논의하세요." : g.stage === "awaitSubmit" ? "반영한 초안을 다음 제안으로 제출하세요. 다음 제출에서 기준이 오르면 모형 반응도 달라질 수 있습니다." : !last ? "제안 제출 뒤 역제안을 논의하세요." : last.decision ? "이 제출의 역제안 결정은 기록되었습니다." : !discuss && actual(last, g.mode).length === 4 ? "요구 살펴보기 · 수용한 당사자의 역제안 처리 기록은 만들지 않습니다." : "두 요구 중 하나를 고른 뒤 물량과 조항을 직접 편집하세요. 요구 반영은 수용을 보장하지 않습니다.";
      $("#rd-counter-start").disabled = !discuss || g.stage !== "ready" || !option || g.rounds.length === 4 || (party === "dam" && option === "b" && last.proposal.link);
      $("#rd-decision-reason").disabled = !discuss;
      $("#rd-apply").disabled = invalid || g.stage !== "counter" || !g.counter || !discuss || !lineOK(reason) || costOf(g.proposal) > 60 || !improves(g.counter.beforeP, g.proposal, party, option) || g.rounds.length === 4;
      $("#rd-reject").disabled = !discuss || !lineOK(reason);
      $("#rd-counter-cancel").disabled = g.stage !== "counter" || locked;
      $("#rd-fourth-note").hidden = g.rounds.length !== 4 || locked || !!(last && last.decision) || (last && actual(last, g.mode).every(s => s === "accept") && actual(last, g.mode).length === 4);
      const allowed = modesFor(last ? actual(last, g.mode) : []);
      Object.keys(FINAL_NAMES).forEach(k => {
        const o = $("#rd-final-mode").querySelector(`option[value="${k}"]`);
        o.disabled = !allowed[k];
        o.textContent = FINAL_NAMES[k] + (allowed[k] ? "" : k === "unanimous" ? " · 네 곳 수용 필요" : k === "majority" ? " · 세 곳 이상 수용 필요" : " · 네 반응 기록 필요");
      });
      ["final-mode", "gain", "loss", "final-text", "hard-decision"].forEach(k => { $("#rd-" + k).disabled = locked; });
      $("#rd-lock").disabled = invalid || !canLock(g);
      $("#rd-unlock").disabled = !locked;
      $("#rd-go").disabled = !locked;
      $("#rd-previous-note").hidden = !g.previousLocked;
      $("#rd-lock-note").textContent = locked ? "상정안 확정" : g.stage === "awaitSubmit" || (last && !samePlan(g.proposal, last.proposal)) || g.stage === "draft" && last ? "수정한 초안을 먼저 제출하세요." : g.stage === "counter" ? "역제안 편집을 반영하거나 취소하세요." : !last ? "제안을 제출한 뒤 상정안을 확정하세요." : !finished(last, g.mode) ? "역할극 반응과 필요한 역제안 결정을 마치세요." : "상정 방식·얻는 것·잃는 것·합의문을 작성하세요.";
    }
    function paintAll() { paintTabs(); paintResults(); paintResponses(); paintCascade(); paintHistory(); paintControls(); }
    function act(type) {
      if (invalid && ["submit", "apply", "lock"].includes(type)) {
        const bad = all(".rd-number").find(el => el.getAttribute("aria-invalid") === "true");
        if (bad) bad.focus();
        return;
      }
      const oldMask = g.mask;
      const result = transition(g, {type, party, option, reason});
      if (!result.changed) return;
      g = result.game;
      resetSelection(); syncInputs(); persist(); paintAll();
      const messages = {submit: "제안을 제출했습니다.", human: "네 반응을 기록했습니다.", start: "역제안 편집을 시작했습니다.", cancel: "편집을 취소했습니다.", apply: "역제안을 반영했습니다. 다음 제안을 제출하세요.", reject: "거절 이유를 기록하고 현재안을 유지합니다.", lock: "상정안을 확정했습니다.", unlock: "새 4회 협상을 시작합니다."};
      $("#rd-error").hidden = true; $("#rd-error").textContent = "";
      notify(messages[type] + (type === "submit" && oldMask !== g.mask ? " 이번 제출부터 오른 기준으로 모형 반응을 계산합니다." : ""), ({submit: "#rd-responses-heading", human: "#rd-responses-heading", start: "#rd-ag", apply: "#rd-cascade-heading", cancel: "#rd-counter-start", reject: "#rd-final-mode", lock: "#rd-go", unlock: "#rd-ag"})[type]);
    }
    function readPlan() {
      if (!canEditPlan(g)) return;
      const p = {...g.proposal};
      invalid = false;
      ["ag", "city", "env"].forEach(k => {
        const el = $("#rd-" + k), v = el.valueAsNumber;
        const ok = el.value !== "" && Number.isInteger(v) && v >= 0 && v <= 80;
        el.setAttribute("aria-invalid", String(!ok)); if (!ok) invalid = true; else p[k] = v;
      });
      p.f = Number($("#rd-f").value); p.order = $("#rd-order").value;
      ["save", "link", "pulse"].forEach(k => { p[k] = $("#rd-" + k).checked; });
      if (!invalid && planOK(p)) {
        if (g.stage === "ready" && !samePlan(p, g.proposal)) g.stage = "draft";
        // 끝난 제출의 안으로 되돌리면 다시 상정할 수 있는 상태로 돌아간다(불필요한 추가 제출 방지).
        else if (g.stage === "draft" && lastRound(g) && finished(lastRound(g), g.mode) && !(lastRound(g).decision && lastRound(g).decision.action === "apply") && samePlan(p, lastRound(g).proposal)) g.stage = "ready";
        g.proposal = p; persist();
      }
      $("#rd-error").textContent = invalid ? "0~80의 정수를 입력하세요." : "";
      $("#rd-error").hidden = !invalid;
      paintResults(); paintCascade(); if (!g.rounds.length) paintResponses(); paintControls();
    }
    ["ag", "city", "env"].forEach(k => {
      $("#rd-" + k).addEventListener("input", readPlan);
      ["minus", "plus"].forEach(dir => { $("#rd-" + k + "-" + dir).onclick = () => {
        if (!canEditPlan(g)) return;
        const el = $("#rd-" + k), v = el.valueAsNumber;
        if (!Number.isInteger(v) || v < 0 || v > 80) return;
        el.value = String(Math.max(0, Math.min(80, v + (dir === "plus" ? 1 : -1)))); readPlan();
      }; });
    });
    ["f", "save", "link", "pulse", "order"].forEach(k => { $("#rd-" + k).onchange = readPlan; });
    ["role", "auto"].forEach(mode => { $("#rd-mode-" + mode).onclick = () => { if (g.locked || g.rounds.length) return; g.mode = mode; persist(); paintResponses(); paintControls(); }; });
    $("#rd-criterion").oninput = e => { if (g.locked) return; g.criterion = e.target.value; persist(); paintControls(); };
    $("#rd-scenario").onchange = e => { g.scenario = e.target.value; persist(); paintResults(); };
    const tabs = ["basin", "parties", "clauses", "model"];
    tabs.forEach((k, i) => {
      const b = $("#rd-tab-" + k);
      b.onclick = () => { g.tab = k; persist(); paintTabs(); };
      b.onkeydown = e => {
        const at = e.key === "Home" ? 0 : e.key === "End" ? 3 : e.key === "ArrowRight" ? (i + 1) % 4 : e.key === "ArrowLeft" ? (i + 3) % 4 : null;
        if (at === null) return;
        e.preventDefault(); tabs.forEach((name, j) => { $("#rd-tab-" + name).tabIndex = j === at ? 0 : -1; }); $("#rd-tab-" + tabs[at]).focus();
      };
    });
    P.forEach(k => {
      const editHuman = () => {
        if (g.stage !== "responses") return;
        g.humanDraft[k] = {status: $("#rd-human-" + k + "-status").value, line: $("#rd-human-" + k + "-line").value}; persist(); paintControls();
      };
      $("#rd-human-" + k + "-status").onchange = editHuman; $("#rd-human-" + k + "-line").oninput = editHuman;
    });
    $("#rd-counter-party").onchange = e => { if (g.stage !== "ready" || g.locked || lastRound(g).decision) return; party = e.target.value; option = null; paintControls(); };
    ["a", "b"].forEach(k => { $("#rd-want-" + k).onclick = () => { if (g.stage !== "ready" || g.locked) return; option = k; paintControls(); }; });
    $("#rd-decision-reason").oninput = e => { if (!canDecide(g, party)) return; reason = e.target.value; if (g.counter) { g.counter.reason = reason; persist(); } paintControls(); };
    [["submit", "submit"], ["record-human", "human"], ["counter-start", "start"], ["counter-cancel", "cancel"], ["apply", "apply"], ["reject", "reject"], ["lock", "lock"], ["unlock", "unlock"]].forEach(([key, type]) => { $("#rd-" + key).onclick = () => act(type); });
    [["final-mode", "mode"], ["gain", "gain"], ["loss", "loss"], ["final-text", "text"], ["hard-decision", "hardDecisionId"]].forEach(([key, name]) => {
      const handler = e => { if (g.locked) return; g.final[name] = e.target.value; persist(); paintControls(); };
      $("#rd-" + key).addEventListener(key === "final-mode" || key === "hard-decision" ? "change" : "input", handler);
    });
    $("#rd-go").onclick = () => { if (g.locked && validateLocked(g.locked)) next(); };
    resetSelection(); syncInputs(); paintAll();
    if (loaded.repaired) { $("#rd-error").textContent = RECOVERY; $("#rd-error").hidden = false; }
  }
  const REFLECTION = `<section id="rd-reflect" class="rd-reflect">
  <p class="rd-notice">예시는 서로 다른 가상의 판단입니다. 어느 것도 정답이나 합격 답안이 아닙니다. 위에 적은 내 기준과 비용 부담을 비교하세요. 다수 합의를 얻은 예시가 더 나은 판단이라는 뜻은 아닙니다. 합의 여부는 이 게임의 수치 기준에 달려 있습니다.</p>
  <h3>내 기준과 비교하기 <span class="tag-mine">연습용 성찰</span></h3>
  <div id="rd-examples" class="rd-examples">
    <details class="reveal" id="rd-example-life">
      <summary>가상의 답 1 · 생활과 위생 우선</summary>
      <p><b>기준과 무게:</b> 생활·위생을 가장 무겁게, 올해 농가 소득과 산란기 조건을 그다음으로, 다음 계절 비축을 상대적으로 낮게 두었습니다.</p>
      <p><b>선택:</b> 농업 43, 도시 33, 하천유지 15백만 m³를 배분합니다. 휴경 20%, 도시 절수, 펄스 방류를 선택하고 이송은 하지 않습니다. 부족 시에는 같은 비율로 줄입니다. 대책비는 35억 원입니다.</p>
      <p><b>얻는 것과 잃는 것:</b> 평년 도시 공급률 100.0%, 농가 소득 지수 0.898, 하구 유량 5.099m³/s를 얻지만, 기말 비축은 84.00백만 m³로 공사 기준을 채우지 못합니다. 도시가 100% 공급되어도 절수 캠페인의 생활 부담은 남습니다.</p>
      <p><b>약점:</b> 미래 사용자는 현재 협상에서 자신의 위험을 직접 말하기 어렵습니다. 건조 기말 저수량 44.00은 게임의 사수위보다 조금 높을 뿐 장기 가뭄에 충분하다는 뜻이 아닙니다. 모형 DO 5.973mg/L도 실제 생태 안전을 보장하지 않습니다.</p>
      <p><b>상정:</b> 자동 반응에서는 공사의 조건부 의견을 남긴 다수 합의안을 선택합니다. 미래 비용의 부담과 다음 계절의 대응을 별도로 설명해야 합니다.</p>
    </details>
    <details class="reveal" id="rd-example-eco">
      <summary>가상의 답 2 · 되돌리기 어려운 피해 우선</summary>
      <p><b>기준과 무게:</b> 산란기 생물과 하구 생태계의 회복이 어려울 수 있는 피해를 가장 무겁게, 생활용수를 그다음으로 두고, 올해 생산과 미래 비축의 감소를 감수했습니다.</p>
      <p><b>선택:</b> 농업 37, 도시 31, 하천유지 28백만 m³를 배분합니다. 휴경 30%, 도시 절수를 선택합니다. 이송·펄스는 쓰지 않고 부족 시 비례 감량합니다. 대책비는 50억 원입니다.</p>
      <p><b>얻는 것과 잃는 것:</b> 평년 하구 유량 5.986m³/s와 모형 DO 6.604mg/L를 확보하지만, 농가 소득 지수는 0.847로 기준을 조금 밑돌고 공사의 비축 기준도 채우지 못합니다. 도시 공급률은 95.7%, 기말 비축은 83.00백만 m³입니다.</p>
      <p><b>약점:</b> 피해 회복의 어려움만으로 농가의 현재 생계를 가볍게 다룰 수 없습니다. 하구의 실제 종과 노출 시간을 조사하지 않았고, 게임의 평균 DO만으로 산란 성공이나 갯벌 회복을 보장하지 못합니다. 유역 밖 납세자의 50억 원 부담에도 설명이 필요합니다.</p>
      <p><b>상정:</b> 자동 반응에서는 도시와 하구만 수용하므로 결렬 후 행정 결정 요청을 선택합니다. 생태를 우선했다는 이유로 절차의 동의를 대신할 수 없습니다.</p>
    </details>
    <details class="reveal" id="rd-example-future">
      <summary>가상의 답 3 · 미래 비축 우선</summary>
      <p><b>기준과 무게:</b> 다음 계절의 물 사용 가능성을 가장 무겁게, 현재 손실의 분담을 그다음으로 두었습니다. 현재 소득과 공급의 감소는 인정했습니다.</p>
      <p><b>선택:</b> 기본안의 농업 50·도시 35·하천 20을 모두 60%로 줄여 농업 30, 도시 21, 하천유지 12백만 m³로 정했습니다. 돈이 드는 조항과 펄스는 쓰지 않고, 더 부족해질 때 농업→도시→하천 순서로 감량하도록 적었습니다.</p>
      <p><b>얻는 것과 잃는 것:</b> 평년 기말 저수량 116.00백만 m³를 남기지만, 농가 소득 지수는 0.455, 도시 공급률은 58.3%, 하구 유량은 3.318m³/s로 세 곳 모두 기준을 충족하지 못합니다. 같은 비율로 줄여도 피해가 같은 비율이 되는 것은 아닙니다.</p>
      <p><b>약점:</b> 농민과 도시는 거부, 하구는 조건부이고 공사만 수용합니다. 농업을 추가 감량의 맨 앞에 둔 까닭도 별도로 정당화해야 합니다. 주어진 건조 전망의 비축은 76.00백만 m³여서 실제 감량은 발생하지 않습니다. 감량 조항을 넣었다고 이 사례에서 위험을 줄인 효과가 계산된 것은 아닙니다.</p>
      <p><b>상정:</b> 결렬 후 행정 결정 요청을 선택합니다. 미래를 말하는 쪽도 지금 손실을 지는 사람의 목소리를 대신하지 못합니다.</p>
    </details>
    <details class="reveal" id="rd-example-farm">
      <summary>가상의 답 4 · 올해 농가 생계 우선</summary>
      <p><b>기준과 무게:</b> 생육기에 물이 끊기면 되돌리기 어려운 올해 농가 생계를 가장 무겁게, 생활용수와 하구 조건을 그다음으로 두고, 다음 계절 비축과 유역 밖 비용을 감수했습니다.</p>
      <p><b>선택:</b> 농업 55, 도시 33, 하천유지 12백만 m³를 배분합니다. 휴경 없이 도시 절수와 이웃 댐 연계 이송을 선택하고 펄스는 쓰지 않습니다. 부족 시에는 도시→하천→농업 순서로 줄여 농업을 맨 뒤에 둡니다. 대책비는 30억 원입니다.</p>
      <p><b>얻는 것과 잃는 것:</b> 평년 농가 소득 지수 1.000, 도시 공급률 100.0%, 하구 유량 4.585m³/s, 모형 DO 5.299mg/L를 얻지만, 기말 비축은 89.00백만 m³로 공사 기준을 채우지 못합니다. 건조 전망의 기말 저수량은 49.00백만 m³입니다.</p>
      <p><b>약점:</b> 비축 부족을 이웃 댐의 물 10백만 m³와 대책비 25억 원으로 메웠습니다. 그 유역의 피해와 이송 전력은 계산하지 않았으므로 부담이 사라진 것이 아니라 테이블 밖으로 옮겨 갔을 수 있습니다. 더 심한 가뭄이 오면 생활용수부터 줄이도록 적었으니 절수가 어려운 시민에게 먼저 부담이 갑니다. 모형 DO도 기준 5mg/L에 가깝습니다.</p>
      <p><b>상정:</b> 자동 반응에서는 공사만 조건부이므로 다수 합의안을 선택합니다. 습윤 전망에서는 네 곳이 모두 수용하지만, 비가 많이 오기를 기대는 근거로 쓰지 않습니다.</p>
    </details>
  </div>
  <details class="reveal" id="rd-science-water">
    <summary>과학 해설 · 물 수지와 발전</summary>
    <p>저수지에 남는 물은 처음의 물에 들어온 물을 더하고 증발과 실제 방류를 뺀 양입니다. 감량하기 전의 계획과 감량한 뒤의 결과를 구분해야 합니다. 백만 m³는 부피이고 m³/s는 단위 시간당 흐르는 양입니다. 90일 총량 1백만 m³는 평균 약 0.1286m³/s입니다.</p>
    <p>수력 발전의 근거는 위치 에너지 mgh입니다. m=ρV를 넣고 발전 효율을 곱해 전기에너지로 바꿉니다. 같은 물이 발전기를 통과한 뒤 농업·도시·하천에 공급될 수 있으므로 발전용 물을 다시 소비량으로 더하지 않습니다. 낙차는 단순히 저수량과 같지 않습니다. 이 게임의 선형 낙차식과 효율 0.85는 실제 댐 설계값이 아닙니다.</p>
  </details>
  <details class="reveal" id="rd-science-oxygen">
    <summary>과학 해설 · 회귀수, 희석과 산소</summary>
    <p>농업·도시에서 사용한 물의 일부가 하천으로 돌아오면 하류의 물 수지와 희석 조건에 영향을 줍니다. 같은 부하에 통과 부피가 커지면 이 모형의 C는 작아집니다. 농업 배분을 바꾸면 회귀수뿐 아니라 부하 L도 바뀌므로 물이 늘면 언제나 수질이 좋아진다고 단정할 수 없습니다.</p>
    <p>같은 기압과 염분 조건에서 따뜻한 물은 차가운 물보다 산소 포화 농도가 낮습니다. 실제 DO는 포화값과 같지 않을 수 있습니다. 광합성·호흡·분해·재폭기 등이 실제 DO를 바꿉니다. 질산염·인산염 같은 영양염은 그 자체로 산소를 소비하지 않지만, 조류 증식과 사체의 분해를 거쳐 산소 부족으로 이어질 수 있습니다. 암모늄은 미생물이 질산염으로 바꾸는 과정에서 산소를 소비합니다.</p>
    <p>포화값은 실제 담수 물성의 반올림값입니다. 유량에서 수온을 정하는 식과 산소를 빼는 식은 이 게임이 만든 식입니다. DO는 mg/L 단위로 보이지만 실제 수질 예측이 아닙니다. 5mg/L는 종·수온·노출 시간에 따라 다르며 이 게임이 정한 기준입니다.</p>
  </details>
  <details class="reveal" id="rd-science-crop">
    <summary>과학 해설 · 작물과 물 부족</summary>
    <p>작물의 물 부족 반응은 작물 종류와 생육 단계에 따라 다릅니다. 이 게임은 필요량 대비 공급량으로 수확 지수를 정하고 감수 계수 1.2를 썼습니다. 이 식은 FAO 관개·배수 보고서 33호(Doorenbos·Kassam, 1979)의 수확 반응 계수 Ky 관계, 곧 1−실제 수확/최대 수확 = Ky×(1−실제 증발산/최대 증발산)를 빌린 것입니다. 원래 식은 공급량이 아니라 증발산 부족에 대해 정의되었고, 대체로 증발산 부족이 50% 정도까지일 때만 직선으로 근사됩니다. 이 게임은 공급량을 증발산 대신 쓰고, 공급이 약 83% 부족할 때 수확 0이 되도록 직선을 끝까지 늘였으므로 실제 수확 예측값이 아닙니다. Y는 경작한 면적의 수확 지수이며, 전체 농가 소득에는 휴경 면적과 보상도 함께 들어갑니다. 소득 지수 0.85를 모든 농가의 실제 소득이 똑같이 15% 줄었다는 통계로 읽지 않습니다.</p>
  </details>
  <details class="reveal" id="rd-model-limits">
    <summary>모형이 단순화한 것과 빠진 것</summary>
    <p>하천의 거리와 시간에 따른 재폭기·유기물 분해를 계산하지 않고 한 담수 지점의 값으로 비교했습니다. 희석은 나타나지만 하천의 자정 과정을 재현하지 못합니다. 재폭기는 대기에서 산소가 다시 녹아드는 과정이고 분해는 산소를 소비할 수 있으므로 둘을 넣었을 때의 순효과는 조건에 따라 달라집니다.</p>
    <p>댐 아래 지류와 강우 유출, 비가 작물의 물 요구를 줄이는 효과를 0으로 두었습니다. 실제로 비가 많이 오면 하류 유량과 희석 조건도 달라집니다. 지하수와의 교환, 강우 유출의 시간 변화, 염분 침입, 작물 생육 단계별 물 요구, 펄스의 실제 시기와 지속시간, 발전 설비 용량, 이송 전력과 이웃 유역의 비용을 뺐습니다. 갯벌 피해는 문제의 맥락에 있지만 이 담수 DO 식으로 갯벌의 상태를 계산하지 않습니다. 하굿둑이 없는 열린 하구에서는 염분 침입이 가뭄의 큰 영향일 수 있습니다. 강물이 줄면 바닷물이 상류로 올라와 기수역이 위로 옮겨 가고 산란장과 어린 물고기의 서식지가 줄어들 수 있으며, 강물이 늘면 반대로 기수역이 바다 쪽으로 밀려납니다. 이 게임의 하구 유량과 DO만으로는 이 변화를 읽을 수 없습니다.</p>
    <p>농업 회귀수 25%, 도시 회귀수 30%, 산소 소모 계수 2.0과 감수 계수 1.2는 게임의 값입니다. 특히 회귀수와 산소 소모 계수는 협상 결과를 크게 좌우합니다. 계수를 바꾸려면 모든 합의 가능성을 다시 확인해야 합니다.</p>
    <p>부족 시 감량 순서는 게임이 강제하지 않는 선택지입니다. 실제 우리나라 다목적댐은 정부의 댐 용수공급 조정기준에 따라 가뭄 단계가 관심→주의→경계→심각으로 오를 때 하천유지용수(주의), 농업용수(경계), 생활·공업용수(심각) 순으로 감량을 넓힙니다. 게임의 하천→농업→도시 순서에 해당합니다. 생활용수 공급을 우선하는 가치 판단과, 하천유지용수를 먼저 줄이는 생태 비용을 함께 살펴야 합니다. 법에서도 하천의 흐름을 지키는 몫은 하천법의 하천유지유량과 물환경보전법의 환경생태유량처럼 다른 이름과 목적으로 나뉩니다. 이 게임의 하천유지 배분은 둘 가운데 어느 법정 값도 아닙니다.</p>
    <p>자동 반응은 고정 수치 기준과 두 제출 연속 거절 뒤 다음 제출의 한 단계 상승으로 만들어졌습니다. 실제 협상의 신뢰·관계·정치적 힘과 집단 내부의 차이를 담지 못합니다. 연속 거절이 실제 사람의 기준을 반드시 올린다는 뜻은 아닙니다. 역할극에서 수치와 다르게 동의한 이유도 검토할 자료입니다.</p>
    <p>이 게임은 허용한 입력 범위에서 평년의 모형 만장일치가 불가능하도록 수치를 정했습니다. 각 당사자만 빠지는 3자 합의안은 모두 있고 습윤에서는 모형 만장일치가 가능합니다. 기준이 오른 조합에서도 이 성질을 전수 탐색했습니다. 기준 상승이 없을 때 평년 3자 합의안 11,602,477개 가운데 공사(미래 비축)만 빠지는 안이 94.2%이고, 농민만 빠지는 안은 5.0%, 도시만 빠지는 안은 0.7%, 하구만 빠지는 안은 0.003%입니다. 이 쏠림은 이 게임의 계수가 만든 것입니다. 가능한 안이 많다는 사실이 그 선택을 더 정당하게 만들지는 않으며, 직접 반대할 수 없는 미래 사용자에게 손실을 넘기기 가장 쉬운 구조라는 뜻일 수 있습니다. 현실의 물 협상이 언제나 결렬된다는 결론도 아닙니다.</p>
  </details>
</section>`;
  KCP.games[id] = {
    brief: () => BRIEF, renderPrep, questions, recap,
    reflectExtra: state => lockedFrom(state) ? REFLECTION : '<p class="rd-notice">준비실에서 상정안을 확정한 뒤 성찰 자료를 열어 보세요.</p>',
    model: {
      K, EPS, doSat, simulate: (p, inflow = 55) => simulate(planOK(p) ? p : repairPlan(p), [15, 55, 100].includes(inflow) ? inflow : 55),
      compute: (p, mask = 0) => evaluate(planOK(p) ? p : repairPlan(p), Number.isInteger(mask) && mask >= 0 && mask <= 15 ? mask : 0),
      evaluate: (p, mask = 0) => evaluate(planOK(p) ? p : repairPlan(p), Number.isInteger(mask) && mask >= 0 && mask <= 15 ? mask : 0),
      response, checks, checkText, severe, masksFromDecisions, improves, planOK, restore, fresh, transition, validateLocked,
      questionKeys: state => questions(state).map(q => q.k)
    }
  };
})();
