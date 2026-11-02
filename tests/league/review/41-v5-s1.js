'use strict';
// V5-s1-tests.md 1~11 / V5-s1-cards.md §1~5. Node 전용, 브라우저·통신 없음.
// 30/32번처럼 VM의 L 초기값을 연결한다. 기준 버전에만 비교용 함수 노출을 주입한다.
// HTML/클릭 API가 없으면 BLOCKED를 실패로 집계한다(건너뛴 검사를 통과로 세지 않음).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { URL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..');
const BASE = '9c14549';
const copy = x => x === undefined ? undefined : structuredClone(x);
const order = ['evening', 'wind', 'grid', 'fuel', 'neighbor'];
const labels = { evening: '저녁 수요', wind: '풍속', grid: '접속 여유', fuel: 'LNG', neighbor: '이웃 정전' };
const promiseNames = { ...labels, fuel: 'LNG 지수' };
const units = { evening: ' MW', wind: ' m/s', grid: ' MW', fuel: '', neighbor: '%' };
const s7 = { weather: '날씨·운전 기간', event: '사건·대응', progress: '접속·공사·기술 진행',
  choice: '내 선택', trade: '이웃 거래', growth: '도시 성장·연료 값' };
// 명세 A2: S1 2단계에서 choice→grid를 잇지 않는다. progress는 유지.
const linked = { weather: 'evening', progress: 'grid', trade: 'neighbor', growth: 'fuel' };
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decode = s => s.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g,
  x => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }[x]));
let assertions = 0, failures = 0, blocked = 0;
const missing = new Set();
function test(label, fn) {
  assertions++;
  try { fn(); console.log(`PASS ${label}`); }
  catch (e) {
    failures++;
    if (e.blocked) blocked++;
    console.error(`${e.blocked ? 'BLOCKED' : 'FAIL'} ${label}: ${e.message}`);
  }
}
function api(h, name) {
  // 이미 존재하는 함수 이름만 사용한다. 새 구현의 후보 함수/속성 이름을 추측하지 않는다.
  const fn = h.U[name] || h.U.uiMath?.[name];
  if (typeof fn === 'function') return fn;
  missing.add(name);
  throw Object.assign(new Error(`공개 API 필요: ${name}${h.baseline ? ` (${BASE} 기준 구현)` : ''}`), { blocked: true });
}

// 작은 HTML 트리: 클래스/신규 data 속성 이름을 계약으로 만들지 않고,
// 명세의 id·role·aria·보이는 이름으로 카드를 찾고 실제 반환 속성으로 클릭한다.
class Element {
  constructor(tag = 'root', attrs = {}, parent = null) {
    this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parentElement = parent;
    this.children = []; this.parts = []; this._html = ''; this.style = {}; this.hidden = false;
    this.listeners = new Map();
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
  closest(selector) {
    const bits = selector.trim().split(/\s+(?![^\[]*\])/);
    for (let el = this; el; el = el.parentElement) {
      if (!el.matches(bits.at(-1))) continue;
      let ancestor = el.parentElement, at = bits.length - 2;
      while (ancestor && at >= 0) { if (ancestor.matches(bits[at])) at--; ancestor = ancestor.parentElement; }
      if (at < 0) return el;
    }
    return null;
  }
  querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  click() {
    if (this.hasAttribute('disabled')) return;
    let stopped = false;
    const event = { target: this, preventDefault() {}, stopPropagation() { stopped = true; } };
    // target은 칩 그대로 유지하고, 서랍 루트의 위임 처리기까지 버블링한다.
    const ancestors = [];
    for (let el = this; el; el = el.parentElement) ancestors.push(el);
    for (const el of ancestors) {
      event.currentTarget = el;
      for (const listener of el.listeners.get('click') || []) listener.call(el, event);
      if (stopped) break;
    }
  }
  focus() { this.focused = true; }
  scrollIntoView() {}
  scrollTo() {}
  getBoundingClientRect() { return { top: 0 }; }
  contains(el) { return el === this || this.children.some(c => c.contains(el)); }
  cloneNode() { return new Element(this.tagName, { ...this.attrs }); }
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
function cardKey(card) {
  const keys = order.filter(k => Object.values(card.attrs).includes(k));
  if (keys.length === 1) return keys[0];
  return order.find(k => card.textContent.includes(labels[k]));
}
function view(h) {
  const html = api(h, 'evidenceFocusHTML')(h.L.snap), root = htmlTree(html);
  const focus = root.querySelector('#lg-evidence-focus');
  const group = focus?.querySelector('[role="group"][aria-label="근거 후보"]');
  const cards = group?.querySelectorAll('button[aria-pressed]') || [];
  const promise = focus?.querySelectorAll('button').find(b => /약속/.test(b.textContent) && !cards.includes(b));
  return { html, root, focus, group, cards, promise, keys: cards.map(cardKey) };
}
function makeHarness(source, baseline = false, legacyMedia = false) {
  const storage = new Map(), wire = [], nodes = new Map();
  const L = { room: 'S1CARDS', team: 'pyeongtaek', role: 'team', rev: 0, outCache: {},
    pendingRequests: new Map(), conn: { send: (...args) => wire.push(copy(args)) } };
  const document = { documentElement: {}, activeElement: null, addEventListener() {}, createElement: tag => new Element(tag),
    getElementById: id => nodes.get(id) || null,
    querySelector: selector => [...nodes.values()].map(n => n.matches(selector) ? n : n.querySelector(selector)).find(Boolean) || null,
    querySelectorAll: () => [] };
  const ctx = vm.createContext({ console, performance, structuredClone, URL, __session: L, document,
    addEventListener() {}, setTimeout() { return 0; }, clearTimeout() {},
    matchMedia: q => ({ matches: /max-width:\s*(\d+)/.test(q) ? L.width <= +q.match(/max-width:\s*(\d+)/)[1] :
      /min-width:\s*(\d+)/.test(q) && L.width >= +q.match(/min-width:\s*(\d+)/)[1],
      ...(legacyMedia ? { addListener() {} } : { addEventListener() {} }) }),
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    KCP: { route() {}, on() {}, esc: escape, gradeWords: x => x, leagueNet: {
      expandSnapshot: x => x, createIdentity: async () => ({ publicKey: 'synthetic-public' }),
      signEnvelope: async (_, team, request) => ({ team, request }), requestBody: envelope => envelope.request } } });
  ctx.window = ctx; ctx.sessionStorage = ctx.localStorage;
  vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8'), ctx, { filename: name });
  assert.equal(source.split('let L = null;').length, 2, '30/32번 VM 세션 연결점');
  if (baseline) {
    // 검사용 주입: 기준 구현만 기존 함수들을 uiMath 끝에 노출해 서랍·배지를 비교한다.
    const hook = /uiMath:\s*\{[^{}]*\}/g;
    assert.equal([...source.matchAll(hook)].length, 1, '기준 구현 uiMath 노출 연결점');
    source = source.replace(hook, fields => fields.replace(/\s*\}$/, ', evidenceFocusHTML, predictionHTML, renderBar, renderPanel, onPanelClick }'));
  } else {
    // 반환 순서도 검사하되 선발 함수 자체는 바꾸지 않는다.
    assert.equal(source.split('state: () =>').length, 2, '후보 반환 API 연결점');
    source = source.replace('state: () =>', '__evidenceCandidates: evidenceCandidates, state: () =>');
  }
  vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;'), ctx);
  const { leagueCore: C, buildGame: B, league: U, ECON_DATA: D } = ctx.KCP;
  return { ctx, L, U, C, B, D, storage, wire, nodes, baseline, R: C.regionOf('south') };
}
// 선택 인자는 변이 검사용 사본 경로. 기본 실행은 작업 중인 구현을 읽는다.
const source = fs.readFileSync(process.argv[2] || path.join(ROOT, 'ui/league.js'), 'utf8');
const h = makeHarness(source);
const old = makeHarness(execFileSync('git', ['show', `${BASE}:ui/league.js`], { cwd: ROOT, encoding: 'utf8' }), true);
const standard = { evening: 100, wind: 5, grid: 20, fuel: 100, neighbor: 10 };
function fixture(h, opt = {}) {
  h.storage.clear(); h.wire.length = 0; h.nodes.clear();
  const panel = new Element('aside', { id: 'lg-panel' });
  panel.addEventListener('click', event => api(h, 'onPanelClick')(event));
  h.nodes.set('lg-panel', panel);
  Object.assign(h.L, { role: opt.role || 'team', away: !!opt.away, panel: null, width: opt.width || 1280, rev: 0 });
  h.L.viewing = opt.viewing || null;
  delete h.L.interview;
  const S = h.C.newState('S1CARDS', 'south', 0, ['pyeongtaek', 'dangjin'], { turns: 12, seedMode: 'fixed' });
  h.C.host(S, 'next', 0);
  S.round = opt.first ? 1 : 2;
  S.events = [];
  const values = { ...standard, ...opt.values };
  const V = copy(h.C.publicView(S, 0));
  const E = opt.event === 'response' ? h.R.events.find(e => e.opts?.length && h.C.hits(h.R, e, h.L.team)) :
    opt.event === 'regulation' ? h.R.events.find(e => !e.opts?.length && h.C.hits(h.R, e, h.L.team)) : null;
  if (opt.event) assert.ok(E, `합성 ${opt.event} 사건 정의`);
  V.events = E ? [{ id: E.id, round: V.round }] : [];
  if (opt.phase) V.phase = opt.phase;
  const c = V.econ.cities[h.L.team];
  c.cash = opt.cash ?? 100;
  c.pop = c.pop0; c.ind = c.ind0; c.grid = { ...c.grid, headroomMW: values.grid };
  V.econ.intl.lng = values.fuel;
  V.results = opt.first ? [] : [{ round: V.round - 1, team: { dangjin: { unsPct: values.neighbor } } }];
  h.B.selectPack(h.C.teamDef(h.R, h.L.team).pack, 'league');
  // 엔진 경계 합성: S1 함수는 바꾸지 않고 공개 build 입력만 고정한다.
  h.plan = h.B.sanitize(copy(h.D.normalStartPlans[h.L.team]), 1e9);
  h.plan.builds = h.plan.builds.filter(b => !['wind', 'offshore'].includes(b.t));
  if (opt.wind) h.plan.builds.push({ t: opt.wind, i: 0 });
  h.B.current = () => h.plan;
  h.B.refresh = () => {}; h.B.closeDrawer = () => {};
  h.B.demand = () => values.evening / h.B.TOWNS.length;
  const climate = h.B.PACKS[h.C.teamDef(h.R, h.L.team).pack].climate;
  climate.wind10_land = Array(13).fill(Number.isFinite(values.wind) ? values.wind / (climate.hub_factor_land || 1) : null);
  const current = { s1EvidenceValues: copy(values), s1EvidenceNeighborId: 'dangjin', ...copy(opt.note || {}) };
  const previous = { ...(opt.previous ? { s1EvidenceValues: copy(opt.previous), s1EvidenceNeighborId: opt.oldNeighbor || 'dangjin' } : {}), ...copy(opt.oldNote || {}) };
  const data = { docs: {}, journal: {}, interview: { months: { [V.round]: current, ...(opt.first ? {} : { [V.round - 1]: previous }) } } };
  V.sid = 'synthetic-session';
  const pack = h.C.teamDef(h.R, h.L.team).pack;
  h.L.snap = V; h.L.S = S; h.L.doc = { map: pack, maps: { [pack]: h.plan }, runs: [], journal: {} };
  if (opt.role === 'solo') h.L.interview = data;
  else h.storage.set(`kcp-league-data-v1:${h.L.room}:${h.L.team}`, JSON.stringify(data));
  if (opt.noEcon) delete V.econ;
  return { values, previous, current, E, opt };
}
function note(h) {
  const data = h.L.role === 'solo' ? h.L.interview : JSON.parse(h.storage.get(`kcp-league-data-v1:${h.L.room}:${h.L.team}`) || '{}');
  return data.interview?.months?.[h.L.snap.round];
}
// 독립 오라클: UI 함수/상수/반환값을 읽지 않는다. 동률은 명세 §2가 참조한 기존 목록 순서.
function displayedChange(key, value, before) {
  const delta = value - before;
  const amount = key === 'neighbor' ? delta : before === 0 ? value : delta / Math.abs(before) * 100;
  return Number(amount.toFixed(2)) + 0; // JS 두 자리 반올림, -0도 0으로 정규화.
}
function expected(f) {
  const hasWind = typeof f.current.s1HasWind === 'boolean' ? f.current.s1HasWind : !!f.opt.wind;
  const found = new Map(), valid = k => Number.isFinite(f.values[k]) && (k !== 'wind' || hasWind);
  const add = (key, rule, cause) => { if (valid(key) && !found.has(key) && found.size < 3) found.set(key, { rule, cause }); };
  const prev = f.previous.s1EvidenceValues;
  const ranked = prev ? order.filter(k => valid(k) && Number.isFinite(prev[k]) &&
      (k !== 'neighbor' || f.previous.s1EvidenceNeighborId === 'dangjin')).map(key => ({ key,
      size: prev[key] === 0 ? f.values[key] === 0 ? 0 : Infinity : Math.abs((f.values[key] - prev[key]) / Math.abs(prev[key])) })) : [];
  ranked.sort((a, b) => b.size - a.size);
  if (ranked.length) add(ranked[0].key, 1);
  // V7 B·E: 고정본을 새 문턱으로 다시 읽는다. 후보가 없으면 저장된 largest도 연결하지 않는다.
  const frozen = f.previous.outageFrozen, carry = f.previous.missedCarry;
  const minPart = a => a?.target === 'grid' ? Math.max(Math.max(.05, Math.abs(a.trial ?? a.base ?? 0) * .05) / 10, .05) : .05;
  const total = frozen?.total ?? (frozen?.actual - (frozen?.trial ?? frozen?.base));
  const cardMin = Number.isFinite(total) ? Math.max(minPart(frozen), .05 * Math.abs(total)) : minPart(frozen);
  const candidates = [...(frozen?.parts || [])].filter(p => Math.abs(p.value) >= cardMin)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3);
  const largest = f.previous.outageLargest?.key || carry?.largest?.key;
  const connection = (!frozen?.parts || candidates.length > 0) ? linked[largest] : undefined;
  if (connection) add(connection, 2, largest);
  add('wind', 3);
  // 고정본에 parts가 없으면 growth는 거짓이며, 축약 기록으로 대체하지 않는다.
  const fuel = (frozen ? candidates.some(p => p.key === 'growth') :
    carry?.largest?.key === 'growth' && Math.abs(carry.largest.value) >= minPart(carry)) || (f.opt.cash ?? 100) < 0;
  if (fuel) add('fuel', 4);
  // 계약 5: 비교 가능한 변화율부터, 지난달 값이 없으면 고정 순서로 뒤에.
  // 표시할 변화가 두 자리 반올림 뒤 0이면 두 후보를 확보할 때만 쓴다. 1~4단계 선발은 보존한다.
  const comparable = ranked.map(x => x.key);
  const remaining = [...comparable, ...order.filter(k => !comparable.includes(k))]
    .filter(k => valid(k) && (k !== 'fuel' || fuel) && !found.has(k));
  const missingPrevious = remaining.filter(k => !comparable.includes(k));
  const deferred = remaining.filter(k => comparable.includes(k) && displayedChange(k, f.values[k], prev[k]) === 0);
  for (const key of remaining.filter(k => !deferred.includes(k) && !missingPrevious.includes(k))) add(key, 5);
  for (const key of [...deferred, ...missingPrevious]) {
    if (found.size >= 2) break;
    add(key, 5);
  }
  const pick = f.current.s1Pick;
  if (order.includes(pick) && Number.isFinite(f.values[pick]) && !found.has(pick)) {
    if (found.size === 3) found.delete([...found.keys()].at(-1));
    found.set(pick, { rule: 6 });
  }
  return order.filter(k => found.has(k)).map(key => ({ key, ...found.get(key) }));
}
// 명세의 조사 규칙을 독립 계산한다. 제품의 withParticle은 사용하지 않는다.
function expectedPromise(name) {
  const last = name.codePointAt(name.length - 1);
  assert.ok(last >= 0xac00 && last <= 0xd7a3, '근거의 짧은 이름은 한글 음절로 끝남');
  const jongseong = (last - 0xac00) % 28;
  return `${name}${jongseong === 0 || jongseong === 8 ? '로' : '으로'} 약속하기`;
}
function click(h, element) {
  assert.ok(element, '클릭할 공개 HTML 단추');
  api(h, 'onPanelClick')({ target: element, preventDefault() {}, stopPropagation() {} });
}
function selected(v) { return v.cards.filter(b => b.getAttribute('aria-pressed') === 'true').map(cardKey); }
function assertCandidates(h, f) {
  const v = view(h), wanted = expected(f).map(x => x.key);
  assert.ok(v.group, '#lg-evidence-focus 안 role=group aria-label=근거 후보');
  assert.deepEqual([...v.keys].sort(), [...wanted].sort(), '독립 후보 키 집합');
  assert.equal(new Set(v.keys).size, v.keys.length, '중복 없음');
  assert.equal(v.keys.length, wanted.length, '계약 6: 제외한 풍속·LNG로 다시 채우지 않음');
  assert.ok(v.keys.length <= 3, '후보 최대 세 개');
  assert.deepEqual(v.keys, wanted, '선발 순위와 무관한 고정 순서');
  const returned = copy(h.U.__evidenceCandidates(h.L.snap));
  assert.deepEqual(returned.map(x => x.key), wanted, '반환 순서도 고정·중복 없음·최대 세 개');
  // 꼬리표의 숫자 0만 금지한다. +100% 같은 정상 변화나 카드 본문의 현재 값과 구별한다.
  const zeroTag = /(?:^|[^\d.])[+−-]?0(?:\.0+)?%p?|(?:^|[^\d.])\+0\.00(?!\d)/;
  for (const item of returned) {
    const card = v.cards.find(c => cardKey(c) === item.key);
    assert.doesNotMatch(item.tag || '', zeroTag, `${item.key} 반환 꼬리표에 0%·0%p·+0.00 없음`);
    assert.doesNotMatch(card.querySelector('.lg-s1-tag')?.textContent || '', zeroTag,
      `${item.key} 화면 꼬리표에 0%·0%p·+0.00 없음`);
  }
  assert.ok(v.focus.textContent.includes(`이번 달 볼 것 · 근거 후보 ${wanted.length}개`));
  return v;
}

// 접속 여유 기준 한 줄 계약 1~7. S1 문장 변이·연결 누락·잘못된 노출을 잡는다.
// 문장은 복사하지 않는다. 같은 입력의 S4를 렌더해 읽는다.
// S4 원문은 fb8b48b에서 승인된 끝 구절을 한 번만 교체한 HTML에 고정한다.
function s4GridBasis(h) {
  const html = api(h, 'predictionHTML')(h.L.snap), root = htmlTree(html);
  const elements = root.querySelectorAll('#lg-evidence-grid-basis');
  assert.equal(elements.length, 1, 'S4 기준 요소 정확히 하나');
  const element = elements[0];
  assert.equal(element.tagName, 'P');
  assert.ok(element.closest('#lg-promise-rules'), 'S4 약속 비교 기준 자세히 안');
  const raw = html.match(/<p\b[^>]*\bid="lg-evidence-grid-basis"[^>]*>[\s\S]*?<\/p>/)?.[0];
  assert.ok(raw, '바이트 비교할 S4 원문 HTML');
  return { element, raw };
}
const gridCases = [
  ['세 후보 중간', { previous: standard, values: { evening: 110, grid: 3.65, neighbor: 11 } }],
  ['세 후보 마지막(390에서는 접힘)', { wind: 'wind', previous: standard, values: { evening: 200, grid: 30, fuel: null } }],
  ['두 후보', { values: { wind: null, fuel: null, neighbor: null } }],
  ['grid만 숫자', { values: { evening: null, wind: null, fuel: null, neighbor: null } }],
];
for (const role of ['team', 'solo']) for (const width of [1280, 390]) for (const [label, opt] of gridCases)
  test(`접속 기준 계약 1·2·3 ${role}/${width}/${label}`, () => {
    const f = fixture(h, { ...opt, role, width }), v = assertCandidates(h, f);
    assert.ok(v.keys.includes('grid'), 'grid 포함 합성 입력');
    const all = v.root.querySelectorAll('#lg-s1-grid-basis');
    assert.equal(all.length, 1, 'S1 기준 문장 정확히 하나');
    const basis = all[0];
    assert.equal(basis.tagName, 'P');
    assert.ok(v.focus.contains(basis), '#lg-evidence-focus 안');
    assert.equal(basis.closest('[role="group"]'), null, '카드 묶음 밖');
    assert.equal(basis.closest('details'), null, '접힘 밖(390 포함)');
    for (let el = basis; el; el = el.parentElement) {
      assert.ok(!el.hasAttribute('hidden'), '숨김 속성 없음');
      assert.notEqual(el.getAttribute('aria-hidden'), 'true', '접근성 트리에서 숨기지 않음');
    }
    assert.equal(basis.textContent, s4GridBasis(h).element.textContent, '같은 입력 S1·S4 글자 완전 동일');
    assert.match(basis.textContent, /새 접속/);
    assert.match(basis.textContent, /지도 칩/);
    const grid = v.group.querySelector('#lg-s1-grid');
    assert.ok(grid, 'grid 카드 단추');
    assert.equal(grid.getAttribute('aria-describedby'), 'lg-s1-grid-basis');
    for (const card of v.cards.filter(c => c !== grid))
      assert.ok(!card.hasAttribute('aria-describedby'), '다른 카드에 설명 연결 속성 없음');
    if (width === 390 && label.startsWith('세 후보 마지막')) {
      const fold = grid.closest('details');
      assert.ok(fold, 'grid 단추가 접힌 마지막 후보인 입력');
      assert.ok(!fold.hasAttribute('open'), '390에서 실제 접힘 마크업');
      assert.ok(!fold.contains(basis), 'grid 단추가 접혀도 설명은 밖');
    }
  });
for (const role of ['team', 'solo']) for (const width of [1280, 390]) for (const [label, opt] of gridCases)
  test(`접속 기준 문구 ${role}/${width}/${label}/S1·S4 양방향 차이`, () => {
    fixture(h, { ...opt, role, width });
    const s1 = view(h).focus.querySelector('#lg-s1-grid-basis');
    assert.ok(s1, 'S1 기준 요소 존재');
    for (const [surface, text] of [['S1', s1.textContent], ['S4', s4GridBasis(h).element.textContent]]) {
      assert.ok(text.includes('다를 수 있어요'), `${surface} 양방향 차이 설명 포함`);
      assert.ok(!text.includes('더 작을 수'), `${surface} 한 방향 설명 없음`);
      assert.ok(!text.includes('보통'), `${surface} 측정 근거 없는 빈도 설명 없음`);
    }
  });
for (const width of [1280, 390]) for (const [label, opt] of [
  ['grid 값은 있으나 후보에서 탈락', { wind: 'wind', cash: -1, previous: standard }],
  ['grid 값 없음', { values: { grid: null } }],
  ['모든 값 없음', { values: Object.fromEntries(order.map(k => [k, null])) }],
]) test(`접속 기준 계약 3·4 ${width}/${label}`, () => {
  const f = fixture(h, { ...opt, width }), v = assertCandidates(h, f);
  assert.ok(!v.keys.includes('grid'), 'grid 미포함 합성 입력');
  assert.equal(v.root.querySelectorAll('#lg-s1-grid-basis').length, 0, 'grid 없는 후보에는 기준 문장 없음');
  for (const card of v.cards) assert.ok(!card.hasAttribute('aria-describedby'), '다른 카드에 설명 속성 없음');
});
for (const [label, opt] of [
  ['대응 사건/team', { event: 'response' }],
  ['대응 사건/solo', { event: 'response', role: 'solo' }],
  ['진행자', { role: 'host' }],
  ['진행자 관전', { role: 'host', viewing: 'dangjin' }],
  ['팀 away', { away: true }],
  ['solo away', { role: 'solo', away: true }],
]) test(`접속 기준 계약 5 ${label}`, () => {
  // 제외 조건을 제거하면 grid가 나올 입력을 사용해 단순 후보 탈락과 구별한다.
  fixture(h, { ...opt, previous: standard, values: { grid: 3.65 } });
  const v = view(h);
  assert.ok(!v.group, '카드 묶음 없음');
  assert.equal(v.root.querySelectorAll('#lg-s1-grid-basis').length, 0, '기준 문장 없음');
});
for (const role of ['team', 'solo']) test(`접속 기준 계약 6 ${role}/처리 전 3.65 MW 유지`, () => {
  fixture(h, { role, previous: standard, values: { grid: 3.65 } });
  // 기기에 저장한 처리 전 값과 현재 도시의 처리 뒤 값을 의도적으로 다르게 둔다.
  h.L.snap.econ.cities[h.L.team].grid.headroomMW = 2.4;
  const card = view(h).group.querySelector('#lg-s1-grid');
  assert.equal(card.querySelector('strong').textContent, '접속 여유 · 3.65 MW');
  click(h, card);
  assert.equal(view(h).group.querySelector('#lg-s1-grid strong').textContent, '접속 여유 · 3.65 MW');
  assert.equal(note(h).s1EvidenceValues.grid, 3.65, '저장한 약속 판정 기준 값 불변');
  assert.equal(h.L.snap.econ.cities[h.L.team].grid.headroomMW, 2.4, '처리 뒤 도시 값 불변');
});
const gridBasisOriginal = makeHarness(execFileSync('git', ['show', 'fb8b48b:ui/league.js'],
  { cwd: ROOT, encoding: 'utf8' }), true);
for (const role of ['team', 'solo']) for (const width of [1280, 390])
  test(`접속 기준 계약 7 ${role}/${width}/S4 HTML = fb8b48b 승인된 두 구절 교체`, () => {
    const opt = { role, width, previous: standard, values: { grid: 3.65 } };
    for (const a of [h, gridBasisOriginal]) fixture(a, opt);
    const original = s4GridBasis(gridBasisOriginal).raw;
    assert.equal(original.split('더 작을 수 있어요').length - 1, 1, 'fb8b48b S4 원문에 옛 구절 정확히 한 번');
    const expectedHTML = original.replace('더 작을 수 있어요', '다를 수 있어요').replace('값이에요. 지도 칩은', '값이고, 지도 칩은');
    assert.deepEqual(Buffer.from(s4GridBasis(h).raw, 'utf8'),
      Buffer.from(expectedHTML, 'utf8'), '승인된 두 구절 교체 외 S4 HTML UTF-8 바이트 동일');
  });

test('하네스 HTML 파서: 그룹·속성·조상 클릭·이스케이프', () => {
  const root = htmlTree('<section id="lg-evidence-focus"><div role="group" aria-label="근거 후보"><button type="button" aria-pressed="false" data-any-key="wind">풍속 &lt;img&gt;</button></div></section>');
  const card = root.querySelector('[role="group"][aria-label="근거 후보"]').querySelector('button[aria-pressed]');
  assert.equal(cardKey(card), 'wind'); assert.equal(card.textContent, '풍속 <img>');
  assert.equal(card.closest('#lg-evidence-focus [data-any-key]'), card);
  assert.equal(root.querySelector('img'), null);
});
test('부록 matchMedia: addListener만 있는 환경에서 리그 로드', () => {
  const legacy = makeHarness(source, false, true);
  assert.equal(legacy.U.state().role, 'team', '예외 없이 공개 리그 API까지 초기화');
});
test('브라우저 상수 근거: 고정 씨앗 4월 사건 0개', () => {
  const S = h.C.newState('S1CARDS', 'south', 0, ['pyeongtaek', 'dangjin', 'asan'], { turns: 12, seedMode: 'fixed' });
  for (let month = 1; month <= 4; month++) {
    h.C.host(S, 'next', 0);
    if (month === 2 || month === 3) assert.deepEqual(Array.from(S.events.filter(e => e.round === S.round), e => e.id), ['finedust_coal_cap']);
    if (month === 4) { assert.equal(S.seedKey, '0'); assert.equal(S.events.filter(e => e.round === S.round).length, 0); }
    else { for (const id of h.C.activeOf(S)) S.teams[id].plan = copy(h.D.normalStartPlans[id]); h.C.run(S, h.B, 0); }
  }
});
for (const role of ['team', 'solo']) for (const event of [undefined, 'regulation'])
  test(`1 §1 ${role}/${event || '사건 0개'} 카드 묶음`, () => { fixture(h, { role, event }); assert.ok(view(h).group); });
for (const opt of [{ role: 'host' }, { role: 'host', viewing: 'dangjin' }, { away: true }, { noEcon: true }, { phase: 'review' }, { phase: 'end' }])
  test(`1 §1 제외 조건 ${JSON.stringify(opt)}`, () => { fixture(h, opt); assert.ok(!view(h).group); });
test('1 §1·5 대응 사건 달 카드 없음', () => { fixture(h, { event: 'response' }); assert.ok(!view(h).group); });
function eventDrawerHTML(a) {
  // 기준 버전은 하네스에서 검사용으로 노출한 기존 렌더 함수를 사용한다.
  const fn = api(a, 'renderPanel'); a.L.panel = 'deal';
  const panel = new Element('aside', { id: 'lg-panel' }); a.nodes.set('lg-panel', panel);
  fn(); return panel.innerHTML;
}
function normalizeEventSources(html) {
  const blocks = [];
  // 이 클래스의 details만 치환한다. 다른 접힘과 블록 밖 공백·속성은 그대로 둔다.
  const normalized = html.replace(/<details\b[^>]*\sclass="lg-event-source"[^>]*>[\s\S]*?<\/details>/g, raw => {
    const element = htmlTree(raw).querySelector('details.lg-event-source');
    const id = element.getAttribute('data-event-source');
    blocks.push({ id, element });
    return `<details class="lg-event-source" data-event-source="${escape(id)}">[사건 자료]</details>`;
  });
  return { html: normalized, blocks };
}
test('사건 자료 정규화: 다른 details·다른 클래스·블록 밖 바이트 보존', () => {
  const block = '<details class="lg-event-source" data-event-source="event-a"><summary>자료</summary><p>변경 가능</p></details>';
  const before = '<details><summary>다른 접힘</summary>그대로</details>\n';
  const after = '\n<details class="lg-event-source-extra">다른 클래스</details> 끝';
  const normalized = normalizeEventSources(before + block + after);
  assert.equal(normalized.html, before + '<details class="lg-event-source" data-event-source="event-a">[사건 자료]</details>' + after);
  assert.deepEqual(normalized.blocks.map(b => b.id), ['event-a']);
});
// Q8 갱신 2: 크기 줄 뒤 같은 줄에 승인된 small 요소만 붙는다(새 개행 없음).
// 그 요소만 제거하고 나머지 HTML의 공백·개행까지 바이트 계약을 유지한다.
// D-90 월말 보수 사용을 반영한 총괄 최종 문구(D90-screen-report 「총괄 후속」).
const grantNotice = '<small class="lg-evnote">특별교부세 10억: 새 설비·선로·재난 대응에 쓰고, 남으면 이달 말 보수비에 먼저 쓰여요. 그래도 남으면 사라져요.</small>';
test('1 §1·5 교부세 달: 안내·D-90 폭염 도움말 외 서랍 HTML = 9c14549', () => {
  for (const a of [h, old]) fixture(a, { event: 'response' });
  const current = normalizeEventSources(eventDrawerHTML(h)), baseline = normalizeEventSources(eventDrawerHTML(old));
  assert.ok(baseline.blocks.length >= 1, '기준 서랍에 사건 자료 블록 한 개 이상');
  assert.equal(current.blocks.length, baseline.blocks.length, '사건 자료 블록 개수 동일');
  assert.ok(current.blocks.every(b => b.id), '현재 사건 자료 블록의 사건 id 누락 없음');
  assert.deepEqual(current.blocks.map(b => b.id), baseline.blocks.map(b => b.id), '사건 id 순서 동일');
  assert.equal(h.L.snap.events[0].id, 'heatwave_peak', '독립 fixture: 10억 폭염 교부세');
  assert.equal(current.html.split(grantNotice).length - 1, 1, '확정 교부세 안내 정확히 한 줄');
  assert.ok(!baseline.html.includes(grantNotice), '변경 전에는 안내 없음');
  // D90-screen-report의 승인 연결: 기존 사건 본문·why 보존 + 폭염 추가 감산·한계 설명.
  // 렌더 출력에서 기대 HTML을 복사하지 않는다. 고정 승인 문구와 기존 입력 자료로 만든다.
  const E = h.R.events.find(e => e.id === 'heatwave_peak');
  // rev14 m4: 허용된 변경은 H1 카드 앞면 한 문구뿐이다.
  const H1 = '오후 냉방 수요가 늘고 LNG·일반 태양광 출력이 조금 줄며 공공시설 보수비가 한 번 들어요. 재난이라 특별교부세가 나와요.';
  assert.equal(E.text, H1, 'rev14 H1 글자 그대로');
  const beforeHeat = old.R.events.find(e => e.id === 'heatwave_peak');
  const heat = '폭염 달엔 바깥 공기와 패널이 더워져 LNG와 일반 태양광 출력이 조금 줄어요(연구 근거). 얼마나 더 더운지는 게임 가정이에요.';
  const limitation = '석탄·SMR·디젤과 탠덤 태양광은 넣을 근거 값을 못 찾아 이 게임에선 폭염 때 출력을 줄이지 않아요.';
  const tip = `<div class="lg-info-line"><p>${escape(E.text)}</p><details class="lg-info" data-fold="event-disaster-heatwave_peak"><summary class="lg-info-btn" data-info-key="event-disaster-heatwave_peak" aria-label="설명 보기: ${escape(E.name)}">!</summary><div class="lg-info-pop" role="note">${escape([E.why, heat, limitation].join(' '))}</div></details></div>`;
  assert.equal(current.html.split(tip).length - 1, 1, '승인된 폭염 설명·접근성 속성·접힘 키를 가진 블록 정확히 하나');
  assert.ok(!baseline.html.includes('event-disaster-heatwave_peak'), '변경 전 폭염 도움말 없음');
  // 명세 rev8 B4: 서랍 제목 '이웃·거래' → '사건·거래'. 제목 한 곳만 기준판 이름으로 되돌려 나머지 바이트를 비교한다.
  const normalized = current.html.replace(tip, `<span>${escape(beforeHeat.text)}</span>`).replace(grantNotice, '').replace('<strong>사건·거래</strong>', '<strong>이웃·거래</strong>');
  assert.deepEqual(Buffer.from(normalized, 'utf8'), Buffer.from(baseline.html, 'utf8'),
    '사건 자료·교부세 안내·승인 폭염 도움말·rev14 H1 교체 외 전체 UTF-8 바이트 동일');
});
test('1 §1·5 교부세 0 달: 서랍 HTML 바이트 동일성 유지', () => {
  // Q8 예외는 교부세 달에 한정된다. 0 달까지 안내 정규화로 숨기면 회귀를 놓친다.
  for (const a of [h, old]) {
    fixture(a, { event: 'response' });
    a.L.snap.events = [{ id: 'evening_peak_tropical_night', round: a.L.snap.round }];
  }
  const current = normalizeEventSources(eventDrawerHTML(h)), baseline = normalizeEventSources(eventDrawerHTML(old));
  // 명세 rev8 B4: 서랍 제목 이름만 기준판으로 되돌린다(그 밖의 바이트는 정규화하지 않음).
  current.html = current.html.replace('<strong>사건·거래</strong>', '<strong>이웃·거래</strong>');
  assert.equal(h.C.grantAmount(h.L.snap, h.R, h.L.team), 0, '열대야는 교부 대상 아님');
  assert.equal(current.blocks.length, 1, '사건 없는 서랍과 비교하지 않음');
  assert.ok(!current.html.includes('특별교부세'), '교부세 0 달 안내 없음');
  const bytes = Buffer.from(current.html, 'utf8'), previous = Buffer.from(baseline.html, 'utf8');
  let at = 0;
  while (at < bytes.length && at < previous.length && bytes[at] === previous[at]) at++;
  assert.deepEqual(Buffer.from(current.html, 'utf8'), Buffer.from(baseline.html, 'utf8'),
    `교부세 0 달은 사건 자료 외 어떤 바이트도 정규화하지 않음; 첫 차이 ${at}바이트, 현재 ${JSON.stringify(bytes.subarray(at, at + 60).toString())}, 과거 ${JSON.stringify(previous.subarray(at, at + 60).toString())}`);
});
test('사건 자료 현재 서랍: summary·출처·관측 시점·발표 표시 누락 없음', () => {
  fixture(h, { event: 'response' });
  // 공개된 시점 함수가 없으므로 실제 사건 입력을 쓴다. 전체 사건을 넣어 null·구간·발표도 확인한다.
  h.L.snap.events = h.R.events.map(E => ({ id: E.id, round: h.L.snap.round }));
  const blocks = htmlTree(eventDrawerHTML(h)).querySelectorAll('details.lg-event-source');
  assert.equal(blocks.length, h.R.events.length, '입력 사건마다 자료 블록 하나');
  assert.ok(blocks.length >= 1, '검사할 사건 자료 존재');
  for (const block of blocks) {
    const id = block.getAttribute('data-event-source'), E = h.C.eventDef(h.R, id);
    assert.ok(E, `${id}: 사건 정의 존재`);
    assert.equal(block.querySelector('summary')?.textContent, '사건 자료·출처', `${id}: summary`);
    const line = block.querySelectorAll('p').find(p => p.textContent.startsWith('출처:'))?.textContent;
    assert.ok(line, `${id}: 출처 줄 존재`);
    const fields = line.split(' · ');
    assert.match(fields[0], /^출처:\s*\S+/, `${id}: 빈 출처 없음`);
    assert.doesNotMatch(block.textContent, /undefined|NaN/, `${id}: 잘못된 출처·시점 없음`);
    // ISO 구간은 시작~끝, 여러 시점은 쉼표로 표시한다(사건 자료 계약).
    const dates = list => Array.from(list, date => date.replace('/', '~')).join(', ');
    const observed = E.asOf === null ? '없음' : E.asOf === undefined ? '미기재' : dates(E.asOf);
    assert.ok(observed.trim(), `${id}: 빈 관측 시점 없음`);
    assert.equal(fields.find(f => f.startsWith('자료 시점 ')), `자료 시점 ${observed}`, `${id}: 관측 시점`);
    if (E.published !== undefined) {
      const published = dates(E.published);
      assert.ok(published.trim(), `${id}: 빈 발표 시점 없음`);
      assert.equal(fields.find(f => f.startsWith('발표 ')), `발표 ${published}`, `${id}: 발표 시점`);
    } else assert.ok(!fields.some(f => f.startsWith('발표 ')), `${id}: 발표 없는 자료`);
  }
});

const cases = [
  ['첫 달/지난달 값·S7 없음', { first: true }],
  ['지난달 값 없음/S7 있음', { oldNote: { missedBasis: 'monthly', outageLargest: { key: 'choice' } } }],
  ['규칙1 neighbor/규칙2 grid/규칙3 wind (선발 순위와 반대)', { wind: 'wind', previous: standard, values: { neighbor: 30 }, oldNote: { missedBasis: 'monthly', outageLargest: { key: 'progress' } } }],
  ['규칙1 음수', { previous: standard, values: { evening: 32.3 } }],
  ['규칙1 양수 두 자리 반올림', { previous: standard, values: { evening: 167.712 } }],
  ['이웃 음수 %p', { previous: standard, values: { neighbor: 1.23 }, oldNote: { missedCarry: { basis: 'monthly', largest: { key: 'growth' } } } }],
  ['규칙1 중복 wind', { wind: 'wind', previous: standard, values: { wind: 20 } }],
  ['지난달 0에서 새 변화', { previous: { ...standard, grid: 0 } }],
  ['전부 같은 값/동률', { previous: standard }],
  ['다른 이웃끼리 비교 제외', { previous: standard, values: { neighbor: 99 }, oldNeighbor: 'asan' }],
  ['다른 이웃 비교 문구/규칙2로 이웃 카드 포함', { previous: standard, oldNeighbor: 'asan', oldNote: { outageLargest: { key: 'trade' } } }],
  ['규칙4 예보 둘 다 없음', { values: { wind: null, fuel: null } }],
  ['규칙5 규칙1 뒤 변화 0 하나만 보충', { previous: standard, values: { wind: null, fuel: null, grid: 100 } }],
  ['규칙4 숫자 정확히 둘', { values: { wind: null, fuel: null, neighbor: null } }],
  ['규칙4 숫자 넷에서 셋까지 채움', { values: { fuel: null } }],
  ['숫자 하나만', { values: { evening: null, wind: null, fuel: null, neighbor: null } }],
  ['숫자 없음', { values: Object.fromEntries(order.map(k => [k, null])) }],
  ['풍속 없음/LNG 국제 지수', { cash: -1, values: { wind: null } }],
  ['LNG 없음/풍속 계절 대표값', { wind: 'wind', values: { fuel: null } }],
  ['숫자처럼 보이는 문자열 제외', { values: { wind: '5', fuel: '100' } }],
  ['숫자 아닌 지난달 값 제외', { previous: { evening: '100', grid: null, fuel: null, wind: null, neighbor: null } }],
];
// 새 계약 합성 입력. 기대 키·꼬리표는 위 오라클과 별도로 명시한다.
function contractCase(label, opt, keys, tags = {}) {
  for (const role of ['team', 'solo']) test(`S1 ${label}/${role}`, () => {
    const f = fixture(h, { ...opt, role }), v = assertCandidates(h, f);
    const returned = copy(h.U.__evidenceCandidates(h.L.snap));
    assert.deepEqual(v.keys, keys, '계약에서 직접 정한 후보');
    assert.ok(v.cards.every(c => c.getAttribute('aria-pressed') === 'false'), '미리 고른 카드 없음');
    for (const [key, tag] of Object.entries(tags)) {
      assert.equal(returned.find(x => x.key === key)?.tag, tag, `${key} 반환 꼬리표`);
      const card = v.cards.find(c => cardKey(c) === key);
      assert.ok(card, `${key} 화면 카드 존재`);
      assert.equal(card.querySelector('.lg-s1-tag')?.textContent || '', tag, `${key} 화면 꼬리표`);
    }
  });
}
for (const previous of [undefined, { ...standard, wind: 0 }, standard])
  contractCase('계약 1·3·5 풍력 없으면 0 출발·거대 변화도 풍속 제외',
    { previous, values: { evening: 110, wind: 1e9, grid: 22, neighbor: 11 } }, previous ? ['evening', 'grid', 'neighbor'] : ['evening', 'grid']);
for (const wind of ['wind', 'offshore'])
  contractCase(`계약 3 ${wind} 하나면 계절 대표값`, { wind, previous: standard,
    values: { evening: 300 }, oldNote: { outageLargest: { key: 'choice' } } },
  ['evening', 'wind'], { wind: '계절 대표값' }); // 명세 A2: choice로 grid를 추가하지 않는다.
for (const target of ['uns', 'grid']) for (const field of ['outageFrozen', 'missedCarry'])
  for (const above of [false, true]) for (const cash of [0, -1]) {
    const threshold = target === 'grid' ? 5 : .05;
    const record = { target, trial: 1000, parts: [{ key: 'growth', value: -(above ? threshold : threshold * .999) }] };
    const include = (field === 'outageFrozen' && above) || cash < 0;
    contractCase(`계약 4 ${target}/${field}/growth ${above ? '경계 이상' : '미만'}/현금 ${cash}`,
      { previous: standard, values: { evening: 300, grid: 22, neighbor: 11 }, cash, oldNote: { [field]: record } },
      include ? ['evening', 'grid', 'fuel'] : ['evening', 'grid', 'neighbor'],
      include ? { fuel: '국제 지수' } : {});
  }
for (const [label, oldNote, keys] of [
  ['고정본 미만·붙인 기록 이상', { outageFrozen: { parts: [{ key: 'growth', value: .049 }] },
    missedCarry: { parts: [{ key: 'growth', value: .05 }] } }, ['evening', 'grid', 'neighbor']],
  ['고정본 이상·붙인 기록 미만', { outageFrozen: { parts: [{ key: 'growth', value: .05 }] },
    missedCarry: { parts: [{ key: 'growth', value: .049 }] } }, ['evening', 'grid', 'fuel']],
  ['붙인 기록 largest growth만 있음', { missedCarry: { largest: { key: 'growth', value: -.05 } } }, ['evening', 'grid', 'fuel']],
]) contractCase(`계약 4 ${label}`, { previous: standard, values: { evening: 300, grid: 22, neighbor: 11 }, oldNote }, keys);
contractCase('계약 1 LNG 조건 미충족이어도 최대 변화면 포함',
  { previous: standard, values: { evening: 110, grid: 22, fuel: 400 } }, ['evening', 'grid', 'fuel'], { fuel: '지난달보다 +300%' });
contractCase('계약 2 LNG 조건 미충족이어도 S7 growth 연결이면 포함',
  { oldNote: { outageLargest: { key: 'growth', value: .001 } } }, ['evening', 'fuel'],
  { fuel: '지난달 가장 큰 몫(도시 성장·연료 값)과 이어짐' });
contractCase('계약 5 남은 자리 변화율 순서가 고정 순서와 다름',
  { wind: 'wind', previous: standard, values: { evening: 200, grid: 60, neighbor: 50 } },
  ['wind', 'grid', 'neighbor'], { wind: '계절 대표값', grid: '지난달보다 +200%', neighbor: '지난달보다 +40%p' });
contractCase('계약 5 지난달 값 있는 grid가 앞선 목록의 evening보다 먼저',
  { wind: 'wind', previous: { grid: 20, neighbor: 10 }, values: { grid: 30, neighbor: 30 } },
  ['wind', 'grid', 'neighbor'], { grid: '지난달보다 +50%' });
contractCase('계약 5 지난달 값 없는 근거는 고정 순서로 뒤에·빈 꼬리표',
  { previous: { neighbor: 10 }, values: { neighbor: 30 } }, ['evening', 'neighbor'],
  { evening: '', neighbor: '지난달보다 +20%p' });
contractCase('계약 6 풍속·LNG 값이 있어도 제외 뒤 두 후보 유지',
  { previous: standard, values: { neighbor: null } }, ['evening', 'grid'],
  { evening: '지난달과 같음', grid: '지난달과 같음' });
// V7 5차: 기대 키와 꼬리표를 오라클과 별도로 고정한다. 5단계에만 새 규칙을 적용한다.
contractCase('V7 G a 변화 0·연결 없음인 세 번째 후보 제외',
  { previous: standard, values: { evening: 200, grid: 30 } }, ['evening', 'grid'],
  { evening: '지난달보다 +100%', grid: '지난달보다 +50%' });
contractCase('V7 G a 3단계 풍속을 남기고 변화 0 후보 제외',
  { wind: 'wind', previous: standard, values: { evening: 300 } }, ['evening', 'wind'],
  { evening: '지난달보다 +200%', wind: '계절 대표값' });
contractCase('V7 G b 하나만 남으면 건너뛴 순서로 한 장 보충',
  { previous: standard, values: { neighbor: 30 } }, ['evening', 'neighbor'],
  { evening: '지난달과 같음', neighbor: '지난달보다 +20%p' });
// 명세 A2: choice 최대여도 grid는 5단계 최소 후보 보충으로만 들어온다.
contractCase('A2 choice 최대·변화 0 grid는 최소 후보 보충',
  { previous: standard, values: { evening: 300 }, oldNote: { outageLargest: { key: 'choice' } } },
  ['evening', 'grid'], { grid: '지난달과 같음' });
contractCase('V7 G d 모든 변화율 0인 1단계 선발 보존',
  { wind: 'wind', cash: -1, previous: standard }, ['evening', 'wind', 'fuel'],
  { evening: '지난달과 같음', wind: '계절 대표값', fuel: '국제 지수' });
const zeros = Object.fromEntries(order.map(k => [k, 0]));
contractCase('V7 G d 지난달·이번 달 모두 0인 1단계 선발 보존',
  { wind: 'wind', cash: -1, previous: zeros, values: zeros }, ['evening', 'wind', 'fuel'],
  { evening: '지난달과 같음', wind: '계절 대표값', fuel: '국제 지수' });
contractCase('V7 G e 지난달 값 없는 근거는 변화율 뒤에 유지',
  { previous: { evening: 100, neighbor: 10 }, values: { neighbor: 30 } }, ['evening', 'neighbor'],
  { evening: '지난달과 같음', neighbor: '지난달보다 +20%p' });
contractCase('V7 G 반올림하면 0인 변화도 제외',
  { previous: standard, values: { evening: 200, grid: 30, neighbor: 10.000001 } },
  ['evening', 'grid'], { evening: '지난달보다 +100%', grid: '지난달보다 +50%' });
// V7 6차: 기대 키·표시값·꼬리표를 명시한다. 0.5 / 10000 * 100은 JS의 0.005이며,
// (0.005).toFixed(2)는 "0.01"이다. 100.005 - 100처럼 뺄셈 오차로 경계 아래가 되는 입력을 피한다.
const visibleBoundaries = [
  ['변화율 +0.004%', 'grid', 10000, 10000.4, 0, '지난달과 같음'],
  ['변화율 −0.004%', 'grid', 10000, 9999.6, 0, '지난달과 같음'],
  ['변화율 +0.005%', 'grid', 10000, 10000.5, .01, '지난달보다 +0.01%'],
  ['변화율 +0.01%', 'grid', 10000, 10001, .01, '지난달보다 +0.01%'],
  ['변화율 +0.1%', 'grid', 10000, 10010, .1, '지난달보다 +0.1%'],
  ['이웃 Δ +0.004%p', 'neighbor', 10, 10.004, 0, '지난달과 같음'],
  ['이웃 Δ +0.01%p', 'neighbor', 10, 10.01, .01, '지난달보다 +0.01%p'],
  ['지난달 0 → 이번 0.004', 'grid', 0, .004, 0, '지난달과 같음'],
  ['지난달 0 → 이번 0.01', 'grid', 0, .01, .01, '지난달 0에서 바뀜'],
];
for (const [label, key, before, value, shown, tag] of visibleBoundaries) {
  // 0 출발은 변화율 크기가 Infinity로 동률이다. evening을 앞세워 경계 후보를 5단계에서 검사한다.
  const previous = { ...standard, ...(before === 0 ? { evening: 0 } : {}), [key]: before };
  const values = { evening: 300, grid: 60, neighbor: 30, [key]: value };
  for (const role of ['team', 'solo']) {
    test(`S1 V7 보이는 변화 경계 ${label}/남은 자리/${role}`, () => {
      assert.equal(displayedChange(key, value, before), shown, '입력의 JS toFixed(2) 표시값');
      const f = fixture(h, { role, previous, values }), v = assertCandidates(h, f);
      const keys = ['evening', 'grid', 'neighbor'].filter(k => shown !== 0 || k !== key);
      assert.deepEqual(v.keys, keys, '표시 0은 제외, 표시가 남으면 세 번째 후보 유지');
      const item = copy(h.U.__evidenceCandidates(h.L.snap)).find(x => x.key === key);
      if (shown === 0) {
        assert.equal(item, undefined, '반환 후보에서도 표시 0 제외');
        assert.equal(v.cards.find(c => cardKey(c) === key), undefined, '화면 카드에서도 표시 0 제외');
      } else {
        assert.equal(item?.tag, tag, '표시가 남은 반환 꼬리표');
        assert.equal(v.cards.find(c => cardKey(c) === key).querySelector('.lg-s1-tag')?.textContent,
          tag, '표시가 남은 화면 꼬리표');
      }
    });
    if (shown !== 0) continue;
    test(`S1 V7 보이는 변화 경계 ${label}/기존 선택의 같음 꼬리표/${role}`, () => {
      const f = fixture(h, { role, previous, values, note: { s1Pick: key } }), v = assertCandidates(h, f);
      assert.deepEqual(v.keys, ['evening', 'grid', 'neighbor'], '표시 0이어도 기존 선택 보존');
      assert.deepEqual(selected(v), [key]);
      assert.equal(note(h).s1Pick, key);
      assert.equal(copy(h.U.__evidenceCandidates(h.L.snap)).find(x => x.key === key)?.tag, tag,
        '반환 꼬리표는 지난달과 같음');
      assert.equal(v.cards.find(c => cardKey(c) === key).querySelector('.lg-s1-tag')?.textContent,
        tag, '화면 꼬리표도 지난달과 같음');
    });
    test(`S1 V7 보이는 변화 경계 ${label}/최소 두 장 보충/${role}`, () => {
      const other = key === 'grid' ? 'neighbor' : 'grid';
      const f = fixture(h, { role, previous, values: { ...values, [other]: null } }), v = assertCandidates(h, f);
      assert.deepEqual(v.keys, ['evening', key], '표시 0을 건너뛴 뒤 한 장이면 두 장까지 보충');
      assert.equal(copy(h.U.__evidenceCandidates(h.L.snap)).find(x => x.key === key)?.tag, tag,
        '보충된 반환 꼬리표는 지난달과 같음');
      assert.equal(v.cards.find(c => cardKey(c) === key).querySelector('.lg-s1-tag')?.textContent,
        tag, '보충된 화면 꼬리표도 지난달과 같음');
    });
  }
}
contractCase('V7 G 보충할 후보도 없으면 한 장 유지',
  { previous: standard, values: { evening: 200, grid: null, neighbor: null } }, ['evening'],
  { evening: '지난달보다 +100%' });
for (const role of ['team', 'solo']) for (const pick of ['grid', 'neighbor', 'fuel'])
  test(`S1 V7 G 변화 0·연결 없음이어도 기존 s1Pick 보존/${role}/${pick}`, () => {
    const f = fixture(h, { role, wind: 'wind', previous: standard, values: { evening: 300 }, note: { s1Pick: pick } });
    const v = assertCandidates(h, f);
    assert.deepEqual(v.keys, order.filter(k => ['evening', 'wind', pick].includes(k)), '기존 선택을 포함한 세 후보');
    assert.deepEqual(selected(v), [pick]);
    assert.equal(note(h).s1Pick, pick);
    assert.equal(copy(h.U.__evidenceCandidates(h.L.snap)).find(x => x.key === pick)?.tag, '지난달과 같음');
    assert.equal(v.promise.textContent.trim(), expectedPromise(promiseNames[pick]));
    assert.ok(!v.promise.hasAttribute('disabled'));
  });
// V7 B: LNG 4·5단계는 growth의 카드 선발 여부로 판단한다. 1·2단계 예외는 위에서 보존한다.
for (const [label, record, included] of [
  ['6% 후보', { total: 100, parts: [{ key: 'choice', value: 94 }, { key: 'growth', value: 6 }] }, true],
  ['4% 제외', { total: 100, parts: [{ key: 'choice', value: 96 }, { key: 'growth', value: 4 }] }, false],
  ['5% 경계', { total: 100, parts: [{ key: 'choice', value: 95 }, { key: 'growth', value: 5 }] }, true],
  ['5% 이상이나 네 번째', { total: 100, parts: [{ key: 'choice', value: 40 }, { key: 'weather', value: 30 }, { key: 'event', value: 24 }, { key: 'growth', value: 6 }] }, false],
  ['total 없이 실제−기준 4%', { actual: 110, trial: 10, parts: [{ key: 'choice', value: 96 }, { key: 'growth', value: 4 }] }, false],
]) for (const target of ['uns', 'grid']) contractCase(`V7 B ${target}/${label}`,
  { previous: standard, values: { evening: 300, grid: 22, neighbor: 11 }, oldNote: { outageFrozen: { target, trial: 10, ...record } } },
  included ? ['evening', 'grid', 'fuel'] : ['evening', 'grid', 'neighbor']);
for (const [label, carry, included] of [
  ['largest growth 최소 몫 이상', { largest: { key: 'growth', value: -.05 } }, true],
  ['largest growth 최소 몫 미만', { largest: { key: 'growth', value: .049 } }, false],
  ['largest는 다른 몫', { largest: { key: 'event', value: 10 }, parts: [{ key: 'growth', value: 6 }] }, false],
  ['parts만 있는 축약 기록', { parts: [{ key: 'growth', value: 6 }] }, false],
]) contractCase(`V7 B 축약/${label}`, { previous: standard, values: { evening: 300, grid: 22, neighbor: 11 }, oldNote: { outageLargest: { key: 'event', value: 10 }, missedCarry: carry } },
  included ? ['evening', 'grid', 'fuel'] : ['evening', 'grid', 'neighbor']);

// V7 E: 첫 달 시험 기록의 재현 차이는 원인 카드가 아니다.
// A2에서도 연결이 있는 weather·trade로, 모든 몫이 5% 미만이면 저장된 largest를 잇지 않음을 지킨다.
// 원인 없음 제외를 제거하면 4.99%의 후보 구성 또는 연결 꼬리표가 실패해야 한다. 정확히 5%는 연결한다.
for (const [cause, evidenceKey, values, withoutWind, withConnection, withoutConnection, plainTag] of [
  ['weather', 'evening', { grid: 60 }, ['evening', 'grid'],
    ['evening', 'wind', 'grid'], ['wind', 'grid', 'fuel'], '지난달과 같음'],
  ['trade', 'neighbor', { evening: 300, neighbor: 11 }, ['evening', 'neighbor'],
    ['evening', 'wind', 'neighbor'], ['evening', 'wind', 'fuel'], '지난달보다 +1%p'],
]) for (const target of ['uns', 'grid']) for (const sign of [1, -1])
  for (const field of ['outageLargest', 'missedCarry']) for (const value of [4.99, 5])
    for (const role of ['team', 'solo'])
      test(`V7 E ${cause} ${value < 5 ? '원인 없음 연결 제외' : '5% 경계 연결'} trial/${target}/${sign}/${field}/${role}`, () => {
        const largest = { key: cause, value: sign * value }, connects = value === 5;
        const trial = sign > 0 ? 0 : 100;
        const frozen = { basis: 'trial', target, round: 1, ...(target === 'grid' ? { unit: 'MWh/일' } : {}),
          trial, actual: trial + sign * 100, total: sign * 100, replay: sign * (100 - value),
          parts: ['choice', 'weather', 'event', 'trade'].map(key => ({ key, value: key === cause ? largest.value : 0 })) };
        const oldNote = { missedBasis: 'trial', outageFrozen: frozen,
          ...(field === 'outageLargest' ? { outageLargest: largest } : { missedCarry: { basis: 'trial', largest } }) };
        assert.equal(frozen.replay + frozen.parts.reduce((sum, p) => sum + p.value, 0), frozen.total,
          '재현 차이 + 네 몫 = Δ');
        assert.ok(Math.abs(frozen.replay) > Math.abs(frozen.total) / 2, '재현 차이가 Δ 대부분인 첫 달 기록');
        for (const wind of [false, 'wind']) {
          const f = fixture(h, { role, oldNote, wind, cash: wind ? -1 : 0, previous: standard, values });
          const v = assertCandidates(h, f), returned = copy(h.U.__evidenceCandidates(h.L.snap));
          assert.deepEqual(v.keys, wind ? connects ? withConnection : withoutConnection : withoutWind,
            '계약에서 직접 정한 2단계 포함·제외 후보');
          assert.equal(v.focus.textContent.includes('지난달 가장 큰 몫('), connects, '화면의 연결 꼬리표 포함·제외');
          assert.equal(returned.some(x => x.tag.includes('지난달 가장 큰 몫(')), connects, '반환 꼬리표도 같은 판정');
          if (connects || !wind) {
            const tag = connects ? `지난달 가장 큰 몫(${s7[cause]})과 이어짐` : plainTag;
            assert.equal(returned.find(x => x.key === evidenceKey)?.tag, tag, `${evidenceKey} 반환 꼬리표`);
            assert.equal(v.cards.find(c => cardKey(c) === evidenceKey)?.querySelector('.lg-s1-tag')?.textContent, tag,
              `${evidenceKey} 화면 꼬리표`);
          }
        }
      });

// A2: choice 연결 제외는 원인 없음 경계와 별도로 유지한다.
// 명세 A2: choice 최대는 5% 미만·경계 모두 2단계를 건너뛴다.
for (const target of ['uns', 'grid']) for (const sign of [1, -1])
  for (const field of ['outageLargest', 'missedCarry']) for (const value of [4.99, 5])
    for (const role of ['team', 'solo'])
      test(`A2 choice 연결 제외 ${value}% trial/${target}/${sign}/${field}/${role}`, () => {
        // 명세 A2: 5% 경계여도 choice의 S1 연결은 없다.
        const largest = { key: 'choice', value: sign * value };
        const trial = sign > 0 ? 0 : 100;
        const frozen = { basis: 'trial', target, round: 1, ...(target === 'grid' ? { unit: 'MWh/일' } : {}),
          trial, actual: trial + sign * 100, total: sign * 100, replay: sign * (100 - value),
          parts: ['choice', 'weather', 'event', 'trade'].map(key => ({ key, value: key === 'choice' ? largest.value : 0 })) };
        const oldNote = { missedBasis: 'trial', outageFrozen: frozen,
          ...(field === 'outageLargest' ? { outageLargest: largest } : { missedCarry: { basis: 'trial', largest } }) };
        assert.equal(frozen.replay + frozen.parts.reduce((sum, p) => sum + p.value, 0), frozen.total,
          '재현 차이 + 네 몫 = Δ');
        assert.ok(Math.abs(frozen.replay) > Math.abs(frozen.total) / 2, '재현 차이가 Δ 대부분인 첫 달 기록');
        // 후보 구성이 달라지는 입력과, grid가 남아 꼬리표만 달라지는 입력을 함께 확인한다.
        for (const wind of [false, 'wind']) {
          const f = fixture(h, { role, oldNote, wind, cash: wind ? -1 : 0,
            previous: standard, values: { evening: 300 } });
          const v = assertCandidates(h, f), returned = copy(h.U.__evidenceCandidates(h.L.snap));
          assert.deepEqual(v.keys, wind ? ['evening', 'wind', 'fuel'] :
            ['evening', 'grid'], '계약에서 직접 정한 2단계 포함·제외 후보(연결 없으면 grid만 보충)');
          assert.equal(v.focus.textContent.includes('지난달 가장 큰 몫('), false, '화면의 연결 꼬리표 포함·제외');
          assert.equal(returned.some(x => x.tag.includes('지난달 가장 큰 몫(')), false, '반환 꼬리표도 같은 판정');
          if (!wind) {
            const tag = '지난달과 같음'; // 명세 A2: choice 연결 꼬리표 없음.
            assert.equal(returned.find(x => x.key === 'grid')?.tag, tag, 'grid 반환 꼬리표');
            assert.equal(v.cards.find(c => cardKey(c) === 'grid')?.querySelector('.lg-s1-tag')?.textContent, tag,
              'grid 화면 꼬리표');
          }
        }
      });

// V7 4차 minor 6: 불완전한 옛 고정본은 growth 후보가 아니다. 상단 막대의 실제 소비 경로도 확인한다.
for (const target of ['uns', 'grid']) for (const role of ['team', 'solo'])
  for (const cash of [0, -1]) for (const carryGrowth of [false, true])
    test(`V7 F parts 없는 고정본/${target}/${role}/현금 ${cash}/축약 growth ${carryGrowth}`, () => {
      const frozen = { basis: 'trial', target, trial: 0, actual: 100, total: 100,
        ...(target === 'grid' ? { unit: 'MWh/일' } : {}) };
      assert.ok(!Object.hasOwn(frozen, 'parts'), 'parts 자체가 없는 옛 기록');
      const f = fixture(h, { role, cash, previous: standard, values: { evening: 300, grid: 22, neighbor: 11 }, oldNote: {
        outageFrozen: frozen, outageLargest: { key: 'event', value: 100 },
        ...(carryGrowth ? { missedCarry: { largest: { key: 'growth', value: 100 } } } : {}) } });
      const watch = new Element('span', { id: 'lg-watch' }); h.nodes.set('lg-watch', watch);
      assert.doesNotThrow(() => api(h, 'renderBar')(), 'parts 없는 고정본도 상단 막대 렌더링에서 예외 없음');
      assert.ok(htmlTree(watch.innerHTML).textContent.includes('근거 고르기'), '상단 막대의 근거 배지까지 렌더링');
      const v = assertCandidates(h, f);
      assert.deepEqual(v.keys, cash < 0 ? ['evening', 'grid', 'fuel'] : ['evening', 'grid', 'neighbor'],
        'growth는 거짓이며 음수 현금 조건만 LNG를 포함');
      if (cash < 0) assert.equal(copy(h.U.__evidenceCandidates(h.L.snap)).find(x => x.key === 'fuel')?.tag,
        '국제 지수', '현금 조건에 따른 LNG 꼬리표');
    });

for (const role of ['team', 'solo']) for (const wind of [false, 'wind', 'offshore'])
  for (const pick of wind ? ['wind', 'grid'] : ['grid'])
  test(`V7 C ${role}/${wind}/${pick} 시작 메모 저장·풍력 추가·철거 후 후보와 선택 유지`, () => {
    fixture(h, { role, wind, previous: standard, values: { evening: 200, grid: 30, neighbor: 11 } });
    // 최초 저장 경로를 실행하기 위해 기기의 현재 달 메모만 비운다.
    const write = data => role === 'solo' ? h.L.interview = data :
      h.storage.set(`kcp-league-data-v1:${h.L.room}:${h.L.team}`, JSON.stringify(data));
    const data = role === 'solo' ? copy(h.L.interview) : JSON.parse(h.storage.get(`kcp-league-data-v1:${h.L.room}:${h.L.team}`));
    data.interview.months[h.L.snap.round] = {}; write(data);
    api(h, 'renderBar')();
    const saved = copy(note(h));
    assert.equal(saved.s1HasWind, !!wind, '달 시작 풍력 boolean 저장');
    assert.equal(typeof saved.s1HasWind, 'boolean');
    assert.ok(saved.s1EvidenceValues && Object.keys(saved.s1EvidenceValues).length, '근거 값과 함께 저장');
    const before = view(h), keys = wind ? ['evening', 'wind', 'grid'] : ['evening', 'grid', 'neighbor'];
    assert.deepEqual(before.keys, keys, '달 시작 후보');
    click(h, before.cards.find(c => cardKey(c) === pick));
    const promise = view(h).promise.textContent;
    h.plan.builds = h.plan.builds.filter(b => !['wind', 'offshore'].includes(b.t));
    if (!wind) h.plan.builds.push({ t: 'wind', i: 0 });
    api(h, 'renderBar')();
    const after = view(h);
    assert.deepEqual(after.keys, keys, '추가·철거 후에도 시작 후보 고정');
    assert.deepEqual(selected(after), [pick], 'aria-pressed 유지');
    assert.equal(note(h).s1Pick, pick);
    assert.equal(after.promise.textContent, promise, '약속 문구 유지');
    assert.ok(!after.promise.hasAttribute('disabled'), '약속 단추 활성 유지');
    assert.deepEqual(copy(note(h).s1EvidenceValues), saved.s1EvidenceValues, '근거 값 불변');
    assert.equal(note(h).s1HasWind, !!wind, '풍력 메모 불변');
    assert.equal(new Set(after.keys).size, after.keys.length); assert.ok(after.keys.length <= 3);
  });
for (const wind of [false, 'wind']) test(`V7 C 옛 기록 풍력 메모 없음/${wind} 현재 계획으로 판정`, () => {
  fixture(h, { wind, previous: standard, values: { evening: 200, grid: 30, neighbor: 11 } });
  assert.ok(!Object.hasOwn(note(h), 's1HasWind'));
  assert.deepEqual(view(h).keys, wind ? ['evening', 'wind', 'grid'] : ['evening', 'grid', 'neighbor']);
  h.plan.builds = h.plan.builds.filter(b => !['wind', 'offshore'].includes(b.t));
  if (!wind) h.plan.builds.push({ t: 'offshore', i: 0 });
  assert.deepEqual(view(h).keys, wind ? ['evening', 'grid', 'neighbor'] : ['evening', 'wind', 'grid']);
});
for (const role of ['team', 'solo']) for (const pick of ['wind', 'fuel'])
  test(`V7 C 옛 s1Pick 보존/${role}/${pick}`, () => {
    const f = fixture(h, { role, note: { s1Pick: pick } }), v = assertCandidates(h, f);
    assert.deepEqual(v.keys, pick === 'wind' ? ['evening', 'wind', 'grid'] : ['evening', 'grid', 'fuel']);
    assert.deepEqual(selected(v), [pick]); assert.equal(note(h).s1Pick, pick);
    assert.equal(v.promise.textContent.trim(), expectedPromise(promiseNames[pick]));
    assert.ok(!v.promise.hasAttribute('disabled'));
  });
test('S1 계약 1~6 독립 기대값 검산·고정 순서', () => {
  const examples = [
    [{ first: true }, [['evening', 5], ['grid', 5]]],
    [{ wind: 'wind', previous: standard, values: { neighbor: 30 }, oldNote: { missedBasis: 'monthly', outageLargest: { key: 'choice' } } }, [['wind', 3], ['neighbor', 1]]], // 명세 A2: grid 연결 없이 이미 후보 두 개.
    [{ values: { wind: null, fuel: null } }, [['evening', 5], ['grid', 5]]],
    [{ previous: standard, values: { wind: null, fuel: null, grid: 100 } }, [['evening', 5], ['grid', 1]]],
    [{ values: { wind: null, fuel: null, neighbor: null } }, [['evening', 5], ['grid', 5]]],
    [{ wind: 'wind', values: { fuel: null } }, [['evening', 5], ['wind', 3]]],
    [{ previous: standard }, [['evening', 1], ['grid', 5]]],
    [{ oldNote: { outageLargest: { key: 'event' } } }, [['evening', 5], ['grid', 5]]],
    [{ wind: 'offshore', cash: -1, previous: standard, values: { grid: 60 }, oldNote: { missedCarry: { largest: { key: 'event' } } } }, [['wind', 3], ['grid', 1], ['fuel', 4]]],
  ];
  for (const [opt, wanted] of examples) assert.deepEqual(expected(fixture(h, opt)).map(x => [x.key, x.rule]), wanted);
});
for (const basis of ['monthly', 'trial']) for (const cause of Object.keys(linked)) for (const field of ['outageLargest', 'missedCarry'])
  cases.push([`규칙2 ${basis}/${field}/${cause}`, { oldNote: field === 'outageLargest' ?
    { missedBasis: basis, outageLargest: { key: cause } } : { missedCarry: { basis, largest: { key: cause } } } }]);
// 명세 A2: event와 choice 모두 2단계 연결 없음.
for (const cause of ['event', 'choice']) for (const field of ['outageLargest', 'missedCarry'])
  cases.push([`지난달 가장 큰 몫 ${cause}/${field}: 규칙2 건너뜀`, {
    previous: standard, values: { grid: 60 }, oldNote: field === 'outageLargest' ?
      { outageLargest: { key: cause } } : { missedCarry: { largest: { key: cause } } },
  }]);
for (const [label, opt] of cases) {
  test(`2·3 §2·3 ${label}`, () => { const f = fixture(h, opt); assertCandidates(h, f); });
  test(`4 §3 ${label} 꼬리표·값·비교`, () => {
    const f = fixture(h, opt), v = assertCandidates(h, f);
    for (const candidate of expected(f)) {
      const card = v.cards.find(c => cardKey(c) === candidate.key), text = card.textContent;
      const tag = copy(h.U.__evidenceCandidates(h.L.snap)).find(x => x.key === candidate.key).tag;
      const before = f.previous.s1EvidenceValues?.[candidate.key];
      const numberText = value => value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
      assert.ok(text.includes(numberText(f.values[candidate.key]) + units[candidate.key]), '이번 달 값·단위');
      if (candidate.key === 'neighbor' && Number.isFinite(before) && f.previous.s1EvidenceNeighborId !== 'dangjin') {
        const oldName = h.C.teamDef(h.R, f.previous.s1EvidenceNeighborId).name;
        assert.ok(text.includes(`지난달은 다른 이웃(${oldName})`), '바뀐 이웃은 지난달 이웃 이름을 표시');
        assert.doesNotMatch(text, /→/, '다른 이웃의 값을 이어 비교하지 않음');
      } else assert.ok(Number.isFinite(before) ? text.includes(numberText(before)) && /→/.test(text) : text.includes('지난달 값 없음'), '지난달 비교 줄');
      if (candidate.rule === 1 || candidate.rule === 5 && Number.isFinite(before) &&
          (candidate.key !== 'neighbor' || f.previous.s1EvidenceNeighborId === 'dangjin')) {
        const delta = f.values[candidate.key] - before;
        if (displayedChange(candidate.key, f.values[candidate.key], before) === 0) {
          assert.equal(tag, '지난달과 같음', '규칙1 표시 변화 0 꼬리표');
          assert.equal(card.querySelector('.lg-s1-tag')?.textContent, tag, '화면에도 같은 꼬리표');
          assert.doesNotMatch(tag, /0%|지난달보다/, '변화 0 꼬리표는 퍼센트 대신 같음(현재 값의 10% 등과 구별)');
        } else if (candidate.key === 'neighbor' || before !== 0) {
          const amount = candidate.key === 'neighbor' ? delta : delta / Math.abs(before) * 100;
          const rounded = Number(amount.toFixed(2)) + 0;
          const number = numberText(Math.abs(rounded));
          assert.ok(text.includes(`지난달보다 ${rounded < 0 ? '−' : rounded > 0 ? '+' : ''}${number}${candidate.key === 'neighbor' ? '%p' : '%'}`), '규칙1 부호·최대 두 자리·단위');
        } else assert.ok(text.includes('지난달') && /0/.test(text) && !/Infinity|NaN|∞/.test(text), '지난달 0은 무한대 퍼센트로 쓰지 않음');
      }
      if (candidate.rule === 2) {
        const basis = f.previous.outageFrozen?.basis || f.previous.missedCarry?.basis || f.previous.missedBasis;
        const name = candidate.cause === 'weather' && basis === 'monthly' ? '날씨·계절·운전 기간' : s7[candidate.cause];
        assert.ok(text.includes(`지난달 가장 큰 몫(${name})과 이어짐`), `규칙2 ${basis} 사실 꼬리표`);
      }
      if (candidate.rule === 3 || candidate.rule === 4) {
        assert.ok(text.includes(candidate.key === 'wind' ? '계절 대표값' : '국제 지수'), '규칙3 사실 꼬리표');
        assert.doesNotMatch(text, /이번 달 예보값/, '풍속은 예보값으로 부르지 않음');
      }
      if (candidate.rule === 5 && (!Number.isFinite(before) || candidate.key === 'neighbor' && f.previous.s1EvidenceNeighborId !== 'dangjin')) assert.doesNotMatch(text,
        /지난달보다|지난달과 같음|지난달 가장 큰 몫\(|계절 대표값|이번 달 예보값|국제 지수/,
        `규칙5 ${candidate.key}: 비교할 지난달 값이 없으면 빈 꼬리표`);
      // 카드 이름·값도 포함해 금지어를 검사하므로 숨은 순위 설명도 잡는다.
      assert.ok(!/1위|추천|가장/.test(text.replace(/지난달 가장 큰 몫\([^)]*\)과 이어짐/g, '')), '순위 표현 없음');
    }
  });
}
test('4 확정: 모든 근거가 지난달과 같으면 같음 꼬리표·0% 문자열 없음', () => {
  const f = fixture(h, { previous: standard }), v = assertCandidates(h, f);
  assert.deepEqual(v.keys, ['evening', 'grid'], '변화 0 동률의 1단계 evening 보존·5단계 grid만 보충');
  assert.ok(v.cards.find(c => cardKey(c) === 'evening').textContent.includes('지난달과 같음'));
  for (const card of v.cards) assert.equal(card.querySelector('.lg-s1-tag')?.textContent,
    '지난달과 같음', '모든 후보의 변화 꼬리표가 같음(현재 정전율과 구별)');
});
test('5 §3 처음 선택 없음·비활성 단추·안내문', () => {
  fixture(h); const v = view(h); assert.ok(v.cards.length >= 2);
  assert.ok(v.cards.every(c => c.getAttribute('aria-pressed') === 'false' && c.getAttribute('type') === 'button'));
  assert.ok(v.promise?.hasAttribute('disabled'));
  assert.equal(v.promise.textContent.trim(), '근거를 하나 고르면 약속으로 이어져요');
  assert.ok(v.focus.textContent.includes("대응을 고를 사건이 없는 달이에요. 이번 달에 눈여겨볼 근거 하나를 골라요. 고른 근거는 약속의 '근거 하나'에 미리 표시돼요. 이 값 하나가 원인이라는 뜻은 아니에요."));
});
test('부록 조사 독립 기대값: 받침 없음·ㄹ은 로, 다른 받침은 으로', () => {
  for (const [name, wanted] of [
    ['저녁 수요', '저녁 수요로 약속하기'], ['풍속', '풍속으로 약속하기'],
    ['접속 여유', '접속 여유로 약속하기'], ['LNG 지수', 'LNG 지수로 약속하기'],
    ['이웃 정전', '이웃 정전으로 약속하기'], ['효율', '효율로 약속하기'],
  ]) assert.equal(expectedPromise(name), wanted);
});
for (const key of order) test(`6 부록 ${key} 약속 단추 조사·짧은 이름`, () => {
  // 각 근거를 규칙 1로 후보에 넣고, 실제 카드 클릭 뒤 전체 문구를 대조한다.
  fixture(h, { wind: 'wind', previous: standard, values: { [key]: standard[key] * 3 } });
  let v = view(h);
  const card = v.cards.find(c => cardKey(c) === key);
  assert.ok(card, `${key} 조사 검사용 후보`);
  click(h, card); v = view(h);
  assert.deepEqual(selected(v), [key]);
  assert.ok(!v.promise.hasAttribute('disabled'));
  assert.equal(v.promise.textContent.trim(), expectedPromise(promiseNames[key]),
    '도시 이름 없이 짧은 근거 이름과 올바른 조사');
});
test('6 §3·4 카드 클릭·변경·저장·세션 재생성 뒤 선택 유지', () => {
  fixture(h); let v = view(h); const first = v.keys[0], second = v.keys[1];
  click(h, v.cards[0]); v = view(h); assert.deepEqual(selected(v), [first]);
  assert.equal(note(h).s1Pick, first); assert.ok(!v.promise.hasAttribute('disabled'));
  assert.equal(v.promise.textContent.trim(), expectedPromise(promiseNames[first]), '선택한 근거의 정확한 약속 문구');
  click(h, v.cards[1]); assert.deepEqual(selected(view(h)), [second]); assert.equal(note(h).s1Pick, second);
  const fresh = makeHarness(source); fixture(fresh);
  fresh.storage.clear(); for (const [k, value] of h.storage) fresh.storage.set(k, value);
  assert.deepEqual(selected(view(fresh)), [second], '저장소로부터 새 VM에서 재개');
});
for (const existing of [false, true]) test(`7 §4 약속 연결/기존 근거 ${existing}`, () => {
  fixture(h, { note: existing ? { evidence: { key: 'evening', value: 100, text: '저녁 수요: 100.00 MW' } } : {} });
  let v = view(h); const key = v.keys.find(k => k !== 'evening');
  click(h, v.cards.find(c => cardKey(c) === key)); v = view(h); click(h, v.promise);
  assert.equal(h.L.panel, 'journal', '일지 서랍 열림');
  assert.equal(note(h).evidence?.key, existing ? 'evening' : key, '비어 있을 때만 미리 선택');
  const root = htmlTree(api(h, 'predictionHTML')(h.L.snap));
  const chips = root.querySelector('#lg-evidence')?.querySelectorAll('button[data-evidence]') || [];
  assert.equal(chips.find(c => c.getAttribute('data-evidence') === (existing ? 'evening' : key))?.getAttribute('aria-pressed'), 'true');
  const evidence = root.querySelector('#lg-evidence'); assert.ok(evidence);
  const tagged = evidence.children.filter(c => c.textContent.includes('S1에서 고름'));
  assert.equal(tagged.length, 1, 'S1 표지는 하나');
  assert.ok(tagged[0].getAttribute('data-evidence') === key || tagged[0].querySelector(`[data-evidence="${key}"]`) ||
    evidence.children[evidence.children.indexOf(tagged[0]) - 1]?.getAttribute('data-evidence') === key, '같은 칩 안 또는 바로 옆 표지');
  for (const chip of chips) {
    const marked = chip.getAttribute('data-evidence') === key;
    const aria = chip.getAttribute('aria-label') || '';
    assert.equal(aria.endsWith(' · S1에서 고름'), marked, 'S1에서 고른 칩의 aria-label에만 표지 접미사');
    assert.equal(aria.includes('S1에서 고름'), marked, '다른 칩의 접근성 이름에는 S1 표지 없음');
  }
});
test('8 §1 규제 조건 줄은 묶음 위/규제는 후보 밖', () => {
  const f = fixture(h, { event: 'regulation' }), v = view(h); assert.ok(v.group);
  const text = v.focus.textContent, at = text.indexOf('이번 달 조건 · ');
  assert.ok(at >= 0 && text.includes(f.E.name));
  assert.ok(at < text.indexOf(v.group.textContent), '조건 줄 다음에 카드 묶음');
  assert.ok(!v.keys.includes(f.E.id));
  assert.match(text.slice(at), new RegExp(`${f.E.name}:\\s*\\S+`), '사건 이름 뒤 짧은 효과');
});
test('8 §1 사건 0개에는 조건 줄 없음', () => { fixture(h); assert.ok(!view(h).html.includes('이번 달 조건 · ')); });
function conditionText(v) {
  assert.ok(v.group, '조건 줄 아래 근거 후보 묶음');
  const text = v.focus.textContent, at = text.indexOf('이번 달 조건 · ');
  const end = text.indexOf(v.group.textContent);
  assert.ok(at >= 0 && end > at, '카드 묶음 위 조건 줄');
  return text.slice(at, end);
}
for (const kind of ['우리 도시 대응 사건', '다른 도시 규제', '다른 도시 대응 사건'])
  test(`8 §1 조건 줄 제외: ${kind}`, () => {
    const f = fixture(h, { event: 'regulation' });
    const response = h.R.events.find(e => e.opts?.length && h.C.hits(h.R, e, h.L.team));
    const other = h.R.events.find(e => !h.C.hits(h.R, e, h.L.team));
    assert.ok(response && other, '대응 선택지와 다른 도시 범위의 사건 자료');
    const target = kind === '우리 도시 대응 사건';
    const decoy = { ...copy(target ? response : other), id: 's1-condition-excluded',
      name: '조건에 섞이면 안 되는 가상 사건', text: '제외할 가상 효과 문구',
      opts: kind === '다른 도시 규제' ? [] : copy(response.opts) };
    assert.equal(h.C.hits(h.R, decoy, h.L.team), target, '합성 사건의 도시 적용 범위');
    h.R.events.push(decoy);
    try {
      h.L.snap.events.push({ id: decoy.id, round: h.L.snap.round });
      const v = view(h);
      if (target) {
        assert.ok(!v.group, '대응을 고를 사건이 있으면 카드 화면 제외');
        assert.ok(!v.html.includes('이번 달 조건 · '), '대응 사건 달에는 카드용 조건 줄 없음');
      } else {
        const text = conditionText(v);
        assert.ok(text.includes(f.E.name), '우리 도시 규제는 조건 줄에 유지');
        assert.ok(!text.includes(decoy.name) && !text.includes(decoy.text), '제외 사건의 이름·효과가 조건 줄에 섞이지 않음');
      }
    } finally { h.R.events.pop(); }
  });
// 9번은 CSS 표시 조건·접힘의 실제 가시성이므로 s1cards.py로 넘긴다.
console.log('PENDING 9 §3: 1280 summary 숨김·details open·세 카드 표시/390 마지막 카드 접힘/후보 2개 접힘 없음은 s1cards.py(브라우저 미실행)');
test('10 §4 카드 달 배지 고르기 전·후', () => {
  fixture(h); const watch = new Element('span', { id: 'lg-watch' }); h.nodes.set('lg-watch', watch);
  api(h, 'renderBar')(); assert.ok(htmlTree(watch.innerHTML).textContent.includes('근거 고르기'));
  const v = view(h); click(h, v.cards[0]); api(h, 'renderBar')();
  const text = htmlTree(watch.innerHTML).textContent;
  assert.ok(text.includes(labels[v.keys[0]]) && !text.includes('근거 고르기'));
});
test('10 §4·5 대응 사건 달 배지 = 9c14549', () => {
  const badge = a => { fixture(a, { event: 'response' }); const watch = new Element('span', { id: 'lg-watch' });
    a.nodes.set('lg-watch', watch); api(a, 'renderBar')(); return watch.innerHTML; };
  // rev10 R4(검토 반영, 총괄 수정): +n 접기로 #lg-watch 안 감싸개·속성이 늘어 바이트 비교는 불가능하다.
  // 계약(배지 단추의 글자·순서·여는 서랍)을 9c14549와 비교한다.
  const buttons = html => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(m => !/lg-watch-more/.test(m[1]))
    .map(m => [m[2].replace(/<[^>]*>/g, '').trim(), (m[1].match(/data-hud-panel="([^"]*)"/) || [])[1] || null]);
  const now = buttons(badge(h)), then = buttons(badge(old));
  assert.ok(then.length > 0, '옛 배지 단추 있음');
  assert.deepEqual(now, then, '배지 단추 글자·순서·서랍 동일');
});
test('11 §3·5 이웃 이름 XSS 이스케이프', () => {
  fixture(h, { previous: standard, values: { neighbor: 30 } });
  const city = h.C.teamDef(h.R, 'dangjin'), before = city.name;
  try {
    city.name = '<img src=x onerror="throw 1">가상 이웃';
    const v = view(h); assert.ok(v.keys.includes('neighbor'), '악성 이름 카드가 실제 후보');
    assert.ok(v.html.includes('&lt;img'), '이웃 이름을 빼지 않고 이스케이프');
    assert.equal(v.root.querySelector('img'), null, 'img 태그 주입 없음');
  } finally { city.name = before; }
});
for (const field of ['name', 'text']) test(`11 §1 조건 줄 ${field === 'name' ? '사건 이름' : '효과 문구'} XSS 이스케이프`, () => {
  const f = fixture(h, { event: 'regulation' }), at = h.R.events.indexOf(f.E);
  // 기존 사건 자료 계약의 name/text에 따로 주입해 한쪽만 이스케이프한 회귀도 잡는다.
  const payload = '<img src=x onerror=1>';
  const event = { ...copy(f.E), name: '가상 규제 이름', text: '가상 규제 효과',
    [field]: `${field === 'name' ? '가상 규제 이름' : '가상 규제 효과'} ${payload}` };
  h.R.events[at] = event;
  try {
    const v = view(h), text = conditionText(v);
    assert.ok(text.includes(event.name) && text.includes(event.text), '이름·효과를 조건 줄에 실제 표시(삭제로 우회 금지)');
    assert.ok(text.includes(payload), '조건 줄의 디코딩된 텍스트에 합성 입력 유지');
    assert.ok(!v.html.includes('<img'), '원문 HTML에 img 태그 없음');
    assert.ok(v.html.includes('&lt;img'), '원문 HTML에서 img 입력 이스케이프');
    assert.equal(v.root.querySelector('img'), null, '파싱 뒤에도 img 요소 없음');
  } finally { h.R.events[at] = f.E; }
});

// V8 N1: 입력한 시작 메모와 변경한 공개 계획 값으로 기대값을 만든다.
for (const role of ['team', 'solo']) test(`V8 N1 S4 시작 3.65 → 지금 7.65/${role}`, () => {
  fixture(h, { role, previous: standard, values: { grid: 3.65 } });
  h.plan.builds.push({ t: 'battery', i: 0 });
  // 공개 계획 갱신 경계: 배터리 추가 뒤의 처리 전 여유를 합성한다(엔진 재검산은 총괄 범위).
  h.L.snap.econ.cities[h.L.team].grid.headroomMW = 7.65;
  let root = htmlTree(api(h, 'predictionHTML')(h.L.snap));
  let chip = root.querySelector('[data-evidence="grid"]');
  for (const text of [chip.textContent, chip.getAttribute('title'), chip.getAttribute('aria-label')])
    assert.equal(text, '접속 여유: 3.65 MW', '값·title·aria 모두 S1 시작 값');
  click(h, chip);
  const saved = note(h).evidence;
  assert.equal(saved.key, 'grid'); assert.equal(saved.value, 3.65);
  assert.equal(saved.text, '접속 여유: 3.65 MW');
  assert.equal(saved.nowValue, 7.65); assert.equal(typeof saved.nowValue, 'number');
  root = htmlTree(api(h, 'predictionHTML')(h.L.snap));
  assert.equal(root.querySelectorAll('#lg-evidence-now-s4').length, 1);
  assert.equal(root.querySelector('#lg-evidence-now-s4').textContent,
    '계획 시작(S1) 3.65 → 지금 7.65 MW(계획 변경·시작 값으로 비교)');
  h.L.snap.econ.cities[h.L.team].grid.headroomMW = 8.65;
  assert.equal(htmlTree(api(h, 'predictionHTML')(h.L.snap)).querySelector('#lg-evidence-now-s4').textContent,
    '계획 시작(S1) 3.65 → 지금 8.65 MW(계획 변경·시작 값으로 비교)', 'S4는 약속 때가 아니라 그릴 때 값');
  assert.equal(note(h).evidence.nowValue, 7.65, '그리기가 저장한 클릭 값은 바꾸지 않음');
});
for (const role of ['team', 'solo']) for (const now of [3.65, 3.654, 3.656])
  test(`V8 N1 S4 표시 두 자리 경계/${role}/${now}`, () => {
    fixture(h, { role, values: { grid: now }, note: { s1EvidenceValues: { ...standard, grid: 3.65 },
      evidence: { key: 'grid', text: '접속 여유: 3.65 MW', value: 3.65 } } });
    const root = htmlTree(api(h, 'predictionHTML')(h.L.snap));
    assert.equal(root.querySelectorAll('#lg-evidence-now-s4').length, now === 3.656 ? 1 : 0);
    if (now === 3.656) assert.equal(root.querySelector('#lg-evidence-now-s4').textContent,
      '계획 시작(S1) 3.65 → 지금 3.66 MW(계획 변경·시작 값으로 비교)');
  });
for (const key of order) test(`V8 N1 S4 옛 기록 대체/${key}`, () => {
  fixture(h, { note: { s1EvidenceValues: null } });
  const chip = htmlTree(api(h, 'predictionHTML')(h.L.snap)).querySelector(`[data-evidence="${key}"]`);
  click(h, chip);
  assert.equal(note(h).evidence.value, standard[key]);
  assert.equal(note(h).evidence.nowValue, standard[key]);
  assert.equal(htmlTree(api(h, 'predictionHTML')(h.L.snap)).querySelector('#lg-evidence-now-s4'), null);
});
contractCase('V8 N6 두 장이면 지난달 값 없는 세 번째는 채우지 않음',
  { wind: 'wind', previous: { evening: 100 }, values: { evening: 200 } }, ['evening', 'wind']);
contractCase('V8 N6 하나면 변화 0을 값 없음보다 먼저 보충',
  { previous: { evening: 100, neighbor: 10 }, values: { evening: 200 } }, ['evening', 'neighbor'],
  { neighbor: '지난달과 같음' });
contractCase('V8 N6 변화 0도 없으면 값 없음에서 두 장까지만',
  { previous: { neighbor: 10 }, values: { neighbor: 30 } }, ['evening', 'neighbor'], { evening: '' });
test('V8 문구 16 조건 줄만 교체·사건 원문 보존', () => {
  fixture(h, { event: 'regulation' });
  const f = { E: h.R.events.find(e => e.id === 'finedust_coal_cap') }, original = copy(f.E);
  h.L.snap.events = [{ id: f.E.id, round: h.L.snap.round }];
  assert.equal(view(h).focus.querySelector('p.lg-s1-condition').textContent, `이번 달 조건 · ${f.E.name}: 계절관리제 시행으로 석탄발전 출력을 제한해요.`);
  const drawer = htmlTree(eventDrawerHTML(h));
  assert.ok(drawer.textContent.includes(f.E.text), '사건 카드 원문 text 유지');
  assert.deepEqual(copy(f.E), original, '자료 원문 변경 없음');
});

async function privacy() {
  assertions++;
  try {
    fixture(h, { cash: -1 }); const v = view(h), card = v.cards.find(c => cardKey(c) === 'fuel');
    assert.ok(card, '음수 현금으로 LNG 카드가 있는 개인정보 경로 입력');
    const key = cardKey(card);
    const beforeState = JSON.stringify(h.C.publicView(h.L.S, 0));
    click(h, card); assert.equal(note(h).s1Pick, key);
    click(h, view(h).promise);
    assert.equal(typeof note(h).evidence.nowValue, 'number', '실제 저장 경로에 nowValue 존재');
    assert.equal(JSON.stringify(h.C.publicView(h.L.S, 0)), beforeState, 'S1 선택은 공개 상태 불변');
    assert.ok(!/s1Pick|s1EvidenceValues|s1EvidenceNeighborId|nowValue/.test(JSON.stringify(h.U.state())), '공개 검사 상태에도 로컬 필드 없음');
    assert.equal(h.wire.length, 0, '로컬 카드 클릭은 전송 없음');
    // 실제 팀 공개 plan API로 서명 경로를 거친 진행자 요청을 만든다.
    // 서명은 메모리 어댑터이며 requestBody를 그대로 보존한다. 외부 전송은 없다.
    assert.equal(h.U.plan(() => {}), true, '실제 공개 계획 저장 경로');
    await h.L.sending;
    const requests = h.wire.filter(x => x[0] === 'req').map(x => h.ctx.KCP.leagueNet.requestBody(x[1]));
    assert.ok(requests.length > 0, '비어 있지 않은 진행자 요청을 검사');
    const hasPrivate = x => x && typeof x === 'object' && Object.entries(x).some(([k, value]) =>
      ['s1Pick', 's1EvidenceValues', 's1EvidenceNeighborId', 'nowValue'].includes(k) || value === key || hasPrivate(value));
    assert.ok(!requests.some(hasPrivate), '요청 본문의 로컬 필드·고른 값 없음');
    console.log('PASS 6 §4·5 D-65 실제 공개 상태·진행자 요청');
  } catch (e) { failures++; if (e.blocked) blocked++; console.error(`${e.blocked ? 'BLOCKED' : 'FAIL'} 6 §4·5 D-65 실제 공개 상태·진행자 요청: ${e.message}`); }
}
privacy().then(() => {
  console.log(`S1 cards: ${assertions} cases, ${failures} failures (${blocked} API blockers)`);
  console.log(`실제로 막힌 공개 경로: ${[...missing].join(', ') || '없음'}`);
  console.log('후속 단언에도 필요한 기존 함수: evidenceFocusHTML, predictionHTML, onPanelClick, renderPanel, renderBar');
  process.exitCode = failures ? 1 : 0;
});
