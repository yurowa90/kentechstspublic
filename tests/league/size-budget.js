/* 공개 상태·혼자 하기 저장 크기 검사. node tests/league/size-budget.js */
"use strict";

// league-net.js: 기록 축약 문턱 178000B, 전송 MAX_BYTES 200000B.
// D-77, 2026-10-17: 6팀 36달 balanced·fixed 149068B, careful·fixed 152599B.
// 최종 _cp 봉투 전체 기준. 목표선은 실패선, 회귀선은 두 판 최대값 + 2500B.
// 2026-10-25 기준선 갱신: D-87(LNG·석탄 신설·입지 민원)이 공개 상태를 늘려 두 판 최대 153789B → 155801B(+1.3%).
// 의도한 기능 증가라 회귀선을 새 최대값 + 2500B로 옮긴다. 실패선 165000B·전송 상한 200000B는 그대로.
const MAX_TARGET = 165000;
// 2026-10-25 2차 갱신: D-90·집단 전용 항 뒤 중복 접기(_cp 2)로 두 판 최대 152890B → 회귀선 152890 + 2500.
const REGRESS_COMPACT = 155390;
const MAX_FLOOR = 178000;
const MAX_COMPACT = 200000;
// 혼자 하기 저장 한도 약 5200000자의 40%. 자유 서술·이전 판은 근사에서 제외한다.
const MAX_SOLO_CHARS = 2080000;
// 최근 두 달만 남긴 바닥도 계속 커지는지 12달과 36달을 비교한다.
const MAX_GROWTH = 1.5;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { TextEncoder, TextDecoder } = require("node:util");
const ROOT = path.resolve(__dirname, "../..");
// compactSnapshot의 _cp 봉투 전체를 잰다. 실제 전송은 서명 봉투(hostKey·sig·sid·n)와 broadcast 봉투가 더해져 수백 B 크다.
const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");

function options(args) {
  const opt = { months: 36, json: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--months" && ["12", "24", "36"].includes(args[i + 1])) {
      opt.months = Number(args[++i]);
    } else if (args[i] === "--json" && args[i + 1] && !args[i + 1].startsWith("--")) {
      opt.json = args[++i];
    } else {
      throw new Error("사용법: node tests/league/size-budget.js [--months 12|24|36] [--json 파일]");
    }
  }
  return opt;
}

function engine() {
  // bots36.py의 Node 실행부와 같은 최소 DOM 대역. 브라우저·연결은 열지 않는다.
  const ctx = vm.createContext({
    console, document: { documentElement: {} },
    KCP: { route() {}, on() {}, esc: x => x },
    structuredClone, TextEncoder, TextDecoder, crypto: webcrypto,
    btoa, atob, performance
  });
  ctx.window = ctx;
  // vm 전역 프록시의 반복 조회를 줄인다. 원래 내장 객체·연산·씨앗은 그대로다.
  vm.runInContext(`
    const Math = globalThis.Math, JSON = globalThis.JSON, Object = globalThis.Object,
      Array = globalThis.Array, Number = globalThis.Number;
    Math.random = () => { throw new Error("씨앗 없는 Math.random 호출"); };
  `, ctx);
  for (const name of ["build-maps", "tech-data", "build", "econ-data", "econ",
    "league-data", "league-core", "league-ai", "league-net"]) {
    const filename = path.join(ROOT, "ui", name + ".js");
    vm.runInContext(fs.readFileSync(filename, "utf8"), ctx, { filename });
  }
  return ctx.KCP;
}

function measure(KCP, S) {
  const view = KCP.leagueCore.publicView(S, 0);
  const compact = KCP.leagueNet.compactSnapshot(view);
  const restored = KCP.leagueNet.expandSnapshot(JSON.parse(KCP.leagueNet.canonical(compact)));
  assert.deepStrictEqual(structuredClone(restored), JSON.parse(JSON.stringify(view)), "모든 공개 상태 JSON 왕복 동일");
  const floorView = structuredClone(view);
  for (const team of Object.values(floorView.teams)) team.hist = (team.hist || []).slice(-2);
  const floor = KCP.leagueNet.compactSnapshot(floorView);
  return { view, compact, floor };
}

function simulate(KCP, months, style = "balanced", seedMode = "fixed", room = "SIZE36", inspect = () => {}) {
  const C = KCP.leagueCore, BG = KCP.buildGame;
  const ids = C.regionOf("south").teams.map(t => t.id), player = ids[0];
  const S = C.newState(room, "south", 0, ids, { turns: 36, seedMode });
  for (const id of ids) {
    const result = C.reduce(S, { type: "claim", team: id, token: "solo-city-" + id }, 0, BG);
    if (!result?.ok) throw new Error(`팀 입장 거부 ${id}: ${result?.err}`);
  }
  // league.js의 새 혼자 하기 판처럼 입장 뒤 로비 상태를 보관한다.
  const initial = structuredClone(S), rows = [];
  let largest = null, snapshots = 0;
  const snapshot = () => {
    const measured = measure(KCP, S);
    snapshots++; inspect(measured.view);
    return measured;
  };
  snapshot();
  if (!C.host(S, "next", 0)) throw new Error("첫 달 시작 실패");
  // --months는 같은 36달 판의 앞부분을 측정한다. 기본 실행은 end까지 진행한다.
  while (S.phase !== "end" && rows.length < months) {
    if (S.phase !== "plan" || S.round !== rows.length + 1) {
      throw new Error(`계획 단계 진행 오류: ${S.phase}, ${S.round}달`);
    }
    // league.js soloComputers(false·true) 뒤 soloNext가 준비 직전에 computerPlans(true)를 한 번 더 부른다.
    C.computerPlans(S, BG, player, style, false);
    C.computerPlans(S, BG, player, style, true);
    C.computerPlans(S, BG, player, style, true);
    const ready = C.reduce(S, { type: "ready", team: player,
      token: "solo-city-" + player, ready: true }, 0, BG);
    if (!ready?.ok) throw new Error(`플레이어 준비 거부: ${ready?.err}`);
    const result = C.run(S, BG, 0);
    if (!result || S.phase !== "review") throw new Error(`${S.round}달 운영 실패`);

    const { view, compact, floor } = snapshot();
    // league.js saveSolo의 필드 모양을 따른 근사. 빠지는 것: previous(지난 판 사본), 일지·답변 자유 서술,
    // interview.months[달].operatingPlan(플레이어 계획 사본), 플레이어 도시 계획(컴퓨터만 계획함). 실제 저장은 이보다 크다.
    const solo = JSON.stringify({ v: 1, state: S, team: player, style,
      interview: { docs: {}, journal: {}, freeExperiment: false },
      aiRound: S.round, initial });
    const row = { month: S.round, publicBytes: bytes(view), compactBytes: bytes(compact),
      floorBytes: bytes(floor), stateBytes: bytes(S), soloBytes: Buffer.byteLength(solo, "utf8"),
      soloChars: solo.length };
    rows.push(row);
    if (!largest || row.publicBytes > largest.bytes) {
      largest = { month: row.month, bytes: row.publicBytes,
        keys: Object.entries(view).filter(([, value]) => value !== undefined)
          .map(([key, value]) => ({ key, bytes: bytes({ [key]: value }) }))
          .sort((a, b) => b.bytes - a.bytes).slice(0, 8) };
    }
    if (!C.host(S, "next", 0)) throw new Error(`${S.round}달 결과 뒤 진행 실패`);
    // 운영 직후뿐 아니라 다음 계획 단계·끝 단계의 스냅숏도 보낸다(로그·사건이 더해짐). 큰 쪽을 그 달 값으로 쓴다.
    const after = snapshot();
    row.compactBytes = Math.max(row.compactBytes, bytes(after.compact));
    row.floorBytes = Math.max(row.floorBytes, bytes(after.floor));
    row.publicBytes = Math.max(row.publicBytes, bytes(after.view));
  }
  if (rows.length !== months || (months === 36 && S.phase !== "end")) {
    throw new Error(`완주 실패: ${rows.length}달, ${S.phase}`);
  }
  return { style, seedMode, room, rows, largest, snapshots };
}

function report({ style, seedMode, rows, largest, snapshots }) {
  let problems = 0;
  console.log(`${style}·${seedMode}: ${snapshots}개 공개 상태 왕복 통과`);
  console.log("운영 직후/다음 단계 중 큰 크기: 바이트는 JSON UTF-8, 저장 문자는 JS 문자열 길이");
  console.log("달\t공개(B)\t압축(B)\t바닥(B)\t전체 상태(B)\t저장(B)\t저장(자)");
  for (const r of rows.filter(r => [6, 12, 24, 36].includes(r.month))) {
    console.log([r.month, r.publicBytes, r.compactBytes, r.floorBytes,
      r.stateBytes, r.soloBytes, r.soloChars].join("\t"));
  }
  const budgets = [
    ["압축 목표선", "compactBytes", MAX_TARGET, true],
    ["압축 회귀선", "compactBytes", REGRESS_COMPACT, true],
    ["바닥 하드선", "floorBytes", MAX_FLOOR, false],
    ["압축 하드선", "compactBytes", MAX_COMPACT, false],
    ["혼자 하기 저장", "soloChars", MAX_SOLO_CHARS, false]
  ];
  for (const [label, field, limit, inclusive] of budgets) {
    const failed = rows.filter(r => inclusive ? r[field] > limit : r[field] >= limit);
    problems += failed.length;
    const max = rows.reduce((a, b) => a[field] >= b[field] ? a : b);
    const unit = field === "soloChars" ? "자" : "B";
    console.log(`${failed.length ? "실패" : "통과"}: ${label} ${inclusive ? "≤" : "<"} ${limit}${unit}; 최대 ${max.month}달 ${max[field]}${unit}`);
    for (const r of failed) {
      console.log(`  실패: ${r.month}달 ${r[field]}${unit}`);
    }
  }
  const m12 = rows.find(r => r.month === 12), m36 = rows.find(r => r.month === 36);
  if (m12 && m36) {
    const ok = m36.floorBytes <= m12.floorBytes * MAX_GROWTH;
    if (!ok) problems++;
    console.log(`${ok ? "통과" : "실패"}: 바닥 증가 36달/12달 = ${(m36.floorBytes / m12.floorBytes).toFixed(4)} ≤ ${MAX_GROWTH} (${m36.floorBytes}B / ${m12.floorBytes}B)`);
  } else {
    console.log("미검사: 바닥 증가 36달/12달 비교는 --months 36에서만 수행");
  }
  console.log(`가장 큰 공개 상태: ${largest.month}달 ${largest.bytes}B, 상위 키 8개(각 키·값을 감싼 JSON 크기)`);
  for (const entry of largest.keys) console.log(`  ${entry.key}\t${entry.bytes}B`);
  return problems;
}

if (require.main === module) {
  let problems = 0;
  try {
    const opt = options(process.argv.slice(2));
    const start = performance.now(), K = engine();
    const results = ["balanced", "careful"].map(style => simulate(K, opt.months, style));
    for (const result of results) problems += report(result);
    if (opt.json) {
      fs.writeFileSync(opt.json, JSON.stringify(results, null, 2) + "\n", "utf8");
      console.log(`달별 행 저장: ${opt.json}`);
    }
    console.log(`측정: ${results.length}판 × ${opt.months}달, 실행 ${(performance.now() - start).toFixed(0)}ms; 문제 수는 달별 예산 위반과 증가 위반의 합`);
  } catch (error) {
    problems++;
    console.error(`실행 실패: ${error.message}`);
  }
  console.log(`problems: ${problems}`);
  process.exitCode = problems > 0 ? 1 : 0;

}
module.exports = { engine, simulate };
