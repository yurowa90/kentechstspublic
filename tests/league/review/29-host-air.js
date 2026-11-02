'use strict';
// S8: build 운영 → 호스트 월 입력 → 보정·실제 경제 결과의 연결 계약.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {} } });
ctx.window = ctx;
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../../ui/${name}.js`), 'utf8'), ctx);
}
const { leagueCore: C, buildGame: B, ECON_DATA: D } = ctx.KCP;
const R = C.regionOf('south'), ids = R.teams.map(t => t.id);
const S = C.newState('s8-host-air', R.id, 0, ids, { turns: 12 });
const clone = x => x == null ? x : JSON.parse(JSON.stringify(x));
let checks = 0;
const near = (a, b, label) => { assert.ok(Number.isFinite(a) && Math.abs(a - b) < 1e-9, `${label}: ${a} != ${b}`); checks++; };
const sample = { dem: 100, uns: 0, unsPct: 0, hospH: 0, co2Prod: 500, co2Cons: 900,
  renPct: 0, exp: 0, imp: 300, earn: 0, pay: 0, cost: { fuel: 0, policy: 0 },
  by: { coal: 7, lng: 14, diesel: 21, biomass: 28, import: 7000 } };
assert.deepEqual(clone(C.econInput(S, R, ids[0], sample, 31 / 7).energy.genMWh),
  // H03 내부 입력에 SMR 추가. 누락 생산량은 0이며 PM 가중 연료는 기존 4종 그대로다.
  { coal: 31, lng: 62, diesel: 93, biomass: 124, smr: 0 }, '월 배수 한 번, 생산 5연료만 전달'); checks++;
const initial = {};
for (const id of ids) {
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const plan = B.sanitize(D.normalStartPlans[id], Number.MAX_VALUE);
  const by = B.simulate({ ...plan, season: 'winter', seed: 0 }, 7, { league: true }).tot.by;
  initial[id] = 7e-6 * ((by.coal || 0) + .05 * (by.lng || 0) + .8 * (by.diesel || 0) + .8 * (by.biomass || 0)) * 31 / 7;
}
// D-69의 land/bay 명시 결정과 P61 원문 수치에서 독립 계산.
const incoming = own => ({
  hwaseong: .2 * own.pyeongtaek,
  pyeongtaek: .2 * (own.hwaseong + own.anseong + own.cheonan + own.asan + own.dangjin),
  anseong: .2 * (own.pyeongtaek + own.cheonan),
  dangjin: .2 * (own.pyeongtaek + own.asan),
  asan: (.059 / .092) * own.dangjin + .2 * (own.pyeongtaek + own.cheonan),
  cheonan: .45 * own.dangjin + .2 * (own.pyeongtaek + own.anseong + own.asan)
});
for (const id of ids) {
  const delta = initial[id] + incoming(initial)[id];
  near(S.econ.cities[id].lagL.air, 80 - 29 * delta, `${id} 시작 보정 PM`);
  near(S.econ.cities[id].groupParts.air, 80 - 4 * 29 * delta, `${id} 집단 만족만 ×4`);
}
console.log(JSON.stringify({ startComparison: ids.map(id => ({ name: C.teamDef(R, id).name,
  own: initial[id], deltaBefore: initial[id] + (['asan', 'cheonan'].includes(id) ? .6 * initial.dangjin : 0),
  deltaAfter: initial[id] + incoming(initial)[id],
  airBefore: 80 - 29 * (initial[id] + (['asan', 'cheonan'].includes(id) ? .6 * initial.dangjin : 0)),
  airAfter: S.econ.cities[id].lagL.air })) }));
near(C.publicView(S, 0).econ.speeds.eduAir, 4, '공개 배속은 실제 eduAir');
C.host(S, 'next', 1);
for (const id of ids) S.teams[id].plan = clone(D.normalStartPlans[id]);
S.events = [];
const normal = C.run(S, B, 2);
assert.ok(normal.econ.cities.dangjin.pm25.own > 0, '실제 화력 운영이 air 80에 고정되지 않음'); checks++;
for (const id of ids) {
  const sim = C.simTeam(B, R, id, S.teams[id].plan,
    { season: normal.season, days: normal.days, seed: normal.seed }, Number.MAX_VALUE, C.modsFor(S, R, id));
  const own = 7e-6 * Object.entries({ coal: 1, lng: .05, diesel: .8, biomass: .8 })
    .reduce((s, [fuel, w]) => s + w * (sim.k.by[fuel] || 0) * 31 / 7, 0);
  near(normal.econ.cities[id].pm25.own, own, `${id} 운영 입력→경제 결과`);
  assert.equal(normal.econ.cities[id].pm25.complete, true); checks++;
}
// 무건설 새 상태의 실제 운영 경로. 무발전·정전이어도 대기 점수는 80까지만.
const off = C.newState('s8-host-off', R.id, 0, ids, { turns: 12 });
const startAir = Object.fromEntries(ids.map(id => [id, off.econ.cities[id].lagL.air]));
C.host(off, 'next', 1); off.events = [];
const result = C.run(off, B, 2);
for (const id of ids) {
  // D-74: 빈 계획 정전100%→계통 수입 반영50%; 지역 생산·PM=0 계약 유지.
  assert.equal(result.team[id].unsPct, 100 * (1 - D.params.gridImportShare.v)); checks++;
  near(result.econ.cities[id].pm25.own, 0, `${id} 정전 달 무발전`);
  near(result.econ.cities[id].Lparts.air, 80, `${id} 정전 air 상한`);
  const startDelta = initial[id] + incoming(initial)[id];
  near(result.econ.cities[id].Lparts.air - startAir[id], 29 * startDelta, `${id} §7.2 실제 정전 상승 상한`);
}
// 실제 build와 settle에서 독립 계산: 정상 시작 배치는 각 도시 석탄 또는 LNG만 발전한다.
// co2X/saveCo2를 해당 연료 배출계수로 나누면 추가/감발 MWh가 된다.
const tradePM = [];
for (const cap of [2, 4]) for (const cheap of [false, true]) {
  const state = C.newState('s8-host-trade', R.id, 0, ids, { turns: 12 });
  C.host(state, 'next', 1); state.events = [];
  for (const id of ids) state.teams[id].plan = clone(D.normalStartPlans[id]);
  if (cheap) state.teams.dangjin.price = .005; // 석탄 연료비보다 높고 LNG 대체 단가보다 낮다.
  state.ties = R.ties.map(t => ({ ...t, id: C.tieId(t), st: 'built', cap }));
  C.refreshGrid(state, B, true);
  const rd = C.roundsOf(state)[0], wk = rd.mdays / rd.days;
  const rnd = { season: rd.season, days: rd.days, seed: 7013 + (state.salt || 0) };
  const sims = Object.fromEntries(ids.map(id => [id, C.simTeam(B, R, id, state.teams[id].plan, rnd,
    Number.MAX_VALUE, C.modsFor(state, R, id))]));
  const { out } = C.settle(state.ties.map(t => C.effectiveTie(state, t)), sims,
    Object.fromEntries(ids.map(id => [id, state.teams[id].price])), rd.days * 24, rd.days);
  const result = C.run(state, B, 2);
  let exporters = 0, reducers = 0;
  for (const id of ids) {
    const k = sims[id].k, o = out[id];
    const fuel = k.by.coal > 0 ? 'coal' : 'lng', ef = fuel === 'coal' ? .82 : .37;
    const before = 7e-6 * (fuel === 'coal' ? 1 : .05) * k.by[fuel] * wk;
    const afterMWh = k.by[fuel] + (o.co2X - o.saveCo2) / ef;
    near((o.byX[fuel] || 0) * ef, o.co2X, `${cap}/${id} 추가 연료량과 CO₂ 배출계수 일치`);
    assert.ok(Math.abs((o.saveBy[fuel] || 0) * ef - o.saveCo2) < 1e-4, '감발 연료량과 CO₂ 일치(Float32 집약도)'); checks++;
    for (const f of ['coal', 'lng', 'diesel', 'biomass']) {
      assert.ok((k.by[f] || 0) + (o.byX[f] || 0) - (o.saveBy[f] || 0) >= 0, `${cap}/${id}/${f} 0 하한 미발동`); checks++;
    }
    assert.ok(afterMWh >= 0, `${cap}/${id} 0 하한 미발동`); checks++;
    const expected = 7e-6 * (fuel === 'coal' ? 1 : .05) * afterMWh * wk;
    // build의 시간별 집약도는 Float32이므로 CO₂ 역산 오차만 허용한다.
    assert.ok(Math.abs(result.econ.cities[id].pm25.own - expected) < 1e-8,
      `${cap}/${id} 거래 후 PM ${result.econ.cities[id].pm25.own} != ${expected}`); checks++;
    assert.equal(result.team[id].co2Prod, Math.round(k.co2 + o.co2X - o.saveCo2)); checks++;
    if (o.co2X > o.saveCo2) { assert.ok(result.econ.cities[id].pm25.own > before, '수출 추가 발전 PM 증가'); exporters++; checks++; }
    if (o.saveCo2 > o.co2X) { assert.ok(result.econ.cities[id].pm25.own < before, '수입 대체 감발 PM 감소'); reducers++; checks++; }
    if (id === 'dangjin') tradePM.push({ cap, cheap, before, after: result.econ.cities[id].pm25.own,
      isolatedCo2: k.co2, co2Prod: result.team[id].co2Prod });
  }
  assert.ok(exporters > 0 && (!cheap || reducers > 0), '추가 급전 및 저가 거래의 대체 감발 실행'); checks++;
  assert.ok(state.results.every(r => Object.values(r.team).every(t => !Object.hasOwn(t, 'by'))), '연료량은 저장 결과에 남기지 않음'); checks++;
  assert.ok(C.publicView(state, 3).results.every(r => Object.values(r.team).every(t => !Object.hasOwn(t, 'by'))), '연료량은 공개 결과에 남기지 않음'); checks++;
}
console.log(JSON.stringify({ tradePM }));
// 혼합 발전 build 출력: 학생이 추가한 디젤·바이오매스도 용량/감발 구성에 포함한다.
for (const id of ['dangjin', 'pyeongtaek']) {
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const plan = clone(D.normalStartPlans[id]);
  const anchor = B.SITES.find(s => s.dem).tile;
  for (const fuel of ['diesel', 'biomass']) {
    const tile = B.TILES.find(t => !t.out && t.site < 0 && !plan.builds.some(b => b.i === t.i) &&
      !B.siteRule(fuel, t) && B.routePath(anchor, t.i));
    assert.ok(tile, `${id}/${fuel} 합법 배치 존재`); checks++;
    plan.builds.push({ t: fuel, i: tile.i });
    plan.lines.push({ p: B.routePath(anchor, tile.i) });
  }
  const sim = B.simulate(B.sanitize({ ...plan, seed: 7013, season: 'winter' }, Number.MAX_VALUE), 7, { league: true, mods: { demandMul: 5 } });
  const ef = { coal: .82, lng: .37, diesel: .75, biomass: 0 };
  assert.ok(sim.gx.some(g => g.byHead.diesel > 0 && g.byHead.biomass > 0), '혼합 연료 연결점'); checks++;
  let mixedHours = 0;
  for (const g of sim.gx) {
    near(Object.values(g.byHead).reduce((a, b) => a + b, 0), 1, '추가 발전 구성 합');
    near(Object.entries(g.byHead).reduce((s, [f, w]) => s + ef[f] * w, 0), g.co2i, '추가 발전 CO₂ 구성');
    for (let h = 0; h < sim.H; h++) if (g.disp[h] > 0) {
      const sum = Object.values(g.byDisp).reduce((s, a) => s + a[h], 0);
      near(sum, 1, '감발 구성 합');
      const co2 = Object.entries(g.byDisp).reduce((s, [f, a]) => s + ef[f] * a[h], 0);
      assert.ok(Math.abs(co2 - g.dco2[h]) < 1e-7, '감발 CO₂ 구성(Float32 집약도)'); checks++;
      if (Object.values(g.byDisp).filter(a => a[h] > 0).length > 1) mixedHours++;
    }
  }
  assert.ok(mixedHours > 0, '혼합 연료 감발 비율 검사 실행'); checks++;
}
// 당진 밖 도시의 실제 디젤 건설 → 운영 → 이웃 G 기여. 전력 연계선은 없다.
{
  const id = 'pyeongtaek', state = C.newState('s8b-diesel', R.id, 0, ids, { turns: 12 });
  C.host(state, 'next', 1); state.events = [];
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const anchor = B.SITES.find(s => s.kind === 'city_l').tile;
  const tile = B.TILES.find(t => B.TILES[anchor].nb.includes(t.i) && !t.out && t.site < 0 && !B.siteRule('diesel', t));
  assert.ok(tile, '디젤 합법 위치 존재'); checks++;
  state.teams[id].plan = { builds: [{ t: 'diesel', i: tile.i }], lines: [{ p: B.routePath(anchor, tile.i) }] };
  const sim = C.simTeam(B, R, id, state.teams[id].plan,
    { season: 'winter', days: 7, seed: 7013 }, Number.MAX_VALUE, C.modsFor(state, R, id));
  assert.ok(sim.k.by.diesel > 0, '실제 디젤 생산 존재'); checks++;
  const own = 7e-6 * .8 * sim.k.by.diesel * 31 / 7;
  const result = C.run(state, B, 2);
  near(result.econ.cities[id].pm25.own, own, '디젤 월 환산 자체 증분');
  for (const target of ids.filter(t => t !== id)) {
    near(result.econ.cities[target].pm25.delta, own * .2, 'G 직접 기여 0.2, 재전파 없음');
  }
  console.log(JSON.stringify({ dieselExample: { from: C.teamDef(R, id).name,
    to: C.teamDef(R, 'hwaseong').name, monthlyMWh: sim.k.by.diesel * 31 / 7,
    own, neighbour: result.econ.cities.hwaseong.pm25.delta, grade: 'G' } }));
}
// settle의 누적은 CO₂와 같은 거래량(sent/got)을 사용하고 송전 손실을 구분한다.
{
  const seller = { to: ['b'], def: [0], ren: [0], head: [10], disp: [0], dmc: [0], dco2: [0],
    mc: .004, co2i: .4 * .82 + .3 * .37 + .2 * .75, bioCo2i: .01,
    byHead: { coal: .4, lng: .3, diesel: .2, biomass: .1 } };
  const buyer = { to: ['a'], def: [0], ren: [0], head: [0], disp: [10], dmc: [.02],
    dco2: [.1 * .82 + .2 * .37 + .3 * .75], dbioCo2: [.04], mc: .02, co2i: 0,
    byDisp: { coal: [.1], lng: [.2], diesel: [.3], biomass: [.4] } };
  const { out } = C.settle([{ id: 'a~b', a: 'a', b: 'b', cap: 5, loss: .1 }],
    { a: { gx: [seller] }, b: { gx: [buyer] } }, { a: .005, b: .03 }, 1, 1);
  for (const [f, value] of Object.entries({ coal: 2, lng: 1.5, diesel: 1, biomass: .5 })) near(out.a.byX[f], value, `혼합 ${f} 추가`);
  for (const [f, value] of Object.entries({ coal: .45, lng: .9, diesel: 1.35, biomass: 1.8 })) near(out.b.saveBy[f], value, `혼합 ${f} 감발`);
  near(out.a.co2X, 2 * .82 + 1.5 * .37 + .75, '혼합 추가 CO₂');
  near(out.b.saveCo2, .45 * .82 + .9 * .37 + 1.35 * .75, '혼합 감발 CO₂');
  near(out.a.bioCo2X, .05, '바이오 추가 CO₂'); near(out.b.saveBioCo2, .18, '바이오 감발 CO₂');
}
const scaledP61 = .092 * ((initial.dangjin / 7e-6) * R.mwScale * 12) / (6040 * .7 * 8760);
console.log(JSON.stringify({ name: C.teamDef(R, 'dangjin').name, startDeltaPM: initial.dangjin,
  p61Scaled: scaledP61, ratio: initial.dangjin / scaledP61, outageRise: 29 * initial.dangjin }));
console.log(`S8 host air checks ${checks} fail 0`);
