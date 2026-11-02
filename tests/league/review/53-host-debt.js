// 정책0 호스트: 모든 도시의 세율·서비스·보조 0 요청 → AI 건설 계획 → C.run.
// node tests/league/review/53-host-debt.js [--all] [--seeds a,b] [--months 12,24] [--styles bold]
// node tests/league/review/53-host-debt.js --self-test
// 파일을 쓰지 않으며, require 시에는 실행하지 않는다.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { performance } = require("node:perf_hooks");
const ROOT = path.resolve(__dirname, "../../..");
const SEEDS = ["alpha", "beta", "gamma", "delta", "epsilon"];
const LENGTHS = [12, 24, 36];
const clone = value => JSON.parse(JSON.stringify(value));

class CheckFailure extends Error {}
function checks(quiet = false) {
  return {
    passed: 0, failed: 0,
    check(condition, message) {
      if (condition) { this.passed++; return true; }
      this.failed++;
      // 자체 변이용 수집기는 기대한 실패를 FAIL 줄로 내보내지 않는다.
      if (!quiet) console.error(`FAIL: ${message}`);
      return false;
    },
    require(condition, message) {
      if (!this.check(condition, message)) throw new CheckFailure(message);
    }
  };
}

function context() {
  const ctx = vm.createContext({ console, document: { documentElement: {} },
    KCP: { route() {}, on() {}, esc: x => x } });
  ctx.window = ctx;
  vm.runInContext('Math.random = () => { throw Error("unseeded Math.random"); };', ctx);
  for (const name of ["build-maps", "tech-data", "build", "econ-data", "econ",
    "league-data", "league-core", "league-ai"]) {
    const file = path.join(ROOT, "ui", name + ".js");
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  }
  return ctx;
}

// AI.plan보다 먼저 확인해 미등록 문자열 → balanced 대체를 막는다.
function validateStyle(style, data, test) {
  test.require(typeof style === "string" && Object.hasOwn(data.params.aiStyles.v, style),
    `등록되지 않은 성향: ${JSON.stringify(style)}`);
}

function runSeed(seed, gameMonths, persona, options = {}) {
  const test = options.test || checks(), start = performance.now();
  const ctx = context();
  const { leagueCore: C, buildGame: B, leagueAI: AI, econ: X, ECON_DATA: D } = ctx.KCP;
  validateStyle(persona, D, test);
  test.require(LENGTHS.includes(gameMonths), `게임 길이는 12·24·36: ${gameMonths}`);
  const months = options.sampleMonths ?? gameMonths;
  test.require(Number.isInteger(months) && months > 0 && months <= gameMonths,
    `관측 달 수: ${months}/${gameMonths}`);
  const mutation = options.mutation;
  if (mutation) {
    test.require(["tiny-cap", "negative-cash"].includes(mutation), `알 수 없는 변이: ${mutation}`);
    test.require(!!options.overTest, "변이 실행에는 초과 판정 수집기가 필요함");
    // econ.setBase / prepareYear가 읽는 연 세입 대비 지방채 한도 계수. 이 VM에만 적용한다.
    test.require(Number.isFinite(D.params.debtCapRatio.v) && D.params.debtCapRatio.v > 1e-9,
      "변이 전 debtCapRatio가 양의 정상 계수여야 함");
    D.params.debtCapRatio.v = 1e-9;
  }
  const R = C.regionOf("south"), ids = R.teams.map(t => t.id);
  test.require(ids.length > 0, "참가 도시가 비어 있음");
  const label = `seed=${seed} months=${months} style=${persona}${mutation ? ` mutation=${mutation}` : ""}`;
  const S = C.newState(seed, R.id, 0, ids, { turns: gameMonths });
  ids.forEach(id => { S.teams[id].token = "grid-test"; });
  test.require(!!S.econ, `${label} 경제 모드가 필요함`);
  if (mutation === "negative-cash") {
    // 한도만 줄여도 첫 분기 지원금 때문에 첫 3달 현금이 양수일 수 있다.
    // tiny-cap에서 실제 초과가 없을 때만 시작 현금을 크게 음수로 두어 같은 호스트 경로를 검사한다.
    ids.forEach(id => { S.econ.cities[id].cash = -1e9; });
  }
  const over = Object.fromEntries(ids.map(id => [id, 0]));
  const overMonths = Object.fromEntries(ids.map(id => [id, []]));
  const minHead = Object.fromEntries(ids.map(id => [id, Infinity]));
  let calls = 0;
  const step = X.monthStep;
  X.monthStep = (...args) => {
    calls++;
    const at = `${label} month=${S.round} call=${calls}`;
    test.require(calls === S.round && calls <= months, `${at} monthStep 호출 순서·횟수`);
    const result = step(...args), fiscal = result?.report?.fiscal;
    test.require(!!fiscal && typeof fiscal === "object", `${at} report.fiscal 누락`);
    for (const id of ids) {
      const where = `${at} city=${id}`;
      test.require(Object.hasOwn(fiscal, id) && !!fiscal[id], `${where} 재정 보고 누락`);
      const f = fiscal[id];
      test.require(typeof f.debtOver === "boolean", `${where} debtOver는 boolean이어야 함`);
      test.require(Number.isFinite(f.cashAfter) && Number.isFinite(f.debtCap),
        `${where} cashAfter·debtCap은 유한수여야 함`);
      // ui/econ.js의 monthStep: 운영 후 c.cash < -c.debtCap. 등호·반올림·오차 허용 없음.
      // 같은 보고의 cashAfter·debtCap으로 다시 판정하는 '보고 필드 일관성' 검사다.
      // debtCap 산정 자체의 오류는 여기서 잡지 않는다(20·24번 재정 계약 검사 범위).
      // debtStage의 위기 판정은 별개이며, 이 재판정에는 사용하지 않는다.
      const independentOver = f.cashAfter < -f.debtCap;
      test.require(f.debtOver === independentOver,
        `${where} debtOver=${f.debtOver} 독립 재계산=${independentOver} cashAfter=${f.cashAfter} debtCap=${f.debtCap}`);
      if (f.debtOver) { over[id]++; overMonths[id].push(S.round); }
      minHead[id] = Math.min(minHead[id], f.cashAfter + f.debtCap);
      // 변이 실행에서는 같은 판정을 별도 수집기(options.overTest)에 세어, 진짜 초과가 실패로 집계되는지 확인한다.
      (mutation ? options.overTest : test).check(f.debtOver === false,
        `정책0 지방채 ${where} cashAfter=${f.cashAfter} debtCap=${f.debtCap}`);
    }
    return result;
  };
  try {
    for (let month = 1; month <= months; month++) {
      const at = month * 100000, where = `${label} month=${month}`;
      test.require(C.host(S, "next", at) === true && S.round === month,
        `${where} 계획 단계 진입`);
      const request = (id, msg) => {
        const result = C.reduce(S, { team: id, token: "grid-test", ...msg }, at + 1, B);
        test.require(result?.ok === true,
          `${where} city=${id} reduce ${msg.type}: ${JSON.stringify(result)}`);
      };
      ids.forEach(id => request(id, { type: "econ", taxRes: 0, taxInd: 0, service: 0, incentive: 0 }));
      const plans = Object.fromEntries(ids.map(id => {
        const p = AI.plan(S, R, id, B, persona).plan;
        return [id, { builds: clone(p.builds), lines: clone(p.lines) }];
      }));
      ids.forEach(id => request(id, { type: "plan", rev: S.teams[id].rev + 1, plan: plans[id] }));
      test.require(!!C.run(S, B, at + 50), `${where} C.run 결과 누락`);
      test.require(calls === month, `${where} monthStep은 매달 정확히 1회: ${calls}`);
    }
    test.require(calls === months, `${label} monthStep 총 ${calls}회, 기대 ${months}회`);
  } finally { X.monthStep = step; }
  const sc = X.score(S.econ, D);
  return { seed, months, persona, ...(months !== gameMonths ? { gameMonths } : {}),
    ...(mutation ? { mutation } : {}), over, overMonths,
    minHead: Object.fromEntries(ids.map(id => [id, +minHead[id].toFixed(2)])),
    score: Object.fromEntries(ids.map(id => [id, sc.by[id].score])),
    co2: Object.fromEntries(ids.map(id => [id, sc.by[id].parts?.co2])),
    sec: +((performance.now() - start) / 1000).toFixed(3) };
}

function selfTest(test = checks()) {
  // tiny-cap만으로는 첫 분기 지원금 때문에 3달 안에 초과가 나지 않으므로(10-28 확인) negative-cash로 검사한다.
  const overTest = checks(true);
  const result = runSeed("alpha", 12, "balanced", { test, overTest, sampleMonths: 3, mutation: "negative-cash" });
  console.log(JSON.stringify(result));
  const total = Object.values(result.over).reduce((sum, count) => sum + count, 0);
  test.require(total > 0, "자체 변이 검출 실패: 지방채 초과가 최소 1건 필요함");
  // 초과 1건마다 정상 실행의 실패 판정도 1건 올라가야 한다(조용한 통과 방지).
  test.require(overTest.failed === total, `자체 변이: 실패 집계 ${overTest.failed}건, 초과 ${total}건`);
}

function csv(value, name) {
  const items = value.split(",").map(item => item.trim());
  if (items.some(item => !item)) throw new Error(`${name}: 빈 항목은 허용하지 않음`);
  return items;
}
function parseArgs(args, styles) {
  const values = {}, flags = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--all", "--self-test"].includes(arg)) { flags.add(arg); continue; }
    if (!["--seeds", "--months", "--styles"].includes(arg)) throw new Error(`알 수 없는 옵션: ${arg}`);
    if (Object.hasOwn(values, arg)) throw new Error(`중복 옵션: ${arg}`);
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`${arg}: 값이 필요함`);
    values[arg] = csv(args[++i], arg);
  }
  if (flags.has("--self-test") && (flags.size > 1 || Object.keys(values).length))
    throw new Error("--self-test는 단독으로 실행");
  const months = values["--months"]?.map(Number) || (flags.has("--all") ? LENGTHS : [36]);
  if (months.some(n => !LENGTHS.includes(n))) throw new Error("--months: 12·24·36만 허용");
  const selected = values["--styles"] || (flags.has("--all") ? styles : ["balanced"]);
  for (const style of selected) if (!styles.includes(style)) throw new Error(`등록되지 않은 성향: ${style}`);
  return { seeds: values["--seeds"] || SEEDS, months, styles: selected, selfOnly: flags.has("--self-test") };
}

function main(args = process.argv.slice(2), legacy = false) {
  const test = checks();
  const guard = (name, fn) => {
    try { fn(); }
    catch (error) { if (!(error instanceof CheckFailure)) test.check(false, `${name}: ${error.message || error}`); }
  };
  guard("하네스", () => {
    const styles = Object.keys(context().KCP.ECON_DATA.params.aiStyles.v);
    const config = legacy
      ? parseArgs(["--seeds", args[0] || SEEDS.join(","), "--months", args[1] || "36",
        "--styles", args[2] || "balanced"], styles)
      : parseArgs(args, styles);
    if (legacy && args.length > 3) throw new Error("기존 CLI: [씨앗,..] [달 수] [성향]");
    if (!config.selfOnly) {
      for (const seed of config.seeds) for (const months of config.months) for (const style of config.styles)
        guard(`seed=${seed} months=${months} style=${style}`, () => {
          console.log(JSON.stringify(runSeed(seed, months, style, { test })));
        });
    }
    guard("자체 변이 검사", () => selfTest(test));
  });
  console.log(`53-host-debt: ${test.passed} 통과 / ${test.failed} 실패`);
  if (test.failed) process.exitCode = 1;
  return { passed: test.passed, failed: test.failed };
}

module.exports = { runSeed, selfTest, parseArgs, main };
if (require.main === module) main();
