"use strict";
// One city deviates (policy fixed all game), others neutral. Score/pop/cash vs baseline.
const { X, D, IDS, run } = require("./lib");
const steps = [-2, 0, 2];
for (const city of ["hwaseong", "anseong"]) for (const months of [12, 36]) {
  const base = run({ seed: "g", months }); const b = base.reps[months - 1].score.by[city];
  const res = [];
  for (const tr of steps) for (const ti of steps) for (const sv of steps) for (const inc of [0, 2, 10]) {
    const r = run({ seed: "g", months, f: id => id === city ? { p: { taxRes: tr, taxInd: ti, service: sv, incentive: inc } } : {} });
    const s = r.reps[months - 1].score.by[city], c = r.E.cities[city];
    res.push({ k: `R${tr} I${ti} S${sv} inc${inc}`, score: s.score, rank: s.rank, dpop: ((c.pop / base.E.cities[city].pop - 1) * 100).toFixed(2), dind: ((c.ind / base.E.cities[city].ind - 1) * 100).toFixed(2), cash: c.cash.toFixed(0), appr: c.approval.toFixed(1), parts: JSON.stringify(s.parts) });
  }
  res.sort((a, b) => b.score - a.score);
  console.log(`\n== ${city} ${months}m  baseline score ${b.score} rank ${b.rank} cash ${base.E.cities[city].cash.toFixed(0)} appr ${base.E.cities[city].approval.toFixed(1)}`);
  [...res.slice(0, 4), ...res.slice(-2)].forEach(x => console.log(x.k.padEnd(20), "score", x.score, "rank", x.rank, "dPop%", x.dpop, "dInd%", x.dind, "cash", x.cash, "appr", x.appr, x.parts));
}
