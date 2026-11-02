'use strict';
// 기대값의 유일한 근거: 총괄 명세(이슈 #53·#57~#60 항목별, 저장소 밖 보관).
// ui/**는 VM 적재·공개 API 연결·최소 입력 모양 확인에만 사용한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { read, ROOT } = require('./rev14b-vm.cjs');
let assertions = 0, failures = 0, skips = 0;
const counts = new Map();
function test(label, fn, group = label) {
  assertions++;
  try { fn(); } catch (e) {
    failures++;
    const n = counts.get(group) || 0;
    counts.set(group, n + 1);
    if (n < 3) console.log(`${String(e.message).includes('BLOCKED') ? 'BLOCKED' : 'FAIL'} ${label}: ${e.message.split('\n')[0]}`);
  }
}
function skip(label, reason) { skips++; console.log(`SKIP ${label}: ${reason}`); }
function need(object, name) {
  assert.equal(typeof object?.[name], 'function', `BLOCKED 함수 없음: ${name}`);
  return object[name];
}

// rev14b-vm.cjs와 같은 실제 파일 적재. 가짜 저장소는 접근 키와 쓰기 횟수까지 기록한다.
const store = new Map(), calls = [];
const storage = {
  getItem(key) { calls.push(['get', key]); return store.get(key) ?? null; },
  setItem(key, value) { calls.push(['set', key]); store.set(key, String(value)); },
  removeItem(key) { calls.push(['remove', key]); store.delete(key); }
};
let ctx, loaded = false;
test('VM 초기화(build.js 포함)', () => {
  ctx = vm.createContext({ console, performance, structuredClone, URL,
    document: { documentElement: {}, addEventListener() {}, getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [] },
    addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {}, requestAnimationFrame() {},
    localStorage: storage, sessionStorage: storage,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    KCP: { route() {}, on() {}, esc: x => String(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
      gradeWords: String, leagueNet: { expandSnapshot: x => x } }
  });
  ctx.window = ctx;
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league', 'fx-end']) {
    let src = read(name);
    if (name === 'build') {
      const at = src.lastIndexOf('})();');
      assert.ok(at >= 0, 'BLOCKED build VM 연결점 없음');
      // #60 기기 캐시 fixture 입력만 연결한다. pruneTrials/lastTrial 본문과 공개 이름은 그대로.
      src = src.slice(0, at) + '\nglobalThis.__rev15SeedCache = values => { trialMemory = values; };\n' + src.slice(at);
    }
    vm.runInContext(src, ctx, { filename: `ui/${name}.js`, timeout: 10000 });
  }
  loaded = true;
});

if (loaded) {
  const { econ: X, ECON_DATA: D, league, buildGame: B } = ctx.KCP;
  const P = key => D.params[key].v;
  const ids = Object.keys(D.start);
  const initial = X.initCities(ids, D, { seed: 'rev15-service', months: 12 });
  const math = league.uiMath;
  let serviceBase, html, fmt;
  test('#59 공개 serviceBase', () => { serviceBase = need(X, 'serviceBase'); });
  test('#59 공개 migrationBenefitHTML', () => { html = need(math, 'migrationBenefitHTML'); });
  test('#59 공개 fmt', () => { fmt = need(math, 'fmt'); });
  const rng = seed => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const random = rng(0x59150001), samples = [];
  for (let i = 0; i < 3200; i++) samples.push({ id: ids[i % ids.length], inflow: Math.floor(random() * 300001),
    pop: Math.floor(random() * 2000000), share: random(), service: Math.floor(random() * 5) - 2,
    taxRes: Math.floor(random() * 5) - 2, label: `random/${i}` });
  // #59-2: 몫 0·없음·숫자 아님은 0. 음수 몫은 명세 입력 범위로 추가하지 않는다.
  for (const share of [0, undefined, null, '0.144', '손상', NaN, Infinity, 0.144, 1e-8, 1])
    for (const service of [-2, -1, 0, 1, 2, undefined]) for (const inflow of [0, 1, 100000])
      samples.push({ id: ids[0], pop: inflow === 1 ? 0 : 700000, inflow, share, service,
        taxRes: service, label: `edge/${share}/${service}/${inflow}` });
  for (const id of ids) for (const service of [-2, -1, 0, 1, 2])
    samples.push({ id, pop: initial.cities[id].pop, inflow: 50000, share: initial.cities[id].groups.senior.share,
      service, taxRes: -service, label: `initCities/${id}/${service}` });
  let oldDifferent = 0, renderedSamples = 0;
  if (html && fmt) for (const s of samples) {
    const city = { pop: s.pop, policy: { service: s.service, taxRes: s.taxRes },
      ...(s.share === undefined ? {} : { shares: { senior: s.share } }) };
    const res = { year: 2027, month: 1, econ: { net: { [s.id]: { pop: s.inflow } },
      flows: { pop: [{ from: 'fixture-other', to: s.id, n: s.inflow },
        { from: s.id, to: 'fixture-other', n: 7 }] } } };
    const V = { econ: { cities: { [s.id]: city } } };
    // #59-2 자체 식: 기대값에 serviceBase 또는 migrationBenefitHTML을 사용하지 않는다.
    const share = Number.isFinite(s.share) ? s.share : 0;
    const expected = s.inflow * (P('svcCost') + share * P('svcCostSenior')) * (1 + P('svcStep') * (s.service || 0));
    const old = s.inflow * P('svcCost') * (1 + P('svcStep') * (s.service || 0));
    const tax = s.inflow * P('resTax') * (1 + P('taxStep') * (s.taxRes || 0));
    let rendered;
    test(`#59 ${s.label} 서비스 표시`, () => {
      rendered = html(V, res, s.id);
      renderedSamples++;
      const m = rendered.match(/서비스\s*\+([^<]*?)억\/달/);
      assert.ok(m, '서비스 숫자 없음');
      assert.equal(m[1], fmt(expected, 2));
    }, '#59 서비스');
    test(`#59 ${s.label} 주민세 옛 식 보존`, () => {
      const m = rendered?.match(/주민세\s*\+([^<]*?)억\/달/);
      assert.ok(m, '주민세 숫자 없음'); assert.equal(m[1], fmt(tax, 2));
    }, '#59 주민세');
    if (share > 0 && s.inflow > 0) test(`#59 ${s.label} 옛 식과 다름`, () => {
      // 독립 검토 minor 7: expected > old는 검사 상수만으로 늘 참이라 단언에서 뺐다(표시 비교만 남김).
      // #59-3 fmt(…,2) 반올림으로 작은 차이는 같은 글자가 될 수 있다. 수식은 항상 비교한다.
      if (fmt(expected, 2) !== fmt(old, 2)) { oldDifferent++; assert.ok(!rendered?.includes(`서비스 +${fmt(old, 2)}억/달`)); }
    }, '#59 옛 식');
  }
  console.log(`INFO #59 seed=0x59150001 무작위생성=3200 경계·실제도시포함=${samples.length} HTML실행=${renderedSamples} 표시가옛식과다른표본=${oldDifferent}`);
  if (html && fmt) test('#59 옛 식을 구별할 표시 표본 확보', () => assert.ok(oldDifferent >= 3000));
  {
    let maxTaxDiff = 0;
    for (const stage of [-2, -1, 0, 1, 2]) {
      const E = X.initCities(ids, D, { seed: 'rev15-month', months: 12 });
      const input = Object.fromEntries(ids.map(id => [id, { policy: { service: stage, taxRes: stage } }]));
      const step = X.monthStep(E, input, D);
      for (const id of ids) {
        const fiscal = step.report?.fiscal?.[id];
        if (!Number.isFinite(fiscal?.exp?.service)) {
          // 독립 검토 minor 6: 명세 #59 필수 비교라 경로가 없으면 SKIP이 아니라 BLOCKED 실패.
          test(`#59 ${id}/${stage} 월 정산 경로`, () => assert.fail('BLOCKED report.fiscal[id].exp.service 경로 없음')); continue;
        }
        if (serviceBase) test(`#59 ${id}/${stage} serviceBase=월정산/단계배수`, () => {
          // #59 검사 관점(월 정산 비교): 보고의 공개 장부 정밀도에 따른 반 눈금만 허용한다.
          // 서비스 식/단계 배수/도시 몫에는 오차 허용을 적용하지 않는다.
          const c = step.E.cities[id], factor = 1 + P('svcStep') * stage;
          const base = serviceBase(c, D), expected = c.pop * (P('svcCost') + c.groups.senior.share * P('svcCostSenior'));
          assert.equal(base, expected);
          assert.ok(Math.abs(base - fiscal.exp.service / factor) <= 0.5 / P('ledgerRound3') / factor + 1e-10);
        });
        // #59-5 주민세 엔진 비교는 보고만 한다. 회계 반올림 오차를 수치로 출력한다.
        const tax = step.E.cities[id].pop * P('resTax') * (1 + P('taxStep') * stage);
        maxTaxDiff = Math.max(maxTaxDiff, Math.abs(fiscal.rev.resTax - tax));
      }
    }
    console.log(`INFO #59 주민세 옛 식 vs monthStep.report.fiscal[id].rev.resTax: ${ids.length * 5}건 maxAbsDiff=${maxTaxDiff} (회계 반올림, 보고만)`);
  }

  // 독립 검토 minor 4: 화면이 읽는 공개 상태 shares.senior의 출처가 엔진 groups.senior.share와 같은지(명세 #59-2).
  test('#59 publicView cities[id].shares.senior = 엔진 groups.senior.share', () => {
    const C = ctx.KCP.leagueCore, R = C.regionOf('south'), list = R.teams.map(t => t.id);
    const S = C.newState('rev15-shares', R.id, 0, list, { turns: 12 }), V = C.publicView(S, 0);
    assert.ok(list.length > 0);
    for (const id of list) assert.equal(V.econ.cities[id].shares.senior, S.econ.cities[id].groups.senior.share, id);
  });
  const KEY = 'kcp-build-trial-v1';
  let prune;
  test('#60 공개 pruneTrials', () => { prune = need(B, 'pruneTrials'); });
  const scopeA = JSON.stringify(['ROOM-A', ids[0]]), scopeB = JSON.stringify(['ROOM-B', ids[1]]);
  const entry = scope => ({ map: 'pyeongtaek', scope, days: 7, unsPct: 1.25, outH: 3, co2: 4, cost: 5 });
  const entries = () => Object.fromEntries(['', scopeA, scopeB, '읽을 수 없는 scope'].map(s => [JSON.stringify([s, 'pyeongtaek']), entry(s)]));
  const reset = value => { store.clear(); store.set(KEY, typeof value === 'string' ? value : JSON.stringify(value));
    ctx.__rev15SeedCache(structuredClone(typeof value === 'object' ? value : entries())); calls.length = 0; };
  if (prune) {
    test('#60 빈 scope 보존·false만 삭제·true 보존·lastTrial 불변·다른 키 접근 0', () => {
      const before = entries(); reset(before);
      const args = [];
      prune(s => { args.push(s); return s !== scopeA; });
      assert.ok(!args.includes(''), '빈 scope는 keepScope 결과와 무관하게 보존');
      const expected = { ...before }; delete expected[JSON.stringify([scopeA, 'pyeongtaek'])];
      assert.deepEqual(JSON.parse(store.get(KEY)), expected);
      assert.ok(calls.every(([, key]) => key === KEY), '다른 저장 키 접근');
      for (const s of ['', scopeB, '읽을 수 없는 scope'])
        assert.equal(JSON.stringify(B.lastTrial('pyeongtaek', s)), JSON.stringify(entry(s)));
      // 저장을 치워도 삭제 항목이 기기 캐시에서 부활하면 실패한다.
      store.delete(KEY);
      assert.equal(B.lastTrial('pyeongtaek', scopeA), null);
      for (const s of ['', scopeB]) assert.equal(JSON.stringify(B.lastTrial('pyeongtaek', s)), JSON.stringify(entry(s)));
    });
    test('#60 전부 false여도 #build scope는 보존', () => {
      reset(entries()); prune(() => false);
      assert.deepEqual(JSON.parse(store.get(KEY)), { [JSON.stringify(['', 'pyeongtaek'])]: entry('') });
    });
    test('#60 지울 것 없으면 setItem·removeItem 0', () => {
      reset(entries()); const raw = store.get(KEY); prune(() => true);
      assert.equal(store.get(KEY), raw); assert.equal(calls.filter(([op]) => op !== 'get').length, 0);
      assert.ok(calls.every(([, key]) => key === KEY));
    });
    test('#60 손상 { 예외·쓰기·캐시 삭제 0', () => {
      reset('{'); assert.doesNotThrow(() => prune(() => false));
      assert.equal(store.get(KEY), '{'); assert.equal(calls.filter(([op]) => op !== 'get').length, 0);
      for (const s of ['', scopeA, scopeB]) assert.equal(JSON.stringify(B.lastTrial('pyeongtaek', s)), JSON.stringify(entry(s)));
      assert.ok(calls.every(([, key]) => key === KEY));
    });
  }
}

// 작은 CSS 블록 파서: :is() 안 쉼표를 선택자 분리자로 잘못 다루지 않는다.
function blocks(source) {
  const result = []; let start = 0;
  while (start < source.length) {
    const at = source.indexOf('{', start); if (at < 0) break;
    let end = at + 1, depth = 1;
    while (end < source.length && depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
    assert.equal(depth, 0, 'CSS 닫는 괄호 없음');
    result.push({ selector: source.slice(start, at).trim(), body: source.slice(at + 1, end - 1) }); start = end;
  }
  return result;
}
const css = file => fs.readFileSync(path.join(ROOT, 'ui', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const leagueCSS = blocks(css('league.css'));
test('#57 ≥761 한 줄 격자의 모든 선택자가 narrow=true 제외', () => {
  const media = leagueCSS.filter(b => /@media\s*\(min-width:\s*761px\)/.test(b.selector))
    .map(b => blocks(b.body)).filter(rules => rules.some(r => /grid-template-columns:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto/.test(r.body)));
  assert.ok(media.length, 'BLOCKED ≥761 한 줄 5열 격자 블록 없음');
  for (const rules of media) {
    const relevant = rules.filter(r => /#bd-(?:run|skip)/.test(r.selector));
    // #57-2는 규칙 개수가 아닌 적용 조건의 계약이다. 합친 규칙도 모든 선택자를 검사한다.
    assert.ok(relevant.length > 0, '운영 띠 격자 규칙 확보');
    for (const r of relevant) {
      // :is 내부에는 쉼표가 없으므로 최상위 쉼표만 분리한다.
      const selectors = r.selector.split(/,(?![^()]*\))/);
      for (const selector of selectors) assert.ok(selector.includes('#bd-run:not([data-narrow="true"])'), selector);
    }
  }
});
test('#57-5 #build bd-run left·transform·width 보존', () => {
  const rule = blocks(css('build.css')).find(b => b.selector === '.bd-run');
  assert.ok(rule, '.bd-run 기본 규칙 없음');
  for (const value of [/left:\s*50%\s*;/, /transform:\s*translateX\(-50%\)\s*;/, /width:\s*min\(580px,\s*[^;]+\)\s*;/]) assert.match(rule.body, value);
});
test('#58 범례 두 요소의 static 규칙을 진행자에도 적용', () => {
  assert.ok(leagueCSS.some(r => r.selector.replace(/\s+/g, '') === '.lg-map-keys>:is(.lg-town-key,.lg-lens-grid)' && /position:\s*static\s*;/.test(r.body)),
    '팀 조건 없는 .lg-map-keys > :is(.lg-town-key, .lg-lens-grid) position: static 필요');
});
test('#58 lg-town-key 기본 z-index 29 보존', () => {
  const base = leagueCSS.find(r => r.selector === '.lg-town-key');
  assert.ok(base); assert.match(base.body, /z-index:\s*29\s*;/);
});
console.log(`INFO SKIP ${skips} (통과 단언에 넣지 않음)`);
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode = failures ? 1 : 0;
