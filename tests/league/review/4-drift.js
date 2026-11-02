"use strict";
// Passive drift (all neutral, same per-capita energy) and calibrate sensitivity; snowball test.
const { X, D, IDS, run, sum } = require("./lib");
const pct = (E, id, k) => ((E.cities[id][k] / E.cities[id][k + "0"]) / (E.totals[k] / E.totals[k + "0"]) * 100 - 100).toFixed(2);
for (const calib of [true, false]) {
  const r = run({ seed: "d", months: 36, calib });
  console.log(`\n-- neutral 36m calibrate=${calib}: relative share change % (pop / ind), month-1 Leff, final score`);
  IDS.forEach(id => console.log(id.padEnd(11), pct(r.E, id, "pop").padStart(7), pct(r.E, id, "ind").padStart(7), " Leff", r.reps[0].cities[id].Leff, " Aeff", r.reps[0].cities[id].Aeff, " score", r.reps[35].score.by[id].score, "rank", r.reps[35].score.by[id].rank));
  console.log("  month1 news:", r.reps[0].news.slice(-2).join(" / "));
}
// Snowball: hwaseong gets a permanent advantage (ren 60, cheap power, svc+2, tax-2) for 12 months then returns to neutral. Does its lead keep growing?
const r = run({ seed: "d", months: 36, f: (id, C, E) => id === "hwaseong" && E.t < 12 ? { e: { ren: 60, costMul: 0.6 }, p: { taxRes: -2, service: 2 } } : { p: { taxRes: 0, service: 0 } } });
console.log("\n-- hwaseong boosted months 0-11 then neutral: share change % at t=12,24,36");
[11, 23, 35].forEach(t => { const rep = r.reps[t]; console.log(" t" + (t + 1), "pop", ((rep.cities.hwaseong.pop / D.start.hwaseong.pop0) / (rep.totals.pop / rep.totals.pop0) * 100 - 100).toFixed(2), "ind", ((rep.cities.hwaseong.ind / D.start.hwaseong.ind0) / (rep.totals.ind / rep.totals.ind0) * 100 - 100).toFixed(2), "Leff", rep.cities.hwaseong.Leff, "labor part", rep.cities.hwaseong.Aparts.labor); });
// Drain: one city great, all others outage 5% for 36 months
const r2 = run({ seed: "d", months: 36, f: id => id === "anseong" ? { e: { ren: 80, costMul: 0.6 }, p: { taxRes: -2, taxInd: -2, service: 2, incentive: 5 } } : { e: { uns: 5 } } });
console.log("\n-- anseong ideal, others 5% outage 36m: anseong pop", r2.E.cities.anseong.pop, "(x" + (r2.E.cities.anseong.pop / D.start.anseong.pop0).toFixed(2) + ") ind", r2.E.cities.anseong.ind, "(x" + (r2.E.cities.anseong.ind / D.start.anseong.ind0).toFixed(2) + ")  crowd part", r2.reps[35].cities.anseong.Lparts.crowd, "land", r2.reps[35].cities.anseong.Aparts.land);
// Outage magnitude: one city 5% outage for 12 months then fixes
const r3 = run({ seed: "d", months: 36, f: (id, C, E) => id === "pyeongtaek" && E.t < 12 ? { e: { uns: 5 } } : {} });
const base = run({ seed: "d", months: 36 });
console.log("\n-- pyeongtaek 5% outage months 0-11 (vs baseline): pop diff by month");
[0, 2, 5, 11, 17, 23, 35].forEach(t => console.log("  t" + (t + 1), "dPop", r3.reps[t].cities.pyeongtaek.pop - base.reps[t].cities.pyeongtaek.pop, "dInd", r3.reps[t].cities.pyeongtaek.ind - base.reps[t].cities.pyeongtaek.ind, "appr", r3.reps[t].groups.pyeongtaek.approval, "out", r3.reps[t].cities.pyeongtaek.out, "news:", (r3.reps[t].news.find(n => n.includes(r3.E.cities.pyeongtaek.name + " →")) || "")));
// Lag: tax +2 change at t=0, how many months until 90% of L effect?
const r4 = run({ seed: "d", months: 12, f: id => id === "cheonan" ? { p: { taxRes: 2 } } : {} });
console.log("\n-- cheonan taxRes +2: lagL.tax by month", r4.reps.map(x => x.cities.cheonan.Lparts.tax).slice(0, 1), "eff L:", r4.reps.map(x => x.cities.cheonan.Leff).join(","));
