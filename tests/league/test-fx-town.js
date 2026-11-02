/* 품질8 W8 / V1: 기대값은 2026-10-21 승인 명세의 경계표에서 온다.
 * 기존 fx 검사처럼 node:test + VM으로 공개 API만 실행한다. 브라우저 없음.
 * 실행: node tests/league/test-fx-town.js
 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const KCP = { route() {}, on() {}, esc: String, gradeWords: String,
  leagueCore: {}, leagueNet: {} };
const context = vm.createContext({ window: { KCP, addEventListener() {} },
  document: { documentElement: {}, addEventListener() {} } });
for (const file of ["build-maps.js", "build.js", "econ-data.js", "league-data.js", "league-core.js", "league.js"]) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../../ui", file), "utf8"), context);
}

function look(V, id = "a") {
  assert.equal(typeof KCP.league?.uiMath?.cityTownLook, "function", "공개 도시 외형 계산 API");
  return KCP.league.uiMath.cityTownLook(V, id);
}
function fixture(r = 1, unsPct = 50) {
  return { econ: { cities: { a: { pop: r * 1000000, pop0: 1000000 },
    b: { pop: 930000, pop0: 1000000 } } },
  results: [{ round: 1, team: { a: { unsPct }, b: { unsPct: 100 } } }] };
}
const plain = value => JSON.parse(JSON.stringify(value));

// 각 숫자는 승인 경계표의 고정 정답이다. 제품의 계산식을 재사용하지 않는다.
for (const [label, r, houses] of [
  ["−7%", 0.93, -3], ["−6%", 0.94, -3], ["−4%", 0.96, -2],
  ["정확히 −2%", 0.98, -1], ["−2% + 1e-12", 0.98 + 1e-12, -1],
  ["시작 주민", 1, 0], ["정확히 +2%", 1.02, 1],
  ["+2% − 1e-12", 1.02 - 1e-12, 1], ["+4%", 1.04, 2],
  ["+6%", 1.06, 3], ["+7% 상한", 1.07, 3], ["+10% 상한", 1.10, 3],
  ["−10% 하한", 0.90, -3], ["−2% 안쪽(여유 밖)", 0.980001, 0],
  ["+2% 안쪽(여유 밖)", 1.019999, 0], ["주민 0", 0, -3]
]) test(`도시 주민 ${label}: 집 ${houses}채`, () => {
  const actual = look(fixture(r));
  assert.ok(actual, "유효한 도시에는 외형이 있다");
  // 0채는 음의 0과 시각적 의미가 같으므로 ===로 비교한다.
  assert.ok(actual.houses === houses, `r=${r}: 기대 ${houses}, 실제 ${actual.houses}`);
  assert.equal(actual.darkShare, 0.5, "주민 변화가 정전 비율을 바꾸지 않는다");
});

for (const [unsPct, darkShare] of [[0, 0], [0.49, 0.0049], [50, 0.5], [100, 1], [120, 1]]) {
  test(`지난달 공개 정전 ${unsPct}% → darkShare ${darkShare}`, () => {
    const actual = look(fixture(1.02, unsPct));
    assert.equal(actual?.darkShare, darkShare);
    assert.equal(actual?.houses, 1, "정전 비율이 집 수를 바꾸지 않는다");
  });
}

test("지난 결과가 없으면 첫 달 불빛을 추측하지 않는다", () => {
  const V = fixture();
  for (const results of [[], undefined]) {
    V.results = results;
    assert.deepEqual(plain(look(V)), { houses: 0, darkShare: null });
  }
});

for (const pop0 of [0, -1, NaN, undefined]) test(`시작 주민 ${String(pop0)} → null`, () => {
  const V = fixture();
  if (pop0 === undefined) delete V.econ.cities.a.pop0;
  else V.econ.cities.a.pop0 = pop0;
  assert.equal(look(V), null);
});
for (const pop of [NaN, undefined]) test(`현재 주민 ${String(pop)} → null`, () => {
  const V = fixture();
  if (pop === undefined) delete V.econ.cities.a.pop;
  else V.econ.cities.a.pop = pop;
  assert.equal(look(V), null);
});

test("경제 없는 리그·없는 도시는 null", () => {
  for (const V of [null, {}, { econ: {} }, { econ: { cities: {} } }]) assert.equal(look(V), null);
  assert.equal(look(fixture(), "absent"), null);
});

test("선택한 도시의 현재 주민과 마지막 달 정전만 읽는다", () => {
  const V = fixture(1.04, 0);
  V.results.unshift({ round: 0, team: { a: { unsPct: 100 }, b: { unsPct: 0 } } });
  V.econ.cities.a.hist = [{ pop: 7000000 }];
  // 마을별 인구·정전이 있어도 V1은 이를 사용하지 않는다.
  V.teams = { a: { plan: { towns: [{ pop: 9000000, unsPct: 100 }] } } };
  assert.deepEqual(plain(look(V, "a")), { houses: 2, darkShare: 0 });
  assert.deepEqual(plain(look(V, "b")), { houses: -3, darkShare: 1 });
});

test("같은 공개 사본은 역할과 무관하며 입력을 변경하지 않는다", () => {
  const V = fixture(0.98, 50);
  const freeze = value => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze); Object.freeze(value);
    }
    return value;
  };
  freeze(V);
  const before = JSON.stringify(V);
  for (const role of ["solo", "team", "host", "spectator"]) {
    assert.deepEqual(plain(look({ ...V, role })), { houses: -1, darkShare: 0.5 });
  }
  assert.equal(JSON.stringify(V), before);
});

test("그린 뒤 공개 상태 API는 mount 전에는 null", () => {
  assert.equal(typeof KCP.buildGame?.townLook, "function");
  assert.equal(KCP.buildGame.townLook(), null);
});
