'use strict';
// rev19 #90 개정 2. 명세 기반 렌더링 계약. 브라우저·네트워크·의존성 추가 없음.
// node tests/league/review/66-rev19.js [--baseline]
// --baseline: 모든 ui 입력을 git show 577adb1에서 읽어 새 계약의 RED를 확인한다.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const performance = { now: () => 0 }; // HTML data-ms까지 같은 입력/시계로 비교
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../../..'), BASE = '577adb1';
const baseline = process.argv.includes('--baseline');
const read = (name, old = false) => old || baseline
  ? execFileSync('git', ['show', `${BASE}:ui/${name}.js`], { cwd: ROOT, encoding: 'utf8' })
  : fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
let checks = 0, failed = 0;
function check(label, fn) {
  checks++;
  try { fn(); console.log(`PASS ${label}`); }
  catch (e) { failed++; console.error(`FAIL ${label}: ${e.message}`); }
}
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function screenAdapter(source) {
  // 40-v5-s7와 같은 비공개 화면 진입점 연결. 제품의 감싸기 함수를 복제하지 않는다.
  assert.equal(source.split('state: () =>').length, 2, '화면 진입점 연결점');
  const entry = 'function outageCardsHTML(V, res, id, n) {';
  assert.equal(source.split(entry).length, 2, '원문 HTML 입력 연결점');
  return source.replace('let L = null;', 'let L = globalThis.__session;')
    .replace('state: () =>', '__screen: promiseResultHTML, state: () =>')
    .replace(entry, entry + '\nif (globalThis.__outageInput !== undefined) return globalThis.__outageInput;');
}
function load(old) {
  const storage = new Map(), session = { room: 'REV19FIXTURE', team: 'pyeongtaek', role: 'fixture', outCache: {} };
  // DOM 없이 실제 공개 렌더러를 호출하는 기존 30/40번 검사와 같은 세션 어댑터.
  const buildSession = { alive: true, opts: {}, st: { builds: [], lines: [], policies: [] } };
  const ctx = vm.createContext({ console, performance, structuredClone, __session: session,
    __buildSession: buildSession,
    document: { documentElement: {}, addEventListener() {}, getElementById() { return null; } },
    addEventListener() {}, localStorage: { getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    KCP: { route() {}, on() {}, esc, leagueNet: { expandSnapshot: x => x } } });
  ctx.window = ctx;
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
    let source = read(name, old);
    if (name === 'build') {
      assert.equal(source.split('let S = null;').length, 2, 'build VM 화면 상태 연결점');
      source = source.replace('let S = null;', 'let S = globalThis.__buildSession;');
      const entry = 'function complaints(st, runFrac) {';
      assert.equal(source.split(entry).length, 2, '민원 호출 계수 연결점');
      source = source.replace(entry, entry + '\nglobalThis.__complaintCalls = (globalThis.__complaintCalls || 0) + 1;');
    }
    vm.runInContext(source, ctx, { filename: name });
  }
  const source = read('league', old);
  assert.equal(source.split('let L = null;').length, 2, 'league VM 세션 연결점');
  vm.runInContext(screenAdapter(source), ctx, { filename: 'league' });
  const { leagueCore: C, buildGame: B, ECON_DATA: D, league: U } = ctx.KCP;
  const id = session.team, R = C.regionOf('south');
  const S = C.newState(session.room, R.id, 0, [id, 'dangjin'], { turns: 12, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  for (const city of Object.keys(S.teams)) S.teams[city].plan = clone(D.normalStartPlans[city]);
  B.selectPack(C.teamDef(R, id).pack, 'league');
  const res = C.run(S, B, 0), V = clone(C.publicView(S, 0));
  return { B, U, session, buildSession, id, res, V, complaintCalls: () => ctx.__complaintCalls || 0 };
}
// 작은 HTML 트리: 중첩 details를 정규식의 첫 </details>로 잘라 오판하지 않는다.
const decode = s => s.replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[\da-f]+);/gi, x => {
  const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'" };
  if (named[x]) return named[x];
  return String.fromCodePoint(x[2].toLowerCase() === 'x' ? parseInt(x.slice(3), 16) : parseInt(x.slice(2), 10));
});
function parse(html) {
  const root = { tag: '#root', attrs: {}, children: [] }, stack = [root];
  for (const token of html.match(/<[^>]*>|[^<]+/g) || []) {
    if (token.startsWith('</')) { const tag = token.slice(2, -1).trim();
      const pos = stack.findLastIndex(n => n.tag === tag); if (pos > 0) stack.length = pos; }
    else if (token.startsWith('<')) {
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
      const attrs = {};
      for (const m of token.slice(tag.length + 1, -1).matchAll(/([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
        attrs[m[1]] = decode(m[2] ?? m[3] ?? m[4] ?? '');
      const node = { tag, attrs, children: [], parent: stack.at(-1) };
      stack.at(-1).children.push(node);
      if (!['br', 'input', 'hr', 'img', 'meta', 'link'].includes(tag)) stack.push(node);
    } else stack.at(-1).children.push(decode(token));
  }
  return root;
}
const all = (n, pred) => !n || typeof n === 'string' ? [] :
  [...(pred(n) ? [n] : []), ...n.children.flatMap(c => all(c, pred))];
const byId = (n, id) => all(n, n => n.attrs.id === id)[0];
const text = n => !n ? '' : typeof n === 'string' ? n : n.children.map(text).join('');
const cls = (n, c) => (n.attrs.class || '').split(/\s+/).includes(c);
const paragraph = (tree, id) => text(byId(tree, id));
const beneath = (node, parent) => { for (let p = node?.parent; p; p = p.parent) if (p === parent) return true; return false; };
function stripTerms(html) {
  const stack = [];
  return html.replace(/<\/?abbr\b[^>]*>/gi, tag => {
    if (/^<\//.test(tag)) return stack.pop() ? '' : tag;
    const attrs = parse(tag).children[0]?.attrs || {};
    const term = (attrs.class || '').split(/\s+/).includes('lg-term');
    stack.push(term); return term ? '' : tag;
  });
}
function s7HTML(html) {
  const start = /<section\b[^>]*\bid="lg-missed"[^>]*>/.exec(html);
  assert.ok(start, '화면 함수의 실제 S7 section');
  let depth = 0;
  for (const m of html.slice(start.index).matchAll(/<\/?section\b[^>]*>/g)) {
    depth += m[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(start.index, start.index + m.index + m[0].length);
  }
  assert.fail('닫힌 S7 section');
}
const cardsOf = tree => all(byId(tree, 'lg-outage-cards'), n => Object.hasOwn(n.attrs, 'data-missed'));
const cardCluesOf = tree => cardsOf(tree).map(card => ({
  key: card.attrs['data-missed'], name: text(card.children.find(n => n.tag === 'strong')),
  clue: text(all(card, n => n.tag === 'span' && cls(n, 'lg-out-clue'))[0])
}));
const cardHint = tree => {
  const cards = byId(tree, 'lg-outage-cards');
  const siblings = cards?.parent.children.filter(n => typeof n !== 'string') || [];
  return siblings[siblings.indexOf(cards) - 1];
};
function frozen(f, values, details = true) {
  const keys = ['choice', 'weather', 'event', 'trade'];
  const parts = keys.map((key, i) => ({ key, value: values[i] }));
  const total = values.reduce((a, b) => a + b, 0);
  return { id: f.id, round: f.res.round, basis: 'trial', target: 'uns', trial: 10, actual: 10 + total,
    total, replay: 0, parts, grid: { waitingMW: 0, value: 0 },
    clues: Object.fromEntries(keys.map(k => [k, `가상 ${k} 단서 1 → 2`])),
    clueMore: details ? Object.fromEntries(keys.map(k => [k, `가상 ${k} 상세 3 → 4`])) : {},
    ms: 0, simulations: 0, gridFills: 0 };
}
function render(f, a, single, opened = true) {
  const note = { outageFrozen: clone(a), ...(single ? { outageSingleShown: true } :
    { outageOpened: opened, missed: 'choice' }) };
  return f.U.uiMath.outageCardsHTML(f.V, f.res, f.id, note);
}
try {
  const now = load(false), old = load(true);
  for (const entry of [
    { name: '한 줄/최대 있음/상세 없음', values: [2, 0, 0, 0], single: true, details: false },
    { name: '한 줄/최대 없음', values: [0, 0, 0, 0], single: true, details: true },
    { name: '열림/한 장', values: [2, 0, 0, 0], single: false, details: false, cards: 1, largest: '내 선택' },
    { name: '열림/두 장', values: [1, 3, 0, 0], single: false, details: true, cards: 2, largest: '날씨·운전 기간' },
    { name: '열림/세 장/단독 최대', values: [1, 3, 2, 0], single: false, details: true, cards: 3, largest: '날씨·운전 기간' },
    { name: '열림/세 장/공동 최대', values: [3, 3, 1, 0], single: false, details: true, cards: 3,
      lead: '가장 큰 몫: 내 선택(+3.00%p) · 날씨·운전 기간(+3.00%p)' },
    { name: '열림/공동 최대/부호 섞임', values: [-3, 3, 1, 0], single: false, details: true, cards: 3,
      lead: '가장 큰 몫: 내 선택(−3.00%p) · 날씨·운전 기간(+3.00%p)' },
    { name: '열림/네 원인 동률/카드 밖 하나', values: [3, -3, 3, -3], single: false, details: true, cards: 3,
      lead: '가장 큰 몫: 내 선택(+3.00%p) · 날씨·운전 기간(−3.00%p) · 사건·대응(+3.00%p) 외 1개' },
    // 선택한 구기록은 카드 최소 크기 아래여도 열림 상태를 유지한다.
    { name: '열림/최대 없음', values: [.01, .01, .01, .01], single: false, details: true, cards: 1 }
  ]) {
    const a = frozen(now, entry.values, entry.details);
    const html = render(now, a, entry.single), tree = parse(html);
    const before = parse(render(old, a, entry.single)), fold = byId(tree, 'lg-outage-more');
    const clueId = entry.single ? 'lg-outage-others' : 'lg-outage-card-clues';
    check(`${entry.name}: 장면 분기`, () => {
      assert.equal(byId(tree, 'lg-missed')?.attrs['data-single'], String(entry.single));
      assert.equal(byId(tree, 'lg-missed')?.attrs['data-opened'], 'true');
    });
    check(`${entry.name}: 단서 접힘·맨 앞·원문·속성`, () => {
      assert.ok(fold && !Object.hasOwn(fold.attrs, 'open'), '닫힌 more');
      const clue = byId(tree, clueId), orig = byId(before, clueId);
      assert.equal(all(tree, n => n.attrs.id === clueId).length, 1, '원인 단서 문단 하나');
      assert.ok(clue && beneath(clue, fold), '원인 단서는 more 안');
      const expected = entry.single ? text(orig) :
        '원인 단서: ' + cardCluesOf(before).map(c => `${c.name}: ${c.clue}`).join(' · ');
      assert.ok(expected.startsWith('원인 단서: '));
      assert.equal(text(clue), expected, '기준판 카드의 이름: 짧은 단서 원문');
      if (orig) assert.equal(text(clue), text(orig), '기존 문단이 있으면 원문도 동일');
      const content = fold.children.filter(n => typeof n !== 'string' && n.tag !== 'summary');
      assert.equal(content[0], clue, 'summary 뒤 첫 본문');
      assert.equal(fold.children.filter(n => typeof n !== 'string')[0]?.tag, 'summary');
      assert.equal(text(fold.children.find(n => n.tag === 'summary')), '단서 더 보기');
      const attrs = n => all(n, x => Object.hasOwn(x.attrs, 'data-out-other')).map(x => x.attrs);
      assert.deepEqual(attrs(clue), attrs(orig));
    });
    if (!entry.single) {
      check(`${entry.name}: 카드 수·단서 span 원문 유지`, () => {
        assert.equal(cardsOf(tree).length, entry.cards, '명시한 1~3장 fixture');
        assert.equal(all(byId(tree, 'lg-outage-cards'), n => n.tag === 'span' && cls(n, 'lg-out-clue')).length,
          entry.cards, '숨김은 CSS로 하고 카드 span은 유지');
        assert.deepEqual(cardCluesOf(tree), cardCluesOf(before));
      });
      check(`${entry.name}: 고르기 안내 제거·합계 유지`, () => {
        const hint = cardHint(tree), original = text(cardHint(before));
        assert.ok(hint?.tag === 'p' && cls(hint, 'lg-hint'), '카드 묶음 바로 위 안내 p');
        assert.match(original, /\. 후보 (?:한|두|세) 개의 단서만 보고 하나를 골라요\.$/);
        assert.equal(text(hint), original.split('. 후보 ')[0] + '.', '비교 기준·합계 숫자 그대로');
        assert.ok(!text(hint).includes('단서만 보고 하나를 골라요'));
      });
    }
    check(`${entry.name}: outage-terms 없음`, () => {
      assert.equal(all(tree, n => n.attrs['data-info-key'] === 'outage-terms').length, 0);
    });
    check(`${entry.name}: 가장 큰 몫 문구·위치`, () => {
      const lead = byId(tree, 'lg-outage-lead');
      if (entry.single || entry.values.every(v => Math.abs(v) < .05)) { assert.equal(lead, undefined); return; }
      const cards = all(tree, n => Object.hasOwn(n.attrs, 'data-missed'));
      const largest = cards.filter(n => all(n, x => x.attrs['data-out-tag'] === 'largest').length);
      assert.ok(largest.length > 0, '최대 카드 확보');
      const names = largest.map(n => text(n.children.find(c => c.tag === 'strong')));
      const sizes = largest.map(n => text(all(n, x => cls(x, 'lg-out-size'))[0]));
      const max = Math.max(...entry.values.map(Math.abs));
      const tied = entry.values.filter(v => Math.abs(v) === max).length;
      assert.equal(largest.length, Math.min(tied, entry.cards), '카드에 있는 공동 원인 수');
      const suffix = tied > largest.length ? ` 외 ${tied - largest.length}개` : '';
      const expected = '가장 큰 몫: ' + names.map((name, i) => `${name}(${sizes[i]})`).join(' · ') + suffix;
      assert.equal(text(lead), expected, '카드 순서·각자 크기·띄어쓰기·카드 밖 개수');
      if (entry.lead) assert.equal(text(lead), entry.lead, '고정 독립 문구 오라클');
      else assert.equal(names.join('·'), entry.largest);
      const order = all(tree, () => true);
      const head = all(tree, n => n.tag === 'h4')[0];
      const siblings = lead?.parent.children.filter(n => typeof n !== 'string') || [];
      assert.ok(lead && lead.parent === head.parent.parent && siblings.indexOf(lead) ===
        siblings.indexOf(head.parent) + 1, '머리 줄 바로 다음');
      assert.ok(order.indexOf(lead) < order.indexOf(byId(tree, 'lg-outage-waterfall')));
    });
    check(`${entry.name}: 기존 요약·판정·계산·폭포 textContent 보존`, () => {
      for (const id of ['lg-outage-single', 'lg-outage-verdict', 'lg-outage-order', 'lg-outage-waterfall',
        'lg-outage-replay', 'lg-outage-baseline', 'lg-outage-grid-bottleneck', 'lg-outage-grid-small'])
        assert.equal(paragraph(tree, id), paragraph(before, id), id);
    });
  }
  // 공개 전은 frozen 허가 대신 실제 저장 시험·simulate 경로로 만든다.
  const beforeNow = makeTrial(false), beforeOld = makeTrial(true);
  const h = beforeNow.html, t = parse(h);
  check('열기 전: 실제 카드 2~3장·모두 ?', () => {
    const sizes = all(t, n => cls(n, 'lg-out-size'));
    assert.ok(sizes.length >= 2 && sizes.length <= 3);
    assert.ok(sizes.every(n => text(n) === '?'));
    assert.equal(byId(t, 'lg-missed')?.attrs['data-opened'], 'false');
  });
  check('열기 전: lead 없음', () => assert.equal(byId(t, 'lg-outage-lead'), undefined));
  check('열기 전: 카드 단서·고르기 안내 유지·outage-terms 없음', () => {
    const cards = cardsOf(t), clues = cardCluesOf(t);
    assert.ok(cards.length > 0 && cards.every(card =>
      all(card, n => n.tag === 'span' && cls(n, 'lg-out-clue')).length === 1));
    assert.ok(clues.every(c => c.name && c.clue));
    assert.deepEqual(clues, cardCluesOf(parse(beforeOld.html)));
    assert.match(text(cardHint(t)), /\. 후보 (?:한|두|세) 개의 단서만 보고 하나를 골라요\.$/);
    assert.equal(all(t, n => n.attrs['data-info-key'] === 'outage-terms').length, 0);
  });
  check('열기 전: outageCardsHTML 기준판 바이트 동일', () => assert.deepEqual(Buffer.from(h), Buffer.from(beforeOld.html)));
  check('열기 전: 화면 함수도 lg-term 태그만 벗기면 기준판 바이트 동일', () => {
    assert.ok(byId(parse(beforeNow.screen()), 'lg-missed'), '화면 경로에서 실제 S7 생성');
    assert.deepEqual(Buffer.from(stripTerms(beforeNow.screen())), Buffer.from(beforeOld.screen()));
  });
  check('감싸기: 실제 화면 경로에 같은 HTML 두 번 합성 적용해도 동일', () => {
    // 전용 공개 API가 없으므로 원문 렌더러의 반환 경계에만 입력을 주입한다.
    // W(x)를 얻은 뒤 W(W(x))를 구한다. 같은 입력의 화면 재생성 두 번은 검사가 아니다.
    const raw = '<section id="lg-missed"><p title="Δ %p 접속 대기">Δ +3%p · 접속 대기</p></section>';
    const once = beforeNow.wrap(raw), twice = beforeNow.wrap(once), tree = parse(once);
    const terms = all(tree, n => n.tag === 'abbr' && cls(n, 'lg-term'));
    assert.deepEqual(terms.map(n => n.attrs['data-term']), ['delta', 'pp', 'wait']);
    assert.equal(stripTerms(once), raw, '문자·속성·원문 바이트 보존');
    assert.equal(twice, once, 'W(W(x)) === W(x)');
    assert.equal(all(parse(twice), n => n.tag === 'abbr' && cls(n, 'lg-term')).length, 3);
    assert.ok(terms.every(n => all(n, c => c !== n && c.tag === 'abbr').length === 0), 'abbr 중첩 없음');
  });
  // 작은 지도를 실제 siteRule/complaints에 넣는다. 거리·번호 기대값은 검사가 계산한다.
  const { B } = now;
  check('coachSiteTile 공개 API', () => assert.equal(typeof B.coachSiteTile, 'function'));
  for (const [label, used, terrain, want] of [
    ['민원 최소가 거리보다 우선·거리 동점 작은 i', [], {}, 2],
    ['점유 제외·다음 거리 동점', [2], {}, 3],
    ['숲 제외(민원 0이어도 확인창 없는 칸)', [], { 2: 'forest' }, 3],
    ['siteRule 불가 제외', [2], { 3: 'sea' }, 0],
    ['민원 0 칸이 없으면 최소 양수', [0, 2, 3], {}, 1],
    ['모든 적법 칸 점유 → null', [0, 1, 2, 3], {}, null]
  ]) check(`coachSiteTile ${label}`, () => {
    const f = smallMap(used, terrain), rows = siteCandidates(f.B, f.buildSession.st);
    assert.equal(rows[0]?.i ?? null, want, '공개 민원 점수+검사 거리/번호의 독립 오라클 검산');
    assert.equal(f.B.coachSiteTile('diesel'), want);
  });
  check('coachSiteTile 모든 마을까지 거리의 최솟값', () => {
    const f = smallMap();
    f.B.TILES[0].c = 20;
    f.B.TILES.push({ i: 5, c: 21, r: 0, t: 'town', site: -1, out: false, nb: [] });
    // 공장은 디젤 민원을 받지 않지만 거리 동점 계산에는 모든 마을이 포함된다.
    f.B.TOWNS.push({ tile: 5, kind: 'factory_big' });
    assert.equal(siteCandidates(f.B, f.buildSession.st)[0].i, 0);
    assert.equal(f.B.coachSiteTile('diesel'), 0);
  });
  check('coachSiteTile 예산은 읽지 않음', () => {
    const f = smallMap();
    f.buildSession.opts.budget = () => { throw Error('예산을 읽음'); };
    assert.equal(f.B.coachSiteTile('diesel'), 2);
  });
  check('coachSiteTile 민원 최소·거리·번호 fixture 구별력', () => {
    const f = smallMap(), rows = siteCandidates(f.B, f.buildSession.st);
    const near = rows.find(x => x.i === 1), chosen = rows[0];
    assert.ok(near.score > chosen.score && near.d < chosen.d, '가까운 주거 옆 민원 칸을 거부');
    assert.equal(chosen.score, 0);
    assert.ok(rows.find(x => x.i === 0).d > chosen.d, '민원 동점에서 거리 우선');
    assert.equal(rows.find(x => x.i === 3).d, chosen.d, '거리 동점에서 번호 우선');
  });
  check('coachSiteTile 같은 계획은 민원 재계산 없음·설비 변경은 다시 계산', () => {
    const f = smallMap(), original = JSON.stringify(f.buildSession.st), before = f.complaintCalls();
    assert.equal(f.B.coachSiteTile('diesel'), 2);
    const first = f.complaintCalls();
    assert.ok(first > before, '첫 후보 계산은 실제 complaints 호출');
    assert.equal(f.B.coachSiteTile('diesel'), 2);
    assert.equal(f.complaintCalls(), first, '같은 계획에서는 계산 캐시');
    assert.equal(JSON.stringify(f.buildSession.st), original, '현재 계획 보존');
    f.buildSession.st.builds.push({ t: 'solar', i: 2 });
    assert.equal(f.B.coachSiteTile('diesel'), 3);
    assert.ok(f.complaintCalls() > first, '설비 목록이 바뀌면 재계산');
  });
  check('coachSiteTile 적법 칸 없는 설비 종류', () => assert.equal(B.coachSiteTile('rev19-invalid'), null));
} catch (e) {
  check('BLOCKED 필수 VM/fixture 준비', () => { throw e; });
  console.error(e.stack);
}
console.log(`rev19 checks ${checks} fail ${failed}`);
if (failed) process.exitCode = 1;

// 함수 선언 호이스팅. 독립 VM·같은 고정 seed·실제 simulate로 만든 열기 전 장면.
function makeTrial(old) {
  // load의 VM에서 시험 저장 전에 운영하면 안 되므로 별도의 최소 VM을 구성한다.
  const storage = new Map(), session = { room: 'V5S7FIXTURE', team: 'pyeongtaek', role: 'fixture', rev: 0 };
  const ctx = vm.createContext({ console, performance, structuredClone, __session: session,
    document: { documentElement: {}, addEventListener() {}, getElementById() { return null; } },
    addEventListener() {}, localStorage: { getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    KCP: { route() {}, on() {}, esc, leagueNet: { expandSnapshot: x => x } } }); ctx.window = ctx;
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core'])
    vm.runInContext(read(name, old), ctx);
  vm.runInContext(screenAdapter(read('league', old)), ctx);
  const { leagueCore: C, buildGame: B, ECON_DATA: D, league: U } = ctx.KCP, id = session.team;
  const R = C.regionOf('south'), S = C.newState(session.room, R.id, 0, [id, 'dangjin'], { turns: 12, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  for (const city of Object.keys(S.teams)) S.teams[city].plan = clone(D.normalStartPlans[city]);
  B.selectPack(C.teamDef(R, id).pack, 'league');
  // fixture는 정전 대상 두 몫 이상을 확보한다. 운영·저장·표시 함수는 수정하지 않는다.
  D.params.gridImportShare.v = .1;
  const rd = C.roundsOf(S)[0], plan = clone(S.teams[id].plan), seed = 1;
  const raw = B.simulate({ ...B.sanitize(plan, 1e9), seed, season: rd.season }, 7,
    { league: true, mods: C.trialMods(S, R, id) });
  const imported = raw.tot.by.import, filled = C.gridFill(raw), map = C.teamDef(R, id).pack;
  const scope = JSON.stringify([session.room, id]);
  storage.set('kcp-build-trial-v1', JSON.stringify({ [JSON.stringify([scope, map])]: {
    map, scope, year: rd.year, month: rd.month, season: rd.season, seed, days: 7, plan,
    unsPct: 100 * filled.unsTotal / filled.tot.dem, gridMWh: filled.tot.by.import - imported,
    outH: 0, co2: filled.co2, cost: filled.cost.total } }));
  S.teams[id].plan.policies = ['save'];
  const res = C.run(S, B, 0), V = clone(C.publicView(S, 0));
  session.snap = V;
  const note = { topic: 'uns', evidence: { key: 'evening', text: '가상 저녁 수요', value: 1 },
    pred: { uns: 'down' } };
  const screen = () => U.__screen(V, clone(note));
  return { html: U.uiMath.outageCardsHTML(V, res, id, {}), screen,
    wrap: html => {
      ctx.__outageInput = html;
      try { return s7HTML(screen()); }
      finally { delete ctx.__outageInput; }
    } };
}

function smallMap(used = [], terrain = {}) {
  // 지도는 운영 중 변하지 않는다. fixture마다 VM을 분리해 계획 캐시를 잘못 무효화시키지 않는다.
  const f = load(false), { B, buildSession } = f;
  const tiles = [[0, 0], [4, 0], [1, 0], [1, 1], [5, 0]].map(([c, r], i) =>
    ({ i, c, r, t: terrain[i] || (i === 4 ? 'town' : 'plain'), site: -1, out: false, nb: [] }));
  B.TILES.splice(0, B.TILES.length, ...tiles);
  B.TOWNS.splice(0, B.TOWNS.length, { tile: 4, kind: 'city' });
  buildSession.st = { builds: used.map(i => ({ t: 'solar', i })), lines: [], policies: [] };
  return f;
}
function siteCandidates(B, st) {
  const used = new Set(st.builds.map(b => b.i));
  const cube = t => { const x = t.c - (t.r - (t.r & 1)) / 2; return [x, -x - t.r, t.r]; };
  const dist = (a, b) => Math.max(...cube(a).map((v, i) => Math.abs(v - cube(b)[i])));
  return B.TILES.filter(t => !used.has(t.i) && t.t !== 'forest' && B.siteRule('diesel', t) === '')
    .map(t => {
      const plan = B.sanitize({ ...clone(st), builds: [...clone(st.builds), { t: 'diesel', i: t.i }] }, 1e9);
      const bi = plan.builds.findIndex(b => b.t === 'diesel' && b.i === t.i);
      assert.ok(bi >= 0, '후보 디젤이 sanitize 뒤에도 남음');
      const score = B.complaints(plan, null).items.filter(x => x.bi === bi).reduce((sum, x) => sum + x.pts, 0);
      return { i: t.i, score, d: Math.min(...B.TOWNS.map(w => dist(t, B.TILES[w.tile]))) };
    }).sort((a, b) => a.score - b.score || a.d - b.d || a.i - b.i);
}
