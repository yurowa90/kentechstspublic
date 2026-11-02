"use strict";
const path = require("path");
const ROOT = process.env.KCP_ROOT || path.resolve(__dirname, "../../..");
global.window = { KCP: {} };
Math.random = () => { throw new Error("Math.random used"); };
// 화면 설명까지 복제하는 검사도 실제 앱의 기술 → 경제 자료 순서를 따른다.
require(path.join(ROOT, "ui/tech-data.js"));
require(path.join(ROOT, "ui/econ-data.js"));
require(path.join(ROOT, "ui/econ.js"));
require(path.join(ROOT, "ui/league-data.js"));
const X = window.KCP.econ, D = window.KCP.ECON_DATA;
const IDS = Object.keys(D.start);
const sum = a => a.reduce((s, x) => s + x, 0);
// my own plausible energy input: scale by population (game units: cost 억, co2 t)
function energy(id, C, o = {}) {
  const days = 30, dem = (C.pop / 1e5) * 25 * days; // MWh-ish game units
  const cost = 0.012 * (o.costMul || 1);
  return {
    unsPct: o.uns || 0, hospH: o.hosp || 0, costPerMWh: o.costPer != null ? o.costPer : cost,
    co2Local: (C.pop / 1e5) * 2.5 * days * (o.co2Mul || 1), co2: (C.pop / 1e5) * 4 * days * (o.co2Mul || 1),
    renPct: o.ren == null ? 15 : o.ren, tradeNet: o.trade || 0, opex: dem * cost, capexNew: o.capex || 0,
    demMWh: dem, spareMW: o.spare == null ? 1 : o.spare
  };
}
function inputsFor(E, f) { const I = {}; E.order.forEach(id => { const r = f(id, E.cities[id], E) || {}; I[id] = { energy: energy(id, E.cities[id], r.e || {}), policy: r.p || {} }; }); return I; }
function run({ seed = "s", months = 36, f = () => ({}), calib = true, ids = IDS, data = D, opts = {}, onStep } = {}) {
  let E = X.initCities(ids, data, Object.assign({ seed, months }, opts));
  if (calib) E = X.calibrate(E, inputsFor(E, () => ({})), data);
  const reps = [];
  for (let m = 0; m < months; m++) { const I = inputsFor(E, f); const Ep = E; const r = X.monthStep(E, I, data); if (onStep) onStep(Ep, r, I); E = r.E; reps.push(r.report); }
  return { E, reps };
}
module.exports = { X, D, IDS, sum, energy, inputsFor, run };
