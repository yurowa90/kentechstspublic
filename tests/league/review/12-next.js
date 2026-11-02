"use strict";
// 독립 수용 검사: ECON-NEXT §0·§1, D-61·D-62. 구현의 계수·기대 출력을 복사하지 않는다.
// 지도·설비 자료는 유효한 실제 배치를 만드는 데만 사용한다. 6달·2점은 D-62 계약이다.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "../../.."), clone = x => JSON.parse(JSON.stringify(x));
function load(tech = true) {
  const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw new Error("씨앗 없는 난수"); };', ctx);
  for (const name of ["build-maps", ...(tech ? ["tech-data"] : []), "build", "econ-data", "econ", "league-data", "league-core"])
    vm.runInContext(fs.readFileSync(path.join(ROOT, `ui/${name}.js`), "utf8"), ctx, { filename: name });
  return ctx.KCP;
}
const K = load(), { leagueCore: C, buildGame: B, econ: X, ECON_DATA: D } = K;
const R = C.regionOf("south"), ids = R.teams.map(t => t.id), focal = "anseong";
let passes = 0, fails = 0;
const ok = (value, msg) => { if (value) passes++; else { fails++; console.log("FAIL:", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg);
const near = (a, b, msg, tol = 0.01) => ok(Number.isFinite(a) && Math.abs(a - b) <= tol, `${msg}: ${a} / ${b}`);
const test = (label, fn) => { try { fn(); } catch (e) { ok(false, `${label}: ${e.stack}`); } };
function game() {
  const S = C.newState("next-independent", R.id, 0, ids, { turns: 12 });
  S.round = 1; S.phase = "plan"; S.events = [];
  ids.forEach(id => { S.teams[id].token = "next-fixture"; });
  return S;
}
function select(id) { B.selectPack(C.teamDef(R, id).pack, "league"); }
function plan(id, types, connected = true) {
  select(id); const p = { builds: [], lines: [], policies: [], seed: 2026 }, used = new Set();
  const anchor = B.SITES.find(s => s.dem).tile;
  for (const t of types) {
    const q = B.TILES.find(q => !used.has(q.i) && !B.siteRule(t, q) && (!connected || B.routePath(anchor, q.i)));
    if (!q) throw Error(`유효 칸 없음: ${id}/${t}`);
    used.add(q.i); p.builds.push({ t, i: q.i });
    if (connected) p.lines.push({ p: B.routePath(anchor, q.i) });
  }
  return B.sanitize(p, 1e9);
}
function run(S, round = S.round) { S.round = round; S.phase = "plan"; return C.run(S, B, round); }
function input(E, changes = {}) {
  return Object.fromEntries(E.order.map(id => {
    const demMWh = E.cities[id].pop / 1e5 * 750;
    return [id, { energy: { unsPct: 0, hospH: 0, costPerMWh: 0.012, co2Local: demMWh * 0.1,
      co2: demMWh * 0.15, renPct: 30, opex: demMWh * 0.012, demMWh, servedMWh: demMWh,
      spareMW: 10, ...(changes[id]?.energy || {}) }, policy: changes[id]?.policy || {} }];
  }));
}
function econBase() { const E = X.initCities(ids, D, { seed: "next-causes", months: 12 }); return X.calibrate(E, input(E), D); }

test("시험 운전은 사건을 제외하고 당월 접속을 한 번 예약", () => {
  const S = game(), id = focal; S.teams[id].plan = plan(id, ["solar", "solar", "solar", "battery"]);
  S.econ.cities[id].pop *= 1.1; S.econ.intl.cur.fuelMul = 1.2;
  S.teams[id].research = { queue: [], prog: {}, stage: {}, adopted: ["sic", "bms"], eureka: [], licensedFrom: {}, joint: {} };
  S.events = [{ id: "heatwave_peak", round: 1, x: 0.5 }];
  const before = JSON.stringify(S), mods = C.trialMods(S, R, id);
  eq(S, JSON.parse(before), "trialMods는 계획·grid·사건·연구·경제 입력을 보존");
  S.events[0].x = 1.5;
  eq(C.trialMods(S, R, id), mods, "ev.x 두 값에서 시험 보정 동일");
  S.events = [{ id: "monsoon_cloud", round: 1, x: 1.4 }];
  eq(C.trialMods(S, R, id), mods, "사건 종류를 바꿔도 시험 보정 동일");
  const staged = clone(S); staged.events = []; C.refreshGrid(staged, B, true);
  eq(mods, C.modsFor(staged, R, id), "시험 보정은 사건 없는 실제 당월 운영 보정과 동일");
  ok(mods.reCap && mods.essCap != null && mods.curtailP != null && mods.demandRes > 1 && mods.fuelMul && mods.tech.includes("sic"), "접속·ESS·출력제어·수요·연료·도입 기술 포함");
  select(id); const st = clone(S.teams[id].plan); st.season = C.roundsOf(S)[0].season; st.seed = 7013;
  const a = B.simulate(clone(st), 7, { league: true, mods });
  S.events[0].x = 0.5;
  const b = B.simulate(clone(st), 7, { league: true, mods: C.trialMods(S, R, id) });
  eq(a, b, "ev.x 변경 전후 시험 결과 JSON 동일");
  C.refreshGrid(staged, B, true); const allocated = clone(staged.grid[id]);
  C.trialMods(staged, R, id); C.trialMods(staged, R, id);
  eq(staged.grid[id], allocated, "한 달에 반복 시험해도 접속 예약은 늘지 않음");
});

test("공개 상태의 시험 운전·초안 예약 순서·연료·건설 중 SMR", () => {
  const S = game(), id = focal;
  S.teams[id].plan = plan(id, ["solar", "solar", "solar", "solar", "battery", "smr"]);
  S.teams[id].research = { queue: [], prog: {}, stage: {}, adopted: ["sic", "bms", "smr"], eureka: [], licensedFrom: {}, joint: {} };
  const smr = S.teams[id].plan.builds.find(b => b.t === "smr"), smrKey = `smr:${smr.i}`;
  S.teams[id].construction = { [smrKey]: { startRound: 1, readyRound: 7 } };
  S.econ.cities[id].pop *= 1.1; S.econ.cities[id].ind *= 1.2; S.econ.intl.cur.fuelMul = 1.3;
  C.refreshGrid(S, B, true); S.round = 2;
  S.events = [{ id: "heatwave_peak", round: 2, x: 1.4 }];
  const V = clone(C.publicView(S, 0)), hostBefore = JSON.stringify(S), publicBefore = JSON.stringify(V);
  const hostMods = C.trialMods(S, R, id), publicMods = C.trialMods(V, R, id);
  eq(publicMods, hostMods, "공개 상태와 호스트 원 상태의 시험 보정 완전 동일");
  eq(S, JSON.parse(hostBefore), "원 상태 시험 보정 입력 보존");
  eq(V, JSON.parse(publicBefore), "공개 상태 시험 보정 입력 보존");
  ok(publicMods.fuelMul.lng === 1.3 && publicMods.demandRes === 1.1 && publicMods.demandInd === 1.2,
    "공개 국제 지수·주민·산업 수요 배수 복원");
  eq(publicMods.disabledBuilds, [smrKey], "공개 연구 상태의 건설 중 SMR 출력 금지 복원");
  ok(V.events.every(e => !Object.hasOwn(e, "x")), "공개 시험 상태에 사건 실제 크기 없음");
  ok(!Object.hasOwn(V.grid[id], "entries"), "기존 공개 grid는 요약 필드 유지");
  eq(V.teams[id].trialGrid.entries, S.grid[id].entries.map(({ key, allocatedMW }) => ({ key, allocatedMW })),
    "추가 공개 접속 이력은 기존 승인 순서·예약량을 보존");

  // 대기열 배열을 뒤집고 새 설비를 맨 앞에 넣어도 앞서 승인한 설비가 먼저 접속해야 한다.
  select(id); const draft = clone(S.teams[id].plan), used = new Set(draft.builds.map(b => b.i));
  const fresh = B.TILES.find(t => !used.has(t.i) && !B.siteRule("solar", t));
  draft.builds.reverse(); draft.builds.unshift({ t: "solar", i: fresh.i });
  const H = clone(S), P = clone(V); H.teams[id].plan = clone(draft); P.teams[id].plan = clone(draft);
  const hBefore = JSON.stringify(H), pBefore = JSON.stringify(P);
  const hm = C.trialMods(H, R, id), pm = C.trialMods(P, R, id);
  eq(pm, hm, "미승인 초안으로 계획을 대체해도 공개/호스트 시험 보정 동일");
  const keys = Object.keys(pm.reCap), oldKeys = S.grid[id].entries.map(e => e.key);
  eq(keys.slice(0, oldKeys.length), oldKeys, "초안의 배열 재정렬이 기존 접속 순서를 바꾸지 않음");
  ok(keys.at(-1) === `solar:${fresh.i}`, "새 초안 설비는 기존 예약 뒤에 배정");
  eq(H, JSON.parse(hBefore), "미승인 초안 호스트 입력 보존");
  eq(P, JSON.parse(pBefore), "미승인 초안 공개 입력 보존");
  select(id); draft.season = C.roundsOf(S)[1].season; draft.seed = 7026;
  eq(B.simulate(clone(draft), 7, { league: true, mods: hm }), B.simulate(clone(draft), 7, { league: true, mods: pm }),
    "미승인 초안 공개/호스트 시험 운전 결과 JSON 동일");

  const legacy = clone(S); delete legacy.grid;
  eq(C.trialMods(clone(C.publicView(legacy, 0)), R, id), C.trialMods(legacy, R, id),
    "접속 이력 없는 이전 저장도 공개/호스트 시험 보정 동일");
});

test("left·월 장부·배치 결과·공동성과 필드", () => {
  const S = game();
  ids.forEach(id => {
    S.teams[id].plan = plan(id, ["solar", "battery"], id !== focal);
    S.teams[id].plan.policies = ["dr"]; // 유료 운영을 넣어 총원가 누락을 실제로 검출
  });
  delete S.grid; C.refreshGrid(S, B, false); // 미연결과 접속 대기를 분리: 기존 허가 설비
  const view = C.publicView(S, 0);
  ids.forEach(id => near(view.teams[id].left, C.budget(S, id) - C.spendOf(B, S, R, id, S.teams[id].plan), `${id} 남은 돈`));
  const res = run(S), rep = res.econ;
  ids.forEach(id => {
    const t = res.team[id], l = t.ledger;
    ok(l && ["open", "income", "invest", "opex", "close"].every(k => Number.isFinite(l[k])), `${id} 장부 5필드`);
    if (l) {
      near(l.open + l.income - l.invest - l.opex, l.close, `${id} 장부 항등식`);
      near(l.close, S.econ.cities[id].cash, `${id} 기말 실제 현금`);
      const f = rep.fiscal[id], wk = C.roundsOf(S)[0].mdays / res.days;
      // NEXT §0의 수입·총지출은 총액. SPEC §5의 기존 fiscal 차익 표는 유지한다.
      // H03: 생산지 지역자원시설세도 세입이므로 장부 총수입에 더한다(차익 상계 대상 아님).
      const income = f.tariffGross + ["subsidy", "resTax", "indTax", "facility", "trade", "bonus", "salvage"].reduce((sum, k) => sum + f.rev[k], 0);
      const power = (t.cost.fuel + t.cost.policy + t.pay) * wk + t.cost.resp + t.cost.research;
      const other = ["service", "incentive", "interest", "policy"].reduce((sum, k) => sum + f.exp[k], 0);
      near(l.income, income, `${id} 장부 수입은 전기 총매출 포함`);
      near(l.opex, power + other, `${id} 장부 운영비는 전력 총원가·서비스·보조·이자·정책 비용 포함`);
    }
    ok(Number.isFinite(t.loss) && t.loss >= 0 && Number.isFinite(t.idle) && t.idle >= 0, `${id} loss·idle MWh`);
    ok(Array.isArray(t.cpList) && t.cpList.every(c => ["noise", "view", "smoke", "forest"].includes(c.kind) && Number.isFinite(c.score) && c.near != null), `${id} cpList 계약`);
    const co = rep.contrib?.[id];
    ok(co && ["exportMWh", "importMWh", "co2Cut", "tieCost"].every(k => Number.isFinite(co[k])), `${id} 기여 4필드`);
    if (co) { near(co.exportMWh, t.exp * C.roundsOf(S)[0].mdays / res.days, `${id} 수출 월 MWh`, 0.1); near(co.importMWh, t.imp * C.roundsOf(S)[0].mdays / res.days, `${id} 수입 월 MWh`, 0.1); }
  });
  ok(ids.some(id => res.team[id].ledger.opex > rep.fiscal[id].expTotal - rep.fiscal[id].exp.capex),
    "장부 총운영비는 실제로 차익에 상계된 전력 원가를 복원함");
  ok(res.team[focal].idle > 0, "미연결 실제 설비의 idle > 0");
  const region = rep.region;
  ok(region && [region.unsPct, region.co2, region.goal?.uns, region.goal?.co2].every(Number.isFinite), "지역 성과·목표 숫자");
  if (region) { ok(region.met.uns === (region.unsPct <= region.goal.uns), "지역 정전 달성 판정"); ok(region.met.co2 === (region.co2 <= region.goal.co2), "지역 CO₂ 달성 판정"); }
  ok(D.params.coopBonus?.grade === "G" && D.params.coopBonus.v > 0, "공동 보너스는 양의 G 계수");
  const score = X.score(S.econ);
  ids.forEach(id => { eq(Object.keys(score.by[id].parts).sort(), ["appr", "co2", "fin", "ind", "pop", "rel"], `${id} 점수 parts 6개 유지`); ok(Number.isFinite(score.by[id].coop), `${id} coop 별도 필드`); });
  ok(new Set(ids.map(id => score.by[id].coop)).size === 1, "모든 활성 도시가 같은 공동 보너스");
});

test("사건의 음수 지원금·양 끝 응답·없는 선 무효", () => {
  const E = econBase(), plain = X.monthStep(E, input(E), D), negative = X.monthStep(E, input(E, { [focal]: { energy: { bonus: -5 } } }), D);
  near(negative.report.fiscal[focal].eventBonus, -5, "음수 사건 지원금 보존");
  near(negative.E.cities[focal].cash - plain.E.cities[focal].cash, -5, "음수 사건 실제 현금 정산");
  const event = R.events.find(e => e.id === "line_opposition_delay");
  const ends = event.effect.tieDown.split("~"), option = event.opts.find(o => o.cancel).id;
  for (const id of ends) {
    const S = game(); S.events = [{ id: event.id, round: 1, x: 1 }]; S.econ.cities[id].cash = 10000;
    // verify 4 / ECON-SPEC §14: 대응 가능성은 실제로 존재하는 대상 선에서 검사한다.
    S.ties = [{ a: ends[0], b: ends[1], cap: 4, st: "built" }];
    near(C.bonusOf(S, R, id, 1), event.scope === `team:${id}` ? -5 : 0,
      `${id} 응답 허용 확대가 원래 사건 지원금 적용 범위를 바꾸지 않음`);
    const reply = C.reduce(S, { type: "respond", team: id, token: "next-fixture", ev: event.id, opt: option }, 1, B);
    ok(reply.ok, `${id} 지정 선 양 끝 사건 응답 허용: ${reply.err || ""}`);
  }
  const S = game(), other = R.ties.find(t => ![`${t.a}~${t.b}`, `${t.b}~${t.a}`].includes(event.effect.tieDown));
  S.ties = [{ a: other.a, b: other.b, cap: 4, st: "built" }];
  S.events = [{ id: event.id, round: 1, x: 1 }];
  const res = C.runRound(S, B);
  ok(res.tieDown === null, "이름이 지정된 선이 없으면 무작위 다른 선을 끊지 않음");
});

test("원인 key·변화 delta·why 연결 및 공급0 요금 보존", () => {
  const E = econBase(), before = JSON.stringify(E);
  const clean = X.monthStep(E, input(E), D), cut = X.monthStep(E, input(E, { [focal]: { energy: { unsPct: 100, servedMWh: 0, hospH: 24 } } }), D);
  eq(E, JSON.parse(before), "원인 계산 포함 monthStep 입력 불변");
  near(cut.E.cities[focal].lagL.price, E.cities[focal].lagL.price, "공급0은 직전 요금 점수 유지", 1e-8);
  const keys = new Set();
  for (const report of [clean.report, cut.report]) for (const id of ids) {
    const causes = report.cities[id].causes;
    ok(Array.isArray(causes) && causes.length <= 3 && causes.every(c => typeof c.key === "string" && typeof c.label === "string" && Number.isFinite(c.delta)), `${id} 원인 최대3·key/label/delta`);
    if (!causes?.length) continue;
    ok(causes.every((c, i) => i === 0 || Math.abs(causes[i - 1].delta) >= Math.abs(c.delta)), `${id} 월 변화 기여 절댓값 큰 순서`);
    const why = report.groups[id].approvalChangeCause;
    ok(why && (why.key ?? why.part) === causes[0].key, `${id} why는 첫 원인의 key`);
    causes.forEach(c => keys.add(c.key));
  }
  console.log("원인 key 표본", JSON.stringify([...keys]));
  ok(keys.has("hospital") && keys.has("outage") && keys.has("rel"), "일반 신뢰·정전 추가 감점·병원 감점을 별도 원인으로 제공");
});

test("D-62 민원별 대상·상한·절전·공유", () => {
  const E = econBase(), baseline = X.monthStep(E, input(E), D);
  const expected = { noise: ["farm", "senior"], view: ["farm", "senior"], smoke: ["senior", "youth"], forest: ["green"] };
  for (const [kind, groups] of Object.entries(expected)) {
    const changed = score => X.monthStep(E, input(E, { [focal]: { energy: { cpList: [{ kind, score, near: 0 }] } } }), D);
    const low = changed(10), high = changed(1e6), higher = changed(1e7);
    for (const g of Object.keys(D.groups)) {
      const delta = low.E.cities[focal].groups[g].sat - baseline.E.cities[focal].groups[g].sat;
      ok(groups.includes(g) ? delta < 0 : Math.abs(delta) < 1e-8, `${kind} → ${g} 대상 집단만 감점`);
      near(high.E.cities[focal].groups[g].sat, higher.E.cities[focal].groups[g].sat, `${kind}/${g} 민원 상한`, 1e-8);
    }
  }
  const saving = X.monthStep(E, input(E, { [focal]: { policy: { save: true } } }), D);
  ok(Object.keys(D.groups).every(g => saving.E.cities[focal].groups[g].sat < baseline.E.cities[focal].groups[g].sat), "절전은 모든 집단 만족에 감점");
  for (const g of Object.keys(D.groups)) {
    // F10: 악화는 즉시 반영. 원인 기여도 같은 비대칭을 쓴다.
    near(saving.report.groups[focal].contrib[g].save, -5, `${g} 절전 감점 즉시 반영`, 1e-8);
    const terms = saving.report.groups[focal].contrib[g];
    near(Object.values(terms).reduce((a, x) => a + x, 0), saving.E.cities[focal].groups[g].sat, `${g} 기여 합=만족`, 1e-8);
  }
  const noComplaint = X.monthStep(E, input(E, { [focal]: { policy: { share: true } } }), D);
  near(noComplaint.E.cities[focal].approval, baseline.E.cities[focal].approval, "민원 없는 이익공유는 무조건 만족 보너스를 주지 않음", 1e-8);
  ok(saving.report.cities[focal].causes.some(c => c.key === "save" && c.delta < 0), "절전 감점은 원인 목록에 음의 기여로 연결");
  const complaint = X.monthStep(E, input(E, { [focal]: { energy: { cpList: [{ kind: "noise", score: 100, near: 0 }] } } }), D);
  ok(complaint.report.cities[focal].causes.some(c => c.key === "complaint" && c.delta < 0), "민원은 정전·병원과 다른 key로 연결");
});

test("D-61 두 공동목표·공동보너스와 6개 부분점수 분리", () => {
  const E = econBase(), good = input(E); good.region = { goal: { uns: 0, co2: 1e9 } };
  const win = X.monthStep(E, good, D);
  eq(win.report.region.met, { uns: true, co2: true }, "두 공동목표 모두 달성");
  const noBonus = clone(win.E); noBonus.coop = 0;
  const plainScore = X.score(noBonus), score = X.score(win.E);
  for (const id of ids) {
    near(score.by[id].coop, D.params.coopBonus.v, `${id} 공동 보너스 별도 표시`);
    eq(score.by[id].parts, plainScore.by[id].parts, `${id} 공동 보너스가 여섯 부분점수를 바꾸지 않음`);
    near(score.by[id].score - plainScore.by[id].score, D.params.coopBonus.v, `${id} 총점만 공동 보너스 가산`, 0.11);
  }
  for (const miss of ["uns", "co2"]) {
    const bad = clone(good);
    if (miss === "uns") { bad[focal].energy.unsPct = 1; bad[focal].energy.servedMWh *= 0.99; }
    else bad.region.goal.co2 = 0;
    const r = X.monthStep(E, bad, D);
    ok(!r.report.region.met[miss] && ids.every(id => r.report.score.by[id].coop === 0), `${miss} 목표 하나만 미달해도 공동 보너스 없음`);
  }
});

// 마을 옆과 먼 풍력 4기를 동일한 도시에서 실제로 배치하고 모든 수요 거점을 연결한다.
// 풍력은 운전률과 무관한 소음·경관 민원이므로 매연 출력의 혼동을 피한다.
function windPlan(id, nearby, share = false) {
  select(id); const p = { builds: [], lines: [], policies: share ? ["share"] : [], seed: 2026 };
  const oneScore = q => B.complaints(B.sanitize({ builds: [{ t: "wind", i: q.i }], lines: [], policies: [] }, 1e9), null).items.reduce((s, x) => s + x.pts, 0);
  const tiles = B.TILES.filter(q => !B.siteRule("wind", q)).map(q => ({ q, score: oneScore(q) }));
  tiles.sort((a, b) => nearby ? b.score - a.score || a.q.i - b.q.i : a.score - b.score || a.q.i - b.q.i);
  p.builds = tiles.slice(0, 4).map(({ q }) => ({ t: "wind", i: q.i }));
  const anchor = B.SITES.find(s => s.dem).tile;
  for (const i of [...B.SITES.filter(s => s.dem || s.fuel).map(s => s.tile), ...p.builds.map(b => b.i)]) {
    const route = B.routePath(anchor, i); if (route?.length > 1) p.lines.push({ p: route });
  }
  return B.sanitize(p, 1e9);
}
function placementRun(nearby, share, tax = 0) {
  const S = game();
  ids.forEach(id => { S.teams[id].plan = plan(id, []); S.econ.cities[id].cash = 10000; });
  S.teams[focal].plan = windPlan(focal, nearby, share); S.teams[focal].econPol = { taxRes: tax, taxInd: tax, service: 0, incentive: 0 };
  // 기존 설비처럼 즉시 접속시켜 위치 효과를 접속 순번과 분리한다.
  delete S.grid; C.refreshGrid(S, B, false);
  let res; for (let month = 1; month <= 6; month++) res = run(S, month);
  return { approval: S.econ.cities[focal].approval, score: X.score(S.econ).by[focal].score, cp: res.team[focal].cpList, cash: S.econ.cities[focal].cash };
}
test("D-62 실제 배치 6달·공유 정책 격자", () => {
  const rows = [];
  for (const nearby of [false, true]) for (const share of [false, true]) for (const tax of [-2, 0, 2]) rows.push({ nearby, share, tax, ...placementRun(nearby, share, tax) });
  const row = (n, s, t) => rows.find(r => r.nearby === n && r.share === s && r.tax === t);
  const gap = row(false, false, 0).approval - row(true, false, 0).approval;
  ok(gap >= 2, `마을 옆/먼 실제 배치 6달 지지율 차 ≥2: ${gap}`);
  ok(row(true, false, 0).cp?.length > row(false, false, 0).cp?.length, "민원 목록은 실제 위치 차이를 반영");
  ok(row(true, true, 0).approval > row(true, false, 0).approval, "민원 있는 배치의 이익공유가 지지율 감점을 줄임");
  ok(rows.filter(r => !r.share).some(r => row(r.nearby, true, r.tax).score <= r.score), "정책 격자에서 이익공유가 항상 더 높은 점수는 아님");
  console.log("D-62 6달 실제 배치", JSON.stringify({ city: D.start[focal].name, gap,
    rows: rows.map(({ cp, ...r }) => ({ ...r, complaints: cp?.length })) }));
});

console.log(`NEXT 독립 검사: ${passes} 통과, ${fails} 실패`);
process.exitCode = fails ? 1 : 0;
