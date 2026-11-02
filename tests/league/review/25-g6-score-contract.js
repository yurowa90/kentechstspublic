"use strict";
// D4: 순위 균형을 맞추더라도 탄소 감축의 보상·0점 항목·공개 재계산을 유지한다.
const assert = require("node:assert/strict");
const { X, D, IDS } = require("./lib");
const clone = x => JSON.parse(JSON.stringify(x));
const E = X.initCities(IDS, D, { seed: "g6-carbon-counterfactual", months: 36 });
let checks = 0;
const ok = (x, label) => { assert.ok(x, label); checks++; };
// D-73: 옛 단일 절대 선형식 → 세 기준점 절대 눈금과 시작 대비 감축 눈금의 큰 값.
// 두 구간을 선형 보간한다. 구현 carbonScore·반환 parts를 oracle로 쓰지 않는다.
const unit = x => Math.max(0, Math.min(1, x));
function b80(I, I0) {
  const W = D.params.scoreCo2Worst.v, T = D.params.scoreCo2Best.v;
  const M = D.params.scoreCo2Mid.v, cut = D.params.scoreCo2RelCut.v;
  const absolute = I >= T ? M * unit((W - I) / (W - T)) : M + (100 - M) * unit((T - I) / T);
  const r = 1 - I / I0;
  const relative = r <= cut ? M * unit(r / cut) : M + (100 - M) * unit((r - cut) / (1 - cut));
  return Math.max(absolute, relative);
}
for (const id of IDS) {
  // D-73: 옛 W→0/중간→50/T→100을 W→0/T→80/0→100 B80 세 점으로.
  // 절대 눈금·0점 집계는 I0=국가 계수로 고정해 상대 보상이 가리지 않게 한다.
  // 실제 도시 시작값의 상대 보상은 아래 0/10/40/100% 감축에서 별도로 모두 검사한다.
  const rows = [D.params.scoreCo2Worst.v, D.params.scoreCo2Best.v, 0].map(intensity => {
    const state = clone(E); state.cities[id].co2Intensity = intensity;
    state.cities[id].co2Intensity0 = D.params.normalCo2.v;
    return X.score(state, D).by[id];
  });
  ok(rows.map(r => r.parts.co2).join(",") === "0,80,100", `${id} 절대 탄소 goalpost 유지`);
  ok(rows[0].score < rows[1].score && rows[1].score < rows[2].score, `${id} 다른 조건 고정: 탄소 감축의 총점 보상`);
  const start = E.cities[id].co2Intensity0;
  for (const cut of [0, .1, .4, 1]) {
    const changed = clone(E), intensity = start * (1 - cut);
    changed.cities[id].co2Intensity = intensity;
    ok(Math.abs(X.score(changed, D).by[id].parts.co2 - b80(intensity, start)) <= .051,
      `${id} D-73 감축률${cut}: max(절대, 상대), 공개 부분점수 0.1점 반올림`);
  }
  // G6 하한30에 가려졌던 화석 구간도 감축이 총점에 반영되어야 한다.
  const fossil = [.80, .75, .70, .66].map(intensity => {
    const state = clone(E); state.cities[id].co2Intensity = intensity;
    state.cities[id].co2Intensity0 = D.params.normalCo2.v;
    return X.score(state, D).by[id];
  });
  ok(fossil.every((row, i) => !i || row.score > fossil[i - 1].score), `${id} 탄소 부분점수30 미만 감축 총점 보상`);
  const state = clone(E);
  Object.assign(state.cities[id], { co2Intensity: D.params.scoreCo2Worst.v, co2Intensity0: D.params.normalCo2.v, unsS: 100, cash: -2 * E.cities[id].debtCap });
  const before = JSON.stringify(state), out = X.score(state, D);
  ok(out.by[id].parts.co2 === 0 && out.by[id].parts.rel === 0 && out.by[id].parts.fin === 0,
    `${id} 부분점수0을 표시값에서 감추지 않음`);
  const expected = Object.entries(D.params.wScore.v).reduce((p, [k, w]) =>
    p * Math.pow(Math.max(1, out.by[id].parts[k]), w), 1);
  ok(Math.abs(out.by[id].score - expected) <= .051 && out.aggregation.floor === 1 &&
    out.aggregation.formula.includes("max(1,"), `${id} 0 항목 포함: 독립 곱 집계·공개식의 하한1`);
  ok(out.rank.every(r => Number.isFinite(r.score) && r.score >= 0 && r.score <= 100), `${id} 0 항목도 유한·범위 유지`);
  ok(JSON.stringify(out) === JSON.stringify(X.score(clone(state), D)) && JSON.stringify(state) === before,
    `${id} 결정성·직렬화 재계산·입력 불변`);
}
console.log(`G7 점수 계약: ${checks} 통과, 0 실패`);
