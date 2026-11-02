"use strict";
// G6 비교 전용: 물리·정책·씨앗은 그대로, 공개 score()의 집계만 교체한다.
// 실제 제품 기본값과 독립적으로 G5 기준을 보존하므로 최종 채택 뒤에도 재현 가능하다.
const variants = {
  baseline: {}, a10: { floor: 10 }, a30: { floor: 30 }, selected: { floor: 30, need: 360 },
  b: { relative: true }, c: { regional: true },
  d72: { need: 72 }, d144: { need: 144 },
  d216: { need: 216 }, d288: { need: 288 }, d360: { need: 360 }, d396: { need: 396 }, d432: { need: 432 }
};
function apply(K, name) {
  const opt = variants[name];
  if (!opt) throw Error("Unknown G6 variant: " + name);
  const D = K.ECON_DATA, X = K.econ;
  const weights = { pop: .10, ind: .10, fin: .125, co2: .275, appr: .15, rel: .25 };
  D.params.wScore.v = weights;
  if (D.params.scorePartFloor) D.params.scorePartFloor.v = opt.floor || 1;
  const card = K.TECH_DATA.cards.find(c => c.id === "smr");
  card.need = card.numbers.need.v = opt.need || 36;
  const original = X.score, clamp = x => Math.max(0, Math.min(100, x));
  X.score = (E, data = D) => {
    const out = original(E, data), w = weights, floor = opt.floor || 1;
    const worst = opt.regional ? Math.max(...E.order.map(id => E.cities[id].co2Intensity0)) * 1.01 : data.params.scoreCo2Worst.v;
    for (const id of E.order) {
      const c = E.cities[id], row = out.by[id], intensity = c.co2Intensity ?? c.co2Intensity0 ?? data.params.co2IntDef.v;
      const absolute = clamp(100 * (worst - intensity) / (worst - data.params.scoreCo2Best.v));
      const relative = clamp(50 + 50 * (1 - intensity / Math.max(1e-9, c.co2Intensity0)));
      row.parts.co2 = Math.round((opt.relative ? (absolute + relative) / 2 : absolute) * 10) / 10;
      row.score = Math.round(clamp(Math.exp(Object.keys(w).reduce((sum, k) => sum + w[k] * Math.log(Math.max(floor, row.parts[k])), 0)) + (E.coop || 0)) * 10) / 10;
    }
    out.rank.sort((a,b) => b.score - a.score || E.order.indexOf(a.id) - E.order.indexOf(b.id));
    out.rank.forEach((r,i) => {r.rank = i + 1;});
    out.aggregation = { name: "균형 점수", floor, weights: { ...w },
      formula: `exp(Σ w × ln(max(${floor}, 부분 점수)) / Σ w) + 공동 보너스` };
    return out;
  };
}
module.exports = { apply, variants };
