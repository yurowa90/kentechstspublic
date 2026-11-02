/* 구현자 자체 검사. 독립 검토는 별도 세션에서 수행한다. 브라우저·연결 없음. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { webcrypto } = require("node:crypto");
const { engine, simulate } = require("../size-budget.js");
const ROOT = path.resolve(__dirname, "../../..");
const filename = path.join(ROOT, "ui/league-net.js");
const source = fs.readFileSync(filename, "utf8");
// 현재 소스를 흉내 낸 옛 봉투가 아니라 지정된 작업 줄기의 코덱을 실제로 실행한다.
const oldSource = execFileSync("git", ["show", "816d9d5:ui/league-net.js"], { cwd: ROOT, encoding: "utf8" });
function net(code) {
  const ctx = vm.createContext({ window: { KCP: {} }, TextEncoder, TextDecoder,
    crypto: webcrypto, btoa, atob });
  vm.runInContext(code, ctx, { filename });
  return ctx.window.KCP.leagueNet;
}
const plain = x => JSON.parse(JSON.stringify(x));
const bytes = x => Buffer.byteLength(JSON.stringify(x));
const N = net(source), OLD = net(oldSource);
function fixture() {
  const score = { rank: [{ id: "city-a", parts: { pop: 10, cash: 20 } }], total: 30 };
  const offers = [{ id: "offer-a", eval: { rank: ["city-a"], by: { "city-a": { ok: true } } } }];
  const totals = { pop: 123, cash: 456 };
  return { room: "FIXTURE1", region: "south", sid: "fixture-session", teams: {},
    econ: { score, offers, totals, report: { score: plain(score), offers: plain(offers) },
      scoreState: { totals: plain(totals) }, previousScore: { total: 29 } } };
}
function roundtrip(codec, view, label) {
  const before = JSON.stringify(view), compact = codec.compactSnapshot(view);
  if (compact._refs) {
    assert.equal(compact._cp, 2, label + " 참조 봉투 판 2");
    assert.equal(OLD.expandSnapshot(plain(compact)), null, label + " 옛 판은 참조 봉투 거절");
  } else {
    assert.equal(compact._cp, 1, label + " 참조 없으면 판 1");
    assert.ok(!Object.hasOwn(compact, "_refs"), label + " 참조 없으면 _refs 생략");
    assert.equal(JSON.stringify(compact), JSON.stringify(OLD.compactSnapshot(view)),
      label + " 접기 없는 봉투는 옛 형식과 바이트 동일");
  }
  const restored = codec.expandSnapshot(plain(compact));
  assert.deepStrictEqual(plain(restored), plain(view), label + " 깊은 비교");
  assert.equal(codec.canonical(restored), codec.canonical(plain(view)), label + " 정규 JSON 바이트");
  // 기존 base/room 복원에 따른 키 순서까지 이전 디코더 출력과 동일해야 한다.
  assert.equal(JSON.stringify(restored), JSON.stringify(OLD.expandSnapshot(plain(OLD.compactSnapshot(view)))),
    label + " 이전 확장 결과 JSON 바이트");
  assert.equal(JSON.stringify(codec.expandSnapshot(JSON.parse(codec.canonical(compact)))),
    JSON.stringify(OLD.expandSnapshot(JSON.parse(OLD.canonical(OLD.compactSnapshot(view))))),
    label + " 정규 JSON 전송 뒤 이전 확장 결과 바이트");
  assert.equal(JSON.stringify(view), before, label + " 입력 불변");
  return compact;
}
function synthetic(codec) {
  const view = fixture(), packed = codec.compactSnapshot(view);
  assert.equal(OLD.expandSnapshot(plain(packed)), null, "옛 판(816d9d5)은 새 참조 봉투를 null로 거절");
  assert.ok(bytes(packed) < bytes(OLD.compactSnapshot(view)), "동일한 중복은 실제 전송에서 접음");
  assert.deepStrictEqual(plain(packed.body.econ.report.score), [-2], "score 참조 표지");
  assert.deepStrictEqual(plain(packed.body.econ.report.offers), [-2], "offers 참조 표지");
  assert.deepStrictEqual(plain(packed.body.econ.scoreState.totals), [-2], "totals 참조 표지");
  roundtrip(codec, view, "같은 값");
  const expanded = codec.expandSnapshot(plain(packed));
  expanded.econ.report.score.rank[0].parts.pop++;
  expanded.econ.report.offers[0].eval.rank.push("city-b");
  expanded.econ.scoreState.totals.pop++;
  assert.deepStrictEqual(plain(expanded.econ.score), view.econ.score, "펼친 score 별도 사본");
  assert.deepStrictEqual(plain(expanded.econ.offers), view.econ.offers, "펼친 offers 별도 사본");
  assert.deepStrictEqual(plain(expanded.econ.totals), view.econ.totals, "펼친 totals 별도 사본");
  for (const [parent, key] of [["report", "score"], ["report", "offers"], ["scoreState", "totals"]]) {
    const changed = fixture();
    if (key === "score") changed.econ[parent][key].rank[0].parts.pop++;
    else if (key === "offers") changed.econ[parent][key][0].eval.rank.push("city-b");
    else changed.econ[parent][key].pop++;
    const p = roundtrip(codec, changed, "다른 값 " + key);
    assert.deepStrictEqual(plain(p.body.econ[parent][key]), changed.econ[parent][key], "다른 값 접기 금지 " + key);
  }
  for (const value of [null, [], [-2], [-1, "literal"], { extra: true }]) {
    const unusual = fixture();
    unusual.econ.report.score = value; unusual.econ.report.offers = value;
    roundtrip(codec, unusual, "원시·표지 모양 원본 보존");
    assert.deepStrictEqual(plain(codec.expandSnapshot(plain(OLD.compactSnapshot(unusual)))), plain(unusual),
      "접기 없는 옛 봉투의 표지 모양 원본 보존");
  }
  const missing = fixture(); delete missing.econ.score; delete missing.econ.report.offers;
  roundtrip(codec, missing, "누락 필드 보존");
  for (const values of [null, [], [-2], { extra: true }]) {
    const noRefs = fixture();
    noRefs.econ.report.score = values; noRefs.econ.report.offers = values;
    noRefs.econ.scoreState.totals = values;
    roundtrip(codec, noRefs, "참조 없는 판 1 봉투");
  }
  // 깊은 값은 같아도 객체 키 순서가 다르면 원래 JSON 바이트를 보존한다.
  const reordered = fixture(); reordered.econ.report.score = { total: 30, rank: reordered.econ.score.rank };
  roundtrip(codec, reordered, "키 순서 보존");
  assert.deepStrictEqual(plain(codec.expandSnapshot(plain(view))), view, "_cp 없는 공개 상태 보존");
  const confused = plain(packed); confused._cp = 1;
  assert.equal(codec.expandSnapshot(confused), null, "판 1에 _refs가 있으면 형식 혼동 거절");
  const absent = plain(packed); absent._cp = 2; delete absent._refs;
  assert.equal(codec.expandSnapshot(absent), null, "판 2에 _refs가 없으면 거절");
  for (const version of [0, 3, "1", "2", null]) {
    const malformed = plain(packed); malformed._cp = version;
    assert.equal(codec.expandSnapshot(malformed), null, "지원하지 않는 봉투 판 거절");
  }
  for (const flag of [0, -1, 8, 1.5, "1", null, [], {}]) {
    const malformed = plain(packed); malformed._refs = flag;
    assert.equal(codec.expandSnapshot(malformed), null, "알 수 없는 참조 비트 거절");
  }
  for (const corrupt of [
    p => { delete p.body.econ.score; },
    p => { p.body.econ.report.score = [-2, "extra"]; },
    p => { p.body.econ.report = null; }
  ]) {
    const malformed = plain(packed); corrupt(malformed);
    assert.equal(codec.expandSnapshot(malformed), null, "불완전 참조 거절");
  }
}
async function signatures() {
  const identity = await N.createIdentity(), binding = await N.hostBinding(identity.publicKey);
  const view = fixture(); view.room = binding.room;
  const wire = await N.signHost(identity, "snap", view.room, view.sid, view);
  const { sig, ...signed } = wire;
  const key = await webcrypto.subtle.importKey("jwk", identity.publicKey,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = data => webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
    Buffer.from(sig, "base64"), new TextEncoder().encode(N.canonical(data)));
  assert.ok(await valid(signed), "D-64 압축 봉투 정규 JSON 서명");
  assert.ok(!await valid({ ...signed, data: N.expandSnapshot(plain(signed.data)) }), "펼친 값은 서명 대상 아님");
  let applied;
  const receive = N.hostReceiver({ room: view.room }, (_, data) => { applied = N.expandSnapshot(data); });
  assert.ok(await receive("snap", plain(wire)), "진행자 서명 수신·확장");
  assert.deepStrictEqual(plain(applied), view, "서명 검증 뒤 공개 상태 원형 복원");
  const tampered = plain(wire); tampered.n++; tampered.data.body.econ.score.total++;
  assert.ok(!await N.hostReceiver({ room: view.room }, () => assert.fail("변조 반영"))("snap", tampered),
    "참조 원본 변조 서명 거절");
  const team = await N.createIdentity();
  const request = await N.signEnvelope(team, "city-a", { type: "ready", ready: true, sid: view.sid, seat: 0 }, 100);
  assert.ok(await N.verifyEnvelope(plain(request), team.publicKey), "팀 body 문자열 서명 유지");
  assert.ok(!await N.verifyEnvelope({ ...request, body: request.body.replace('"ready":true', '"ready":false') },
    team.publicKey), "팀 요청 변조 거절");
}
async function main() {
  synthetic(N);
  const K = engine();
  let states = 0, oldStates = 0;
  for (const style of ["balanced", "careful"]) {
    let folded = 0;
    const result = simulate(K, 36, style, "fixed", "SIZE36", view => {
      const packed = roundtrip(N, view, style + " " + states++);
      if (packed._refs) folded++;
      const old = OLD.compactSnapshot(view);
      assert.ok(!Object.hasOwn(old, "_refs"), "작업 줄기의 참조 없는 옛 봉투");
      assert.deepStrictEqual(plain(N.expandSnapshot(plain(old))), plain(view), "옛 봉투 새 확장 깊은 비교");
      assert.equal(JSON.stringify(N.expandSnapshot(plain(old))), JSON.stringify(OLD.expandSnapshot(plain(old))),
        "옛 봉투 확장 JSON 바이트 불변");
      oldStates++;
    });
    assert.equal(result.snapshots, 73);
    assert.ok(folded >= 72, style + " 실전 중복 접기 경로 실행");
    console.log(`${style}: ${result.snapshots}개 새 왕복·옛 봉투 복원 통과`);
  }
  await signatures();
  // 구현 파일을 바꾸지 않고 실제 코덱의 메모리 소스만 변이한다.
  const mutations = [
    ["펼치기 생략", "target[key] = JSON.parse(JSON.stringify(econ[key]));", "/* 표지만 남김 */"],
    ["다른 값도 접기", "canonical(target[key]) === canonical(econ[key]) &&\n          JSON.stringify(target[key]) === JSON.stringify(econ[key])", "true"],
    ["offers 접기 생략", "[\"report\", \"offers\"]", "[\"report\", \"unusedOffers\"]"],
    ["참조 사본 생략", "target[key] = JSON.parse(JSON.stringify(econ[key]));", "target[key] = econ[key];"],
    ["판 올림 생략", "_cp: refs ? 2 : 1", "_cp: 1"],
    ["판·참조 결속 생략", 'if ((view._cp === 2) !== Object.hasOwn(view, "_refs")) return null;', "/* 판·참조 혼동 허용 */"]
  ];
  for (const [name, from, to] of mutations) {
    assert.ok(source.includes(from), "변이 적용 위치 " + name);
    assert.throws(() => synthetic(net(source.replaceAll(from, to))), { name: "AssertionError" }, "변이 검출 " + name);
    console.log(`변이 검출: ${name}`);
  }
  console.log(`PASS 새 상태 ${states}, 옛 봉투 ${oldStates}, 서명·경계·변이 ${mutations.length}종`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
