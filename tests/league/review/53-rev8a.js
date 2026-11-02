'use strict';
// 기대값 출처: rev8-fix/spec-A.md A1~A6 및 rev9-fix/spec.md R14·R15·R18.
// 잡는 회귀: choice 직접 칭찬/연결, 0·0의 grid 주제, 현금 기준 누락,
// 불가능한 down 저장, 0에서 감소를 요구하는 칩, 폭염 감산·교부세 누락.
// 41/32번 VM 방식. 원본 ui/** 수정 없음. 브라우저·네트워크 실행 없음.
// 선택 인자는 기준판/변이 사본 경로. API 부재는 BLOCKED 실패이며 skip 없음.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..');
// rev9 R14: --head는 동시 수정 중인 ui 작업판을 읽지 않는 검증 경로.
const { execFileSync } = require('node:child_process');
const readUI = name => process.argv.includes('--head')
  ? execFileSync('git', ['show', `HEAD:ui/${name}.js`], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(name === 'league' && process.argv[2] || path.join(ROOT, `ui/${name}.js`), 'utf8');
const copy = x => x === undefined ? undefined : structuredClone(x);
const decode = s => String(s).replace(/&(?:amp|lt|gt|quot|#39|#x27);/g,
  x => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }[x]));
const escape = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let assertions = 0, failures = 0;
function test(label, fn) {
  assertions++;
  try { fn(); console.log(`PASS ${label}`); }
  catch (e) { failures++; console.error(`${e.blocked ? 'BLOCKED' : 'FAIL'} ${label}: ${e.message}`); }
}
function blocked(message) { throw Object.assign(new Error(message), { blocked: true }); }
class Element {
  constructor(tag = 'root', attrs = {}, parent = null) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parentElement = parent;
    this.children = []; this.parts = []; this._html = ''; this.style = {}; this.hidden = false;
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-'))
      .map(([k, v]) => [k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v]));
    this.classList = { add() {}, remove() {}, toggle() {}, contains: c => (attrs.class || '').split(/\s+/).includes(c) };
  }
  get textContent() { return this.parts.map(x => typeof x === 'string' ? decode(x) : x.textContent).join(''); }
  set textContent(v) { this.parts = [String(v)]; }
  get innerHTML() { return this._html; }
  set innerHTML(value) {
    this._html = String(value); const root = htmlTree(this._html);
    this.children = root.children; this.parts = root.parts;
    for (const child of this.children) child.parentElement = this;
  }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return Object.hasOwn(this.attrs, k); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  matches(selector) {
    if (selector === '*') return true;
    return selector.split(',').some(part => {
      part = part.trim();
      const bits = part.split(/\s+(?![^\[]*\])/);
      if (bits.length > 1) {
        if (!this.matches(bits.at(-1))) return false;
        let ancestor = this.parentElement, at = bits.length - 2;
        while (ancestor && at >= 0) { if (ancestor.matches(bits[at])) at--; ancestor = ancestor.parentElement; }
        return at < 0;
      }
      if (!part || /[ :>]/.test(part.replace(/\[[^\]]*\]/g, ''))) return false;
      const tag = part.match(/^[a-z][\w-]*/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      const id = part.match(/#([\w-]+)/)?.[1];
      if (id && this.attrs.id !== id) return false;
      for (const [, cls] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(cls)) return false;
      for (const [, key, , value] of part.matchAll(/\[([\w-]+)(?:=(["']?)(.*?)\2)?\]/g)) {
        if (!this.hasAttribute(key) || (value !== undefined && this.attrs[key] !== value)) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

}
function htmlTree(html) {
  const root = new Element(), stack = [root];
  for (const token of String(html).match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith('<')) {
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
      const attrs = {};
      for (const [, k, a, b, c] of token.slice(tag.length + 1, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[k] = decode(a ?? b ?? c ?? '');
      const parent = stack.at(-1), el = new Element(tag, attrs, parent);
      parent.children.push(el); parent.parts.push(el);
      if (!/^(?:br|hr|input|img|meta|link|wbr)$/i.test(tag) && !token.endsWith('/>')) stack.push(el);
    } else stack.at(-1).parts.push(token);
  }
  return root;
}
const storage = new Map(), L = { role: 'solo', room: 'REV8ATEST', team: 'pyeongtaek', rev: 0 };
const document = { documentElement: {}, addEventListener() {}, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [], createElement: tag => new Element(tag) };
const mem = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
const ctx = vm.createContext({ console, performance, structuredClone, URL, __session: L, document,
  addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {},
  localStorage: mem, sessionStorage: mem,
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  KCP: { route() {}, on() {}, gradeWords: String, esc: escape, leagueNet: { expandSnapshot: x => x } } });
ctx.window = ctx;
let bootError;
try {
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core'])
    vm.runInContext(readUI(name), ctx, { filename: name });
  const source = readUI('league');
  console.log('implementation sha256 ' + require('node:crypto').createHash('sha256').update(source).digest('hex'));
  if (source.split('let L = null;').length !== 2 || source.split('KCP.league = {').length !== 2)
    blocked('기준판 VM 연결점이 없어 화면 함수 실행 불가');
  // 기준판에 존재하는 진입점만 메모리에서 노출한다. 새 구현의 함수명을 추측하지 않는다.
  const names = ['promiseTopic', 'predictionHTML', 'promiseComparison', 'promiseResultHTML',
    'reasonStartsHTML', 'evidenceCandidates', 'evidenceFocusHTML', 'outageEvidenceText',
    'outageEventClue', 'resultHTML', 'decisionsHTML', 'trialGoals', 'evidenceEffect', 'OUTAGE_EVIDENCE_LINKS'];
  const hooks = names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(',');
  vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
    .replace('KCP.league = {', `globalThis.__hooks = {${hooks}}; KCP.league = {`), ctx, { filename: 'league-under-test' });
} catch (e) { bootError = e; }
function api(name) {
  if (bootError) blocked(`VM 초기화 실패: ${bootError.message}`);
  const f = ctx.__hooks?.[name] || ctx.KCP.league?.uiMath?.[name];
  if (typeof f !== 'function') blocked(`기준판 진입점 접근 불가: ${name}`);
  return f;
}
const C = ctx.KCP.leagueCore, B = ctx.KCP.buildGame, D = ctx.KCP.ECON_DATA;
const id = L.team, ids = [id, 'dangjin'];
const values = { evening: 100, wind: 5, grid: 20, fuel: 100, neighbor: 10 };
let currentPlan, trialRecord;
function setup(o = {}, city = id) {
  if (bootError) blocked(`VM 초기화 실패: ${bootError.message}`);
  storage.clear();
  const S = C.newState(L.room, 'south', 0, [...new Set([...ids, city])], { turns: 12, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  S.round = o.round ?? 2; S.phase = o.phase || 'plan'; S.events = [];
  const R = C.regionOf(S.region), pack = C.teamDef(R, city).pack;
  B.selectPack(pack, 'league');
  currentPlan = B.sanitize(copy(D.normalStartPlans[city]), 1e9);
  S.teams[city].plan = copy(currentPlan);
  B.current = () => currentPlan;
  B.lastTrial = () => trialRecord;
  B.refresh = () => {}; B.closeDrawer = () => {};
  trialRecord = o.trial ? { ...S.rounds[S.round - 1], map: pack, scope: JSON.stringify([L.room, city]),
    days: 7, unsPct: o.trial.unsPct, gridMWh: o.trial.perDay * 7 } : null;
  S.econ.cities[city].cash = o.cash ?? 3.2;
  S.econ.before ||= {}; S.econ.before[city] = { ...S.econ.cities[city], cash: o.cash ?? 3.2 };
  const result = (round, unsPct, perDay) => ({ ...S.rounds[round - 1], round, days: 7,
    team: { dangjin: { unsPct: 10 }, [city]: { unsPct, uns: 0, imp: 0, sub: 0, isolated: { uns: perDay * 7 },
      co2Cons: 1, co2Prod: 1, outH: 0, cost: { total: 0, repair: 0 } } } });
  S.results = S.round > 1 ? [result(S.round - 1, o.uns ?? 0, o.perDay ?? 0)] : [];
  if (['review', 'end'].includes(S.phase)) S.results.push(result(S.round, o.actualUns ?? 0, o.actualGrid ?? 0));
  const n = { s1EvidenceValues: copy(values), s1EvidenceNeighborId: 'dangjin', ...copy(o.note || {}) };
  if (o.topic) Object.assign(n, { topic: o.topic, confirmed: o.confirmed ?? true });
  const months = { [S.round]: n, ...(S.round > 1 ? { [S.round - 1]: {
    s1EvidenceValues: copy(values), s1EvidenceNeighborId: 'dangjin', ...copy(o.oldNote || {}) } } : {}) };
  Object.assign(L, { team: city, S, snap: S, rev: 0, panel: null, away: false, awaitReady: false,
    outCache: {}, outFailures: {}, outShownPending: null, viewing: null,
    doc: { map: pack, maps: { [pack]: currentPlan }, runs: [], journal: {} },
    interview: { docs: {}, journal: {}, interview: { months } } });
  return { S, n, months, R, pack };
}
function element(html, selector) {
  const el = htmlTree(html).querySelector(selector);
  assert.ok(el, `요소 필요: ${selector}`);
  return el;
}
const cashText = value => `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}억`;
const cashTokens = text => text.match(/[+−-]?\d[\d,]*\.\d{2}억/g) || [];
const signedCash = value => `${value < 0 ? '−' : value > 0 ? '+' : ''}${Math.abs(value).toFixed(2)}억`;

// A2: 표 두 칸과 실제 S7 문장. 부호·기준이 달라도 grid 자체의 방향 효과는 0.
for (const cause of ['choice', 'progress']) test(`A2 연결표 grid→${cause}`, () => {
  api('promiseTopic'); // 초기화 실패도 BLOCKED로 센다.
  const links = ctx.__hooks.OUTAGE_EVIDENCE_LINKS;
  if (!links) blocked('OUTAGE_EVIDENCE_LINKS 접근 불가');
  assert.equal(links.grid[cause], cause === 'choice' ? 'stage' : 'direct');
});
for (const basis of ['trial', 'monthly']) for (const cause of ['choice', 'progress']) for (const sign of [-1, 1])
  test(`A2 S7 ${basis}/grid→${cause}/${sign}`, () => {
    const { n } = setup({ note: { evidence: { key: 'grid', text: '접속 여유', value: 20 } } });
    const a = { basis, round: 2, target: 'uns', trial: 10, actual: 10 + sign * 8,
      total: sign * 8, parts: [{ key: cause, value: sign * 8 }], grid: { value: 0, waitingMW: 0 } };
    const text = api('outageEvidenceText')(n, a, a.parts[0]);
    assert.equal(text.includes('같은 이야기'), cause === 'progress');
    if (cause === 'choice') {
      assert.ok(text.includes('같은 단계'));
      assert.match(text, /다음에는 .+도 근거로 살펴봐요/);
    }
  });
for (const field of ['outageLargest', 'missedCarry']) test(`A2 S1 choice 최대 ${field}`, () => {
  const oldNote = field === 'outageLargest' ? { outageLargest: { key: 'choice', value: 10 } } :
    { missedCarry: { basis: 'monthly', largest: { key: 'choice', value: 10 } } };
  const { S } = setup({ oldNote });
  const rows = api('evidenceCandidates')(S);
  assert.ok(Array.isArray(rows) && rows.length >= 2, '후보를 실제 생성');
  assert.ok(rows.every(row => !/지난달 가장 큰 몫\(내 선택\)과 이어짐/.test(row.tag || '')));
  assert.doesNotMatch(api('evidenceFocusHTML')(S), /지난달 가장 큰 몫\(내 선택\)과 이어짐/);
});
test('A2 S1 progress→grid 연결 유지', () => {
  const { S } = setup({ oldNote: { outageLargest: { key: 'progress', value: 10 } } });
  assert.match(api('evidenceCandidates')(S).find(x => x.key === 'grid')?.tag || '', /지난달 가장 큰 몫/);
});

// A3: 기대값은 명세의 0.005%·0.05 MWh/일 경계에서 직접 정한다.
for (const row of [
  { uns: 0, perDay: 0, want: 'cash' }, { uns: 0, perDay: .049, want: 'cash' },
  { uns: 0, perDay: .05, want: 'grid' }, { uns: 0, perDay: .3, want: 'grid' },
  { uns: 2, perDay: 0, want: 'uns' }, { uns: .005, perDay: 0, want: 'uns' },
  { uns: 2, perDay: .3, cash: -10.04, want: 'cash' },
  { uns: 0, perDay: 0, topic: 'grid', want: 'grid' },
  { uns: 0, perDay: 0, topic: 'uns', want: 'uns' },
  { uns: 2, cash: -1, topic: 'uns', want: 'uns' },
  { uns: 2, perDay: 1, topic: 'cash', want: 'cash' }
]) test(`A3 promiseTopic ${JSON.stringify(row)}`, () => {
  const { S, n } = setup(row); assert.equal(api('promiseTopic')(S, n), row.want);
});
for (const [perDay, want] of [[0, 'cash'], [.3, 'grid']]) test(`A3 첫 달 시험 ${perDay}→${want}`, () => {
  const { S, n } = setup({ round: 1, trial: { unsPct: 0, perDay } });
  assert.equal(api('promiseTopic')(S, n), want);
});
for (const row of [
  { uns: 0, perDay: 1, trial: { unsPct: 2, perDay: 1 }, want: 'uns', disabled: true },
  { uns: .005, perDay: 1, want: 'uns', disabled: false },
  { uns: 0, perDay: .049, topic: 'grid', want: 'grid', disabled: true },
  { uns: 0, perDay: .05, topic: 'grid', want: 'grid', disabled: false },
  { uns: 0, perDay: 0, want: 'cash', disabled: false },
  { uns: 2, perDay: 1, cash: -10.04, want: 'cash', disabled: false }
]) test(`A3 down ${row.want}/${row.uns}/${row.perDay}/${row.cash ?? '양수'}`, () => {
  const { S, n } = setup({ ...row, note: { pred: { [row.want]: 'down' } } });
  const html = api('predictionHTML')(S);
  const select = element(html, `select[data-pred="${row.want}"]`);
  assert.equal(select.querySelector('option[value="down"]').hasAttribute('disabled'), row.disabled);
  if (row.disabled) {
    assert.match(element(html, '#lg-promise-down-why').textContent, /줄 것/);
    if (!n.confirmed) {
      assert.ok(!n.pred?.[row.want], '확정 전 막힌 down은 저장값도 비움');
      const saved = JSON.parse(storage.get('kcp-league-solo-v1') || 'null');
      assert.ok(saved?.interview?.interview?.months?.[S.round], '방향을 비운 월 기록 저장');
      assert.ok(!saved.interview.interview.months[S.round].pred?.[row.want], '저장·복원 경계에도 down 없음');
      assert.ok(!select.querySelector('option[value="down"]').hasAttribute('selected'));
    } else assert.equal(n.pred[row.want], 'down', '굳힌 기록 보존');
  }
});
for (const row of [{ cash: 3.2, uns: 0, perDay: 0, words: ['월말 현금', '지난달'] },
  { cash: -10.04, uns: 2, perDay: 1, words: ['월말 현금', '0'] }])
  test(`A3 cash 전환 안내 ${row.cash}`, () => {
    const { S } = setup(row), line = element(api('predictionHTML')(S), '#lg-promise-cash-why');
    assert.ok(line.classList.contains('lg-hint'));
    for (const word of row.words) assert.ok(line.textContent.includes(word));
  });
// A3: LNG 지수는 후보 자리가 있을 때 D-91로 포함. 첫 달에는 이 조건을 더하지 않는다.
for (const [round, wantFuel] of [[1, false], [2, true]]) test(`A3 S1 D-91 fuel ${round}월`, () => {
  const { S, n } = setup({ round }); n.s1HasWind = false;
  const rows = api('evidenceCandidates')(S);
  assert.ok(rows?.length >= 2);
  assert.equal(rows.some(x => x.key === 'fuel'), wantFuel);
});
test('A3 현금 주제 LNG 근거 방향 −1 유지', () => {
  setup(); assert.equal(api('evidenceEffect')('fuel', { topic: 'cash' }).sign, -1);
});

// A1: 같은 달 S4→S6. 기대 문자열은 고정 입력만으로 소수 둘째·U+2212를 만든다.
for (const [before, after] of [[-10.04, -7.81], [3.2, 1.09], [3.2, 3.2]])
  test(`A1 현금 기준·판정 ${before}→${after}`, () => {
    const { S, n } = setup({ cash: before, note: { evidence: { key: 'fuel', text: 'LNG 지수', value: 100 }, pred: { cash: after > before ? 'up' : after < before ? 'down' : 'same' } } });
    const baseline = element(api('predictionHTML')(S), '#lg-promise-baseline').textContent;
    // rev9 R15: C1 뒤 건설비 꼬리는 별도 숫자이므로 기준 현금만 첫 토큰으로 검사.
    assert.equal(cashTokens(baseline)[0], cashText(before));
    for (const word of ['빚 한도', '남은 돈']) assert.ok(baseline.includes(word));
    assert.ok(!baseline.includes(`+${cashText(before)}`));
    if (before < 0) assert.ok(!baseline.includes('-10.04'));
    n.topic = 'cash'; n.confirmed = true; S.phase = 'review';
    S.econ.before[id].cash = before; S.econ.cities[id].cash = after;
    S.results.push({ ...S.rounds[S.round - 1], round: S.round, days: 7,
      team: { [id]: { unsPct: 0, cost: {} } } });
    const compared = api('promiseComparison')(S, n);
    assert.ok(Math.abs(compared.delta - (after - before)) < 1e-12, 'Δ=월말−운영 전');
    const html = api('promiseResultHTML')(S, n);
    for (const selector of ['#lg-promise-summary', '[data-compare="cash"]']) {
      const text = element(html, selector).textContent;
      assert.deepEqual(cashTokens(text), [cashText(before), cashText(after), signedCash(after - before)], `${selector} 운영 전·월말·Δ 부호와 자릿수`);
    }
  });

// A4: whole copy 대신 핵심 숫자·단위·금지된 감소 안내와 칩 끝 공백만 검사한다.
for (const row of [{ topic: 'cash', cash: -7.81, before: -10.04 },
  { topic: 'uns', actualUns: 0 }, { topic: 'grid', actualGrid: 0 }])
  test(`A4 S8 ${row.topic} 칩`, () => {
    const { S } = setup({ ...row, phase: 'review' });
    if (row.before !== undefined) S.econ.before[id].cash = row.before;
    // rev9 R14: 공개 left가 빠진 합성 상태는 쓰지 않는다.
    S.teams[id].left = 12.34;
    const chips = htmlTree(api('reasonStartsHTML')(S)).querySelectorAll('[data-reason-start]');
    assert.equal(chips.length, 3);
    assert.ok(!chips[1].textContent.includes('줄어드는지'));
    assert.ok(chips.every(x => x.getAttribute('data-reason-start').endsWith(' ')), '입력으로 돌아가는 칩 끝 공백');
    // rev9 R14: 셋째 칩과 입력값은 K10a/K10b의 주제별 문구·끝 공백까지 일치.
    const third = row.topic === 'cash' ? `월말 현금 ${cashText(row.cash)}이라 ` :
      `남은 돈(빚 한도 포함) ${S.teams[id].left.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억이라 `;
    assert.equal(chips[2].textContent, third);
    assert.equal(chips[2].getAttribute('data-reason-start'), third);
    if (row.topic === 'cash') {
      assert.ok(chips[0].textContent.includes('+2.23억'));
      assert.ok(chips[1].textContent.includes('월말 현금'));
    }
  });

// A6: 7월 운영 입력은 실제 엔진으로 만들고 기대 감산은 명세 참고식에서 독립 계산.
const heatKinds = ['lng', 'solar', 'roof'];
function cityNodes(R, city, plan) {
  B.selectPack(C.teamDef(R, city).pack, 'league');
  return B.network(B.sanitize(plan, 1e9)).nodes;
}
function findHeatCity(predicate) {
  api('promiseTopic');
  const R = C.regionOf('south');
  for (const team of R.teams) {
    const plan = copy(D.normalStartPlans[team.id]);
    assert.ok(plan, `${team.id} 기본 계획 자료`);
    const nodes = cityNodes(R, team.id, plan);
    const fixedNodes = cityNodes(R, team.id, { ...plan, builds: [] });
    if (predicate(nodes, fixedNodes)) return team.id;
  }
  return null;
}
const heatLoss = x => ({ lng: (100 * .226 / 30 * 3 * x).toFixed(1), solar: (100 * .004165 * 5 * x).toFixed(1) });
function heatFixture(kinds, x = 1.6, heat = true, city = id) {
  const f = setup({ round: 1 }, city);
  for (const who of Object.keys(f.S.teams)) f.S.teams[who].plan = copy(D.normalStartPlans[who]);
  while (f.S.round < 7) { f.S.events = []; C.run(f.S, B, 0); C.host(f.S, 'next', 0); }
  f.S.events = heat ? [{ id: 'heatwave_peak', round: 7, x }] : [];
  assert.ok(!heat || C.hits(f.R, C.eventDef(f.R, 'heatwave_peak'), city, f.S), '폭염 해당 도시');
  // C.run은 마지막 운영 도시의 팩을 남길 수 있다. 위치 탐색·sanitize 전에 우리 팩부터 고른다.
  B.selectPack(C.teamDef(f.R, city).pack, 'league');
  currentPlan = copy(D.normalStartPlans[city]);
  currentPlan.builds = currentPlan.builds.filter(b => !heatKinds.includes(b.t) || kinds.includes(b.t));
  // 없는 종류의 설비는 합법 위치를 찾아 넣는다(가상 계획, 실제 네트워크 판정).
  for (const kind of kinds) if (!currentPlan.builds.some(b => b.t === kind)) {
    const tile = B.TILES.find(t => !t.out && !currentPlan.builds.some(b => b.i === t.i) && !B.siteRule(kind, t));
    assert.ok(tile, `${kind} 합법 위치`); currentPlan.builds.push({ t: kind, i: tile.i });
  }
  currentPlan = B.sanitize(currentPlan, 1e9);
  const plan = copy(currentPlan), nodes = cityNodes(f.R, city, plan);
  for (const kind of kinds) assert.ok(nodes.some(n => n.kind === kind), `${kind} 도시 망 노드에 존재`);
  f.S.teams[city].plan = copy(plan);
  L.snap = L.S = f.S; L.doc.maps[f.pack] = currentPlan;
  const input = copy(f.S), res = C.run(f.S, B, 0);
  // S7 진입점도 실제 화면 호출 때처럼 해당 도시 팩에서 평가한다.
  B.selectPack(C.teamDef(f.R, city).pack, 'league');
  L.snap = f.S; L.interview.interview.months[7] = { topic: 'uns', confirmed: true };
  return { ...f, input, res, x, city, plan, nodes };
}
function assertHeatPlants({ S, input, res, R, city, plan, nodes, x }) {
  const heat = element(api('resultHTML')(S, res), '#lg-result-heat').textContent;
  B.selectPack(C.teamDef(R, city).pack, 'league');
  const clue = api('outageEventClue')(input.events, input, res, city, plan);
  const loss = heatLoss(x), all = clue.short + clue.full;
  for (const [word, present, amount] of [
    ['LNG', nodes.some(n => n.kind === 'lng'), loss.lng],
    ['일반 태양광', nodes.some(n => ['solar', 'roof'].includes(n.kind)), loss.solar]
  ]) {
    assert.equal(all.includes(word), present, `S7 ${word} 도시 망에 있는 설비만`);
    for (const [screen, text] of [['S6', heat], ['S7', all]]) {
      const found = text.match(new RegExp(`${word}[^%\\d]*?(\\d+\\.\\d)%`));
      assert.equal(found?.[1], present ? amount : undefined, `${screen} ${word} 망 존재·감산 참고식`);
    }
  }
  return heat;
}
for (const x of [.7, 1.6]) test(`A6 S6 폭염 감산 엔진 참고식 x=${x}`, () => {
  const f = heatFixture(['lng', 'solar', 'roof'], x), { S, input, res } = f;
  const html = api('resultHTML')(S, res), root = htmlTree(html), heat = element(html, '#lg-result-heat');
  assert.ok(root.querySelector('#lg-result-deltas'));
  const siblings = heat.parentElement.children;
  assert.equal(siblings.indexOf(heat), siblings.findIndex(e => e.attrs.id === 'lg-result-deltas') + 1, '머리 숫자 칸 바로 아래');
  const { lng, solar } = heatLoss(x);
  // A6: 문구 C11의 편집(부호 대신 '줄었어요' 등)과 독립적으로 수치·단위만 비교.
  for (const [name, amount] of [['LNG', lng], ['일반 태양광', solar]]) {
    const found = heat.textContent.match(new RegExp(`${name}[^%\\d]*?(\\d+\\.\\d)%`));
    assert.equal(found?.[1], amount, `${name} 감산 소수 첫째 자리`);
  }
  const eventOnly = C.modsFor({ ...input, events: [input.events[0]] }, C.regionOf(S.region), id);
  const normal = C.modsFor({ ...input, events: [] }, C.regionOf(S.region), id);
  assert.equal(((1 - eventOnly.lngCapMul / (normal.lngCapMul ?? 1)) * 100).toFixed(1), lng);
  assert.equal(((1 - eventOnly.solarHeatMul / (normal.solarHeatMul ?? 1)) * 100).toFixed(1), solar);
  assertHeatPlants(f);
});
test('A6 폭염 없는 달 #lg-result-heat 없음', () => {
  const { S, res } = heatFixture(['lng', 'solar'], 1.6, false);
  assert.ok(!htmlTree(api('resultHTML')(S, res)).querySelector('#lg-result-heat'));
});
test('A6 기본 망 순회: 해당 설비 없음 C12 또는 기존 LNG C11', () => {
  const city = findHeatCity(nodes => !nodes.some(n => heatKinds.includes(n.kind)));
  if (!city) {
    // 모든 도시 기본 망에 감산 대상이 있으면 명세상 C12에 도달 가능한 도시가 없다.
    // BLOCKED로 처리하지 않고, 신설 없이 기존 LNG만으로 C11이 나오는 경우를 검증한다.
    const existing = findHeatCity((nodes, fixed) => fixed.some(n => n.kind === 'lng'));
    assert.ok(existing, '기존 LNG가 있는 도시 자료');
    const f = heatFixture([], 1.6, true, existing);
    assert.ok(!f.plan.builds.some(b => heatKinds.includes(b.t)), '감산 대상 신설 없음');
    assert.match(assertHeatPlants(f), /LNG[^%]*\d+\.\d%/);
    return;
  }
  const f = heatFixture([], 1.6, true, city);
  assert.ok(!f.nodes.some(n => heatKinds.includes(n.kind)), '도시 기본 망에 감산 대상 없음');
  const text = assertHeatPlants(f);
  for (const word of ['LNG', '일반 태양광', '없']) assert.ok(text.includes(word));
  assert.doesNotMatch(text, /[\d.]+%/);
});
test('A6 기존 LNG: 신설 없이 S6 C11 감산과 S7 단서 일치', () => {
  const city = findHeatCity((nodes, fixed) => fixed.some(n => n.kind === 'lng'));
  assert.ok(city, '기존 LNG가 있는 도시 자료');
  const f = heatFixture([], 1.6, true, city);
  assert.ok(!f.plan.builds.some(b => heatKinds.includes(b.t)), '감산 대상 신설 없음');
  assert.ok(f.nodes.some(n => n.kind === 'lng' && n.bi === undefined), '지도에 원래 있는 LNG 노드');
  assert.match(assertHeatPlants(f), /LNG[^%]*\d+\.\d%/);
});
for (const kinds of [['lng'], ['solar'], ['roof'], ['lng', 'solar'], []])
  test(`A6 S6·S7 폭염 설비별 단서 신설=${kinds.join('+') || '없음'}`, () => {
    assertHeatPlants(heatFixture(kinds));
  });
test('A6 S3 폭염 예보 안내에는 확정 감산 숫자 없음', () => {
  const { input } = heatFixture(['lng', 'solar']);
  L.S = L.snap = input; input.phase = 'plan';
  const goals = api('trialGoals')({ map: L.doc.map, seed: 1, days: 7, tot: { dem: 100, co2: 1, by: { import: 7 } }, unsTotal: 0 });
  assert.ok(Array.isArray(goals?.notes), '시험 안내 notes 진입점');
  const at = goals.notes.findIndex(t => /확정 사건/.test(t));
  assert.ok(at >= 0);
  const text = goals.notes[at + 1] || '';
  for (const word of ['폭염', 'LNG', '일반 태양광', '시험']) assert.ok(text.includes(word));
  assert.doesNotMatch(text, /\d+(?:\.\d+)?\s*%/);
});
for (const repair of [0, 2.35]) test(`A6 끝 화면 교부세·보수비 ${repair}`, () => {
  const { S, months } = setup({ phase: 'end', round: 7 });
  // rev9 R18: C13/C13NoRepair는 S6의 fmt(2), 정수에 .00을 강제하지 않는다.
  const grantText = v => `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('ko-KR', {maximumFractionDigits:2})}억`;
  const grant = { awarded: 10, planUsed: 3.2, repairUsed: repair ? 1.23 : 0, expired: repair ? 5.68 : 6.91 };
  S.results = [{ ...S.rounds[6], round: 7, days: 7, events: [{ id: 'heatwave_peak', round: 7, x: 1.6 }],
    team: { [id]: { disasterGrant: grant, cost: { repair } } } }];
  months[7] = {}; // 약속 없는 달도 결과 교부세 줄이 있어야 한다.
  const root = htmlTree(api('decisionsHTML')(S));
  const rows = root.querySelectorAll('li').filter(el => el.textContent.includes('특별교부세'));
  assert.equal(rows.length, 1, '교부세가 있는 달당 한 줄');
  const text = rows[0].textContent;
  const amounts = repair ? [grant.awarded, grant.planUsed, grant.repairUsed, grant.expired, repair] : [grant.awarded, grant.planUsed, grant.expired];
  assert.deepEqual(text.match(/[+−-]?\d[\d,]*(?:\.\d{1,2})?억/g), amounts.map(grantText), '지급·계획·보수·소멸·전체 보수비 순서와 숫자');
  assert.ok(text.includes(C.eventDef(C.regionOf(S.region), 'heatwave_peak').name), '사건 이름');
  for (const field of ['awarded', 'planUsed', 'expired']) assert.ok(text.includes(grantText(grant[field])), `${field} 숫자`);
  if (repair) {
    assert.ok(text.includes('보수비'));
    assert.ok(text.includes(grantText(grant.repairUsed)) && text.includes(grantText(repair)));
  } else assert.ok(!text.includes('보수비'), '보수비 0 구절 생략');
});
console.log(`assertions ${assertions} failures ${failures}`);
process.exitCode = failures ? 1 : 0;
