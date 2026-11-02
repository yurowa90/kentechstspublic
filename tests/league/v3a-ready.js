'use strict';
// 실행: node tests/league/v3a-ready.js — 브라우저·네트워크·실제 타이머 없음.
// 수정 4: 실제 준비 처리 → 진행자 reduce → ack → 서랍 그리기 → 스냅 순서를 고정한다.
// DOM 가시성은 s8n.py 담당. 여기서는 서랍의 predictionHTML/rememberLocalPlan 저장 경로를 검사한다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
let checks = 0;
function equal(actual, expected, label) {
  assert.deepEqual(clone(actual), clone(expected), label);
  checks++;
}

function fixture(changed) {
  const storage = new Map(), sent = [], session = {};
  let sequence = 0;
  const mem = { getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value) };
  const ctx = vm.createContext({ console, performance, structuredClone,
    __session: session, clearTimeout() {}, addEventListener() {},
    localStorage: mem, sessionStorage: mem,
    document: { documentElement: {}, addEventListener() {}, getElementById: () => null,
      querySelector: selector => selector === '.lg-bar [data-panel="city"]' ? {} : null },
    KCP: { route() {}, on() {}, esc: String, leagueNet: {
      fingerprint: async () => 'fixture-key', expandSnapshot: clone,
      signEnvelope: async (_identity, team, request) => ({ ...request, team, n: ++sequence }),
      requestBody: envelope => envelope,
    } } });
  ctx.window = ctx;
  for (const name of ['build-maps', 'tech-data', 'build', 'econ-data', 'econ', 'league-data', 'league-core']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, `../../ui/${name}.js`), 'utf8'), ctx,
      { filename: `${name}.js` });
  }
  const source = fs.readFileSync(path.resolve(__dirname, '../../ui/league.js'), 'utf8');
  // 원본 파일은 읽기만 한다. 전체 모듈을 실행하며 함수 본문/기대값은 복제하지 않는다.
  // 비공개 이벤트 진입점을 메모리에서만 노출해 ack와 스냅을 별도로 전달한다.
  equal(source.split('let L = null;').length, 2, '세션 연결점 한 개');
  equal(source.split('KCP.league = {').length, 2, 'VM 검사 연결점 한 개');
  vm.runInContext(source.replace('let L = null;', 'let L = globalThis.__session;')
    .replace('KCP.league = {', 'globalThis.__hooks = { readyAction, response, onSnap, rememberLocalPlan, predictionHTML, planFollowupHTML }; KCP.league = {'),
  ctx, { filename: 'league.js' });
  const { leagueCore: C, buildGame: B } = ctx.KCP, api = ctx.__hooks;
  const id = 'pyeongtaek', room = 'V3AFIXTR', token = 'fictional-ready-token';
  const S = C.newState(room, 'south', 0, [id, 'dangjin'], { turns: 12, seedMode: 'fixed' });
  C.host(S, 'next', 0);
  S.round = 2;
  S.sid = 'fixture-session';
  S.events = [];
  S.teams[id].token = token;
  B.selectPack(C.teamDef(C.regionOf('south'), id).pack, 'league');
  const operatingPlan = { builds: [], lines: [], policies: [], rq: [], shed: 'home', fab2: false,
    econPol: clone(S.teams[id].econPol || S.econ.cities[id].policy || {}) };
  const current = clone(operatingPlan);
  if (changed) current.policies = ['share'];
  S.teams[id].plan = clone(current);
  B.current = () => current; // 건설 편집 문서만 연결; 비교·확정 함수는 실제 앱 코드.
  B.toast = message => { throw new Error(message); };
  Object.assign(session, { role: 'team', room, team: id, snap: C.publicView(S, 0),
    identity: { publicKey: 'fixture-public-key' }, claimAccepted: true,
    seat: S.teams[id].seatVersion, rev: S.teams[id].rev,
    pendingRequests: new Map(), awaitReady: true, conn: { send: (event, value) => sent.push({ event, value }) } });
  const key = `kcp-league-data-v1:${room}:${id}`;
  const promise = { evidence: { key: 'grid', text: '가상 접속 여유', value: 1 },
    pred: { uns: 'down' }, topic: 'uns', confidence: 'fairly', decision: '가상 약속 입력 유지' };
  const data = { interview: { months: {
    1: { ...clone(promise), operatingPlan, followingPlanChanged: null, resultNumbers: ['12'],
      compared: true, answer: changed ? 'revise' : 'keep', askReason: '정전 결과를 확인했다' },
    // 품질8 UX 준비 전 확인 카드(QUALITY-ux U5): 설비 없는 검사 재료는 카드를 이미 통과한 것으로 둔다. 준비 요청 단언은 그대로.
    2: { ...clone(promise), operatingPlan: null, followingPlanChanged: null, resultNumbers: [], issueCheckPassed: true },
  } } };
  mem.setItem(key, JSON.stringify(data));
  const note = month => JSON.parse(mem.getItem(key)).interview.months[month];
  function confirmed(value, basis, label) {
    const n = note(1);
    equal(n.followingPlanChanged, value, label + ': followingPlanChanged');
    equal(n.followingPlanBasis ?? null, basis, label + ': followingPlanBasis');
    equal(Object.hasOwn(n, 'followingPlanConfirmedChanged'), false, label + ': 별도 확정 필드 없음');
  }
  function draw(label) {
    // 약속과 일지는 같은 predictionHTML을 사용한다. 각 재그리기 전후를 별도로 단언한다.
    for (const name of ['약속', '일지']) {
      api.rememberLocalPlan(session.snap);
      const html = api.predictionHTML(session.snap);
      equal(html.includes('id="lg-predict"'), true, label + ': ' + name + ' 약속 내용 생성');
      confirmed(changed, 'ready', label + ': ' + name);
    }
  }
  async function readyRequest(value) {
    const count = sent.length;
    api.readyAction(false);
    await session.sending;
    equal(sent.length, count + 1, '준비 입력 한 번에 요청 한 개');
    const { event, value: request } = sent.at(-1);
    equal([event, request.type, request.ready], ['req', 'ready', value], '실제 준비 요청');
    equal(C.reduce(S, { ...request, token }, 0, B).ok, true, '진행자가 준비 요청 수락');
    equal(S.teams[id].ready, value, '진행자 S.ready 즉시 반영');
    equal(session.snap.teams[id].ready, !value, '팀에는 이전 스냅만 존재');
    return request;
  }
  async function ack(request) {
    await api.response('ack', { ...request, kid: 'fixture-key' });
    equal(session.wantReady, null, 'ack가 wantReady 해제');
    equal(session.readyAcked, request.ready, 'ack 확인값을 스냅까지 보관');
  }
  function snap() {
    api.onSnap(C.publicView(S, 0));
    equal(session.readyAcked, null, '따라온 스냅이 ack 보관값 해제');
    api.rememberLocalPlan(session.snap); // DOM 없는 onSnap 이후 실제 그리기 경로
  }
  return { api, session, S, C, B, id, key, mem, note, promise, current,
    confirmed, draw, readyRequest, ack, snap };
}

async function race(changed) {
  const f = fixture(changed);
  const before = f.note(1);
  equal(f.api.planFollowupHTML(f.session.snap).match(/id="lg-previous-mission">([^<]*)/)[1],
    '지난달 학습 미션: 달성(지금 계획 기준, 준비하면 확정)', '정상 비교 정확한 문구·꼬리');
  equal(f.note(1), before, '미리보기 저장값 불변');
  const request = await f.readyRequest(true);
  f.draw('진행자 준비 직후·ack 전');
  await f.ack(request);
  equal(f.session.snap.teams[f.id].ready, false, 'ack 뒤에도 스냅 도착 전임을 확인');
  f.draw('ack 뒤·스냅 전');
  // 준비=false인 이전 스냅이 먼저 와도 확인된 ack를 소모하지 않는다.
  f.api.onSnap(clone(f.session.snap));
  equal(f.session.readyAcked, true, '이전 스냅은 ready ack를 지우지 않음');
  f.draw('이전 스냅 재수신');
  f.snap();
  f.draw('준비 스냅 뒤');

  for (let repeat = 0; repeat < 2; repeat++) {
    const off = await f.readyRequest(false);
    f.confirmed(null, null, '해제 클릭 즉시');
    await f.ack(off);
    f.api.predictionHTML(f.session.snap);
    f.confirmed(null, null, '해제 ack 뒤·이전 ready 스냅');
    f.snap();
    f.confirmed(null, null, '해제 스냅 뒤');
    equal(f.note(2).confirmed, true, '약속 확인 상태 유지');
    f.session.panel = null;
    const again = await f.readyRequest(true);
    equal(f.session.panel, null, '재준비가 약속 서랍 열기를 요청하지 않음');
    await f.ack(again);
    f.draw('재준비 ack 뒤·스냅 전');
    f.snap();
    f.draw('재준비 스냅 뒤');
    equal(Object.fromEntries(Object.keys(f.promise).map(key => [key, f.note(2)[key]])),
      f.promise, '해제·재준비에서 약속 입력 유지');
  }
  // 해제 뒤 실제 계획 수정 → 미확정 → 재준비 → 실제 운영 결과로 확정.
  await f.ack(await f.readyRequest(false));
  f.snap();
  f.current.policies = changed ? [] : ['share'];
  f.S.teams[f.id].plan = clone(f.current);
  f.api.predictionHTML(f.session.snap);
  f.confirmed(null, null, '해제 뒤 계획 수정은 미확정');
  await f.ack(await f.readyRequest(true));
  f.confirmed(!changed, 'ready', '수정 뒤 재준비');
  f.snap();
  f.C.run(f.S, f.B, 0);
  // 운영 결과 기록 경로를 직접 호출한다. S7 분해·DOM은 이 검사의 대상이 아니다.
  f.api.rememberLocalPlan(f.C.publicView(f.S, 0));
  f.confirmed(!changed, 'result', '실제 운영 결과로 재확정');
}

async function main() {
  for (const changed of [false, true]) await race(changed);
  for (const legacy of [false, true]) {
    const f = fixture(false), data = JSON.parse(f.mem.getItem(f.key));
    delete data.interview.months[1].operatingPlan;
    if (legacy) for (const key of ['followingPlanChanged', 'resultNumbers']) delete data.interview.months[1][key];
    f.mem.setItem(f.key, JSON.stringify(data));
    const before = f.note(1);
    equal(f.api.planFollowupHTML(f.session.snap).match(/id="lg-previous-mission">([^<]*)/)[1],
      '지난달 학습 미션: ' + (legacy ? '옛 기준 기록이라 판정하지 않아요' : '지난달 운영 기록이 이 기기에 없어 판정하지 않아요'),
      '비교 불가 문구 완전 일치·확정 꼬리 없음');
    equal(f.note(1), before, '비교 불가 미리보기 저장값 불변');
  }
  console.log(`checks ${checks} fail 0`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
