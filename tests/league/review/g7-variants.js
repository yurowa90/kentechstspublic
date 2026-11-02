"use strict";
// G7 진단 전용. 제품 기본값은 바꾸지 않으며 M/P/O 키 불변을 검사한다.
const variants = {
  need72: { need: 72 }, need144: { need: 144 },
  fuel2: { fuel: 2 }, fuel4: { fuel: 4 }
};
function evidence(K) {
  return JSON.stringify([K.ECON_DATA.params, K.TECH_DATA.params].map(params =>
    Object.fromEntries(Object.entries(params).filter(([, p]) => p.grade !== "G"))));
}
function apply(K, name) {
  const opt = variants[name];
  if (!opt) throw Error("Unknown G7 variant: " + name);
  const before = evidence(K), card = K.TECH_DATA.cards.find(c => c.id === "smr");
  if (opt.need) {
    if (card.numbers.need.grade !== "G") throw Error("need is not G");
    card.need = card.numbers.need.v = opt.need;
  }
  if (opt.fuel) {
    if (K.ECON_DATA.params.smrFuelMul.grade !== "G") throw Error("fuel multiplier is not G");
    K.ECON_DATA.params.smrFuelMul.v = opt.fuel;
  }
  if (evidence(K) !== before) throw Error("G7 근거 키 변경 금지");
}
module.exports = { apply, variants };
