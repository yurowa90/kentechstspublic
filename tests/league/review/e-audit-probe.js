'use strict';
// 186e182 설명 기준판 + SCORE3 후속 대조. 브라우저·네트워크·파일 출력 없음.
// 실행: node tests/league/review/e-audit-probe.js [--detail] [--ref <sha>]
// 기본은 현재 작업 파일을 읽는다(회귀 검사용). --ref를 주면 그 판본을 git show로 읽는다(감사 재현용, 186e182판은 --ref 186e182).
// 회귀 검사 통과와 표의 수동 의미 대조를 구별한다. VM에서 참조만 노출한다.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
let checks = 0;
// 번호 검사에서도 첫 실패의 종료 코드를 유지하고 마지막 줄에 집계를 남긴다.
process.on('exit', code => console.log(`assertions ${checks} failures ${code ? 1 : 0}`));
const root = path.resolve(__dirname, '../../..');
const refAt = process.argv.indexOf('--ref'), ref = refAt >= 0 ? process.argv[refAt + 1] : null;
if (refAt >= 0 && !ref) throw new Error('--ref 뒤에 판본을 주세요');
const read = n => ref ? execFileSync('git', ['show', `${ref}:ui/${n}.js`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'ui', n + '.js'), 'utf8');
const names = ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core', 'league'];
const sources = Object.fromEntries(names.map(n => [n, read(n)]));
// HUD 전체 DOM 대신 실제 syncMoney 클로저만 같은 VM 스코프에서 실행한다.
const hudSync = sources.league.match(/    const syncMoney = \(\) => \{[\s\S]*?\n    \};(?=\n    root.querySelectorAll\('\[data-cap\]'\))/)?.[0];
const ctx = vm.createContext({ console, structuredClone, URL, performance,
  document: { documentElement: {}, addEventListener() {} }, addEventListener() {},
  KCP: { route() {}, on() {}, esc: String, leagueNet: {} } });
ctx.window = ctx;
const expose = {
  build: `KCP.auditB = { dispOf, weather, renOut0, tips, POLICIES, MISSIONS, RS, TECHS,
    placementAdvice, thermalToolInfo, setState: x => S = x,
    help: () => { openHelp(); return S.help.body.innerHTML; },
    cards: () => { renderDrawer(); return S.root.querySelector('#bd-drawer-body').innerHTML; } };`,
  econ: 'KCP.auditE = { groupTargets, causeOf, pmContext };',
  'league-core': `KCP.auditC = { econView, modsFor, bonusOf, tieMods, eurekaMet,
    repairOf: typeof repairOf === 'function' ? repairOf : null,
    disasterSettlementOf: typeof disasterSettlementOf === 'function' ? disasterSettlementOf : null };`,
  league: `KCP.auditU = { speedsHTML, buildLeadHTML, techEffectText, techEurekaText,
    eventSourceHTML, evSize, evCards, cityHTML, groupCauseHTML,
    REV9_COPY: typeof REV9_COPY === 'undefined' ? null : REV9_COPY,
    grantMoneyNote: typeof grantMoneyNote === 'function' ? grantMoneyNote : null,
    migrationReason, gridReliance, airNoteHTML,
    moneyHUD: (root, money, id) => { ${hudSync || 'throw Error("syncMoney 연결점 없음")'}; syncMoney(); },
    setState: x => L = x };`
};
for (const n of names) {
  let src = sources[n];
  if (expose[n]) {
    assert.match(src, /\}\)\(\);\s*$/);
    src = src.replace(/\}\)\(\);\s*$/, expose[n] + '\n})();');
  }
  vm.runInContext(src, ctx, { filename: 'ui/' + n + '.js' });
}
const K = ctx.KCP, B = K.buildGame, D = K.ECON_DATA, T = K.TECH_DATA;
const C = K.leagueCore, U = K.auditU, E = K.auditE, A = K.auditB;
const plain = v => JSON.parse(JSON.stringify(v));
const eq = (a, b) => { checks++; assert.deepEqual(plain(a), plain(b)); };
const near = (a, b) => { checks++; assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`); };
const has = (s, rx) => { checks++; assert.match(s, rx); };
const loc = (file, needle) => {
  const i = sources[file].split('\n').findIndex(l => l.includes(needle));
  assert.ok(i >= 0, file + ': ' + needle);
  return `ui/${file}.js:${i + 1}`;
};
const ids = Object.keys(D.start), region = C.regionOf('south');
const state = C.newState('AUDIT', 'south', 0, ids, { turns: 12 });
U.setState({ room: 'AUDIT', team: 'pyeongtaek', snap: state });
const fake = (league, mods = {}) => {
  const nodes = new Map();
  const s = { drawerTab: 'policy', doc: { journal: [] }, st: { builds: [], lines: [], policies: [], missions: [], season: 'summer' },
    opts: { league, leagueRound: () => ({ month: 1 }), leagueMods: () => mods },
    help: { body: {}, setTitle() {}, open() {} },
    root: { querySelectorAll: () => [], querySelector: sel => { if (!nodes.has(sel)) nodes.set(sel, { querySelectorAll: () => [], querySelector: () => null }); return nodes.get(sel); } } };
  A.setState(s); return s;
};
const workingHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const uiDirty = !ref && execFileSync('git', ['status', '--porcelain', '--', 'ui/'], { cwd: root, encoding: 'utf8' }).trim() !== '';
const report = { head: ref || workingHead, workingHead, uiDirty,
  hashes: Object.fromEntries(names.map(n => [n, crypto.createHash('sha256').update(sources[n]).digest('hex')])),
  packs: {}, cards: [], events: [], groups: {}, thermal: {}, observations: {} };
for (const id of ['island', ...ids]) for (const league of id === 'island' ? [false] : [false, true]) {
  B.selectPack(id, league ? 'league' : undefined); fake(league);
  const help = A.help(), imp = A.dispOf('import'), diesel = A.dispOf('diesel');
  const tax = A.POLICIES.find(p => p.id === 'tax').eff();
  near(Number(tax.match(/×([\d.]+)/)[1]), +((diesel.fuel + diesel.co2 * B.M.taxPerT) / diesel.fuel).toFixed(4));
  eq(A.POLICIES.find(p => p.id === 'dr').cost, '0.05억/일');
  if (league) {
    fake(true, { drCost: T.params.drCost.v, drEffect: T.params.drEffect.v });
    eq(A.POLICIES.find(p => p.id === 'dr').cost, '0.025억/일');
    has(help, /도시 급전원.*이웃 거래.*자동 계통 수입/);
    has(help, /연결점 직접 수입 없음/);
  } else if (id !== 'island') {
    has(help, /수입 총 .*연결점마다/);
    has(help, /연료 가격·탄소세에 따라 싼 급전원/);
  }
  const fab = B.SITES.filter(s => s.dem?.fab2 != null).map(s => [s.dem.base, s.dem.fab2]);
  if (id !== 'island') {
    has(help, /사흘째부터.*정격 상한/);
    has(help, /CO₂ 총량에는 0, 바이오 배출 0.1/);
    has(help, /0.4173 t\/MWh/);
    const cards = A.cards();
    has(cards, fab.length ? /공장 5 → 10 MW/ : /공장 증설 수요 정의 없음/);
    // 3일째 유량 경계와 강수/월평균 유량 정규화를 실제 날씨에서 확인.
    let found = false;
    for (let seed = 1; seed <= 30 && !found; seed++) {
      const wx = A.weather(seed, 'summer'); let sunny = 0;
      for (const day of wx) {
        sunny = day.w === 0 ? sunny + 1 : 0;
        if (sunny === 3) { near(day.flow, .7); found = true; }
        if (day.w === 2) near(day.flow, 1.3);
      }
    }
    eq(found, true);
  }
  report.packs[id + (league ? ':league' : ':free')] = { tax, dr: A.POLICIES.find(p => p.id === 'dr').cost,
    importEach: imp.cap, importTotal: imp.cap * B.SITES.filter(s => s.kind === 'gridpt').length,
    plants: B.SITES.filter(s => s.kind === 'plant').map(s => ({ fuel: s.fuel || 'lng', cap: s.cap })), fab,
    help, specs: Object.fromEntries(Object.entries(B.BLD).map(([k, v]) => [k, v.spec])) };
}
B.selectPack('pyeongtaek', 'league'); fake(true);
report.speeds = K.auditC.econView(state).speeds;
report.speedsHTML = U.speedsHTML(K.auditC.econView(state));
report.leadHTML = U.buildLeadHTML();
report.airHTML = U.airNoteHTML();
for (const card of T.cards) {
  report.cards.push({ id: card.id, raw: card.eff, screen: U.techEffectText(card, { econ: true }),
    why: card.why, need: card.need, demo: card.demo, eureka: U.techEurekaText(card.id, { econ: true }), scale: card.scale });
  eq(card.need, card.numbers.need.v); eq(card.demo, card.numbers.demo.v);
}
// 16개 사건: 관측 why와 게임 effect를 분리하고 실제 대응 배수를 검산.
for (const event of region.events) {
  const s = structuredClone(state); s.round = 1;
  s.events = [{ id: event.id, round: 1, x: 1 }];
  s.ties = [{ a: 'dangjin', b: 'asan', st: 'built', cap: 4, kind: 'line' }];
  const id = ids.find(id => C.hits(region, event, id, s));
  if (!id) throw Error('사건 대상 없음: ' + event.id);
  const source = U.eventSourceHTML(event); has(source, /사건 크기·대응 효과는 게임 가정/);
  eq(source.includes(event.why), true);
  const variants = [];
  for (const opt of [null, ...(event.opts || [])]) {
    s.teams[id].resp = opt ? { ['1:' + event.id]: opt.id } : {};
    const mods = K.auditC.modsFor(s, region, id);
    for (const key of C.MUL.filter(k => event.effect[k] != null)) {
      const dev = opt?.knobs && !opt.knobs.includes(key) ? 1 : (opt?.dev ?? 1);
      near(mods[key], 1 + (event.effect[key] - 1) * dev);
    }
    const bonus = K.auditC.bonusOf(s, region, id, 1);
    near(bonus, (event.effect.budgetAdd || 0) * (opt?.grant ?? 1) + C.grantAmount(s, region, id, 1));
    variants.push({ option: opt?.id || 'none', mods, bonus, down: K.auditC.tieMods(s, region).down });
  }
  report.events.push({ id: event.id, text: event.text, why: event.why, tip: event.tip,
    opts: event.opts, effect: event.effect, asOf: event.asOf, published: event.published, variants });
}
report.international = D.intl.events;
if (!ref) {
  eq(!!D.disasterFacts, true); eq(Array.isArray(D.groupOwnKeys), true);
}
// D09~D13: 설명의 출력 경로와 실제 사건·정산을 함께 대조한다.
if (D.disasterFacts) {
  const f = D.disasterFacts, s = structuredClone(state), id = 'pyeongtaek';
  s.round = 7; s.phase = 'plan';
  s.teams[id].plan = { builds: [], lines: [], policies: [], missions: [] };
  s.teams[id].base = []; s.teams[id].resp = {};
  U.setState({ room: 'AUDIT', team: id, snap: s, doc: { maps: {} } });
  B.selectPack(id, 'league');
  const event = (eventId, x = 1, response) => {
    s.events = [{ id: eventId, round: 7, x }];
    s.teams[id].resp = response ? { ['7:' + eventId]: response } : {};
    return U.evCards(s, 7, id, true);
  };
  const rain = event('heavy_rain');
  eq(rain.includes(f.rain.text), true); has(rain, /event-disaster-heavy_rain/);
  has(f.rain.text, /절반 확률/); near(D.params.heavyRainShare.v, .5);
  eq(C.eventDef(region, 'heavy_rain').drawParent, 'monsoon_cloud');
  // 분기 양끝에서 실제 추첨 결과가 같은 먹구름 한 자리를 대체한다.
  let rainBranch = false;
  const savedShare = D.params.heavyRainShare.v;
  try {
    for (let seed = 0; seed < 50 && !rainBranch; seed++) {
      const a = structuredClone(s), b = structuredClone(s);
      a.seedKey = b.seedKey = 'audit-rain-' + seed; a.events = []; b.events = [];
      D.params.heavyRainShare.v = 0; C.drawEvents(a, region);
      D.params.heavyRainShare.v = 1; C.drawEvents(b, region);
      if (!a.events.some(e => e.id === 'monsoon_cloud')) continue;
      eq(b.events.some(e => e.id === 'heavy_rain'), true);
      eq(b.events.some(e => e.id === 'monsoon_cloud'), false);
      eq(a.events, b.events.map(e => ({ ...e, id: e.id === 'heavy_rain' ? 'monsoon_cloud' : e.id })));
      rainBranch = true;
    }
    eq(rainBranch, true);
  } finally { D.params.heavyRainShare.v = savedShare; }
  const heat = event('heatwave_peak');
  eq(heat.includes(f.heat.text), true); eq(heat.includes(f.heat.limitation), true);
  has(heat, /event-disaster-heatwave_peak/);
  has(f.heat.text, /바깥 공기와 패널.*LNG와 일반 태양광/);
  has(f.heat.limitation, /석탄·SMR·디젤과 탠덤 태양광.*근거 값.*출력을 줄이지 않아요/);
  const mods = K.auditC.modsFor(s, region, id);
  near(mods.lngCapMul, 1 - D.params.heatLngSlope.v * D.params.heatAirDelta.v);
  near(mods.solarHeatMul, 1 - D.params.heatPvSlope.v * D.params.heatModuleDelta.v);
  for (const k of ['coalCapMul', 'smrCapMul', 'dieselCapMul', 'tandemHeatMul']) eq(k in mods, false);
  const repairs = {};
  for (const [eventId, key, response, factor] of [
    ['heavy_rain', 'repairHeavyRain', 'inspect', .8],
    ['heatwave_peak', 'repairHeatwave', 'dr', 1]
  ]) {
    event(eventId, 1); const base = K.auditC.repairOf(s, region, id);
    near(base, D.params[key].v);
    event(eventId, 2); near(K.auditC.repairOf(s, region, id), base * 2);
    event(eventId, 1, response); near(K.auditC.repairOf(s, region, id), base * factor);
    repairs[eventId] = base;
  }
  event('heavy_rain');
  s.econRep = { fiscal: { [id]: { rev: {}, exp: { repair: repairs.heavy_rain } } },
    cities: {}, groups: {}, flows: { pop: [], ind: [] } };
  const cityHTML = U.cityHTML(C.publicView(s, 0));
  eq(cityHTML.includes(f.repair.text), true); has(cityHTML, /city-repair/);
  has(f.repair.text, /한 번.*사건이 클수록.*대응하면 호우 보수비만/);
  const g = C.grantOf(s, region, id, B), repair = K.auditC.repairOf(s, region, id);
  const settled = K.auditC.disasterSettlementOf(s, region, id, B, repair);
  near(settled.repairUsed, Math.min(g.left, repair));
  near(settled.expired, g.left - Math.min(g.left, repair));
  has(rain, /새 설비·선로·재난 대응에 쓰고, 남으면 이달 말 보수비에 먼저.*그래도 남으면 사라져요/);
  has(f.grant.text, /새 설비·선로·재난 대응.*이달 말 재난 보수비에 먼저.*그래도 남으면 사라져요/);
  has(U.grantMoneyNote(s, id), /특별교부세.*남으면 보수비/);
  // 기존 노드에 실제 HUD 갱신 함수를 적용한다(배치·터치 검사는 아님).
  eq(typeof hudSync, 'string');
  const node = () => ({ textContent: '', dataset: {}, style: { setProperty() {} },
    getBoundingClientRect: () => ({ left: 0, top: 100, right: 100 }),
    getAttribute(k) { return this[k]; }, setAttribute(k, v) { this[k] = v; } });
  const chip = node(), pop = node(), amount = node(), label = node(), note = node();
  const tip = { ...node(), querySelector: () => pop };
  const money = { ...node(), querySelector: sel => ({ '[data-v]': amount, '.v2-cap-k': label,
    '[data-money-note], .lg-debt-note': note, '[data-grant-chip]': chip }[sel]) };
  const hud = { ...node(), clientLeft: 0, clientTop: 0, querySelector: () => null };
  const root = { querySelector: sel => ({ '.lg-money-info': tip, '#bd-hud': hud }[sel]) };
  ctx.matchMedia = () => ({ matches: true });
  U.moneyHUD(root, money, id);
  eq(chip.hidden, false); eq(tip.hidden, false);
  eq(chip.textContent, '+' + Number(g.left.toFixed(1)) + '억 전용');
  eq(pop.textContent, f.grant.text.replace('{n}', Number(g.left.toFixed(1))));
  report.observations.disaster = { repairs, grant: settled, moneyChip: chip.textContent };
  U.setState({ room: 'AUDIT', team: id, snap: state });
}
const city = state.econ.cities.pyeongtaek;
const input = K.econ.cleanInput({ energy: { demMWh: 100, servedMWh: 100, unsPct: 0, hospH: 0 }, policy: {} }, city, D.start.pyeongtaek, D);
const groups = E.groupTargets(city, input, 1, D, { pm25: { pyeongtaek: { delta: .01 } }, taxResAvg: 0, taxIndAvg: 0 });
for (const [key, weights] of Object.entries(D.params.groupW.v)) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const [part, w] of Object.entries(weights)) if (part !== 'rel') near(groups.contrib[key][part], groups.parts[part] * w / sum);
  near(groups.tg[key], Math.min(100, Math.max(0, Object.values(groups.contrib[key]).reduce((a, b) => a + b, 0))));
  report.groups[key] = { weights, target: groups.tg[key] };
}
// G48~G50: 실제 월 정산 → 공개 상태 → 집단 막대. 목표/현재·건수·병원 분리.
if (D.groupOwnKeys) {
  // rev9-E E1: VM에서 참조만 노출한 화면 문구표로 기대를 조립한다. 렌더러는 재사용하지 않는다.
  const copy = U.REV9_COPY, words = D.groupOwnCopy;
  if (!copy && !ref) {
    console.error('BLOCKED E1: REV9_COPY의 VM 참조가 없어 params·groupOwnCopy로 대조');
    process.exitCode = 1;
  }
  const fill = (template, values) => template.replace(/\{([^{}]+)\}/g, (_, key) => values[key]);
  const cap = D.params.complaintCap.v, scoreUnit = cap / D.params.complaintScale.v;
  const complaint = (kind, fraction) => ({ kind, src: 'coal', score: fraction * scoreUnit });
  const variants = [
    { list: [complaint('siting', .3)], capped: false },
    { list: [complaint('siting', .3), complaint('smoke', .2)], capped: false },
    { list: [complaint('siting', .6), complaint('smoke', .6)], capped: true },
    { list: [complaint('smoke', .2)], capped: false },
    { list: [complaint('siting', 1)], capped: true },
    { list: [complaint('smoke', 1)], capped: true }
  ];
  for (const { list, capped } of variants) {
    const n = list.length, m = list.filter(c => c.kind === 'siting').length;
    const values = { n, m, cap: cap.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) };
    const mixed = m > 0 && m < n;
    // --ref의 옛 판본은 옛 표로 재현한다. 현재 작업판에 표가 없으면 위 BLOCKED를 남긴다.
    const label = mixed && copy ? fill(copy[capped ? 'K8b' : 'K8a'], values) :
      `민원(${fill(m === n ? words.sitingN : mixed ? words.mixedN : words.complaintN, values)})` +
      (capped && copy ? fill(copy.K8cap, values) : '');
    const s = structuredClone(state), inputs = Object.fromEntries(ids.map(id => [id, {
      energy: { demMWh: 100, servedMWh: 100, unsPct: 0, hospH: 4, cpList: list }, policy: {}
    }]));
    s.econ.cities.pyeongtaek.groups.senior.sat = 0; // 회복 지연 경로에서 목표≠현재를 확인.
    const step = K.econ.monthStep(s.econ, inputs, D);
    s.econ = step.E; s.econRep = step.report; s.round = step.E.t;
    const current = s.econ.cities.pyeongtaek, pub = C.publicView(s, 0).econ.cities.pyeongtaek;
    U.setState({ room: 'AUDIT', team: 'pyeongtaek', snap: s });
    const html = U.groupCauseHTML(pub, 'senior', step.report, null);
    const rows = [...html.matchAll(/<div>([^<>]*?)<meter\b([^>]*)><\/meter>/g)];
    const own = pub.groupOwn.senior, applied = pub.groupOwnLag.senior;
    eq(Math.abs(own.complaint) >= cap, capped);
    eq(html.includes(label), true);
    for (const term of ['complaint', 'hospital']) {
      const name = term === 'complaint' ? label : '병원 정전';
      const row = rows.find(r => r[1].startsWith(name + ' ')); eq(!!row, true);
      const text = `최종 반영 ${own[term].toFixed(2)}점 · 현재 반영 ${applied[term].toFixed(2)}점`;
      eq(row[1].includes(text), true); eq(row[2].includes(`aria-valuetext="${text}"`), true);
      has(row[2], /aria-label="만족 목표에서 깎인 점수"/);
      near(applied[term], Math.round(current.groupContrib.senior[term] * 100) / 100);
    }
    eq(own.complaint === applied.complaint, false);
    eq(own.complaintN, list.length); eq(own.sitingN || 0, list.filter(c => c.kind === 'siting').length);
    // rel에서 병원 감점을 빼고 전용 항에 한 번만 둔다(노년 추가 감점 별도).
    const weights = D.params.groupW.v.senior;
    const z = Object.keys(weights).filter(k => pub.groupParts[k] != null).reduce((n, k) => n + weights[k], 0);
    const rel = rows.find(r => r[1].startsWith('전력 신뢰 ')); eq(!!rel, true);
    const cleanRel = weights.rel * (pub.groupParts.rel - pub.hospRel) / z;
    near(Number(rel[1].match(/([\d.-]+)점/)[1]), Number(cleanRel.toFixed(2)));
    const hospital = weights.rel * pub.hospRel / z - D.params.seniorHosp.v * .5;
    near(own.hospital, Math.round(hospital * 100) / 100);
  }
  // 목표가 0이어도 이전 감점이 남으면 현재 반영을 따로 읽을 수 있다.
  const html = U.groupCauseHTML({ groupParts: {}, groupOwn: {}, groupOwnLag: { senior: { complaint: -1.52 } } }, 'senior', null, null);
  has(html, /최종 반영 0\.00점 · 현재 반영 -1\.52점/);
  U.setState({ room: 'AUDIT', team: 'pyeongtaek', snap: state });
}
for (const [which, key] of [['L', 'wL'], ['A', 'wA']]) for (const part of Object.keys(D.params[key].v)) {
  const zero = Object.fromEntries(Object.keys(D.params[key].v).map(k => [k, 0]));
  eq(E.causeOf({ ['lag' + which]: zero, ['base' + which]: zero },
    { ['lag' + which]: { ...zero, [part]: 10 }, ['base' + which]: zero }, which, D.params[key].v, D).part, part);
}
const migration = U.migrationReason({ from: 'pyeongtaek', to: 'hwaseong', why: '공기가 나빠서', whyGrade: 'G' });
has(migration, /시작 대비 변화/); report.observations.migration = migration;
const scores = K.econ.score(state.econ);
for (const r of scores.rank) {
  const weights = D.params.wScore.v;
  const geometric = Math.exp(Object.entries(weights).reduce((s, [k, w]) => s + w * Math.log(Math.max(D.params.scorePartFloor.v, r.parts[k])), 0) / Object.values(weights).reduce((a, b) => a + b, 0));
  near(r.score, Math.round(Math.min(100, Math.max(0, geometric + r.coop)) * 10) / 10);
}
// D-82: 31일→28일 월합계는 달라도 하루 평균은 동일.
const result = round => ({ round, days: 7, team: { pyeongtaek: { uns: 0, imp: 0, sub: 0, isolated: { uns: 70 } } } });
const prev = result(1), curr = result(2);
const grid = U.gridReliance({ region: 'south', rounds: [{ days: 7, mdays: 31 }, { days: 7, mdays: 28 }], results: [prev, curr] }, curr, 'pyeongtaek');
near(grid.delta, -30); near(grid.deltaPerDay, 0); report.observations.grid = grid;
const facts = D.thermalFacts;
for (const fuel of ['coal', 'lng', 'smr']) {
  const info = A.thermalToolInfo(fuel);
  const keys = fuel === 'smr' ? ['siting'] : [...(fuel === 'coal' ? ['coalScenario'] : []), 'capex', 'pm', 'siting'];
  for (const key of keys) eq(info.includes(facts[key].text), true);
}
for (const [fuel, key] of [['coal', 'coalBuild'], ['lng', 'lngBuild']]) {
  const f = facts[key], [sy, sm] = f.start.split('-').map(Number), [ey, em] = f.end.split('-').map(Number);
  eq(f.months, (ey - sy) * 12 + em - sm); eq(f.gameTurns, 0);
  has(f.text, new RegExp('약 ' + f.months + '개월'));
  has(facts.capex.text, new RegExp(facts.capex[fuel].toLocaleString('en-US') + '달러'));
  eq(f.realMW, D.params.thermalMW.v[fuel]); eq(facts.capex[fuel], D.params.thermalCapex.v[fuel]);
  near(B.BLD[fuel].mw, f.realMW / region.mwScale);
  near(B.BLD[fuel].cost, f.realMW / region.mwScale * T.params.smrCostBase.v / T.params.smrCapexBase.v * facts.capex[fuel]);
  const ratio = facts.pm[fuel + 'New'] / facts.pm[fuel + 'Reference'];
  near(D.params.pmNewFuelW.v[fuel] / D.params.pmFuelW.v[fuel], ratio);
  has(facts.pm.text, new RegExp('약 ' + Math.round(ratio * 100) + '%'));
  report.thermal[fuel] = { realMW: f.realMW, months: f.months, gameTurns: f.gameTurns,
    mw: B.BLD[fuel].mw, cost: B.BLD[fuel].cost, ratio, weight: D.params.pmNewFuelW.v[fuel] };
}
has(facts.siting.text, new RegExp('지도 ' + (D.params.sitingWeights.v.length - 1) + '칸'));
// D02/D05/D06/D07: 원자료 기본값뿐 아니라 params 변경도 문장이 따라야 한다.
if (!ref) {
  const pm = D.params.pmNewFuelW.v, weights = D.params.sitingWeights.v, turns = T.params.smrTurns.v;
  const saved = { coal: pm.coal, lng: pm.lng, weights: [...weights] };
  try {
    pm.coal = D.params.pmFuelW.v.coal * .5; pm.lng = D.params.pmFuelW.v.lng * .6;
    weights.push(.1); T.params.smrTurns.v = 8;
    has(facts.pm.text, /약 50%·약 60%/);
    has(facts.siting.text, /지도 4칸 안/); has(facts.siting.text, /4칸은/);
    has(facts.coalBuild.text, /SMR 8달만/);
    eq(A.thermalToolInfo('coal').includes(facts.pm.text), true);
    eq(A.thermalToolInfo('coal').includes(facts.siting.text), true);
    has(A.placementAdvice('coal', B.TILES.find(t => !t.out).i).join(' '), /지도 4칸 안/);
    has(U.buildLeadHTML(), /SMR 8달만/);
  } finally {
    pm.coal = saved.coal; pm.lng = saved.lng;
    D.params.sitingWeights.v = saved.weights; T.params.smrTurns.v = turns;
  }
}
has(sources.build, /급전 순서: 재생 → 배터리 → 도시 급전원\(.*\) → 이웃 거래/);
has(sources.build, /"급전 순서: 재생 → 배터리 → 연료 가격·탄소세에 따라 싼 급전원부터/);
// D08: 냉각수 거절은 석탄·LNG·SMR 공통, 문구는 해안·하천
has(sources.build, /\["smr", "lng", "coal"\]\.includes\(type\) && T\.t !== "river" && T\.t !== "beach"\) return "냉각수: 해안·하천만"/);
// V60: lng_spike는 LNG 전부, 디젤·석탄은 fuelMul^0.6 — 문장이 세 연료를 모두 말해야 한다
{ const ev = D.intl.events.find(e => e.id === 'lng_spike');
  has(ev.text, /LNG.*가장/); has(ev.text, /디젤/); has(ev.text, /석탄/);
  has(sources['league-core'], /coal: Math\.pow\(I\.fuelMul, 0\.6\)/); }
eq(facts.coalScenario.hypothetical, true); has(facts.coalScenario.text, /2040.*가정/);
const p = { builds: [], lines: [], policies: [], missions: [] };
B.PACKS.audit = { id: 'audit', budget: 1000, rows: ['bbbbbbbbb'], legend: { b: 'beach' }, attachAny: true,
  climate: B.PACKS.pyeongtaek.climate, goals: { costBase: 100, costPerDay: 1, co2Day: 100 },
  groups: [{ id: 'thermal', tools: ['coal', 'lng', 'diesel'] }], sites: [{ kind: 'city', c: 0, r: 0, dem: { base: 1 } }] };
region.teams.push({ id: 'audit', pack: 'audit' }); B.selectPack('audit', 'league');
const st = fake(true); st.st = p;
report.observations.siting = [];
for (const fuel of ['coal', 'lng', 'smr']) for (const distance of [1, 2, 3, 4]) {
  const plan = { ...p, builds: [{ t: fuel, i: distance }] };
  const points = B.complaints(plan, [0]).items.reduce((s, x) => s + x.pts, 0);
  near(points, 10 * ([0, 1, .6, .3][distance] || 0));
  near(B.complaints(plan, [1]).items.reduce((s, x) => s + x.pts, 0), points);
  const advice = A.placementAdvice(fuel, distance);
  has(advice.join(' '), new RegExp('민원 \\+' + (points >= 5 ? 1 : 0) + '건'));
  has(advice.join(' '), /가동과 무관/);
  report.observations.siting.push({ fuel, distance, points, advice });
}
// 실제 연구 상태·건설비·PM과 문구는 기본값에서 일치해도 변형 추종은 별도 문제다.
const before = facts.capex.text, saved = D.params.thermalCapex.v.coal;
D.params.thermalCapex.v.coal = 2000; B.selectPack('audit', 'league');
eq(facts.capex.text, before); near(B.BLD.coal.cost, 1040 / region.mwScale * (7.5 / 4500) * 2000);
report.observations.capexMutation = { textUnchanged: true, changedCost: B.BLD.coal.cost };
D.params.thermalCapex.v.coal = saved;
report.locations = {
  B05: loc('build', '소수력은 평균 출력 계수'), B06: loc('build', '[...plants.map'),
  B09: loc('build', 'LG ? `급전 순서'), B19: loc('build', 'const D = dispOf("diesel"), fuel'),
  B20: loc('build', 'id: "dr", name:'), B26: loc('build', '공장 증설 수요 정의 없음'),
  thermal: loc('econ-data', 'thermalFacts: {'), tool: loc('build', 'function thermalToolInfo'),
  placement: loc('build', 'function placementAdvice'), construction: loc('league', 'function buildLeadHTML')
};
report.checks = checks;
if (process.argv.includes('--detail')) console.log(JSON.stringify(report));
else console.log(JSON.stringify({ head: report.head, workingHead, uiDirty: report.uiDirty, checks, failures: 0, packs: Object.keys(report.packs).length,
  cards: report.cards.length, events: report.events.length, groups: Object.keys(report.groups).length,
  thermal: report.thermal, gridDeltaPerDay: grid.deltaPerDay, capexMutation: report.observations.capexMutation }));
