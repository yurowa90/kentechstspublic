"use strict";
// Who wins offers? evalOffer ranks by raw A (not anchored) + worker pool; simulate 36 months, auto-accept like league-core.
const { X, D, IDS, inputsFor } = require("./lib");
for (const seed of ["o1", "o2", "o3"]) {
  let E = X.initCities(IDS, D, { seed, months: 36 }); E = X.calibrate(E, inputsFor(E, () => ({})), D);
  const won = {}; IDS.forEach(id => won[id] = 0);
  for (let m = 0; m < 36; m++) {
    const r = X.monthStep(E, inputsFor(E, () => ({})), D); E = r.E;
    (r.report.offers || []).forEach(o => { if (r.report.t < o.until - 1) return; const best = o.eval.rank.find(id => o.eval.by[id].ok); if (best) { const a = X.acceptOffer(E, o.id, best, D); if (a.ok) { E = a.E; won[best] += a.moved; } } });
  }
  console.log(seed, "jobs won via offers (equal play):", JSON.stringify(won), " raw A:", IDS.map(id => id.slice(0, 4) + " " + E.cities[id].A.toFixed(1)).join(", "));
}
// all cities meet RE (ren 80, uns 0): offers go to highest raw A
for (const seed of ["o1", "o2", "o3"]) {
  let E = X.initCities(IDS, D, { seed, months: 36 }); E = X.calibrate(E, inputsFor(E, () => ({})), D);
  const won = {}; IDS.forEach(id => won[id] = 0);
  for (let m = 0; m < 36; m++) {
    const r = X.monthStep(E, inputsFor(E, () => ({ e: { ren: 80, spare: 99 } })), D); E = r.E;
    (r.report.offers || []).forEach(o => { if (r.report.t < o.until - 1) return; const best = o.eval.rank.find(id => o.eval.by[id].ok); if (best) { const a = X.acceptOffer(E, o.id, best, D); if (a.ok) { E = a.E; won[best] += a.moved; } } });
  }
  console.log(seed, "all ren80 → jobs won:", JSON.stringify(won));
}
// anseong maxes incentive (20/month, host cap) + ren 100; others ren 80: can it beat hwaseong's raw A?
{ let E = X.initCities(IDS, D, { seed: "o1", months: 36 }); E = X.calibrate(E, inputsFor(E, () => ({})), D);
  for (let m = 0; m < 12; m++) E = X.monthStep(E, inputsFor(E, id => id === "anseong" ? { e: { ren: 100, costMul: 0.7 }, p: { taxInd: -2, incentive: 20 } } : { e: { ren: 80 } }), D).E;
  console.log("anseong all-in (inc 20/mo, taxInd-2, ren100, cheap power) raw A after 12m:", E.cities.anseong.A.toFixed(1), "vs hwaseong", E.cities.hwaseong.A.toFixed(1)); }
