"use strict";
// 최종 검증 결함 회귀: verify 1·2·3·4·6·8·9·10·32·33, xreview 5.
// 계약 근거: 사용자 확정 결함 목록, ECON-SPEC §8·11·12.1·13·14.
// 숫자 기대는 계약의 기존 G: 정상 탄소 0.4 t/MWh, 월 연구 인력당 4주.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "../../.."), clone = x => JSON.parse(JSON.stringify(x));
const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } });
ctx.window = ctx;
vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
for (const n of ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core"])
  vm.runInContext(fs.readFileSync(path.join(ROOT, `ui/${n}.js`), "utf8"), ctx, { filename: n });
const { leagueCore: C, buildGame: B, econ: X, ECON_DATA: D } = ctx.KCP;
const R = C.regionOf("south"), ids = R.teams.map(t => t.id), [a, b] = ids;
let passes = 0, fails = 0;
const ok = (v, label) => { if (v) passes++; else { fails++; console.log("FAIL:", label); } };
const eq = (v, expected, label) => ok(JSON.stringify(v) === JSON.stringify(expected), label);
const near = (v, expected, label) => ok(Number.isFinite(v) && Math.abs(v - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${label}: ${v} / ${expected}`);
const test = (label, fn) => { try { fn(); } catch (e) { ok(false, `${label}: ${e.stack}`); } };
function game(active = ids) {
  const S = C.newState("confirmed-regression", R.id, 0, active, { turns: 12 });
  S.round = 1; S.phase = "plan"; S.events = [];
  active.forEach(id => { S.teams[id].token = "confirmed-fixture"; });
  return S;
}
function request(S, id, m) { return C.reduce(S, { team: id, token: "confirmed-fixture", ...m }, 0, B); }
function select(id) { B.selectPack(C.teamDef(R, id).pack, "league"); }
function plan(id, types = []) {
  select(id); const used = new Set(), p = { builds: [], lines: [], rq: [] };
  types.forEach(t => { const q = B.TILES.find(q => !q.out && q.site < 0 && !used.has(q.i) && !B.siteRule(t, q));
    if (!q) throw Error(`fixture ${id}/${t}`); used.add(q.i); p.builds.push({ t, i: q.i }); });
  return B.sanitize(p, 1e9);
}
function adopt(S, id, cards = []) {
  const rs = { queue: [], prog: {}, stage: {}, adopted: cards, eureka: [], licensedFrom: {}, joint: {} };
  S.teams[id].research = rs; S.teams[id].rs = rs; return rs;
}
function connect(S, left = a, right = b) {
  S.ties.push({ a: left, b: right, cap: 4, st: "built" });
  for (const [id, other] of [[left, right], [right, left]]) {
    select(id); const gate = B.SITES.find(s => s.kind === "gridpt" && s.to.includes(other));
    const p = S.teams[id].plan || plan(id);
    p.lines.push({ p: B.routePath(B.SITES.find(s => s.dem).tile, gate.tile) });
    S.teams[id].plan = B.sanitize(p, 1e9);
  }
}
function jointGame() {
  const S = game();
  ids.forEach(id => { S.econ.cities[id].cash = 10000; });
  for (const id of [a, b]) { adopt(S, id); S.teams[id].plan = plan(id, ["lab"]); }
  connect(S);
  for (const [id, other] of [[a, b], [b, a]]) {
    if (!request(S, id, { type: "joint", card: "hvdc", other }).ok) throw Error("공동 fixture 요청 거부");
  }
  return S;
}
function inputs(E, changes = {}) {
  return Object.fromEntries(E.order.map(id => [id, { energy: { unsPct: 0, hospH: 0, costPerMWh: 0.012,
    co2Local: 40, co2: 40, renPct: 0, demMWh: 100, servedMWh: 100, opex: 1.2, spareMW: 10,
    ...(changes[id] || {}) }, policy: {} }]));
}

test("verify 1: 예산 초과 계획을 조용히 자르지 않음", () => {
  const S = game(), city = S.econ.cities[a]; city.cash = -city.debtCap;
  const before = clone(S.teams[a]), next = plan(a, ["diesel"]);
  const r = request(S, a, { type: "plan", rev: S.teams[a].rev + 1, plan: next });
  ok(r.ok === false && /^budget/.test(r.err), "예산 초과 계획은 budget nack");
  eq(S.teams[a].plan, before.plan, "예산 거절 시 기존 계획 보존");
  near(S.teams[a].rev, before.rev, "예산 거절 시 계획 rev 보존");
});

test("verify 1: 계획 건설비는 맞아도 연구 예약비 부족이면 거절", () => {
  const S = game(), p = plan(a, ["lab"]); p.rq = ["hvdc"];
  const capex = C.capexOf(B, R, a, p);
  S.econ.cities[a].cash = capex - S.econ.cities[a].debtCap;
  near(C.budget(S, a), capex, "건설비만 정확히 가능한 예산 fixture");
  const before = clone(S.teams[a]);
  const r = request(S, a, { type: "plan", rev: before.rev + 1, plan: p });
  ok(r.ok === false && /^budget/.test(r.err), "실증 예약비 부족은 budget nack");
  eq(S.teams[a].plan, before.plan, "실증 예약 부족으로 설비를 자르거나 연구를 바꾸지 않음");
  near(S.teams[a].rev, before.rev, "실증 예약 거절은 계획 rev 보존");
});

test("verify 6·7: 10종 요청은 지난 턴·단계면 변경 전에 stale", () => {
  for (const type of ["plan", "econ", "crit", "ready", "tie", "research", "license", "joint", "respond", "price"]) {
    for (const stamp of [{ rd: 0, ph: "plan" }, { rd: 1, ph: "review" }]) {
      const S = game(), before = clone(S);
      const r = request(S, a, { type, ...stamp, rev: 1, plan: plan(a), queue: ["sic"], card: "sic", other: b,
        op: "propose", cap: 4, ready: true, price: 0.01, ev: "heatwave_peak", opt: "save" });
      ok(r.ok === false && r.err === "stale", `${type} ${JSON.stringify(stamp)} stale`);
      eq(S, before, `${type} stale 상태 불변`);
    }
  }
});

test("xreview 5: 연결점의 짧은 고립 전선은 실제 수요망 아님", () => {
  const S = jointGame(); select(a);
  const gate = B.SITES.find(s => s.kind === "gridpt" && s.to.includes(b));
  const full = B.routePath(B.SITES.find(s => s.dem).tile, gate.tile);
  S.teams[a].plan.lines = [{ p: full.slice(-2) }];
  const node = B.network(B.sanitize(S.teams[a].plan, 1e9)).nodes.find(n => n.kind === "import" && B.SITES[n.si].to.includes(b));
  ok(node.comp >= 0 && !node.live, "고립 연결점은 comp가 있지만 live=false인 반례");
  ok(!C.connectedTie(S, R, B, a, b), "고립 연결점은 connectedTie=false");
  adopt(S, a); adopt(S, b);
  ok(!request(S, a, { type: "joint", other: b, card: "hvdc" }).ok, "고립 연결점 공동 요청 거부");
});

test("verify 2: 공동 요청 취소 뒤 양쪽 단독 진행", () => {
  const S = jointGame();
  ok(request(S, a, { type: "joint", op: "cancel", card: "hvdc", other: b }).ok, "명시적인 공동 취소 승인");
  for (const id of [a, b]) ok(!C.researchView(S, id).joint.hvdc?.active, `${id} 취소 뒤 공동 비활성`);
  C.run(S, B, 1);
  for (const id of [a, b]) near(C.researchView(S, id).prog.hvdc, 4.35, `${id} 취소 뒤 한 연구소 단독 4주`);
});

test("verify 2: 상대 큐 이탈은 공동 해제 후 자기 카드 진행", () => {
  const S = jointGame();
  ok(request(S, b, { type: "research", queue: ["sic"] }).ok, "상대 다른 카드 선택 승인");
  C.run(S, B, 1);
  near(C.researchView(S, a).prog.hvdc, 4.35, "상대 이탈 뒤 hvdc 단독 4주");
  near(C.researchView(S, b).prog.sic, 4.35, "다른 카드 sic 단독 4주");
  ok(!C.researchView(S, a).joint.hvdc?.active, "이탈한 공동 관계 활성 해제");
});

test("verify 2: 연결 단절 공동 카드 뒤의 연구는 계속 진행", () => {
  const S = jointGame();
  ok(request(S, a, { type: "research", queue: ["hvdc", "sic"] }).ok, "공동 뒤 단독 큐 승인");
  S.teams[b].plan.lines = [];
  C.run(S, B, 1);
  near(C.researchView(S, a).prog.hvdc || 0, 0, "끊긴 공동 카드는 진척 대기");
  near(C.researchView(S, a).prog.sic, 4.35, "막힌 공동 카드 뒤 sic는 4주 진행");
});

test("verify 2: 미수락 공동 제안은 이전을 막지 않음", () => {
  const S = game(); ids.forEach(id => { S.econ.cities[id].cash = 10000; }); connect(S);
  ok(request(S, a, { type: "joint", other: b, card: "hvdc" }).ok, "미수락 공동 제안 fixture");
  adopt(S, ids[2], ["hvdc"]);
  ok(request(S, a, { type: "license", other: ids[2], card: "hvdc" }).ok, "미수락 공동 제안 뒤 license 승인");
  const active = jointGame(); adopt(active, ids[2], ["hvdc"]);
  ok(!request(active, a, { type: "license", other: ids[2], card: "hvdc" }).ok, "활성 공동 중에는 license 거부");
});

test("verify 3·9: CO₂ 기여는 실제 공급량과 소비 배출", () => {
  const E = X.initCities(ids, D, { seed: "co2-contribution", months: 12 });
  const changes = [
    { unsPct: 100, servedMWh: 0, co2: 0, co2Local: 0 },
    // D-73: .4567→.4173; 22.835→20.865, 45.67→41.73, 감축35.67→31.73. 공급·소비 반례 유지.
    { unsPct: 50, servedMWh: 50, co2: 50 * D.params.normalCo2.v, co2Local: 50 * D.params.normalCo2.v },
    { servedMWh: 100, co2: 100 * D.params.normalCo2.v, co2Local: 0, importMWh: 100 },
    { servedMWh: 100, co2: 10, co2Local: 0, importMWh: 100 }
  ];
  changes.forEach((e, i) => {
    const { report } = X.monthStep(E, inputs(E, { [a]: e }), D);
    near(report.contrib[a].co2Cut, i === 3 ? 100 * D.params.normalCo2.v - 10 : 0, `공급·소비 반례 ${i}: 미공급/계통수입 감축0·저탄소수입31.73`);
  });
});

test("verify 4: 팀 지정 사건은 대상 비활성·대상 선 없으면 무효", () => {
  const ev = R.events.find(e => e.id === "line_opposition_delay"), target = ev.scope.slice(5);
  const inactive = game(ids.filter(id => id !== target));
  // 관련 없는 built 선이 있어도 대상 팀/대상 선의 부재를 대체할 수 없다.
  connect(inactive); inactive.events = [{ id: ev.id, round: 1, x: 1 }];
  const res = C.run(inactive, B, 1);
  ok(!res.tieDown || !res.tieDown.includes(ev.effect.tieDown), "비활성 대상의 지정 선 사건은 고장 없음");
  const empty = game(); empty.events = [{ id: ev.id, round: 1, x: 1 }];
  near(C.bonusOf(empty, R, target, 1), 0, "대상 선 없는 사건 예산 가감0");
  const reply = request(empty, target, { type: "respond", ev: ev.id, opt: "talk" });
  ok(!reply.ok, "선 없는 사건의 유료 대응 거부");
  const done = C.run(empty, B, 1);
  near(done.econ.fiscal[target].eventBonus, 0, "대상 선 없는 월 장부 사건금0");
  ok(!done.tieDown || !done.tieDown.includes(ev.effect.tieDown), "대상 선 없는 고장 로그 없음");
});

test("verify 4: 사건 추첨은 비활성 지정 팀과 없는 지정 선 제외", () => {
  const ev = R.events.find(e => e.id === "line_opposition_delay"), target = ev.scope.slice(5);
  const inactive = game(ids.filter(id => id !== target)), noLine = game(), applicable = game();
  connect(inactive); connect(noLine);
  const ends = ev.effect.tieDown.split("~");
  applicable.ties = [{ a: ends[0], b: ends[1], cap: 4, st: "built" }];
  let inactiveHit = false, missingHit = false, realHit = false;
  // 씨앗은 fixture의 방 이름이다. 확률 문턱을 완화하지 않고 금지 사건 0건을 확인한다.
  for (let seed = 0; seed < 240; seed++) {
    for (const state of [inactive, noLine, applicable]) { state.room = `event-pool-${seed}`; state.events = []; }
    inactiveHit ||= C.drawEvents(inactive, R).some(e => e.scope === `team:${target}`);
    missingHit ||= C.drawEvents(noLine, R).some(e => e.id === ev.id);
    realHit ||= C.drawEvents(applicable, R).some(e => e.id === ev.id);
  }
  ok(!inactiveHit, "240씨앗: 비활성 도시 지정 사건0");
  ok(!missingHit, "240씨앗: 없는 지정 선 사건0");
  ok(realHit, "240씨앗: 대상 팀·선이 있으면 해당 사건도 실제 추첨");
});

test("verify 32: 첫 운영은 계획에서 본 초기 지지율 기준을 바꾸지 않음", () => {
  const S = game(), before = Object.fromEntries(ids.map(id => [id, C.publicView(S, 0).econ.cities[id].approval0]));
  C.run(S, B, 1);
  for (const id of ids) near(S.econ.cities[id].approval0, before[id], `${id} 초기 지지율·평가선 고정`);
  ok(ids.some(id => S.econ.cities[id].approval !== before[id]), "운영 후 현재 지지율은 실제 정전에 반응");
});

test("verify 32: 계획 단계 옛 저장도 공개한 지지율 기준을 소급 보정하지 않음", () => {
  const S = game();
  // §14: 이미 계획을 본 옛 저장은 새 게임 보정값으로 덮지 않는다.
  // 미보정 init 상태를 복원해 재보정하면 실제로 달라질 입력을 만든다.
  S.econ = X.initCities(ids, D, { seed: "legacy-plan-calibration", months: 12 });
  S.econCal = false;
  const before = C.publicView(S, 0).econ.cities;
  C.run(S, B, 1);
  for (const id of ids) {
    near(S.econBefore[id].approval, before[id].approval, `${id} 옛 저장 계획 지지율=운영 전 보고 값`);
    near(S.econ.cities[id].approval0, before[id].approval0, `${id} 옛 저장 계획 기준=운영 후 평가 기준`);
  }
});

test("verify 1: 기본 지도 예산보다 큰 합법 계획도 선을 모두 보존", () => {
  const S = game(); S.econ.cities[a].cash = 100000;
  const p = plan(a, Array(12).fill("solar")); select(a);
  const anchor = B.SITES.find(s => s.dem).tile;
  for (const build of p.builds) p.lines.push({ p: B.routePath(anchor, build.i) });
  const r = request(S, a, { type: "plan", rev: S.teams[a].rev + 1, plan: p });
  ok(r.ok, "충분한 실제 예산의 계획 승인");
  eq(S.teams[a].plan.builds, p.builds, "합법 큰 계획의 설비 보존");
  eq(S.teams[a].plan.lines, p.lines, "합법 큰 계획의 전선 보존");
});

test("verify 8: 도시 월 변화와 최저 집단의 현재 불만 분리", () => {
  let E = X.initCities(ids, D, { seed: "two-cause-meanings", months: 12 });
  E = X.calibrate(E, inputs(E), D);
  const bad = inputs(E, { [a]: { unsPct: 40, servedMWh: 60, co2: 24, co2Local: 24 } });
  let distinguish = false;
  for (let month = 0; month < 3; month++) {
    const r = X.monthStep(E, bad, D); E = r.E;
    const g = r.report.groups[a], change = g.approvalChangeCause, low = g.lowestGroupDissatisfaction;
    ok(change?.scope === "city-month-change" && !Object.hasOwn(change, "group"), "도시 변화 원인에는 최저 집단을 붙이지 않음");
    eq(change?.key, r.report.cities[a].causes[0]?.key ?? null, "도시 변화 원인은 이번 달 절댓값1위 항목");
    eq(g.why, change.text, "G2 why 문구는 도시 월 변화 의미");
    ok(typeof g.whyGrade === "string", "G2 whyGrade 분리");
    const lowest = Object.keys(E.cities[a].groups).sort((u, v) => E.cities[a].groups[u].sat - E.cities[a].groups[v].sat)[0];
    ok(low?.scope === "lowest-group-level" && low.group === lowest, "별도 불만 필드는 실제 최저 만족 집단");
    near(low?.satisfaction, E.cities[a].groups[lowest].sat, "최저 집단 현재 만족도");
    ok(Number.isFinite(low?.deficit) && low.deficit >= 0 && typeof low.text === "string", "집단 불만 크기·설명 공개");
    distinguish ||= change?.key !== low?.key;
  }
  ok(distinguish, "반복 정전에서는 도시의 월 변화1위와 최저 집단 불만이 실제로 달라짐");
});

test("verify 10·33: 사건 탄소를 잔여 몫에서 분리하고 월 탄소를 기록", () => {
  const S = game();
  for (const id of ids) {
    S.econ.cities[id].cash = 10000;
    const p = plan(id, ["diesel", "diesel"]); select(id);
    const anchor = B.SITES.find(s => s.dem).tile;
    for (const tile of [...p.builds.map(b => b.i), ...B.SITES.filter(s => s.dem).map(s => s.tile)]) {
      const route = B.routePath(anchor, tile); if (route?.length > 1) p.lines.push({ p: route });
    }
    S.teams[id].plan = p;
  }
  const first = C.run(S, B, 1);
  ok(ids.every(id => Number.isFinite(first.team[id].co2NoEvent)), "첫 달 사건 없는 탄소 기준을 저장");
  const plain = clone(S), eventful = clone(S);
  for (const state of [plain, eventful]) { state.round = 2; state.phase = "plan"; state.events = []; }
  eventful.events = [{ id: "coldwave_heating", round: 2, x: 1.4 }];
  const clear = C.run(plain, B, 2), actual = C.run(eventful, B, 2);
  let nonzero = false;
  for (const id of ids) {
    const clearA = clear.co2Attribution[id], evA = actual.co2Attribution[id];
    ok(evA && Object.values(evA).every(Number.isFinite), `${id} CO₂ 몫 수치 완비`);
    near(evA.total, evA.seasonalDemand + evA.calendar + evA.event + evA.remainder, `${id} CO₂ 몫의 합=총변화`);
    near(evA.event, (actual.team[id].co2Prod - clear.team[id].co2Prod) * 28 / 7, `${id} 사건 몫은 사건 유무 차이 월환산`);
    near(evA.remainder, clearA.remainder, `${id} 사건만 달라도 선택 잔여는 동일`);
    eq(actual.econ.co2Attribution[id], evA, `${id} 경제 보고서도 같은 CO₂ 몫`);
    nonzero ||= Math.abs(evA.event) > 1e-6;
  }
  ok(nonzero, "사건이 실제 탄소를 바꾼 fixture");
  const history = eventful.log.map(e => e.t || "").findLast(t => t.includes("운영 끝"));
  ok(history?.includes(`CO₂ ${Math.round(actual.econ.region.co2)} t(월)`), "월 운영 기록 CO₂는 월 보고서와 같은 값·단위");
  const legacy = clone(S); delete legacy.results[0].team[a].co2NoEvent;
  legacy.round = 2; legacy.phase = "plan"; legacy.events = [];
  const oldResult = C.run(legacy, B, 2);
  ok(!oldResult.co2Attribution[a], "구 저장에 사건 없는 기준이 없으면 선택 몫을 날조하지 않음");
});

test("ECON-SPEC §14.1: SMR 운영 단가 보정은 달 모드 도입 기술에만 적용", () => {
  const S = game(); adopt(S, a, ["smr"]);
  const p = D.params.smrFuelMul;
  ok(p?.v === 1.25 && p.grade === "G" && typeof p.note === "string", "RECAL-SPEC §7.4: SMR 1.25배는 명시적인 게임 가정");
  const normal = C.modsFor(S, R, a);
  near(normal.fuelMul?.smr, 1.25, "달 모드 SMR 도입은 운영 단가1.25배");
  S.econ.intl.cur.fuelMul = 1.4;
  const expensive = C.modsFor(S, R, a);
  near(expensive.fuelMul?.smr, 1.25, "SMR 운영 보정은 LNG 국제 지수와 독립");
  near(expensive.fuelMul?.lng, 1.4, "LNG 국제 지수는 기존 배수 유지");
  const pending = clone(S); pending.teams[a].research.adoptR = { smr: 2 };
  ok(pending.round === 1 && !C.modsFor(pending, R, a).fuelMul?.smr, "다음 달 도입 예정은 아직 SMR 보정 없음");
  const zero = game();
  ok(!C.modsFor(zero, R, a).fuelMul?.smr, "기술0장 달 모드에는 SMR 보정 없음");
  const without = ctx.KCP.TECH_DATA;
  try {
    delete ctx.KCP.TECH_DATA;
    ok(!C.modsFor(zero, R, a).fuelMul?.smr, "기술 자료 없는 호환 상태에도 SMR 보정 없음");
  } finally { ctx.KCP.TECH_DATA = without; }
  const season = C.newState("smr-season-regression", R.id, 0, ids);
  season.round = 1; season.phase = "plan"; season.events = []; adopt(season, a, ["smr"]);
  ok(!C.modsFor(season, R, a).fuelMul?.smr, "계절 모드 SMR 운영 단가는 기존값");

  // 같은 운영계획에서 단가만 변경해 연료비 차이와 발전량·탄소 불변을 검증한다.
  const operating = plan(a, ["smr"]); select(a);
  const anchor = B.SITES.find(s => s.dem).tile;
  operating.lines.push({ p: B.routePath(anchor, operating.builds[0].i) });
  operating.seed = 8026; operating.season = "winter";
  const beforeMods = clone(normal); beforeMods.fuelMul.smr = 1;
  const before = B.simulate(clone(operating), 7, { league: true, mods: beforeMods });
  const after = B.simulate(clone(operating), 7, { league: true, mods: normal });
  ok(after.tot.by.smr > 0, "보정 비교는 실제 SMR 발전 fixture");
  near(after.tot.by.smr, before.tot.by.smr, "단가 변경은 SMR 발전량 불변");
  near(after.co2, before.co2, "단가 변경은 실제 운영 CO₂ 불변");
  near(after.cost.fuel - before.cost.fuel, after.tot.by.smr * 0.0005, "RECAL-SPEC §7.4: SMR 발전MWh당 운영비0.002→0.0025억");
  near(B.BLD.smr.mw, 4 * 170 / 230, "G5 SMR 4모듈 축척");
  near(B.BLD.smr.cost, (150 / 20) * (8000 / 4500) * (4 * 170 / 230), "G7 DOE FOAK 환산 단가");
  near(ctx.KCP.TECH_DATA.params.smrTurns.v, 12, "SMR 공사 round(55/4.4)=12턴");
});

console.log(`확정 결함: ${passes} 통과, ${fails} 실패`);
process.exitCode = fails ? 1 : 0;
