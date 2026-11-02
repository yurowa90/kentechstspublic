/* KCP.econ 불변 조건 시험 + 균형 판단용 시나리오 출력. node test-econ.js */
"use strict";
const path = require("path");
const fs = require("fs");
const ROOT = path.resolve(__dirname, "../..");
global.window = { KCP: {} };
// ECON_DATA의 SMR 기간 설명도 실제 앱과 같은 기술 원장을 읽는다.
require(path.join(ROOT, "ui/tech-data.js"));
require(path.join(ROOT, "ui/econ-data.js"));
require(path.join(ROOT, "ui/econ.js"));
const KCP = window.KCP, X = KCP.econ, D = KCP.ECON_DATA;
const IDS = ["hwaseong", "pyeongtaek", "anseong", "dangjin", "asan", "cheonan"];

let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) passes++; else { fails++; if (fails < 40) console.log("FAIL:", msg); } }
const sum = a => a.reduce((s, x) => s + x, 0);

// Math.random 금지: 부르면 바로 실패
const realRandom = Math.random;
Math.random = () => { throw new Error("Math.random called"); };
const src = fs.readFileSync(path.join(ROOT, "ui/econ.js"), "utf8");
ok(!/Math\.random/.test(src), "econ.js에 Math.random 없음");
ok(!/document\.|window\.(?!KCP)/.test(src.replace(/const KCP = window\.KCP/, "")), "econ.js에 DOM 없음");

// 시험용 씨앗 난수
function prng(s) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// 도시 묶음 규모(build-maps goals)로 만든 그럴듯한 입력
const BASE = { hwaseong: { cpd: 3.2, co2: 48 }, pyeongtaek: { cpd: 3, co2: 45 }, anseong: { cpd: 0.4, co2: 6 }, dangjin: { cpd: 1.8, co2: 28 }, asan: { cpd: 1.5, co2: 23 }, cheonan: { cpd: 1.2, co2: 18 } };
function energyOf(id, days, o) {
  o = o || {};
  const b = BASE[id], opex = b.cpd * days * (o.costMul || 1);
  return {
    unsPct: o.uns || 0, hospH: o.hosp || 0, costPerMWh: 0.012 * (o.costMul || 1), co2Local: b.co2 * days * 0.6 * (o.co2Mul || 1),
    co2: b.co2 * days * (o.co2Mul || 1), renPct: o.ren == null ? 15 : o.ren, tradeNet: o.trade || 0, opex,
    capexNew: o.capex || 0, demMWh: opex / 0.012 / (o.costMul || 1), spareMW: o.spare == null ? 1 : o.spare
  };
}

function scanFinite(x, where, depth) {
  if (depth > 12) return;
  if (typeof x === "number") { ok(isFinite(x), `유한값 아님 ${where}`); return; }
  if (x && typeof x === "object") Object.keys(x).forEach(k => scanFinite(x[k], where + "." + k, (depth || 0) + 1));
}
const in100 = v => typeof v === "number" && v >= 0 && v <= 100;

function checkStep(Eprev, res, label) {
  const { E, report: R } = res;
  const pops = IDS.filter(id => E.cities[id]).map(id => E.cities[id].pop), inds = IDS.filter(id => E.cities[id]).map(id => E.cities[id].ind);
  const m = E.t;
  ok(sum(pops) === E.totals.pop, `${label} 인구 합 = 총량 (${sum(pops)} vs ${E.totals.pop})`);
  ok(sum(inds) === E.totals.ind, `${label} 산업 합 = 총량`);
  ok(E.totals.pop === Math.round(E.totals.pop0 * Math.pow(1 + D.params.gpYear.v, m / 12)), `${label} 인구 총량 성장식`);
  ok(E.totals.ind === Math.round(E.totals.ind0 * Math.pow(1 + D.params.giYear.v, m / 12)), `${label} 산업 총량 성장식`);
  ok(pops.every(Number.isInteger) && inds.every(Number.isInteger), `${label} 정수 인구·산업`);
  const ids = E.order;
  ok(sum(ids.map(id => R.net[id].pop)) === 0 && sum(ids.map(id => R.net[id].ind)) === 0, `${label} 이동 합 0`);
  // 쌍 흐름 = 순이동
  ["pop", "ind"].forEach(k => ids.forEach(id => {
    const outF = sum(R.flows[k].filter(f => f.from === id).map(f => f.n)), inF = sum(R.flows[k].filter(f => f.to === id).map(f => f.n));
    ok(inF - outF === R.net[id][k], `${label} ${k} 흐름 표 = 순이동 ${id}`);
    ok(E.cities[id][k] === Eprev.cities[id][k] + R.net[id][k] + R.net[id][k === "pop" ? "growPop" : "growInd"], `${label} ${k} 전+이동+성장=후 ${id}`);
  }));
  ids.forEach(id => {
    const F = R.fiscal[id], c = E.cities[id];
    ok(Math.abs(F.cashBefore + F.revTotal - F.expTotal - F.cashAfter) < 1e-6, `${label} 현금 항등식 ${id}`);
    ok(Math.abs(sum(Object.values(F.rev)) - F.revTotal) < 1e-6 && Math.abs(sum(Object.values(F.exp)) - F.expTotal) < 1e-6, `${label} 내역 합 ${id}`);
    ok(F.cashBefore === Eprev.cities[id].cash && F.cashAfter === c.cash, `${label} 현금 이어짐 ${id}`);
    const Cr = R.cities[id];
    ok(in100(Cr.L) && in100(Cr.A), `${label} L·A 0–100 ${id}`);
    Object.values(Cr.Lparts).concat(Object.values(Cr.Aparts)).forEach(v => ok(in100(v), `${label} 부분 점수 ${id}`));
    Object.values(R.groups[id].sat).forEach(v => ok(in100(v), `${label} 집단 만족 ${id}`));
    ok(in100(R.groups[id].approval), `${label} 지지율 ${id}`);
    ok(c.pop > 0 && c.ind > 0, `${label} 양수 ${id}`);
  });
  R.score.rank.forEach(x => { ok(in100(x.score), `${label} 점수 ${x.id}`); Object.values(x.parts).forEach(v => ok(in100(v), `${label} 점수 부분 ${x.id}`)); });
  scanFinite(E, label + " E", 0); scanFinite(R, label + " report", 0);
}

function run(seed, months, inputsFn, ids, base) {
  let E = X.initCities(ids || IDS, D, { seed, months });
  if (base) E = X.calibrate(E, base, D);
  const reports = [];
  for (let i = 0; i < months; i++) {
    const before = JSON.stringify(E);
    const res = X.monthStep(E, inputsFn(E, i), D);
    ok(JSON.stringify(E) === before, `monthStep이 입력 E를 바꾸지 않음 t=${i}`);
    checkStep(E, res, `[${seed} t${i}]`);
    E = res.E; reports.push(res.report);
  }
  return { E, reports };
}

// 1) 여러 입력 36턴
const varied = (seed) => (E, t) => {
  const r = prng(1000 + t * 7 + seed), o = {};
  E.order.forEach(id => {
    o[id] = {
      energy: energyOf(id, X.daysOf(E.year, E.month), { uns: r() < 0.3 ? r() * 4 : 0, hosp: r() < 0.05 ? 2 : 0, costMul: 0.7 + r() * 0.8, co2Mul: 0.5 + r(), ren: r() * 60, trade: (r() - 0.5) * 10, capex: r() < 0.2 ? r() * 60 : 0 }),
      policy: { taxRes: Math.floor(r() * 5) - 2, taxInd: Math.floor(r() * 5) - 2, service: Math.floor(r() * 5) - 2, incentive: r() < 0.3 ? r() * 8 : 0 }
    };
  });
  return o;
};
const V1 = run("alpha", 36, varied(1));
const shares = id => V1.reports.map(R => R.cities[id].pop / R.totals.pop);
IDS.forEach(id => { const s = shares(id); ok(Math.max(...s) < 0.6 && Math.min(...s) > 0.03, `몫 3–60% ${id} (${Math.min(...s).toFixed(3)}–${Math.max(...s).toFixed(3)})`); });

// 2) 결정성
const V2 = run("alpha", 36, varied(1));
ok(JSON.stringify(V1.E) === JSON.stringify(V2.E) && JSON.stringify(V1.reports) === JSON.stringify(V2.reports), "같은 입력·씨앗 → 같은 결과");
const V3 = run("beta", 36, varied(1));
ok(JSON.stringify(V1.E.intl) !== JSON.stringify(V3.E.intl), "다른 씨앗 → 다른 국제 지수");

// 3) 극단 입력
const extremes = [
  () => ({ energy: { unsPct: 100, hospH: 1e9, costPerMWh: 1e9, co2Local: 1e12, renPct: -5, tradeNet: -1e12, opex: 1e12, capexNew: 1e12 }, policy: { taxRes: 2, taxInd: 2, service: -2, incentive: 1e12 } }),
  () => ({ energy: { unsPct: -50, costPerMWh: 0, co2Local: 0, renPct: 500, tradeNet: 1e12 }, policy: { taxRes: -2, taxInd: -2, service: 2, incentive: -9 } }),
  () => ({ energy: { unsPct: NaN, costPerMWh: Infinity, co2Local: "x", renPct: null, opex: undefined }, policy: { taxRes: 9, taxInd: -9, service: "a" } }),
  () => null,
  () => ({})
];
const ext = run("ext", 36, (E, t) => { const o = {}; E.order.forEach((id, i) => { o[id] = extremes[(i + t) % extremes.length](); }); return o; });
// 한 도시만 완벽, 나머지 정전 100% — 그래도 한 도시가 다 가져가지 않음
IDS.forEach(win => {
  const W = run("win-" + win, 36, (E) => { const o = {}; E.order.forEach(id => { o[id] = id === win ? { energy: { unsPct: 0, costPerMWh: 0.005, renPct: 100, co2Local: 0 }, policy: { taxRes: -2, taxInd: -2, service: 2, incentive: 50 } } : { energy: { unsPct: 100, hospH: 10, costPerMWh: 0.05, co2Local: 1e6 }, policy: { taxRes: 2, taxInd: 2, service: -2 } }; }); return o; });
  const s = W.E.cities[win].pop / W.E.totals.pop;
  ok(s < 0.6, `독식 없음(${win} 몫 ${(s * 100).toFixed(1)}%)`);
  IDS.forEach(id => ok(W.E.cities[id].pop / W.E.totals.pop > 0.03 || id === win, `극단에서도 3% 이상 ${id} (${win} 승)`));
});
// 도시 2곳만 참가
run("two", 24, (E) => ({ pyeongtaek: { energy: { unsPct: 2 } }, dangjin: { energy: { unsPct: 0 } } }), ["pyeongtaek", "dangjin"]);

// 4) yearStart 순수 · 1월 지원금
{
  const E = X.initCities(IDS, D, { seed: "y" }), before = JSON.stringify(E);
  const y = X.yearStart(E, D);
  ok(JSON.stringify(E) === before, "yearStart가 입력을 바꾸지 않음");
  IDS.forEach(id => ok(y.subsidy[id] > 0 && Math.abs(y.E.cities[id].cash - E.cities[id].cash - y.subsidy[id]) < 1e-9, `yearStart 지원금 ${id}`));
  const R0 = V1.reports[0], R1 = V1.reports[1], R12 = V1.reports[12];
  ok(IDS.every(id => R0.fiscal[id].rev.subsidy > 0 && R1.fiscal[id].rev.subsidy === 0 && R12.fiscal[id].rev.subsidy > 0), "지원금은 1월에만");
  // 균형: 재정자립도 낮은 안성의 1인당 지원금 > 화성
  const pc = id => y.subsidy[id] / E.cities[id].pop;
  ok(pc("anseong") > pc("hwaseong"), "균형 몫: 자립도 낮을수록 1인당 더");
}

// 5) 기업 이전 희망
{
  const offs = []; V1.reports.forEach(R => R.offers.forEach(o => { if (o.t === R.t) offs.push(o); }));
  ok(offs.length >= 6 && offs.length <= 12, `36턴 동안 제안 ${offs.length}개`);
  for (let i = 1; i < offs.length; i++) ok(offs[i].t - offs[i - 1].t >= 3 && offs[i].t - offs[i - 1].t <= 6, "제안 간격 3–6턴");
  const R = V1.reports.find(r => r.offers.length), o = R.offers[0];
  ok(o.eval && o.eval.rank.length === 6 && IDS.every(id => typeof o.eval.by[id].ok === "boolean"), "evalOffer 결과");
  // 받아들이기: 총량 보존
  const Ebase = V1.E; Ebase.offers = [Object.assign({}, o, { until: 999 })];
  const acc = X.acceptOffer(Ebase, o.id, "anseong", D);
  ok(acc.ok && sum(IDS.map(id => acc.E.cities[id].ind)) === Ebase.totals.ind && sum(IDS.map(id => acc.E.cities[id].pop)) === Ebase.totals.pop, "acceptOffer 총량 보존");
  ok(acc.E.cities.anseong.ind - Ebase.cities.anseong.ind === o.workers, "acceptOffer 종사자 이동");
  ok(acc.E.offers.length === 0, "acceptOffer 제안 닫힘");
}

// 5b) 기준 맞추기: 시작 상태 그대로면 거의 움직이지 않는다
{
  const sq = (E) => { const o = {}; E.order.forEach(id => { o[id] = { energy: energyOf(id, 30, { uns: 0.5 }) }; }); return o; };
  const E0 = X.initCities(IDS, D, { seed: "q" });
  const Q = run("q", 24, sq, null, sq(E0));
  const maxMove = Math.max(...Q.reports.map(R => Math.max(...IDS.map(id => Math.abs(R.net[id].pop) / R.cities[id].pop))));
  ok(maxMove < 0.0005, `시작 상태 유지 → 이주 거의 없음(최대 ${(maxMove * 100).toFixed(3)}%/달)`);
}

// 6) 도우미
ok(X.seasonOfMonth(12) === "winter" && X.seasonOfMonth(4) === "spring" && X.seasonOfMonth(7) === "summer" && X.seasonOfMonth(10) === "autumn", "seasonOfMonth");
ok(X.monthsInGame(24) === 24 && X.monthsInGame(7) === 12, "monthsInGame");
ok(X.daysOf(2028, 2) === 29 && X.daysOf(2027, 2) === 28, "daysOf");
{ const c = V1.E.cities.pyeongtaek, d = X.demandMul(c); ok(Math.abs(d.res - c.pop / c.pop0) < 1e-3 && Math.abs(d.ind - c.ind / c.ind0) < 1e-3, "demandMul"); }
ok(X.roundSum([0.5, 0.5, -1], 0).reduce((a, b) => a + b, 0) === 0, "roundSum");
// 국제: CBAM 12턴부터, 사건 몇 개
ok(V1.reports[0].intl.cbam === 1 && V1.reports[12].intl.cbam === 1, "F16 CBAM 게임 시작부터");
ok(V1.reports.some(R => R.intl.started.some(s => s.id !== "cbam")), "무작위 국제 사건 발생");

// ECON-BALANCE v1.3: 기대값은 정산 세금·지원금 원장으로 별도 계산한다.
// 1월의 일회성 지원금은 첫해 평균에 넣지 않고, 12달부터만 실제 이동 합계에 넣는다.
{
  const clone = value => JSON.parse(JSON.stringify(value));
  const roundedCap = yearly => Math.round(D.params.debtCapRatio.v * yearly * 10) / 10;
  let E = X.initCities(IDS, D, { seed: "v1.3-ledger", months: 24 });
  const ledger = [], annualById = Object.fromEntries(IDS.map(id => [id, E.cities[id].revYear]));
  for (let t = 0; t < 24; t++) {
    const input = varied(37)(E, t), result = X.monthStep(E, input, D);
    ledger.push(result.report.fiscal);
    IDS.forEach(id => {
      // F14: 첫해 보정 세입 고정, 다음 1월에 직전 12달 원장으로 갱신.
      if (t > 0 && t % 12 === 0) annualById[id] = sum(ledger.slice(t - 12, t).map(f => f[id].rev.resTax + f[id].rev.indTax + f[id].rev.subsidy));
      const annual = annualById[id];
      ok(result.E.cities[id].debtCap === roundedCap(annual), `v1.3 원장 기반 ${t + 1}달 한도 ${id}`);
      ok(result.E.cities[id].revenueHistory.length === Math.min(t + 1, 12), `v1.3 이력 창 ${t + 1}달 ${id}`);
    });
    if (t === 4 || t === 11) {
      const saved = clone(E), before = JSON.stringify(saved);
      IDS.forEach(id => ok(saved.cities[id].revenueVersion === 2 && saved.cities[id].revenueHistory.every(Number.isFinite), `v2 숫자 이력 fixture ${id}`));
      const resumed = X.monthStep(saved, input, D);
      ok(JSON.stringify(resumed) === JSON.stringify(result), `v2 저장 이어가기 ${t + 1}달`);
      ok(JSON.stringify(saved) === before, "v2 저장 입력 불변");
    }
    E = result.E;
  }

  // SPEC §5 yearStart 선지급: 현금과 한도에서 지원금을 각각 한 번만 센다.
  const start = X.initCities(IDS, D, { seed: "v1.3-prepaid" });
  const paid = X.yearStart(start, D), paidTwice = X.yearStart(paid.E, D);
  const direct = X.monthStep(start, {}, D), prepaid = X.monthStep(paid.E, {}, D);
  ok(JSON.stringify(paidTwice.E) === JSON.stringify(paid.E), "yearStart 중복 지급 없음");
  IDS.forEach(id => {
    ok(prepaid.report.fiscal[id].rev.subsidy === 0, `선지급 지원금 정산 재지급 없음 ${id}`);
    ok(prepaid.E.cities[id].cash === direct.E.cities[id].cash, `선지급 현금 일치 ${id}`);
    ok(prepaid.E.cities[id].debtCap === direct.E.cities[id].debtCap, `선지급 한도 일치 ${id}`);
    ok(JSON.stringify(prepaid.E.cities[id].revenueHistory) === JSON.stringify(direct.E.cities[id].revenueHistory), `선지급 이력 일치 ${id}`);
  });

  // SPEC §5/B11: 차익·거래·사건 보너스·철거 회수는 반복 세입에 포함하지 않는다.
  const excluded = {
    tariff: { demMWh: 100, costPerMWh: 0.02, opex: 2 },
    trade: { tradeNet: 100 }, bonus: { bonus: 100 }, salvage: { salvage: 100 }
  };
  Object.entries(excluded).forEach(([field, energy]) => {
    const input = Object.fromEntries(IDS.map(id => [id, { energy }]));
    const changed = X.monthStep(start, input, D);
    IDS.forEach(id => {
      ok(changed.report.fiscal[id].rev[field] !== direct.report.fiscal[id].rev[field], `한도 제외 수입 ${field} 실제 변경 ${id}`);
      ok(changed.E.cities[id].debtCap === direct.E.cities[id].debtCap, `한도 제외 수입 ${field} 한도 불변 ${id}`);
    });
  });

  // v1.3 동일 조건 목표. 검사 복제본에서만 성장·이동·국제 변동을 0으로 고정한다.
  // 게임 계수 변경이 아니며, 여섯 도시의 실제 시작 인구·산업·현금과 정책 0은 유지한다.
  const fixed = clone(D);
  ["gpYear", "giYear", "kappaPopReal", "kappaIndReal"].forEach(k => { fixed.params[k].v = 0; });
  Object.keys(fixed.intl.sigma).forEach(k => { fixed.intl.sigma[k] = 0; });
  fixed.intl.eventP = 0; fixed.intl.schedule = [];
  let same = X.initCities(IDS, fixed, { seed: "v1.3-fixed", months: 24 });
  const initial = clone(same), caps = [];
  for (let t = 0; t < 13; t++) {
    same = X.monthStep(same, {}, fixed).E;
    IDS.forEach(id => ok(same.cities[id].pop === initial.cities[id].pop && same.cities[id].ind === initial.cities[id].ind && same.cities[id].out === 1, `동일 인구·산업·산출 ${t + 1}달 ${id}`));
    caps.push(Object.fromEntries(IDS.map(id => [id, same.cities[id].debtCap])));
  }
  console.log("\nv1.3 동일 조건: 도시 | cash0 | 첫 달 한도 | 연 세입×0.88 | 13달 한도 | 차이/첫 달");
  IDS.forEach(id => {
    const cash0 = initial.cities[id].cash0, first = caps[0][id], thirteenth = caps[12][id];
    const diff = Math.abs(thirteenth - first) / first;
    // RECAL-SPEC §1.1·§8 #6: 한도는 투자재원 cash0가 아닌 연 세입 기준.
    const expected = roundedCap(initial.cities[id].revYear);
    ok(first === expected, `첫 달 한도 = 연 세입×0.88 ${id}`);
    ok(diff <= 0.3, `첫 달·13달 한도 차이 ≤ 30% ${id}`);
    console.log(`${D.start[id].name} | ${cash0.toFixed(1)} | ${first.toFixed(1)} | ${expected.toFixed(1)} | ${thirteenth.toFixed(1)} | ${(diff * 100).toFixed(2)}%`);
  });
}

// ECON-BALANCE v1.3: 실제 reduce·건설 비용을 VM에서 실행한다. 화면 등록만 비활성화.
{
  const vm = require("node:vm");
  const context = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } });
  context.window = context;
  vm.runInContext('Math.random = () => { throw new Error("Math.random called"); };', context);
  ["build-maps", "build", "econ-data", "econ", "league-data", "league-core"].forEach(name => {
    const file = path.join(ROOT, `ui/${name}.js`);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  });
  const C = context.KCP.leagueCore, bg = context.KCP.buildGame, R = C.regionOf("south");
  const grant = R.events.find(e => e.effect.budgetAdd > 0 && (e.opts || []).some(o => o.cost === 0 && o.grant > 0));
  const id = R.teams.find(t => C.hits(R, grant, t.id)).id;
  const paid = R.events.find(e => C.hits(R, e, id) && (e.opts || []).some(o => o.cost > 0));
  bg.selectPack(C.teamDef(R, id).pack, "league");
  // Q8: 지도 밖 i=0은 정규화 때 사라질 수 있어 실제 배치 가능한 8억 설비를 쓴다.
  const solarTile = bg.TILES.find(t => !bg.siteRule("solar", t)).i;
  ok(bg.capex({ builds: [{ t: "solar", i: solarTile }], lines: [] }) === 8, "교부세 경계 fixture: 실제 태양광 8억");
  const freeOpt = grant.opts.find(o => o.cost === 0 && o.grant > 0), paidOpt = paid.opts.find(o => o.cost > 0);
  const request = (S, message) => C.reduce(S, Object.assign({ team: id, token: "v1.3-fixture" }, message), 1, bg);
  const fixture = monthly => {
    const S = C.newState("v1.3-response", R.id, 0, IDS, monthly ? { turns: 12 } : undefined);
    ok(request(S, { type: "claim" }).ok && C.host(S, "next", 1), "사건 대응 fixture 시작");
    S.events = [{ round: S.round, id: paid.id }, { round: S.round, id: grant.id }];
    S.teams[id].plan = { builds: [], lines: [] };
    return S;
  };
  const S = fixture(true), city = S.econ.cities[id], key = `${S.round}:${paid.id}`;
  city.cash = -city.debtCap - 100;
  S.teams[id].resp = { [key]: paidOpt.id };
  // Q8 갱신 3: 0 바닥값 없이 초과 부채와 일반 사건 지원금만 반영한다. 교부세는 별도다.
  ok(C.budget(S, id) === -100 + grant.effect.budgetAdd && C.budget(S, id) < 0 && C.grantOf(S, R, id, bg).left === 10 - paidOpt.cost, "한도 초과: 일반 예산 음수 유지·교부세는 대응비만 차감");
  ok(request(S, { type: "respond", ev: paid.id, opt: "none" }).ok && !S.teams[id].resp[key], "한도 초과: 유료 대응 취소 허용");
  ok(request(S, { type: "respond", ev: grant.id, opt: freeOpt.id }).ok, "한도 초과: 비용 0 지원금 선택 허용");
  // Q8: 한도 초과여도 교부세 안의 유료 대응은 허용하는 좁은 예외다.
  ok(request(S, { type: "respond", ev: paid.id, opt: paidOpt.id }).ok && S.teams[id].resp[key] === paidOpt.id, "한도 초과: 교부세 범위 안 유료 대응 허용·선택 저장");
  // Q8 갱신 3: 선택한 일반 지원금을 반영한 뒤에도 일반 여력이 정확히 −1억인 fixture다.
  city.cash = -city.debtCap - grant.effect.budgetAdd * freeOpt.grant - 1;
  ok(C.budget(S, id) === -1 && C.fundingOf(bg, S, R, id, S.teams[id].plan, { kind: "respond" }).ok, "한도 초과: 일반 예산 −1억이어도 전용 재원으로 대응 가능");
  ok(request(S, { type: "respond", ev: paid.id, opt: "none" }).ok && request(S, { type: "respond", ev: paid.id, opt: paidOpt.id }).ok, "한도 초과: 부채 깊이와 무관하게 교부세 범위 대응 허용");
  // Q8: 8억 태양광 + 이미 고른 4억 대응은 공동 한도 10억 초과라 거절한다.
  const build = request(S, { type: "plan", rev: 1, plan: { builds: [{ t: "solar", i: solarTile }], lines: [] } });
  ok(!build.ok && build.err === `debt:${id}`, "한도 초과: 대응과 합쳐 교부세를 넘는 새 건설 거부");
  ok(request(S, { type: "respond", ev: paid.id, opt: "none" }).ok && request(S, { type: "plan", rev: 1, plan: { builds: [{ t: "solar", i: solarTile }], lines: [] } }).ok, "한도 초과: 대응 취소 뒤 8억 새 건설은 교부세 예외 허용");
  S.teams[id].plan = { builds: [], lines: [] };
  ok(!request(S, { type: "respond", ev: paid.id, opt: "missing-option" }).ok, "무료 예외에서도 잘못된 선택 거부");
  city.cash = 0;
  ok(request(S, { type: "respond", ev: paid.id, opt: paidOpt.id }).ok, "한도 이내: 예산 내 유료 대응 허용");

  const season = fixture(false);
  ok(!season.econ && C.roundsOf(season).length === 4, "계절 모드: 경제 상태 없이 기존 4라운드");
  ok(request(season, { type: "respond", ev: paid.id, opt: paidOpt.id }).ok, "계절 모드: 예산 내 유료 대응 허용 유지");
  season.teams[id].sunk = C.budget(season, id) + 100;
  // ECON-BALANCE v1.4 B18: 계절 동작은 변경 전과 같아야 한다.
  // 변경 전 HEAD의 v1.3 respond도 비용 0 취소는 허용했다. 이를 거부한다고 기대하던
  // 기존 단언은 작업 전부터 실패했다. 무료 취소와 유료 거부·선택 복원을 따로 검증한다.
  ok(request(season, { type: "respond", ev: paid.id, opt: "none" }).ok && !season.teams[id].resp[`${season.round}:${paid.id}`], "계절 모드: 초과 예산에서도 기존 무료 취소 허용 유지");
  const old = JSON.stringify(season.teams[id].resp);
  ok(!request(season, { type: "respond", ev: paid.id, opt: paidOpt.id }).ok && JSON.stringify(season.teams[id].resp) === old, "계절 모드: 초과 예산 유료 선택 거부·선택 복원 유지");
}

// ECON-TECH-SPEC T1 RE100: 산업 매력 재생 항 가중 ×1.5(G),
// 재생 점수가 낮으면 불리하고 높으면 유리해야 한다. 다른 항과 입력은 불변.
{
  const E = X.initCities(IDS, D, { seed: "re100-independent", months: 12 });
  const before = JSON.stringify(E);
  for (const ren of [0, 100]) {
    const raw = Object.fromEntries(IDS.map(id => [id, { energy: energyOf(id, 30, { ren }), policy: {} }]));
    const inputs = Object.fromEntries(IDS.map(id => [id, X.cleanInput(raw[id], E.cities[id], D.start[id])]));
    const reg = X.regionCtx(E, inputs, D);
    for (const id of IDS) {
      const baseCtx = X.ctxOf(E, inputs, D, id, reg), ctxBefore = JSON.stringify(baseCtx);
      const plain = X.industryAttract(E.cities[id], baseCtx);
      const enabledCtx = { ...baseCtx, inp: { ...baseCtx.inp, policy: { ...baseCtx.inp.policy, re100: true } } };
      const enabledBefore = JSON.stringify(enabledCtx), enabled = X.industryAttract(E.cities[id], enabledCtx);
      ok(Math.abs(enabled.w.re - plain.w.re * 1.5) < 1e-10, `RE100 재생 가중 정확히 1.5배 ${id}`);
      ok(Object.keys(plain.w).filter(k => k !== "re").every(k => enabled.w[k] === plain.w[k]), `RE100 다른 산업 가중 불변 ${id}`);
      ok(JSON.stringify(enabled.parts) === JSON.stringify(plain.parts), `RE100 부분 점수 불변 ${id}`);
      ok(ren === 0 ? enabled.score < plain.score : enabled.score > plain.score, `RE100 재생 ${ren}% 양날 효과 ${id}`);
      ok(JSON.stringify(baseCtx) === ctxBefore && JSON.stringify(enabledCtx) === enabledBefore, `RE100 산업 매력 입력 불변 ${id}`);
    }
    const enabledRaw = JSON.parse(JSON.stringify(raw));
    IDS.forEach(id => { enabledRaw[id].policy.re100 = true; });
    const rawBefore = JSON.stringify(enabledRaw), stepped = X.monthStep(E, enabledRaw, D);
    ok(JSON.stringify(E) === before && JSON.stringify(enabledRaw) === rawBefore, `RE100 월 계산 E·입력 불변 ${ren}%`);
    ok(IDS.every(id => stepped.E.cities[id].policy.re100 === true), `RE100 정책 월 상태 보존 ${ren}%`);
    checkStep(E, stepped, `RE100 ${ren}%`);
  }
}

Math.random = realRandom;
console.log(`\n시험: ${passes} 통과, ${fails} 실패\n`);

/* ---------- 시나리오: 당진 정전 3%, 평택 0%, 나머지 0.5% ---------- */
const statusQuo = (E) => { const o = {}; E.order.forEach(id => { o[id] = { energy: energyOf(id, 30, { uns: 0.5 }) }; }); return o; };
function scenario(title, cfg) {
  const S = run("scn", 36, (E, t) => {
    const o = {};
    E.order.forEach(id => {
      const c = cfg[id] || {};
      o[id] = { energy: energyOf(id, X.daysOf(E.year, E.month), { uns: c.uns == null ? 0.5 : c.uns, ren: c.ren, capex: t % 6 === 2 ? 20 : 0 }), policy: c.policy || {} };
    });
    return o;
  }, null, statusQuo(X.initCities(IDS, D, {})));
  console.log("== " + title + " ==");
  const head = ["턴", ...IDS.map(id => D.start[id].name.padEnd(6))].join(" | ");
  const rows = (lab, f) => { console.log(lab); console.log(head); [0, 5, 11, 17, 23, 29, 35].forEach(t => console.log([String(t + 1).padStart(2), ...IDS.map(id => f(S.reports[t], id))].join(" | "))); };
  rows("인구 변화(시작 대비 %) · 지역 총량 +0.6%/년 포함", (R, id) => ((R.cities[id].pop / D.start[id].pop0 - 1) * 100).toFixed(2).padStart(6));
  rows("산업 종사자 변화(%)", (R, id) => ((R.cities[id].ind / D.start[id].ind0 - 1) * 100).toFixed(2).padStart(6));
  rows("현금(억)", (R, id) => String(Math.round(R.fiscal[id].cashAfter)).padStart(6));
  rows("지지율(%)", (R, id) => R.groups[id].approval.toFixed(1).padStart(6));
  rows("살기 좋음 L / 산업 매력 A", (R, id) => `${Math.round(R.cities[id].L)}/${Math.round(R.cities[id].A)}`.padStart(6));
  const last = S.reports[35];
  console.log("점수 순위:", last.score.rank.map(x => `${x.rank}.${x.name} ${x.score}`).join("  "));
  console.log("1월 지원금(억):", IDS.map(id => `${D.start[id].name} ${Math.round(S.reports[0].fiscal[id].rev.subsidy)}`).join(" · "));
  const F = S.reports[3].fiscal.pyeongtaek;
  console.log("평택 4월 재정 내역:", JSON.stringify({ rev: F.rev, exp: F.exp }));
  console.log("집단(당진 36턴):", JSON.stringify(last.groups.dangjin));
  console.log("뉴스 예시:"); S.reports.slice(0, 14).forEach(R => R.news.forEach(n => console.log("  " + (R.t + 1) + "턴 " + n)));
  console.log("국제 지수 36턴:", JSON.stringify({ lng: last.intl.lng, fx: last.intl.fx, ship: last.intl.ship, semi: last.intl.export.semi, active: last.intl.active.map(a => a.name) }));
  console.log("");
  return S;
}
scenario("당진 정전 3% · 평택 0% · 나머지 0.5% (36턴)", { dangjin: { uns: 3 }, pyeongtaek: { uns: 0 } });
scenario("천안 세금 −2·서비스 +2 · 아산 세금 +2 · 정전 모두 0.5%", { cheonan: { policy: { taxRes: -2, taxInd: -2, service: 2 } }, asan: { policy: { taxRes: 2, taxInd: 2 } } });

process.exit(fails ? 1 : 0);
