"use strict";
// 독립 계약 검사: ECON-TECH-SPEC T1–T3/T5 우선, 수치 근거 ECON-TECH §3·§7.
// G: 4주/달, 유레카 남은 need/3, 이전 50%·0.5억×6달·수입 3억 상한,
// D-79: HVDC 기본 손실·용량×1.5·비용×1.3, 초전도 ×1.5·손실×0.5·월0.5억, 12달 5~7장.
// 효과 크기는 계약의 교육용 G, 원근거 SiC P·탠덤/배터리 P(기업 발표 보조)·혼소 M·수소 왕복 P.
// 기존 독립 수치 계약을 유지하되 D-79 파생 기대값은 검증된 params를 읽는다. 지도 좌표와 기존 설비 기본값만 fixture로 읽는다.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "../../..");
const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } });
ctx.window = ctx;
vm.runInContext('Math.random = () => { throw new Error("Math.random called"); };', ctx);
for (const name of ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core"]) {
  const file = path.join(ROOT, `ui/${name}.js`);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
}
const { leagueCore: C, buildGame: bg, ECON_DATA: D, TECH_DATA: TD, econ: X } = ctx.KCP;
const R = C.regionOf("south"), ids = R.teams.map(t => t.id), [a, b] = ids;
const clone = x => JSON.parse(JSON.stringify(x)), sum = xs => xs.reduce((n, x) => n + x, 0);
let passes = 0, fails = 0;
const ok = (value, label) => { if (value) passes++; else { fails++; console.log("FAIL:", label); } };
const near = (value, expected, label) => ok(Number.isFinite(value) && Math.abs(value - expected) <= 1e-8 * Math.max(1, Math.abs(expected)), `${label}: ${value} / ${expected}`);
const test = (label, fn) => { try { fn(); } catch (e) { ok(false, `${label}: ${e.stack}`); } };
function game(monthly = true) {
  const S = C.newState("tech-independent", R.id, 0, ids, monthly ? { turns: 36 } : undefined);
  S.round = 1; S.phase = "plan"; S.events = [];
  ids.forEach(id => { S.teams[id].token = "tech-fixture"; });
  return S;
}
function adopt(S, id, cards) {
  const rs = { queue: [], prog: {}, stage: {}, adopted: cards.slice(), eureka: [], licensedFrom: {}, joint: {} };
  S.teams[id].research = rs; S.teams[id].rs = rs; return rs;
}
function request(S, id, m) { return C.reduce(S, { team: id, token: "tech-fixture", ...m }, 0, bg); }
function select(id) { bg.selectPack(C.teamDef(R, id).pack, "league"); }
function planOf(id, types, connect = false) {
  select(id); const p = { builds: [], lines: [] }, used = new Set(), anchor = bg.SITES.find(s => s.dem).tile;
  for (const t of types) {
    const q = bg.TILES.find(q => !used.has(q.i) && !bg.siteRule(t, q) && (!connect || bg.routePath(anchor, q.i)));
    if (!q) throw new Error(`fixture ${id}/${t}`);
    used.add(q.i); p.builds.push({ t, i: q.i });
    if (connect) p.lines.push({ p: bg.routePath(anchor, q.i) });
  }
  return bg.sanitize(p, 1e9);
}
function connect(S, a, b) {
  S.ties.push({ a, b, cap: 4, st: "built" });
  for (const [id, other] of [[a, b], [b, a]]) {
    select(id); const gate = ctx.KCP.BUILD_MAPS[C.teamDef(R, id).pack].gates.find(g => g.to.includes(other));
    const tile = bg.TILES.find(q => q.c === gate.c && q.r === gate.r);
    const p = S.teams[id].plan || { builds: [], lines: [] };
    p.lines.push({ p: bg.routePath(bg.SITES.find(s => s.dem).tile, tile.i) });
    S.teams[id].plan = bg.sanitize(p, 1e9);
  }
}
function month(S, n) { S.round = n; S.phase = "plan"; S.events = []; return C.run(S, bg, n); }
function funded(S) { ids.forEach(id => { S.econ.cities[id].cash = 10000; }); }

test("자료·기존 샌드박스", () => {
  ok(TD.cards.length === 15 && TD.branches.length === 6, "15장·6갈래");
  for (const c of TD.cards) {
    for (const k of ["id", "branch", "field", "name", "need", "demo", "req", "eff", "why", "grade", "sources"]) ok(c[k] != null, `${c.id}.${k}`);
    ok(c.sources.length > 0, `${c.id} 출처`);
    ok(TD.eureka[c.id], `${c.id} 유레카`);
  }
  for (const [k, p] of Object.entries(TD.params)) ok(p.v != null && p.grade && p.note && p.sources.length, `계수 ${k} 근거`);
  ok(JSON.stringify(bg.TECHS.map(c => c.id).sort()) === JSON.stringify(["bms", "fcst", "grid"]), "샌드박스 기존 3종 유지");
  bg.selectPack(C.teamDef(R, a).pack);
  ok(!bg.BLD.tandem && !bg.BLD.smr, "샌드박스 해금 설비 없음");
});

test("서버 선행·배타·예산·해금", () => {
  for (const pair of [["ccu", "h2store"], ["smr", "scable"]]) for (const reverse of [false, true]) {
    const S = game(), [owned, locked] = reverse ? pair.slice().reverse() : pair;
    adopt(S, a, [owned, "hvdc"]);
    ok(!request(S, a, { type: "research", queue: [locked] }).ok, `${owned} 도입 후 ${locked} 거부`);
  }
  for (const card of ["scable", "nbat", "h2mix", "vpp", "mass"]) {
    const S = game(); ok(!request(S, a, { type: "research", queue: [card] }).ok, `${card} 선행 없는 요청 거부`);
  }
  for (const prior of ["tandem", "nbat"]) {
    const S = game(); adopt(S, a, [prior]); ok(request(S, a, { type: "research", queue: ["mass"] }).ok, `mass OR 선행 ${prior}`);
  }
  const S = game();
  ok(!request(S, a, { type: "research", queue: ["ccu", "h2store"] }).ok, "대기열 내 배타도 거부");
  ok(!request(S, a, { type: "research", queue: ["unknown"] }).ok, "알 수 없는 카드 거부");
  ok(!request(S, a, { type: "research", queue: ["hvdc", "hvdc"] }).ok, "중복 카드 거부");
  ok(!request(S, a, { type: "research", queue: ["re100"] }).ok, "재생 30% 미만 RE100 거부");
  S.results = [{ team: { [a]: { renPct: 30 } } }];
  ok(request(S, a, { type: "research", queue: ["re100"] }).ok, "재생 정확히 30% RE100 허용");
  for (const t of ["tandem", "nbat", "h2store", "smr"]) {
    const G = game(), p = planOf(a, [t]);
    ok(!request(G, a, { type: "plan", rev: 1, plan: p }).ok, `도입 전 ${t} 건설 거부`);
    adopt(G, a, [t]); ok(request(G, a, { type: "plan", rev: 1, plan: p }).ok, `도입 뒤 ${t} 건설 허용`);
  }
  const poor = game(); poor.econ.cities[a].cash = -poor.econ.cities[a].debtCap;
  const before = JSON.stringify(poor.teams[a].plan);
  ok(!request(poor, a, { type: "research", queue: ["hvdc"] }).ok, "실증비 없는 연구 거부");
  ok(JSON.stringify(poor.teams[a].plan) === before, "거부된 연구 계획 불변");
  ok(!request(poor, a, { type: "plan", rev: 1, plan: { builds: [], lines: [], rq: ["hvdc"] } }).ok, "plan.rq 예산 우회 거부");
  near(C.researchReserve(game(), a, bg, { rq: ["hvdc", "tandem"] }), 9, "실증 예약 HVDC4+탠덤5");
});

test("기술 이전·사용료 보존과 상한", () => {
  const S = game();
  ok(!request(S, b, { type: "license", other: a, card: "hvdc" }).ok, "미도입 도시에서 이전 거부");
  adopt(S, a, ["hvdc"]);
  ok(request(S, b, { type: "license", other: a, card: "hvdc" }).ok, "도입 도시에서 이전 승인");
  near(C.royaltyLedger(S)[a].income, 0, "인력 없는 대기 연구 사용료 없음");
  S.teams[b].plan = { ...planOf(b, ["lab"]), rq: ["hvdc"] };
  near(C.royaltyLedger(S)[a].income, 0.5, "이전 월 사용료 0.5억");
  near(C.royaltyLedger(S)[b].expense, 0.5, "이전 지출과 수입 일치");
  const rs = S.teams[b].research;
  rs.prog.hvdc = 3; near(C.researchView(S, b).progress.hvdc, 50, "이전 need=12×0.5=6");
  rs.royaltyMonths = { hvdc: 6 }; near(C.royaltyLedger(S)[a].income, 0, "6달 지급 뒤 중단");
  rs.royaltyMonths.hvdc = 0; rs.stage.hvdc = "done"; near(C.royaltyLedger(S)[a].income, 0, "연구 완료 뒤 지급 중단");
  const cap = game();
  for (const id of ids.slice(1)) {
    const r = adopt(cap, id, []); r.queue = ["hvdc", "sic"]; r.licensedFrom = { hvdc: a, sic: a }; r.stage = { hvdc: "demo", sic: "demo" };
    cap.teams[id].plan = { builds: [], lines: [], rq: r.queue };
  }
  const before = JSON.stringify(cap), ledger = C.royaltyLedger(cap);
  near(ledger[a].income, 3, "저장 상태의 실증 10건 청구도 수입 상한 3억");
  near(sum(Object.values(ledger).map(x => x.income)), sum(Object.values(ledger).map(x => x.expense)), "상한 적용 뒤 지출=수입");
  ok(JSON.stringify(cap) === before, "사용료 조회 입력 불변");
  const run = game(); adopt(run, a, ["hvdc"]); request(run, b, { type: "license", other: a, card: "hvdc" });
  run.teams[b].plan = { ...planOf(b, ["lab"]), rq: ["hvdc"] };
  const base = clone(run); base.teams[b].research.licensedFrom = {}; base.teams[b].rs = base.teams[b].research;
  const plain = month(base, 1), paid = month(run, 1);
  near(paid.team[b].cost.research - plain.team[b].cost.research, 0.5, "실제 월 비용 사용료 0.5억");
  near(run.econ.cities[a].cash - base.econ.cities[a].cash, 0.5, "수취 도시 현금 +0.5억");
  near(run.econ.cities[b].cash - base.econ.cities[b].cash, -0.5, "지급 도시 현금 -0.5억");
});

test("공동 연구 양방향 동의·연결·합산", () => {
  const S = game(); funded(S);
  for (const id of [a, b]) S.teams[id].plan = planOf(id, ["lab"]);
  ok(!request(S, a, { type: "joint", other: b, card: "hvdc" }).ok, "연계선 없는 공동 연구 거부");
  connect(S, a, b);
  ok(request(S, a, { type: "joint", other: b, card: "hvdc" }).ok, "공동 연구 제안 승인");
  ok(!C.researchView(S, a).joint.hvdc.active, "한쪽 제안만으로 공동 연구 미활성");
  ok(request(S, b, { type: "joint", other: a, card: "hvdc" }).ok, "공동 연구 상호 동의 승인");
  ok(C.researchView(S, a).joint.hvdc.active && C.researchView(S, b).joint.hvdc.active, "두 도시 공동 연구 활성");
  const cut = clone(S); cut.teams[b].plan.lines = [];
  month(cut, 1);
  near(C.researchView(cut, a).prog.hvdc || 0, 0, "상대 내부망 단절 공동 연구 대기");
  near(C.researchView(cut, b).prog.hvdc || 0, 0, "상대 내부망 단절 양쪽 진척0");
  month(S, 1);
  near(C.researchView(S, a).prog.hvdc, 8.7, "한 연구소씩 4주×(1+1)=8");
  near(C.researchView(S, b).prog.hvdc, 8.7, "공동 진척 일치");
  month(S, 2); month(S, 3); S.round = 4;
  ok(C.researchView(S, a).adopted.includes("hvdc") && C.researchView(S, b).adopted.includes("hvdc"), "공동 카드 양쪽 도입");
});

test("실증 한 턴·그다음 도입·공개 정보", () => {
  const S = game(); funded(S); S.teams[a].plan = planOf(a, ["lab", "lab", "uni"]);
  ok(request(S, a, { type: "research", queue: ["hvdc"] }).ok, "연구 요청 기존 queue 계약");
  month(S, 1); near(C.researchView(S, a).prog.hvdc, 8.7, "새 대학 준비 중 연구소2×4주=8");
  month(S, 2); ok(C.researchView(S, a).stage.hvdc === "demo", "need 채운 턴 실증 시작");
  ok(!C.researchView(S, a).adopted.includes("hvdc"), "실증 시작에는 효과 미도입");
  month(S, 3); ok(!C.researchView(S, a).adopted.includes("hvdc"), "실증 마친 달까지 효과 미도입");
  S.round = 4; ok(C.researchView(S, a).adopted.includes("hvdc"), "실증 다음 달 도입");
  const view = C.publicView(S, 0);
  ok(view.teams[a].research.adopted.includes("hvdc"), "공개 팀 도입 카드");
  near(view.teams[a].research.progress.hvdc, 100, "공개 연구 진척 %");
  ok(view.econ.cities[a].research.adopted.includes("hvdc"), "공개 경제 도시 도입 카드");
});

test("유레카 남은 양의 1/3·한 번", () => {
  // T2의 조건은 설비 보유가 아닌 운영이다. 부하까지 배선을 연결해 실제 운영을 만든다.
  const S = game(); funded(S); S.teams[a].plan = planOf(a, ["lab", "battery"], true);
  const rs = adopt(S, a, []); rs.queue = ["bms"]; rs.prog.bms = 1; S.teams[a].plan.rq = ["bms"];
  month(S, 1);
  ok(C.researchView(S, a).eureka.includes("bms"), "배터리 운영 유레카 기록");
  near(C.researchView(S, a).prog.bms, 6, "min(6, 1+(6−1)/3+4) 완료");
  month(S, 2); ok(C.researchView(S, a).eureka.filter(x => x === "bms").length === 1, "유레카 중복 없음");
  ok(S.log.some(x => x.t.includes("유레카!")), "유레카 뉴스");
  const H = game(); funded(H); H.teams[a].plan = planOf(a, ["lab"]);
  const hs = adopt(H, a, []); hs.queue = ["hvdc"]; hs.prog.hvdc = 3; H.teams[a].plan.rq = ["hvdc"];
  const neighbors = R.ties.filter(t => t.a === a || t.b === a).map(t => t.a === a ? t.b : t.a);
  connect(H, a, neighbors[0]); connect(H, a, neighbors[1]);
  month(H, 1); near(C.researchView(H, a).prog.hvdc, 10.35, "HVDC 남은 (12−3)/3 + 4주 진척=10");
});

test("연계선·설비·MODS 수치", () => {
  const S = game(false), tie = { a, b, cap: 4 };
  near(C.effectiveTie(S, tie).loss, 0.01, "RECAL-SPEC §1.3 기본 연계선 손실1%");
  adopt(S, a, ["hvdc"]); near(C.effectiveTie(S, tie).loss, 0.01, "F41 HVDC 카드만으로 일반 선은 불변");
  // D-79: 손실 .012 → 기본 손실, 용량 4 → 4×1.5, 건설비 ×1.3 유지.
  tie.kind = "hvdc"; near(C.effectiveTie(S, tie).loss, C.TIE_LOSS, "D-79 HVDC 기본 손실");
  near(C.effectiveTie(S, tie).cap, 4 * TD.params.hvdcCap.v, "D-79 HVDC 용량 배수");
  near(C.tieCost(R, tie), C.tieCost(R, { ...tie, kind: "land" }) * TD.params.hvdcCost.v, "D-79 건설비 ×1.3");
  adopt(S, a, ["hvdc", "scable"]);
  near(C.effectiveTie(S, tie).cap, 4 * TD.params.hvdcCap.v * TD.params.scableCap.v, "D-79 초전도 결합 6→9MW");
  near(C.effectiveTie(S, tie).loss, C.TIE_LOSS * TD.params.scableLoss.v, "D-79 결합 손실 .006→.005");
  const scableLoss = C.effectiveTie(S, tie).loss;
  adopt(S, a, ["sic", "ccu", "h2mix", "vpp"]); const mods = C.modsFor(S, R, a);
  near(mods.renewOutput, 1.015, "SiC 출력 배수"); near(mods.co2Mul.coal, 0.4, "CCU 석탄 CO2 배수");
  near(mods.coalCapMul, 0.79, "CCU 석탄 출력 배수"); near(mods.h2Co2, 0.88, "F42 수소 존재 때 혼소 상한");
  near(mods.drEffect, 1.5, "VPP 수요반응 효과"); near(mods.drCost, 0.5, "VPP 수요반응 비용");
  select(a); near(bg.BLD.tandem.cost / bg.BLD.solar.cost, 1.2, "RECAL-SPEC §1.3 탠덤 건설비 배수");
  near(bg.BLD.nbat.mwh / bg.M.batMWh, 1.25, "차세대 배터리 용량 배수");
  near(bg.BLD.smr.mw, 4 * 170 / 230, "G5 SMR 4모듈×170MWe÷230"); near(bg.BLD.smr.cost, (150 / 20) * (8000 / 4500) * (4 * 170 / 230), "G7 DOE FOAK 환산 단가 M");
  const p = planOf(a, ["solar"], true); p.seed = 982; p.season = "spring";
  const original = bg.simulate(clone(p), 7, { league: true, mods: {} });
  const sic = bg.simulate(clone(p), 7, { league: true, mods: { renewOutput: 1.015 } });
  near(sic.tot.renAvail / original.tot.renAvail, 1.015, "실제 SiC 재생 출력");
  const tp = clone(p); tp.builds[0].t = "tandem";
  const tandem = bg.simulate(tp, 7, { league: true, mods: {} });
  near(tandem.tot.renAvail / original.tot.renAvail, 1.2, "RECAL-SPEC §1.3 실제 새 탠덤 출력");
  ok(JSON.stringify(bg.simulate(clone(p), 7, { league: true, mods: {} })) === JSON.stringify(original), "MODS 후속 실행 오염 없음");
  console.log("카드 효과 실측", JSON.stringify({ hvdcLoss: TD.params.hvdcLoss.v, scableLoss, solarMWh: original.tot.renAvail, tandemMWh: tandem.tot.renAvail, sicMWh: sic.tot.renAvail }));
});

test("대량 공정 신규 투자만 할인·SMR 12턴 공사", () => {
  const S = game(); funded(S); const old = planOf(a, ["solar"]);
  ok(request(S, a, { type: "plan", rev: 1, plan: old }).ok, "대량 공정 이전 태양광 승인");
  select(a); const normalCost = bg.capex(old);
  adopt(S, a, ["mass"]);
  const added = planOf(a, ["solar", "solar"]);
  ok(request(S, a, { type: "plan", rev: 2, plan: added }).ok, "대량 공정 이후 새 태양광 승인");
  select(a); near(bg.capex(S.teams[a].plan), normalCost * (1 + 0.92), "기존 투자 불변·신규만8% 할인");
  const N = game(); funded(N); adopt(N, a, ["smr"]);
  const p = planOf(a, ["smr"], true), key = "smr:" + p.builds[0].i;
  ok(request(N, a, { type: "plan", rev: 1, plan: p }).ok, "SMR 착공 승인");
  for (let n = 1; n <= 12; n++) {
    N.round = n; ok((C.modsFor(N, R, a).disabledBuilds || []).includes(key), `착공 포함 ${n}턴 SMR 미가동`);
  }
  N.round = 13; ok(!(C.modsFor(N, R, a).disabledBuilds || []).includes(key), "12턴 공사 뒤 다음 턴 SMR 가동");
});

test("칭호와 점수 분리", () => {
  const S = game(), before = JSON.stringify(X.score(S.econ));
  adopt(S, a, ["grid", "hvdc", "sic", "h2store", "h2mix"]);
  const titles = C.researchView(S, a).titles;
  ok(titles.includes("grid"), "그리드3장 칭호"); ok(titles.includes("hydrogen"), "수소2장 칭호");
  ok(JSON.stringify(X.score(S.econ)) === before, "칭호 자체 점수 가산 없음");
});

test("수소 실제 충방전·왕복35% 에너지 수지", () => {
  // ECON-TECH §3 C1: 빈 탱크, 왕복35%(P). 송전 손실은 저장 손실과 분리한다.
  const p = planOf(a, ["solar", "h2store"], true); p.seed = 982; p.season = "spring";
  const network = bg.network(p), routes = network.comps.flatMap(c => c.RB || []);
  ok(routes.length === 1, "태양광→수소 충전 경로 한 개 fixture");
  const r = bg.simulate(clone(p), 7, { league: true, mods: { curtailP: 1 } });
  near(r.tot.batStart, 0, "수소 탱크 시작 잔량0");
  ok(r.tot.curtailCapturedMWh > 0 && r.tot.batOut > 0, "출력제어 전력 수소 충전·부족 때 재발전");
  const input = r.tot.curtailCapturedMWh * routes[0].eff;
  near(r.tot.batOut + r.tot.h2End * Math.sqrt(0.35), input * 0.35, "방전+남은 저장의 전기 환산=충전 입력×35%");
  const remain = bg.simulate(clone(p), 7, { league: true, mods: { curtailP: 1, demandMul: 0.01 } });
  ok(remain.tot.h2End > 0, "저수요에서 다음 시간에 쓸 수소 잔량 발생");
  near(remain.tot.batOut + remain.tot.h2End * Math.sqrt(0.35), remain.tot.curtailCapturedMWh * routes[0].eff * 0.35, "잔량 있는 수소도 왕복35% 수지");
  near(remain.tot.batEnd, 0, "수소 잔량과 기존 배터리 잔량 분리");
  console.log("수소 실측", JSON.stringify({ inputMWh: input, outputMWh: r.tot.batOut, storedMWh: r.tot.h2End, roundtrip: (r.tot.batOut + r.tot.h2End * Math.sqrt(0.35)) / input }));
});

test("CCU·혼소 실제 발전 탄소·VPP 실제 비용", () => {
  for (const [fuel, card, carbonRatio, outputRatio] of [["coal", "ccu", 0.4, 0.79], ["lng", "h2mix", 1, 1]]) {
    const matches = s => s.kind === "plant" && (fuel === "coal" ? s.fuel === "coal" : s.fuel !== "coal");
    const id = ids.find(id => { select(id); return bg.SITES.some(matches); });
    select(id); const source = bg.SITES.find(matches), sink = bg.SITES.find(s => s.dem);
    const p = bg.sanitize({ builds: [], lines: [{ p: bg.routePath(source.tile, sink.tile) }], seed: 982 }, 1e9);
    const S = game(false); adopt(S, id, [card]);
    const plain = bg.simulate(clone(p), 7, { league: true, mods: { demandMul: 100 } });
    const changed = bg.simulate(clone(p), 7, { league: true, mods: { ...C.modsFor(S, R, id), demandMul: 100 } });
    ok(plain.tot.by[fuel] > 0 && Object.entries(plain.tot.by).every(([k, v]) => k === fuel || v === 0), `${fuel} 단일 발전원 fixture`);
    near(changed.tot.by[fuel] / plain.tot.by[fuel], outputRatio, `${card} 실제 공급 출력 배수`);
    near((changed.tot.co2 / changed.tot.by[fuel]) / (plain.tot.co2 / plain.tot.by[fuel]), carbonRatio, `${card} 실제 MWh당 CO2 배수`);
  }
  const p = planOf(a, []); p.seed = 982; p.policies = ["dr"];
  const plain = bg.simulate(clone(p), 7, { league: true, mods: {} });
  const S = game(false); adopt(S, a, ["fcst", "vpp"]);
  const vpp = bg.simulate(clone(p), 7, { league: true, mods: C.modsFor(S, R, a) });
  near(vpp.cost.policy / plain.cost.policy, 0.5, "VPP 실제 수요반응 정책비 절반");
  ok(vpp.tot.dem < plain.tot.dem, "VPP 실제 수요반응 감축 증가");
});

test("기존 사건×기술 피해 완화", () => {
  // T2는 방향만 계약한다. 문서에 없는 피해 배수를 임의 기대값으로 만들지 않는다.
  const S = game(false); S.events = [{ id: "heatwave_peak", round: 1 }];
  const heat = C.modsFor(S, R, a).demandMul;
  for (const tech of [["fcst"], ["fcst", "vpp"]]) {
    adopt(S, a, tech); const mod = C.modsFor(S, R, a).demandMul;
    ok(tech.includes("vpp") ? mod >= 1 && mod < heat : mod === heat, `${tech.join("+")} 폭염 추가 수요 피해 완화`);
  }
  S.events = [{ id: "finedust_coal_cap", round: 1 }]; adopt(S, a, []);
  const dust = C.modsFor(S, R, a).coalCapMul;
  adopt(S, a, ["ccu"]); const ccu = C.modsFor(S, R, a).coalCapMul;
  // 최종 검증 verify 13 / ECON-SPEC §13 정정: CO₂ 포집은 미세먼지 제한 완화 근거가 아니다.
  near(ccu / 0.79, dust, "CCU 자체 출력 손실을 제외하면 계절관리제 제한은 동일");
  const storm = R.events.find(e => e.id === "typhoon_coast"), [left, right] = storm.effect.tieDown.split("~");
  const B = game(false); connect(B, left, right); B.events = [{ id: storm.id, round: 1 }];
  const safe = clone(B); adopt(safe, left, ["hvdc", "scable"]);
  const normal = C.run(B, bg, 1), protectedRun = C.run(safe, bg, 1);
  ok(normal.tieDown === storm.effect.tieDown, "태풍 기존 연계선 고장 fixture");
  ok(protectedRun.tieDown !== storm.effect.tieDown, "초전도 태풍 연계선 고장 완화");
});

test("12달 연구소2·대학1 획득량", () => {
  const S = game(); funded(S); S.teams[a].plan = planOf(a, ["lab", "lab", "uni"]);
  const order = ["bms", "fcst", "grid", "hvdc", "tandem", "sic", "nbat", "vpp"];
  for (let n = 1; n <= 12; n++) {
    S.round = n; S.phase = "plan";
    const view = C.researchView(S, a);
    if (!view.current) {
      const next = order.find(t => !view.adopted.includes(t) && !view.stage[t]);
      if (next) ok(request(S, a, { type: "research", queue: [next] }).ok, `${n}월 ${next} 선택`);
    }
    month(S, n);
  }
  const view = C.researchView(S, a), count = view.adopted.length;
  ok(count >= 5 && count <= 7, `12달 실제 도입 ${count}장, 계약5~7장`);
  console.log("12달 획득", D.start[a].name, JSON.stringify({ adopted: view.adopted, count, stage: view.stage }));
});

console.log(`T1–T3/T5: ${passes} 통과, ${fails} 실패`);
process.exitCode = fails ? 1 : 0;
