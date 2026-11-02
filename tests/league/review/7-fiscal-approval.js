"use strict";
const { X, D, IDS, run } = require("./lib");
const P = k => D.params[k].v;
// ECON-BALANCE B3: 도시별 세율 배수 대신 같은 단가와 정액 보정 지원금을 관찰한다.
const E = X.initCities(IDS, D, {});
console.log("공통 단가: 주민·산업 1만 명당 연 세입, 정액 보정 지원금(억):");
IDS.forEach(id => { const c = E.cities[id]; console.log(id, 12 * 1e4 * P("resTax"), 12 * 1e4 * P("indTax"), c.equalize); });
// ECON-BALANCE B3 B6: 배수를 끄는 비교 대신 시작 보통 조건의 연 운영 수지 눈금을 확인한다.
console.log("시작 연 운영 수지 / cash0:", IDS.map(id => { const c = E.cities[id]; const yr = 12 * (c.pop * P("resTax") + c.ind * P("indTax") - c.pop * P("svcCost")); return id + " " + ((yr + X.yearStart(E, D).subsidy[id]) / c.cash0).toFixed(2); }).join(", "));
// approval under "realistically bad" play
for (const [lbl, f] of [["uns5 tax+2 svc-2 ren0", () => ({ e: { uns: 5, ren: 0 }, p: { taxRes: 2, taxInd: 2, service: -2 } })], ["uns2 hosp tax+2 svc-2", () => ({ e: { uns: 2, hosp: 3, ren: 0 }, p: { taxRes: 2, taxInd: 2, service: -2 } })], ["policy only tax+2 svc-2", () => ({ p: { taxRes: 2, taxInd: 2, service: -2 } })]]) {
  const r = run({ seed: "a", months: 12, f });
  console.log(lbl.padEnd(26), "approval t12:", IDS.map(id => r.reps[11].groups[id].approval).join(" "), "pass:", Object.values(r.reps[11].review).map(v => v.pass).join(","));
}
// why line under neutral: does news blame tiny flows?
const r = run({ seed: "a", months: 3 });
console.log("neutral news:", r.reps.map(x => x.news.filter(n => n.includes("→")).join(" | ")).join(" || "));
