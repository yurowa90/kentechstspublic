'use strict';
// E1: EXPLAIN-AUDIT-model.md 전수 표의 ‘엔진이 실제로 쓰는 값’과 제안 의미가 계약이다.
// 구현 문장 전체를 기대값으로 복사하지 않는다. 수치 토큰/의미 조건을 따로 검사한다.
// 원본 자료와 실제 리그 표시를 모두 검사하므로 남은 소유 갈래 불일치는 실패로 남는다.
// 실행: node tests/league/review/42-explain-model.js (VM만, 브라우저·네트워크 없음)
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../../..');
const spec = fs.readFileSync(path.join(ROOT, 'docs/EXPLAIN-AUDIT-model.md'), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));
let assertions = 0;
const failures = [], groups = {}, rows = new Set();
function check(row, surface, variant, label, fn) {
  assertions++; rows.add(row);
  const group = groups[variant] ||= { assertions: 0, failures: 0 };
  group.assertions++;
  try { fn(); }
  catch (e) {
    group.failures++;
    const detail = { row, surface, variant, label, error: e.message };
    failures.push(detail);
    console.error(`FAIL ${row} ${surface} ${variant} ${label}: ${e.message}`);
  }
}
function expose(source, code) {
  assert.match(source, /\}\)\(\);\s*$/, 'VM IIFE 노출 연결점');
  return source.replace(/\}\)\(\);\s*$/, `${code}\n})();`);
}
function load() {
  const ctx = vm.createContext({ console, structuredClone, performance,
    document: { documentElement: {}, addEventListener() {} }, addEventListener() {},
    KCP: { route() {}, on() {}, esc: String, leagueNet: {} } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("씨앗 없는 난수 금지"); };', ctx);
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league']) {
    let source = fs.readFileSync(path.join(ROOT, 'ui', `${name}.js`), 'utf8');
    if (name === 'league-core') source = expose(source, 'KCP.__eurekaMet = eurekaMet;');
    if (name === 'league') source = expose(source, `KCP.__explain = {
      techEffectText, techEurekaText, speedsHTML, turnText,
      help: () => { L = { role: 'team', team: 'pyeongtaek', snap: {} }; return helpHTML(); }
    };`);
    vm.runInContext(source, ctx, { filename: `ui/${name}.js` });
  }
  return ctx.KCP;
}
const K = load(), T = K.TECH_DATA, D = K.ECON_DATA, B = K.buildGame,
  C = K.leagueCore, X = K.econ, U = K.__explain;
const p = (data, key) => data.params[key].v;
const card = id => T.cards.find(c => c.id === id);
const round = (n, digits = 0) => +n.toFixed(digits);
const NUM = '([0-9]+(?:\\.[0-9]+)?)';
const rx = pattern => new RegExp(pattern.replaceAll('#', NUM));
function number(row, surface, variant, text, pattern, expected, label, capture = 1) {
  check(row, surface, variant, label, () => {
    const match = text.match(pattern);
    assert.ok(match, `수치 항목 없음: ${pattern}; 실제: ${text}`);
    assert.ok(Number.isFinite(expected));
    assert.ok(Math.abs(Number(match[capture]) - expected) < 1e-9,
      `문구 ${match[capture]} ≠ 원장 ${expected}; 실제: ${text}`);
  });
}
function meaning(row, surface, text, required = [], forbidden = []) {
  for (const pattern of required) check(row, surface, 'meaning', `필요 의미 ${pattern}`, () => assert.match(text, pattern));
  for (const pattern of forbidden) check(row, surface, 'meaning', `미구현 서술 배제 ${pattern}`, () => assert.doesNotMatch(text, pattern));
}
// 문장 전체나 어순 대신 각각 빠지면 오해가 생기는 의미를 검사한다.
// V59의 근사 범위는 별도 물류비를 계산하지 않는다는 경계로 설명할 수 있다.
const contracts = {
  T10: {
    required: [/연결.*수소|수소.*연결/, /남아|잔량|충분/, /최대|상한/, /LNG/, /CO₂|CO2/],
    forbidden: [/수소.*(?:없어도|무관하게)/],
    example: '잔량이 충분한 수소가 연결되면 LNG CO₂ 감소율 상한은 12%'
  },
  V31: {
    required: [/기존.*연계선/, /이번\s*(?:라운드|달|턴)/, /송전.*(?:멈|중단)/],
    forbidden: [/공사.*(?:멈|중단)/],
    example: '이번 턴 기존 연계선의 송전이 중단돼요'
  },
  V33: {
    required: [/이번\s*(?:라운드|달|턴)/, /송전.*(?:막|재개|복구)/, /사건비.*대응.*(?:남|유지)/],
    forbidden: [/공사.*(?:이어|재개)/],
    example: '이번 달 송전이 재개돼요. 사건비는 대응 뒤에도 유지돼요'
  },
  V44: {
    required: [/이번\s*(?:라운드|달|턴)/, /출력.*(?:감소.*줄|완화)/],
    forbidden: [/정비.*기간.*길|기간.*연장/],
    example: '출력 감소를 완화해요, 이번 턴에 적용해요'
  },
  V59: {
    required: [/항구|항만/, /물류.*여건/, /산출.*(?:감소|줄|낮)/,
      /(?:물류비.*(?:따로|별도)|별도.*물류비).*계산(?:하지\s*않|하지는\s*않)/],
    forbidden: [/물류비[^.()]*?(?:오르|늘|증가)/],
    example: '항만 도시의 물류 여건과 산업 산출이 감소해요. 별도 물류비 지출은 계산하지 않아요'
  },
  V63: {
    required: [/철강.*비중/, /수출.*비중/, /산출.*(?:깎|줄|감소)/,
      /EU.*(?:몫|비중).*(?:모든\s*도시.*같|공통|동일)|공통.*EU.*(?:몫|비중)/,
      /단계.*도입/, /직접배출.*(?:생략|제외)/, /근사|단순화/],
    forbidden: [/직접배출이\s*많을수록/],
    example: '공통 EU 몫을 적용해요. 수출 비중과 철강 비중에 따라 산출이 줄어요(단계 도입, 직접배출 차이는 제외한 단순화)'
  },
  S17: {
    required: [/지지율.*회복.*시간/, /압축|단축/],
    forbidden: [/평가.*주기|임기/],
    example: '지지율 회복 시간을 4배 단축(×4)'
  },
  S18: {
    required: [/주민.*평가/, /현실.*임기/, /압축|단축/],
    forbidden: [],
    example: '주민 평가는 12턴마다, 현실 임기 48달을 ×4 단축'
  },
  C30: {
    required: [/지급\s*월(?:마다|별)|(?:지급|분할)\s*(?:때|시)마다/],
    forbidden: [],
    example: '지원금 연액의 1/4을 분할 때마다 지급'
  }
};
function assertMeaning(row, text) {
  const { required, forbidden } = contracts[row];
  for (const pattern of required) assert.match(text, pattern);
  for (const pattern of forbidden) assert.doesNotMatch(text, pattern);
}
function semantic(row, surface, text) {
  const { required, forbidden } = contracts[row];
  meaning(row, surface, text, required, forbidden);
}
function compression(text, expected) {
  const factors = [...text.matchAll(/×\s*([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)\s*배/g)]
    .map(match => Number(match[1] ?? match[2]));
  assert.ok(factors.length, '시간 압축 배수 필요');
  // ×N과 N배 중 하나만으로 충분하다. 둘 다 쓰면 서로 일치해야 한다.
  for (const factor of factors) assert.equal(factor, expected, '원장의 시간 압축 배수');
}
// VM에서 만든 params 사본의 한 키씩 변경하고 복구한다. 서로 같은 기본값도
// 각자 다른 값으로 바꿔 잘못된 키 연결/숫자 직접 기재를 검출한다.
function mutate(data, key, value, fn) {
  const saved = data.params[key];
  data.params[key] = { ...saved, v: clone(value) };
  try { fn(); } finally { data.params[key] = saved; }
}
const effects = [
  ['T02', 'hvdc', 'hvdcCap', rx('용량\\s*×#'), 1.73],
  ['T02', 'hvdc', 'hvdcCost', rx('건설비\\s*×#'), 1.83],
  ['T03', 'scable', 'scableCap', rx('용량\\s*×#'), 1.73],
  ['T03', 'scable', 'scableLoss', rx('손실\\s*×#'), .37],
  ['T03', 'scable', 'scableCooling', rx('냉각(?:\\s*월)?\\s*#\\s*억'), .83],
  ['T04', 'sic', 'sicOutput', rx('출력\\s*×#'), 1.037],
  ['T05', 'bms', 'bmsFloor', rx('하한\\s*#%\\s*→\\s*#%'), .07, v => round(v * 100), 2],
  ['T05', 'bms', 'bmsEfficiency', rx('왕복\\s*효율\\s*#%\\s*→\\s*#%'), .91, v => round(v ** 2 * 100), 2],
  ['T05', 'bms', 'bmsEfficiency', rx('한 방향\\s*약\\s*#%'), .91, v => round(v * 100, 1)],
  ['T06', 'tandem', 'tandemOutput', rx('출력\\s*×#'), 1.37],
  ['T06', 'tandem', 'tandemCost', rx('건설비\\s*×#'), 1.83],
  ['T07', 'nbat', 'nbatCapacity', rx('×#'), 1.75],
  ['T08', 'mass', 'massCost', rx('건설비\\s*×#'), .83],
  ['T09', 'h2store', 'h2MWh', rx('#\\s*MWh'), 237],
  ['T09', 'h2store', 'h2Efficiency', rx('왕복\\s*#%'), .42, v => round(v * 100, 2)],
  ['T11', 'ccu', 'ccuCo2', rx('CO₂\\s*×#'), .31],
  ['T11', 'ccu', 'ccuOutput', rx('출력\\s*×#'), .67],
  ['T13', 'fcst', 'fcstWidth', rx('예보.*?#\\s*배'), .63],
  ['T14', 'vpp', 'drEffect', rx('수요반응\\s*×#'), 1.7],
  ['T14', 'vpp', 'drCost', rx('비용\\s*×#'), .37],
  ['T14', 'vpp', 'vppCurtail', rx('출력제어\\s*손실\\s*×#'), .63],
  ['T15', 're100', 're100PolicyWeight', rx('가중\\s*×#'), 1.8, v => v, 1, D]
];
for (const [row, id, key, pattern, changed, transform = v => v, capture = 1, data = T] of effects) {
  for (const [surface, text] of [['card.eff', () => card(id).eff],
    ['league.techEffectText', () => U.techEffectText(card(id), { econ: {} })]]) {
    const verify = variant => number(row, surface, variant, text(), pattern, transform(p(data, key)), key, capture);
    verify('baseline');
    mutate(data, key, changed, () => verify('mutation'));
  }
}
// 감소율과 잔존 계수는 같은 효과의 두 표현이다. params에서 독립 환산하며
// 소수 반올림·키 연결도 기본값과 다른 값으로 확인한다.
function h2Amount(text) {
  const reduction = text.match(rx('(?:CO₂|CO2).*?(?:최대\\s*)?#%\\s*(?:감소|감축)')) ||
    text.match(rx('(?:감소율|감축률).*?#%'));
  if (reduction) return { value: Number(reduction[1]), expected: round((1 - p(T, 'h2Co2')) * 100, 2) };
  const factor = text.match(rx('(?:CO₂|CO2).*?×#'));
  assert.ok(factor, `CO₂ 감소율/잔존 계수 없음: ${text}`);
  return { value: Number(factor[1]), expected: p(T, 'h2Co2') };
}
for (const [surface, text] of [['card.eff', () => card('h2mix').eff],
  ['league.techEffectText', () => U.techEffectText(card('h2mix'), { econ: {} })]]) {
  const verify = variant => check('T10', surface, variant, 'h2Co2 감소율/잔존 계수', () => {
    const { value, expected } = h2Amount(text());
    assert.ok(Math.abs(value - expected) < 1e-9, `문구 ${value} ≠ 원장 환산 ${expected}`);
  });
  verify('baseline');
  mutate(T, 'h2Co2', .731, () => verify('mutation'));
}
mutate(T, 'h2Co2', .73123, () => check('T10', 'card.eff', 'mutation', '감소율 소수 둘째 자리 반올림', () => {
  const { value, expected } = h2Amount(card('h2mix').eff);
  assert.equal(value, expected);
}));
for (const [key, changed, pattern, transform] of [
  ['socFloor', .13, rx('하한\\s*#%'), v => round(v * 100)],
  ['batEff', .89, rx('왕복\\s*효율\\s*#%'), v => round(v ** 2 * 100)]
]) {
  const saved = B.M[key];
  for (const [surface, text] of [['card.eff', () => card('bms').eff],
    ['league.techEffectText', () => U.techEffectText(card('bms'), {})]]) {
    number('T05', surface, 'baseline', text(), pattern, transform(saved), key);
    try {
      B.M[key] = changed;
      number('T05', surface, 'mutation', text(), pattern, transform(B.M[key]), key);
    } finally { B.M[key] = saved; }
  }
}
for (const [surface, text] of [['card.eff', id => card(id).eff],
  ['league.techEffectText', id => U.techEffectText(card(id), { econ: {} })]]) {
  meaning('T07', surface, text('nbat'), [], [/화재\s*면역/]);
  semantic('T10', surface, text('h2mix'));
  meaning('T13', surface, text('fcst'), [/최대/, /원래.*범위.*(?:자름|제한)/]);
}
for (const [row, id, key, changed, pattern] of [
  ['T47', 'hvdc', 'eurekaTies', 3, rx('연계선\\s*#개')],
  ['T51', 'tandem', 'eurekaSolar', 13, rx('태양광\\s*#기')],
  ['T59', 'vpp', 'eurekaDr', 5, rx('정책\\s*#(?:달|턴)')],
  ['T60', 're100', 're100Need', 43, rx('비중\\s*#%')]
]) for (const [surface, text] of [['data.eureka', () => T.eureka[id]],
  ['league.techEurekaText', () => U.techEurekaText(id, { econ: {} })]]) {
  const verify = variant => number(row, surface, variant, text(), pattern, p(T, key), key);
  verify('baseline'); mutate(T, key, changed, () => verify('mutation'));
}
for (const [row, id, required] of [['T46', 'grid', [/내부.*송전선/, /설치|건설/]],
  ['T48', 'scable', [/HVDC/, /건설.*완료|완공/]]]) {
  meaning(row, 'data.eureka', T.eureka[id], required, [/운영|통전/]);
  meaning(row, 'league.techEurekaText', U.techEurekaText(id, {}), required, [/운영|통전/]);
}
function game() {
  const R = C.regionOf('south');
  return C.newState('E1FIXTURE', R.id, 0, R.teams.map(t => t.id), { turns: 12, seedMode: 'fixed' });
}
// T46/T48: 원래 전수 표의 조건을 경계 사례로도 확인한다. 운영·통전은 필요 없다.
for (const [row, key] of [['T46', 'grid'], ['T48', 'scable']]) {
  const S = game(), R = C.regionOf(S.region), id = S.active[0];
  S.teams[id].plan = { builds: [], lines: [] }; S.ties = [];
  const met = () => K.__eurekaMet(S, R, B, id, key, {}, {});
  check(row, 'engine.eurekaMet', 'engine', '조건 없음', () => assert.equal(met(), false));
  if (key === 'grid') S.teams[id].plan.lines = [{ p: [] }];
  else S.ties = [{ a: id, b: S.active[1], kind: 'hvdc', st: 'built' }];
  check(row, 'engine.eurekaMet', 'engine', '통전 없는 설치/완공만으로 충족', () => assert.equal(met(), true));
}
for (const R of Object.values(K.LEAGUE_REGIONS)) {
  const event = id => R.events.find(e => e.id === id);
  const surface = `region.${R.id}`;
  for (const [row, id] of [['V36', 'semiconductor_fab_expansion'], ['V40', 'datacenter_siting']]) {
    const e = event(id); if (!e) continue;
    const o = e.opts.find(o => o.id === 'cond');
    for (const [key, value, pattern] of [['dev', .37, rx('수요.*?×#')], ['grant', .83, rx('지원금\\s*×#')]]) {
      number(row, surface, 'baseline', o.note, pattern, o[key], key);
      const saved = o[key];
      try { o[key] = value; number(row, surface, 'mutation', o.note, pattern, o[key], key); }
      finally { o[key] = saved; }
    }
    meaning(row, surface, o.note, [/수요/, /지원금/], [/세수/]);
  }
  const line = event('line_opposition_delay');
  if (line) {
    semantic('V31', surface, line.text);
    const talk = line.opts.find(o => o.id === 'talk');
    semantic('V33', surface, talk.note);
    for (const [row, text] of [['V31', line.text], ['V33', talk.note]]) {
      semantic(row, `${surface}.turnText.econ`, U.turnText(text, { econ: {} }));
      check(row, `${surface}.turnText.econ`, 'engine', '경제 모드의 시간 단위는 달', () => {
        assert.match(U.turnText(text, { econ: {} }), /이번\s*달/);
      });
    }
    for (const [obj, key, changed, pattern, transform] of [
      [talk, 'cost', 9, rx('대응비\\s*#억'), v => v],
      [line.effect, 'budgetAdd', -7, rx('사건비\\s*#억'), Math.abs]
    ]) {
      number('V33', surface, 'baseline', talk.note, pattern, transform(obj[key]), key);
      const saved = obj[key];
      try { obj[key] = changed; number('V33', surface, 'mutation', talk.note, pattern, transform(obj[key]), key); }
      finally { obj[key] = saved; }
    }
  }
  const maintenance = event('planned_maintenance');
  if (maintenance) {
    const text = maintenance.opts.find(o => o.id === 'resched').note;
    semantic('V44', surface, text);
    semantic('V44', `${surface}.turnText.econ`, U.turnText(text, { econ: {} }));
    check('V44', `${surface}.turnText.econ`, 'engine', '경제 모드의 시간 단위는 달', () =>
      assert.match(U.turnText(text, { econ: {} }), /이번\s*달/));
  }
  number('B10', surface, 'baseline', R.scale, rx('실제.*?#\\s*MW'), R.mwScale, 'mwScale');
  const saved = R.mwScale;
  try { R.mwScale = 317; number('B10', surface, 'mutation', R.scale, rx('실제.*?#\\s*MW'), R.mwScale, 'mwScale'); }
  finally { R.mwScale = saved; }
}
for (const [row, id] of [['V59', 'ship_red'], ['V63', 'cbam']]) {
  semantic(row, 'intl.event.text', D.intl.events.find(e => e.id === id).text);
}

const speeds = () => C.publicView(game(), 0).econ.speeds;
const note = key => speeds().items.find(item => item.key === key).note;
const short = name => {
  const html = U.speedsHTML({ speeds: speeds() });
  return [...html.matchAll(/<p(?:\s[^>]*)?>([^<]*)<\/p>/g)].map(m => m[1]).find(s => s.startsWith(name + ':')) || '';
};
for (const [row, key, name, pattern, changed] of [
  ['S10', 'lngSpikeFrequency', 'LNG 가격 급등 빈도', rx('#배'), 7],
  ['S11', 'outageHoursPerPercent', '정전 1% 환산', rx('(?:연\\s*|:\\s*)#시간'), 92.4],
  ['S14', 'complaintPoliticalEffect', '민원이 지지에 미치는 영향', rx('#~#배'), [61, 213]]
]) {
  for (const [surface, text] of [['speeds.items.note', () => note(key)], ['league.speedsHTML', () => short(name)]]) {
    const verify = variant => {
      const values = Array.isArray(p(D, key)) ? p(D, key) : [p(D, key)];
      values.forEach((value, i) => number(row, surface, variant, text(), pattern, value, key, i + 1));
    };
    verify('baseline'); mutate(D, key, changed, () => verify('mutation'));
    if (row === 'S11') meaning(row, surface, text(), [/에너지.*미공급률/, /등가|같은 수요|동일.*수요/, /환산/, /실제.*정전.*(?:다름|구분)/], [/한국.*0\.04/]);
    else meaning(row, surface, text(), [/현실.*추정/]);
  }
}
meaning('S25', 'speeds.items.note', note('outageHoursPerPercent'), [/등가.*시간.*환산/, /실제.*정전시간.*다름/]);
check('S25', 'params', 'engine', '전수 표의 동일 수요 연간 등가시간 환산', () =>
  assert.ok(Math.abs(p(D, 'outageHoursPerPercent') - 365 * 24 / 100) < 1e-9));
for (const [row, item, key, pattern, changed, data = D] of [
  ['S18', 'reviewEvery', 'reviewEvery', rx('#턴'), 9],
  ['S27', 'smrConstruction', 'eduSpeed', rx('×#'), 3.7],
  ['S27', 'smrConstruction', 'smrMonthsReal', rx('약\\s*#개월'), 63],
  ['S27', 'smrConstruction', 'smrTurns', rx('게임\\s*#달'), 15, T]
]) {
  const verify = variant => number(row, 'speeds.items.note', variant, note(item), pattern, p(data, key), key);
  verify('baseline'); mutate(data, key, changed, () => verify('mutation'));
}
const recovery = variant => check('S17', 'speeds.items.note', variant, '회복 시간 압축 배수', () =>
  compression(note('eduMemory'), p(D, 'eduMemory')));
recovery('baseline');
mutate(D, 'eduMemory', 6, () => recovery('mutation'));
semantic('S17', 'speeds.items.note', note('eduMemory'));
mutate(D, 'reviewEvery', 9, () => check('S17', 'speeds.items.note', 'mutation', '회복 시간은 평가 주기와 독립', () => {
  assertMeaning('S17', note('eduMemory'));
  compression(note('eduMemory'), p(D, 'eduMemory'));
}));
semantic('S18', 'speeds.items.note', note('reviewEvery'));
// REF §11.7: 현실 임기 4년=48달을 ×4 압축한 설계. eduMemory와 별개다.
number('S18', 'speeds.items.note', 'baseline', note('reviewEvery'), rx('임기.*?#(?:달|개월)'), 48, '현실 임기 달수');
check('S18', 'speeds.items.note', 'baseline', '평가 시간 압축', () => compression(note('reviewEvery'), 4));
mutate(D, 'eduMemory', 6, () => check('S18', 'speeds.items.note', 'mutation', '평가 시간 압축은 회복 배속과 독립', () =>
  compression(note('reviewEvery'), 4)));
meaning('S27', 'speeds.items.note', note('smrConstruction'), [/현실.*비교.*약/]);

// C30/C33/C34: 실제 월 계산이 내보내는 뉴스. params는 자료 전체의 독립 사본.
function fiscal(data, stage) {
  const ids = Object.keys(data.start), E = X.initCities(ids, data, { seed: 'E1-fiscal', months: 12 });
  if (stage) {
    E.month = 2;
    for (const c of Object.values(E.cities)) {
      c.revYear = 1e6; c.debtCap = stage === 'crisis' ? 1e3 : 1e9;
      const warn = p(data, 'debtWarnRatio') / p(data, 'budgetToRevenue');
      const ratio = stage === 'warn' ? (warn + p(data, 'debtCrisisRatio')) / 2 : p(data, 'debtCrisisRatio') + .1;
      c.cash = -ratio * p(data, 'budgetToRevenue') * c.revYear;
    }
  }
  return X.monthStep(E, {}, data);
}
for (const [variant, values] of [['baseline', {}], ['mutation', { subsidyPayMonths: [1, 7] }]]) {
  const data = clone(D);
  for (const [key, value] of Object.entries(values)) data.params[key].v = value;
  const result = fiscal(data), news = result.report.news.find(s => /지원금.*연액/.test(s)) || '';
  number('C30', 'econ.monthStep.news', variant, news, rx('1/#'), p(data, 'subsidyPayMonths').length, 'subsidyPayMonths.length');
  semantic('C30', 'econ.monthStep.news', news);
  if (variant === 'mutation') meaning('C30', 'econ.monthStep.news', news, [], [/분기/]);
  check('C30', 'econ.monthStep', variant, '지급액 = 연액/지급 횟수', () => {
    for (const id of result.E.order) {
      const expected = result.E.cities[id].subsidy / p(data, 'subsidyPayMonths').length;
      assert.ok(Math.abs(result.report.fiscal[id].rev.subsidy - expected) <= 1 / p(data, 'ledgerRound3'));
    }
  });
  if (variant === 'baseline') number('C30', 'league.helpHTML', variant, U.help(), rx('1/#씩'), p(data, 'subsidyPayMonths').length, 'subsidyPayMonths.length');
  if (variant === 'baseline') check('C30', 'league.helpHTML', variant, '기본 지급 월은 분기 초', () =>
    assert.match(U.help(), /분기 초\(1·4·7·10월\)/));
  // helpHTML는 VM의 D를 읽으므로, 독립 data와 같은 변형을 VM 사본에도 적용한다.
  if (variant === 'mutation') mutate(D, 'subsidyPayMonths', p(data, 'subsidyPayMonths'), () => {
    number('C30', 'league.helpHTML.liveParams', variant, U.help(), rx('1/#씩'), p(D, 'subsidyPayMonths').length, 'subsidyPayMonths.length');
    check('C30', 'league.helpHTML.liveParams', variant, '지급 월 목록', () => {
      const match = U.help().match(/(?:분기 초|지급 월)\(([^)]*)월\)/);
      assert.ok(match, '지원금 지급 월 목록');
      assert.deepEqual(match[1].split('·').map(Number), clone(p(D, 'subsidyPayMonths')));
    });
    check('C30', 'league.helpHTML.liveParams', variant, '분기 지급이 아니면 분기 초 표현 금지', () => {
      const months = p(D, 'subsidyPayMonths');
      // 명세상 분기 초 지급 월은 1·4·7·10월 네 개뿐이다.
      if (months.length !== 4 || [1, 4, 7, 10].some((month, i) => months[i] !== month)) {
        assert.doesNotMatch(U.help(), /분기 초/);
      }
    });
  });
}
for (const [row, stage, key, changed, pattern, expected] of [
  ['C33', 'warn', 'debtWarnRatio', .61, rx('주의:.*채무비율\\s*#%'), data => round(100 * p(data, 'debtWarnRatio') / p(data, 'budgetToRevenue'), 2)],
  ['C33', 'warn', 'budgetToRevenue', 2.5, rx('주의:.*채무비율\\s*#%'), data => round(100 * p(data, 'debtWarnRatio') / p(data, 'budgetToRevenue'), 2)],
  ['C34', 'crisis', 'scoreFinOverCap', 7, rx('위기:.*재정 점수\\s*#'), data => p(data, 'scoreFinOverCap')]
]) for (const variant of ['baseline', 'mutation']) {
  const data = clone(D);
  if (variant === 'mutation') data.params[key].v = changed;
  const result = fiscal(data, stage), news = result.report.news.find(s => new RegExp(stage === 'warn' ? '재정 주의' : '재정 위기').test(s)) || '';
  check(row, 'fixture', variant, `실제 재정 단계 ${stage}`, () => {
    for (const id of result.E.order) assert.equal(result.report.fiscal[id].debtStage, stage);
  });
  number(row, 'econ.monthStep.news', variant, news, pattern, expected(data), key);
  if (row === 'C34') check(row, 'econ.score', variant, '한도 초과 재정 점수와 뉴스 일치', () => {
    for (const id of result.E.order) assert.equal(result.report.score.by[id].parts.fin, expected(data));
  });
}
// 동의어/어순 변경은 허용하되 필수 의미를 삭제하면 같은 단언이 거부해야 한다.
// 검사 대상은 VM의 실제 출력이다. 별도 예문으로 다른 표현도 확인한다.
const semanticOutputs = {
  T10: card('h2mix').eff,
  V31: Object.values(K.LEAGUE_REGIONS).flatMap(r => r.events).find(e => e.id === 'line_opposition_delay').text,
  V33: Object.values(K.LEAGUE_REGIONS).flatMap(r => r.events).find(e => e.id === 'line_opposition_delay').opts.find(o => o.id === 'talk').note,
  V44: Object.values(K.LEAGUE_REGIONS).flatMap(r => r.events).find(e => e.id === 'planned_maintenance').opts.find(o => o.id === 'resched').note,
  V59: D.intl.events.find(e => e.id === 'ship_red').text,
  V63: D.intl.events.find(e => e.id === 'cbam').text,
  S17: note('eduMemory'), S18: note('reviewEvery'),
  C30: fiscal(clone(D)).report.news.find(s => /지원금.*연액/.test(s)) || ''
};
for (const [row, { required, example }] of Object.entries(contracts)) {
  check(row, 'semantic.contract', 'mutation-check', '동의어·어순 변형 허용', () => assertMeaning(row, example));
  for (const pattern of required) check(row, 'semantic.contract', 'mutation-check', `필수 의미 삭제 검출 ${pattern}`, () => {
    const text = semanticOutputs[row];
    assertMeaning(row, text);
    const removed = text.replace(new RegExp(pattern.source, 'g'), '');
    assert.notEqual(removed, text, '실제 문장에서 해당 의미를 제거해야 함');
    assert.throws(() => assertMeaning(row, removed), assert.AssertionError);
  });
}
for (const [row, addition] of [
  ['T10', '수소가 없어도 적용해요'], ['V31', '공사가 중단돼요'],
  ['V33', '공사를 재개해요'], ['V44', '정비 기간이 길어져요'],
  ['V59', '물류비가 증가해요'], ['V63', '직접배출이 많을수록 줄어요'],
  ['S17', '평가 주기를 압축해요']
]) check(row, 'semantic.contract', 'mutation-check', '미구현·잘못 연결한 서술 추가 검출', () => {
  assertMeaning(row, semanticOutputs[row]);
  assert.throws(() => assertMeaning(row, `${semanticOutputs[row]} ${addition}`), assert.AssertionError);
});
for (const [text, expected] of [['회복 시간을 4배 단축', 4], ['×4 시간 압축', 4]]) {
  check('S17', 'compression.contract', 'mutation-check', `배수 표현 허용: ${text}`, () => compression(text, expected));
}
for (const [row, text, expected] of [
  ['S17', '지지율 회복 시간 압축', 4], ['S17', '지지율 회복 시간 ×5', 4],
  ['S17', '지지율 회복 시간 ×4: 5배 압축', 4], ['S18', '현실 임기 48달을 ×6 압축', 4]
]) check(row, 'compression.contract', 'mutation-check', `배수 삭제·오염 검출: ${text}`, () =>
  assert.throws(() => compression(text, expected), assert.AssertionError));
// 범위 누락과 행 ID 오기를 막는다. 표의 문장 열을 기대 문장으로 사용하지 않는다.
const requiredRows = ['T06', 'T07', 'T10', 'T11', 'T46', 'T48', 'V31', 'V33', 'V44', 'V63',
  'S10', 'S11', 'S14', 'S25', 'T13', 'V59', 'T02', 'T03', 'T04', 'T05', 'T08', 'T09',
  'T14', 'T15', 'T47', 'T51', 'T59', 'T60', 'B10', 'V36', 'V40', 'C30', 'C33', 'C34', 'S17', 'S18', 'S27'];
const testedRows = new Set(rows);
for (const row of requiredRows) check(row, 'spec', 'coverage', 'E1 대상 행 검사 실행', () => assert.ok(testedRows.has(row)));
for (const row of rows) check(row, 'spec', 'coverage', '전수 대조 표에 있는 행', () => assert.match(spec, new RegExp(`^\\| ${row} \\|`, 'm')));
console.log(JSON.stringify({ suite: '42-explain-model', assertions, failures: failures.length,
  groups, rows: [...rows].sort(), details: failures }));
process.exitCode = failures.length ? 1 : 0;
