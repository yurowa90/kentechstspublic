"use strict";
const { X, D, IDS, sum, run } = require("./lib");
let fail = 0, checks = 0; const bad = (c, m) => { checks++; if (!c) { fail++; if (fail < 30) console.log("FAIL", m); } };
const scan = (x, w, d = 0) => { if (d > 14) return; if (typeof x === "number") bad(isFinite(x), "non-finite " + w); else if (x && typeof x === "object") for (const k in x) scan(x[k], w + "." + k, d + 1); };
function prng(s) { let a = s >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let subsidyCount = {};
for (let s = 0; s < 40; s++) {
  const R = prng(s + 7), pick = a => a[Math.floor(R() * a.length)];
  const f = () => ({ e: { uns: pick([0, 0, 0.5, 3, 5, 20, 100]), hosp: pick([0, 0, 5]), ren: R() * 100, trade: (R() - 0.5) * pick([0, 10, 1000]), capex: pick([0, 0, 50, 5000]), costMul: pick([0.2, 1, 3]) },
    p: { taxRes: pick([-2, -1, 0, 1, 2, 7, NaN]), taxInd: pick([-2, 0, 2]), service: pick([-2, 0, 2]), incentive: pick([0, 0, 5, 1e9, -3]) } });
  subsidyCount = {};
  // ECON-BALANCE v1.3: 지원금까지 달 평균 ×12인 v1.2 단언 대신 실제 원장으로 검산.
  // 엔진의 revenueHistory/revYear를 기대값 계산에 사용하지 않는다.
  const fixedYear = {};
  const debtLedger = Object.fromEntries(IDS.map(id => [id, []]));
  const { E, reps } = run({ seed: "inv" + s, months: 36, f, opts: s % 5 === 0 ? { cash: { anseong: -5000 } } : {}, onStep: (Ep, r) => {
    const E2 = r.E, R2 = r.report;
    bad(sum(E2.order.map(id => E2.cities[id].pop)) === E2.totals.pop, `pop sum t${Ep.t}`);
    bad(sum(E2.order.map(id => E2.cities[id].ind)) === E2.totals.ind, `ind sum t${Ep.t}`);
    bad(E2.totals.pop === Math.round(E2.totals.pop0 * Math.pow(1 + D.params.gpYear.v, E2.t / 12)), "pop growth formula");
    E2.order.forEach(id => {
      const c = E2.cities[id], F = R2.fiscal[id];
      bad(Number.isInteger(c.pop) && Number.isInteger(c.ind) && c.pop > 0, "int/pos " + id);
      bad(Ep.cities[id].cash === F.cashBefore && c.cash === F.cashAfter, "cash continuity " + id);
      const lhs = F.cashBefore + sum(Object.values(F.rev)) - sum(Object.values(F.exp));
      bad(Math.abs(lhs - F.cashAfter) < 1e-9, `identity ${id} t${Ep.t} diff ${lhs - F.cashAfter}`);
      if (F.rev.subsidy > 0) subsidyCount[id] = (subsidyCount[id] || 0) + 1;
      debtLedger[id].push({ tax: F.rev.resTax + F.rev.indTax, subsidy: F.rev.subsidy });
      if (Ep.t === 0) fixedYear[id] = Ep.cities[id].revYear;
      else if (Ep.month === 1) fixedYear[id] = sum(debtLedger[id].slice(-13, -1).map(r => r.tax + r.subsidy));
      const estimate = fixedYear[id];
      const expectedCap = D.params.debtCapRatio.v * estimate;
      // 한도는 억 단위 소수 첫째 자리로 반올림한다. 독립 합산의 이진 소수 경계에서
      // 기대값을 먼저 반올림해 비교하지 않고 반 눈금(0.05억)+부동소수점 오차만 허용한다.
      bad(Math.abs(c.debtCap - expectedCap) <= 0.05 + 1e-9 && F.debtCap === c.debtCap,
        `v1.3 debt cap ${id} month ${Ep.t + 1}: ${c.debtCap}/${expectedCap}`);
      bad(R2.groups[id].approval >= 0 && R2.groups[id].approval <= 100, "approval range");
    });
    R2.score.rank.forEach(x => { bad(x.score >= 0 && x.score <= 100, "score range"); Object.values(x.parts).forEach(v => bad(v >= 0 && v <= 100, "part range")); });
    scan(R2, "report"); scan(E2, "E");
  } });
  bad(Object.values(subsidyCount).every(n => n === 12), "subsidy paid exactly 12x in 36 months: " + JSON.stringify(subsidyCount));
  // determinism
  const a = run({ seed: "inv" + s, months: 36, f: (() => { const R = prng(s + 7); return () => ({ e: { uns: R() * 5 } }); })() });
  const b = run({ seed: "inv" + s, months: 36, f: (() => { const R = prng(s + 7); return () => ({ e: { uns: R() * 5 } }); })() });
  bad(JSON.stringify(a.E) === JSON.stringify(b.E) && JSON.stringify(a.reps) === JSON.stringify(b.reps), "determinism");
}
// different seeds give different intl
const r1 = run({ seed: "A", months: 24 }), r2 = run({ seed: "B", months: 24 });
console.log("seed A vs B intl differ:", JSON.stringify(r1.E.intl) !== JSON.stringify(r2.E.intl));
// input objects not mutated / E0 not mutated
const E0 = X.initCities(IDS, D, { seed: "m" }), snap = JSON.stringify(E0); X.monthStep(E0, {}, D); X.yearStart(E0, D);
console.log("E0 immutable:", snap === JSON.stringify(E0));
// yearStart double pay
let E = X.initCities(IDS, D, { seed: "y" }); const c0 = E.cities.anseong.cash;
E = X.yearStart(E, D).E; const c1 = E.cities.anseong.cash; E = X.yearStart(E, D).E;
console.log("yearStart twice in same year: anseong cash", c0, "->", c1.toFixed(2), "->", E.cities.anseong.cash.toFixed(2), E.cities.anseong.cash === c1 ? "(guard ok)" : "(PAID TWICE)");
// SPEC §12 저장 호환 + v1.3: 혼합 이력은 비우되 올해 지급한 지원금은 한 번 센다.
// 7월 재개 이력에는 1월이 없으므로 세금 합에서 지원금을 빼면 안 된다.
{
  const clone = value => JSON.parse(JSON.stringify(value));
  let current = X.initCities(IDS, D, { seed: "legacy-midyear", months: 24 });
  for (let month = 0; month < 6; month++) current = X.monthStep(current, {}, D).E;
  for (const version of [undefined, 1]) {
    const legacy = clone(current);
    IDS.forEach(id => {
      if (version === undefined) delete legacy.cities[id].revenueVersion;
      else legacy.cities[id].revenueVersion = version;
      legacy.cities[id].revenueHistory = [999999];
    });
    const before = JSON.stringify(legacy), resumed = X.monthStep(legacy, {}, D);
    bad(JSON.stringify(legacy) === before, "legacy resume input immutable");
    IDS.forEach(id => {
      const fiscal = resumed.report.fiscal[id], city = resumed.E.cities[id];
      const estimate = current.cities[id].revYear;
      bad(city.revenueVersion === 2 && city.revenueHistory.length === 1, `legacy reset ${id}`);
      bad(city.debtCap === Math.round(D.params.debtCapRatio.v * estimate * 10) / 10, `legacy midyear annual subsidy once ${id}`);
    });
  }
}
console.log(`checks ${checks}, fails ${fail}`);
process.exitCode = fail ? 1 : 0;
