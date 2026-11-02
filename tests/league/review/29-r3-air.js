"use strict";
// H01: 실제 월 경제 경로. 결측·무배출 구별, 인접 중복/재전파/비참가 오염 방지.
const assert = require("node:assert/strict");
const { X, D, IDS, inputsFor } = require("./lib");
const clone = x => JSON.parse(JSON.stringify(x));
let checks = 0;
const near = (a, b, label) => { assert.ok(Number.isFinite(a) && Math.abs(a - b) < 1e-9, `${label}: ${a} != ${b}`); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const R = window.KCP.LEAGUE_REGIONS.south;
// D-69 결정에서 독립적으로 적은 전체 방향 계약. league-data를 기대값으로 읽지 않는다.
const landBay = [
  ["hwaseong", "pyeongtaek"], ["pyeongtaek", "anseong"],
  ["pyeongtaek", "cheonan"], ["pyeongtaek", "asan"],
  ["pyeongtaek", "dangjin"], ["anseong", "cheonan"],
  ["cheonan", "asan"], ["asan", "dangjin"]
];
const expectedPairs = landBay.flatMap(([a, b]) => [a + ">" + b, b + ">" + a]);
expectedPairs.push("dangjin>cheonan");
eq(D.airNeighbours.map(p => p.from + ">" + p.to).sort(), expectedPairs.sort(), "P 2방향·G 15방향, sea·비인접 역방향·자기 쌍 없음");
for (const p of D.airNeighbours) {
  const measured = p.from === "dangjin" && ["asan", "cheonan"].includes(p.to);
  eq(p.grade, measured ? "P" : "G", "쌍별 근거 등급");
  near(p.ratio, measured ? (p.to === "asan" ? .059 / .092 : .45) : .2, "원문 비율·대표값 또는 G 0.2");
  if (measured) {
    near(p.sourcePM25, .092, "원문 발원 수치 보존");
    eq(p.receptorPM25, p.to === "asan" ? [.059] : [.047, .037], "원문 수용 수치 보존");
    eq(p.refs, ["P61"], "P61 참조");
  } else {
    assert.ok(p.note.includes("게임 가정") && p.refs.includes("D-69")); checks++;
  }
}

const E = X.initCities(IDS, D, { seed: "s4-edges", months: 36 });
const I = inputsFor(E, () => ({}));
IDS.forEach(id => { I[id].energy.genMWh = { coal: id === "dangjin" ? 10000 : 0 }; });
const before = JSON.stringify({ E, I, D, R });
const base = X.calibrate(E, I, D), run = X.monthStep(base, I, D);
near(run.report.cities.dangjin.pm25.own, .07, "석탄 자체 증분");
near(run.report.cities.asan.pm25.delta, .07 * (.059 / .092), "이웃 증분");
near(run.report.cities.cheonan.pm25.delta, .07 * .45, "P61 두 구 범위의 대표 비율");
near(run.report.cities.pyeongtaek.pm25.delta, .07 * .2, "만 횡단 G 기여");
near(run.report.cities.hwaseong.pm25.delta, 0, "가상 해저 경로는 전파 제외");
eq(run.report.cities.dangjin.pm25.complete, true, "입력 완비");
eq(JSON.stringify({ E, I, D, R }), before, "입력·지역 자료 불변");
eq(X.monthStep(base, I, D), run, "같은 씨앗 결정성");

const missing = clone(I); delete missing.dangjin.energy.genMWh;
missing.dangjin.energy.co2Local = 999999;
const m = X.monthStep(base, missing, D).report.cities;
eq(m.dangjin.pm25.own, null, "누락은 무배출 0과 구별");
eq(m.dangjin.pm25.complete, false, "누락 표시");
eq(m.asan.pm25.complete, false, "이웃 누락도 표시");
near(m.dangjin.Lparts.air, 80, "누락 CO₂를 PM으로 역산하지 않음");
const missingG = clone(I); delete missingG.pyeongtaek.energy.genMWh;
eq(X.monthStep(base, missingG, D).report.cities.hwaseong.pm25.complete, false, "G 이웃 입력 누락도 표시");

const ties = R.ties;
try {
  R.ties = [...ties, ties[0], { a: "dangjin", b: "pyeongtaek" }, { a: "dangjin", b: "dangjin" }];
  const duplicate = X.monthStep(base, I, D).report.cities;
  near(duplicate.asan.pm25.delta, .07 * (.059 / .092), "중복·역방향 쌍 중복 계산 없음");
  near(duplicate.dangjin.pm25.delta, .07, "자기 이웃 제외");
} finally { R.ties = ties; }
const airNeighbours = D.airNeighbours;
try {
  D.airNeighbours = [...airNeighbours, airNeighbours[0], { from: "dangjin", to: "dangjin", ratio: 1 }];
  const duplicate = X.monthStep(base, I, D).report.cities;
  near(duplicate.asan.pm25.delta, .07 * (.059 / .092), "대기 목록 중복 기여 제외");
  near(duplicate.dangjin.pm25.delta, .07, "대기 목록 자기 기여 제외");
} finally { D.airNeighbours = airNeighbours; }
// 다른 지역에 같은 ID를 가진 연계선이 추가되어도 현재 대기 결과에는 영향이 없다.
try {
  window.KCP.LEAGUE_REGIONS.other = { teams: [], ties: [{ a: "dangjin", b: "anseong" }] };
  near(X.monthStep(base, I, D).report.cities.anseong.pm25.delta, 0, "다른 지역 연계선 제외");
} finally { delete window.KCP.LEAGUE_REGIONS.other; }
const reverse = clone(I);
reverse.dangjin.energy.genMWh = { coal: 0 };
reverse.asan.energy.genMWh = { coal: 10000 };
near(X.monthStep(base, reverse, D).report.cities.dangjin.pm25.delta, .07 * .2, "인접 역방향은 G 기여");
near(X.monthStep(base, reverse, D).report.cities.cheonan.pm25.delta, .07 * .2, "육지 인접 G 직접 기여만, 재전파 제외");
// 한 도시의 자체 증분만 전파: G 발원과 sea 역방향도 검사한다.
for (const source of IDS) {
  const single = clone(I);
  IDS.forEach(id => { single[id].energy.genMWh = { diesel: id === source ? 10000 : 0 }; });
  const cities = X.monthStep(base, single, D).report.cities;
  for (const target of IDS) {
    const measured = source === "dangjin" && ["asan", "cheonan"].includes(target);
    const adjacent = landBay.some(([a, b]) => (a === source && b === target) || (b === source && a === target));
    const ratio = source === target ? 1 : measured ? (target === "asan" ? .059 / .092 : .45) : adjacent ? .2 : 0;
    near(cities[target].pm25.delta, .056 * ratio, source + "→" + target + " 직접 기여만");
  }
}
const changed = clone(D);
changed.airNeighbours.find(p => p.from === "dangjin" && p.to === "asan").ratio = .3;
near(X.monthStep(base, I, changed).report.cities.asan.pm25.delta, .07 * .3, "비율은 자료에서만 읽음");
const two = X.initCities(["asan", "cheonan"], D);
const subset = X.calibrate(two, I, D);
near(subset.cities.asan.lagL.air, 80, `비참가 ${R.teams.find(t => t.id === "dangjin").name} 입력 제외`);
const inactive = clone(I); inactive.pyeongtaek.energy.genMWh = { diesel: 10000 };
const active = X.monthStep(subset, inactive, D).report.cities;
for (const id of ["asan", "cheonan"]) {
  near(active[id].pm25.delta, 0, "비참가 P·G 발원 모두 제외");
  eq(active[id].pm25.complete, true, "비참가 입력은 완비 여부에도 영향 없음");
}
const dirty = clone(I);
dirty.dangjin.energy.genMWh = { coal: -100, lng: NaN, diesel: Infinity, biomass: "100" };
const clean = X.monthStep(base, dirty, D).report.cities;
near(clean.dangjin.pm25.delta, 0, "비정상 발전량 유한·비음수 처리");
const huge = clone(I); huge.dangjin.energy.genMWh.coal = 1e7;
const clamped = X.calibrate(E, huge, D).cities.dangjin;
near(clamped.lagL.air, 0, "이주용 air 하한");
near(clamped.groupParts.air, 0, "집단 air 하한");

// 지도 표시 문구의 번역·변경과 숫자 환산의 독립성.
const scale = R.scale;
try {
  R.scale = "축척 문구를 바꾼 가상 지도";
  near(2 * R.mwScale, 460, "게임 2MW → 실제 460MW");
} finally { R.scale = scale; }
console.log(`S4 H01/H03/H04 pass ${checks} fail 0`);
