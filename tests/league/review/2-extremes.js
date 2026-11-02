"use strict";
const { X, D, IDS, sum, run } = require("./lib");
const clone = x => JSON.parse(JSON.stringify(x));
const show = (lbl, r) => { const E = r.E, last = r.reps[r.reps.length - 1]; console.log(lbl, E.order.map(id => `${id}: pop ${E.cities[id].pop} cash ${E.cities[id].cash.toFixed(0)} appr ${E.cities[id].approval.toFixed(1)} sc ${last.score.by[id].score}`).join(" | ")); console.log("   sum ok:", sum(E.order.map(id => E.cities[id].pop)) === E.totals.pop); };
// A) everyone unsPct 100, tax +2 / -2
show("A uns100 tax+2:", run({ seed: "x", months: 36, f: () => ({ e: { uns: 100, hosp: 10 }, p: { taxRes: 2, taxInd: 2, service: -2 } }) }));
show("A' all tax-2 svc+2:", run({ seed: "x", months: 36, f: () => ({ p: { taxRes: -2, taxInd: -2, service: 2 } }) }));
// B) cash deeply negative
const rb = run({ seed: "x", months: 36, opts: { cash: { anseong: -1e6 } } });
// ECON-BALANCE B3 B5: 제거된 fk·cash 점수 대신 정액 보정·fin을 표시한다.
const fb = rb.reps[0].fiscal.anseong; console.log("B cash -1e6: month1 interest", fb.exp.interest, "debtCap", fb.debtCap, "final cash", rb.E.cities.anseong.cash.toFixed(0), "equalize", rb.E.cities.anseong.equalize, "score.fin", rb.reps[35].score.by.anseong.parts.fin);
// ECON-BALANCE B3: 시작 현금 규모에 따른 정액 보정 지원금 비교
// ECON-BALANCE B3 B5: 제거된 fk·cash 점수 대신 정액 보정·fin을 표시한다.
console.log("   equalize(anseong cash160)=", X.initCities(IDS, D, {}).cities.anseong.equalize, " equalize(cash 0)=", X.initCities(IDS, D, { cash: { anseong: 0 } }).cities.anseong.equalize, " equalize(cash 1000)=", X.initCities(IDS, D, { cash: { anseong: 1000 } }).cities.anseong.equalize);
// C) zero-pop city in custom data
const D2 = clone(D); D2.start.ghost = Object.assign({}, D2.start.anseong, { name: "유령", pop0: 0, ind0: 0 });
try { const rc = run({ seed: "x", months: 12, data: D2, ids: [...IDS, "ghost"] }); const E = rc.E;
  console.log("C zero-pop: ghost pop", E.cities.ghost.pop, "ind", E.cities.ghost.ind, "sum pop", sum(E.order.map(id => E.cities[id].pop)), "totals", E.totals.pop, "=> conserved?", sum(E.order.map(id => E.cities[id].pop)) === E.totals.pop, "score", rc.reps[11].score.by.ghost.score);
} catch (e) { console.log("C zero-pop threw:", e.message); }
// D) single city / empty
try { const rd = run({ seed: "x", months: 12, ids: ["anseong"] }); console.log("D single city ok, pop", rd.E.cities.anseong.pop, "score", rd.reps[11].score.by.anseong.score); } catch (e) { console.log("D single threw", e.message); }
try { const E = X.initCities([], D, {}); console.log("D empty ids -> order:", JSON.stringify(E.order), "(falls back to all?)"); const r = X.monthStep(E, {}, D); console.log("   monthStep empty ok, totals", JSON.stringify(r.E.totals)); } catch (e) { console.log("D empty threw", e.message); }
// E) garbage inputs
try { const E = X.initCities(IDS, D, {}); const r = X.monthStep(E, { anseong: { energy: { unsPct: "abc", tradeNet: Infinity, opex: -5, costPerMWh: -1 }, policy: { taxRes: 99, incentive: -1 } } }, D); console.log("E garbage ok, anseong policy", JSON.stringify(r.E.cities.anseong.policy), "cash", r.E.cities.anseong.cash.toFixed(2)); } catch (e) { console.log("E garbage threw", e.message); }
// F) no-input months: does game ever end? (len not enforced)
let E = X.initCities(IDS, D, { months: 12 }); for (let i = 0; i < 40; i++) E = X.monthStep(E, {}, D).E; // ECON-BALANCE B10: 종료 뒤 40번 호출해도 t=12 유지
console.log("F months:12 game, after 40 steps t=", E.t, "len=", E.len, "(monthStep respects len)");
