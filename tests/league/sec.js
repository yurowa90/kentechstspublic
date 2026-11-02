/* 지시서 F 수용 검사. 외부 연결 없이 실제 WebCrypto와 게임 엔진을 사용한다. */
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
// 구현 파일을 쓰지 않고 require/VM이 읽는 메모리 문자열만 바꾼다.
const fs = require("node:fs"), child = require("node:child_process");
const mutations = {
  team: ["league-net.js", 'm.team !== team || ', '', "대상 팀에도 같은 키 등록"],
  kick: ["league-net.js", '(T.seatVersion || 0) !== epoch || ', '', "검증 도중 kick"],
  events: ["league-core.js", 'const rnd = rng(hashStr((S.seedKey ?? S.room) + ":" + S.round)), out = [];', 'const rnd = rng(hashStr("constant:" + S.round)), out = [];', "room 모드: 실제로 뽑힌 사건"],
  replay: ["league.js", 'state: structuredClone(L.initial), initial:', 'state: structuredClone(L.S), initial:', "실제 같은 조건으로 다시"],
  host_sig: ["league-net.js", 'if (!await crypto.subtle.verify(signing, key, Uint8Array.from(atob(sig)', 'if (false && !await crypto.subtle.verify(signing, key, Uint8Array.from(atob(sig)', "진행자 서명 뒤 내용 변조"],
  canonical: ["league-net.js", 'const json = canonical(data),', 'const json = JSON.stringify(data),', "정규 JSON: 재귀 키 섞기"],
  code_binding: ["league-net.js", 'binding.room !== trust.room || ', '', "첫 키도 방 코드와 다르면"],
  link_binding: ["league-net.js", 'trust.fingerprint && binding.fingerprint !== trust.fingerprint ||', 'false ||', "링크 지문 불일치"],
  kid: ["league.js", 'm.kid !== await NET.fingerprint(L.identity.publicKey)', 'false', "위조 nack·다른 kid"],
  sid: ["league-net.js", 'if (!S.sid || m.sid !== S.sid)', 'if (false)', "다른 방 봉투"],
  seat: ["league-net.js", 'm.seat !== epoch', 'false', "kick 이전 claim 봉투"],
  retired: ["league-net.js", 'T.retired?.[', '{}?.[', "같은 키 재착석도 retired"],
  debounce: ["league.js", 'L.hostSaveT = setTimeout(() => { if (L?.role === "host") flushHost(); }, 1000);', 'flushHost();', "전체 저장은 1초 디바운스"],
  ai: ["league-ai.js", '${S.seedKey ?? S.room}:', '${S.room}:', "fixed 컴퓨터 도시 계획"],
  trim: ["league-net.js", 'if (size > 178000)', 'if (false)', "크기 위험 시 오래된 팀 기록"],
  warning_loop: ["league.js", '        connectionWarning();\n        if (!L.team)', '        if (L.hostWarning) return;\n        connectionWarning();\n        if (!L.team)', "F3-1 위조 snap 연타"],
  stale_retry: ["league.js", 'pending && m.err === "replay"', 'pending && ["replay", "stale"].includes(m.err)', "F3-2 stale은 재전송 없이"],
  retry_stamp: ["league.js", '...(pending?.stamp || stamp)', '...stamp', "F3-11 새 sid snap 뒤 원래"],
  nack_signature: ["league-net.js", '["bad", "signature"].includes(result.err)', 'false', "F3-3 bad·signature nack"],
  nack_echo: ["league-net.js", 'const reply = { team: m.team,', 'const reply = { ...m, team: m.team,', "F3-3 응답 필드 제한"],
  nack_rate: ["league-net.js", 'if (++rate.count > 2)', 'if (false)', "F3-3 kid 교체 포함"],
  claim_ack: ["league.js", 'if (!L.claimAccepted) return;', 'if (false) return;', "F3-4 첫 snap만으로"],
  lost_seat: ["league.js", 'if (previousSeat != null && me.seatVersion !== previousSeat)', 'if (!me.seated && previousSeat != null && me.seatVersion !== previousSeat)', "F3-4 kick 직후 새 기기"],
  claim_reject: ["league.js", '      releaseSeat();\n      BG.toast(msg);', '      BG.toast(msg);', "F3-4 taken 자리 선택"],
  early_request: ["league-net.js", 'if (m.n <= Math.max(claim && T.token !== m.kid ? 0 : lastN(), T.retired?.[m.kid] || 0)) return reject("replay");', '', "F3-5 진행자 sid·순번·크기"],
  request_queue: ["league-net.js", '(queued.get(team) || 0) >= 16', 'false', "F3-5 진행자 검증 대기열"],
  early_host: ["league-net.js", 'if (!snap && queued >= 16 || !cheap(incoming) || incoming.event !== event)', 'if (!snap && queued >= 16 || incoming.event !== event)', "F3-5 팀 sid·순번·크기"],
  snap_skip: ["league-net.js", 'waitingSnap.skip = true; ', '', "Q8 밀린 옛 snap은 검증 없이 건너뜀"],
  snap_order: ["league-net.js", 'if (snap && waitingSnap && waitingSnap.incoming.n >= incoming.n) {', 'if (false) {', "Q8 늦게 온 옛 순번 snap은 기다리던 새 snap을 밀어내지 못함"],
  snap_candidate: ["league-net.js", 'if (!waitingSnap.prev || waitingSnap.prev.incoming.n < incoming.n) waitingSnap.prev = { incoming };', '', "Q8 순번만 큰 위조 snap 뒤의 정상 snap도 예비로 남음"],
  snap_fallback: ["league-net.js", 'if (!back) return false;', 'return false;', "Q8 최신 snap이 위조면 밀려난 정상 snap을 대신 반영"],
  warn_snap20: ["league.js", ' && snapAge <= 20000', '', "Q8 공개 상태 20초 없음 안내"],
  warn_snap10: ["league.js", 'snapAge <= 20000', 'snapAge <= 10000', "Q8 ack는 오고 공개 상태만 15초 밀리면 안내 없음"],
  warn_refresh30: ["league.js", 'Math.max(hostAge, snapAge) > 30000', 'Math.max(hostAge, snapAge) > 10000', "Q8 30초 전 안내에는 새로고침 권유 없음"],
  warn_refresh_snap: ["league.js", 'Math.max(hostAge, snapAge) > 30000', 'hostAge > 30000', "Q8 공개 상태만 30초 넘게 없어도"],
  warn_host10: ["league.js", 'if (hostAge <= 10000 && ', 'if (', "Q8 진행자 메시지 10초 없음 안내"],
  snap_cap: ["league-net.js", 'if (!snap && queued >= 16 ||', 'if (queued >= 16 ||', "Q8 대기열이 차도 최신 snap은 남음"],
  host_queue: ["league-net.js", 'queued >= 16', 'false', "F3-5 팀 검증 대기열"],
  compact_loop: ["league-net.js", 'const ratio = Math.max(0, Math.min(1,', 'while (bytes(view).length > 178000 && view.teams?.[Object.keys(view.teams)[0]]?.hist?.length > 2) view.teams[Object.keys(view.teams)[0]].hist.shift(); const ratio = Math.max(0, Math.min(1,', "F3-6 부풀린 상태"],
  compact_summary: ["league-net.js", 'if (i >= t.hist.length - 2 || !row.plan)', 'if (true)', "F3-6 오래된 계획 전문"],
  apply_json: ["league-net.js", 'await apply(event, signed.data);', 'await apply(event, it.incoming.data);', "F3-7 검증한 정규 JSON"],
  json_values: ["league-net.js", 'return encode(value);', 'return encode(JSON.parse(JSON.stringify(value)));', "F3-7 JSON 밖 값 거절"],
  room_bits: ["league-net.js", 'length: 8', 'length: 6', "F3-8 기존 ALPHA 40비트 고정 벡터"],
  room_alphabet: ["league-net.js", '"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"', '"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"', "F3-8 기존 ALPHA 40비트 고정 벡터"],
  room_input: ["league.js", 'replace(/[-\\s]/g, "")', 'trim()', "F3-8 코드 정규화"],
  migrate_data: ["league.js", 'if (data) teamSet(dataKey(), data);', '', "F3-9 같은 팀 새 방"],
  broken_legacy: ["league.js", 'Object.keys(save.state.teams || {})', 'Object.keys(save.state.teams)', "F3-9 teams 없는 옛 저장 hostView"],
  fallback_sid: ["league.js", 'L.S.sid = NET.sessionId();', 'if (ok) L.S.sid = NET.sessionId();', "F3-9 teams 없는 옛 저장"],
  born_floor: ["league-net.js", 'm.born <= (T.receiptFloor || 0)', 'false', "F3-10 퇴거한 born"],
  pending_limit: ["league.js", 'L.pendingRequests.size >= 32', 'false', "F3-10 팀 대기 요청 상한"],
  restart_sid: ["league.js", 'L.S.sid = NET.sessionId();', 'L.S.sid ||= NET.sessionId();', "F3-11 진행자 시작마다"],
  restore_base: ["league-net.js", '([k, c]) => ({ k, c })', '([k, c]) => ({ k, c: c + 1 })', "F3-6 두 차례 축약 뒤 현재 base 보존"], // 89d4d0d부터 F3-12보다 먼저 잡는다
  restore_grid: ["league-net.js", '([key, allocatedMW]) => ({ key, allocatedMW })', '([key, allocatedMW]) => ({ key, allocatedMW: 0 })', "F3-6 두 차례 축약 뒤 현재 trialGrid 보존"], // 같은 사유
  state_crit_order: ["league-net.js", 'stateful ? stateNs?.values[m.type] || 0 : T.lastN || 0', 'stateful && m.type !== "crit" ? stateNs?.values[m.type] || 0 : T.lastN || 0', "F4 ready(568) → crit(567)"],
  state_plan_order: ["league-net.js", 'stateful ? stateNs?.values[m.type] || 0 : T.lastN || 0', 'stateful && m.type !== "plan" ? stateNs?.values[m.type] || 0 : T.lastN || 0', "F4 준비 → 계획"],
  state_replay: ["league-net.js", 'stateNs?.values[m.type] || 0', 'm.type === "crit" ? 0 : stateNs?.values[m.type] || 0', "F4 같은 type 옛 n"],
  state_max: ["league-net.js", 'T.lastN = Math.max(T.lastN || 0, m.n);', 'T.lastN = m.n;', "F4 역순 반영 뒤에도 퇴거용"],
  state_seat: ["league-net.js", 'T.lastNByType?.seat === epoch && T.lastNByType.kid === m.kid', 'T.lastNByType', "F4 새 키·자리"],
  state_ack: ["league.js", 'sent.acked = true;', 'return;', "F4 최신 상태 ack"],
  state_ack_n: ["league.js", 'sent.n === m.n && ', '', "F4 이전·다른 대상 ack"],
  state_ack_queued: ["league.js", 'session.stateRequests[type] = stateRequest;', 'session.sending?.then(() => { session.stateRequests[type] = stateRequest; });', "F4 서명 대기 중 이전 ack"],
  state_cooldown: ["league.js", 'Date.now() - sent.sentAt >= 2000', 'true', "F4 1999ms"],
  state_ack_timer: ["league.js", '(type !== "plan" || !sent.acked || sent.rev !== L.rev)', 'true', "F4 ack 후 계획 재전송 중단"],
  state_unsent_crit: ["league.js", 'type !== "plan" || !sent.acked || sent.rev !== L.rev', 'type === "hello" || !sent.acked', "F4 이전 ack 뒤 아직 보내지 않은 기준 편집"],

};
if (process.env.F2_MUTATION) {
  const [file, from, to] = mutations[process.env.F2_MUTATION];
  const read = fs.readFileSync;
  fs.readFileSync = function (name, ...args) {
    const value = read.call(this, name, ...args);
    if (typeof value === "string" && String(name).endsWith("/ui/" + file)) {
      assert.ok(value.includes(from), "변형 대상 없음: " + file);
      let changed = value.replaceAll(from, to);
      if (process.env.F2_MUTATION === "early_host") changed = changed.replace('if (!cheap(wire)) return false;', '').replace('        if (event === "snap" &&', '        if (!cheap(wire)) return false;\n        if (event === "snap" &&');
      return changed;
    }
    return value;
  };
}
if (process.argv.includes("--mutations")) {
  for (const [name, [, , , expected]] of Object.entries(mutations)) {
    const result = child.spawnSync(process.execPath, [__filename, "--quick"], { env: { ...process.env, F2_MUTATION: name }, encoding: "utf8" });
    const out = result.stdout + result.stderr;
    assert.ok(result.status !== 0 && out.includes(expected), name + " 변형이 기대 단언에서 실패하지 않음:\n" + out);
    console.log(name + " → " + expected + " [실패 확인]");
  }
  process.exit(0);
}
global.window = { KCP: { route() {}, on() {}, esc: String } };
global.document = { documentElement: {} };
for (const file of ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core", "league-ai", "league-net"]) require(path.resolve(__dirname, "../../ui", file + ".js"));
const K = window.KCP, C = K.leagueCore, N = K.leagueNet, BG = K.buildGame;
const R = Object.values(K.LEAGUE_REGIONS).find(r => r.teams.length === 6), ids = R.teams.map(t => t.id);
let checks = 0;
function ok(value, label) { assert.ok(value, label); checks++; }
const state = (room = "SEC01", seedMode) => Object.assign(C.newState(room, R.id, 0, ids, { turns: 36, ...(seedMode ? { seedMode } : {}) }), { sid: "fixture-session-" + room });
async function security() {
  const S = state(), applied = [];
  const sign = (key, team, request, now) => N.signEnvelope(key, team, { sid: S.sid, seat: S.teams[team]?.seatVersion || 0, ...request }, now);
  const a = await N.createIdentity(), b = await N.createIdentity(), team = ids[0];
  const e = await sign(a, team, { type: "ready", ready: true }, 100);
  ok(await N.verifyEnvelope(e, a.publicKey), "P-256/SHA-256 서명 검증");
  ok(!await N.verifyEnvelope({ ...e, body: e.body.replace("100", "101") }, a.publicKey), "body 한 글자 변조 거절");
  ok(!await N.verifyEnvelope(await sign(b, team, { type: "ready" }), a.publicKey), "다른 팀 키 거절");
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, reorder(value[k])])) : value;
  ok(await N.verifyEnvelope(JSON.parse(JSON.stringify(reorder(e))), reorder(a.publicKey)), "봉투·공개 키 재정렬 뒤 문자열 body 검증");
  ok(!await N.verifyEnvelope({ ...e, sig: "invalid" }, a.publicKey), "깨진 서명 거절");
  const receive = N.receiver(S, m => { applied.push(m.n); return C.reduce(S, m, 1, BG); });
  const claim = key => sign(key, team, { type: "claim", publicKey: key.publicKey });
  ok((await receive(await claim(a))).ok, "공개 키만으로 첫 착석");
  const high = await sign(a, team, { type: "ready", ready: true });
  ok((await receive(high)).ok, "등록 키 요청 반영");
  ok((await receive(high)).err === "replay", "같은 순번 거절");
  ok((await receive(e)).err === "replay", "작은 순번 거절");
  ok(!(await receive({ team, type: "ready", token: S.teams[team].token, ready: false })).ok, "원문·내부 지문을 알아도 봉투 없이는 거절");
  ok(!(await receive(await sign(b, team, { type: "ready", ready: false }))).ok, "다른 팀 서명으로 상태 수정 불가");
  ok((await receive(await claim(b))).err === "taken", "등록된 자리에 다른 키 claim은 taken으로 거절");
  await receive(await sign(a, ids[1], { type: "claim", publicKey: a.publicKey }));
  const renamed = { ...await sign(a, team, { type: "ready", ready: false }), team: ids[1] };
  ok(!(await receive(renamed)).ok, "대상 팀에도 같은 키 등록: 바깥 팀 이름 변조 거절");
  const secret = JSON.stringify(C.publicView(S, 2));
  for (const needle of [a.publicKey.x, a.publicKey.y, a.privateKey.d, S.teams[team].token, high.sig, '"publicKey"', '"privateKey"', '"sig"', '"token"', '"lastN"', '"lastNByType"']) ok(!secret.includes(needle), "공개 상태에서 인증 자료 제외: " + needle.slice(0, 12));
  const before = applied.length;
  const first = await sign(a, team, { type: "ready", ready: false });
  const second = await sign(a, team, { type: "ready", ready: true });
  const third = await sign(a, team, { type: "ready", ready: false });
  let active = 0, maxActive = 0;
  const delayed = N.receiver(S, m => { applied.push(m.n); return C.reduce(S, m, 3, BG); }, async (wire, key) => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, wire.body === second.body ? 20 : 1));
    const valid = await N.verifyEnvelope(wire, key); active--; return valid;
  });
  const results = await Promise.all([delayed(second), delayed(first), delayed(third)]);
  ok(results[0].ok && !results[1].ok && results[2].ok, "뒤섞인 같은 type 동시 도착: 단조 증가 순번만 반영");
  ok(maxActive === 1 && applied.slice(before).every((n, i, all) => i === 0 || n > all[i - 1]), "팀별 검증·반영 직렬 처리");
  const restored = JSON.parse(JSON.stringify(S));
  ok(!(await N.receiver(restored, m => C.reduce(restored, m, 4, BG))(third)).ok, "진행자 저장 복원 뒤 되풀이 거절");
  const restoredKey = JSON.parse(JSON.stringify(a));
  ok((await receive(await sign(restoredKey, team, { type: "hello" }, 1))).ok, "기기 키·순번 복원, 시계 역행에도 재접속");
  let resume;
  const held = N.receiver(S, m => C.reduce(S, m, 5, BG), async (wire, key) => { await new Promise(resolve => { resume = resolve; }); return N.verifyEnvelope(wire, key); });
  const pending = held(await sign(restoredKey, team, { type: "claim", publicKey: restoredKey.publicKey }));
  await new Promise(resolve => setImmediate(resolve));
  const preKick = await claim(a), oldN = S.teams[team].lastN;
  C.host(S, "kick", 6, team); resume();
  ok(!(await pending).ok, "검증 도중 kick: 이전 요청 반영 불가");
  ok(!S.teams[team].publicKey, "kick은 등록 키 삭제");
  ok(S.teams[team].retired[await N.fingerprint(a.publicKey)] === oldN, "kick은 retired에 마지막 순번 보존");
  ok((await receive(preKick)).err === "seat", "kick 이전 claim 봉투 거절");
  const cross = state("OTHER1");
  ok((await N.receiver(cross, m => C.reduce(cross, m, 1, BG))(preKick)).err === "session", "다른 방 봉투 거절");
  const rewind = { ...a, n: 0 };
  const low = await N.signEnvelope(rewind, team, { type: "claim", publicKey: a.publicKey, sid: S.sid, seat: S.teams[team].seatVersion }, 1);
  ok((await receive(low)).err === "replay", "같은 키 재착석도 retired 이하 순번 거절");
  ok((await receive(await claim(b))).ok, "kick 뒤 새 키 허용");
  const legacy = state(); C.reduce(legacy, { team, type: "claim", token: "legacy-seat" }, 0, BG);
  ok(!(await N.receiver(legacy, m => C.reduce(legacy, m, 0, BG))(await sign(a, team, { type: "claim", publicKey: a.publicKey, seat: 0 }))).ok, "옛 토큰 자리는 kick 없이 키로 교체 불가");
  C.host(legacy, "kick", 1, team);
  ok((await N.receiver(legacy, m => C.reduce(legacy, m, 2, BG))(await claim(a))).ok, "옛 자리 kick 뒤 새 키 착석");
  const internal = state();
  ok(C.reduce(internal, { type: "claim", team, token: "solo-city-" + team }, 0, BG).ok && C.reduce(internal, { type: "ready", team, token: "solo-city-" + team, ready: true }, 0, BG).ok, "혼자 하기의 내부 무서명 경로 유지");
}
async function floor4Network() {
  const S = state(), team = ids[0], key = await N.createIdentity();
  S.phase = "plan"; S.round = 1;
  const sign = (request, n) => N.signEnvelope({ ...key, n: 0 }, team,
    { sid: S.sid, seat: S.teams[team].seatVersion || 0, rd: S.round, ph: S.phase, ...request }, n);
  const receive = N.receiver(S, m => C.reduce(S, m, 1, BG));
  await receive(await sign({ type: "claim", publicKey: key.publicKey }, 1));
  const crit = await sign({ type: "crit", chips: ["rel"], line: 57, choice: "keep" }, 567);
  const ready = await sign({ type: "ready", ready: true }, 568);
  const readyResult = await receive(ready), critResult = await receive(crit);
  ok(readyResult.ok && critResult.ok && S.teams[team].ready && S.teams[team].crit.line === 57,
    "F4 ready(568) → crit(567) 역순 도착도 둘 다 반영");
  const oldCrit = await sign({ type: "crit", chips: ["pop"], line: 12, choice: "change" }, 566);
  ok((await receive(oldCrit)).err === "replay" && S.teams[team].crit.line === 57,
    "F4 같은 type 옛 n은 replay·기준 유지");
  const plan = { builds: [], lines: [] }, rev = S.teams[team].rev + 1;
  const planned = await sign({ type: "plan", plan, rev }, 569);
  const readyAgain = await sign({ type: "ready", ready: false }, 570);
  await receive(readyAgain);
  ok((await receive(planned)).ok && S.teams[team].rev === rev && S.teams[team].plan.lines.length === 0,
    "F4 준비 → 계획 역순 도착도 마지막 계획 반영");
  ok(S.teams[team].lastN === 570, "F4 역순 반영 뒤에도 퇴거용 최대 순번 보존");
  for (const type of ["hello", "plan", "econ", "crit", "ready"]) {
    const data = { hello: {}, plan: { plan, rev: rev + 1 }, econ: { taxRes: 1 },
      crit: { chips: ["pop"], line: 60, choice: "change" }, ready: { ready: true } }[type];
    const wire = await sign({ type, ...data }, 580);
    ok((await receive(wire)).ok, `F4 ${type}는 다른 type과 같은 n도 허용`);
    const restored = JSON.parse(JSON.stringify(S));
    const restoredReceive = N.receiver(restored, m => C.reduce(restored, m, 1, BG));
    for (const n of [580, 579]) ok((await restoredReceive(await sign({ type, ...data }, n))).err === "replay",
      `F4 ${type} 저장 복원 뒤 같거나 옛 n(${n}) replay`);
  }
  C.host(S, "kick", 2, team);
  ok((await receive(crit)).err === "seat", "F4 type 순번이 있어도 kick 이전 상태 봉투 거절");
  ok((await receive(await sign({ type: "claim", publicKey: key.publicKey }, 581))).ok,
    "F4 같은 키 재착석은 퇴거 순번보다 커야 허용");
  ok((await receive(await sign({ type: "hello" }, 580))).err === "replay",
    "F4 새 자리의 상태 요청도 retired 이하 차단");
  const otherKey = await N.createIdentity();
  C.host(S, "kick", 3, team);
  const signOther = (type, n) => N.signEnvelope({ ...otherKey, n: 0 }, team,
    { type, publicKey: otherKey.publicKey, sid: S.sid, seat: S.teams[team].seatVersion }, n);
  await receive(await signOther("claim", 1));
  ok((await receive(await signOther("hello", 2))).ok, "F4 새 키·자리에 이전 type 순번을 적용하지 않음");
}
async function hostSecurity() {
  const host = await N.createIdentity(), attacker = await N.createIdentity(), binding = await N.hostBinding(host.publicKey);
  const keyShuffle = value => Array.isArray(value) ? value.map(keyShuffle) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().reverse().map(k => [k, keyShuffle(value[k])])) : value;
  const fixtureKey = { kty: "EC", crv: "P-256", x: "fixture-x", y: "fixture-y" };
  const digest = require("node:crypto").createHash("sha256").update(N.canonical(fixtureKey)).digest();
  const bits = [...digest.subarray(0, 5)].map(x => x.toString(2).padStart(8, "0")).join("");
  const expected = Array.from({ length: 8 }, (_, i) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[parseInt(bits.slice(i * 5, i * 5 + 5), 2)]).join("");
  ok((await N.hostBinding(fixtureKey)).room === expected, "F3-8 기존 ALPHA 40비트 고정 벡터");
  ok(/^[A-HJ-NP-Z2-9]{8}$/.test(binding.room) && binding.fingerprint.length === 22, "공개 키에서 8자리 방 코드·22자 지문 파생");
  ok(JSON.stringify(await N.hostBinding(keyShuffle(host.publicKey))) === JSON.stringify(binding), "정규 공개 JWK는 키 순서 무관");
  const S = state(binding.room), V = C.publicView(S, 1); V.numericFixture = { a: 1, z: -0, nested: [0.0000001, 1e21, { b: 2, a: 1 }] };
  const wire = await N.signHost(host, "snap", S.room, S.sid, V);
  const transformed = JSON.parse(JSON.stringify(keyShuffle(wire)).replace('"a":1,', '"a":1.0,').replace('"z":0', '"z":-0'));
  let received = null, count = 0;
  const trust = { room: S.room }, receive = N.hostReceiver(trust, (event, data) => { received = data; count++; });
  ok(await receive("snap", transformed), "정규 JSON: 재귀 키 섞기 + JSON 왕복 + 1.0→1/-0→0 검증");
  ok(N.canonical(wire) === N.canonical(transformed), "파싱한 값이 같으면 정규 JSON 바이트도 동일");
  ok(trust.hostKey.x === host.publicKey.x && received.body.numericFixture.a === 1, "코드 결속·서명 확인 후 첫 진행자 키 고정");
  ok(!await receive("snap", wire) && count === 1, "진행자 옛 순번 재방송 거절");
  const tampered = structuredClone(wire); tampered.n++; tampered.data.body.phase = "end";
  ok(!await receive("snap", tampered) && count === 1, "진행자 서명 뒤 내용 변조 거절");
  ok(!await receive("nack", wire), "snap 봉투를 nack 이벤트로 전용 불가");
  ok(!await N.hostReceiver({ room: S.room }, () => {})("snap", await N.signHost(attacker, "snap", S.room, S.sid, V)), "첫 키도 방 코드와 다르면 거절");
  ok(!await receive("snap", await N.signHost(attacker, "snap", S.room, S.sid, V)), "고정 진행자 키와 다른 키 거절");
  ok(!await N.hostReceiver({ room: S.room, fingerprint: "wrong-link-fingerprint" }, () => {})("snap", wire), "링크 지문 불일치면 첫 키도 거절");
  ok(!await N.hostReceiver({ room: "AAAAAA" }, () => {})("snap", { ...wire, room: "AAAAAA" }), "방 코드 불일치 키 거절");
  ok(await N.hostReceiver({ room: S.room, fingerprint: binding.fingerprint }, () => {})("snap", wire), "링크 지문 일치 참가");
  // 단위4-A: 상한을 옛 200KB로 되돌리면 유효한 큰 서명 봉투 수용 단언이 실패해야 한다.
  // hostReceiver는 서명 봉투 전체, 팀 요청 receiver는 서명한 body의 UTF-8 바이트를 제한한다.
  {
    const requestKey = await N.createIdentity(), requestState = state(S.room), team = ids[0];
    let requestApplied = 0;
    const receiveRequest = N.receiver(requestState, m => {
      requestApplied++; return C.reduce(requestState, m, 1, BG);
    });
    const request = extra => N.signEnvelope(requestKey, team, { type: "ready", ready: true, sid: requestState.sid, seat: 0, ...extra });
    ok((await receiveRequest(await request({ type: "claim", publicKey: requestKey.publicKey }))).ok,
      "수신 상한 검사 준비: 팀 공개 키 착석");
    const padding = size => "가".repeat(Math.floor(size / 3)) + "x".repeat(size % 3);
    for (const size of [200001, 230000, 256000, 256001]) {
      const data = { room: S.room, sid: S.sid, padding: "" };
      const empty = await N.signHost(host, "snap", S.room, S.sid, data);
      data.padding = padding(size - Buffer.byteLength(JSON.stringify(empty), "utf8"));
      const frame = await N.signHost(host, "snap", S.room, S.sid, data);
      ok(Buffer.byteLength(JSON.stringify(frame), "utf8") === size, "진행자 서명 봉투 정확한 UTF-8 크기 " + size);
      let hostApplied = 0;
      const accepted = await N.hostReceiver({ room: S.room }, (event, received) => {
        if (event === "snap" && received.body.padding === data.padding) hostApplied++;
      })("snap", frame);
      ok(size <= 256000 ? accepted && hostApplied === 1 : !accepted && hostApplied === 0,
        "진행자 hostReceiver 수신 상한 " + size + "B: " + (size <= 256000 ? "수용" : "거절"));
      const emptyRequest = await request({ padding: "" });
      const content = padding(size - Buffer.byteLength(emptyRequest.body, "utf8"));
      const envelope = await request({ padding: content });
      ok(Buffer.byteLength(envelope.body, "utf8") === size, "팀 요청 body 정확한 UTF-8 크기 " + size);
      const before = requestApplied, result = await receiveRequest(envelope);
      ok(size <= 256000 ? result.ok && result.verified && requestApplied === before + 1 && result.request.padding === content :
        !result.ok && result.err === "bad" && requestApplied === before,
        "팀 요청 receiver 수신 상한 " + size + "B: " + (size <= 256000 ? "수용" : "거절"));
    }
  }
  const packed = N.compactSnapshot(V), expanded = N.expandSnapshot(structuredClone(packed));
  ok(N.canonical(expanded) === N.canonical(V), "건설 base·계통 entries 전송 축약은 무손실 복원");
  // 인위적으로 오래된 팀 기록만 키운다. 현재 계획과 최근 두 기록은 그대로 남아야 한다.
  const large = structuredClone(V); large.teams[ids[0]].hist = Array.from({ length: 40 }, (_, i) => ({ round: i, detail: "x".repeat(6000) }));
  const shrunk = N.compactSnapshot(large);
  // D-77: 크기는 전송 봉투, 보존 계약은 검증 뒤 복원한 공개 상태로 검사한다.
  const restoredShrunk = N.expandSnapshot(structuredClone(shrunk));
  ok(N.byteLength(shrunk) <= 178000 && restoredShrunk.teams[ids[0]].hist.at(-1).round === 39 && restoredShrunk.teams[ids[0]].hist.length < 40 && JSON.stringify(restoredShrunk.teams[ids[0]].plan) === JSON.stringify(large.teams[ids[0]].plan), "크기 위험 시 오래된 팀 기록부터 단계 축약");
}
async function transport() {
  const identity = await N.createIdentity(), team = ids[0];
  const make = (type, extra = {}) => N.signEnvelope(identity, team, { type, ...extra });
  const plan1 = await make("plan", { rev: 1 }), plan2 = await make("plan", { rev: 2 });
  const tie1 = await make("tie", { other: ids[1] }), tie2 = await make("tie", { other: ids[2] });
  const ev1 = await make("respond", { ev: "fixture-a" }), ev2 = await make("respond", { ev: "fixture-b" });
  const oldSocket = global.WebSocket, oldChannel = global.BroadcastChannel;
  const sockets = [], channels = [];
  class Socket {
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  class Channel {
    constructor() { channels.push(this); }
    postMessage(data) { channels.filter(c => c !== this).forEach(c => c.onmessage?.({ data: structuredClone(data) })); }
    close() {}
  }
  let online, localA, localB;
  try {
    global.WebSocket = Socket; global.BroadcastChannel = Channel;
    online = N.open({ kind: "supabase", room: "MOCK01", url: "https://fixture.supabase.co", key: "fixture-public-key" });
    const socket = sockets[0]; socket.onopen();
    for (const wire of [plan1, tie1, tie2, ev1, ev2, { ...plan2, type: "untrusted", other: "untrusted" }]) online.send("req", wire);
    const join = socket.sent.find(m => m.event === "phx_join");
    socket.onmessage({ data: JSON.stringify({ topic: join.topic, event: "phx_reply", ref: join.ref, payload: { status: "ok" } }) });
    const sent = socket.sent.filter(m => m.event === "broadcast");
    ok(sent.length === 5 && sent.filter(m => N.requestBody(m.payload.payload).type === "plan").every(m => N.requestBody(m.payload.payload).rev === 2), "끊김 큐: 같은 팀·요청만 최신 봉투 유지");
    ok(sent.filter(m => N.requestBody(m.payload.payload).type === "tie").length === 2 && sent.filter(m => N.requestBody(m.payload.payload).type === "respond").length === 2, "큐는 다른 연계선·사건 요청을 보존");
    ok(await N.verifyEnvelope(sent.at(-1).payload.payload, identity.publicKey), "큐·외부 비교 필드가 문자열 서명을 바꾸지 않음");
    let warns = 0; online.on("oversize", m => { if (m.ev === "snap") warns++; });
    const count = socket.sent.length;
    ok(online.send("snap", { text: "가".repeat(90000) }) === false && warns === 1 && socket.sent.length === count, "Supabase UTF-8 256,000바이트 초과는 전송 안 함·경고 이벤트");
    localA = N.open({ kind: "local", room: "MOCK02" }); localB = N.open({ kind: "local", room: "MOCK02" });
    let received; localB.on("req", m => { received = m; });
    localA.send("req", plan2);
    ok(await N.verifyEnvelope(received, identity.publicKey), "로컬 채널도 같은 서명 봉투");
    localA.on("oversize", () => warns++);
    ok(localA.send("snap", { text: "가".repeat(90000) }) === false && warns === 2, "로컬 초과도 경고 이벤트");
    const oversized = await N.signHost(identity, "snap", "MOCK01", "fixture-session", {
      teams: { [team]: { plan: { detail: "x".repeat(260000) },
        hist: Array.from({ length: 20 }, (_, r) => ({ r, detail: "x".repeat(1000) })) } }
    });
    ok(online.send("snap", oversized) === false && warns === 3 && socket.sent.length === count,
      "F3-6 두 차례 축약 뒤에도 전송 상한 초과 시 Supabase oversize·전송 차단");
    ok(localA.send("snap", oversized) === false && warns === 4,
      "F3-6 두 차례 축약 뒤에도 전송 상한 초과 시 로컬 oversize·전송 차단");
    // 네트워크 대신 메모리 모형만 사용한다. 안전하지 않은 문맥도 독립 VM에서 검사한다.
    const vm = require("node:vm"), fs = require("node:fs"), context = { window: { KCP: {} }, TextEncoder };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../ui/league-net.js"), "utf8"), context);
    ok(!context.window.KCP.leagueNet.secure(), "WebCrypto 없으면 안전한 연결 불가 판정");
    await assert.rejects(context.window.KCP.leagueNet.createIdentity()); checks++;
  } finally {
    online?.close(); localA?.close(); localB?.close();
    global.WebSocket = oldSocket; global.BroadcastChannel = oldChannel;
  }
}
async function uiProtocol() {
  const vm = require("node:vm"), fs = require("node:fs");
  const storage = () => { const values = new Map(); return { writes: 0, fail: false, getItem: k => values.get(k) || null, setItem(k, v) { if (this.fail) throw Error("full"); this.writes++; values.set(k, v); }, removeItem: k => values.delete(k), clear: () => values.clear() }; };
  const localStorage = storage(), sessionStorage = storage(), connections = [], timers = new Map(), events = {}, dom = {};
  let notices = [], cryptoAvailable = true, timerId = 0, uiNow = null;
  class UIDate extends Date { static now() { return uiNow ?? Date.now(); } }
  const net = { ...N, secure: () => cryptoAvailable, open() {
    const handlers = {}, sent = [], conn = { sent, on: (event, fn) => { handlers[event] = fn; }, onStatus() {}, close() {}, send: (event, payload) => { sent.push({ event, payload }); return true; }, emit: (event, payload) => handlers[event]?.(payload) };
    connections.push(conn); return conn;
  } };
  const uiK = { ...K, leagueNet: net, buildGame: { ...BG, toast: text => notices.push(text) }, route() {}, on() {} };
  const context = { window: { KCP: uiK, localStorage, sessionStorage, removeEventListener() {}, addEventListener: (e, fn) => { events[e] = fn; } }, document: { getElementById: id => dom[id] || null, addEventListener() {} }, location: { hash: "#league/team", origin: "https://fixture", pathname: "/" }, setInterval: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms, interval: true }); return id; }, clearInterval: id => timers.delete(id), setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: () => 0, cancelAnimationFrame() {}, structuredClone, TextEncoder, Date: UIDate, console, queueMicrotask, btoa, atob };
  const source = fs.readFileSync(path.resolve(__dirname, "../../ui/league.js"), "utf8");
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
    renderHost = () => {}; mountCity = () => { KCP.mounts = (KCP.mounts || 0) + 1; }; seatPicker = () => {}; renderPanel = () => {}; sendPlan = () => { KCP.planSends = (KCP.planSends || 0) + 1; };
    KCP.secUI = { normalizeRoom, newRoom, validRoom, displayRoom, onSnap, send, queueCrit, teamSave, teamView, hostView, hostInit, close, saveHost, flushHost, joinLink, replaySolo, s7data,
      replayFixture: () => { startSolo = (app, save) => { KCP.replayed = save; }; },
      set: value => { L = value; }, get: () => L };
  })();`), context);
  const ui = uiK.secUI, team = ids[0], hostIdentity = await N.createIdentity(), binding = await N.hostBinding(hostIdentity.publicKey), room = binding.room;
  const S = state(room), hostWire = (event, data) => N.signHost(hostIdentity, event, room, S.sid, data);
  const old = { room, team, net: { kind: "local" }, token: "legacy-seat" };
  sessionStorage.setItem("kcp-league-tab-v1", JSON.stringify(old));
  const teamApp = { isConnected: true, querySelector: selector => selector === "#lg-team-wait" ? {} : null };
  ui.teamView(teamApp); const conn = connections.at(-1);
  ok(ui.normalizeRoom(" abcd - efgh ") === "ABCDEFGH" && ui.newRoom("ABCDEFGH") && !ui.newRoom("ABCD") && ui.validRoom("ABCD") && ui.validRoom("ABCDEF") && ui.validRoom("ABCDEFGH") && ui.displayRoom("ABCDEFGH") === "ABCD-EFGH", "F3-8 코드 정규화·4-4 표시·옛 코드 신규 참가 금지");
  await conn.emit("snap", await hostWire("snap", C.publicView(S, Date.now()))); await ui.get().sending;
  ok(!uiK.mounts, "F3-4 첫 snap만으로 도시 화면을 붙이지 않음");
  const first = conn.sent.at(-1).payload, saved = JSON.parse(sessionStorage.getItem("kcp-league-tab-v1"));
  ok(saved.identity?.privateKey?.d && !Object.hasOwn(saved, "token") && await N.verifyEnvelope(first, saved.identity.publicKey), "옛 팀 저장: 진행자 검증 후 새 키 claim");
  ok(!JSON.stringify(first).includes(saved.identity.privateKey.d) && !JSON.stringify(first).includes(old.token), "UI 전송에 개인 키·옛 토큰 없음");
  const receive = N.receiver(S, m => C.reduce(S, m, 1, BG));
  ok((await receive(first)).ok, "UI claim을 진행자 실제 검증·reduce로 반영");
  await conn.emit("ack", await hostWire("ack", { ...N.requestBody(first) }));
  await conn.emit("snap", await hostWire("snap", C.publicView(S, Date.now())));
  ok(uiK.mounts > 0 && ui.get().claimAccepted, "F3-4 내 claim ack 뒤에만 도시 화면 표시");
  const phase = ui.get().snap.phase;
  const fake = C.publicView(S, Date.now()); fake.phase = "end"; fake.teams[team].seated = false;
  dom["lg-conn"] = { textContent: "", dataset: {} };
  await conn.emit("snap", fake);
  ok(ui.get().snap.phase === phase && ui.get().team === team && !ui.get().hostWarning, "무서명 snap 거절·정상 메시지 10초 이내는 연결 유지");
  const evil = await N.createIdentity();
  await conn.emit("snap", await N.signHost(evil, "snap", room, S.sid, fake));
  ok(ui.get().snap.phase === phase && !ui.get().hostWarning, "공격자 키로 서명한 snap 거절·10초 이내 연결 유지");
  const badNack = { team, type: "claim", err: "taken", kid: await N.fingerprint(evil.publicKey), n: N.requestBody(first).n };
  await conn.emit("nack", badNack);
  await conn.emit("nack", await hostWire("nack", badNack));
  ok(ui.get().team === team && notices.length === 0, "위조 nack·다른 kid의 서명된 nack 무시");
  const ownKid = await N.fingerprint(saved.identity.publicKey);
  for (const err of ["signature", "replay", "seat"]) await conn.emit("nack", await hostWire("nack", { ...badNack, kid: ownKid, err }));
  ok(ui.get().team === team, "signature/replay/seat nack은 자리 유지");
  ui.send("price", { price: 0.2 }); await ui.get().sending;
  const request = N.requestBody(conn.sent.at(-1).payload);
  for (let i = 0; i < 4; i++) {
    const latest = N.requestBody(conn.sent.at(-1).payload);
    await conn.emit("nack", await hostWire("nack", { ...latest, err: "replay", current: { rd: 99, ph: "plan" } }));
    await ui.get().sending;
  }
  const attempts = conn.sent.map(x => N.requestBody(x.payload)).filter(m => m.id === request.id);
  ok(attempts.length === 4 && attempts.every((m, i) => !i || m.n > attempts[i - 1].n) && !ui.get().pendingRequests.size, "요청 id별 replay 새 순번 최대 3회 재전송");
  ok(attempts.every(m => m.rd === request.rd && m.ph === request.ph && m.born === request.born), "F3-2 replay는 원래 rd·ph·born 유지");
  ui.send("price", { price: 0.25 }); await ui.get().sending;
  const stale = N.requestBody(conn.sent.at(-1).payload), beforeStale = conn.sent.length;
  await conn.emit("nack", await hostWire("nack", { ...stale, err: "stale", current: { rd: 99, ph: "plan" } }));
  await ui.get().sending;
  ok(conn.sent.length === beforeStale && !ui.get().pendingRequests.has(stale.id) && notices.at(-1).includes("지난 단계 요청"), "F3-2 stale은 재전송 없이 사용자 재확인");
  ui.send("price", { price: 0.3 }); await ui.get().sending;
  const goodPrice = conn.sent.at(-1).payload;
  const waiting = N.requestBody(goodPrice);
  for (const reply of [{ ...waiting, n: waiting.n - 1 }, { ...waiting, id: "wrong-id" }, { ...waiting, kid: "wrong-kid" }]) await conn.emit("ack", await hostWire("ack", reply));
  await conn.emit("nack", await hostWire("nack", { ...waiting, err: "signature" }));
  ok(ui.get().pendingRequests.has(waiting.id), "다른 n/id/kid ack·인증 전 signature nack은 대기 요청을 취소하지 않음");
  ok((await receive(goodPrice)).ok, "한 번짜리 요청 반영");
  const originalRev = S.rev, goodBody = N.requestBody(goodPrice);
  saved.identity.n = goodBody.n;
  const duplicate = await N.signEnvelope(saved.identity, team, { ...goodBody, n: undefined });
  ok((await receive(duplicate)).ok && S.rev === originalRev, "같은 요청 id 재전송은 중복 적용 안 함");
  await conn.emit("ack", await hostWire("ack", goodBody));
  ok(!ui.get().pendingRequests.size, "자기 kid·요청 id·n ack만 대기 해제");
  await conn.emit("snap", await hostWire("snap", C.publicView(S, Date.now())));
  const unchangedSeat = C.publicView(S, Date.now()); unchangedSeat.teams[team].seated = false;
  await conn.emit("snap", await hostWire("snap", unchangedSeat));
  ok(ui.get().team === team, "진행자 서명 snap도 seatVersion 변화 없이는 자리 해제 안 함");
  await conn.emit("snap", await hostWire("snap", C.publicView(S, Date.now())));
  for (const type of ["tie", "respond", "research", "license", "joint"]) {
    ui.send(type, { other: ids[1], ev: "fixture" }); await ui.get().sending;
    const body = N.requestBody(conn.sent.at(-1).payload);
    ok(body.id && ui.get().pendingRequests.has(body.id), type + "도 요청 id별 ack 대기");
    await conn.emit("ack", await hostWire("ack", body));
    ok(!ui.get().pendingRequests.has(body.id), type + " ack 후 대기 해제");
  }
  const tick = () => [...timers.values()].find(t => t.ms === 5000 && t.interval).fn();
  uiNow = Date.now();
  const originalSnap = ui.get().snap;
  ui.get().snap = structuredClone(originalSnap); ui.get().snap.phase = "plan";
  ui.get().snap.teams[team].ready = false;
  const stateFields = { ready: "wantReady", crit: "pendingCrit", econ: "pendingPol" };
  for (const [type, field] of Object.entries(stateFields)) {
    const extra = type === "ready" ? { ready: true } : type === "crit"
      ? { chips: ["rel"], line: 57, choice: "keep" } : { taxRes: 1 };
    if (type === "econ") ui.get().pendingPol = extra;
    ui.send(type, extra); await ui.get().sending;
    const previous = N.requestBody(conn.sent.at(-1).payload);
    const next = type === "ready" ? { ready: false } : { ...extra, ...(type === "crit" ? { line: 58 } : { taxRes: 2 }) };
    if (type === "econ") ui.get().pendingPol = next;
    ui.send(type, next); await ui.get().sending;
    const current = N.requestBody(conn.sent.at(-1).payload), value = ui.get()[field];
    for (const reply of [previous, { ...current, n: current.n + 1 }, { ...current, kid: "wrong" }, { ...current, team: ids[1] }])
      await conn.emit("ack", await hostWire("ack", reply));
    ok(ui.get()[field] === value, "F4 이전·다른 대상 ack는 새 " + type + " 대기를 보존");
    await conn.emit("ack", await hostWire("ack", current));
    ok(ui.get()[field] === null, "F4 최신 상태 ack만으로 " + type + " 대기 해제(스냅 없음)");
  }
  // 최신 편집이 아직 서명 대기 중일 때도 이전 ack가 이를 완료 처리하면 안 된다.
  const oldReady = N.requestBody(conn.sent.findLast(x => N.requestBody(x.payload).type === "ready").payload);
  let releaseSigning;
  ui.get().sending = new Promise(resolve => { releaseSigning = resolve; });
  ui.send("ready", { ready: false });
  await conn.emit("ack", await hostWire("ack", oldReady));
  ok(ui.get().wantReady === false && !ui.get().stateRequests.ready.acked,
    "F4 서명 대기 중 이전 ack는 같은 값의 새 요청도 보존");
  releaseSigning(); await ui.get().sending;
  ui.send("hello"); ui.send("plan", { plan: S.teams[team].plan, rev: S.teams[team].rev + 1 });
  ui.send("ready", { ready: true });
  ui.send("crit", { chips: ["rel"], line: 60, choice: "keep" });
  ui.get().pendingPol = { taxRes: 1 }; ui.send("econ", ui.get().pendingPol);
  await ui.get().sending;
  ui.get().rev = ui.get().snap.teams[team].rev + 1;
  const beforeCooldown = conn.sent.length, beforePlans = uiK.planSends || 0;
  uiNow += 1999; tick(); await ui.get().sending;
  ok(conn.sent.length === beforeCooldown && (uiK.planSends || 0) === beforePlans,
    "F4 1999ms 안에는 모든 상태 type 타이머 재전송 없음");
  uiNow++; tick(); await ui.get().sending;
  const retriedTypes = conn.sent.slice(beforeCooldown).map(x => N.requestBody(x.payload).type);
  ok(["hello", "econ", "crit", "ready"].every(type => retriedTypes.includes(type)) && uiK.planSends === beforePlans + 1,
    "F4 2000ms부터 미확인 상태 요청 재전송");
  for (const type of ["plan", "econ", "crit", "ready"]) {
    const body = N.requestBody(conn.sent.findLast(x => N.requestBody(x.payload).type === type).payload);
    await conn.emit("ack", await hostWire("ack", body));
  }
  const beforeAckTick = conn.sent.length, plansAfterAck = uiK.planSends;
  uiNow += 5000; tick(); await ui.get().sending;
  ok(uiK.planSends === plansAfterAck && conn.sent.slice(beforeAckTick).every(x => N.requestBody(x.payload).type === "hello"),
    "F4 ack 후 계획 재전송 중단·나머지 상태 대기 해제·hello 접속 확인 유지");
  ui.queueCrit({ chips: ["rel"], line: 61, choice: "keep" });
  const beforeEditTick = conn.sent.length;
  tick(); await ui.get().sending;
  ok(conn.sent.slice(beforeEditTick).some(x => { const m = N.requestBody(x.payload); return m.type === "crit" && m.line === 61; }),
    "F4 이전 ack 뒤 아직 보내지 않은 기준 편집도 타이머 전송");
  ui.get().pendingCrit = null;
  ui.get().snap = originalSnap; ui.get().stateRequests = {}; uiNow = null;
  ui.send("price", { price: 0.4 }); await ui.get().sending;
  const timeoutBody = N.requestBody(conn.sent.at(-1).payload), pending = ui.get().pendingRequests.get(timeoutBody.id);
  // Q8 연결 안내 문턱 둘(D-77): 진행자 메시지(ack 포함) 10초, 받아들인 공개 상태 20초.
  const warnAt = (host, snapAgo) => { const L = ui.get(); L.hostWarning = false; L.lastHostAt = Date.now() - host; L.lastSnapAt = Date.now() - snapAgo; tick(); return L.hostWarning; };
  ok(!warnAt(5000, 15000), "Q8 ack는 오고 공개 상태만 15초 밀리면 안내 없음");
  ok(warnAt(5000, 21000), "Q8 공개 상태 20초 없음 안내(형식이 안 맞는 snap만 오는 판본 혼재)");
  ok(warnAt(11000, 1000), "Q8 진행자 메시지 10초 없음 안내");
  // 새로고침 권유는 30초부터(짧은 밀림에 새로고침을 부추기지 않는다).
  const REFRESH = " · 새로고침하면 다시 연결됩니다";
  ok(warnAt(29000, 29000) && dom["lg-conn"].textContent === "진행자 화면과 연결을 확인하는 중", "Q8 30초 전 안내에는 새로고침 권유 없음");
  ok(warnAt(31000, 1000) && dom["lg-conn"].textContent.endsWith(REFRESH), "Q8 진행자 메시지 30초 넘게 없으면 새로고침 권유");
  ok(warnAt(5000, 31000) && dom["lg-conn"].textContent.endsWith(REFRESH), "Q8 공개 상태만 30초 넘게 없어도(판본 혼재) 새로고침 권유");
  await ui.get().sending; ui.get().lastSnapAt = Date.now(); ui.get().stateRequests = {};
  ui.get().lastHostAt = Date.now() - 11000; ui.get().hostWarning = true; pending.sentAt = Date.now() - 6000;
  ui.get().rev = ui.get().snap.teams[team].rev + 1;
  for (let i = 0; i < 20; i++) await conn.emit("snap", { ...await hostWire("snap", fake), sig: "invalid" });
  const beforeTick = conn.sent.length; tick(); await ui.get().sending;
  const tickBodies = conn.sent.slice(beforeTick).map(x => N.requestBody(x.payload));
  ok(ui.get().hostWarning && tickBodies.some(m => m.type === "hello") && tickBodies.some(m => m.id === timeoutBody.id) && uiK.planSends > 0, "F3-1 위조 snap 연타·경고 중 hello·계획·대기 재전송 계속");
  ok(tickBodies.find(m => m.id === timeoutBody.id).born === timeoutBody.born, "F3-2 시간 초과도 원래 born 보존");
  ui.get().claimAccepted = false; ui.get().claimAfter = 0;
  tick(); await ui.get().sending;
  const reclaim = N.requestBody(conn.sent.at(-1).payload);
  ok(reclaim.type === "claim", "F3-1 경고 중에도 claim 재시도");
  await conn.emit("ack", await hostWire("ack", reclaim));
  const beforeRestart = N.requestBody(conn.sent.findLast(x => N.requestBody(x.payload)?.id === timeoutBody.id).payload);
  S.sid = N.sessionId(); S.round = 1; S.phase = "plan";
  await conn.emit("snap", await hostWire("snap", C.publicView(S, Date.now()))); await ui.get().sending;
  const afterRestart = N.requestBody(conn.sent.at(-1).payload);
  ok(afterRestart.id === beforeRestart.id && afterRestart.sid === S.sid && afterRestart.n > beforeRestart.n && afterRestart.born === beforeRestart.born && afterRestart.rd === beforeRestart.rd && afterRestart.ph === beforeRestart.ph, "F3-11 새 sid snap 뒤 원래 rd·ph·born으로 대기 요청 재서명");
  ok((await receive(conn.sent.at(-1).payload)).err === "stale", "F3-2 재시작 중 달 변경은 stale로 거절");
  ui.get().pendingRequests.clear();
  for (let i = 0; i < 33; i++) ui.send("price", { price: 0.1 });
  await ui.get().sending;
  ok(ui.get().pendingRequests.size === 32, "F3-10 팀 대기 요청 상한 32");
  ui.get().pendingRequests.clear();
  const identityBefore = ui.get().identity.privateKey.d;
  ui.close(); ui.teamView({}); const restoredConn = connections.at(-1);
  await restoredConn.emit("snap", await hostWire("snap", C.publicView(S, Date.now()))); await ui.get().sending;
  ok(ui.get().identity.privateKey.d === identityBefore && ui.get().hostKey.x === hostIdentity.publicKey.x, "새로고침에 팀 키·고정 진행자 키 보존");
  const restoredClaim = N.requestBody(restoredConn.sent.at(-1).payload);
  await restoredConn.emit("ack", await hostWire("ack", restoredClaim));
  C.host(S, "kick", 6, team);
  const replacement = await N.createIdentity();
  await receive(await N.signEnvelope(replacement, team, { type: "claim", publicKey: replacement.publicKey, sid: S.sid, seat: S.teams[team].seatVersion }));
  await restoredConn.emit("snap", await hostWire("snap", C.publicView(S, Date.now())));
  ok(ui.get().team === null, "F3-4 kick 직후 새 기기 재착석·seated=true여도 옛 기기 해제");
  for (const err of ["taken", "legacy"]) {
    ui.get().team = team; ui.get().claimAccepted = false; ui.get().claimAfter = 0;
    ui.send("claim"); await ui.get().sending;
    const claimBody = N.requestBody(restoredConn.sent.at(-1).payload);
    await restoredConn.emit("nack", await hostWire("nack", { ...claimBody, err }));
    const count = restoredConn.sent.length;
    [...timers.values()].find(t => t.ms === 5000 && t.interval).fn(); await ui.get().sending;
    ok(ui.get().team === null && !ui.get().claimAccepted && ui.get().claimAfter > Date.now() + 20000 && restoredConn.sent.length === count, "F3-4 " + err + " 자리 선택으로 복귀·claim 지연·토스트 반복 없음");
  }
  ui.close(); cryptoAvailable = false;
  const app = {}; ui.teamView(app);
  ok(app.innerHTML.includes("이 주소에서는 안전한 연결을 만들 수 없어요") && !ui.get(), "WebCrypto 없음: 팀 경고");
  await ui.hostView(app);
  ok(app.innerHTML.includes("이 주소에서는 팀이 앉을 수 없어요"), "WebCrypto 없음: 진행자 경고");
  cryptoAvailable = true;
  ui.teamView({}); const failureConn = connections.at(-1);
  await failureConn.emit("snap", await hostWire("snap", C.publicView(S, Date.now())));
  ui.get().team = team; sessionStorage.fail = true;
  const beforeSend = failureConn.sent.length;
  ui.send("claim"); await ui.get().sending;
  ok(failureConn.sent.length === beforeSend && notices.at(-1).includes("안전한 연결"), "팀 키 저장 실패는 전송 중단");
  sessionStorage.fail = false; ui.close();
  C.host(S, "kick", 7, team);
  localStorage.setItem("kcp-league-host-v1", JSON.stringify({ room, net: { kind: "local" }, state: S, identity: hostIdentity, fingerprint: binding.fingerprint }));
  await ui.hostInit(); const host = connections.at(-1), H = ui.get().S;
  const sign = type => N.signEnvelope(saved.identity, team, { type, publicKey: saved.identity.publicKey, sid: H.sid, seat: H.teams[team].seatVersion });
  await host.emit("req", await sign("claim"));
  const beforeUnsigned = host.sent.length;
  for (let i = 0; i < 8; i++) await host.emit("req", { team, body: JSON.stringify({ team, type: "claim", kid: ownKid, n: saved.identity.n + 1000 + i, sid: H.sid, seat: H.teams[team].seatVersion, publicKey: saved.identity.publicKey }), sig: "invalid" });
  ok(host.sent.length === beforeUnsigned, "F3-3 UI 서명 없는 요청은 서명 nack 방송 없음");
  const writes = localStorage.writes;
  let hello;
  for (let i = 0; i < 10; i++) { hello = await sign("hello"); await host.emit("req", hello); }
  ok(localStorage.writes === writes && [...timers.values()].filter(t => t.ms === 1000 && !t.interval).length === 1, "검증된 요청 10개: 전체 저장은 1초 디바운스 한 번");
  timers.get(ui.get().hostSaveT).fn();
  ok(localStorage.writes === writes + 1 && JSON.parse(localStorage.getItem("kcp-league-host-v1")).state.teams[team].lastN === N.requestBody(hello).n, "디바운스 저장에 마지막 순번 반영");
  dom["lg-host-warning"] = { textContent: "" };
  localStorage.fail = true; ui.flushHost();
  ok(ui.get().saveWarning && dom["lg-host-warning"].textContent.includes("진행을 저장하지 못했어요"), "진행자 저장 실패 경고");
  ui.saveHost(); ok(ui.get().saveWarning, "다시 성공할 때까지 저장 경고 유지");
  localStorage.fail = false; events.pagehide();
  ok(!ui.get().saveWarning && !ui.get().hostSaveT, "pagehide 즉시 저장 성공·경고 해제");
  const storedHost = JSON.parse(localStorage.getItem("kcp-league-host-v1"));
  const link = JSON.parse(Buffer.from(ui.joinLink().split("j=")[1], "base64url").toString());
  ok(link.f === binding.fingerprint && link.r === room, "참가 링크에 132비트 지문 포함");
  ui.close(); await ui.hostInit();
  ok(ui.get().identity.privateKey.d === storedHost.identity.privateKey.d && ui.get().room === room, "진행자 새로고침·이어서 진행에 같은 키·코드");
  ok(ui.get().S.sid !== storedHost.state.sid, "F3-11 진행자 시작마다 새 sid");
  const h2 = connections.at(-1); await h2.emit("req", hello);
  const reply = h2.sent.at(-1).payload;
  ok(reply.event === "nack" && reply.data.err === "session" && reply.data.kid === ownKid && reply.data.n === N.requestBody(hello).n, "진행자 session 거절도 대상 kid·n 포함 서명 nack");
  const failedSid = ui.get().S.sid;
  const lostEnvelope = await N.signEnvelope(saved.identity, team, { type: "price", price: 0.3, sid: failedSid, seat: ui.get().S.teams[team].seatVersion, id: "lost-write" });
  localStorage.fail = true;
  await h2.emit("req", lostEnvelope); ui.flushHost(); ui.close();
  localStorage.fail = false; await ui.hostInit();
  const recovered = connections.at(-1), recoveredRev = ui.get().S.rev;
  await recovered.emit("req", lostEnvelope);
  ok(ui.get().S.sid !== failedSid && ui.get().S.rev === recoveredRev && recovered.sent.at(-1).payload.data.err === "session", "F3-11 저장 실패·재시작 뒤 이전 봉투 반영 금지");
  ui.close();
  const legacy = state("OLD42"); legacy.round = 7;
  localStorage.setItem("kcp-league-host-v1", JSON.stringify({ room: legacy.room, net: { kind: "local" }, state: legacy }));
  await ui.hostInit();
  ok(ui.get().room.length === 8 && ui.get().room !== legacy.room && ui.get().S.round === 7 && ui.get().migration.includes("새 코드로 다시 참가"), "예전 방은 상태 보존·새 키·새 코드·재참가 안내");
  ui.close();
  localStorage.setItem("kcp-league-host-v1", JSON.stringify({ room: "OLD42", net: { kind: "local" }, state: { region: "south" } }));
  await assert.doesNotReject(() => ui.hostView({}), "F3-9 teams 없는 옛 저장 hostView"); checks++;
  ok(ui.get().S.teams && typeof ui.get().S.sid === "string", "F3-9 teams 없는 옛 저장 hostView 복구");
  ui.close();
  localStorage.setItem("kcp-league-host-v1", JSON.stringify({ room, net: { kind: "local" }, identity: hostIdentity, state: { region: "broken", sid: "old" } }));
  await ui.hostInit();
  ok(typeof ui.get().S.sid === "string" && ui.get().S.sid !== "old", "F3-9 검증 실패 새 저장 대체 상태 sid");
  ui.close();
  const priorData = { journal: { fixture: "가상 일지" }, docs: {}, interview: { answer: "가상 답변" } };
  localStorage.clear(); // 앞선 승인 세션의 같은 방·팀 자료와 격리한다(가짜 저장소만 초기화).
  localStorage.setItem("kcp-league-data-v1:OLD42:" + team, JSON.stringify(priorData));
  sessionStorage.setItem("kcp-league-tab-v1", JSON.stringify({ room, net: { kind: "local" }, team, migrationFrom: { room: "OLD42", team } }));
  ui.teamView({}); const migrated = connections.at(-1);
  await migrated.emit("snap", await hostWire("snap", C.publicView(S, Date.now()))); await ui.get().sending;
  const migratedClaim = N.requestBody(migrated.sent.at(-1).payload);
  await migrated.emit("ack", await hostWire("ack", migratedClaim));
  ok(localStorage.getItem("kcp-league-data-v1:" + room + ":" + team) === JSON.stringify(priorData) && localStorage.getItem("kcp-league-data-v1:OLD42:" + team), "F3-9 같은 팀 새 방 참가 때 일지·답변 복사·옛 키 보존");
  ui.close();
  // S7 분리 뒤에도 빈 컨테이너는 이전을 막지 않고, 새 방 학생 자료는 덮어쓰지 않는다.
  const teamKey = "kcp-league-data-v1:" + room + ":" + team;
  const s7Key = "kcp-league-s7-v1:" + room + ":" + team;
  const occupiedData = { docs: {}, journal: { fixture: "가상 새 방 일지" },
    interview: { answer: "가상 새 방 답변" } };
  const planState = state(room); planState.sid = S.sid; C.host(planState, "next", 0);
  const planSnap = C.publicView(planState, Date.now()), planIntl = planSnap.econ.intl.cur || planSnap.econ.intl;
  ok(planSnap.phase === "plan" && Number.isFinite(planIntl.fuelMul), "F3-9 이전 검사에 실제 plan 국제 지수 사용");
  for (const [label, destination] of [["빈 docs·journal", { docs: {}, journal: {} }],
    ["C 안내·rev만 있음", { guideSeen: true, rev: 0 }],
    ["D 새 방 학생 일지", occupiedData], ["새 방 키 없음", null]]) {
    localStorage.clear();
    localStorage.setItem("kcp-league-data-v1:OLD42:" + team, JSON.stringify(priorData));
    if (destination) localStorage.setItem(teamKey, JSON.stringify(destination));
    sessionStorage.setItem("kcp-league-tab-v1", JSON.stringify({ room, net: { kind: "local" }, team,
      migrationFrom: { room: "OLD42", team } }));
    ui.teamView({}); const joined = connections.at(-1);
    await joined.emit("snap", await hostWire("snap", planSnap)); await ui.get().sending;
    const claim = N.requestBody(joined.sent.at(-1).payload);
    ok(!ui.get().claimAccepted && claim.type === "claim", "F3-9 " + label + " plan snap 수신 후 승인 대기");
    const beforeAck = JSON.parse(localStorage.getItem(teamKey) || "{}");
    ok(!Object.hasOwn(beforeAck, "outageSnapshots") && !Object.hasOwn(beforeAck, "outageOperatingIntl"),
      "F3-9 " + label + " 승인 전 plan snap이 팀 자료 키에 S7 필드를 만들지 않음");
    ok(localStorage.getItem(s7Key) === null &&
      localStorage.getItem(teamKey) === (destination ? JSON.stringify(destination) : null),
      "F3-9 " + label + " 승인 전 plan snap은 S7 키도 만들지 않고 팀 자료 그대로");
    await joined.emit("ack", await hostWire("ack", claim));
    ok(ui.get().claimAccepted, "F3-9 " + label + " 실제 서명 claim ack 승인");
    await joined.emit("snap", await hostWire("snap", planSnap));
    const afterAckS7 = JSON.parse(localStorage.getItem(s7Key) || "{}");
    ok(N.canonical(afterAckS7.outageOperatingIntl) === N.canonical({ round: planSnap.round, intl: planIntl }),
      "F3-9 " + label + " 승인 뒤 plan snap의 국제 지수는 S7 키에 정확히 저장");
    const afterAck = JSON.parse(localStorage.getItem(teamKey) || "{}");
    ok(!Object.hasOwn(afterAck, "outageSnapshots") && !Object.hasOwn(afterAck, "outageOperatingIntl"),
      "F3-9 " + label + " 승인 뒤에도 팀 자료 키에는 S7 필드 없음");
    ok(localStorage.getItem(teamKey) === JSON.stringify(destination === occupiedData ? occupiedData : priorData),
      "F3-9 " + label + (destination === occupiedData ? " 기존 일지·답변 덮어쓰기 금지" : " 옛 자료 전체 정확히 복사"));
    ok(localStorage.getItem("kcp-league-data-v1:OLD42:" + team) === JSON.stringify(priorData),
      "F3-9 " + label + " 옛 방 자료 원본 보존");
    ui.close();
  }
  // 이전 자체의 사본 보존은 lobby에서 검사한다. plan 수신이 국제 지수를 갱신하는 동작과 분리한다.
  const oldTeamKey = "kcp-league-data-v1:OLD42:" + team;
  const oldS7Key = "kcp-league-s7-v1:OLD42:" + team;
  const oldCopies = { outageSnapshots: { 1: { round: 1, fixture: "가상 옛 방 사본", unsPct: 3.25 } },
    outageOperatingIntl: { round: 2, intl: { fuelMul: 1.1 } } };
  const newCopies = { outageSnapshots: { 2: { round: 2, fixture: "가상 새 방 사본", unsPct: 1.75 } },
    outageOperatingIntl: { round: 3, intl: { fuelMul: 1.2 } } };
  const lobbyState = state(room); lobbyState.sid = S.sid;
  const lobbySnap = C.publicView(lobbyState, Date.now());
  ok(lobbySnap.phase === "lobby", "F3-9 사본 보존 검사는 plan 갱신 없는 lobby");
  for (const scenario of [
    { label: "A 새 방 분리 전 사본만", destination: { docs: {}, journal: {}, ...newCopies }, expectedS7: newCopies },
    { label: "B 옛 방 분리 키 따라옴", sourceS7: oldCopies, expectedS7: oldCopies },
    { label: "B 새 방 분리 키 우선", sourceS7: oldCopies, destinationS7: newCopies, expectedS7: newCopies },
    { label: "E 옛 팀 자료의 S7 분리", source: { ...priorData, ...oldCopies }, expectedS7: oldCopies },
    { label: "F 분리 키와 잔여 S7 공존", destination: { ...occupiedData, ...oldCopies },
      destinationS7: newCopies, expectedS7: newCopies, readS7: true }
  ]) {
    localStorage.clear();
    const sourceData = scenario.source || priorData;
    localStorage.setItem(oldTeamKey, JSON.stringify(sourceData));
    if (scenario.sourceS7) localStorage.setItem(oldS7Key, JSON.stringify(scenario.sourceS7));
    if (scenario.destination) localStorage.setItem(teamKey, JSON.stringify(scenario.destination));
    if (scenario.destinationS7) localStorage.setItem(s7Key, JSON.stringify(scenario.destinationS7));
    sessionStorage.setItem("kcp-league-tab-v1", JSON.stringify({ room, net: { kind: "local" }, team,
      migrationFrom: { room: "OLD42", team } }));
    ui.teamView({}); const joined = connections.at(-1);
    await joined.emit("snap", await hostWire("snap", lobbySnap)); await ui.get().sending;
    const claim = N.requestBody(joined.sent.at(-1).payload);
    ok(!ui.get().claimAccepted && claim.type === "claim", "F3-9 " + scenario.label + " 승인 대기");
    ok(localStorage.getItem(teamKey) === (scenario.destination ? JSON.stringify(scenario.destination) : null) &&
      localStorage.getItem(s7Key) === (scenario.destinationS7 ? JSON.stringify(scenario.destinationS7) : null),
      "F3-9 " + scenario.label + " 승인 전에는 기존 저장 내용 그대로");
    await joined.emit("ack", await hostWire("ack", claim));
    ok(ui.get().claimAccepted, "F3-9 " + scenario.label + " 서명 claim ack 승인");
    if (scenario.readS7) {
      ok(localStorage.getItem(teamKey) === JSON.stringify(scenario.destination),
        "F3-9 F s7data 읽기 전에는 학생 일지와 잔여 S7 유지");
      ok(N.canonical(ui.s7data()) === N.canonical(newCopies), "F3-9 F s7data는 기존 분리 키 사본 반환");
    }
    const actualTeam = JSON.parse(localStorage.getItem(teamKey) || "{}");
    ok(N.canonical(actualTeam) === N.canonical(scenario.readS7 ? occupiedData : priorData),
      "F3-9 " + scenario.label + " 일지·답변 전체 정확히 " + (scenario.readS7 ? "유지" : "복사"));
    ok(!Object.hasOwn(actualTeam, "outageSnapshots") && !Object.hasOwn(actualTeam, "outageOperatingIntl"),
      "F3-9 " + scenario.label + " 팀 자료 키에서 S7 필드 제거");
    ok(N.canonical(JSON.parse(localStorage.getItem(s7Key) || "{}")) === N.canonical(scenario.expectedS7),
      "F3-9 " + scenario.label + " S7 사본 전체 보존·기존 분리 키 덮어쓰기 금지");
    ok(localStorage.getItem(oldTeamKey) === JSON.stringify(sourceData) &&
      localStorage.getItem(oldS7Key) === (scenario.sourceS7 ? JSON.stringify(scenario.sourceS7) : null),
      "F3-9 " + scenario.label + " 옛 방 팀 자료·S7 키 원본 보존");
    ui.close();
  }
  // 단위3-C: 실제 팀 부팅·서명·진행자 수신기를 기존 메모리 송수신 장치로 잇는다.
  const resumeKey = await N.createIdentity(), resumeState = state(room);
  C.host(resumeState, "kick", 1, team);
  const seat = resumeState.teams[team].seatVersion;
  ok(seat > 0, "3-C 저장 seat 검사는 0이 아닌 자리 버전 사용");
  await N.receiver(resumeState, m => C.reduce(resumeState, m, 2, BG))(
    await N.signEnvelope(resumeKey, team, { type: "claim", publicKey: resumeKey.publicKey, sid: resumeState.sid, seat }));
  localStorage.setItem("kcp-league-host-v1", JSON.stringify({
    room, net: { kind: "local" }, state: resumeState, identity: hostIdentity, fingerprint: binding.fingerprint
  }));
  await ui.hostInit();
  const resumeHost = ui.get(), resumeHostConn = connections.at(-1);
  const resumeSave = { room, team, net: { kind: "local" }, identity: resumeKey,
    hostKey: hostIdentity.publicKey, sid: resumeHost.S.sid, seat };
  const bootResume = save => {
    sessionStorage.setItem("kcp-league-tab-v1", JSON.stringify(save));
    ui.teamView(teamApp);
    return connections.at(-1);
  };
  const sendBeforeSnap = () => {
    for (const type of ["hello", "claim", "plan", "econ", "crit", "ready", "price", "verdict"])
      ui.send(type, type === "crit" ? { chips: ["rel"], line: 57, choice: "keep" } : {});
  };
  ui.set(null);
  const earlyConn = bootResume(resumeSave), earlySession = ui.get();
  ui.teamView(teamApp); sendBeforeSnap(); await earlySession.sending;
  ok(!earlySession.snap && earlyConn.sent.length === 1 && N.requestBody(earlyConn.sent[0].payload).type === "claim",
    "3-C 첫 상태 전에는 동시 호출·재렌더에도 claim 한 번만 송신");
  const earlyEnvelope = earlyConn.sent[0].payload, earlyBody = N.requestBody(earlyEnvelope);
  ok(earlyBody.sid === resumeSave.sid && earlyBody.seat === seat &&
    await N.verifyEnvelope(earlyEnvelope, resumeKey.publicKey), "3-C 탭 저장 sid·seat를 실제 서명에 사용");
  uiNow = Date.now() + 35000; tick(); sendBeforeSnap(); await earlySession.sending; uiNow = null;
  ok(earlyConn.sent.length === 1, "3-C 무응답 35초·주기 재시도에도 첫 상태 전 추가 요청 없음");
  ui.set(resumeHost);
  const beforeEarly = resumeHostConn.sent.length;
  await resumeHostConn.emit("req", earlyEnvelope); await resumeHost.hostSending;
  const immediate = resumeHostConn.sent.slice(beforeEarly);
  ok(immediate.some(x => x.event === "ack" && x.payload.data.n === earlyBody.n) &&
    immediate.some(x => x.event === "snap") && !resumeHost.pending,
    "3-C 같은 세션 이른 claim 승인 뒤 4초 타이머 실행 없이 즉시 snap 송신");
  const afterAccepted = N.canonical(resumeHost.S), beforeDuplicate = resumeHostConn.sent.length;
  await resumeHostConn.emit("req", earlyEnvelope); await resumeHost.hostSending;
  ok(N.canonical(resumeHost.S) === afterAccepted &&
    resumeHostConn.sent.slice(beforeDuplicate).every(x => x.event === "nack" && x.payload.data.err === "replay"),
    "3-C 같은 세션에서 동일 claim 봉투 두 번째는 순번 거절·상태와 토큰 불변");
  ui.set(earlySession);
  const mountsBeforeEarly = uiK.mounts || 0;
  for (const message of immediate) await earlyConn.emit(message.event, message.payload);
  await earlySession.sending;
  ok(earlySession.claimAccepted && uiK.mounts > mountsBeforeEarly, "3-C 이른 claim ack·즉시 snap으로 도시 화면 진입");
  const oldSave = JSON.parse(sessionStorage.getItem("kcp-league-tab-v1"));
  ui.close(); ui.set(resumeHost); ui.close(); await ui.hostInit();
  const newHost = ui.get(), newHostConn = connections.at(-1);
  ok(newHost.S.sid !== oldSave.sid, "3-C 실제 진행자 재시작은 저장 sid 교체");
  const beforeReplayState = N.canonical(newHost.S), beforeReplay = newHostConn.sent.length;
  await newHostConn.emit("req", earlyEnvelope); await newHost.hostSending;
  ok(N.canonical(newHost.S) === beforeReplayState &&
    newHostConn.sent.slice(beforeReplay).every(x => x.event === "nack" && x.payload.data.err === "session"),
    "3-C 옛 세션에서 승인된 claim 원본을 새 수신기에 replay해도 teams·seatVersion·토큰 불변");
  ui.set(null);
  const staleConn = bootResume(oldSave), staleSession = ui.get();
  await staleSession.sending;
  ok(staleConn.sent.length === 1 && N.requestBody(staleConn.sent[0].payload).sid === oldSave.sid,
    "3-C 진행자 재시작을 모르는 팀은 옛 sid로 이른 claim 한 번만 서명");
  ui.set(newHost);
  const beforeStaleClaim = newHostConn.sent.length;
  await newHostConn.emit("req", staleConn.sent[0].payload); await newHost.hostSending;
  const staleReplies = newHostConn.sent.slice(beforeStaleClaim);
  ok(N.canonical(newHost.S) === beforeReplayState &&
    staleReplies.every(x => x.event === "nack" && x.payload.data.err === "session"),
    "3-C 재시작 뒤 옛 sid 이른 claim 거절·teams·seatVersion·토큰 불변");
  ui.set(staleSession);
  for (const message of staleReplies) await staleConn.emit(message.event, message.payload);
  sendBeforeSnap(); tick(); await staleSession.sending;
  ok(staleConn.sent.length === 1 && staleSession.team === team && !staleSession.snap,
    "3-C 새 sid의 거절을 받거나 무시해도 주기 snap 전 이른 claim 재전송 없음");
  ui.set(newHost);
  // nack 한도가 찬 경우에도 정상 claim의 ack·snap은 제한하지 않는다.
  for (let i = 0; i < 3; i++) await newHostConn.emit("req", staleConn.sent[0].payload);
  await newHost.hostSending;
  const beforePeriodic = newHostConn.sent.length;
  [...timers.values()].find(t => t.interval && t.ms === 4000).fn(); await newHost.hostSending;
  const periodic = newHostConn.sent.slice(beforePeriodic).find(x => x.event === "snap");
  ui.set(staleSession);
  await staleConn.emit("snap", periodic.payload); await staleSession.sending;
  ok(staleConn.sent.length === 2 && N.requestBody(staleConn.sent[1].payload).sid === newHost.S.sid,
    "3-C 재시작 뒤 첫 주기 snap에서 5초·30초 지연 없이 정상 claim 전송");
  ui.set(newHost);
  const beforeRecovery = newHostConn.sent.length;
  await newHostConn.emit("req", staleConn.sent[1].payload); await newHost.hostSending;
  ok(newHostConn.sent.slice(beforeRecovery).some(x => x.event === "ack") &&
    newHostConn.sent.slice(beforeRecovery).some(x => x.event === "snap"),
    "3-C nack 제한 뒤에도 정상 claim의 ack·즉시 snap 복구");
  ui.set(staleSession); ui.close(); ui.set(newHost); ui.close();
  for (const missing of ["hostKey", "sid", "다른 방"]) {
    const save = structuredClone(resumeSave);
    if (missing === "다른 방") save.hostKey = null;
    else delete save[missing];
    const blockedConn = bootResume(save);
    if (missing === "다른 방") {
      ui.get().hostKey = hostIdentity.publicKey;
      sessionStorage.setItem("kcp-league-tab-v1", JSON.stringify({ ...resumeSave, room: "ABCDEFGH" === room ? "HGFEDCBA" : "ABCDEFGH" }));
    }
    sendBeforeSnap(); await ui.get().sending;
    ok(!ui.get().snap && blockedConn.sent.length === 0, "3-C " + missing + " 저장은 첫 상태 전 모든 요청 차단");
    ui.close();
  }
  for (const err of ["taken", "legacy", "seat", "session"]) {
    const rejectedConn = bootResume(resumeSave), rejectedSession = ui.get();
    await rejectedSession.sending;
    const claim = N.requestBody(rejectedConn.sent[0].payload);
    const refusal = { team, type: "claim", kid: claim.kid, n: claim.n, err };
    const signReply = (event, data) => N.signHost(hostIdentity, event, room, resumeSave.sid, data);
    await rejectedConn.emit("nack", await signReply("nack", refusal));
    sendBeforeSnap(); tick(); await rejectedSession.sending;
    ok(rejectedSession.team === team && !rejectedSession.claimAccepted && rejectedConn.sent.length === 1 &&
      !(rejectedSession.claimAfter > Date.now()), "3-C 이른 " + err + " 거절은 자리 해제·30초 지연·재전송 없음");
    const snapshot = C.publicView(resumeState, Date.now()); snapshot.sid = resumeSave.sid;
    await rejectedConn.emit("snap", await signReply("snap", snapshot)); await rejectedSession.sending;
    const normal = N.requestBody(rejectedConn.sent.at(-1).payload);
    ok(rejectedConn.sent.length === 2 && normal.type === "claim" && normal.n > claim.n,
      "3-C 이른 " + err + " 거절 뒤 첫 snap에서 정상 claim 즉시 전송");
    await rejectedConn.emit("nack", await signReply("nack", refusal));
    ok(rejectedSession.team === team && rejectedSession.claimAfter < Date.now() + 6000,
      "3-C snap 뒤 늦게 도착한 이른 " + err + " 거절도 정상 claim 지연 없음");
    await rejectedConn.emit("nack", await signReply("nack", { ...refusal, n: normal.n, err: "taken" }));
    ok(rejectedSession.team === null && rejectedSession.claimAfter > Date.now() + 20000,
      "3-C 정상 claim taken 거절의 자리 해제·30초 지연은 유지");
    ui.close();
  }
  const initial = state("REPLAY", "room"), summaryState = structuredClone(initial);
  summaryState.phase = "end"; summaryState.round = 5;
  // 실제 같은 조건으로 다시 함수의 시작 상태 복원을 검사한다. DOM 시작만 대체한다.
  ui.set({ role: "solo", initial, S: summaryState, snap: C.publicView(summaryState, 0), team, style: "careful", timers: [], app: {}, interview: {} });
  ui.replayFixture(); ui.replaySolo();
  ok(uiK.replayed.state.salt === initial.salt && uiK.replayed.state.seedKey === initial.seedKey && uiK.replayed.state.round === 0, "실제 같은 조건으로 다시 함수는 시작 씨앗·상태 복원");
}

function seeds() {
  const a = state("ROOMA", "room"), b = state("ROOMB", "room"), again = state("ROOMA", "room"), fixed = state("ROOMA", "fixed"), legacy = C.newState("ROOMA", R.id, 0, ids);
  const seed = S => { S.round = 1; return C.runRound(S, BG).seed; };
  const x = seed(a), y = seed(b);
  ok(x !== y, "다른 방 운영 씨앗은 다름");
  ok(seed(again) === x, "같은 방 운영 씨앗은 같음");
  ok(seed(fixed) === 7013 && seed(legacy) === 7013, "fixed·opts 없음: 기존 운영 씨앗 유지");
  ok(seed(JSON.parse(JSON.stringify(a))) === x, "저장 불러오기는 소금 보존");
  ok(a.econ.seed !== b.econ.seed && a.econ.seed === again.econ.seed, "경제 난수도 판 소금으로 재현");
  const fixedOther = state("ROOMB", "fixed");
  fixedOther.round = fixed.round = 1;
  ok(fixed.salt === 0 && fixed.econ.seed === fixedOther.econ.seed, "명시적 fixed는 다른 방에서도 같은 경제 씨앗");
  // 계절 모드는 적합한 사건이 있으면 반드시 뽑는다. 빈 배열 비교를 금지한다.
  for (const S of [a, b, again, fixed, fixedOther]) { delete S.rounds; S.round = 1; C.drawEvents(S, R); }
  ok(a.events.length > 0 && b.events.length > 0 && JSON.stringify(a.events) !== JSON.stringify(b.events), "room 모드: 실제로 뽑힌 사건·크기는 방마다 다름");
  ok(JSON.stringify(a.events) === JSON.stringify(again.events), "같은 판 사건·실제 크기 재현");
  ok(fixed.events.length > 0 && JSON.stringify(fixed.events) === JSON.stringify(fixedOther.events), "fixed 실제 사건도 방과 무관");
  for (const S of [fixed, fixedOther]) { ids.forEach(team => C.reduce(S, { type: "claim", team, token: "solo-city-" + team }, 0, BG)); S.phase = "plan"; C.computerPlans(S, BG, null, "careful"); C.computerPlans(S, BG, null, "careful", true); }
  ok(ids.every(id => JSON.stringify(fixed.teams[id].plan) === JSON.stringify(fixedOther.teams[id].plan)) && JSON.stringify(fixed.ties) === JSON.stringify(fixedOther.ties), "fixed 컴퓨터 도시 계획·연계선 동일");
  const trial = C.trialMods(a, R, ids[0], BG);
  const copy = structuredClone(a); copy.salt++; copy.seedKey = "different"; copy.events = [];
  ok(JSON.stringify(trial) === JSON.stringify(C.trialMods(copy, R, ids[0], BG)), "시험 운전에 숨은 사건·판 소금 미사용");
}
// 공개 후보·급전·정산·학생 점수로 순이득을 대조하고 실제 plan의 반환 행동을 기록한다.
function tieObserver(k, emit) {
  const c=k.leagueCore, value=key=>k.ECON_DATA.params[key].v;
  const assets=p=>({builds:structuredClone(p?.builds||[]),lines:structuredClone(p?.lines||[])});
  // AI 본문을 바꾸거나 읽지 않는다. 후보는 공개 지역 자료에서 열거하므로
  // AI가 양수 후보의 평가 경로를 생략해도 미제안을 검출한다.
  return (S,R,id,bg,plan,actions)=>{
    const selected=Object.entries(bg.PACKS).find(([,p])=>p._bL?.tiles===bg.TILES||p._b?.tiles===bg.TILES);
    const mode=selected?.[1]._bL?.tiles===bg.TILES?'league':undefined, oldBLD=bg.BLD, hadPK=Object.hasOwn(bg,'PK');
    const onMap=(key,fn)=>{bg.selectPack(R.teams.find(t=>t.id===key).pack,'league');return fn();};
    try {
      const connected=(key,other)=>onMap(key,()=>{
        const net=bg.network(key===id?plan:assets(S.teams[key].plan));
        return bg.SITES.some(s=>s.kind==='gridpt'&&s.to?.includes(other)&&net.nodes.some(n=>
          n.tile===s.tile&&n.comp>=0&&net.comps.some(comp=>comp.towns.length&&comp.towns[0].comp===n.comp)));
      });
      const rd=c.roundsOf(S)[Math.max(0,S.round-1)];
      const horizon=c.roundsOf(S).slice(Math.max(0,S.round-1),Math.max(0,S.round-1)+value('aiTieMonths'));
      const weeks=horizon.reduce((sum,r)=>sum+(r.mdays||r.days)/rd.days,0);
      const coef=value('aiScoreValue'),prices=Object.fromEntries(Object.entries(S.teams).map(([key,t])=>[key,t.price]));
      let sims, reserved=0;
      const accepted=S.ties.filter(t=>t.st==='built').map(t=>c.effectiveTie(S,t));
      for(const def of R.ties.filter(t=>t.a===id||t.b===id)) {
        const other=def.a===id?def.b:def.a;
        if(!S.teams[other]) continue;
        const existing=S.ties.find(t=>t.a===def.a&&t.b===def.b);
        if(existing?.st==='built'||existing?.by===id) continue;
        const incoming=existing?.st==='prop'&&existing.by!==id;
        const kind=incoming?existing.kind:c.techOf(S,id).includes('hvdc')?'hvdc':def.kind;
        const cap=existing?.cap||2,half=c.tieCost(R,{...def,cap,kind})/2;
        const candidate=c.effectiveTie(S,{...def,cap,kind});
        const eligible=(!S.econ||k.econ.debtStage(S.econ.cities[id])==='ok')&&connected(id,other)&&connected(other,id)&&
          c.fundingOf(bg,S,R,id,plan,{kind:'tie',extra:reserved+half}).ok&&
          c.fundingOf(bg,S,R,other,S.teams[other].plan,{kind:'tie',extra:half}).ok;
        if(!sims) sims=Object.fromEntries(Object.keys(S.teams).map(key=>{
          const p=key===id?plan:assets(S.teams[key].plan);
          const draft={...S,teams:{...S.teams,[key]:{...S.teams[key],plan:p}}};
          const mods=c.trialMods(draft,R,key);
          return [key,onMap(key,()=>c.simTeam(bg,R,key,p,
            {...rd,seed:k.econ.hashStr(`${S.seedKey??S.room}:${S.round}:trade`)},
            Math.max(c.budget(S,key),bg.capex(p)),mods))];
        }));
        const before=c.settle(accepted,sims,prices,sims[id].H,rd.days);
        const after=c.settle([...accepted,candidate],sims,prices,sims[id].H,rd.days);
        const cash={},scoreDelta={},net={};
        for(const key of [id,other]) {
          const cashFlow=o=>o.earn-o.pay-o.fuelX+o.saveFuel+
            o.del.reduce((sum,mw)=>sum+mw,0)*(value('aiVollMul')*value('normalCost'));
          cash[key]=(cashFlow(after.out[key])-cashFlow(before.out[key]))*weeks;
          const energy=settled=>{
            const s=sims[key],o=settled.out[key];
            return c.planningEnergy({...s,uns:Array.from(s.uns,(u,i)=>Math.max(0,u-o.del[i])),
              k:{...s.k,uns:Math.max(0,s.k.uns-o.del.reduce((a,b)=>a+b,0)),co2:s.k.co2-o.saveCo2+o.co2In}});
          };
          scoreDelta[key]=S.econ?k.econ.projectEnergyScore(S.econ,key,energy(after),horizon.length).score-
            k.econ.projectEnergyScore(S.econ,key,energy(before),horizon.length).score:0;
          net[key]=cash[key]+coef*scoreDelta[key]-half;
          assert.ok(Number.isFinite(net[key]),'careful 실제 후보 순이득 유한값');
        }
        const action=actions.find(t=>t.other===other)?.type||'none';
        emit({month:S.round,id,other,tie:def.id||def.a+'~'+def.b,cap:candidate.cap,kind:candidate.kind,
          incoming:!!incoming,eligible,aiScoreValue:coef,months:horizon.length,half,cash,scoreDelta,net,
          candidateNet:incoming?net[id]:Math.min(net[id],net[other]),action});
        // 다음 후보는 실제 반환된 행동의 비용 예약·거래를 기준으로 대조한다.
        if(action==='propose'||action==='accept') {reserved+=half;accepted.push(candidate);}
      }
    } finally {
      if(selected) bg.selectPack(selected[0],mode);
      bg.BLD=oldBLD;
      if(!hadPK) delete bg.PK;
    }
  };
}
function checkCarefulCandidates(rows, planCalls=[]) {
  ok(rows.length>0,'careful 실제 36달 연계선 후보 관측 존재(빈 목록 통과 금지)');
  ok(rows.every(r=>r.pass==='plan'||r.pass==='reply'),'careful 후보의 계획·응답 패스 관측 누락 없음');
  const eligible=rows.filter(r=>r.eligible),positive=eligible.filter(r=>r.candidateNet>0);
  const fulfilled=r=>r.action===(r.incoming?'accept':'propose')&&r.applied===true;
  const immediate=positive.filter(r=>r.pass==='plan'||r.incoming);
  const missed=immediate.filter(r=>!fulfilled(r));
  // repliesOnly는 들어온 제안에 답하는 패스다. 비-incoming 양수 후보는
  // 없애지 않고 다음 달 같은 도시·연계선의 계획 패스에서 재판정한다.
  const deferred=positive.filter(r=>r.pass==='reply'&&!r.incoming),followups=[];
  for(const row of deferred) {
    const nextMonth=row.month+1;
    const detail={month:row.month,nextMonth,id:row.id,other:row.other,tie:row.tie,previousNet:row.candidateNet};
    if(row.month===36) {followups.push({...detail,status:'game-ended'});continue;}
    const call=planCalls.find(c=>c.month===nextMonth&&c.id===row.id);
    const existing=call?.ties.find(t=>[t.a,t.b].includes(row.id)&&[t.a,t.b].includes(row.other));
    const next=rows.find(r=>r.month===nextMonth&&r.pass==='plan'&&r.id===row.id&&r.other===row.other);
    if(existing?.st==='built'||existing?.st==='prop'&&existing.by===row.id) {
      followups.push({...detail,status:existing.st==='built'?'already-built':'already-proposed'});
    } else if(!next) {
      followups.push({...detail,status:'missing-next-plan'});
    } else {
      followups.push({...detail,nextNet:next.candidateNet,eligible:next.eligible,incoming:next.incoming,
        action:next.action,applied:next.applied,status:next.candidateNet<=0?'no-longer-positive':
          !next.eligible?'no-longer-eligible':fulfilled(next)?'fulfilled':'missed-positive'});
    }
  }
  const followupMissed=followups.filter(r=>['missing-next-plan','missed-positive'].includes(r.status));
  console.log('careful 패스별 계약: 계획 패스 적격 순이득>0이면 제안, incoming은 수락 도시 순이득>0이면 수락. 응답 패스 비-incoming 양수는 당월 제안·반영 의무 없이 다음 달 계획에서 재검사(양수 유지 시 제안·반영, 0·음수 전환은 정보 출력).');
  console.log('careful 응답 후보 다음 달 계획 재검사',JSON.stringify(followups));
  console.log('careful 실제 후보 순이득 요약',JSON.stringify({candidates:rows.length,eligible:eligible.length,
    positive:positive.length,immediate:immediate.length,deferred:deferred.length,missed:missed.length,
    followupMissed:followupMissed.length,maxNet:Math.max(...eligible.map(r=>r.candidateNet))}));
  if(eligible.length && positive.length===0) console.log('careful이 짓지 않는 것이 점수상 맞다: 적격 후보 순이득 모두 ≤ 0 (월별 전체 목록 참조)');
  if(missed.length) console.error('careful 양수 후보 미제안·미수락',JSON.stringify(missed));
  ok(eligible.length>0,'careful 실제 적격 연계선 후보 존재');
  if(followupMissed.length) console.error('careful 다음 달 계획 양수 후보 미제안·미수락·관측 누락',JSON.stringify(followupMissed));
  ok(missed.length===0,'careful 계획 양수 후보는 반드시 제안·수락, 응답 incoming 양수는 반드시 수락·반영(경로 생략도 실패)');
  ok(followupMissed.length===0,'careful 응답 비-incoming 양수 후보는 다음 달 계획 관측 필수, 적격 양수 유지 시 반드시 제안·수락·반영');
}

// 점수로도 순이득이 양수인 공개 거래 한 건을 구성한다. 망 연결·접속 조건은
// 작은 합성 장치로 고정하고, 거래 정산·학생 점수·AI 제안/응답은 실제 함수를 쓴다.
function carefulTieBenefit() {
  const vm = require("node:vm");
  const ctx = vm.createContext({console, document:{documentElement:{}}, KCP:{route(){},on(){}}});ctx.window=ctx;
  for(const name of ['build-maps','tech-data','build','econ-data','econ','league-data','league-core','league-ai']) {
    const source=fs.readFileSync(path.resolve(__dirname,'../../ui',name+'.js'),'utf8');
    vm.runInContext(source,ctx,{filename:name+'.js'});
  }
  const k=ctx.KCP,c=k.leagueCore;
  k.TECH_DATA=null; // 이 장치는 연구 후보 없이 공개 plan의 연계선 행동을 검사한다.
  const pair=['hwaseong','pyeongtaek'],[a,b]=pair, S=c.newState('careful-benefit','south',0,pair,{turns:12});
  S.round=1;S.ties=[];
  const rd={month:1,days:7,mdays:30},H=168,arr=n=>new Array(H).fill(n);
  const gate=to=>({to:[to],def:arr(0),ren:arr(0),head:arr(0),disp:arr(0),dmc:arr(0),dco2:arr(0),mc:0,co2i:0});
  const sims={
    [a]:{H,dem:arr(1000/H),uns:arr(0),k:{dem:1000,uns:0,co2:0},cpList:[],gx:[{...gate(b),ren:arr(2)}]},
    [b]:{H,dem:arr(1000/H),uns:arr(0),k:{dem:1000,uns:0,co2:820},cpList:[],gx:[{...gate(a),disp:arr(2),dmc:arr(.02),dco2:arr(.82)}]}
  };
  S.teams[a].price=.015;S.teams[b].price=.02;
  const def={id:a+'~'+b,a,b,cap:2,kind:'ac',loss:.1}, region={teams:pair.map(id=>({id,pack:id})),ties:[def]};
  const bg={PACKS:{},BLD:{},TILES:[],capex:()=>0,selectPack(id){this.id=id;},peakDemand:()=>10,
    get SITES(){return [{kind:'gridpt',tile:1,to:[this.id===a?b:a]}];},
    network:()=>({nodes:[{kind:'plant',cap:100,tile:0,comp:0,live:true},{kind:'gridpt',tile:1,comp:0}],comps:[{towns:[{comp:0}]}]})};
  Object.assign(c,{roundsOf:()=>new Array(12).fill(rd),budget:()=>1000,
    gridStatus:()=>({peakMW:10,headroomMW:100,waitingMW:0,reservedMW:0,monthlyMW:1}),
    fundingOf:()=>({ok:true,grant:{awarded:0}}),fixedOf:()=>0,lossOf:()=>0,researchReserve:()=>0,
    techOf:()=>[],tieCost:()=>100,effectiveTie:(s,t)=>t,
    modsFor:()=>({}),trialMods:()=>({}),simTeam:(bg,r,id)=>sims[id]});
  const observations=[],observe=tieObserver(k,row=>observations.push(row));
  const propose=k.leagueAI.plan(S,region,a,bg,'careful');
  observe(S,region,a,bg,propose.plan,propose.ties);
  const {net,cash,half,aiScoreValue:coef}=observations[0];
  ok(cash[a]-half>0&&cash[b]-half<0,'careful 합성 사례: 구매 도시는 점수 편익이 있어야 순이득 양수');
  let cases=0;
  if(pair.every(id=>net[id]>0)) {
    cases++;
    ok(propose.ties.some(t=>t.type==='propose'&&t.other===b),'careful: 점수식 순이득>0이면 연계선 제안');
    S.ties=[{...def,st:'prop',by:a}];
    const accept=k.leagueAI.plan(S,region,b,bg,'careful');
    ok(accept.ties.some(t=>t.type==='accept'&&t.other===a),'careful: 점수식 순이득>0이면 연계선 수락');
  }
  ok(cases>0,'careful: 점수식 순이득>0인 제안·수락 사례 최소1건(0건 실패)');
  console.log('careful 연계선 조건부 사례',JSON.stringify({cases,aiScoreValue:coef,half,cash,net}));
}

async function measure(oldView, style = "bold") {
  const host = await N.createIdentity();
  let maxSnapshot, maxSize = 0;
  const candidates=[],planCalls=[],observe=style==='careful'?tieObserver(K,row=>candidates.push(row)):null;
  let pass;
  const originalAI=K.leagueAI;
  const observedAI={...originalAI,plan(...args){
    const [state,region,id,bg]=args;
    if(pass==='plan') planCalls.push({month:state.round,id,ties:structuredClone(state.ties)});
    const result=originalAI.plan(...args);
    const before=JSON.stringify(state);
    observe(state,region,id,bg,result.plan,result.ties);
    assert.equal(JSON.stringify(state),before,'careful 관측이 실제 상태를 바꾸지 않음');
    return result;
  }};
  const S = state("SIZE36", "room"), stats = { before: {}, after: {}, builds: 0, research: 0, ties: 0 };
  S.sid = N.sessionId();
  const clock = 1700000000000;
  ids.forEach(id => C.reduce(S, { type: "claim", team: id, token: "solo-city-" + id }, 0, BG));
  async function record(view, maxima, month) {
    const snap = view(S, 1700000000000), signed = await N.signHost(host, "snap", S.room, S.sid, snap), payload = JSON.stringify(signed), local = JSON.stringify({ ev: "snap", data: signed });
    const wire = JSON.stringify(N.broadcastMessage(S.room, "snap", signed, "9999999999", "9999999999"));
    if (Buffer.byteLength(wire) > maxSize) { maxSize = Buffer.byteLength(wire); maxSnapshot = snap; }
    for (const [key, value] of Object.entries({ jsonChars: payload.length, jsonBytes: Buffer.byteLength(payload), localBytes: Buffer.byteLength(local), wireChars: wire.length, wireBytes: Buffer.byteLength(wire) })) if (!maxima[key] || value > maxima[key].value) maxima[key] = { value, month, phase: S.phase };
  }
  for (let month = 1; month <= 36; month++) {
    C.host(S, "next", clock + month * 100);
    const first=candidates.length;
    try {
      if(observe) K.leagueAI=observedAI;
      for(const repliesOnly of [false,true]) {
        pass=repliesOnly?'reply':'plan';
        const firstPass=candidates.length;
        C.computerPlans(S, BG, null, style, repliesOnly);
        for(const row of candidates.slice(firstPass)) {
          row.pass=pass;
          const tie=S.ties.find(t=>[t.a,t.b].includes(row.id)&&[t.a,t.b].includes(row.other));
          row.applied=row.action==='accept'?tie?.st==='built':row.action==='propose'?
            !!tie && (tie.st==='built'||tie.st==='prop'&&tie.by===row.id):false;
        }
      }
    } finally { K.leagueAI=originalAI; }
    if(observe) console.log('careful 실제 연계선 후보 순이득',JSON.stringify({month,rows:candidates.slice(first)}));
    if (oldView) await record(oldView, stats.before, month);
    await record(C.publicView, stats.after, month);
    const res = C.run(S, BG, clock + month * 100 + 1);
    ok(!!res && S.phase === "review", `6팀 ${month}달 운영`);
    if (oldView) await record(oldView, stats.before, month);
    await record(C.publicView, stats.after, month);
    const view = C.publicView(S, clock + month * 100 + 2);
    ok(view.results.length === month && view.results.every((r, i) => r.round === S.results[i].round && r.region.co2 === S.results[i].region.co2 && ids.every(id => ["outH", "imp", "unsPct"].every(k => r.team[id][k] === S.results[i].team[id][k]))), `${month}달 누적 정전·거래·기록 요약 보존`);
    ok(JSON.stringify(view.results.at(-1)) === JSON.stringify(S.results.at(-1)) && (month < 2 || JSON.stringify(view.results.at(-2)) === JSON.stringify({ ...S.results.at(-2), econ: null })), `${month}달 최근 두 결과 상세 보존`);
    ok(stats.after.wireBytes.value < 180000, `${month}달 실제 봉투 포함 180,000바이트 미만`);
    if (month % 6 === 0) console.log(`size: ${month}/36 months, ${stats.after.wireBytes.value} bytes max`);
  }
  C.host(S, "next", clock + 3700);
  if (oldView) await record(oldView, stats.before, 36);
  await record(C.publicView, stats.after, 36);
  ok(S.phase === "end" && stats.after.wireBytes.value < 180000, "끝 상태도 실제 봉투 포함 180,000바이트 미만");
  stats.builds = ids.reduce((sum, id) => sum + S.teams[id].plan.builds.length, 0);
  stats.research = ids.reduce((sum, id) => sum + Object.keys(S.teams[id].research.stage).length, 0);
  stats.ties = S.ties.filter(t => t.st === "built").length;
  ok(stats.builds > 6 && stats.research > 0, "건설·연구를 실제로 사용하는 6팀 조건");
  if (style === "careful") carefulTieBenefit();
  else ok(stats.ties > 0, "공격 성향은 연계선을 실제로 사용하는 6팀 조건");
  const sample = [], verifySample = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now(), wire = await N.signHost(host, "snap", S.room, S.sid, maxSnapshot);
    sample.push(performance.now() - start);
    // room 검사는 실제 코드로 별도 검사했다. 최대 크기 자료의 코드도 키에 맞춘다.
    const binding = await N.hostBinding(host.publicKey); wire.room = binding.room; wire.data.room = binding.room;
    const corrected = await N.signHost(host, "snap", binding.room, S.sid, { ...maxSnapshot, room: binding.room });
    const begin = performance.now();
    ok(await N.hostReceiver({ room: binding.room }, () => {})("snap", corrected), "최대 snap 실제 서명·검증");
    verifySample.push(performance.now() - begin);
  }
  const ms = values => ({ mean: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(3), max: +Math.max(...values).toFixed(3) });
  console.log("36달 최대 크기·비용", JSON.stringify({ style, ...stats, signMs: ms(sample), verifyMs: ms(verifySample) }));
  if (style === "careful") checkCarefulCandidates(candidates,planCalls);
  return stats;
}
async function floor3Network() {
  const host = await N.createIdentity(), binding = await N.hostBinding(host.publicKey), S = state(binding.room), team = ids[0], key = await N.createIdentity();
  const sign = request => N.signEnvelope(key, team, { type: "price", price: 0.2, sid: S.sid, seat: 0, ...request });
  let verifies = 0, applied = 0;
  const receive = N.receiver(S, m => { applied++; return C.reduce(S, m, 1, BG); }, async (...args) => { verifies++; return N.verifyEnvelope(...args); });
  await receive(await sign({ type: "claim", publicKey: key.publicKey }));
  const good = await sign({}), old = await sign({ sid: "old-session" }), repeat = await sign({});
  await receive(repeat); const before = verifies;
  for (const wire of [old, good, { ...good, body: "x".repeat(256001) }]) await receive(wire);
  ok(verifies === before, "F3-5 진행자 sid·순번·크기 싼 검사가 검증보다 먼저");
  let unblock, calls = 0;
  const held = N.receiver(S, () => ({ ok: true }), async () => { calls++; await new Promise(r => { unblock = r; }); return false; });
  const wave = Array.from({ length: 60 }, () => held({ ...repeat, body: repeat.body.replace('"n":' + N.requestBody(repeat).n, '"n":' + (N.requestBody(repeat).n + 100)) }));
  let done = false; Promise.all(wave).then(() => { done = true; });
  for (let i = 0; i < 70 && !done; i++) { await new Promise(r => setImmediate(r)); unblock?.(); }
  await Promise.all(wave);
  ok(calls <= 16, "F3-5 진행자 검증 대기열 상한 16");
  const gate = N.replyGate(), kid = await N.fingerprint(key.publicKey);
  const request = { team, kid, n: 1, type: "claim", id: "x".repeat(65), rid: { large: "x".repeat(5000) }, publicKey: key.publicKey, price: "echo" };
  ok(!gate({ request, err: "signature" }) && !gate({ request, err: "bad" }), "F3-3 bad·signature nack 무방송");
  const reply = gate({ request, err: "taken" }, 1);
  ok(reply && !('id' in reply) && !('rid' in reply) && Object.keys(reply).sort().join() === "err,kid,n,team,type", "F3-3 응답 필드 제한·id/rid 64자 상한");
  const limited = [gate({ request, err: "taken" }, 1), gate({ request: { ...request, kid: "f".repeat(64) }, err: "taken" }, 1)];
  ok(limited[0] && !limited[1] && gate({ request, err: "taken" }, 1001), "F3-3 kid 교체 포함 팀별 nack 초당 2개");
  const first = await sign({ id: "once" }); await receive(first);
  for (let i = 0; i < 65; i++) await receive(await sign({ id: "next-" + i }));
  const count = applied, body = N.requestBody(first);
  const replay = await sign({ ...body, n: undefined });
  ok((await receive(replay)).err === "expired" && applied === count, "F3-10 퇴거한 born 이하 요청 재적용 차단");
  const view = C.publicView(S, 1), wire = await N.signHost(host, "snap", S.room, S.sid, view);
  const subtle = crypto.subtle, originalVerify = subtle.verify, originalDigest = subtle.digest;
  let expensive = 0;
  subtle.verify = function (...args) { expensive++; return originalVerify.apply(this, args); };
  subtle.digest = function (...args) { expensive++; return originalDigest.apply(this, args); };
  try {
    const trusted = { room: S.room, sid: S.sid, hostN: wire.n }, receiveHost = N.hostReceiver(trusted, () => {});
    await receiveHost("snap", wire);
    await receiveHost("ack", { ...wire, event: "ack", sid: "wrong", n: wire.n + 1 });
    await receiveHost("snap", { ...wire, n: wire.n + 1, data: { text: "x".repeat(256001) } });
    ok(expensive === 0, "F3-5 팀 sid·순번·크기 싼 검사가 암호 계산보다 먼저");
    let hostCalls = 0;
    const crowded = N.hostReceiver({ room: S.room }, () => { hostCalls++; });
    // 서명 불일치 봉투는 hostN을 올리지 않는다. 따라서 큐 상한 자체를 측정한다.
    const start = expensive;
    await Promise.all(Array.from({ length: 60 }, (_, i) => crowded("ack", { ...wire, event: "ack", n: wire.n + i + 1 })));
    ok(expensive - start <= 32 && hostCalls === 0, "F3-5 팀 검증 대기열 상한 16");
    // snap은 상한을 세지 않는 대신 최신 하나와 예비 하나만 남긴다. 서명이 안 맞는 snap 60개도 검증은 두 번뿐이다.
    const snapStart = expensive;
    await Promise.all(Array.from({ length: 60 }, (_, i) => crowded("snap", { ...wire, n: wire.n + i + 1 })));
    ok(expensive - snapStart <= 4 && hostCalls === 0, "Q8 밀린 옛 snap은 검증 없이 건너뜀(서명 불일치 60개 → 최신·예비 검증 2회)");
  } finally { subtle.verify = originalVerify; subtle.digest = originalDigest; }
  {
    // Q8: 진짜 서명 snap이 밀려 와도 마지막 것만 반영하고, ack는 건너뛰지 않으며 순서도 지킨다.
    const signed = (event, data) => N.signHost(host, event, S.room, S.sid, data);
    const s1 = await signed("snap", { ...view, probe: 1 }), a1 = await signed("ack", { id: "a1" });
    const s2 = await signed("snap", { ...view, probe: 2 }), a2 = await signed("ack", { id: "a2" });
    const s3 = await signed("snap", { ...view, probe: 3 });
    const seen = [], t = { room: S.room }, r = N.hostReceiver(t, (event, data) => { seen.push(event === "snap" ? "snap" + data.body.probe : data.id); });
    await Promise.all([r("snap", s1), r("ack", a1), r("snap", s2), r("ack", a2), r("snap", s3)]);
    ok(seen.join() === "a1,a2,snap3", "Q8 밀린 snap은 최신만 반영, ack는 모두 순서대로: " + seen.join());
    ok(t.hostN === s3.n && !await r("snap", s1) && !await r("snap", s2), "Q8 건너뛴 옛 snap은 최신 반영 뒤 순번 재사용으로 거절");
    // 도착 순서가 뒤바뀌어도(또는 옛 snap 재방송) 기다리던 더 새 snap이 남는다.
    const seenO = [], tO = { room: S.room }, rO = N.hostReceiver(tO, (_, data) => { seenO.push(data.body.probe); });
    await Promise.all([rO("snap", s1), rO("snap", s3), rO("snap", s2)]);
    ok(seenO.join() === "3" && tO.hostN === s3.n, "Q8 늦게 온 옛 순번 snap은 기다리던 새 snap을 밀어내지 못함: " + seenO.join());
    // 최신 snap이 위조면 바로 앞에서 밀려난 정상 snap 하나를 대신 검증한다.
    const forged = structuredClone(s2); forged.n = s3.n + 10; forged.data.body.phase = "end";
    const seen2 = [], r2 = N.hostReceiver({ room: S.room }, (_, data) => { seen2.push(data.body.probe); });
    await Promise.all([r2("snap", s1), r2("snap", forged)]);
    ok(seen2.join() === "1", "Q8 최신 snap이 위조면 밀려난 정상 snap을 대신 반영: " + seen2.join());
    // 순번만 큰 위조가 기다리는 자리를 차지해도, 그 뒤 들어오지 못한 정상 snap 가운데 가장 새것이 예비로 남는다.
    const huge = structuredClone(s2); huge.n = Number.MAX_SAFE_INTEGER; huge.data.body.phase = "end";
    const seenC = [], tC = { room: S.room }, rC = N.hostReceiver(tC, (_, data) => { seenC.push(data.body.probe); });
    await Promise.all([rC("snap", s1), rC("snap", huge), rC("snap", s2), rC("snap", s3)]);
    ok(seenC.join() === "3" && tC.hostN === s3.n, "Q8 순번만 큰 위조 snap 뒤의 정상 snap도 예비로 남음: " + seenC.join());
    // 건너뜀은 '처리하지 않음'이다: 뒤의 snap이 모두 위조로 거절되면 순번은 오르지 않고, 건너뛴 snap은 아직 받을 수 있다.
    const forged2 = structuredClone(forged); forged2.n = forged.n + 1;
    const seen3n = [], t3 = { room: S.room }, r3n = N.hostReceiver(t3, (_, data) => { seen3n.push(data.body.probe); });
    await Promise.all([r3n("snap", s1), r3n("snap", forged), r3n("snap", forged2)]);
    ok(seen3n.length === 0 && t3.hostN === undefined, "Q8 건너뛴 snap은 순번을 올리지 않음");
    ok(await r3n("snap", s1) && seen3n.join() === "1", "Q8 처리하지 않은 snap은 나중에 정상 반영 가능");
    // 대기열이 ack로 가득 차도 최신 snap은 버리지 않는다.
    const acks = [];
    for (let i = 0; i < 20; i++) acks.push(await signed("ack", { id: "q" + i }));
    const s4 = await signed("snap", { ...view, probe: 4 });
    const seen3 = [], r3 = N.hostReceiver({ room: S.room }, (event, data) => { seen3.push(event === "snap" ? "snap" + data.body.probe : data.id); });
    await Promise.all([...acks.map(a => r3("ack", a)), r3("snap", s4)]);
    ok(seen3.filter(x => x.startsWith("q")).length === 16 && seen3.at(-1) === "snap4", "Q8 대기열이 차도 최신 snap은 남음(ack 16개 + snap)");
  }
  for (const value of [Infinity, undefined, new String("plan"), NaN]) {
    const valid = await N.signHost(host, "snap", S.room, S.sid, { ...view, probe: value === undefined ? 1 : null });
    valid.data.body.probe = value;
    ok(!await N.hostReceiver({ room: S.room }, () => {})("snap", valid), "F3-7 JSON 밖 값 거절 " + String(value));
  }
  let normalized;
  const zero = await N.signHost(host, "snap", S.room, S.sid, { ...view, probe: 0 }); zero.data.body.probe = -0;
  await N.hostReceiver({ room: S.room }, (_, data) => { normalized = data; })("snap", zero);
  ok(normalized && !Object.is(normalized.body.probe, -0), "F3-7 검증한 정규 JSON 파싱 값을 반영");
  // 객체 봉투만 문턱을 넘는 경우: 행 변환으로 충분하므로 옛 계획까지 전부 남아야 한다.
  const below = { teams: { [team]: { hist: Array.from({ length: 3000 }, (_, r) =>
    ({ r, t: r, cap: r * 2, n: r, l: 0, plan: { builds: [] } })) } } };
  const belowPacked = N.compactSnapshot(below);
  ok(N.byteLength({ _cp: 1, keys: [], body: below }) > 178000 && N.byteLength(belowPacked) < 178000,
    "F3-6 객체 봉투만 문턱 초과인 경계 사례");
  ok(N.canonical(N.expandSnapshot(structuredClone(belowPacked))) === N.canonical(below),
    "F3-6 최종 행 봉투가 문턱 미만이면 hist·오래된 계획 무손실");
  const measureCompact = value => {
    const stringify = JSON.stringify, sizes = [];
    let serializations = 0, packed;
    JSON.stringify = function (v, ...args) {
      const text = stringify.call(this, v, ...args);
      if (v?.teams || v?._cp === 1) serializations++;
      if (v?._cp === 1) sizes.push(Buffer.byteLength(text, "utf8"));
      return text;
    };
    try { packed = N.compactSnapshot(value); } finally { JSON.stringify = stringify; }
    ok(serializations <= 4 && sizes.length <= 3, "F3-6 부풀린 상태 최대 두 차례 축약·전체 직렬화 4회 상한");
    return { packed, sizes, serializations };
  };
  for (const limit of [178000, 178001]) {
    const boundary = { ...below, padding: "" };
    boundary.padding = "x".repeat(limit - N.byteLength({ ...belowPacked,
      body: { ...belowPacked.body, padding: "" } }));
    const measured = measureCompact(boundary);
    ok(measured.sizes[0] === limit, "F3-6 사전 포함 최종 봉투 문턱 경계");
    if (limit === 178000) {
      ok(measured.serializations <= 2 && N.canonical(N.expandSnapshot(structuredClone(measured.packed))) === N.canonical(boundary),
        "F3-6 정확히 178000B는 비상 축약 없이 모든 기록 보존");
    } else {
      ok(measured.sizes.length > 1 && N.byteLength(measured.packed) <= 178000,
        "F3-6 178001B부터 비상 축약 발동");
    }
  }
  const retry = { teams: { [team]: {
    hist: Array.from({ length: 2300 }, (_, r) => ({ r, repeatedLongMetricName: 0, detail: "x".repeat(65) })),
    plan: { builds: [1] }, base: [{ k: "b:0", c: 2 }],
    trialGrid: { entries: [{ key: "b:0", allocatedMW: 2 }] }
  } }, econ: { cities: { [team]: { hist: [{ r: 1 }] } } },
    results: [{ round: 1, team: { [team]: { n: 1 } } }] };
  const retried = measureCompact(retry);
  ok(retried.sizes.length === 3 && retried.sizes[1] > 178000 && N.byteLength(retried.packed) <= 178000,
    "F3-6 행별 축약률 차이로 남은 초과분을 두 번째 비율 축약으로 해소");
  const blocked = structuredClone(retry);
  blocked.teams[team].plan.detail = "x".repeat(260000);
  const stopped = measureCompact(blocked);
  ok(stopped.sizes.length === 3 && N.byteLength(stopped.packed) > 256000,
    "F3-6 두 번 뒤에도 큰 보존 항목은 전송 oversize 경로에 남김");
  for (const [original, measured] of [[retry, retried], [blocked, stopped]]) {
    const restored = N.expandSnapshot(structuredClone(measured.packed));
    for (const key of ["plan", "base", "trialGrid"])
      ok(N.canonical(restored.teams[team][key]) === N.canonical(original.teams[team][key]),
        "F3-6 두 차례 축약 뒤 현재 " + key + " 보존");
    ok(N.canonical(restored.teams[team].hist.slice(-2)) === N.canonical(original.teams[team].hist.slice(-2)),
      "F3-6 두 차례 축약 뒤 최근 두 hist 보존");
    for (const key of ["econ", "results"])
      ok(N.canonical(restored[key]) === N.canonical(original[key]), "F3-6 재포장 뒤 " + key + " 무손실");
  }
  const large = structuredClone(view);
  large.teams[team].hist = Array.from({ length: 400 }, (_, r) => ({ r, detail: "x".repeat(6000) }));
  const stringify = JSON.stringify; let serializations = 0;
  JSON.stringify = function (v, ...args) { if (v?.teams || v?._cp === 1) serializations++; return stringify.call(this, v, ...args); };
  const start = performance.now(); let compact;
  try { compact = N.compactSnapshot(large); } finally { JSON.stringify = stringify; }
  const elapsed = performance.now() - start;
  ok(N.byteLength(compact) <= 178000 && serializations <= 3 && elapsed < 150, "F3-6 부풀린 상태 한 번 축약·목표 이하·반복 직렬화 없음");
  const planned = structuredClone(view);
  planned.teams[team].hist = Array.from({ length: 20 }, (_, r) => ({ r, t: r, cap: r * 2, n: r, l: 0, plan: { builds: [], detail: "x".repeat(10000) } }));
  const summarized = N.compactSnapshot(planned);
  const restoredSummary = N.expandSnapshot(structuredClone(summarized));
  ok(N.byteLength(summarized) <= 178000 && restoredSummary.teams[team].hist.length === 20 && !restoredSummary.teams[team].hist[0].plan && restoredSummary.teams[team].hist[0].cap === 0 && restoredSummary.teams[team].hist.at(-1).plan, "F3-6 오래된 계획 전문은 해당 팀 건설 속도 요약으로 축약");
  for (const [original, packed] of [[large, compact], [planned, summarized]]) {
    const restored = N.expandSnapshot(structuredClone(packed));
    for (const id of ids) {
      for (const key of ["plan", "base", "trialGrid"])
        assert.deepStrictEqual(restored.teams[id][key], original.teams[id][key], "F3-6 비상 축약 뒤 현재 " + key + " 보존");
      assert.deepStrictEqual(restored.teams[id].hist.slice(-2), original.teams[id].hist.slice(-2),
        "F3-6 비상 축약 뒤 모든 팀 최근 두 hist 보존");
      checks += 4;
    }
  }
  console.log("F3 compact", JSON.stringify({ input: N.byteLength(large), output: N.byteLength(compact), ms: +elapsed.toFixed(3), serializations }));
}
function floor3Restore() {
  const S = state("SIZE36", "room");
  ids.forEach(team => C.reduce(S, { type: "claim", team, token: "solo-city-" + team }, 0, BG));
  for (let month = 1; month <= 4; month++) {
    C.host(S, "next", month * 100); C.computerPlans(S, BG, null, "careful"); C.computerPlans(S, BG, null, "careful", true); C.run(S, BG, month * 100 + 1);
    if (month === 1) continue;
    const original = C.publicView(S, month * 100 + 2), restored = N.expandSnapshot(N.compactSnapshot(original));
    ok(ids.some(id => original.teams[id].base.length > 0) && ids.some(id => original.teams[id].trialGrid?.entries.some(e => e.allocatedMW > 0)), "F3-12 실제 운영 " + month + "달 base·계통 배분 비어 있지 않음");
    ok(N.canonical(restored) === N.canonical(original), "F3-12 운영 자료 축약 복원 동일 " + month);
    const id = ids.find(id => original.teams[id].base.some(x => x.k.startsWith("b:"))), plan = structuredClone(original.teams[id].plan);
    plan.builds = [];
    const loss = C.lossOf(original.teams[id].base, plan);
    ok(loss > 0 && C.lossOf(restored.teams[id].base, plan) === loss, "F3-12 철거 손실 보존 " + month);
    ok(N.canonical(C.trialMods(restored, R, id, BG)) === N.canonical(C.trialMods(original, R, id, BG)), "F3-12 시험 운전 배분 보존 " + month);
  }
}

async function main() { if (process.argv.includes("--careful-tie")) { carefulTieBenefit(); return; } await security(); await floor4Network(); await hostSecurity(); await floor3Network(); floor3Restore(); await transport(); await uiProtocol(); seeds(); if (!process.argv.includes("--quick")) { await measure(); await measure(null, "careful"); } console.log(`checks ${checks} fail 0`); }
module.exports = { measure, C, K };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
