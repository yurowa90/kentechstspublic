'use strict';
// 사용자 계약 1~6으로 작성한 독립 검사. 구현자 보고서·검사는 읽거나 import하지 않는다.
// 실행: node tests/league/review/48-group-own.js
// UI 원본은 읽기만 한다. 함수 노출·관측·변이는 각각의 VM 소스 사본에만 적용한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../../..');
const FILES = ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league'];
const sources = Object.fromEntries(FILES.map(n => [n, fs.readFileSync(path.join(ROOT, 'ui', n + '.js'), 'utf8')]));
const OWN = ['hospital', 'outage', 'complaint', 'share', 'save', 'unrest', 'bounds'];
const LABELS = {hospital: '병원 정전', outage: '정전', complaint: '민원', share: '이익공유', save: '절전', unrest: '시위', bounds: '만족도 상한·하한'};
const copy = x => JSON.parse(JSON.stringify(x));
const rounded = x => Math.round(x * 100) / 100;
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
function replaceOnce(s, from, to) {
  assert.equal(s.split(from).length, 2, 'VM 연결점은 정확히 하나여야 함: ' + from);
  return s.replace(from, to);
}
function load(mutation) {
  const session = {team: 'pyeongtaek'};
  const ctx = vm.createContext({console, structuredClone, performance,
    document: {documentElement: {}, addEventListener() {}}, addEventListener() {},
    KCP: {route() {}, on() {}, esc: escape, leagueNet: {}}, __session48: session});
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
  for (const name of FILES) {
    let src = sources[name];
    if (mutation && name === mutation.file) src = mutation.change(src);
    if (name === 'econ') {
      src = replaceOnce(src, 'function groupTargets(', 'function originalTargets48(');
      // 원래 함수의 반환 직후, advanceApproval이 contrib를 지연시키기 전 스냅샷.
      // 기대값을 재계산하거나 반환값을 변경하지 않는다.
      src = replaceOnce(src, '  KCP.econ = {', `
  KCP.__targets48 = {};
  function groupTargets(...args) {
    const result = originalTargets48(...args);
    KCP.__targets48[args[0].id] = JSON.parse(JSON.stringify({
      tg: result.tg, contrib: result.contrib, parts: result.parts,
      energy: args[1].energy, input: args[1], region: args[4] || {}, out: args[2], hospRel: args[0].hospRel,
      previous: args[0].groupContrib || {}, groupsBefore: args[0].groups
    }));
    return result;
  }
  KCP.__groupTargets48 = originalTargets48;
  KCP.econ = {`);
    }
    if (name === 'league') {
      src = replaceOnce(src, 'let L = null;', 'let L = globalThis.__session48;');
      src = replaceOnce(src, '  KCP.league = {', '  KCP.__groupHTML48 = groupCauseHTML;\n  KCP.league = {');
    }
    vm.runInContext(src, ctx, {filename: 'ui/' + name + '.js', timeout: 10000});
  }
  // newState도 groupTargets를 호출한다. 공개화 도중 관측값을 덮지 않게 미리 한 번만 만든다.
  const publicState = ctx.KCP.leagueCore.newState('OWN48', 'south', 0);
  return {K: ctx.KCP, session, publicState};
}
function collector(quiet = false) {
  return {quiet, assertions: 0, failures: 0, records: [],
    check(label, fn) {
      this.assertions++;
      try { fn(); } catch (e) {
        this.failures++;
        this.records.push({label, message: e.message, assertion: e.code === 'ERR_ASSERTION'});
        if (!quiet && this.failures <= 18) console.error('FAIL ' + label + ': ' + e.message);
      }
    }};
}
const near = (actual, expected, tolerance = 1e-8) => assert.ok(
  Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance,
  `${actual} != ${expected} (허용 ${tolerance})`);
const regexEscape = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 실제 반환 HTML의 줄 글, 목표 막대와 aria를 읽는다. pending 문구는 합산하지 않는다.
// target·applied 낱말은 자료에서 읽고, 두 수는 소수 둘째 자리 표기까지 검사한다.
function barsFrom(html, D) {
  const words = D.groupOwnCopy;
  const own = new RegExp(`^(.*?) ${regexEscape(escape(words.target))} (-?\\d+\\.\\d{2})점 · ${regexEscape(escape(words.applied))} (-?\\d+\\.\\d{2})점$`);
  return [...html.matchAll(/<div>([^<>]*)<meter\b([^>]*)><\/meter>/g)].map(m => {
    const num = s => Number(s.replaceAll(',', '').replace('−', '-'));
    const attr = k => m[2].match(new RegExp('(?:^|\\s)' + k + '="([^"]*)"'))?.[1];
    const pair = m[1].match(own), common = m[1].match(/^(.*?)\s+([−+\-\d.,]+)점$/);
    return {text: m[1], label: pair?.[1] || common?.[1], own: !!pair,
      value: num(pair?.[2] || common?.[2] || 'NaN'), applied: pair ? num(pair[3]) : undefined,
      magnitude: num(attr('value') || 'NaN'), aria: attr('aria-valuetext'), ariaLabel: attr('aria-label')};
  });
}
function expectedOwn(terms, cpList, group, D, counts = true) {
  const values = {};
  for (const key of OWN) if (rounded(terms[key] || 0) !== 0) values[key] = rounded(terms[key]);
  if (counts && Object.hasOwn(values, 'complaint')) {
    const affected = cpList.filter(cp => (D.params.complaintGroups.v[cp.kind] || []).includes(group));
    values.complaintN = affected.length;
    const sitingN = affected.filter(cp => cp.kind === 'siting').length;
    if (sitingN) values.sitingN = sitingN;
  }
  return values;
}
// 실제 publicView -> JSON 왕복으로 팀 기기가 받는 자료를 사용한다.
function publicCities(h, E, report) {
  const {leagueCore: C} = h.K;
  const S = h.publicState;
  S.econ = E; S.econRep = report || null; S.round = E.t; S.grid = {};
  return copy(C.publicView(S, 0)).econ.cities;
}
function inspect(h, E, report, label, out, options = {}) {
  const {K, session} = h, D = K.ECON_DATA, cities = publicCities(h, E, report);
  for (const id of E.order) {
    const actual = cities[id], target = K.__targets48[id];
    const expectedCity = {}, expectedLagCity = {};
    session.team = id;
    for (const group of Object.keys(D.groups)) {
      const tag = `${label}/${id}/${group}`;
      const expected = expectedOwn(target.contrib[group], target.energy.cpList, group, D);
      const expectedLag = expectedOwn(E.cities[id].groupContrib[group], [], group, D, false);
      const published = actual.groupOwn?.[group];
      const applied = actual.groupOwnLag?.[group];
      if (Object.keys(expected).length) expectedCity[group] = expected;
      if (Object.keys(expectedLag).length) expectedLagCity[group] = expectedLag;
      // 목표는 advanceApproval 전 스냅샷, 반영은 운영 후 엔진을 각각 기준으로 삼는다.
      out.check(tag + '/public-target', () => {
        if (!Object.keys(expected).length) assert.equal(Object.hasOwn(actual.groupOwn || {}, group), false, '0 집단 키가 남음');
        else assert.deepEqual(published, expected);
      });
      out.check(tag + '/public-applied', () => {
        if (!Object.keys(expectedLag).length) assert.equal(Object.hasOwn(actual.groupOwnLag || {}, group), false, '0 반영 집단 키가 남음');
        else assert.deepEqual(applied, expectedLag);
      });
      out.check(tag + '/public-counts', () => {
        if (!published?.complaint) return;
        const affected = target.energy.cpList.filter(cp => (D.params.complaintGroups.v[cp.kind] || []).includes(group));
        assert.equal(published.complaintN, affected.length, '집단에 해당하는 민원 수');
        const sitingN = affected.filter(cp => cp.kind === 'siting').length;
        if (sitingN) assert.equal(published.sitingN, sitingN);
        else assert.equal(Object.hasOwn(published, 'sitingN'), false, '0 입지 건수 키가 남음');
      });
      const html = K.__groupHTML48(actual, group, report, null), bars = barsFrom(html, D);
      out.check(tag + '/bars-parse', () => {
        assert.ok(bars.length > 0, '실제 HTML 막대를 읽지 못함');
        assert.equal(bars.length, (html.match(/<meter\b/g) || []).length, '누락/중복 meter');
        for (const bar of bars) {
          near(bar.magnitude, Math.abs(bar.value), .006);
        }
      });
      out.check(tag + '/meter-valuetext', () => {
        for (const bar of bars) {
          const words = D.groupOwnCopy;
          const text = bar.own ? `${words.target} ${bar.value.toFixed(2)}점 · ${words.applied} ${bar.applied.toFixed(2)}점` :
            bar.text.slice(bar.label.length + 1);
          assert.equal(bar.aria, escape(text), bar.label + ' 낭독은 화면의 점수와 같아야 함');
        }
      });
      out.check(tag + '/meter-label', () => {
        for (const bar of bars) assert.equal(bar.ariaLabel,
          escape((bar.value || bar.applied || 0) < 0 ? D.groupOwnCopy.penalty : D.groupOwnCopy.contribution),
          bar.label + ' 목표가 0이면 반영값 부호로 낭독');
      });
      out.check(tag + '/target-sum', () => near(bars.reduce((n, b) => n + b.value, 0), target.tg[group], .1));
      for (const key of OWN) {
        const found = bars.filter(b => b.label === LABELS[key] || b.label?.startsWith(LABELS[key] + '(') ||
          key === 'complaint' && /^민원 요인 \d+개 중 입지 \d+개 · 상한 \d+(?:\.\d+)?점(?:에 걸림)?$/.test(b.label)); // rev9 R12: K8a/K8b 혼합 민원 라벨도 민원 막대로 찾는다.
        const value = expected[key] || 0, lag = expectedLag[key] || 0;
        out.check(tag + '/bar/' + key, () => {
          assert.equal(found.length, value === 0 && lag === 0 ? 0 : 1, key + ' 막대 개수');
          if (found.length) {
            assert.ok(found[0].own, '자료의 target·applied 낱말과 두 자리 점수 필요');
            near(found[0].value, value);
            near(found[0].applied, lag);
            near(found[0].value, published?.[key] || 0);
            near(found[0].applied, applied?.[key] || 0);
            const words = D.groupOwnCopy;
            let termLabel = LABELS[key];
            if (key === 'complaint' && expected.complaintN) {
              const n = expected.complaintN, m = expected.sitingN;
              // rev9 R12: 상한은 params, 걸림은 원값 절댓값으로 독립 판정.
              const cap = D.params.complaintCap.v, capped = Math.abs(value) >= cap - 1e-9;
              termLabel = m && m !== n ? `민원 요인 ${n}개 중 입지 ${m}개 · 상한 ${cap}점${capped ? '에 걸림' : ''}` :
                `${termLabel}(${m === n ? words.sitingN.replace('{n}', m) : words.complaintN.replace('{n}', n)}${capped ? ` · 상한 ${cap}점에 걸림` : ''})`;
            }
            assert.equal(found[0].text, escape(`${termLabel} ${words.target} ${value.toFixed(2)}점 · ${words.applied} ${lag.toFixed(2)}점`)); // spec-C §M9: 전체 라벨·목표·현재 점수 엄격 비교 유지.
          }
        });
      }
      out.check(tag + '/hospital-separated', () => {
        const rel = bars.find(b => b.label === '전력 신뢰');
        if (rel) near(rel.value, target.contrib[group].rel, .011);
        else near(target.contrib[group].rel || 0, 0, .011);
      });
      if (published?.complaint) out.check(tag + '/count-label', () => {
        const affected = target.energy.cpList.filter(cp => (D.params.complaintGroups.v[cp.kind] || []).includes(group));
        const siting = affected.filter(cp => cp.kind === 'siting').length;
        const bar = bars.find(b => /^(?:민원\(|민원 요인 \d+개 중 입지 )/.test(b.label)); // rev9 R12: 기존·K8 혼합 라벨 모두 검색.
        assert.ok(bar, '민원 막대 없음');
        assert.equal(Number(bar.label.match(/(\d+)(?:건|개)/)?.[1]), affected.length, '집단별 민원 건수 라벨'); // spec-C §M9: 혼합은 개, 나머지는 건.
        if (siting) assert.equal(Number(bar.label.match(/입지(?: 민원)?\s+(\d+)(?:건|개)/)?.[1]), siting, '입지 민원 건수 라벨'); // spec-C §M9: 두 꼴의 입지 수를 동일하게 검산.
      });
      if (options.coverage) {
        for (const key of OWN) if (rounded(target.contrib[group][key] || 0)) options.coverage.add(key);
        if (!Object.keys(expected).length) options.coverage.add('zero-group');
        if (!Object.keys(expectedLag).length) options.coverage.add('zero-applied-group');
        if (OWN.some(k => !expected[k] && expectedLag[k])) options.coverage.add('applied-only');
        if (OWN.some(k => (expected[k] || 0) !== (expectedLag[k] || 0))) options.coverage.add('target-applied-differ');
        if (published?.complaint && !published.sitingN) options.coverage.add('no-siting');
        if (published?.sitingN && published.sitingN !== published.complaintN) options.coverage.add('mixed-siting');
      }
    }
    // 도시 전체 비교로 빈 도시·알 수 없는 집단/항목·0 키도 함께 검출한다.
    for (const [key, expected] of [['groupOwn', expectedCity], ['groupOwnLag', expectedLagCity]]) {
      out.check(`${label}/${id}/${key}/city-shape`, () => {
        if (Object.keys(expected).length) assert.deepEqual(actual[key], expected);
        else assert.equal(Object.hasOwn(actual, key), false, '빈 도시 키가 남음');
      });
      if (!Object.keys(expected).length) options.coverage?.add('empty-' + key);
    }
  }
  return cities;
}
function energy(c, overrides = {}) {
  const dem = c.pop / 1e5 * 750;
  return {demMWh: dem, servedMWh: dem, unsPct: 0, hospH: 0, costPerMWh: .012,
    co2Local: dem * .1, co2: dem * .2, renPct: 25, opex: dem * .012,
    spareMW: 2, cpList: [], ...overrides};
}
// 직접 구성한 서로 다른 민원: 영향 집단 밖 민원을 포함해야 전체 건수 변이를 잡을 수 있다.
const MIXED = [
  {kind: 'siting', score: 10, src: 'coal', near: 0},
  {kind: 'noise', score: 4, src: 'wind', near: 1},
  {kind: 'view', score: 2, src: 'solar', near: 2},
  {kind: 'smoke', score: 3, src: 'diesel', near: 3},
  {kind: 'forest', score: 5, src: 'solar', near: 4}
];
function grid(h, out) {
  const {K} = h, D = K.ECON_DATA, X = K.econ;
  const ids = K.leagueCore.regionOf('south').teams.map(t => t.id);
  out.check('coverage/six-cities', () => assert.equal(ids.length, 6));
  const coverage = new Set(); let cityMonths = 0;
  for (const seed of ['own48-alpha', 'own48-beta', 'own48-gamma']) {
    let E = X.initCities(ids, D, {seed, months: 12});
    inspect(h, E, null, seed + '/initial', out, {coverage});
    for (let month = 0; month < 12; month++) {
      const inputs = {};
      ids.forEach((id, index) => {
        const mode = (month + index + seed.length + seed.charCodeAt(6)) % 6;
        const cpList = mode === 0 ? [] : mode === 1 ? MIXED.slice(0, 1) : mode === 2 ? MIXED.slice(1) : MIXED;
        inputs[id] = {energy: energy(E.cities[id], {cpList, unsPct: mode === 4 ? 8 : mode === 5 ? 100 : 0,
          hospH: mode >= 3 ? 48 : 0, renPct: (month * 7 + index * 11) % 100}),
          policy: {save: mode === 2 || mode === 5, share: mode === 2 || mode === 3,
            taxRes: mode >= 4 ? 2 : 0, service: mode === 5 ? -2 : 1}};
        if (mode === 5) E.cities[id].unrest = 12;
      });
      const result = X.monthStep(E, inputs, D); E = result.E;
      inspect(h, E, result.report, `${seed}/month-${month + 1}`, out, {coverage});
      cityMonths += ids.length;
    }
  }
  out.check('coverage/3x6x12', () => assert.equal(cityMonths, 216));
  for (const kind of [...OWN, 'zero-group', 'zero-applied-group', 'empty-groupOwn', 'empty-groupOwnLag',
    'applied-only', 'target-applied-differ', 'no-siting', 'mixed-siting'])
    out.check('coverage/' + kind, () => assert.ok(coverage.has(kind), '해당 조건을 실제로 검사하지 않음'));
  console.log(`COVERAGE seeds=3 cities=${ids.length} months=12 cityMonths=${cityMonths} terms=${[...coverage].join(',')}`);
}
function focused(h, out) {
  const {econ: X, ECON_DATA: D} = h.K;
  const id = 'pyeongtaek';
  // 초기화는 지연 전 contrib와 저장된 contrib가 같으므로 변이 검출 기준이 명확하다.
  const E = X.initCities([id], D, {seed: 'own48-mutation', months: 12,
    base: {[id]: {energy: energy({pop: D.start[id].pop0}, {cpList: MIXED, hospH: 24, unsPct: 2}), policy: {share: true, save: true}}}});
  inspect(h, E, null, 'focused', out);
  // 두 값이 다른 운영 뒤 사례도 같은 변이 대조군에 포함한다.
  recovery(h, out);
  missingGroupPart(h, out);
}
function missingGroupPart(h, out) {
  const {K, session} = h, {econ: X, ECON_DATA: D} = K, id = 'pyeongtaek';
  const E = X.initCities([id], D, {seed: 'own48-missing-part', base: {[id]: {
    energy: energy({pop: D.start[id].pop0})}}});
  const actual = publicCities(h, E, null)[id], original = K.__targets48[id];
  // 공개 자료에서는 키를 삭제하고, 엔진에는 같은 입력에서 lagL의 그 키만 null로 준다.
  // 엔진의 유효 가중치 합으로 계산한 tg와 실제 HTML 막대 합을 비교한다.
  const city = copy(E.cities[id]); city.lagL.crowd = null;
  const target = K.__groupTargets48(city, copy(original.input), original.out, D, copy(original.region));
  delete actual.groupParts.crowd;
  session.team = id;
  out.check('missing-part/setup', () => {
    assert.ok(original.parts.crowd > 0, '실제로 값이 있던 항을 제거해야 함');
    assert.equal(Object.hasOwn(actual.groupParts, 'crowd'), false);
    assert.deepEqual(copy(target.own), actual.groupOwn || {}, '전용 항이 달라지지 않는 입력 필요');
  });
  for (const group of Object.keys(D.groups).filter(g => D.params.groupW.v[g].crowd > 0)) {
    const tag = `missing-part/${id}/${group}`;
    const bars = barsFrom(K.__groupHTML48(actual, group, null, null), D);
    out.check(tag + '/renormalized-target', () => {
      assert.ok(Math.abs(target.tg[group] - original.tg[group]) > .1, '누락이 목표에 영향을 주는 사례 필요');
      assert.ok(bars.length > 0, '실제 HTML 막대 필요');
      near(bars.reduce((n, b) => n + b.value, 0), target.tg[group], .1);
    });
  }
}
function boundaries(h, out) {
  const {econ: X, ECON_DATA: D} = h.K, id = 'pyeongtaek';
  for (const score of [0, .0049, .0051, .0149, .0151]) {
    const E = X.initCities([id], D, {seed: 'own48-round', base: {[id]: {
      energy: energy({pop: D.start[id].pop0}, {cpList: [{kind: 'siting', score, src: 'coal'}]})}}});
    inspect(h, E, null, 'round-' + score, out);
    out.check('round-' + score + '/independent-complaint', () => {
      const expected = rounded(-score * D.params.complaintScale.v);
      near(E.cities[id].groupOwn?.senior?.complaint || 0, expected);
    });
  }
}
function reproduction(h, out) {
  const {K} = h, C = K.leagueCore, B = K.buildGame;
  const S = C.newState('REPRO48', 'south', 0, null, {turns: 12});
  B.selectPack('pyeongtaek', 'league');
  // 실제 평택 지도에서 합법적인 석탄 한 기, 입지 민원 수용자 한 곳인 칸을 고른다.
  const candidates = B.TILES.filter(t => !t.out && t.site < 0 && !B.siteRule('coal', t));
  const singleReceptor = candidates.map(t => {
    const cp = B.complaints({builds: [{t: 'coal', i: t.i}], lines: [], policies: []}, [0]);
    return {tile: t, cp: cp.items};
  }).filter(x => x.cp.length === 1 && x.cp[0].kind === 'siting' &&
    ['village', 'town_s', 'city', 'city_m', 'city_l'].includes(B.TOWNS[x.cp[0].ti].kind))
    .sort((a, b) => b.cp[0].pts - a.cp[0].pts || a.tile.i - b.tile.i);
  const chosen = singleReceptor[0]?.tile;
  assert.ok(chosen, `입지 민원 1건인 ${C.teamDef(C.regionOf('south'), 'pyeongtaek').name} 석탄 칸 필요`);
  for (const id of S.econ.order) S.teams[id].plan = copy(K.ECON_DATA.normalStartPlans[id]);
  S.teams.pyeongtaek.plan.builds.push({t: 'coal', i: chosen.i});
  out.check('reproduction/coal-kept', () => {
    const plan = B.sanitize(S.teams.pyeongtaek.plan, Number.MAX_VALUE);
    assert.equal(plan.builds.filter(b => b.t === 'coal').length, 1, '실제 건설 가능한 석탄 한 기');
  });
  S.round = 1; S.phase = 'plan';
  const operated = C.run(S, B, 0);
  assert.ok(operated, '실제 운영 결과가 있어야 함');
  assert.equal(S.econ.t, 1, '경제 한 달 진행');
  const cities = inspect(h, S.econ, S.econRep, 'reproduction', out);
  const cp = K.__targets48.pyeongtaek.energy.cpList;
  out.check('reproduction/one-siting', () => {assert.equal(cp.length, 1); assert.equal(cp[0].kind, 'siting');});
  const snapshot = K.__targets48.pyeongtaek, numbers = {};
  for (const group of ['senior', 'youth']) {
    const target = -Math.min(K.ECON_DATA.params.complaintCap.v,
      cp.reduce((n, c) => n + c.score, 0) * K.ECON_DATA.params.complaintScale.v);
    const before = snapshot.previous[group].complaint || 0;
    const memory = snapshot.tg[group] < snapshot.groupsBefore[group].sat ? 1 : .152;
    const applied = before + memory * (target - before);
    out.check('reproduction/' + group + '/public-target-number', () => near(cities.pyeongtaek.groupOwn?.[group]?.complaint, rounded(target)));
    out.check('reproduction/' + group + '/public-applied-number', () => {
      near(S.econ.cities.pyeongtaek.groupContrib[group].complaint, applied);
      near(cities.pyeongtaek.groupOwnLag?.[group]?.complaint, rounded(applied));
    });
    out.check('reproduction/' + group + '/count-one', () => {
      assert.equal(cities.pyeongtaek.groupOwn?.[group]?.complaintN, 1);
      assert.equal(cities.pyeongtaek.groupOwn?.[group]?.sitingN, 1);
    });
    h.session.team = 'pyeongtaek';
    out.check('reproduction/' + group + '/bar-number', () => {
      const bar = barsFrom(K.__groupHTML48(cities.pyeongtaek, group, S.econRep, null), K.ECON_DATA)
        .find(b => /^(?:민원\(|민원 요인 \d+개 중 입지 )/.test(b.label)); // rev9 R12: 재현 검사도 기존·K8 라벨 검색.
      assert.ok(bar); near(bar.value, rounded(target)); near(bar.applied, rounded(applied));
      assert.match(bar.label, /입지(?: 민원)?\s+1건/);
    });
    numbers[group] = {target: rounded(target), applied: rounded(applied), complaintN: 1, sitingN: 1, memory};
  }
  if (!out.quiet) console.log('REPRO ' + JSON.stringify({tile: chosen.i, cpList: cp, numbers}));
}
function recovery(h, out) {
  const {econ: X, ECON_DATA: D} = h.K, id = 'pyeongtaek';
  // 실제 엔진으로 불만이 큰 시작 상태를 만든 뒤, 약한 입지 민원만 남기고 회복시킨다.
  // 만족이나 contrib를 수동으로 바꾸지 않으므로 0.152 분기를 실제 운영에서 검증한다.
  const previous = X.initCities([id], D, {seed: 'own48-recovery', months: 12,
    base: {[id]: {energy: energy({pop: D.start[id].pop0}, {cpList: MIXED, hospH: 48, unsPct: 100}),
      policy: {save: true, share: true}}}});
  const result = X.monthStep(previous, {[id]: {energy: energy(previous.cities[id],
    {cpList: [{kind: 'siting', score: 2, src: 'coal', near: 0}]}), policy: {save: false, share: false}}}, D);
  const cities = inspect(h, result.E, result.report, 'recovery', out);
  const target = h.K.__targets48[id], numbers = {};
  for (const group of ['senior', 'youth']) {
    const before = previous.cities[id].groupContrib[group].complaint;
    const goal = target.contrib[group].complaint;
    const expected = before + .152 * (goal - before);
    out.check('recovery/' + group + '/memory-branch', () => {
      near(D.params.approvalMemoryReal.v, .038); near(D.params.eduMemory.v, 4);
      near(D.params.approvalMemoryReal.v * D.params.eduMemory.v, .152);
      assert.ok(target.tg[group] >= previous.cities[id].groups[group].sat, '만족 회복 분기여야 함');
      assert.ok(Math.abs(goal - before) > 1, '민원 목표와 이전 반영의 차이가 있어야 함');
      near(goal, -2 * D.params.complaintScale.v);
    });
    out.check('recovery/' + group + '/applied-formula', () => {
      near(result.E.cities[id].groupContrib[group].complaint, expected);
      near(cities[id].groupOwnLag?.[group]?.complaint, rounded(expected));
      near(cities[id].groupOwn?.[group]?.complaint, rounded(goal));
      assert.notEqual(cities[id].groupOwnLag[group].complaint, cities[id].groupOwn[group].complaint);
    });
    numbers[group] = {satisfactionBefore: previous.cities[id].groups[group].sat,
      satisfactionTarget: target.tg[group], before, target: goal, memory: .152,
      applied: result.E.cities[id].groupContrib[group].complaint, publicApplied: cities[id].groupOwnLag?.[group]?.complaint};
  }
  if (!out.quiet) console.log('RECOVERY ' + JSON.stringify(numbers));
  // 민원이 완전히 사라져도 회복 중 남은 음수 반영값은 penalty로 낭독해야 한다.
  const cleared = X.monthStep(result.E, {[id]: {energy: energy(result.E.cities[id]),
    policy: {save: false, share: false}}}, D);
  const clearedCities = inspect(h, cleared.E, cleared.report, 'recovery-zero', out);
  for (const group of ['senior', 'youth']) out.check(`recovery-zero/${id}/${group}/complaint-penalty`, () => {
    const bar = barsFrom(h.K.__groupHTML48(clearedCities[id], group, cleared.report, null), D)
      .find(b => b.label === LABELS.complaint);
    assert.ok(bar?.own, '회복 중 남은 민원 줄 필요');
    near(bar.value, 0);
    assert.ok(bar.applied < 0, '목표 0·반영 음수 사례 필요');
    assert.equal(bar.ariaLabel, escape(D.groupOwnCopy.penalty));
    assert.equal(bar.aria, escape(`${D.groupOwnCopy.target} 0.00점 · ${D.groupOwnCopy.applied} ${bar.applied.toFixed(2)}점`));
  });
}
const MUTATIONS = [
  {kind: 'public-complaint-omitted', witness: 'focused/pyeongtaek/senior/public-target', file: 'econ', change: s => replaceOnce(s,
    'data.groupOwnKeys.forEach(k => {',
    'data.groupOwnKeys.filter(k => k !== "complaint").forEach(k => {')},
  {kind: 'own-bars-omitted', witness: 'focused/pyeongtaek/senior/bar/complaint', file: 'league', change: s => replaceOnce(s, '[...bars, ...ownBars]', '[...bars]')},
  {kind: 'hospital-double-counted', witness: 'focused/pyeongtaek/senior/hospital-separated', file: 'league', change: s => replaceOnce(s,
    'x.value -= (weights.rel || 0) * (c.hospRel || 0) / z;',
    'x.value -= 0;')},
  {kind: 'all-complaints-counted', witness: 'focused/pyeongtaek/senior/public-counts', file: 'econ', change: s => replaceOnce(s,
    'const complaints = e.cpList.filter(c => (P("complaintGroups")[c.kind] || []).includes(g));',
    'const complaints = e.cpList;')},
  {kind: 'applied-published-as-target', witness: 'recovery/pyeongtaek/senior/public-applied', file: 'league-core', change: s => replaceOnce(s,
    'cities[id].groupOwnLag = ownLag;', 'cities[id].groupOwnLag = Object.fromEntries(Object.entries(c.groupOwn || {}).map(([g, terms]) => [g, Object.fromEntries(KCP.ECON_DATA.groupOwnKeys.filter(k => terms[k]).map(k => [k, terms[k]]))]));')},
  {kind: 'target-applied-text-swapped', witness: 'recovery/pyeongtaek/senior/bar/complaint', file: 'league', change: s => {
    s = replaceOnce(s, 'esc(x.value.toFixed(2))', 'esc(__swap48.toFixed(2))');
    s = replaceOnce(s, 'esc(x.applied.toFixed(2))', 'esc(x.value.toFixed(2))');
    return replaceOnce(s, 'esc(__swap48.toFixed(2))', 'esc(x.applied.toFixed(2))');
  }},
  {kind: 'aria-label-target-sign-only', witness: 'recovery-zero/pyeongtaek/senior/complaint-penalty', file: 'league', change: s => replaceOnce(s,
    '(x.value || x.applied) < 0 ? copy.penalty : copy.contribution',
    'x.value < 0 ? copy.penalty : copy.contribution')},
  {kind: 'aria-valuetext-target-only', witness: 'recovery/pyeongtaek/senior/meter-valuetext', file: 'league', change: s => replaceOnce(s,
    'aria-valuetext="${esc(x.own ? `${copy.target} ${x.value.toFixed(2)}점 · ${copy.applied} ${x.applied.toFixed(2)}점` : `${fmt(x.value, 2)}점`)}"',
    'aria-valuetext="${esc(`${fmt(x.value, 2)}점`)}"')},
  {kind: 'missing-part-renormalization-removed', witness: 'missing-part/pyeongtaek/youth/renormalized-target', file: 'league', change: s => replaceOnce(s,
    'x.value *= totalWeight / z;', '')}
];
const result = collector(); const mutations = [];
try {
  const h = load();
  for (const [label, fn] of [['grid', grid], ['boundaries', boundaries], ['focused', focused], ['reproduction', reproduction]])
    result.check(label + '/execution', () => fn(h, result));
  // 같은 focused 검사에서 새로 실패한 단언이 있어야 검출이다. 문법·연결점·실행 오류는 검출로 인정하지 않는다.
  const control = collector(true); focused(load(), control);
  result.check('mutation/control-clean', () => assert.equal(control.failures, 0, JSON.stringify(control.records.slice(0, 3))));
  const baselineFailures = new Set(control.records.map(r => r.label));
  for (const mutation of MUTATIONS) {
    let detected = false;
    result.check('mutation/' + mutation.kind + '/execution', () => {
      const probe = collector(true); focused(load(mutation), probe);
      const newFailures = probe.records.filter(r => r.assertion && !baselineFailures.has(r.label));
      detected = control.failures === 0 && newFailures.some(r => r.label === mutation.witness);
      console.log('MUTATION ' + mutation.kind + ': ' + (detected ? 'DETECTED ' : 'MISSED ') + mutation.witness);
      assert.ok(detected, '깨끗한 대조군 대비 해당 계약의 단언 실패가 필요: ' + mutation.witness);
    });
    mutations.push({kind: mutation.kind, detected});
  }
} catch (e) {
  result.check('suite/execution', () => {throw e;});
}
if (result.failures > 18) console.error(`FAIL 상세는 앞 18건만 출력 (총 ${result.failures}건)`);
const categories = {};
for (const failure of result.records) {
  const kind = failure.label.startsWith('reproduction/') ? failure.label : failure.label.split('/').slice(4).join('/') || failure.label;
  categories[kind] = (categories[kind] || 0) + 1;
}
console.log('FAILURE_COUNTS ' + JSON.stringify(categories));
process.exitCode = result.failures ? 1 : 0;
console.log(JSON.stringify({suite: '48-group-own', assertions: result.assertions, failures: result.failures, mutations}));
