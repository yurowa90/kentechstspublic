/* 독립 수용 검사: docs/ECON-TECH-SPEC.md T1–T5만 기대값으로 사용한다.
 * node tests/league/tech.js — 실제 실행은 총괄 담당.
 * 브라우저에서는 동일한 fixture/엔진 검사를 KCPTechChecks로 제공한다.
 * 새 API 이름을 추측하지 않는다: 연구 요청은 기존 plan.rq, T3는 research.
 */
(function (root) {
  "use strict";
  const IDS = ["grid", "hvdc", "scable", "sic", "bms", "tandem", "nbat", "mass",
    "h2store", "h2mix", "ccu", "smr", "fcst", "vpp", "re100"];
  const BRANCHES = ["차세대그리드", "에너지신소재", "수소에너지", "환경·기후기술", "원자핵", "에너지AI"];
  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => typeof value === "number" ? value : value?.v;
  const entries = value => Array.isArray(value) ? value.map(item =>
    typeof item === "string" ? { id: item, name: item } : item) : Object.entries(value || {})
    .map(([id, item]) => typeof item === "object" && item ? { id, ...item } : { id, name: item });
  const text = value => typeof value === "string" && value.trim().length > 0;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function harness() {
    const checks = [];
    return { checks, ok: (condition, label) => checks.push([!!condition, label]),
      test(label, fn) {
        try { this.ok(fn(), label); }
        catch (error) { this.ok(false, `${label}: ${error.message}`); }
      } };
  }
  function context() {
    const K = root.KCP || root.window?.KCP;
    if (!K?.leagueCore || !K?.buildGame || !K?.econ) throw new Error("leagueCore/buildGame/econ 필요");
    return { K, C: K.leagueCore, BG: K.buildGame, R: K.leagueCore.regionOf("south") };
  }
  function research(adopted = []) {
    return { queue: [], prog: {}, stage: {}, adopted: [...adopted], eureka: [], licensedFrom: {}, joint: {} };
  }
  function teamIds(R, all = false) {
    if (all) return R.teams.map(t => t.id);
    const first = R.must?.[0] || R.teams[0].id;
    const tie = R.ties.find(t => t.kind !== "sea" && (t.a === first || t.b === first));
    if (!tie) throw new Error("인접 도시 fixture 없음");
    return [first, tie.a === first ? tie.b : tie.a];
  }
  function fixture({ turns = 12, all = false, staff = false, rich = true } = {}) {
    const { C, BG, R } = context(), ids = teamIds(R, all);
    const S = C.newState("TECH22", R.id, 0, ids, turns ? { turns } : null);
    ids.forEach(id => {
      const reply = C.reduce(S, { type: "claim", team: id, token: token(id) }, 1, BG);
      if (!reply.ok) throw new Error(`claim 거부: ${reply.err}`);
      if (rich && S.econ) S.econ.cities[id].cash = 100000; // 예산 부족을 연구 속도와 분리
      S.teams[id].research = research();
      S.teams[id].plan = planFor(id, staff ? ["lab", "lab", "uni"] : []);
      if (staff) S.teams[id].base = C.itemCosts(BG, R, id, S.teams[id].plan);
    });
    C.host(S, "next", 2); S.events = [];
    return { S, ids };
  }
  function token(id) { return `tech-fixture-${id}`; }
  function planFor(id, types, connect = false) {
    const { BG } = context(); BG.selectPack(id, "league");
    const used = new Set(), builds = [], lines = [], anchor = BG.SITES.find(s => s.dem).tile;
    types.forEach(type => {
      const tile = BG.TILES.find(t => !t.out && t.site < 0 && !used.has(t.i) && !BG.siteRule(type, t) &&
        (!connect || BG.routePath(anchor, t.i)));
      if (!tile) throw new Error(`${type}: 유효 건설 칸 없음`);
      used.add(tile.i); builds.push({ t: type, i: tile.i });
      if (connect) lines.push({ p: BG.routePath(anchor, tile.i) });
    });
    return { builds, lines, policies: [], shed: "equal", missions: [], seed: 2026, rq: [] };
  }
  function connectCities(S, a, b) {
    const { BG } = context();
    for (const [id, other] of [[a, b], [b, a]]) {
      BG.selectPack(id, "league");
      const gate = BG.SITES.find(s => s.kind === "gridpt" && (s.to || []).includes(other));
      const path = gate && BG.routePath(BG.SITES.find(s => s.dem).tile, gate.tile);
      if (!path) throw new Error(`${id}: 상대 도시 연결 경로 없음`);
      S.teams[id].plan.lines.push({ p: path });
    }
  }
  function request(S, id, cards) {
    const { C, BG } = context(), T = S.teams[id];
    return C.reduce(S, { type: "plan", team: id, token: token(id), rev: T.rev + 1,
      plan: { ...clone(T.plan), rq: cards } }, 10 + S.round, BG);
  }
  function special(S, id, type, other, card) {
    const { C, BG } = context();
    return C.reduce(S, { type, team: id, token: token(id), other, card }, 20 + S.round, BG);
  }
  function operate(S) {
    const { C, BG } = context();
    if (S.phase === "review") C.host(S, "next", 100 + S.round);
    S.events = []; // 연구 자체의 효과를 사건 무작위성과 분리
    const result = C.run(S, BG, 200 + S.round);
    if (!result) throw new Error("운영 결과 없음");
    return result;
  }
  function cardsOf() { return entries(context().K.TECH_DATA?.cards); }
  function adopted(S, id) { return S.teams[id].research?.adopted || []; }
  function dataChecks() {
    const H = harness(), K = root.KCP || root.window?.KCP, D = K.TECH_DATA || {};
    const cards = entries(D.cards), branches = entries(D.branches), by = Object.fromEntries(cards.map(c => [c.id, c]));
    H.ok(!!K.TECH_DATA, "T3 KCP.TECH_DATA 존재");
    H.ok(cards.length === 15 && equal(cards.map(c => c.id).sort(), [...IDS].sort()), "T1 정확한 카드 15장·기존 id 유지");
    H.ok(branches.length === 6 && new Set(branches.map(b => b.id)).size === 6, "T1 갈래 6개·중복 없음");
    BRANCHES.forEach(name => H.ok(branches.some(b => (b.name || b.label || b.id).includes(name)), `T1 갈래 이름 ${name}`));
    // verify 11 / ECON-TECH §1 정정: 카드마다 서로 다른 12분야를 강제하면 오배치를 만든다.
    // 공식 목록 12개와 카드의 연구분야·융합전공 대응을 각각 검증한다.
    H.ok(Array.isArray(D.fields) && D.fields.length === 12 && new Set(D.fields).size === 12 &&
      cards.every(c => c.fieldGrade === "O" && c.mappingGrade === "G" &&
        (c.fieldCategory === "research" ? D.fields.includes(c.field) :
          c.fieldCategory === "concentration" && D.concentrations.includes(c.field))),
      "T1 공식 연구분야 12개·카드별 연구분야/융합전공 대응 등급");
    // verify 13: CO₂ 포집과 미세먼지 제한 사이의 근거 없는 인과를 카드·계수에서 제거한다.
    H.ok(!Object.hasOwn(D.params || {}, "dustDamage") && !(D.eventHints?.finedust_coal_cap?.cards || []).includes("ccu"),
      "T2 CCU에 미세먼지 출력 제한 완화 계수·안내 없음");
    IDS.forEach(id => {
      const c = by[id];
      H.ok(!!c && ["branch", "field", "name", "need", "demo", "req", "eff", "why", "grade", "sources"]
        .every(key => Object.hasOwn(c, key)), `T1 ${id} 카드 계약 필드`);
      H.ok(!!c && text(c.grade) && c.grade.split(/[·/,\s]+/).every(g => ["O", "O*", "P", "M", "G"].includes(g)), `T1 ${id} 근거 등급`);
      H.ok(!!c && Number.isFinite(number(c.need)) && number(c.need) > 0 &&
        Number.isFinite(number(c.demo)) && number(c.demo) >= 0 && Array.isArray(c.req), `T1 ${id} need·demo·req`);
      H.ok(!!c && branches.some(b => b.id === c.branch || b.name === c.branch) &&
        (Array.isArray(c.sources) ? c.sources.length > 0 : text(c.sources)), `T1 ${id} 갈래·출처 존재`);
    });
    const pairs = entries(D.pairs).map(p => Array.isArray(p) ? p : p.cards || [p.a, p.b]);
    H.ok(pairs.length === 2 && equal(pairs.map(p => [...p].sort().join("~")).sort(),
      ["ccu~h2store", "scable~smr"].sort()), "T1 배타 선택은 ccu↔h2store·smr↔scable 두 쌍");
    for (const [id, req] of [["scable", "hvdc"], ["nbat", "bms"], ["h2mix", "h2store"], ["vpp", "fcst"]]) {
      H.ok(equal(by[id]?.req, [req]), `T1 선행 ${req} → ${id}`);
    }
    H.ok(Array.isArray(by.mass?.req) && ["tandem", "nbat"].every(id => by.mass.req.includes(id)), "T1 mass 선행 후보 tandem 또는 nbat");
    H.ok(entries(D.titles).length === 6, "T2 갈래별 칭호 6개");
    H.ok(!!D.eureka && IDS.every(id => Array.isArray(D.eureka) ? D.eureka.some(e => e.id === id || e.card === id) : !!D.eureka[id]), "T2 카드마다 유레카 조건");
    H.ok(!!D.params && Object.keys(D.params).length > 0, "T3 params 존재");
    Object.entries(D.params || {}).forEach(([key, p]) => H.ok(!!p && text(p.grade) && text(p.note), `T3 params.${key} grade·note`));
    H.test("T1 리그 한 달 연구 진척 4.35주(F15, SPEC §1.3)", () => {
      // T1은 달 리그의 진척 계약이다. T5의 기존 #build 상수가 아닌 실제 월 운영을 검사한다.
      const { S, ids } = fixture(), id = ids[0], { C } = context();
      S.teams[id].plan = planFor(id, ["lab"]);
      if (!request(S, id, ["hvdc"]).ok) throw new Error("월 진척 연구 요청 거부");
      operate(S);
      return C.publicView(S, 500).teams[id].research.stepsPerTurn === 4.35 &&
        S.teams[id].research.prog.hvdc === 4.35;
    });
    return H.checks;
  }
  function paceChecks() {
    const H = harness();
    // 고정 순서 두 가지. 제일 싼 카드로 매달 교체하는 구현 내부 선택식을 복사하지 않는다.
    // 배타·선행을 지킨 순서이며 re100의 재생 비중 조건에 의존하지 않는다.
    const queues = [
      ["bms", "grid", "fcst", "hvdc", "nbat", "vpp", "tandem", "mass", "sic", "h2store", "h2mix", "scable"],
      ["fcst", "vpp", "grid", "hvdc", "scable", "bms", "nbat", "tandem", "mass", "sic", "h2store", "h2mix"]
    ];
    queues.forEach((queue, i) => H.test(`T1 인력 연구소2·대학1: 12달 5~7장 (경로${i + 1})`, () => {
      const { S, ids } = fixture({ staff: true }), id = ids[0];
      // 아직 잠긴 선행 카드를 일괄 요청하지 않고 다음 연구를 도입 후 요청한다.
      for (let m = 0; m < 12; m++) {
        if (S.phase === "review") context().C.host(S, "next", 300 + m);
        const next = queue.find(k => !adopted(S, id).includes(k));
        if (next && !request(S, id, [next]).ok) throw new Error(`${next} 연구 요청 거부`);
        operate(S);
      }
      const count = adopted(S, id).length;
      if (count < 5 || count > 7) throw new Error(`도입 ${count}장, 목표 5~7장`);
      return true;
    }));
    return H.checks;
  }
  function ruleChecks() {
    const H = harness();
    H.test("T3 새 팀 research 계약 초기화", () => {
      const { C, R } = context(), S = C.newState("TECH22", R.id, 0, teamIds(R), { turns: 12 });
      return Object.values(S.teams).every(T => T.research &&
        ["queue", "adopted", "eureka"].every(key => Array.isArray(T.research[key])) &&
        ["prog", "stage", "licensedFrom", "joint"].every(key => T.research[key] && typeof T.research[key] === "object"));
    });
    H.test("T3 연구 요청 수락·queue 반영", () => {
      const { S, ids } = fixture(), id = ids[0], r = request(S, id, ["grid"]);
      const T = S.teams[id];
      return r.ok === true && T.research?.queue.includes("grid") &&
        ["prog", "stage", "adopted", "eureka", "licensedFrom", "joint"].every(k => Object.hasOwn(T.research, k));
    });
    for (const [a, b] of [["ccu", "h2store"], ["smr", "scable"]]) {
      H.test(`T1 서버 배타 쌍 동시 대기열 거부 ${a}·${b}`, () => {
        const { S, ids } = fixture(), id = ids[0];
        if (b === "scable") S.teams[id].research = research(["hvdc"]);
        const before = clone(S.teams[id].research), r = request(S, id, [a, b]);
        return r.ok === false && equal(before, S.teams[id].research);
      });
      for (const [have, want] of [[a, b], [b, a]]) H.test(`T1 서버 배타 거부 ${have} → ${want}`, () => {
        const { S, ids } = fixture(), id = ids[0];
        S.teams[id].research = research([have, ...(want === "scable" ? ["hvdc"] : [])]);
        const before = clone(S.teams[id].research), r = request(S, id, [want]);
        return r.ok === false && equal(before, S.teams[id].research) && !(S.teams[id].plan.rq || []).includes(want);
      });
    }
    for (const [card, prereq] of [["scable", "hvdc"], ["nbat", "bms"], ["h2mix", "h2store"], ["vpp", "fcst"]]) {
      H.test(`T1 서버 선행 거부 ${card}: ${prereq} 미도입`, () => {
        const { S, ids } = fixture(), id = ids[0], before = clone(S.teams[id].research);
        // 연구 중인 선행 카드는 아직 도입한 것이 아니다.
        S.teams[id].research.prog[prereq] = 1;
        before.prog[prereq] = 1;
        const r = request(S, id, [card]);
        return r.ok === false && equal(before, S.teams[id].research);
      });
      H.test(`T1 서버 선행 수락 ${prereq} 도입 → ${card}`, () => {
        const { S, ids } = fixture(), id = ids[0]; S.teams[id].research = research([prereq]);
        return request(S, id, [card]).ok === true && S.teams[id].research.queue.includes(card);
      });
    }
    for (const prior of [[], ["tandem"], ["nbat"]]) H.test(`T1 mass OR 선행 [${prior}]`, () => {
      const { S, ids } = fixture(), id = ids[0]; S.teams[id].research = research(prior);
      return request(S, id, ["mass"]).ok === (prior.length > 0);
    });
    H.test("T5 서버 예산 초과 연구 요청 거부", () => {
      const { S, ids } = fixture(), id = ids[0], city = S.econ.cities[id];
      city.cash = -city.debtCap - 1;
      const before = clone(S.teams[id].research), r = request(S, id, ["smr"]);
      return r.ok === false && equal(before, S.teams[id].research);
    });
    H.test("T2 칭호 유무에 따라 총점·부분점수·순위 불변", () => {
      const { K, C } = context(), { S, ids } = fixture(), id = ids[0];
      S.teams[id].research = research(["grid", "hvdc", "scable"]);
      const before = K.econ.score(S.econ);
      S.teams[id].titles = ["그리드 개척자"];
      S.teams[id].research.titles = ["그리드 개척자"];
      S.econ.cities[id].titles = ["그리드 개척자"];
      return equal(before, K.econ.score(S.econ)) && equal(before, C.publicView(S, 500).econ.score);
    });
    H.test("T2 유레카: 남은 need의 1/3·카드당 한 번", () => {
      const { S, ids } = fixture({ turns: 36 }), id = ids[0], card = cardsOf().find(c => c.id === "tandem");
      if (!card) throw new Error("tandem 카드 없음");
      const need = number(card.need), initial = need / 4;
      // T2는 태양광 10기 '운영' 조건이다. 배선과 ESS 접속 여유를 갖추고 접속 완료까지 운영한다.
      S.teams[id].plan = planFor(id, [...Array(10).fill("solar"), ...Array(4).fill("battery")], true);
      const { C, BG, R } = context();
      while (C.gridStatus(S, R, BG, id).waitingMW > 0 && S.round < 30) operate(S);
      if (C.gridStatus(S, R, BG, id).waitingMW > 0) throw new Error("태양광 10기 접속 미완료");
      if (S.phase === "review") C.host(S, "next", 400);
      S.teams[id].research.prog.tandem = initial;
      if (!request(S, id, ["tandem"]).ok) throw new Error("tandem 연구 거부");
      // T2 '조건을 채운 달에 ... 즉시 진척': 인력 0으로 정규 진척과 분리하며 조건을 생략하지 않는다.
      const control = clone(S), disconnected = clone(S);
      control.teams[id].plan.builds.splice(control.teams[id].plan.builds.findIndex(b => b.t === "solar"), 1);
      disconnected.teams[id].plan.lines = [];
      operate(control); operate(disconnected); const result = operate(S);
      const rs = S.teams[id].research, expected = initial + (need - initial) / 3;
      const once = rs.prog.tandem;
      const first = result.team[id].renPct > 0 && Math.abs(once - expected) < 1e-6 &&
        rs.eureka.includes("tandem") && [control, disconnected].every(state =>
          Math.abs(state.teams[id].research.prog.tandem - initial) < 1e-6 &&
          !state.teams[id].research.eureka.includes("tandem"));
      operate(S);
      return first && S.teams[id].research.prog.tandem === once &&
        S.teams[id].research.eureka.filter(k => k === "tandem").length === 1;
    });
    H.test("T3 공개 상태: 도입·진행 연구·진척·칭호", () => {
      const { S, ids } = fixture(), id = ids[0];
      S.teams[id].research = research(["grid", "hvdc", "scable"]);
      if (!request(S, id, ["sic"]).ok) throw new Error("공개 상태 연구 요청 거부");
      S.teams[id].research.prog.sic = 1;
      // T3 진척은 %로, T2 칭호는 자료의 id로 공개한다(ECON-SPEC §13.1 필드 계약).
      const { K, C } = context(), view = C.publicView(S, 500);
      const title = entries(K.TECH_DATA.titles).find(t => t.name === "그리드 개척자");
      const need = number(cardsOf().find(c => c.id === "sic").need);
      return !!title && [view.teams[id].research, view.econ.cities[id].research].every(rs =>
        rs?.adopted.includes("hvdc") && rs.queue.includes("sic") && rs.current === "sic" &&
        rs.prog.sic === 1 && Math.abs(rs.progress.sic - 100 / need) < 1e-6 && rs.titles.includes(title.id));
    });
    return H.checks;
  }
  function royaltyChecks() {
    const H = harness();
    function differential(S, donor, buyers) {
      const control = clone(S);
      buyers.forEach(id => { control.teams[id].research.licensedFrom = {}; });
      operate(control); operate(S);
      const gain = S.econ.cities[donor].cash - control.econ.cities[donor].cash;
      const paid = buyers.reduce((total, id) => total + control.econ.cities[id].cash - S.econ.cities[id].cash, 0);
      const demoDelta = buyers.reduce((total, id) => total + (S.teams[id].rfix || 0) - (control.teams[id].rfix || 0), 0);
      return { gain, paid, demoDelta };
    }
    H.test("H-E #3 진척 없는 이전 연구는 7달 내내 사용료 없음", () => {
      const { S, ids } = fixture(), [donor, buyer] = ids;
      S.teams[donor].research = research(["grid"]);
      if (!special(S, buyer, "license", donor, "grid").ok) throw new Error("license 요청 거부");
      if (!S.teams[buyer].research.licensedFrom.grid) throw new Error("licensedFrom.grid 없음");
      for (let m = 0; m < 7; m++) {
        const { gain, paid } = differential(S, donor, [buyer]), expected = 0;
        if (Math.abs(gain - expected) > 0.011 || Math.abs(paid - expected) > 0.011)
          throw new Error(`${m + 1}달 개발도시 +${gain}, 수입도시 -${paid}, 목표 ${expected}`);
      }
      return true;
    });
    H.test("H-E #3 진척하는 이전 연구만 최대 6회·쌍방 현금 정산", () => {
      const { S, ids } = fixture(), [donor, buyer] = ids;
      S.teams[buyer].plan = planFor(buyer, ["lab"]);
      S.teams[donor].research = research(["smr"]);
      if (!special(S, buyer, "license", donor, "smr").ok) throw new Error("license 요청 거부");
      S.teams[buyer].research.eureka = ["smr"];
      for (let m = 0; m < 7; m++) {
        const before = S.teams[buyer].research.prog.smr || 0;
        const { gain, paid, demoDelta } = differential(S, donor, [buyer]), expected = m < 6 ? 0.5 : 0;
        if (Math.abs(gain - expected) > 1e-8 || Math.abs(paid - expected - demoDelta) > 1e-8 ||
            (m < 5 && !(S.teams[buyer].research.prog.smr > before))) throw new Error(`${m + 1}달 진척·사용료 상한 불일치`);
      }
      return S.teams[buyer].research.royaltyMonths.smr === 6;
    });
    H.test("T2 이전 연구 need 50%: 절반 직전 미완료·절반에서 실증", () => {
      const { S: A, ids: pair } = fixture(), [origin, target] = pair;
      A.teams[target].plan = planFor(target, ["lab"]);
      A.teams[origin].research = research(["hvdc"]);
      if (!special(A, target, "license", origin, "hvdc").ok) throw new Error("절반 비용 fixture license 거부");
      const need = number(cardsOf().find(c => c.id === "hvdc").need);
      // T1 월 4주 × 연구소 인력 1. #build의 RS를 변조하지 않고 T2 절반 경계 양쪽을 비교한다.
      const step = 4.35, epsilon = need / 1000, B = clone(A), normal = clone(A);
      A.teams[target].research.prog.hvdc = need / 2 - step - epsilon;
      B.teams[target].research.prog.hvdc = normal.teams[target].research.prog.hvdc = need / 2 - step;
      normal.teams[target].research.licensedFrom = {};
      operate(A); operate(B); operate(normal);
      const before = A.teams[target].research, at = B.teams[target].research, full = normal.teams[target].research;
      if (["demo", "done"].includes(before.stage.hvdc) || adopted(A, target).includes("hvdc"))
        throw new Error("need 절반 직전에 완료");
      return Math.abs(before.prog.hvdc - (need / 2 - epsilon)) < 1e-6 &&
        at.prog.hvdc === need / 2 && at.stage.hvdc === "demo" &&
        full.prog.hvdc === need / 2 && !full.stage.hvdc && !adopted(normal, target).includes("hvdc");
    });
    H.test("T2 사용료 수입 도시당 월 3억 상한·수입 양수", () => {
      const { S, ids } = fixture({ all: true, staff: true }), donor = ids[0], buyers = ids.slice(1);
      const roots = ["grid", "bms", "fcst", "sic"];
      S.teams[donor].research = research(roots);
      buyers.forEach(id => roots.forEach(card => {
        if (!special(S, id, "license", donor, card).ok) throw new Error(`${id}/${card} license 거부`);
      }));
      const { gain, paid } = differential(S, donor, buyers);
      return Math.abs(gain - buyers.length * 0.5) < 1e-8 && gain <= 3 && Math.abs(paid - gain) < 1e-8;
    });
    H.test("T2 미도입 도시에서 기술 이전 거부", () => {
      const { S, ids } = fixture(), [donor, buyer] = ids, before = clone(S.teams[buyer].research);
      return special(S, buyer, "license", donor, "grid").ok === false && equal(before, S.teams[buyer].research);
    });
    for (const type of ["license", "joint"]) {
      H.test(`T3 ${type} 요청으로 배타·선행 우회 불가`, () => {
        const { S, ids } = fixture(), [donor, buyer] = ids, { C, R } = context();
        S.ties = [{ ...C.tieDef(R, donor, buyer), cap: 4, st: "built" }];
        // T3 선행·배타 거부를 검사하므로 T2 연결 조건부터 충족한다.
        if (type === "joint") connectCities(S, donor, buyer);
        S.teams[donor].research = research(type === "license" ? ["ccu", "hvdc", "scable"] : []);
        S.teams[buyer].research = research(["h2store"]);
        const before = clone(S.teams[buyer].research);
        return special(S, buyer, type, donor, "ccu").ok === false &&
          special(S, buyer, type, donor, "scable").ok === false && equal(before, S.teams[buyer].research);
      });
    }
    H.test("T2 공동 연구: 연결 필요·합산 진척·양쪽 도입", () => {
      const { S, ids } = fixture(), [a, b] = ids, { C, R } = context();
      [a, b].forEach(id => { S.teams[id].plan = planFor(id, ["lab"]); });
      // T2는 연결된 두 도시의 공동 연구다. 내부망과 양방향 요청을 갖춘다(ECON-SPEC §13).
      // HVDC는 연결 한 개로 유레카가 나지 않고 need가 커서 단독/합산 진척을 구별할 수 있다.
      if (special(S, a, "joint", b, "hvdc").ok !== false) throw new Error("연계선 없이 공동 연구 수락");
      const tie = C.tieDef(R, a, b); S.ties = [{ ...tie, cap: 4, st: "built" }];
      if (special(S, a, "joint", b, "hvdc").ok !== false) throw new Error("내부망 없이 공동 연구 수락");
      connectCities(S, a, b);
      if (!request(S, a, ["hvdc"]).ok || !request(S, b, ["hvdc"]).ok ||
          !special(S, a, "joint", b, "hvdc").ok) throw new Error("연결된 공동 연구 요청 거부");
      if (S.teams[a].research.joint.hvdc.active) throw new Error("상대 동의 전에 공동 연구 활성");
      if (!special(S, b, "joint", a, "hvdc").ok) throw new Error("상대 공동 연구 요청 거부");
      if (![a, b].every(id => S.teams[id].research.joint.hvdc.active)) throw new Error("공동 연구 미활성");
      const solo = clone(S);
      [a, b].forEach(id => { solo.teams[id].research.joint = {}; });
      const cut = clone(S); cut.teams[b].plan.lines = []; operate(cut);
      if (![a, b].every(id => (cut.teams[id].research.prog.hvdc || 0) === 0))
        throw new Error("내부망 단절 뒤 공동 연구 진척");
      const step = 4.35; // T1: 각 도시 연구소 인력 1 × 월 4주
      operate(solo); operate(S);
      for (const id of [a, b]) {
        const jointProgress = S.teams[id].research.prog.hvdc, soloProgress = solo.teams[id].research.prog.hvdc;
        if (soloProgress !== step || jointProgress !== soloProgress + step)
          throw new Error(`공동 ${jointProgress}, 단독 ${soloProgress}, 합산 인력 진척 ${step}`);
      }
      for (let m = 0; m < 3; m++) operate(S);
      return [a, b].every(id => C.publicView(S, 500).teams[id].research.adopted.includes("hvdc"));
    });
    return H.checks;
  }
  root.KCPTechChecks = { harness, clone, number, entries, context, research, fixture,
    request, special, operate, planFor, token, cardsOf, adopted, dataChecks, paceChecks, ruleChecks, royaltyChecks };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = root.KCPTechChecks;
    if (require.main !== module) return;
    const path = require("node:path"), H = harness();
    global.window = { KCP: { route() {}, on() {}, esc: s => String(s) } };
    global.document = { documentElement: {} };
    root.KCP = global.window.KCP;
    for (const file of ["build-maps.js", "tech-data.js", "build.js", "econ-data.js", "econ.js", "league-data.js", "league-core.js"]) {
      H.test(`로드 ui/${file}`, () => { require(path.resolve(__dirname, "../../ui", file)); return true; });
    }
    for (const [label, suite] of [["자료", dataChecks], ["연구 속도", paceChecks],
      ["서버 규칙", ruleChecks], ["사용료·공동 연구", royaltyChecks]]) {
      try { H.checks.push(...suite()); }
      catch (error) { H.ok(false, `${label}: ${error.message}`); }
    }
    H.checks.forEach(([pass, label]) => { if (!pass) console.log(`FAIL ${label}`); });
    const failed = H.checks.filter(([pass]) => !pass).length;
    console.log(`checks ${H.checks.length} fail ${failed}`);
    process.exitCode = failed ? 1 : 0;
  }
})(globalThis);
