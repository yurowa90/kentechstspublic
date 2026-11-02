/* W4: 브라우저 없이 시작 저장본 생성·자연 사건 재현 검산.
 * node tests/league/fx_event_seeds.js [--json]
 * review/32-s7-monthly.js와 같은 VM 로더. UI 파일은 수정/함수 추출하지 않는다.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../..');
const TEAM = 'pyeongtaek', IDS = [TEAM, 'dangjin'];
// D-64 room = hash(room), seedKey = String(salt); fixed = 0 (방 코드 무관).
// 유효한 8자리 FXW4+4자리 코드를 순서대로 탐색한 판들로 9종을 덮는다.
// D-90: 기존 두 판을 유지하고 첫 후보 FXW4AAAA의 자연 monsoon_cloud를 추가한다.
// 우선 분위기까지 확인한 독립 고정 표: 같은 달의 계절관리제가 겨울 사건을 가리지 않는다.
const CASES = [
  { room: 'FXW4AAA8', salt: 2932481647, targets: {
    finedust_coal_cap: 1, heavy_snow_solar: 2, spring_dust_haze: 4,
    heavy_rain: 6, evening_peak_tropical_night: 7 } },
  { room: 'FXW4AABT', salt: 3233934336, targets: {
    coldwave_heating: 2, heatwave_peak: 8, typhoon_coast: 9 } },
  { room: 'FXW4AAAA', salt: 3318366884, targets: { monsoon_cloud: 6 } },
];
const KEYS = ['heatwave_peak', 'evening_peak_tropical_night', 'coldwave_heating',
  'heavy_snow_solar', 'typhoon_coast', 'monsoon_cloud', 'heavy_rain',
  'spring_dust_haze', 'finedust_coal_cap'];
const clone = value => JSON.parse(JSON.stringify(value));

function engine() {
  const ctx = vm.createContext({ console, structuredClone,
    document: { documentElement: {}, addEventListener() {} },
    KCP: { route() {}, on() {}, esc: String } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("unseeded random"); };', ctx);
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ',
    'league-data', 'league-core', 'league-ai'])
    vm.runInContext(fs.readFileSync(path.join(ROOT, `ui/${name}.js`), 'utf8'), ctx,
      { filename: `ui/${name}.js` });
  return ctx.KCP;
}

function fixtures() {
  const { leagueCore: C, buildGame: B } = engine(), R = C.regionOf('south');
  // D-64의 fixed를 방 코드 씨앗처럼 취급하는 회귀도 검출한다.
  const fixed = CASES.map(({ room }) => {
    const S = C.newState(room, R.id, 0, IDS, { turns: 12, seedMode: 'fixed' });
    assert.equal(S.salt, 0); assert.equal(S.seedKey, '0');
    for (let month = 1; month <= 12; month++) { S.round = month; C.drawEvents(S, R); }
    return clone(S.events);
  });
  for (const events of fixed.slice(1))
    assert.deepEqual(fixed[0], events, 'fixed 사건은 방 코드와 무관');
  const result = CASES.map(spec => {
    // league.js #lg-solo-start의 newState→도시 claim→lobby 저장과 같은 형식.
    const S = C.newState(spec.room, R.id, 0, IDS, { turns: 12, seedMode: 'room' });
    assert.equal(S.salt, spec.salt, `${spec.room} D-64 소금`);
    assert.equal(S.seedKey, String(spec.salt));
    for (const id of IDS)
      assert.equal(C.reduce(S, { type: 'claim', team: id, token: `solo-city-${id}` }, 0, B).ok, true);
    assert.equal(S.phase, 'lobby'); assert.equal(S.round, 0); assert.equal(S.events.length, 0);
    const save = clone({ v: 1, state: S, initial: S, team: TEAM, style: 'balanced',
      interview: { docs: {}, journal: {}, freeExperiment: true }, aiRound: 0 });
    // 저장 후 JSON 왕복한 상태로 12달 실제 운영. 사건을 넣거나 round를 건너뛰지 않는다.
    const live = clone(save.state), months = [];
    for (let month = 1; month <= 12; month++) {
      assert.equal(C.host(live, 'next', 0), true);
      assert.equal(live.phase, 'plan'); assert.equal(live.round, month);
      const events = clone(live.events.filter(ev => ev.round === month));
      const mine = events.filter(ev => C.hits(R, C.eventDef(R, ev.id), TEAM, live));
      const selected = mine.find(ev => KEYS.includes(ev.id))?.id || null;
      for (const [id, target] of Object.entries(spec.targets)) if (month === target)
        assert.equal(selected, id, `${spec.room} ${month}월 내 도시 우선 사건`);
      // startSolo/soloNext의 컴퓨터 계획 2회 + 준비 직전 응답 1회와 같은 순서.
      C.computerPlans(live, B, TEAM, 'balanced', false);
      C.computerPlans(live, B, TEAM, 'balanced', true);
      C.computerPlans(live, B, TEAM, 'balanced', true);
      assert.equal(C.reduce(live, { type: 'ready', team: TEAM,
        token: live.teams[TEAM].token, ready: true }, 0, B).ok, true);
      const res = C.run(live, B, 0);
      assert.equal(live.phase, 'review'); assert.equal(res.round, month);
      assert.deepEqual(clone(res.events), events.map(ev => ev.id));
      assert.equal(res.seed, (7000 + month * 13 + spec.salt) >>> 0);
      assert.ok(C.replayOf(month, TEAM, spec.salt, spec.room), '같은 소금의 엔진 재생 자료');
      months.push({ month, events, selected });
    }
    assert.ok(months.some(m => !m.events.length), `${spec.room} 사건 없는 달`);
    return { ...spec, save, months };
  });
  assert.deepEqual(result.flatMap(f => Object.keys(f.targets)).sort(), [...KEYS].sort());
  return result;
}

if (require.main === module) {
  const data = fixtures();
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(data));
  else {
    for (const f of data) {
      console.log(`room ${f.room} salt/seedKey ${f.salt} team ${f.save.team} (사건 주입 없음)`);
      for (const [id, month] of Object.entries(f.targets)) console.log(`  ${month}월 ${id}`);
    }
    const months = data.reduce((total, f) => total + f.months.length, 0);
    console.log(`engine months ${months} targets ${KEYS.length} missing 0 (DOM/mood 검증은 fx_event.py 담당)`);
  }
}
module.exports = { fixtures };
