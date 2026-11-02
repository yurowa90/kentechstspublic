'use strict';
// 목표/반영을 뒤섞거나 반영 잔여·반올림·병원 분리를 누락하면 실패한다.
// 브라우저 없이 실제 엔진 → 공개 상태 → groupCauseHTML을 검사한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../../..');
const OWN = ['hospital', 'outage', 'complaint', 'share', 'save', 'unrest', 'bounds'];
const LABELS = {hospital: '병원 정전', outage: '정전', complaint: '민원', share: '이익공유', save: '절전', unrest: '시위', bounds: '만족도 상한·하한'};
const json = x => JSON.parse(JSON.stringify(x));
const round = x => Math.round((x || 0) * 100) / 100;
let checks = 0, maxTargetError = 0, maxLagError = 0;
function near(a, b, tolerance) {
  checks++; assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tolerance, `${a} != ${b}`);
}
const session = {team: 'pyeongtaek'};
const ctx = vm.createContext({console, structuredClone, performance,
  document: {documentElement: {}, addEventListener() {}}, addEventListener() {},
  KCP: {route() {}, on() {}, esc: s => String(s), leagueNet: {}}, __session49: session});
ctx.window = ctx;
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league']) {
  let src = fs.readFileSync(path.join(ROOT, 'ui', name + '.js'), 'utf8');
  if (name === 'econ') {
    src = src.replace('function groupTargets(', 'function originalTargets49(');
    src = src.replace('  KCP.econ = {', `
      KCP.__targets49 = {};
      function groupTargets(...args) {
        const g = originalTargets49(...args);
        KCP.__targets49[args[0].id] = JSON.parse(JSON.stringify(g));
        return g;
      }
      KCP.econ = {`);
  }
  if (name === 'league') src = src.replace('let L = null;', 'let L = globalThis.__session49;')
    .replace('  KCP.league = {', '  KCP.__groupHTML49 = groupCauseHTML;\n  KCP.league = {');
  vm.runInContext(src, ctx, {filename: name + '.js'});
}
const K = ctx.KCP, C = K.leagueCore, X = K.econ, D = K.ECON_DATA;
function publicCities(E, report) {
  const S = C.newState('OWN49', 'south', 0);
  S.econ = E; S.econRep = report || null; S.round = E.t;
  return json(C.publicView(S, 0)).econ.cities;
}
function inspect(E, report) {
  const cities = publicCities(E, report);
  for (const id of E.order) for (const group of Object.keys(D.groups)) {
    const c = cities[id], terms = E.cities[id].groupContrib[group];
    const expected = Object.fromEntries(OWN.filter(k => round(terms[k])).map(k => [k, round(terms[k])]));
    checks++; assert.deepEqual(c.groupOwnLag?.[group] || {}, expected, `${id}/${group} lag`);
    for (const [key, value] of Object.entries(expected)) {
      const error = Math.abs(value - terms[key]); maxLagError = Math.max(maxLagError, error);
      near(value, terms[key], .01);
    }
    session.team = id;
    const html = K.__groupHTML49(c, group, report, null);
    const rows = [...html.matchAll(/<div>([^<>]*?)<meter\b([^>]*)><\/meter>/g)];
    checks++; assert.equal(rows.length, (html.match(/<meter\b/g) || []).length);
    let sum = 0;
    for (const row of rows) {
      const own = row[1].match(/최종 반영 ([+\-\d.]+)점 · 현재 반영 ([+\-\d.]+)점$/);
      const target = own ? Number(own[1]) : Number(row[1].match(/([+\-\d.,]+)점$/)?.[1].replaceAll(',', ''));
      near(Number(row[2].match(/\bvalue="([^"]+)"/)[1]), Math.abs(target), .006);
      sum += target;
    }
    const target = K.__targets49[id].tg[group];
    maxTargetError = Math.max(maxTargetError, Math.abs(sum - target)); near(sum, target, .1);
    const ownKeys = OWN.filter(k => c.groupOwn?.[group]?.[k] || expected[k]);
    checks++; assert.equal(rows.filter(r => r[1].includes('현재 반영')).length, ownKeys.length);
    for (const key of ownKeys) {
      near(c.groupOwn?.[group]?.[key] || 0, K.__targets49[id].contrib[group][key] || 0, .006);
      const want = `최종 반영 ${(c.groupOwn?.[group]?.[key] || 0).toFixed(2)}점 · 현재 반영 ${(expected[key] || 0).toFixed(2)}점`;
      const row = rows.find(r => r[1].startsWith(LABELS[key] + ' ') || r[1].startsWith(LABELS[key] + '('));
      checks++; assert.ok(row?.[1].endsWith(want), `${id}/${group}/${key}: ${want}`);
    }
  }
  return cities;
}
function energy(c, extra = {}) {
  const dem = c.pop / 1e5 * 750;
  return {demMWh: dem, servedMWh: dem, unsPct: 0, hospH: 0, costPerMWh: .012,
    co2Local: dem * .1, co2: dem * .2, renPct: 25, opex: dem * .012, spareMW: 2, cpList: [], ...extra};
}
const ids = C.regionOf('south').teams.map(t => t.id);
let E = X.initCities(ids, D, {seed: 'own49', months: 36});
inspect(E, null);
for (let month = 0; month < 36; month++) {
  const inputs = {};
  ids.forEach((id, i) => {
    const mode = (month + i) % 6;
    inputs[id] = {energy: energy(E.cities[id], {hospH: mode >= 3 ? 48 : 0,
      unsPct: mode >= 4 ? 100 : 0, cpList: mode === 0 ? [] : [
        {kind: 'siting', score: 6, src: 'coal'}, {kind: 'view', score: 4, src: 'solar'},
        {kind: 'noise', score: .0049, src: 'wind'}, {kind: 'forest', score: .0051, src: 'solar'}]}),
      policy: {share: mode === 2, save: mode === 3, taxRes: mode >= 4 ? 2 : 0, service: mode >= 4 ? -2 : 1}};
    if (mode === 5) E.cities[id].unrest = 12;
  });
  const r = X.monthStep(E, inputs, D); E = r.E; inspect(E, r.report);
}
// 공개 경계의 0 생략과 임의 키/건수 제외. 실제 groupContrib를 읽는지 확인한다.
const edge = X.initCities(['pyeongtaek'], D, {seed: 'edge49'});
edge.cities.pyeongtaek.groupContrib = {senior: {hospital: -.0049, complaint: -.0051, save: .0149, share: .0151, complaintN: 7, other: 3}};
const edgeCity = publicCities(edge).pyeongtaek;
checks++; assert.deepEqual(edgeCity.groupOwnLag, {senior: {complaint: -.01, save: .01, share: .02}});
edge.cities.pyeongtaek.groupContrib = {senior: {hospital: -.0049}, youth: {complaint: 0}};
checks++; assert.equal(Object.hasOwn(publicCities(edge).pyeongtaek, 'groupOwnLag'), false);
// 목표 0이지만 회복 기억이 남은 항도 목표 길이 0으로 표시한다.
session.team = 'pyeongtaek';
const residual = K.__groupHTML49({groupParts: {}, groupOwn: {}, groupOwnLag: {senior: {complaint: -1.52}}}, 'senior', null, null);
checks++; assert.match(residual, /최종 반영 0\.00점 · 현재 반영 -1\.52점<meter[^>]*value="0"/);
// 기존 저장 상태: 두 표시 필드 없이도 공통 막대 렌더링.
checks++; assert.ok(K.__groupHTML49({groupParts: {rel: 80}}, 'senior', null, null).includes('<meter'));
// 평택 기존 시작 설비 위에 실제 건설 가능한 석탄 1기를 추가한 첫 달.
const S = C.newState('REPRO48', 'south', 0, null, {turns: 12}), B = K.buildGame;
B.selectPack('pyeongtaek', 'league');
const chosen = B.TILES.filter(t => !t.out && t.site < 0 && !B.siteRule('coal', t)).map(t => ({tile: t,
  cp: B.complaints({builds: [{t: 'coal', i: t.i}], lines: [], policies: []}, [0]).items}))
  .filter(x => x.cp.length === 1 && x.cp[0].kind === 'siting' &&
    ['village', 'town_s', 'city', 'city_m', 'city_l'].includes(B.TOWNS[x.cp[0].ti].kind))
  .sort((a, b) => b.cp[0].pts - a.cp[0].pts || a.tile.i - b.tile.i)[0].tile;
for (const id of S.econ.order) S.teams[id].plan = json(D.normalStartPlans[id]);
S.teams.pyeongtaek.plan.builds.push({t: 'coal', i: chosen.i});
S.round = 1; S.phase = 'plan'; assert.ok(C.run(S, B, 0));
const c = inspect(S.econ, S.econRep).pyeongtaek;
for (const [group, target, lag] of [['senior', -10, -10], ['youth', -10, -10]]) {
  near(c.groupOwn[group].complaint, target, .001); near(c.groupOwnLag[group].complaint, lag, .001);
}
console.log('REPRO ' + JSON.stringify({tile: chosen.i, groups: Object.fromEntries(['senior', 'youth'].map(g => [g,
  {target: c.groupOwn[g].complaint, lag: c.groupOwnLag[g].complaint, engine: S.econ.cities.pyeongtaek.groupContrib[g].complaint}]))}));
// 회복 중인 만족을 통제해 기억 계수 0.038×4=0.152의 사례를 별도로 확인.
let recovery = X.initCities(['pyeongtaek'], D, {seed: 'recovery49'});
for (const group of Object.keys(D.groups)) {
  recovery.cities.pyeongtaek.groups[group].sat = 0;
  recovery.cities.pyeongtaek.groupContrib[group] = {};
}
const rr = X.monthStep(recovery, {pyeongtaek: {energy: energy(recovery.cities.pyeongtaek, {cpList: [
  {kind: 'siting', score: 6, src: 'coal'}, {kind: 'view', score: 4, src: 'solar'}]})}}, D);
const rc = inspect(rr.E, rr.report).pyeongtaek;
for (const [group, target, lag] of [['senior', -10, -1.52], ['youth', -6, -.91]]) {
  near(rc.groupOwn[group].complaint, target, .001); near(rc.groupOwnLag[group].complaint, lag, .001);
}
console.log('RECOVERY ' + JSON.stringify({senior: rc.groupOwnLag.senior.complaint, youth: rc.groupOwnLag.youth.complaint}));
console.log(JSON.stringify({suite: '49-group-own-lag', checks, maxTargetError, maxLagError, failures: 0}));
