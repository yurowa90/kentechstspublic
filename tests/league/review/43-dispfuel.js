'use strict';
// 독립 계약: 팩 fuel.diesel / TECH_DATA.params.smrFuel가 단가의 원천이다.
// dispFuel·dispOf·g.mc의 구현으로 기대값을 만들지 않는다. VM 사본만 변이한다.
// 실행: node tests/league/review/43-dispfuel.js [검사할 build.js 사본 경로]
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../../..');
const buildPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'ui/build.js');
const sources = Object.fromEntries(['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']
  .map(name => [name, fs.readFileSync(name === 'build' ? buildPath : path.join(ROOT, `ui/${name}.js`), 'utf8')]));
const clone = value => JSON.parse(JSON.stringify(value));
// 자료에 별도 항목이 없는 엔진 상수(사용자 계약). 디젤은 팩 값 부재 시에만 사용.
const ENGINE = { dieselFallback: 0.01, biomass: 0.02, livestockBiomass: 0.012, lng: 0.008, coal: 0.0045 };
const DIESEL_CO2 = 0.75; // 사용자 계약의 디젤 배출계수(t/MWh).
const INDEX = 1.7; // 검사용 국제 지수. 단가의 기대값이 아니다.
const groups = new Map();
let passed = 0, failed = 0;
function test(group, label, fn) {
  const counts = groups.get(group) || { passed: 0, failed: 0 };
  groups.set(group, counts);
  try { fn(); passed++; counts.passed++; console.log(`PASS ${label}`); }
  catch (error) { failed++; counts.failed++; console.error(`FAIL ${label}: ${error.message}`); }
}
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-10,
    `${label}: 실제 ${actual}, 기대 ${expected}`);
}
function load({ build = sources.build, mutateMaps } = {}) {
  const ctx = vm.createContext({ console,
    document: { documentElement: {}, addEventListener() {} }, addEventListener() {},
    KCP: { route() {}, on() {}, esc: String } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("씨앗 없는 난수 금지"); };', ctx);
  let maps, smrFuel;
  for (const [name, original] of Object.entries(sources)) {
    vm.runInContext(name === 'build' ? build : original, ctx, { filename: `VM:ui/${name}.js`, timeout: 5000 });
    if (name === 'build-maps') {
      if (mutateMaps) mutateMaps(ctx.KCP.BUILD_MAPS);
      // build의 팩 가공·캐시 생성 전 원자료를 따로 보관한다.
      maps = clone(ctx.KCP.BUILD_MAPS);
    }
    if (name === 'tech-data') smrFuel = ctx.KCP.TECH_DATA.params.smrFuel.v;
  }
  return { B: ctx.KCP.buildGame, C: ctx.KCP.leagueCore, maps, smrFuel,
    econParams: clone(ctx.KCP.ECON_DATA.params) };
}
const dieselPrice = pack => pack.fuel?.diesel ?? ENGINE.dieselFallback;
// 축산 인접 여부는 raw pack의 축산 시설 좌표와 지도 이웃 관계로 판단한다.
// 검사 대상인 tile.livestock 플래그를 기대값·타일 선정에 쓰지 않는다.
function livestockNeighbor(h, id, tile) {
  return (h.maps[id].sites || []).some(site => site.kind === 'livestock' &&
    tile.nb.some(i => h.B.TILES[i].c === site.c && h.B.TILES[i].r === site.r));
}
function sourceContract(h, id, kind, tile) {
  const expected = kind === 'diesel' ? dieselPrice(h.maps[id]) : kind === 'smr' ? h.smrFuel :
    kind === 'biomass' ? (livestockNeighbor(h, id, h.B.TILES[tile]) ? ENGINE.livestockBiomass : ENGINE.biomass) : ENGINE[kind];
  near(h.B.dispFuel(kind, tile), expected, `${id} ${kind} 원천 단가`);
}
// 설비 1기·선분 1개. 계획 선정에는 운전 결과나 단가를 사용하지 않는다.
// 기존 발전소와 계통 노드를 같은 망에 붙이지 않아 cost.fuel 전체가 디젤 몫이다.
function smallPlan(B) {
  for (const tile of B.TILES) {
    if (B.siteRule('diesel', tile)) continue;
    for (const neighbor of tile.nb) {
      if (B.TILES[neighbor].out) continue;
      const plan = { builds: [{ t: 'diesel', i: tile.i }], lines: [{ p: [tile.i, neighbor] }],
        policies: [], seed: 41, season: 'summer' };
      const st = B.sanitize(plan, 1e6), net = B.network(st);
      const component = net.comps.find(c => c.disp.some(g => g.kind === 'diesel'));
      if (st.builds.length === 1 && st.lines.length === 1 && component?.towns.length &&
          component.disp.every(g => g.kind === 'diesel')) return plan;
    }
  }
  assert.fail('다른 연료·계통과 분리된 디젤 1기 계획을 찾지 못함');
}
// SMR·바이오매스도 각각 독립된 1기 계획. 운전 결과·단가로 계획을 고르지 않는다.
function smallFuelPlan(h, id, kind, livestock = false) {
  const B = h.B;
  for (const tile of B.TILES) {
    if (B.siteRule(kind, tile) ||
        (kind === 'biomass' && livestockNeighbor(h, id, tile) !== livestock)) continue;
    for (const neighbor of tile.nb) {
      if (B.TILES[neighbor].out) continue;
      const plan = { builds: [{ t: kind, i: tile.i }], lines: [{ p: [tile.i, neighbor] }],
        policies: [], seed: 41, season: 'summer' };
      const st = B.sanitize(plan, 1e6), net = B.network(st);
      const component = net.comps.find(c => c.disp.some(g => g.kind === kind));
      // 천안의 유일한 SMR 입지는 import 옆이다. 리그 import는 용량 0이며,
      // unitCost가 실제 import 발전량 0도 확인하므로 연료비가 섞이지 않는다.
      if (st.builds.length === 1 && st.lines.length === 1 && component?.towns.length &&
          component.disp.every(g => g.kind === kind || g.kind === 'import') &&
          !component.ren.length && !component.bat.length) return plan;
    }
  }
  assert.fail(`${id} ${kind} ${livestock ? '축산' : '일반'} 분리된 1기 계획을 찾지 못함`);
}
function unitCost(result, target = 'diesel') {
  assert.ok(result.tot.by[target] > 0, `분모: 실제 ${target} 발전량 > 0`);
  for (const [kind, mwh] of Object.entries(result.tot.by)) {
    if (kind !== target) near(mwh, 0, `${kind} 발전량 0: 연료비 혼입 방지`);
  }
  near(result.tot.batDebt, 0, '배터리 잔량 보충비 없음');
  near(result.cost.fuel, result.tot.fuel, '비용 장부와 운전 연료비 동일');
  return result.cost.fuel / result.tot.by[target];
}
function fuelEngineContract(h, id, kind, plan, livestock, index) {
  const B = h.B;
  B.selectPack(id, 'league');
  const st = B.sanitize(plan, 1e6);
  assert.equal(st.builds.length, 1, `${kind} 1기 유지`);
  assert.equal(st.builds[0].t, kind, '검사할 발전원 유지');
  assert.equal(st.policies.length, 0, '세금 없는 연료 단가 실측');
  const tile = st.builds[0].i;
  if (kind === 'biomass') assert.equal(livestockNeighbor(h, id, B.TILES[tile]), livestock, '원자료의 축산 입지');
  const result = B.simulate(st, 1, { league: true, mods: { fuelMul: { [kind]: index } } });
  const actual = unitCost(result, kind);
  const expected = kind === 'smr' ? h.smrFuel : livestock ? ENGINE.livestockBiomass : ENGINE.biomass;
  near(actual, expected * index, `${kind} 엔진 단가 = 원자료×지수`);
  near(actual, B.dispFuel(kind, tile) * index, `${kind} 엔진 단가 = dispFuel×지수`);
  return actual;
}
function engineContract(h, id, plan, { index = 1, tax = false, explicit = false } = {}) {
  const B = h.B;
  B.selectPack(id, 'league');
  const st = B.sanitize({ ...plan, policies: tax ? ['tax'] : [] }, 1e6);
  assert.equal(st.builds.length, 1, '디젤 1기 유지');
  assert.equal(st.policies.includes('tax'), tax, '탄소세 정책 유지');
  const mods = explicit || index !== 1 ? { fuelMul: { diesel: index } } : undefined;
  const result = B.simulate(st, 1, { league: true, mods });
  const actual = unitCost(result), surcharge = tax ? DIESEL_CO2 * B.M.taxPerT : 0;
  assert.equal(result.pol.tax, tax, '실제 운전의 탄소세 적용 여부');
  near(actual, dieselPrice(h.maps[id]) * index + surcharge, '엔진 단가 = 원자료×지수 + 탄소세');
  near(actual, B.dispFuel('diesel', st.builds[0].i) * index + surcharge, '엔진 단가 = dispFuel×지수 + 탄소세');
  return actual;
}
// 변이 탐지는 계약 단언 실패만 센다. 문법·하네스 오류를 탐지 성공으로 세지 않는다.
function caught(fn) {
  try { fn(); return false; }
  catch (error) { if (error instanceof assert.AssertionError) return true; throw error; }
}
function mutation(label, fn) {
  test('변이', label, () => {
    let detected = false;
    try { detected = fn(); }
    finally { console.log(`변이 ${label}: ${detected ? '잡힘' : '안 잡힘'}`); }
    assert.ok(detected, `${label}: 변이가 계약 검사에 잡혀야 함`);
  });
}

try {
  const h = load(), B = h.B;
  test('API', 'dispFuel 공개 함수 존재', () => assert.equal(typeof B.dispFuel, 'function', 'dispFuel 부재'));
  // 부재를 TypeError 수십 개로 덮지 않고 명시적인 계약 실패 1건으로 보고한다.
  if (typeof B.dispFuel === 'function') {
    const ids = Object.keys(B.PACKS);
    const teams = h.C.regionOf('south').teams.map(t => ({ id: t.id, pack: t.pack }));
    const leagueIds = [...new Set(teams.map(t => t.pack))];
    test('범위', `PACKS 전부·리그 다섯 도시·${h.C.teamDef(h.C.regionOf('south'), 'pyeongtaek').name}·연습 섬 포함`, () => {
      assert.deepEqual([...ids].sort(), Object.keys(h.maps).sort());
      assert.ok(ids.includes('island') && leagueIds.includes('pyeongtaek'));
      assert.equal(ids.filter(id => h.maps[id].league).length, 5);
      assert.equal(leagueIds.length, 6);
      for (const id of leagueIds) assert.ok(ids.includes(id), `${id} 팩 존재`);
    });
    for (const id of ids) {
      B.selectPack(id, h.maps[id].league ? 'league' : undefined);
      const normal = B.TILES.find(tile => !tile.out && !livestockNeighbor(h, id, tile));
      assert.ok(normal, `${id} 일반 타일 존재`);
      for (const kind of ['diesel', 'biomass', 'lng', 'coal', 'smr']) {
        test('팩 원천', `${id} ${kind} 일반 타일 원천`, () => sourceContract(h, id, kind, normal.i));
      }
      const livestock = B.TILES.find(tile => !tile.out && livestockNeighbor(h, id, tile));
      if (livestock) test('축산', `${id} biomass 축산 인접 할인`, () => sourceContract(h, id, 'biomass', livestock.i));
    }
    for (const id of leagueIds) {
      test('도시 차이', `${id} 디젤은 팩 값이며 연습 섬과 다름`, () => {
        B.selectPack('island');
        const islandPrice = B.dispFuel('diesel', 0);
        B.selectPack(id, 'league');
        near(B.dispFuel('diesel', 0), h.maps[id].fuel.diesel, '도시 팩의 명시 단가');
        assert.notEqual(B.dispFuel('diesel', 0), islandPrice, '팩 전환 시 연습 섬 단가 잔류 방지');
      });
    }
    const plans = new Map();
    for (const id of leagueIds) {
      B.selectPack(id, 'league');
      const plan = smallPlan(B);
      plans.set(id, plan);
      for (const [label, options] of [
        ['지수 기본 1', {}], ['MODS 지수 1', { explicit: true }], ['MODS 지수 비1', { index: INDEX }],
        ['탄소세·지수 1', { tax: true }], ['탄소세·지수 비1', { tax: true, index: INDEX }]
      ]) test(options.tax ? '탄소세' : '엔진', `${id} ${label} 실측 단가`, () => engineContract(h, id, plan, options));
    }
    const fuelPlans = new Map();
    for (const id of leagueIds) {
      B.selectPack(id, 'league');
      const cases = [['smr', false, 'SMR'], ['biomass', true, '축산 인접 바이오매스'],
        ['biomass', false, '일반 바이오매스']];
      fuelPlans.set(id, cases.map(([kind, livestock, label]) => ({ kind, livestock, label,
        plan: smallFuelPlan(h, id, kind, livestock) })));
      for (const { kind, livestock, label, plan } of fuelPlans.get(id)) {
        for (const index of [1, INDEX]) test('비디젤 엔진', `${id} ${label} 지수 ${index} 실측 단가`,
          () => fuelEngineContract(h, id, kind, plan, livestock, index));
      }
      test('계통 자료', `${id} import 단가와 계통 보충 자료 단가 일치`, () => {
        B.selectPack(id, 'league');
        // 리그 import 노드는 용량 0: 실측 불가, 자료 값 대조만.
        // build.js import 단가와 league-core 계통 보충의 두 자료 원천을 대조한다.
        near(B.dispFuel('import', 0), h.econParams.normalCost.v * h.econParams.gridImportMarkup.v,
          'import 단가 = normalCost×gridImportMarkup');
      });
    }
    // league-ai가 예측에 쓰는 실제 simTeam 경로도 같은 작은 계획으로 검사한다.
    for (const team of teams) test('simTeam', `${team.id} 컴퓨터 도시 예측 단가`, () => {
      B.selectPack(team.pack, 'league');
      const expected = dieselPrice(h.maps[team.pack]) * INDEX + DIESEL_CO2 * B.M.taxPerT;
      const result = h.C.simTeam(B, h.C.regionOf('south'), team.id, plans.get(team.pack),
        { season: 'summer', seed: 41, days: 1 }, 1e6, { fuelMul: { diesel: INDEX }, tax: true });
      assert.ok(result.k.by.diesel > 0, 'simTeam 실제 발전량 > 0');
      for (const [kind, mwh] of Object.entries(result.k.by)) if (kind !== 'diesel') near(mwh, 0, `simTeam ${kind} 혼입 없음`);
      near(result.k.fuel / result.k.by.diesel, expected, 'simTeam 연료비/발전량');
    });
    const id = leagueIds[0], plan = plans.get(id), tile = plan.builds[0].i;
    const oldPrice = dieselPrice(h.maps[id]), changedPrice = oldPrice * 1.6;
    mutation('A 팩 diesel 변경의 dispFuel·엔진 동시 전파', () => {
      const changed = load({ mutateMaps: maps => { maps[id].fuel.diesel = changedPrice; } });
      changed.B.selectPack(id, 'league');
      sourceContract(changed, id, 'diesel', tile);
      const baseUnit = engineContract(changed, id, plan);
      const indexedUnit = engineContract(changed, id, plan, { index: INDEX });
      near(baseUnit, changedPrice, '변경 팩 엔진 단가');
      near(indexedUnit, changedPrice * INDEX, '변경 팩 지수 단가');
      // 옛 원자료 기대값에 그대로 머무르는 단가는 실제로 실패해야 한다.
      return caught(() => near(changed.B.dispFuel('diesel', tile), oldPrice, '변이 전 단가와 다름')) &&
        caught(() => near(baseUnit, oldPrice, '변이 전 엔진 단가와 다름'));
    });
    mutation('B dispFuel 디젤 상수 회귀', () => {
      // VM에 넣을 문자열만 수정한다. 위치가 안 맞으면 변이 설정 실패다.
      const marker = /const dispFuel\s*=\s*\(kind,\s*tile\)\s*=>/g;
      assert.equal([...sources.build.matchAll(marker)].length, 1, 'dispFuel 변이 연결점 하나');
      const mutant = sources.build.replace(marker, '$& kind === "diesel" ? 0.01 :');
      const changed = load({ build: mutant });
      changed.B.selectPack(id, 'league');
      const sourceCaught = caught(() => sourceContract(changed, id, 'diesel', tile));
      const engineCaught = caught(() => engineContract(changed, id, plan, { index: INDEX }));
      console.log(`변이 B 표적: 팩 원천 ${sourceCaught ? '잡힘' : '안 잡힘'}, 엔진 단가 ${engineCaught ? '잡힘' : '안 잡힘'}`);
      return sourceCaught && engineCaught;
    });
    mutation('m1 엔진 dispFuel 우회 회귀', () => {
      const marker = /g\.mc\s*=\s*dispFuel\(g\.kind,\s*g\.tile\)/g;
      assert.equal([...sources.build.matchAll(marker)].length, 1, 'm1 엔진 변이 연결점 하나');
      // 지수와 세금은 보존하고 연료 단가 경로만 되돌린 VM 사본이다.
      const changed = load({ build: sources.build.replace(marker, 'g.mc = dispOf(g.kind).fuel') });
      let detected = true;
      for (const [pack, cases] of fuelPlans) {
        for (const { kind, livestock, label, plan: fuelPlan } of cases) {
          if (kind === 'biomass' && !livestock) {
            // 일반 바이오매스는 m1에서도 단가가 같아야 한다(음성 대조).
            fuelEngineContract(changed, pack, kind, fuelPlan, livestock, INDEX);
            continue;
          }
          const hit = caught(() => fuelEngineContract(changed, pack, kind, fuelPlan, livestock, INDEX));
          console.log(`변이 m1 표적: ${pack} ${label} ${hit ? '잡힘' : '안 잡힘'}`);
          detected = hit && detected;
        }
      }
      return detected;
    });
  }
} catch (error) {
  test('하네스', 'VM 로드·검사 준비', () => { throw error; });
}
for (const [name, counts] of groups) console.log(`단언 ${name}: 통과 ${counts.passed} / 실패 ${counts.failed}`);
console.log(`통과 ${passed} / 실패 ${failed}`);
process.exitCode = failed ? 1 : 0;
