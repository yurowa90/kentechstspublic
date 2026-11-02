'use strict';
// D-87: 신규 화력 누락·cap 혼동·신구 PM 혼합·입지 우려의 가동률 의존을 검출한다.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {} } });
ctx.window = ctx;
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league-ai']) {
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../../ui/${name}.js`), 'utf8'), ctx);
}
const { buildGame: B, leagueCore: C, econ: X, ECON_DATA: D } = ctx.KCP;
const R = C.regionOf('south');
const near = (a, b, label) => assert.ok(Number.isFinite(a) && Math.abs(a - b) < 1e-8, `${label}: ${a} != ${b}`);
for (const t of R.teams) {
  B.selectPack(t.pack, 'league');
  for (const [kind, mw, cost] of [['lng', 561 / 230, 5.183152173913043], ['coal', 1040 / 230, 13.63304347826087]]) {
    assert.ok(B.BLD[kind], `${kind} 신설 후보`);
    near(B.BLD[kind].mw, mw, '축척'); near(B.BLD[kind].cost, cost, '건설비');
    const legal = B.TILES.filter(x => !B.siteRule(kind, x));
    assert.ok(legal.length > 0);
    assert.deepEqual(legal.map(x => x.i), B.TILES.filter(x => !B.siteRule('smr', x)).map(x => x.i));
    const i = legal[0].i, plan = B.sanitize({ builds: [{ t: kind, i }], lines: [], policies: [] }, 1e6);
    assert.equal(plan.builds.length, 1);
    const node = B.network(plan).nodes.find(n => n.bi === 0);
    near(node.cap, mw, '신규 cap');
    assert.deepEqual(B.complaints(plan, [0]), B.complaints(plan, [1]), '입지 우려는 운전 무관');
  }
}
// 수요·선로·기존/신규 화력을 손으로 고정한 가상 지도. 실제 도시 자료는 사용하지 않는다.
B.PACKS.d87fixture = { id: 'd87fixture', budget: 1000, climate: B.PACKS.pyeongtaek.climate, rows: ['bbbbbbb', 'bbbbbbb', 'bbbbbbb'], legend: { b: 'beach' },
  goals: { costBase: 100, costPerDay: 1, co2Day: 100 }, groups: [{ id: 'fire', tools: ['coal', 'lng', 'smr'] }], attachAny: true,
  sites: [{ kind: 'plant', fuel: 'coal', cap: 2, c: 0, r: 1 }, { kind: 'city', c: 2, r: 1, dem: { base: 6 } }],
  gates: [{ c: 6, r: 1, to: ['other'] }] };
R.teams.push({ id: 'd87fixture', pack: 'd87fixture' });
B.selectPack('d87fixture', 'league');
const plan = B.sanitize({ builds: [{ t: 'coal', i: 10 }], lines: [{ p: [7, 8, 9, 10, 11, 12, 13] }], policies: [], seed: 1 }, 1e6);
const res = B.simulate(plan, 1, { league: true });
assert.ok(res.tot.pmBy.coal > 0 && res.tot.pmBy.coalNew > 0, '신구 혼재 생산');
near(res.tot.by.coal, res.tot.pmBy.coal + res.tot.pmBy.coalNew, '발전량 보존');
near(res.tot.fuel, res.tot.by.coal * .0045, '연료 보존');
near(res.tot.co2, res.tot.by.coal * .82, 'CO2 보존');
near(res.gx[0].byHead.coal, res.gx[0].pmHead.coal + res.gx[0].pmHead.coalNew, '수출 구성비 보존');
for (let k = 0; k < 24; k++) near(res.gx[0].byDisp.coal[k], res.gx[0].pmDisp.coal[k] + res.gx[0].pmDisp.coalNew[k], '대체 구성비 보존');
const cp = B.complaints(plan, [0]);
assert.equal(cp.items.find(x => x.kind === 'siting').pts, 10, '1칸 입지 우려');
const E = X.initCities(['hwaseong'], D, { seed: 'd87', months: 12 });
const input = { energy: { genMWh: { coal: 100, lng: 100 }, pmGenMWh: { coal: 40, coalNew: 60, lng: 30, lngNew: 70 }, cpList: [{ kind: 'siting', score: 10 }] } };
const report = X.monthStep(E, { hwaseong: input }, D).report;
near(report.cities.hwaseong.pm25.own, 7e-6 * (40 + 60 * .044 / .120 + 30 * .05 + 70 * .05 * .007 / .015), '신구 PM 가중');
// 10MWh 송전 → 9MWh 수전. 신구 비율 25:75, 대체는 40:60.
const gate = to => ({ to: [to], def: [0], ren: [0], head: [0], disp: [0], dmc: [0], dco2: [0], mc: .0045, co2i: .82 });
const seller = { ...gate('b'), head: [10], byHead: { coal: 1 }, pmHead: { coal: .25, coalNew: .75 } };
const buyer = { ...gate('a'), disp: [9], dmc: [.02], dco2: [.37], byDisp: { lng: [1] }, pmDisp: { lng: [.4], lngNew: [.6] } };
const trade = C.settle([{ id: 'a~b', a: 'a', b: 'b', cap: 10, loss: .1 }], { a: { gx: [seller] }, b: { gx: [buyer] } }, { a: .005, b: .02 }, 1, 1).out;
near(trade.a.byX.coal, 10, '수출 발전은 sent'); near(trade.b.saveBy.lng, 9, '대체 감발은 got');
near(trade.a.pmX.coal, 2.5, '기존 석탄 수출'); near(trade.a.pmX.coalNew, 7.5, '신규 석탄 수출');
near(trade.b.savePM.lng, 3.6, '기존 LNG 대체'); near(trade.b.savePM.lngNew, 5.4, '신규 LNG 대체');
near(trade.a.fuelX, .045, '추가 연료'); near(trade.b.saveFuel, .18, '감발 연료');
near(trade.a.co2X, 8.2, '추가 CO2'); near(trade.b.saveCo2, 3.33, '감발 CO2');
for (const kind of ['coal', 'lng', 'smr']) {
  for (const [i, points] of [[10, 10], [11, 6], [12, 3], [13, 0]]) {
    const items = B.complaints({ builds: [{ t: kind, i }], policies: [] }, [0]).items;
    near(items.reduce((s, x) => s + x.pts, 0), points, `${kind} 거리 경계`);
    assert.ok(items.every(x => x.kind === 'siting'));
  }
}
assert.equal(B.complaints({ builds: [], policies: [] }, []).items.length, 0, '기존 plant 소급 없음');
const blockedSMR = B.simulate({ ...plan, builds: [{ t: 'smr', i: 10 }] }, 1, { league: true, mods: { disabledBuilds: ['smr:10'] } });
near(blockedSMR.tot.by.smr, 0, 'SMR 공사 중 무발전');
near(blockedSMR.cp.items.find(x => x.kind === 'siting').pts, 10, 'SMR 공사 중 입지 우려');
const lowDemand = { ...B.PACKS.d87fixture, id: 'd87low', _bL: null, _b: null,
  sites: [{ kind: 'city', c: 2, r: 1, dem: { base: .1 } }] };
B.PACKS.d87low = lowDemand; R.teams.push({ id: 'd87low', pack: 'd87low' });
B.selectPack('d87low', 'league');
const minimum = B.simulate(plan, 1, { league: true });
near(minimum.tot.by.coal, (1040 / 230) * .3 * 24, '석탄 최소출력');
near(minimum.tot.pmBy.coalNew, minimum.tot.by.coal, '최소출력 폐기도 PM 생산');
// 실제 호스트 월 입력/공개 결과 연결. 고정 씨앗, 기존 발전소와 신설 화력 혼재.
const ids = R.teams.slice(0, 6).map(t => t.id), S = C.newState('d87-host', R.id, 0, ids, { turns: 12 });
C.host(S, 'next', 1); S.events = [];
for (const id of ids) S.teams[id].plan = JSON.parse(JSON.stringify(D.normalStartPlans[id]));
B.selectPack('pyeongtaek', 'league');
const hostPlan = S.teams.pyeongtaek.plan, plant = B.SITES.find(s => s.kind === 'plant');
for (const kind of ['coal', 'lng']) {
  const i = B.TILES.find(t => !B.siteRule(kind, t) && !hostPlan.builds.some(b => b.i === t.i)).i;
  hostPlan.builds.push({ t: kind, i });
  const route = B.routePath(plant.tile, i);
  for (let j = 0; j < route.length - 1; j += 29) hostPlan.lines.push({ p: route.slice(j, j + 30) });
}
let captured;
const monthStep = X.monthStep;
X.monthStep = (E, input, ...args) => { captured = input; return monthStep(E, input, ...args); };
const operated = C.run(S, B, 2); X.monthStep = monthStep;
const e = captured.pyeongtaek.energy, pm = e.pmGenMWh;
assert.ok(pm.coalNew > 0, '운영 월 신규 석탄 PM 장부 전달');
for (const f of ['coal', 'lng']) near(e.genMWh[f], pm[f] + pm[f + 'New'], `월 ${f} 총량 보존`);
near(operated.econ.cities.pyeongtaek.pm25.own,
  7e-6 * (pm.coal + pm.coalNew * .044 / .120 + pm.lng * .05 + pm.lngNew * .05 * .007 / .015 + .8 * (pm.diesel + pm.biomass)), '호스트 월 PM');
assert.ok(!/"(?:pmBy|pmGenMWh|pmHead|pmDisp|pmX|savePM)"/.test(JSON.stringify(C.publicView(S, 0))), 'PM 중간 장부 비공개');
assert.ok(!/"(?:pmBy|pmGenMWh|pmHead|pmDisp|pmX|savePM)"/.test(JSON.stringify(S)), 'PM 중간 장부 비저장');
console.log(JSON.stringify({ mixed: res.tot, trade: { seller: trade.a.pmX, buyer: trade.b.savePM }, minimum: minimum.tot.by.coal }));
console.log('PASS D-87 engine contracts');
