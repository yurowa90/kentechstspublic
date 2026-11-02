'use strict';
// V5-s7-fix.md §2·§2-1·§3. 실행: node tests/league/review/40-v5-s7.js
// 잡는 회귀: 접힘 요약 누락/잘못된 직접 연결·단위·최대 선택/정답 유출,
// 기록의 모순된 꼬리말, 공개 직후 판정 줄·기존 본문·접근성 속성 변경.
// 10~16: 실제 꼴 근거 길이, 미선택, 작은 몫 경계·개수, 직접 연결 표시,
// target 없는 gridImport 구기록, summary 원문 HTML의 근거 이스케이프.
// 브라우저·통신 없음. 계산/렌더러는 추출하거나 교체하지 않는다.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '../../..'), clone = x => JSON.parse(JSON.stringify(x));
const id = 'pyeongtaek', ids = [id, 'dangjin'], storage = new Map();
const session = { room: 'V5S7FIXTURE', team: id, role: 'fixture', rev: 0 };
const ctx = vm.createContext({ console, performance, structuredClone, __session: session,
  document: { documentElement: {}, addEventListener() {}, getElementById() { return null; } },
  addEventListener() {}, localStorage: { getItem: k => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
  KCP: { route() {}, on() {}, esc: s => String(s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    leagueNet: { expandSnapshot: x => x } } });
ctx.window = ctx;
vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core'])
  vm.runInContext(fs.readFileSync(name === 'econ-data' && process.argv[3] || path.join(ROOT, `ui/${name}.js`), 'utf8'), ctx, { filename: name });
// 선택 인자는 변이 검사 임시 사본. 기본 실행에서는 작업 중 구현을 읽는다.
const source = fs.readFileSync(process.argv[2] || path.join(ROOT, 'ui/league.js'), 'utf8');
assert.equal(source.split('let L = null;').length, 2, '30·32번의 VM 세션 연결점');
assert.equal(source.split('state: () =>').length, 2, '30·32번의 기록 경로 연결점');
// 세션·수신·기록 진입점만 메모리에서 연결한다. missedText가 비공개이므로
// 실제 소비자인 공개 trendHTML과 기존 일지·다음 달 표시 경로로 검증한다.
vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
  .replace('state: () =>', '__weatherClue: outageWeatherClue, __promiseResultHTML: promiseResultHTML, __receive: onSnap, __worksheet: worksheet, __carryHTML: missedCarryHTML, state: () =>'), ctx);
const { leagueCore: C, buildGame: B, ECON_DATA: D, league: U } = ctx.KCP;
const M = U.uiMath, R = C.regionOf('south');
const teamKey = `kcp-league-data-v1:${session.room}:${id}`;
const trialKeys = ['choice', 'weather', 'event', 'trade'];
const monthlyKeys = ['choice', 'weather', 'event', 'progress', 'growth', 'trade'];
const names = basis => ({ choice: '내 선택', weather: basis === 'monthly' ? '날씨·계절·운전 기간' : '날씨·운전 기간',
  event: '사건·대응', progress: '접속·공사·기술 진행', growth: '도시 성장·연료 값', trade: '이웃 거래' });
// V7 A: 계약의 고정값으로 독립 계산한다(제품 상수·함수는 읽지 않는다).
const minPart = a => a.target === 'grid' ? Math.max(Math.max(.05, .05 * Math.abs(a.trial ?? a.base)) / 10, .05) : .05;
const cardMin = a => {
  const total = a.total ?? (a.actual - (a.trial ?? a.base));
  return Number.isFinite(total) ? Math.max(minPart(a), .05 * Math.abs(total)) : minPart(a);
};
// V5 §2의 기존 연결 규칙을 검사 쪽에 명시한다. UI 소스의 연결표는 읽지 않는다.
// 같은 단계/간접 연결은 직접 연결에 넣지 않는다. 시험 기준에는 진행·성장 몫이 없다.
const evidenceCases = [
  { key: 'evening', text: '저녁 수요', direct: ['weather', 'event', 'growth'] },
  { key: 'wind', text: '평균 풍속', wind: true, direct: ['weather', 'event'] },
  { key: 'wind', text: '평균 풍속', wind: false, direct: [] },
  { key: 'wind', text: '평균 풍속', direct: [] }, // 접속 정보 없는 옛 기록도 직접 효과 없음.
  { key: 'grid', text: '접속 여유', direct: ['progress'] }, // 명세 A2: choice는 같은 단계.
  { key: 'fuel', text: 'LNG 연료 값', direct: [] },
  { key: 'neighbor', text: '이웃 정전', direct: ['trade'] }
];
const prefix = '내 예측이 놓친 것 · ';
const uniqueLabel = '실제 가장 큰 몫과 같음';
const tiedLabel = '크기가 같은 가장 큰 몫 중 하나를 짚음';
let checks = 0;
const failures = [];
function check(label, fn) {
  checks++;
  try { fn(); } catch (e) { failures.push(label); console.error(`FAIL ${label}: ${e.message}`); }
}
const decode = s => s.replace(/&(?:amp|lt|gt|quot|#39);/g,
  x => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[x]));
const textOf = s => decode(s.replace(/<[^>]*>/g, ''));
function evidenceBlock(html) {
  return html.match(/<details\b[^>]*id="lg-outage-evidence"[^>]*>([\s\S]*?)<\/details>/)?.[1] || '';
}
function summaryHTML(html) {
  return evidenceBlock(html).match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1] || '';
}
function summaryOf(html) {
  return textOf(summaryHTML(html));
}
function summaryBody(html) {
  const summary = summaryOf(html);
  return summary.startsWith(prefix) ? summary.slice(prefix.length) : '';
}
function firstVerdict(html) {
  return textOf(html.match(/<div\b[^>]*id="lg-outage-verdict"[^>]*>\s*<p>([\s\S]*?)<\/p>/)?.[1] || '');
}
// outageValue를 호출하지 않고 계약의 표시 자릿수·부호·단위를 독립적으로 계산한다.
// rev14b A1: 기본 params의 같음 문턱이 0.1 미만인 하루 평균 계통 기록만 2자리.
const displayDigits = a => a.target !== 'grid' ? 2 : a.unit !== 'MWh/일' ? 1 :
  Number.isFinite(a.trial ?? a.base) && Math.abs(a.trial ?? a.base) < 2 ? 2 : 1;
function valueText(value, target, a = { target }) {
  const digits = displayDigits(a), rounded = Number(value.toFixed(digits)) + 0;
  const body = target === 'grid' ? Math.abs(rounded).toLocaleString('ko-KR',
    { minimumFractionDigits: digits, maximumFractionDigits: digits }) : Math.abs(rounded).toFixed(2);
  return `${rounded < 0 ? '−' : rounded > 0 ? '+' : ''}${body}${target === 'grid' ? ' MWh/일' : '%p'}`; // D-82: 합성 기록도 계약의 하루 평균 단위로 표시를 독립 계산.
}
function displayedPartText(html, a, key) {
  const row = html.match(new RegExp(`<div\\b[^>]*data-out-step="${key}"[^>]*>([\\s\\S]*?)<\\/div>`))?.[1] || '';
  const text = textOf(row.match(/<b>([^<]*)<\/b>/)?.[1] || '');
  const value = Number(text.match(/^[+−-]?\d[\d,.]*/)?.[0].replace('−', '-').replaceAll(',', ''));
  const scale = 10 ** displayDigits(a), ticks = Math.round(value * scale);
  const floor = Math.floor(a.parts.find(p => p.key === key).value * scale);
  assert.ok(ticks === floor || ticks === floor + 1, `${key} 표시값은 원값의 내림 또는 내림+1 눈금`); // spec-C §M5: 독립 반올림 대신 배분 가능한 두 눈금 검증.
  assert.equal(text, valueText(value, a.target, a), `${key} 표시 자릿수·부호·단위`); // rev14b A1: 배분 뒤에도 해당 달의 자릿수를 엄격 비교.
  return text;
}
function reset() { session.outCache = {}; session.outFailures = {}; session.outShownPending = null; }
function select() { B.selectPack(C.teamDef(R, id).pack, 'league'); }
function operate(S) {
  U.__receive(clone(C.publicView(S, 0)));
  const res = C.run(S, B, 0), V = clone(C.publicView(S, 0));
  U.__receive(V); reset();
  return { V, res };
}
function fixture(basis, target) {
  storage.clear(); reset(); session.snap = null; delete session.interview;
  const S = C.newState(session.room, R.id, 0, ids, { turns: 12, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  for (const city of ids) S.teams[city].plan = clone(D.normalStartPlans[city]);
  // 정전 대상도 여러 후보를 실제 계산하게 한다. 상한은 각 fixture 뒤 복원한다.
  const savedShare = D.params.gridImportShare.v;
  try {
    if (target === 'uns') D.params.gridImportShare.v = .1;
    if (basis === 'monthly') { operate(S); C.host(S, 'next', 0); }
    else {
      select();
      const rd = C.roundsOf(S)[S.round - 1], plan = clone(S.teams[id].plan), seed = 1;
      const raw = B.simulate({ ...B.sanitize(plan, 1e9), seed, season: rd.season }, 7,
        { league: true, mods: C.trialMods(S, R, id) });
      const imported = raw.tot.by.import, filled = C.gridFill(raw);
      const map = C.teamDef(R, id).pack, scope = JSON.stringify([session.room, id]);
      const trial = { map, scope, year: rd.year, month: rd.month, season: rd.season, seed, days: 7, plan,
        unsPct: 100 * filled.unsTotal / filled.tot.dem, gridMWh: filled.tot.by.import - imported,
        outH: 0, co2: filled.co2, cost: filled.cost.total };
      storage.set('kcp-build-trial-v1', JSON.stringify({ [JSON.stringify([scope, map])]: trial }));
    }
    S.teams[id].plan.policies = ['save'];
    const f = operate(S);
    // 공개 전 검사용 실제 분해를 캐시에 계산한다. 기대값은 이 반환값에서 만들지 않는다.
    const a = M.outageAttribution(f.V, f.res, id);
    assert.ok(a, '실제 분해 fixture 존재');
    assert.equal(a.basis, basis, 'fixture 기준'); assert.equal(a.target, target, 'fixture 대상');
    return f;
  } finally { D.params.gridImportShare.v = savedShare; }
}
// 저장 자료 경계의 합성 기록. 연결된 몫보다 전체 최대(trade)가 더 크며,
// event는 음수라 부호 순서 정렬도 잡는다. 기대값을 S7 반환값에서 복사하지 않는다.
function frozen(f, basis, target, overrides = {}, wind) {
  const values = { choice: .31, weather: 1.23, event: -4.56, progress: -3.45, growth: 2.34, trade: 8.76,
    ...overrides };
  const scale = target === 'grid' ? 100 : 1;
  const keys = basis === 'monthly' ? monthlyKeys : trialKeys;
  const parts = keys.map(key => ({ key, value: values[key] * scale }));
  const total = parts.reduce((n, p) => n + p.value, 0), base = target === 'grid' ? 1000 : 10;
  return { id, round: f.res.round, basis, target, trial: base, actual: base + total, total, replay: 0,
    ...(target === 'grid' ? { unit: 'MWh/일' } : {}), // D-82: 새 하루 평균 고정본을 단위 없는 옛 월 합계와 구별.
    replayOutsideSum: basis === 'monthly', parts, grid: { value: 0, waitingMW: 0 },
    clues: Object.fromEntries(keys.map(k => [k, '가상 단서'])),
    clueMore: Object.fromEntries(keys.map(k => [k, '가상 상세 단서'])),
    ...(wind === undefined ? {} : { hasConnectedWind: wind }), simulations: 0, gridFills: 0, ms: 0 };
}
function opened(f, a, evidence, missed = 'trade') {
  return M.outageCardsHTML(f.V, f.res, id, { outageOpened: true, outageFrozen: a,
    missed, ...(evidence ? { evidence: { key: evidence.key, text: evidence.text, value: 100 } } : {}) });
}
// 표시 경계용 합성 기록. 입력 몫은 대상 단위 그대로 넣고 합계만 맞춘다.
function partRecord(f, basis, target, base, values) {
  const a = frozen(f, basis, target);
  a.parts = a.parts.map(p => ({ key: p.key, value: values[p.key] ?? p.value }));
  a.trial = base;
  a.total = a.parts.reduce((n, p) => n + p.value, 0);
  a.actual = base + a.total;
  return a;
}
function records(f, a, missed) {
  const note = { outageOpened: true, outageFrozen: a, missed, missedBasis: a.basis,
    evidence: { key: 'grid', text: '접속 여유', value: 100 },
    missedCarry: { missed, basis: a.basis, target: a.target } };
  storage.set(teamKey, JSON.stringify({ interview: { months: { [f.res.round]: note } } }));
  return { journal: U.__worksheet(f.V), timeline: M.trendHTML(f.V, id, true),
    carry: U.__carryHTML({ ...f.V, round: f.res.round + 1 }) };
}

for (const basis of ['trial', 'monthly']) for (const target of ['uns', 'grid']) {
  const scope = `${basis}/${target}`;
  let f;
  check(`fixture ${scope}`, () => { f = fixture(basis, target); });
  if (!f) continue; // fixture 오류도 실패로 누적하고 다음 독립 조합은 계속 검사한다.
  for (const [index, evidence] of evidenceCases.entries()) {
    const a = frozen(f, basis, target, {}, evidence.wind), label = `${scope}/${evidence.key}/${index}`;
    const html = opened(f, a, evidence), summary = summaryBody(html), ns = names(basis);
    const direct = evidence.direct.filter(k => (basis === 'monthly' ? monthlyKeys : trialKeys).includes(k));
    check(`1 §2 ${label} 접힘 요약`, () => {
      assert.ok(summaryOf(html).startsWith(prefix), `summary 접두: ${summaryOf(html)}`);
      assert.ok(summary.trim(), '접두 뒤 비어 있지 않은 요약');
    });
    check(`2 §2 ${label} 근거·직접 연결`, () => {
      assert.ok(summary.includes(evidence.text), '고른 근거 이름');
      if (!direct.length) {
        assert.ok(summary.includes('따로 계산하지 않음'), '직접 연결이 없으면 별도 계산 안 함');
        assert.ok(!/[+−-]?[\d,]+(?:\.\d+)?\s*(?:MWh|%p)/.test(summary), '간접 연결 몫을 직접 효과로 쓰지 않음');
      } else {
        const lead = [...a.parts].filter(p => direct.includes(p.key))
          .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))[0];
        assert.ok(summary.includes(ns[lead.key]), `가장 큰 직접 연결 몫: ${ns[lead.key]}`);
        assert.ok(summary.includes(valueText(lead.value, target)), '직접 연결 몫 값·부호·단위');
        const shown = Object.entries(ns).filter(([, name]) => summary.includes(name)).map(([key]) => key);
        assert.deepEqual(shown, [lead.key], '직접 연결 몫 이름 하나만 표시');
        if (direct.length > 1) assert.ok(summary.includes(`외 ${direct.length - 1}개`), '나머지 직접 연결 몫 수');
        else assert.ok(!/외\s*\d+개/.test(summary), '직접 연결 하나면 나머지 없음');
        assert.ok(!summary.includes(target === 'grid' ? '%p' : 'MWh'), '다른 대상 단위 없음');
      }
    });
    check(`3 §2 ${label} 요약 길이`, () => {
      assert.ok(summary.trim(), '빈 요약으로 길이 검사를 통과하지 않음');
      // 명세의 "대략 80자"에 띄어쓰기·부호·구분자 차이 10자를 허용한다.
      // 접두는 제외하고 학생에게 보이는 문자 기준으로 세며 90자를 상한으로 둔다.
      assert.ok([...summary].length <= 90, `요약 ${[...summary].length}자`);
    });
    check(`4 §2 ${label} 본문·초점·알림 보존`, () => {
      // 30·32번이 읽는 기존 정규식과 문단 접두를 유지한다.
      const body = html.match(/<p>내 예측이 놓친 것: ([\s\S]*?)<\/p>/)?.[1];
      assert.ok(body, '기존 본문 정규식으로 내용 읽힘');
      assert.ok(textOf(body).startsWith(`고른 근거 ‘${evidence.text}’`), '기존 근거 설명 형식');
      const tag = html.match(/<div\b[^>]*id="lg-outage-verdict"[^>]*>/)?.[0] || '';
      assert.match(tag, /\btabindex="-1"/); assert.match(tag, /\baria-live="polite"/);
    });
    if (direct.length) check(`14 §2-1 ${label} 대표 몫 앞 직접 연결 표시`, () => {
      const lead = [...a.parts].filter(p => direct.includes(p.key))
        .sort((x, y) => Math.abs(y.value) - Math.abs(x.value))[0];
      assert.ok(summary.includes(`직접 연결 몫 ${ns[lead.key]} ${valueText(lead.value, target)}`),
        '대표 이름·값 앞에 직접 연결 몫 낱말');
    });
  }
  for (const evidence of [
    { key: 'evening', text: '저녁 수요: 12.34 MW' },
    { key: 'neighbor', text: '가상도시 · 이웃 정전: 12.34%' }
  ]) check(`10 §2 ${scope}/${evidence.key} 실제 꼴 근거 요약 길이`, () => {
    const summary = summaryBody(opened(f, frozen(f, basis, target), evidence));
    assert.ok(summary.trim(), '빈 요약으로 길이 검사를 통과하지 않음');
    assert.ok(summary.includes(evidence.text), '수치·단위를 포함한 고른 근거');
    // 3번과 같은 기준: 접두 제외, 보이는 문자 수, 대략 80자에 여유 10자.
    assert.ok([...summary].length <= 90, `요약 ${[...summary].length}자: ${summary}`);
  });
  check(`11 §2-1 ${scope} 근거 미선택`, () => {
    // n.evidence 속성 자체를 보내지 않는다. 빈 근거 객체와 구별한다.
    assert.equal(summaryBody(opened(f, frozen(f, basis, target))), '고른 근거 없음');
  });
  // 명세 §2-1의 독립 식. UI의 outageMinPart/gridSameTol은 호출하지 않는다.
  // 계통은 하한·양수·음수 기준을 모두 쓰고 actual/total은 기준과 다르게 둔다.
  const bases = target === 'grid' ? [0, 10, 1000, -1000] : [10];
  for (const base of bases) {
    // D-82 수정 2(총괄 결정): 계통 최소 몫 = max('같음' 문턱/10, 0.05 MWh/일), 문턱 = max(0.05, 기준×5%).
    // 기준 0은 하한 0.05가, ±1000은 문턱/10이 정한다. 10은 둘이 같은 경계다.
    const minPart = target === 'grid' ? Math.max(Math.max(.05, .05 * Math.abs(base)) / 10, .05) : .05;
    const evidence = { key: 'evening', text: '저녁 수요: 12.34 MW' }, ns = names(basis);
    for (const mode of ['zero', 'below']) check(`12 §2-1 ${scope}/${base}/${mode} 직접 연결 모두 작은 몫`, () => {
      const tiny = mode === 'zero' ? 0 : minPart * .999;
      const a = partRecord(f, basis, target, base,
        { weather: tiny, event: -tiny, growth: tiny, choice: 99, trade: -88 });
      const summary = summaryBody(opened(f, a, evidence));
      assert.equal(summary, `고른 근거 ‘${evidence.text}’ · 직접 연결 몫은 거의 0`,
        '직접 연결은 있으나 모두 문턱 미만: 간접 큰 몫·외 n개·수치 없음');
    });
    const boundaryCases = [
      { label: '바로 위 하나', weather: -minPart * 1.001, event: minPart * .999,
        growth: -minPart * .999, lead: 'weather', extra: 0 },
      { label: '문턱과 같은 음수 하나', weather: -minPart, event: minPart * .999,
        growth: 0, lead: 'weather', extra: 0 },
      ...(basis === 'monthly' ? [
        { label: '바로 아래 하나 제외', weather: -minPart * .999, event: minPart * 1.001,
          growth: -minPart * 2, lead: 'growth', extra: 1 }
      ] : [])
    ];
    for (const row of boundaryCases) {
      const a = partRecord(f, basis, target, base,
        { weather: row.weather, event: row.event, growth: row.growth, choice: 99, trade: -88 });
      check(`13 §2-1 ${scope}/${base}/${row.label} 대표·외 개수`, () => {
        const summary = summaryBody(opened(f, a, evidence));
        const counted = a.parts.filter(p => ['weather', 'event', 'growth'].includes(p.key) && Math.abs(p.value) >= cardMin(a))
          .sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
        const lead = counted[0];
        assert.ok(lead ? summary.includes(`${ns[lead.key]} ${valueText(lead.value, target)}`) :
          summary === `고른 근거 ‘${evidence.text}’ · 직접 연결 몫은 거의 0`,
          '5% 카드 문턱 이상 대표·없으면 정확한 거의 0 문장');
        assert.deepEqual(Object.entries(ns).filter(([, name]) => summary.includes(name)).map(([key]) => key),
          lead ? [lead.key] : [], '문턱 이상 대표 이름만 표시');
        const count = summary.match(/외\s*(\d+)개/), extra = Math.max(0, counted.length - 1);
        assert.equal(count ? Number(count[1]) : 0, extra, '외 n개에는 카드 문턱 이상인 나머지만 셈');
        if (!extra) assert.equal(count, null, '대표만 남거나 없으면 외 0개도 쓰지 않음');
        assert.equal(summary.includes('거의 0'), !lead, '카드 문턱 이상 유무와 거의 0 일치');
      });
    }
  }
  check(`15 §2·2-1/구기록 호환 ${scope} target 없는 gridImport 기록`, () => {
    const old = frozen(f, basis, 'uns');
    delete old.target;
    if (basis === 'trial') delete old.basis; // basis도 없던 첫 시험 기록.
    old.parts.push({ key: 'gridImport', value: -9.87 });
    old.clues.gridImport = '가상 계통 수입 단서';
    old.clueMore.gridImport = '가상 계통 수입 상세 단서';
    old.total -= 9.87; old.actual -= 9.87;
    let html;
    assert.doesNotThrow(() => {
      html = opened(f, old, { key: 'neighbor', text: '가상도시 · 이웃 정전: 12.34%' }, 'gridImport');
    }, 'target 없는 구기록·gridImport 선택도 렌더링 예외 없음');
    const summary = summaryBody(html);
    assert.ok(summary.includes('이웃 거래 +8.76%p'), '대상 누락 시 요약은 정전 %p 단위');
    assert.ok(!summary.includes('MWh'), '현재 달 대상이 계통이어도 구기록 단위 우선');
    assert.ok(textOf(html).includes('계통 수입'), '옛 gridImport 몫도 표시');
  });
  check(`16 §2/독립 검토 ${scope} summary 근거 HTML 이스케이프`, () => {
    const raw = summaryHTML(opened(f, frozen(f, basis, target),
      { key: 'evening', text: '<img src=x onerror=alert(1)>' }));
    // textOf를 거치면 태그가 지워져 누락을 숨기므로 원문 HTML을 검사한다.
    assert.ok(!/<img/i.test(raw), 'summary 원문에 img 태그 없음');
    assert.ok(raw.includes('&lt;img'), '근거를 버리지 않고 이스케이프하여 표시');
  });
  check(`5 §2 ${scope} 공개 전 요약·숫자 비공개·고르기 유지`, () => {
    // 고정본을 넣으면 이미 공개한 기록이므로, 공개 전에는 실제 계산 경로를 쓴다.
    for (const missed of [undefined, 'choice']) {
      const html = M.outageCardsHTML(f.V, f.res, id, { missed,
        evidence: { key: 'evening', text: '저녁 수요', value: 100 } });
      assert.ok(html.includes('data-opened="false"') && html.includes('data-single="false"'), '공개 전 여러 후보 fixture');
      assert.ok(!html.includes('id="lg-outage-evidence"'), '접힘 상세도 없음');
      assert.ok(!html.includes('내 예측이 놓친 것'), '요약 문구 없음');
      const summaries = [...html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)].map(m => textOf(m[1])).join(' ');
      assert.ok(!/[+−-]?[\d,]+(?:\.\d+)?\s*(?:MWh|%p)/.test(summaries), 'summary에 원인 몫 숫자 없음');
      assert.ok(!/data-out-value=|data-out-tag="largest"|id="lg-outage-verdict"/.test(html), '카드 정답 비공개');
      const button = html.match(/<button\b[^>]*id="lg-outage-open"[^>]*>/)?.[0];
      assert.ok(button, '열기 버튼'); assert.equal(/\bdisabled\b/.test(button), !missed, '고른 뒤 열기 가능');
      if (missed) assert.match(html, /data-missed="choice" aria-pressed="true"/, '고른 카드 표시');
    }
  });
  // 두 부호 모두 절댓값 최대를 맞힌 경우다. 동점은 첫 원인이 아닌 event를 고른다.
  for (const mode of ['unique', 'tied', 'smaller']) for (const sign of [-1, 1]) {
    const a = frozen(f, basis, target, { choice: sign * 9.43,
      event: mode === 'tied' ? -sign * 9.43 : -2.22 });
    const missed = mode === 'unique' ? 'choice' : 'event', ns = names(basis);
    const label = `${scope}/${mode}/${sign}`, saved = records(f, a, missed);
    for (const [route, raw] of Object.entries(saved)) {
      const text = textOf(raw);
      check(`${mode === 'unique' ? 6 : mode === 'tied' ? 7 : 8} §3 ${label}/${route} 기록 라벨`, () => {
        assert.ok(text.includes(`${route === 'carry' ? '지난달 내가 고른 원인' : '내가 고른 원인'}: ${ns[missed]}`), '기존 접두·선택 이름');
        assert.ok(!text.includes(' · 가장 큰 몫과 같음') && !text.includes('가장 큰 몫과 크기 같음'), '옛 꼬리말 없음');
        if (mode === 'smaller') assert.ok(!text.includes(uniqueLabel) && !text.includes(tiedLabel), '비최대 선택에 새 칭찬 없음');
        else {
          assert.ok(text.includes(mode === 'unique' ? uniqueLabel : tiedLabel), '명세의 새 꼬리말');
          assert.ok(!text.includes(mode === 'unique' ? tiedLabel : uniqueLabel), '단독·동점 라벨 구별');
        }
      });
    }
    if (mode !== 'smaller') check(`9 §3 ${label} 공개 직후 판정 줄 보존`, () => {
      const first = firstVerdict(opened(f, a, evidenceCases[4], missed));
      assert.ok(first.startsWith(`내가 고른 것: ${ns[missed]} `), '판정 첫 줄의 선택');
      assert.ok(first.endsWith(mode === 'unique' ? ' · 가장 큰 몫과 같아요' : ' · 크기가 같은 가장 큰 몫 중 하나예요'),
        '공개 직후 판정 문구는 그대로');
      assert.ok(!first.includes(uniqueLabel) && !first.includes(tiedLabel), '기록용 꼬리말과 판정 줄 구별');
    });
  }
}
// D-82: 표시 변경 (a)(b), 반올림 동점, 옛 계통 고정본 교체를 저장·렌더링 경계에서 추가 검증한다.
for (const basis of ['trial', 'monthly']) { // D-82: 첫 달 시험과 지난달 기준을 모두 실행.
  const f = fixture(basis, 'grid'); // D-82: 실제 운영 자료와 사본은 유지하고 표시 입력만 합성.
  const allZero = Object.fromEntries((basis === 'monthly' ? monthlyKeys : trialKeys).map(k => [k, 0])); // D-82: 반환 몫을 기대값으로 쓰지 않음.
  const costText = (value, daily) => { // D-82: 공개 가격 입력과 명세의 소수 둘째 자리·부호로 비용을 독립 계산.
    const rounded = Number((value * D.params.normalCost.v * D.params.gridImportMarkup.v).toFixed(2)) + 0; // D-82: 억/MWh × MWh/일 또는 옛 MWh.
    return `(비용 ${rounded < 0 ? '−' : rounded > 0 ? '+' : ''}${Math.abs(rounded).toFixed(2)}억${daily ? '/일' : ''})`; // D-82: 새 기록 억/일, 옛 기록 억.
  }; // D-82: 비용 기대값 도우미 끝.
  for (const target of ['grid', 'uns']) for (const sign of [-1, 1]) for (const single of [false, true]) { // D-82: 양·음 비용과 단일·여러 원인 표시를 모두 검사.
    check(`17 D-82 ${basis}/${target}/${sign}/${single} 비용·사건 문구`, () => { // D-82: 새 계통·정전 기록의 표시 계약.
      const a = partRecord(f, basis, target, 30, { ...allZero, event: sign * 12.34, weather: single ? 0 : 1.23 }); // D-82: 최대 사건 몫과 비용은 합성 입력에서 결정.
      a.clues.event = '우리 도시 정전에 닿는 사건 없음(해당 2건)'; // D-82: 명세 (b)의 짧은 단서 치환 입력.
      a.clueMore.event = '우리 도시 정전에 닿는 효과 없음 / 우리 도시 정전에 닿는 사건 없음'; // D-82: 상세 단서의 모든 출현을 검사.
      const before = clone(a), text = textOf(opened(f, a, evidenceCases[0], 'event')); // D-82: 실제 렌더러 경계 호출.
      const phrase = target === 'grid' ? '우리 도시가 바깥 계통에 기댄 전기에 닿는' : '우리 도시 정전에 닿는'; // D-82: 대상별 명세 문자열.
      assert.ok(text.includes(`${phrase} 사건 없음(해당 2건)`), '짧은 사건 단서의 대상 문구'); // D-82: 카드·요약 어디서든 원문 전체 대조.
      assert.ok(text.includes(`${phrase} 효과 없음 / ${phrase} 사건 없음`), '상세 사건 단서의 모든 출현'); // D-82: 상세 치환 누락 방지.
      assert.ok(!text.includes(target === 'grid' ? '우리 도시 정전에 닿는' : '우리 도시가 바깥 계통에 기댄 전기에 닿는'), '다른 대상 문구 없음'); // D-82: 혼용 금지.
      const surfaces = { result: text, ...Object.fromEntries(Object.entries(records(f, a, 'event')).map(([k, v]) => [k, textOf(v)])) }; // D-82: 결과·일지·타임라인·다음 달 비용 경로.
      for (const [route, surface] of Object.entries(surfaces)) { // D-82: 같은 저장 입력의 소비자를 모두 검사.
        const costs = [...surface.matchAll(/비용 ([+−]?[\d,.]+억(?:\/일)?)/g)].map(m => `(비용 ${m[1]})`); // D-82: 기존 다른 비용 문구와 S7 비용을 구별.
        if (target === 'grid') { // D-82: 계통에는 계산한 비용이 반드시 존재.
          assert.ok(costs.length > 0, `${route} 비용 표시 존재`); // D-82: 빈 출력으로 통과하지 않음.
          assert.ok(costs.every(v => v === costText(sign * 12.34, true)), `${route} 독립 비용·부호·억/일`); // D-82: 허용 오차 없이 문자열 전체 비교.
        } else assert.deepEqual(costs, [], `${route} 정전에는 계통 비용 표기 없음`); // D-82: 정전 표시 계약 보존.
      } // D-82: 비용 경로 검사 끝.
      assert.deepEqual(a, before, '표시가 입력 고정본의 수치·원문을 변경하지 않음'); // D-82: 표시 문구 전환은 저장 입력의 변형이 아님.
    }); // D-82: 새 표시 계약 검사 끝.
  } // D-82: 대상·부호·단일/여러 원인 순회 끝.
  for (const sign of [-1, 1]) check(`18 D-82 ${basis}/${sign} 단위 없는 옛 계통 기록`, () => { // D-82: 과거 기록은 월 합계 단위로 읽고 현재 결과에서는 교체.
    const old = partRecord(f, basis, 'grid', 1000, { ...allZero, trade: sign * 123.45 }); // D-82: 새 값과 혼동할 수 없는 옛 월 합계 입력.
    delete old.unit; // D-82: 실제 단위 없는 옛 계통 고정본.
    const before = clone(old), saved = records(f, old, 'trade'); // D-82: 닫힌 과거 기록의 소비 경로.
    for (const [route, raw] of Object.entries(saved)) { // D-82: 과거 일지·타임라인·다음 달 표시는 기존 단위 유지.
      const text = textOf(raw); // D-82: 실제 보이는 문자열을 검사.
      const expectedCost = costText(sign * 123.45, false);
      assert.ok(text.includes(', ' + expectedCost.slice(1, -1) + ')'), `${route} 옛 비용은 억·단독 적중은 쉼표 연결`); // D-82: 비용 값과 부호도 독립 계산.
      assert.ok(text.includes(`${sign < 0 ? '−' : '+'}123.5 MWh`), `${route} 옛 몫은 월 합계 MWh`); // D-82: 표시 반올림의 리터럴 기대값.
      assert.ok(!text.includes('억/일') && !text.includes('MWh/일'), `${route} 옛 월 합계에 하루 평균 꼬리말 없음`); // D-82: 과거 기록을 단위만 바꾸지 않음.
    } // D-82: 옛 표시 경로 검사 끝.
    storage.delete(teamKey); reset(); // D-82: 앞 합성 기록을 지우고 실제 사본·시험으로 현재 분해를 재계산.
    const previous = f.V.results.find(r => r.round === f.res.round - 1); // D-82: 지난달 공개 결과만 기대값 입력으로 사용.
    const trial = Object.values(JSON.parse(storage.get('kcp-build-trial-v1') || '{}'))[0]; // D-82: 저장 시험의 원래 형식과 일수를 읽음.
    const perDay = result => Math.max(0, result.team[id].isolated.uns - result.team[id].uns - result.team[id].imp + result.team[id].sub) / result.days; // D-82: 공개 보충량/대표 일수의 독립 산식.
    const base = basis === 'monthly' ? perDay(previous) : trial.gridMWh / trial.days; // D-82: 월 합계가 아닌 명세의 기준 하루 평균.
    const html = opened(f, old, evidenceCases[0]), replacement = session.outShownPending?.frozen; // D-82: 교체될 실제 표시 고정본 확인.
    assert.equal(replacement?.unit, 'MWh/일', '현재 결과는 새 하루 평균 고정본으로 교체'); // D-82: 옛 기록 재사용 금지.
    assert.ok(Math.abs(replacement.trial - base) <= 1e-9, '교체 분해의 독립 출발값'); // D-82: 기존 정밀도 유지.
    assert.ok(Math.abs(replacement.actual - perDay(f.res)) <= 1e-9, '교체 분해의 독립 도착값'); // D-82: 반환값을 기대값으로 복사하지 않음.
    assert.ok(textOf(html).includes('우리 도시가 바깥 계통에 기댄 전기에 닿는'), '옛 계통 고정본 교체 뒤 사건 문구도 계통 대상'); // D-82: (b)의 옛 기록 재표시 경로.
    assert.ok(!textOf(html).includes('우리 도시 정전에 닿는'), '교체 뒤 정전 문구 잔류 없음'); // D-82: (b) 혼용 금지.
    assert.deepEqual(old, before, '과거 월 합계 입력을 직접 변경하지 않음'); // D-82: 교체와 원본 변형을 구별.
  }); // D-82: 옛 계통 기록 검사 끝.
  check(`19 D-82 ${basis} target·unit 없는 옛 정전 기록`, () => { // D-82: 대상도 없던 옛 기록은 정전 표시를 유지.
    const old = partRecord(f, basis, 'uns', 30, { ...allZero, event: -12.34, weather: 1.23 }); // D-82: 옛 정전 입력.
    delete old.target; delete old.unit; // D-82: 원래 저장 형식의 누락 필드.
    old.clues.event = '우리 도시 정전에 닿는 사건 없음(해당 2건)'; // D-82: 짧은 사건 문구.
    old.clueMore.event = '우리 도시 정전에 닿는 효과 없음'; // D-82: 상세 사건 문구.
    const text = textOf(opened(f, old, evidenceCases[0], 'event')); // D-82: 실제 현재 대상이 계통이어도 고정본의 옛 대상 우선.
    assert.ok(text.includes('우리 도시 정전에 닿는 사건 없음(해당 2건)') && text.includes('우리 도시 정전에 닿는 효과 없음'), '옛 정전 단서 그대로'); // D-82: (b)의 정전 호환.
    assert.ok(!text.includes('우리 도시가 바깥 계통에 기댄 전기에 닿는') && !text.includes('(비용 '), '옛 정전에 계통 문구·비용 없음'); // D-82: (a)(b)의 옛 정전 호환.
  }); // D-82: 옛 정전 기록 검사 끝.
  // rev14b A1: 기존 1자리 경계는 기준 2로 옮기고 2자리 달의 0.01 경계도 별도로 고정한다.
  for (const base of [2, 0]) for (const sign of [-1, 1]) for (const row of (base === 2 ?
    [{ choice: 9.44, event: 9.43, tied: true }, { choice: 9.46, event: 9.44, tied: false }] :
    [{ choice: 9.444, event: 9.443, tied: true }, { choice: 9.446, event: 9.444, tied: false }])) {
    check(`20 D-82 ${basis}/base=${base}/${sign}/${row.choice} 표시 반올림 동점`, () => {
      const a = partRecord(f, basis, 'grid', base, { ...allZero, choice: sign * row.choice, event: -sign * row.event });
      const html = opened(f, a, evidenceCases[0], 'event'), first = firstVerdict(html); // D-82: 원시값이 작은 event를 선택.
      assert.ok(first.includes(displayedPartText(html, a, 'event')), '선택값은 폭포와 같은 배분 표시'); // spec-C §M5: 카드·폭포 값은 최대 나머지 표시, 동점 판정은 아래 원값 계약 유지.
      assert.ok(first.endsWith(row.tied ? ' · 크기가 같은 가장 큰 몫 중 하나예요' : ' · 몫은 있지만 가장 크지 않았어요'), '표시 눈금에서만 동점 판정'); // D-82: 원시값 비교 회귀 방지.
      const tagged = [...html.matchAll(/<button\b[^>]*data-missed="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)].filter(m => m[2].includes('data-out-tag="largest"')).map(m => m[1]); // D-82: 카드의 공동 최대 표식도 같은 기준.
      assert.deepEqual(tagged, row.tied ? ['choice', 'event'] : ['choice'], '반올림 동점 카드 표식'); // D-82: 첫 카드만 최대가 되는 회귀 방지.
      for (const [route, raw] of Object.entries(records(f, a, 'event'))) { // D-82: 기록의 판정도 같은 표시 눈금.
        const text = textOf(raw); // D-82: 보이는 기록 문자열.
        assert.equal(text.includes(tiedLabel), row.tied, `${route} 반올림 동점 기록 라벨`); // D-82: 원시 차이가 남아도 표시 같으면 동점.
        assert.ok(!text.includes(uniqueLabel), `${route} 작은 원시 몫을 단독 최대로 쓰지 않음`); // D-82: 반올림 동점과 단독 최대 구분.
      } // D-82: 기록 동점 검사 끝.
    }); // D-82: 반올림 동점 검사 끝.
  } // D-82: 부호·눈금 순회 끝.
  for (const base of [10, 0]) for (const replay of (base === 10 ?
    [.049999, .05, .050001, -.049999, -.05, -.050001] :
    [.004999, .005, .005001, -.004999, -.005, -.005001])) check(`21 D-82 ${basis}/base=${base}/${replay} 계통 재현 반 눈금`, () => {
    const a = partRecord(f, basis, 'grid', base, { ...allZero, choice: 2, event: -1 });
    a.replay = replay; // D-82: 정확한 경계값 직접 주입.
    if (basis === 'trial') { a.actual += replay; a.total += replay; } // D-82: 시험은 재현 포함 합계, 월간은 합계 밖 진단 유지.
    const html = opened(f, a, evidenceCases[0]), shown = Math.abs(replay) >= (base === 10 ? .05 : .005); // rev14b A2: 각 자릿수의 반 눈금.
    assert.equal(html.includes('id="lg-outage-replay"'), shown, '계통 재현 설명 경계'); // D-82: 양·음 경계 모두 정확 대조.
    assert.equal(html.includes('data-out-step="replay"'), basis === 'trial' && shown, '시험만 재현 폭포 줄, 월간은 합계 밖'); // D-82: 재현의 합계 위치 보존.
  }); // D-82: 계통 재현 경계 검사 끝.
  for (const base of [2, 0]) check(`rev14b A2 ${basis}/base=${base} 원인 빠진 옛 사본 합 가드`, () => {
    const a = partRecord(f, basis, 'grid', base, { ...allZero, event: .1234 });
    a.total = .5; a.actual = base + .5; // 빠진 원인 몫을 반올림 배분으로 메우면 안 된다.
    const before = clone(a), html = opened(f, a, evidenceCases[0], 'event');
    assert.equal(displayedPartText(html, a, 'event'), valueText(.1234, 'grid', a), '가드된 사본은 각자 반올림');
    assert.ok(!html.includes('id="lg-outage-round-note"'), '원인 누락을 표시 눈금 안내로 설명하지 않음');
    assert.deepEqual(a, before, '가드된 사본 원값 불변');
  });
} // D-82: 추가 계약 순회 끝.
// V8 N2: 원자료·params로 문턱과 표시값을 별도로 계산한다.
const param = k => D.params[k].v;
const ceilText = (threshold, target, a = { target }) => {
  const digits = displayDigits(a), scale = 10 ** digits;
  // 십진 지수 이동으로 0.07×100의 부동소수 오차를 피한다. 허용 오차는 두지 않는다.
  const [coefficient, exponent = '0'] = String(threshold).split('e');
  const shown = Math.ceil(Number(`${coefficient}e${Number(exponent) + digits}`)) / scale;
  return shown.toFixed(digits) + (target === 'grid' ? ' MWh/일' : '%p');
};
function thresholdBasis(a) {
  const delta = a.total ?? a.actual - (a.trial ?? a.base);
  const limit = ceilText(cardMin(a), a.target, a);
  const magnitude = valueText(Math.abs(delta), a.target, a).replace(/^\+/, '');
  const threshold = param('outageCardShareMin') * Math.abs(delta);
  // rev14b A1: 실제 비율 문턱도 해당 달의 표시 자릿수를 쓴다.
  const digits = displayDigits(a);
  const actual = threshold.toLocaleString('ko-KR', {
    minimumFractionDigits: a.target === 'grid' && digits === 2 ? 2 : 0, maximumFractionDigits: digits });
  const ceiling = Number(limit.replace(/ MWh\/일|%p|,/g, ''));
  const share = Number(actual.replaceAll(',', '')) === ceiling ?
    `5%(${limit})` : `5%(${actual}, 표시 눈금으로 올려 ${limit})`; // spec-C §M5b: 실제 문턱·올림값을 함께, 같으면 기존 단위 포함 한 값.
  return Number.isFinite(delta) && param('outageCardShareMin') * Math.abs(delta) > minPart(a)
    ? `차이 ${magnitude}의 ${share}` : `카드 최소 크기(${limit})`; // spec-C §M5b: 비율 문턱에만 실제·올림 설명 추가, 최소 크기 문구 유지.
}

// V7 A: 분해 입력은 저장 경계에서 합성하고, 기대 후보·문장은 계약에서 직접 정한다.
const cardKeys = html => [...html.matchAll(/data-missed="([^"]+)"/g)].map(m => m[1]);
const tags = html => [...html.matchAll(/<button\b[^>]*data-missed="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)]
  .filter(m => m[2].includes('data-out-tag="largest"')).map(m => m[1]);
check('V7 A 비율 파라미터 값·등급', () => {
  assert.ok(Object.hasOwn(D.params, 'outageCardShareMin'), '공개 params에 존재');
  assert.equal(D.params.outageCardShareMin.v, .05, '저장소 파라미터 value(v) = 5%');
  assert.equal(D.params.outageCardShareMin.grade, 'G', '게임 가정 등급');
});
for (const basis of ['trial', 'monthly']) for (const target of ['uns', 'grid']) {
  const f = fixture(basis, target), zero = Object.fromEntries((basis === 'monthly' ? monthlyKeys : trialKeys).map(k => [k, 0]));
  const record = values => partRecord(f, basis, target, 0, { ...zero, ...values });
  const render = (a, n = {}) => M.outageCardsHTML(f.V, f.res, id, { outageOpened: true, outageFrozen: a, ...n });
  for (const sign of [-1, 1]) for (const fallback of [false, true])
    check(`V7 A 4% 제외·6% 포함 ${basis}/${target}/${sign}/fallback=${fallback}`, () => {
      const a = record({ choice: sign * 90, weather: sign * 4, event: sign * 6 });
      if (fallback) delete a.total; // actual−trial을 쓰는 옛 고정본.
      const before = clone(a), html = render(a, { evidence: { key: 'wind', text: '풍속', value: 5 } });
      assert.deepEqual(cardKeys(html), ['choice', 'event'], '5%를 넘는 둘만 분해 순서로 표시');
      assert.ok(html.includes('data-single="false"'), '6% 몫이 있으므로 고르기 유지');
      assert.deepEqual(tags(html), ['choice'], '최대는 90% 몫 하나');
      assert.deepEqual(a, before, '분해 입력 불변');
      assert.ok(html.includes('data-out-step="weather" data-out-value="' + sign * 4 + '"'), '4%도 폭포 값 유지');
    });
  check(`V7 A total 우선·base 대체 ${basis}/${target}`, () => {
    const a = record({ choice: 90, weather: 4, event: 6 });
    a.actual = 900; // 저장된 total=100이 actual−trial보다 우선한다.
    assert.deepEqual(cardKeys(render(a)), ['choice', 'event']);
    delete a.total; a.base = a.trial; delete a.trial; a.actual = 100;
    assert.deepEqual(cardKeys(render(a)), ['choice', 'event'], 'total·trial 없으면 actual−base');
  });
  check(`V7 A 5% 경계 ${basis}/${target}`, () => {
    const html = render(record({ choice: 91, weather: 4, event: 5 }));
    assert.deepEqual(cardKeys(html), ['choice', 'event'], '정확히 5%는 포함');
  });
  check(`V7 A 고르기 생략 ${basis}/${target}`, () => {
    const a = record({ choice: 96, weather: 4 }), html = render(a);
    assert.deepEqual(cardKeys(html), [], '4%는 선택 후보가 아님');
    assert.ok(html.includes('data-single="true"') && firstVerdict(html) === '내가 고른 것: 고르기 생략');
    assert.ok(textOf(html).includes(`나머지 몫은 모두 ${thresholdBasis(a)} 이하라 고르기를 건너뛰어요`));
    assert.equal(session.outShownPending.largest.key, 'choice');
    for (const [route, raw] of Object.entries(records(f, a))) {
      const text = textOf(raw);
      assert.ok(text.includes(route === 'carry' ? '지난달 원인 고르기: 건너뜀' : '고르기 생략'), `${route} 생략 기록`);
      assert.ok(!text.includes(names(basis).weather + ' ' + valueText(4, target, a)), `${route} 4%를 최대처럼 기록하지 않음`);
    }
  });
  for (const edge of [.049, .05, .052]) check(`V7 A 작은 Δ 하한 ${basis}/${target}/${edge}`, () => {
    const a = record({ choice: edge, weather: .001 - edge }), html = render(a);
    assert.ok(Math.abs(a.total - .001) < 1e-12 && cardMin(a) === .05, '5%가 아주 작아도 minPart 유지');
    assert.equal(session.outShownPending.largest?.key || null, edge < .05 ? null : 'choice');
    assert.equal(textOf(html).includes('뚜렷한 원인 없음'), edge < .05, '하한 미만만 원인 없음');
    assert.equal(html.includes('data-single="true"'), edge <= .05, '두 번째 몫도 하한 이상일 때만 고르기');
    assert.deepEqual(cardKeys(html), edge > .05 ? ['choice', 'weather'] : []);
  });
  check(`V7 A 직접 연결·외 개수·기여 문장 ${basis}/${target}`, () => {
    const a = record({ choice: 90, weather: 4, event: 6 }); a.hasConnectedWind = true;
    const evidence = { key: 'wind', text: '풍속', value: 5 };
    const html = render(a, { evidence });
    assert.equal(summaryBody(html), `고른 근거 ‘풍속’ · 직접 연결 몫 사건·대응 ${valueText(6, target, a)}`, '4%는 외 n개에서도 제외');
    const b = record({ choice: 96, weather: 4 }); b.hasConnectedWind = true;
    const tiny = render(b, { evidence });
    assert.equal(summaryBody(tiny), '고른 근거 ‘풍속’ · 직접 연결 몫은 거의 0');
    assert.ok(textOf(tiny).includes('이 몫들은 이번 차이에 거의 기여하지 않았어요.'), 'minPart 이상인 4%도 기여 문장은 cardMin 판정');
    const c = record({ choice: 88, weather: 6, event: 6 }); c.hasConnectedWind = true;
    assert.equal(summaryBody(render(c, { evidence })), `고른 근거 ‘풍속’ · 직접 연결 몫 날씨·${basis === 'monthly' ? '계절·' : ''}운전 기간 ${valueText(6, target, c)} 외 1개`, '6% 둘은 외 1개로 집계');
  });
  check(`V7 A 고정본 4% 선택 보존 ${basis}/${target}`, () => {
    const a = record({ choice: 90, weather: 4, event: 6 }), before = clone(a);
    const html = render(a, { missed: 'weather' });
    assert.deepEqual(cardKeys(html), ['choice', 'weather', 'event']);
    assert.match(html, /data-missed="weather" aria-pressed="true"/);
    assert.ok(firstVerdict(html).endsWith(' · 이번 차이에 거의 기여하지 않았어요'));
    assert.deepEqual(tags(html), ['choice'], '고른 4%를 최대로 인정하지 않음');
    for (const [route, raw] of Object.entries(records(f, a, 'weather'))) {
      const text = textOf(raw);
      assert.ok(text.includes(`${route === 'carry' ? '지난달 내가 고른 원인' : '내가 고른 원인'}: ${names(basis).weather}`), `${route} 작은 선택 이름 유지`);
      assert.ok(!text.includes(uniqueLabel) && !text.includes(tiedLabel), `${route} 작은 선택 최대 판정 없음`);
    }
    assert.deepEqual(a, before, '선택을 유지해도 분해 값 불변');
  });
  for (const effect of [.049, .05, 4]) check(`V7 A 접속 상자는 minPart ${basis}/${target}/${effect}`, () => {
    const a = record({ choice: 94, event: 6 }); a.grid = { waitingMW: 12, value: effect };
    const html = render(a);
    assert.equal(html.includes('id="lg-outage-grid-bottleneck"'), effect >= .05, '5%보다 작은 반사실도 minPart 이상이면 표시');
    assert.equal(html.includes('id="lg-outage-grid-small"'), effect < .05);
    if (effect < .05) assert.ok(textOf(html).includes(`효과 ${target === 'grid' ? '0.05 MWh/일' : '0.05%p'} 이하`), '효과 이하 문구도 minPart'); // rev14b A1: 기준 0인 계통 달은 2자리.
    if (effect >= .05) assert.ok(html.includes(`data-out-grid="${effect}"`), '반사실 원시값 유지');
  });
  for (const replay of (target === 'grid' ? [.0049, .005, .049, .05] : [.0049, .005]))
    check(`V7 A 재현 기존 눈금 ${basis}/${target}/${replay}`, () => {
      const a = record({ choice: 94, event: 6 }); a.replay = replay;
      if (basis === 'trial') { a.total += replay; a.actual += replay; }
      const html = render(a), shown = replay >= .005; // rev14b A2: 기준 0인 2자리 달도 반 눈금은 0.005.
      assert.equal(html.includes('id="lg-outage-replay"'), shown, '재현 표시 눈금에 5%를 적용하지 않음');
      assert.equal(html.includes('data-out-step="replay"'), shown && basis === 'trial', '폭포 재현 위치 유지');
    });
  if (basis === 'trial') check(`V7 A 최대·공동 최대에도 5% ${target}`, () => {
    const a = record({ choice: 1.004, event: .999 });
    a.total = 20; a.actual = 20; a.replay = 20 - 1.004 - .999;
    // 둘은 같은 표시 크기지만 event는 cardMin=1보다 작다.
    const html = render(a);
    assert.deepEqual(clone(session.outShownPending.largest), { key: 'choice', value: 1.004 });
    assert.ok(!textOf(html).includes('크기 같음') && !textOf(html).includes('크기가 같은 가장 큰 몫'));
    for (const [route, raw] of Object.entries(records(f, a))) {
      const text = textOf(raw);
      assert.ok(text.includes(route === 'carry' ? '지난달 원인 고르기: 건너뜀' : '고르기 생략') && text.includes(names(basis).choice), `${route} 문턱 이상 최대만 기록`);
      assert.ok(!text.includes(tiedLabel), `${route} 문턱 미만 반올림 동률은 공동 최대 아님`);
    }
  });
  // 재현이 합계 대부분인 시험 기록: 원인 모두 minPart 이상이어도 Δ의 5% 미만이다.
  if (basis === 'trial') check(`V7 A 원인 없음 5% ${target}`, () => {
    const a = record({ choice: 4, weather: 4, event: 4, trade: 4 });
    a.total = 100; a.actual = 100; a.replay = 84;
    const html = render(a);
    assert.ok(html.includes('data-single="true"') && textOf(html).includes('뚜렷한 원인 없음'));
    assert.equal(session.outShownPending.largest, null); assert.deepEqual(tags(html), []);
    for (const [route, raw] of Object.entries(records(f, a))) {
      const text = textOf(raw);
      assert.ok(text.includes('뚜렷한 원인 없음'), `${route} 원인 없음 기록`);
      assert.ok(!text.includes('가장 큰 몫'), `${route} 최대 기록 없음`);
    }
  });
}
// S7 '같음' 첫 줄 계약. 실제 공개 결과를 합성하며 판정 함수를 기대값으로 쓰지 않는다.
// 정전 ±.5 미만, 계통 max(.05 MWh/일, 기준의 5%) 이하를 직접 지정한다.
function sameParagraph(topic, basis, days) {
  // 기준 이름은 하네스 입력과 계약만으로 계산한다. 제품의 이름·조사 함수는 호출하지 않는다.
  const baselineLabel = basis === 'monthly' ? '지난달 대비' :
    days > 0 && days !== 7 ? `시험 ${days}일 대비` : '시험 1주 대비';
  const baseline = baselineLabel.replace(/ 대비$/, '');
  const particle = (baseline.charCodeAt(baseline.length - 1) - 0xac00) % 28 ? '과' : '와';
  return `<p id="lg-outage-same">실제로는 ${topic === 'grid' ? '바깥 계통에 기댄 전기가' : '정전이'} ${baseline}${particle} 거의 같았어요(판정: 같음).</p>`;
}
for (const topic of ['uns', 'grid']) {
  const original = fixture('monthly', topic);
  const rows = [
    { label: '같음·예측은 늘 것', delta: 0, show: true },
    { label: '늘 달·예측은 같을 것', delta: topic === 'grid' ? 5.001 : .5, show: false },
    { label: '줄 달·예측은 같을 것', delta: topic === 'grid' ? -5.001 : -.5, show: false },
    { label: '양의 같음 경계', delta: topic === 'grid' ? 5 : .499, show: true },
    { label: '음의 같음 경계', delta: topic === 'grid' ? -5 : -.499, show: true },
    { label: '약속 없는 달·근거 없음', delta: 0, omit: 'evidence', show: false },
    { label: '약속 없는 달·방향 없음', delta: 0, omit: 'pred', show: false },
    { label: '건너뛴 달', delta: 0, skipped: true, show: false },
    { label: '주제 전환 안내보다 앞', delta: 0, target: topic === 'grid' ? 'uns' : 'grid', show: true },
    { label: '분해 없는 대체 화면', delta: 0, fallback: true, show: true },
    ...(topic === 'grid' ? [
      { label: '0 기준 하한과 같음', base: 0, delta: .05, show: true },
      { label: '0 기준 하한 초과', base: 0, delta: .050001, show: false }
    ] : [])
  ];
  for (const row of rows) check(`22 S7 첫 줄 ${topic}/${row.label}`, () => {
    reset();
    const V = clone(original.V), res = V.results.at(-1), previous = V.results.find(r => r.round === res.round - 1);
    session.snap = V;
    const base = row.base ?? (topic === 'grid' ? 100 : 10);
    previous.team[id].unsPct = topic === 'uns' ? base : 0;
    res.team[id].unsPct = topic === 'uns' ? base + row.delta : 0;
    // 대표 기간을 달리 해도 하루 평균으로 비교한다. 월 합계 비교 회귀도 검출한다.
    previous.days = 31; res.days = 28;
    for (const [r, daily] of [[previous, base], [res, base + row.delta]]) {
      r.team[id].uns = 0; r.team[id].imp = 0; r.team[id].sub = 0;
      r.team[id].isolated.uns = daily * r.days;
    }
    const f = { V, res }, target = row.target || topic;
    const a = frozen(f, 'monthly', target);
    a.grid = { waitingMW: 12, value: 20 }; // 접속 대기 상자를 반드시 렌더할 크기.
    const n = { topic, evidence: { key: 'grid', text: '접속 여유', value: 100 },
      pred: { [topic]: row.show ? 'up' : 'same' }, skipped: !!row.skipped,
      outageOpened: true, outageFrozen: a, missed: 'trade' };
    if (row.omit) delete n[row.omit];
    if (row.fallback) {
      storage.clear(); delete n.outageFrozen;
      assert.equal(M.outageAttribution(V, res, id, n), null, '실제로 분해 없음');
    }
    const before = clone(n), html = M.outageCardsHTML(V, res, id, n);
    assert.equal((html.match(/\bid="lg-outage-same"/g) || []).length, row.show ? 1 : 0, '실제 방향·약속·건너뜀에 따른 유무');
    assert.deepEqual(n, before, '분해 수치·입력 기록 불변');
    if (row.fallback) assert.match(html, /<h4>무엇을 놓쳤나<\/h4>/, '대체 화면 경로');
    else {
      assert.match(html, /id="lg-outage-grid-bottleneck"/, '접속 대기 상자가 있는 위치 검사');
      assert.match(html, /id="lg-outage-baseline"/, '비교 기준 문장 존재');
      assert.match(html, /id="lg-outage-cards"/, '원인 카드 보존');
      assert.match(html, /data-out-step=/, '공개 폭포 보존');
    }
    if (row.show) {
      assert.equal(html.match(/<h4>[^<]*<\/h4>\s*(<p id="lg-outage-same">[^<]*<\/p>)/)?.[1], sameParagraph(topic, 'monthly'),
        'h4 바로 다음 요소가 정확한 같음 문장');
      assert.ok(html.includes(' 지난달과 거의 같았어요(판정: 같음).'), '지난달은 받침이 있어 과');
      for (const marker of ['id="lg-outage-grid-bottleneck"', 'id="lg-outage-baseline"', '이번 달은 실제 정전이 생겨', '이번 달은 비교하는 두 결과 모두'])
        if (html.includes(marker)) assert.ok(html.indexOf('id="lg-outage-same"') < html.indexOf(marker), `${marker}보다 앞`);
      if (row.target) assert.ok(html.includes(topic === 'grid' ? '이번 달은 실제 정전이 생겨' : '이번 달은 비교하는 두 결과 모두'), '실제 주제 전환 안내 경로');
      const skippedHTML = M.outageCardsHTML(V, res, id, { ...n, skipped: true });
      assert.equal(html.replace(sameParagraph(topic, 'monthly'), ''), skippedHTML, '첫 줄 추가 외 분해 값·카드·폭포 HTML 동일');
    }
  });
}
for (const topic of ['uns', 'grid']) for (const row of [
  { days: 7, name: '시험 1주', ending: '시험 1주와' },
  { days: 30, name: '시험 30일', ending: '시험 30일과' }
]) check(`V7 D 첫 달 ${row.name}/${topic}`, () => {
  const f = fixture('trial', topic), V = clone(f.V), res = V.results.at(-1), r = res.team[id];
  assert.equal(V.round, 1); assert.equal(V.results.length, 1);
  r.unsPct = topic === 'uns' ? 10 : 0;
  r.uns = 0; r.imp = 0; r.sub = 0; r.isolated.uns = 100 * res.days;
  session.snap = V;
  const n = { topic, confirmed: true, evidence: { key: 'grid', text: '접속 여유', value: 100 },
    pred: { [topic]: 'up' }, trial: { days: row.days, unsPct: 10, gridMWh: 100 * row.days },
    outageOpened: true, outageFrozen: frozen({ V, res }, 'trial', topic), missed: 'trade' };
  const html = M.outageCardsHTML(V, res, id, n);
  const paragraph = html.match(/<h4>[^<]*<\/h4>\s*(<p id="lg-outage-same">[^<]*<\/p>)/)?.[1];
  assert.equal(paragraph, sameParagraph(topic, 'trial', n.trial.days), '시험 기간으로 계산한 기준 이름·조사·주어');
  assert.ok(paragraph.includes(` ${row.ending} 거의 같았어요(판정: 같음).`), '7일·30일의 정확한 이름과 와·과');
  assert.equal((html.match(/id="lg-outage-same"/g) || []).length, 1);
  assert.equal(html.replace(sameParagraph(topic, 'trial', n.trial.days), ''), M.outageCardsHTML(V, res, id, { ...n, skipped: true }));
});
// V8 N1: S1과 클릭 값의 방향이 반대인 원기록. 반환 판정을 기대값에 쓰지 않는다.
const n1f = fixture('monthly', 'uns');
n1f.V.results.find(r => r.round === n1f.res.round - 1).team[id].unsPct = 10;
n1f.res.team[id].unsPct = 12;
n1f.V.results.at(-1).team[id].unsPct = 12;
session.snap = n1f.V;
const n1parts = Object.fromEntries(monthlyKeys.map(k => [k, 0]));
for (const row of [
  { name: 'S1 값끼리 비교', key: 'evening', start: 120, before: { s1EvidenceValues: { evening: 100 }, evidenceValues: { evening: 150 } }, click: 80, same: true },
  { name: 'S1 감소·클릭 증가는 다른 방향', key: 'evening', start: 80, before: { s1EvidenceValues: { evening: 100 }, evidenceValues: { evening: 50 } }, click: 120, same: false },
  { name: '옛 기록 evidenceValues 대체', key: 'evening', before: { evidenceValues: { evening: 100 }, evidence: { key: 'evening', value: 150 } }, click: 120, same: true },
  { name: '옛 기록 evidence.value 대체', key: 'evening', before: { evidence: { key: 'evening', value: 100 } }, click: 120, same: true },
  { name: '새 현재·옛 지난달 대체', key: 'evening', start: 120, before: { evidenceValues: { evening: 100 } }, click: 80, same: true },
  { name: '옛 현재·새 지난달 우선', key: 'evening', before: { s1EvidenceValues: { evening: 100 }, evidenceValues: { evening: 150 } }, click: 120, same: true },
  { name: '같은 이웃은 S1 값 비교', key: 'neighbor', start: 20, before: { s1EvidenceValues: { neighbor: 10 }, s1EvidenceNeighborId: 'dangjin' }, click: 5, same: true },
  { name: '이웃 id 다르면 비교 안 함', key: 'neighbor', start: 20, before: { s1EvidenceValues: { neighbor: 10 }, s1EvidenceNeighborId: 'asan', evidenceValues: { neighbor: 5 } }, click: 30, reason: '지난달 값이 없어 비교하지 않아요' },
  { name: '변화 눈금 미만', key: 'evening', start: 100.001, before: { s1EvidenceValues: { evening: 100 } }, click: 200, reason: '근거 변화가 비교 눈금보다 작아 비교하지 않아요' },
  { name: '접속 여유는 비교 안 함', key: 'grid', start: 3.65, before: { s1EvidenceValues: { grid: 1 } }, click: 7.65, reason: '접속 여유는 이번 달 새 접속을 처리하기 전 값이라 결과와 방향을 비교하지 않아요' },
  { name: '풍력 없음은 비교 안 함', key: 'wind', start: 5, before: { s1EvidenceValues: { wind: 10 } }, click: 20, reason: '우리 도시에 접속된 풍력 설비가 없어 풍속과 결과의 방향을 비교하지 않아요' },
  { name: '풍력 접속 자료 없는 옛 기록', key: 'wind', start: 5, before: { s1EvidenceValues: { wind: 10 } }, click: 20, noWindInfo: true, reason: '이번 달 풍력 접속 자료를 계산하지 못해 풍속과 결과의 방향을 비교하지 않아요' },
  { name: 'LNG 비용 효과만 유지', key: 'fuel', start: 120, before: { s1EvidenceValues: { fuel: 100 } }, click: 80, reason: 'LNG 지수는 비용으로만 영향을 주어 이번 대상(정전)과 방향을 비교하지 않아요' } // 아르곤 문구(UX 갈래) 화면 문구를 따름
]) check(`V8 N1 S6·S7 ${row.name}`, () => {
  reset();
  const cause = row.key === 'neighbor' ? 'trade' : row.key === 'grid' ? 'progress' : row.key === 'fuel' ? 'growth' : 'weather';
  const a = partRecord(n1f, 'monthly', 'uns', 10, { ...n1parts, [cause]: 8, event: 1 });
  if (!row.noWindInfo) a.hasConnectedWind = false;
  const n = { topic: 'uns', evidence: { key: row.key, text: '합성 근거', value: row.click, nowValue: row.click },
    pred: { uns: 'up' }, outageOpened: true, outageFrozen: a, missed: cause,
    ...(row.start === undefined ? {} : { s1EvidenceValues: { [row.key]: row.start }, s1EvidenceNeighborId: 'dangjin' }) };
  storage.set(teamKey, JSON.stringify({ interview: { months: { [n1f.res.round - 1]: row.before, [n1f.res.round]: n } } }));
  const before = clone(n);
  const s6 = textOf(U.__promiseResultHTML(n1f.V, n)), s7 = textOf(evidenceBlock(M.outageCardsHTML(n1f.V, n1f.res, id, n)));
  // rev9 R5: S1 값 비교의 부호를 유지하며 K2/K3의 근거·예상·실제를 모두 검사.
  const keyName = {evening:'저녁 수요',neighbor:'이웃 정전'}[row.key];
  const beforeValue = row.before.s1EvidenceValues?.[row.key] ?? row.before.evidenceValues?.[row.key] ?? row.before.evidence?.value;
  const arrow = (row.start ?? row.click) > beforeValue ? '↑' : '↓';
  const expectedDirection = row.reason || `${keyName} ${arrow} → 정전 ${arrow} 쪽 예상 · 실제 정전 ↑ → 근거가 가리킨 쪽과 ${row.same ? '같음' : '반대'}(게임 안 단순 비교)`;
  assert.ok(s6.includes('고른 근거도 같은 쪽으로 움직였나요: ' + expectedDirection), s6);
  const tail = row.reason ? `고른 근거가 가장 큰 몫(${names('monthly')[cause]})과 같은 이야기예요.` :
    row.same ? '고른 근거는 이번 차이의 가장 큰 몫과도 이어져요.' : '고른 근거가 가리키는 방향과 가장 큰 몫의 부호는 반대예요. 이 근거만으로 이번 차이의 방향을 설명하기는 어려워요.';
  // LNG는 간접 연결이므로 방향 판정 대신 다음 근거 안내를 유지한다.
  assert.ok(s7.includes(row.key === 'fuel' ? '다음에는 주민·산업 수요 변화와 운영 당시 연료 지수도 근거로 살펴봐요.' : row.key === 'wind' ? '다음에는 지난달과 이번 달의 날씨·계절·운전 기간도 근거로 살펴봐요.' : tail), s7);
  assert.deepEqual(n, before, '읽기는 기록 불변');
});
for (const stage of ['s6', 's7']) for (const row of [
  { name: '3.65 → 7.65', value: 3.65, nowValue: 7.65, expected: '7.65' },
  { name: 'nowValue 없으면 evidence.value', value: 7.65, expected: '7.65' },
  { name: '두 자리 같음', value: 3.65, nowValue: 3.654 },
  { name: '정확히 같음', value: 3.65, nowValue: 3.65 },
  { name: '두 자리 다름', value: 3.65, nowValue: 3.656, expected: '3.66' },
  { name: '옛 기록은 줄 없음', value: 7.65, legacy: true }
]) check(`V8 N1 덧붙임 ${stage}/${row.name}`, () => {
  const a = partRecord(n1f, 'monthly', 'uns', 10, { ...n1parts, choice: 8, event: 1 });
  const n = { topic: 'uns', evidence: { key: 'grid', text: '접속 여유', value: row.value,
    ...(row.nowValue === undefined ? {} : { nowValue: row.nowValue }) }, pred: { uns: 'up' },
    outageOpened: true, outageFrozen: a, missed: 'choice', ...(row.legacy ? {} : { s1EvidenceValues: { grid: 3.65 } }) };
  const html = stage === 's6' ? U.__promiseResultHTML(n1f.V, n) : M.outageCardsHTML(n1f.V, n1f.res, id, n);
  const lines = [...html.matchAll(new RegExp(`<p\\b[^>]*id="lg-evidence-now-${stage}"[^>]*>([\\s\\S]*?)<\\/p>`, 'g'))];
  assert.equal(lines.length, row.expected ? 1 : 0, '계약 id 유일·같으면 없음');
  if (row.expected) assert.equal(textOf(lines[0][1]), `계획 시작(S1) 3.65 → 약속 때 ${row.expected} MW(계획 변경·${stage === 's6' ? '달마다 시작 값끼리 비교' : '원인 연결은 시작 값 기준'})`);
});

let randomSeed = 0x813bd;
const random = () => ((randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
for (const target of ['grid', 'uns']) {
  const f = fixture('trial', target), zero = Object.fromEntries(trialKeys.map(k => [k, 0]));
  for (const mode of ['원인 없음', '고르기 건너뜀', '접속 대기']) check(`V8 N2 ${target}/${mode} 무작위·경계 124개`, () => {
    const thresholds = [.1237, .16, .1, .07, ...Array.from({ length: 120 }, () => .05 + random() * 4)];
    for (const threshold of thresholds) {
      // T: 비율 문구와 접속 최소 몫 검사를 분리해 우연한 실수 동률을 만들지 않는다.
      const base = target === 'grid' && mode === '접속 대기' ? threshold * param('outageMinPartDivisor') / param('gridSameSharePerDay') : 0;
      const a = partRecord(f, 'trial', target, base, zero);
      // cardMin은 total의 5%, 접속 대기는 minPart. 정전 minPart는 고정 상수이다.
      const limit = mode === '접속 대기' ? (target === 'grid' ? threshold : param('outageMinUnsPart')) : threshold;
      if (mode !== '접속 대기') { a.total = threshold / param('outageCardShareMin'); a.actual = base + a.total; }
      const below = limit * (.95 + .049999 * random());
      a.parts = trialKeys.map(key => ({ key, value: key === 'choice' && mode === '고르기 건너뜀' ? a.total : key === 'weather' ? below : 0 }));
      a.grid = { waitingMW: 12, value: mode === '접속 대기' ? below : 0 };
      const html = M.outageCardsHTML(f.V, f.res, id, { outageOpened: true, outageFrozen: a });
      const text = textOf(html), expected = ceilText(limit, target, a);
      assert.ok(text.includes(mode === '접속 대기' ? `접속 대기 12 MW(효과 ${expected} 이하)` :
        mode === '원인 없음' ? `네 원인의 몫이 모두 이번 ${thresholdBasis(a)} 이하라, 바뀐 조건 하나하나는` :
          `네 원인 중 나머지 몫은 모두 ${thresholdBasis(a)} 이하라 고르기를 건너뛰어요`), `${mode}/${threshold}: ${text}`);
      const displayedPart = displayedPartText(html, a, 'weather'); // spec-C §M5: 날씨도 독립 반올림 대신 배분 눈금·형식 검증.
      const limitId = mode === '접속 대기' ? 'lg-outage-grid-small' : 'lg-outage-single';
      const paragraph = textOf(html.match(new RegExp(`<p[^>]*id="${limitId}"[^>]*>([\\s\\S]*?)<\\/p>`))?.[1] || '');
      const displayedLimit = paragraph.match(/([\d,.]+)(?: MWh\/일|%p)\)? 이하/)?.[1];
      assert.ok(displayedLimit, '해당 화면 문장의 문턱 숫자를 직접 읽음');
      const shown = Math.abs(parseFloat(displayedPart.replace('−', '-').replaceAll(',', '')));
      assert.ok(shown <= Number(displayedLimit.replaceAll(',', '')), `화면 반올림 몫 ${shown} ≤ 화면 올림 문턱 ${displayedLimit}`);
      assert.deepEqual(cardKeys(html), [], '표시 문턱만 올리고 카드 판정 문턱 유지');
    }
  });
  check(`V8 N2 ${target} 판정 경계 그대로`, () => {
    const a = partRecord(f, 'trial', target, 0, { ...zero, choice: .05, event: .05 });
    assert.deepEqual(cardKeys(M.outageCardsHTML(f.V, f.res, id, { outageOpened: true, outageFrozen: a })), ['choice', 'event']);
    a.parts.find(p => p.key === 'event').value = .049999;
    assert.deepEqual(cardKeys(M.outageCardsHTML(f.V, f.res, id, { outageOpened: true, outageFrozen: a })), []);
  });
}
check('V8 N2 예시 0.1237·0.1207·0.16', () => {
  assert.equal(ceilText(.1237, 'grid'), '0.2 MWh/일');
  assert.equal(valueText(.1207, 'grid'), '+0.1 MWh/일');
  assert.equal(valueText(.16, 'grid'), '+0.2 MWh/일');
  const f = fixture('trial', 'grid');
  const a = partRecord(f, 'trial', 'grid', 24.74, { choice: .16, weather: .1207, event: 0, trade: 0 });
  const text = textOf(M.outageCardsHTML(f.V, f.res, id, { outageOpened: true, outageFrozen: a }));
  assert.ok(text.includes('나머지 몫은 모두 카드 최소 크기(0.2 MWh/일) 이하라') && text.includes('+0.1 MWh/일') && text.includes('+0.2 MWh/일'), text);
});

// T F3: 생략 문구의 서술어는 원인 이름의 받침을 따른다(옛 withParticle 규칙 유지, 독립 검토 minor 3·총괄 갈래 결정):
// '사건·대응'(받침 있음) → 이에요, '이웃 거래'(받침 없음) → 예요.
for (const [cause, ending] of [['event', '이에요'], ['trade', '예요']]) check(`V8 문구 13 ${cause}/${ending}`, () => {
  const f = fixture('trial', 'grid'), zeros = Object.fromEntries(trialKeys.map(k => [k, 0]));
  const a = partRecord(f, 'trial', 'grid', 0, { ...zeros, [cause]: 12.34 });
  const cost = Number((12.34 * param('normalCost') * param('gridImportMarkup')).toFixed(2)).toFixed(2);
  const expected = `이번 차이의 가장 큰 몫은 ${names('trial')[cause]}(+12.34 MWh/일, 비용 +${cost}억/일)${ending}. 네 원인 중 나머지 몫은 모두 ${thresholdBasis(a)} 이하라 고르기를 건너뛰어요.`; // rev14b A1: 기준 0, 2자리 달.
  const html = M.outageCardsHTML(f.V, f.res, id, { outageOpened: true, outageFrozen: a });
  assert.ok(textOf(html).includes(expected), textOf(html));
});

// 문구 14: 원자료로 만든 문장 전체를 대조하고, 물리 정렬·70자 포함 경계를 검산한다.
const climateInput = { demand: 11.25, peakDemand: 20, renPerDay: 0, hotDays: 0 };
for (const row of [
  { name: '모두 같음', after: {}, season: 'winter', body: '같음: 평균 수요 11.25 MW · 재생 공급 없음 · 무더위 0일 · 계절 겨울' },
  { name: '일부 같음', after: { demand: 12.1 }, season: 'winter', body: '평균 수요 11.25 → 12.1 MW · 같음: 재생 공급 없음 · 무더위 0일 · 계절 겨울' },
  { name: '모두 다름', after: { demand: 12.1, renPerDay: 24, hotDays: 2 }, season: 'summer', body: '하루 재생 공급량 0 → 24 MWh/일(이전 값 0) · 평균 수요 11.25 → 12.1 MW · 무더위 0 → 2일 · 계절 겨울 → 여름' },
  { name: '재생 변화 우선·같음 묶음 물리 순서', before: { renPerDay: 24 }, after: { demand: 11.25001, renPerDay: 24.001 }, season: 'winter', body: '같음: 하루 재생 공급량 24 MWh/일 · 평균 수요 11.25 MW · 무더위 0일 · 계절 겨울' }
]) check(`V8 문구 14 ${row.name}`, () => {
  const before = { ...climateInput, ...row.before }, after = { ...before, ...row.after };
  const withTail = row.body + ' · 자세한 값은 단서 더 보기';
  const expected = withTail.length <= 70 ? withTail : row.body;
  assert.equal(require('./v8-weather-contract')({ ...before, renewable: before.renPerDay }, { ...after, renewable: after.renPerDay },
    { season: 'winter', days: 30 }, { season: row.season, days: 30 }), expected, '30·32용 독립 기대값도 손계산 예제와 일치');
  assert.equal(U.__weatherClue(before, after, 'winter', row.season, 30, 30, true).short, expected);
});
for (const length of [70, 71]) check(`V8 문구 14 꼬리말 ${length}자 경계`, () => {
  let sample;
  for (const demand of [1, 11, 111, 1111, 11111, 111111, 1.25, 11.25, 111.25, 1111.25, 11111.25, 111111.25])
    for (const renPerDay of [0, 1, 12, 123]) for (const hotDays of [0, 10]) {
      const number = (v, d) => v.toLocaleString('ko-KR', { maximumFractionDigits: d });
      const body = `같음: 평균 수요 ${number(demand, 2)} MW · ${renPerDay ? `하루 재생 공급량 ${number(renPerDay, 1)} MWh/일` : '재생 공급 없음'} · 무더위 ${hotDays}일 · 계절 겨울`;
      const full = body + ' · 자세한 값은 단서 더 보기';
      if (full.length === length) sample = { input: { ...climateInput, demand, renPerDay, hotDays }, body, full };
    }
  assert.ok(sample, '정확한 길이의 독립 입력 존재');
  const result = U.__weatherClue(sample.input, sample.input, 'winter', 'winter', 30, 30, true);
  assert.equal(result.short, length === 70 ? sample.full : sample.body);
});

// 문구 1·2·3·4·12: 전체 문장과 숫자·단위·이름을 원자료/params로 검산한다.
for (const target of ['uns', 'grid']) check(`V8 문구 1·3·4 ${target} 단독 적중 기록·끝 범례`, () => {
  const f = fixture('trial', target), zero = Object.fromEntries(trialKeys.map(k => [k, 0]));
  const a = partRecord(f, 'trial', target, 0, { ...zero, event: 12.34, choice: 2 });
  const money = target === 'grid' ? `, 비용 +${(12.34 * param('normalCost') * param('gridImportMarkup')).toFixed(2)}억/일` : '';
  const part = valueText(12.34, target, a), name = names('trial').event;
  const record = records(f, a, 'event');
  assert.equal(textOf(record.carry), `지난달 내가 고른 원인: ${name} · 실제 가장 큰 몫과 같음(${name} ${part}${money})`);
  for (const route of ['journal', 'timeline']) assert.ok(textOf(record[route]).includes(
    `내가 고른 원인: ${name} · 실제 가장 큰 몫과 같음(${part}${money})`), route);
  assert.ok(textOf(record.timeline).includes('원 = 원인 나누기 결과'));
});
for (const legacy of [false, true]) check(`V8 문구 2 ${legacy ? '이름 없는 옛 기록' : '고르기 건너뜀'}`, () => {
  const f = fixture('trial', 'grid'), zero = Object.fromEntries(trialKeys.map(k => [k, 0]));
  const a = partRecord(f, 'trial', 'grid', 0, { ...zero, event: 12.34 });
  const money = `, 비용 +${(12.34 * param('normalCost') * param('gridImportMarkup')).toFixed(2)}억/일`;
  const expected = `지난달 원인 고르기: 건너뜀(가장 큰 몫 ${names('trial').event} ${valueText(12.34, 'grid', legacy ? { target: 'grid' } : a)}${money})`; // rev14b A1: 기준 없는 옛 carry는 1자리 유지.
  if (legacy) storage.set(teamKey, JSON.stringify({ interview: { months: { [f.res.round]: {
    outageSingleShown: true, missedCarry: { basis: 'trial', target: 'grid', unit: 'MWh/일', missed: '이름 없는 옛 기록', largest: { key: 'event', value: 12.34 } }
  } } } }));
  const carry = legacy ? U.__carryHTML({ ...f.V, round: f.res.round + 1 }) : records(f, a).carry;
  assert.equal(textOf(carry), expected);
});
for (const basis of ['trial', 'monthly']) check(`V8 문구 12 ${basis} 원인 없음 문장`, () => {
  const f = fixture(basis, 'grid'), keys = basis === 'monthly' ? monthlyKeys : trialKeys;
  const a = partRecord(f, basis, 'grid', 10, Object.fromEntries(keys.map(k => [k, 0])));
  const html = M.outageCardsHTML(f.V, f.res, id, { outageOpened: true, outageFrozen: a });
  const sentence = textOf(html.match(/<p id="lg-outage-single">([\s\S]*?)<\/p>/)?.[1] || '');
  const expected = `${basis === 'monthly' ? '지난달' : '시험'} 10.0 MWh/일 → ${basis === 'monthly' ? '이번 달' : '실제'} 10.0 MWh/일로 거의 같아요. ${keys.length === 6 ? '여섯' : '네'} 원인의 몫이 모두 ${thresholdBasis(a)} 이하라, 바뀐 조건 하나하나는 바깥 계통에 기댄 전기를 거의 바꾸지 않았어요.`;
  assert.equal(sentence, expected);
});

// T F3: 차이의 부호·네/여섯 원인·최소 몫 동률/누락을 명세로 고정한다.
for (const basis of ['trial', 'monthly']) for (const target of ['grid', 'uns']) {
  for (const edge of ['negative', 'equal', 'minimum', 'unknown']) for (const noCause of [false,true]) check(`T S7 부호·기준 문구 ${basis}/${target}/${edge}/noCause=${noCause}`, () => {
    const f = fixture(basis,target), keys = basis === 'trial' ? trialKeys : monthlyKeys;
    const values = Object.fromEntries(keys.map(k => [k, 0]));
    const total = edge === 'negative' ? -100 : edge === 'equal' ? 1 : .2;
    const a = partRecord(f,basis,target,0,{...values,choice:total});
    if (noCause) a.parts.forEach(p => { p.value = 0; });
    if (edge === 'unknown') { delete a.total; delete a.actual; delete a.trial; delete a.base; }
    const html = M.outageCardsHTML(f.V,f.res,id,{outageOpened:true,outageFrozen:a});
    const count = basis === 'trial' ? '네' : '여섯';
    const limit = target === 'grid' ? (edge === 'negative' ? '5.00 MWh/일' : edge === 'unknown' ? '0.1 MWh/일' : '0.05 MWh/일') : (edge === 'negative' ? '5.00%p' : '0.05%p'); // rev14b A1: 기준이 유한한 0이면 2자리, 누락이면 1자리.
    const magnitude = target === 'grid' ? '100.00 MWh/일' : '100.00%p';
    const reason = edge === 'negative' ? `차이 ${magnitude}의 5%(${limit})` : `카드 최소 크기(${limit})`;
    const sentence = noCause ? `${count} 원인의 몫이 모두 ${edge === 'negative' ? '이번 ' : ''}${reason} 이하라, 바뀐 조건 하나하나는 ${target === 'grid' ? '바깥 계통에 기댄 전기를' : '정전을'} 거의 바꾸지 않았어요` :
      `${count} 원인 중 나머지 몫은 모두 ${reason} 이하라 고르기를 건너뛰어요`;
    assert.ok(textOf(html).includes(sentence), textOf(html));
    assert.ok(!textOf(html).includes('차이 −'), '차이는 부호 없는 절댓값');
  });
}
// 명세 A2: 접속 여유·내 선택 최대는 같은 단계와 다음 근거 안내만 남긴다.
check('A2 접속 여유→내 선택 최대의 S7 꼬리', () => {
  const a = partRecord(n1f, 'monthly', 'uns', 10, { ...n1parts, choice: 8, event: 1 });
  const n = { topic: 'uns', evidence: { key: 'grid', text: '접속 여유', value: 3.65 },
    pred: { uns: 'up' }, outageOpened: true, outageFrozen: a, missed: 'choice' };
  const text = textOf(evidenceBlock(M.outageCardsHTML(n1f.V, n1f.res, id, n)));
  assert.ok(text.includes('같은 단계'));
  assert.ok(!text.includes('같은 이야기'));
  assert.match(text, /다음에는 .+도 근거로 살펴봐요/);
});
console.log(`V5 S7: ${checks} checks, ${failures.length} failures`);
process.exitCode = failures.length ? 1 : 0;
