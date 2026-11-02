"use strict";
// Investigate industry jump when one city has cheap power + high RE.
const { X, D, IDS, run } = require("./lib");
const r = run({ seed: "d", months: 14, opts: { months: 24 }, // ECON-BALANCE B10: 14달 관찰은 24턴 게임에서
 f: (id, C, E) => id === "hwaseong" && E.t < 12 ? { e: { ren: 60, costMul: 0.6 }, p: { taxRes: -2, service: 2 } } : {} });
r.reps.forEach(x => console.log("t" + x.t, "ind", x.cities.hwaseong.ind, "dInd", x.cities.hwaseong.dInd, "net", x.net.hwaseong.ind, "Aeff", x.cities.hwaseong.Aeff, "others Aeff", IDS.filter(i => i !== "hwaseong").map(i => x.cities[i].Aeff).join("/"), "price", x.cities.hwaseong.Aparts.price.toFixed(0), "re", x.cities.hwaseong.Aparts.re));
// sensitivity: only price advantage (costMul .6) for one city, vs only ren 60
for (const [lbl, e] of [["cheap power x0.6", { costMul: 0.6 }], ["ren 60%", { ren: 60 }], ["costPerMWh=0 (net exporter)", { costPer: 0 }]]) {
  const q = run({ seed: "d", months: 12, f: id => id === "asan" ? { e } : {} });
  const b = run({ seed: "d", months: 12 });
  console.log(lbl.padEnd(28), "asan 12m: pop", ((q.E.cities.asan.pop / b.E.cities.asan.pop - 1) * 100).toFixed(2) + "%", "ind", ((q.E.cities.asan.ind / b.E.cities.asan.ind - 1) * 100).toFixed(2) + "%");
}
