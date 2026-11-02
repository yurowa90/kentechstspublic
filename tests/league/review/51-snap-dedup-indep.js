/* 독립 검사: 구현 보고서·50번 검사를 읽거나 불러오지 않는다.
 * 실행: node tests/league/review/51-snap-dedup-indep.js
 * 네트워크·브라우저 없이 현재 소스와 git show 816d9d5 소스를 별도 VM에 올린다.
 * D-64 / league-net.signHost: sig를 뺀 {event,room,sid,n,data,hostKey}의 정규 JSON을
 * ECDSA P-256/SHA-256으로 서명한다. snap의 data는 펼치기 전 압축 봉투다.
 * league.js: hostSend → signHost, teamInit → hostReceiver → onSnap → expandSnapshot.
 * 통신 분리는 local의 kcp-league-${room}, supabase의 realtime:kcp-league-${room}와
 * hostReceiver의 키·room·sid 검사다. 앱 판본 협상은 없으므로 같은 게임 세션이
 * 같은 앱 판본을 보장하지 않는다. 접힌 봉투는 _cp: 2이며 옛 판의 null 거절을 단언한다.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { webcrypto } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { TextEncoder, TextDecoder } = require("node:util");
const ROOT = path.resolve(__dirname, "../../..");
const SOURCE = fs.readFileSync(path.join(ROOT, "ui/league-net.js"), "utf8");
const clone = x => JSON.parse(JSON.stringify(x));
const plain = x => structuredClone(x);
const refs = [["report", "score"], ["report", "offers"], ["scoreState", "totals"]];
const summary = { suite: "51-snap-dedup-indep", assertions: 0, failures: 0,
  mutations: { total: 4, detected: 0 } };

function eq(a, b, message) { summary.assertions++; assert.deepStrictEqual(a, b, message); }
function ok(value, message) { summary.assertions++; assert.ok(value, message); }
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) {
    summary.failures++;
    console.error(`FAIL ${name}: ${error.code || error.name}: ${error.message.slice(0, 800)}`);
  }
}

function context() {
  const ctx = vm.createContext({ console, document: { documentElement: {} },
    KCP: { route() {}, on() {}, esc: x => x }, structuredClone, TextEncoder, TextDecoder,
    crypto: webcrypto, btoa, atob, performance });
  ctx.window = ctx;
  vm.runInContext(`const Math = globalThis.Math, JSON = globalThis.JSON,
    Object = globalThis.Object, Array = globalThis.Array, Number = globalThis.Number;
    Math.random = () => { throw Error("unseeded Math.random"); };`, ctx);
  return ctx;
}
function net(source) {
  const ctx = context();
  vm.runInContext(source, ctx, { filename: "league-net.vm.js" });
  return ctx.KCP.leagueNet;
}
function engine() {
  const ctx = context();
  for (const name of ["build-maps", "tech-data", "build", "econ-data", "econ",
    "league-data", "league-core", "league-ai"]) {
    const file = path.join(ROOT, "ui", name + ".js");
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  }
  return ctx.KCP;
}
function envelope(N, value) { return JSON.parse(N.canonical(N.compactSnapshot(value))); }
function roundTrip(N, value) { return plain(N.expandSnapshot(envelope(N, value))); }

// size-budget.simulate와 같은 입장·계획 세 번·준비·운영·다음 달 순서, fixed/SIZE36.
// 독립 오라클을 사용하기 위해 size-budget의 measure·engine은 불러오지 않는다.
async function simulate(K, style, inspect) {
  const C = K.leagueCore, BG = K.buildGame;
  const ids = C.regionOf("south").teams.map(t => t.id), player = ids[0];
  eq(ids.length, 6, `${style} 6팀`);
  const S = C.newState("SIZE36", "south", 0, ids, { turns: 36, seedMode: "fixed" });
  for (const id of ids) ok(C.reduce(S, { type: "claim", team: id,
    token: "solo-city-" + id }, 0, BG)?.ok, `${style} claim ${id}`);
  let snapshots = 0, months = 0;
  const snapshot = async () => { await inspect(C.publicView(S, 0), snapshots); snapshots++; };
  await snapshot();
  ok(C.host(S, "next", 0), `${style} 첫 달 시작`);
  while (S.phase !== "end" && months < 36) {
    eq([S.phase, S.round], ["plan", months + 1], `${style} 계획 단계`);
    C.computerPlans(S, BG, player, style, false);
    C.computerPlans(S, BG, player, style, true);
    C.computerPlans(S, BG, player, style, true);
    ok(C.reduce(S, { type: "ready", team: player, token: "solo-city-" + player,
      ready: true }, 0, BG)?.ok, `${style} 준비`);
    ok(C.run(S, BG, 0), `${style} 운영`);
    eq(S.phase, "review", `${style} 운영 뒤 단계`);
    months++;
    await snapshot();
    ok(C.host(S, "next", 0), `${style} 다음 단계`);
    await snapshot();
  }
  eq([months, S.phase, snapshots], [36, "end", 73], `${style} 36달 완주·모든 표본`);
}

function fixture() {
  const score = { alpha: { total: 41, parts: [1, 2, 3] }, beta: { total: 57 } };
  const offers = [{ id: "synthetic-offer", amount: 13 }];
  const totals = { alpha: 100, beta: 200 };
  return clone({ room: "SYNTHETIC", region: "south", sid: "synthetic-session", teams: {},
    econ: { score, offers, totals, report: { score, offers, previousScore: score },
      scoreState: { totals } }, audit: "A" });
}
function changedScore(value) {
  const out = clone(value);
  out.econ.report.score.alpha.total++;
  return out;
}
// 이 오라클들을 원본과 VM 변이에 똑같이 적용한다. 변이의 파싱/실행 오류는 탐지로 세지 않는다.
function equalOracle(N) {
  const value = fixture(), packed = envelope(N, value);
  assert.equal(packed._cp, 2, "접힌 봉투는 판수 2");
  assert.equal(packed._refs, 7, "세 경로 모두 접힘");
  for (const [parent, key] of refs) assert.deepStrictEqual(packed.body.econ[parent][key], [-2]);
  assert.deepStrictEqual(plain(N.expandSnapshot(packed)), value, "같은 값 참조의 왕복 보존");
}
function differentOracle(N) {
  const value = changedScore(fixture()), packed = envelope(N, value);
  assert.equal((packed._refs || 0) & 1, 0, "다른 report.score는 접지 않음");
  assert.deepStrictEqual(plain(packed.body.econ.report.score), value.econ.report.score);
  assert.deepStrictEqual(plain(N.expandSnapshot(packed)), value, "다른 값 왕복 보존");
}
function versionOracle(N) {
  assert.equal(envelope(N, fixture())._cp, 2, "접었는데 _cp가 1이면 실패");
}
function envelopeContract(N, old, value, packed, oldPacked, label) {
  if (packed._refs) {
    eq(packed._cp, 2, `${label} 접으면 판수 2`);
    eq(old.expandSnapshot(clone(packed)), null, `${label} 816d9d5는 판수 2 거절`);
  } else {
    eq(packed._cp, 1, `${label} 안 접으면 판수 1`);
    eq(Object.hasOwn(packed, "_refs"), false, `${label} 판수 1에 _refs 없음`);
    eq(JSON.stringify(N.compactSnapshot(value)), JSON.stringify(old.compactSnapshot(value)),
      `${label} 안 접은 봉투는 816d9d5와 바이트 동일`);
    eq(packed, oldPacked, `${label} 옛 봉투와 동일`);
    eq(plain(old.expandSnapshot(clone(packed))), clone(value), `${label} 안 접으면 새 → 옛 동일`);
  }
}
function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, "변이 위치는 정확히 한 곳");
  return source.replace(before, after);
}

async function signatureChecks(N, view) {
  const identity = await N.createIdentity(), binding = await N.hostBinding(identity.publicKey);
  const value = clone(view);
  value.room = binding.room; value.sid = "independent-signature-session"; value.audit = "A";
  const wire = clone(await N.signHost(identity, "snap", value.room, value.sid, value));
  ok(wire.data._refs > 0, "실제 공개 상태의 접힌 봉투로 서명");
  eq(wire.data._cp, 2, "서명한 접힌 봉투의 판수 2");
  eq(wire.data, envelope(N, value), "서명 data는 압축 봉투");
  eq(Object.keys(wire).sort(), ["event", "room", "sid", "n", "data", "hostKey", "sig"].sort(), "D-64 필드");
  const key = await webcrypto.subtle.importKey("jwk", identity.publicKey,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const verify = async message => {
    const { sig, ...subject } = message;
    return webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      Buffer.from(sig, "base64"), new TextEncoder().encode(N.canonical(subject)));
  };
  eq(await verify(wire), true, "node WebCrypto로 sig 제외 전체 정규 JSON 서명 확인");
  const expandedSubject = clone(wire);
  expandedSubject.data = N.expandSnapshot(clone(wire.data));
  eq(await verify(expandedSubject), false, "펼친 상태는 같은 서명의 대상이 아님");
  const receive = async message => {
    let applied = 0, rejected = 0, restored;
    const trust = { room: binding.room, fingerprint: binding.fingerprint, hostKey: identity.publicKey };
    const accepted = await N.hostReceiver(trust, (event, data) => {
      eq(event, "snap", "팀 수신 이벤트"); applied++;
      restored = plain(N.expandSnapshot(data));
    }, () => { rejected++; })("snap", clone(message));
    return { accepted, applied, rejected, restored };
  };
  const normal = await receive(wire);
  eq([normal.accepted, normal.applied, normal.rejected], [true, 1, 0], "팀 검증 통과 뒤 한 번 반영");
  eq(normal.restored, clone(value), "팀 검증 뒤 확장 값 동일");
  const variants = [
    ["본문 한 글자", m => { m.data.body.audit = "B"; }],
    ["참조 표지 한 글자", m => {
      const [i, [parent, field]] = refs.entries().find(([bit]) => wire.data._refs & 1 << bit);
      void i; m.data.body.econ[parent][field][0] = -3;
    }],
    ["참조 비트 한 글자", m => { m.data._refs = m.data._refs === 1 ? 2 : 1; }],
    ["서명 한 글자", m => { m.sig = (m.sig[0] === "A" ? "B" : "A") + m.sig.slice(1); }]
  ];
  for (const [label, mutate] of variants) {
    const bad = clone(wire); mutate(bad);
    const before = JSON.stringify(wire), after = JSON.stringify(bad);
    eq(before.length, after.length, `${label} 길이 유지`);
    let differences = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) differences++;
    eq(differences, 1, `${label} 정확히 한 글자 변경`);
    eq(await verify(bad), false, `${label} 암호 검증 거부`);
    const result = await receive(bad); // 매번 새 수신기: 순번 재사용 거부와 혼동하지 않는다.
    eq([result.accepted, result.applied, result.rejected], [false, 0, 1], `${label} 팀 검증 거부·미반영`);
  }
}

async function main() {
  const N = net(SOURCE);
  const oldSource = execFileSync("git", ["show", "816d9d5:ui/league-net.js"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const old = net(oldSource), K = engine();
  const reverse = { legacyAccepted: 0, version2Rejected: 0 };
  let signedView;
  for (const style of ["balanced", "careful"]) await check(`${style} 6팀·36달·현재/옛 봉투 왕복·크기`, async () => {
    let maximum = 0, oldMaximum = 0, snapshots = 0, folded = 0;
    await simulate(K, style, async (view, index) => {
      const expected = clone(view), untouched = clone(view), packed = envelope(N, view);
      eq(plain(N.expandSnapshot(clone(packed))), expected, `${style} #${index} 현재 왕복`);
      eq(clone(view), untouched, `${style} #${index} 입력 불변`);
      const oldPacked = envelope(old, view);
      eq(plain(old.expandSnapshot(clone(oldPacked))), expected, `${style} #${index} 옛 오라클 대조`);
      eq(plain(N.expandSnapshot(clone(oldPacked))), expected, `${style} #${index} 옛 → 새`);
      maximum = Math.max(maximum, Buffer.byteLength(JSON.stringify(packed), "utf8"));
      oldMaximum = Math.max(oldMaximum, Buffer.byteLength(JSON.stringify(oldPacked), "utf8"));
      if (packed._refs) { folded++; signedView = expected; }
      envelopeContract(N, old, view, packed, oldPacked, `${style} #${index}`);
      if (packed._refs) reverse.version2Rejected++;
      else reverse.legacyAccepted++;
      snapshots++;
    });
    ok(folded > 0, `${style} 실제 접힘 표본 존재`);
    ok(maximum <= 155000, `${style} 최대 ${maximum}B: 165000B보다 10000B 이상 작음`);
    console.log(JSON.stringify({ style, snapshots, folded, maxCompactBytes: maximum,
      oldMaxCompactBytes: oldMaximum, headroomBytes: 165000 - maximum }));
  });
  console.log(`ASSERT 새→816d9d5 ${JSON.stringify(reverse)}`);
  console.log("CODE 판본 협상 없음: 채널은 room 기준, 서명 수신기는 room·키·sid 기준; 접으면 _cp=2로 옛 판이 거절하고, 안 접으면 _cp=1 유지.");
  await check("세 경로 접힘·다른 값 접기 금지 오라클", () => {
    equalOracle(N); summary.assertions += 6;
    differentOracle(N); summary.assertions += 3;
  });
  await check("봉투 판수 1·2 계약·참조 비트 1~7·옛 판 거절", () => {
    for (let mask = 0; mask <= 7; mask++) {
      const value = fixture();
      for (const [i, [parent, key]] of refs.entries()) {
        if (!(mask & 1 << i)) value.econ[parent][key] = { independentChanged: i };
      }
      const packed = envelope(N, value);
      eq(packed._cp, mask ? 2 : 1, `비트 ${mask} 봉투 판수`);
      eq(packed._refs, mask || undefined, `비트 ${mask} 참조 비트`);
      eq(plain(N.expandSnapshot(clone(packed))), value, `비트 ${mask} 새 수신기 복원`);
      envelopeContract(N, old, value, packed, envelope(old, value), `비트 ${mask}`);
    }
  });
  await check("판수 2의 _refs 누락·이상값과 판수 1의 _refs 거절", () => {
    const packed = envelope(N, fixture()), missing = clone(packed);
    delete missing._refs;
    eq(N.expandSnapshot(missing), null, "판수 2에 _refs가 없으면 거절");
    const invalid = [undefined, null, false, true, 0, -1, 8, 1.5, "1", [], {},
      NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 2 ** 32 + 1];
    for (const value of invalid) {
      const bad = clone(packed); bad._refs = value;
      eq(N.expandSnapshot(bad), null, `판수 2의 잘못된 _refs ${String(value)} 거절`);
    }
    const legacy = envelope(old, fixture());
    eq(legacy._cp, 1, "옛 봉투 판수 1");
    eq(plain(N.expandSnapshot(clone(legacy))), fixture(), "판수 1에 _refs 없으면 복원");
    for (const value of [...invalid, 1, 7]) {
      const bad = clone(legacy); bad._refs = value;
      eq(N.expandSnapshot(bad), null, `판수 1에 _refs ${String(value)} 있으면 거절`);
    }
    const downgraded = clone(packed); downgraded._cp = 1;
    eq(N.expandSnapshot(downgraded), null, "접힌 봉투의 판수만 1로 내리면 거절");
  });
  await check("실제 공개 상태 report.score 변경·다른 두 경로 보존", () => {
    ok(signedView, "실제 서명/차이 검사 표본");
    const value = clone(signedView);
    value.econ.report.score = { independentChanged: 1 };
    const packed = envelope(N, value);
    eq((packed._refs || 0) & 1, 0, "실제 report.score 차이 시 접지 않음");
    eq(plain(packed.body.econ.report.score), value.econ.report.score, "다른 값 직접 보존");
    eq(plain(N.expandSnapshot(packed)), value, "실제 차이 상태 왕복");
  });
  await check("누락·null·작은 값·옛 표지·previousScore 왕복", () => {
    for (const [i, [parent, key]] of refs.entries()) {
      const cases = [
        ["target 누락", v => { delete v.econ[parent][key]; }],
        ["source 누락", v => { delete v.econ[key]; }],
        ["양쪽 누락", v => { delete v.econ[parent][key]; delete v.econ[key]; }],
        ["target null", v => { v.econ[parent][key] = null; }],
        ["source null", v => { v.econ[key] = null; }],
        ["parent 누락", v => { delete v.econ[parent]; }],
        ["parent null", v => { v.econ[parent] = null; }],
        ...[null, false, 0, "", [], {}, [-2]].map(x => [JSON.stringify(x), v => {
          v.econ[key] = clone(x); v.econ[parent][key] = clone(x);
        }, x === false ? 1 << i : 0]) // false는 JSON 5B여서 접힘; 다른 나열 값은 4B 이하.
      ];
      for (const [label, edit, expectedBit = 0] of cases) {
        const value = fixture(); edit(value);
        const packed = envelope(N, value);
        eq(plain(N.expandSnapshot(clone(packed))), value, `${parent}.${key} ${label} 왕복`);
        eq((packed._refs || 0) & 1 << i, expectedBit, `${parent}.${key} ${label} 참조 비트`);
        envelopeContract(N, old, value, packed, envelope(old, value), `${parent}.${key} ${label}`);
      }
      const unequal = fixture(); unequal.econ[parent][key] = { independentChanged: true };
      eq(roundTrip(N, unequal), unequal, `${parent}.${key} 차이 왕복`);
      eq((envelope(N, unequal)._refs || 0) & 1 << i, 0, `${parent}.${key} 차이는 안 접음`);
    }
    for (const value of [{}, { econ: null }, { econ: {} }, { econ: { report: null, scoreState: null } }]) {
      eq(roundTrip(N, value), value, "econ 없음/null 왕복");
      envelopeContract(N, old, value, envelope(N, value), envelope(old, value), "econ 없음/null");
    }
    const value = fixture(), packed = envelope(N, value);
    eq(packed.body.econ.report.previousScore, value.econ.report.previousScore, "previousScore는 동일해도 안 접음");
    const legacyMarker = { econ: { report: { score: [-2] }, scoreState: { totals: [-2] } } };
    eq(plain(N.expandSnapshot(envelope(old, legacyMarker))), legacyMarker, "_refs 없는 옛 [-2]는 값 그대로");
  });
  await check("D-64 실제 진행자 서명 → 팀 검증·한 글자 변조 거부", async () => {
    ok(signedView, "서명 검사 표본");
    await signatureChecks(N, signedView);
  });
  const mutations = [
    ["펼치기 생략", s => replaceOnce(s,
      "target[key] = JSON.parse(JSON.stringify(econ[key]));", "void marker;"), equalOracle],
    ["다를 때도 접기", s => replaceOnce(s,
      "canonical(target[key]) === canonical(econ[key]) &&\n          JSON.stringify(target[key]) === JSON.stringify(econ[key]) && ", ""), differentOracle],
    ["참조 대상 바꿔치기", s => replaceOnce(s,
      "target[key] = JSON.parse(JSON.stringify(econ[key]));",
      'target[key] = JSON.parse(JSON.stringify(econ[key === "score" ? "offers" : key === "offers" ? "totals" : "score"]));'), equalOracle],
    ["접었는데 _cp를 1로 유지", s => replaceOnce(s,
      "_cp: refs ? 2 : 1", "_cp: 1"), versionOracle]
  ];
  for (const [name, mutate, oracle] of mutations) await check(`변이 검출: ${name}`, () => {
    oracle(N); // 같은 단언이 원본에서 통과한 뒤에만 변이를 실행한다.
    const mutant = net(mutate(SOURCE));
    let caught;
    try { oracle(mutant); } catch (error) { caught = error; }
    ok(caught?.code === "ERR_ASSERTION", "문법/하네스 오류가 아닌 동작 단언 실패로 검출");
    summary.mutations.detected++;
    console.log(`MUTATION ${name}: ${caught.message.split("\n")[0]}`);
  });
}

main().catch(error => {
  summary.failures++;
  console.error(`FAIL setup: ${error.stack}`);
}).finally(() => {
  console.log(JSON.stringify(summary));
  process.exitCode = summary.failures ? 1 : 0;
});
