/* 공개 상태 축약 시안 비교: node tests/league/compact-proposal.js
 * D-77 실제 구현·화면 소비 계약: node tests/league/compact-proposal.js --production
 * 인자 없는 비교는 도입 전 base 행 배열과 시안2/3의 기록용 비교다. 시안3은 앱에 적용하지 않는다.
 *
 * 읽기 계약 조사(2026-10-13, 경로는 저장소 루트 기준)
 * '최근 두 결과'는 마지막 완료 운영과 그 직전 운영이다. 다음 계획 단계에서도 같다.
 * 아래 최소 필드보다 넓게 results/econ/teams 전체를 깊은 비교한다(D-64의 -0→0만
 * 동일하게 취급; undefined/NaN/Infinity를 JSON 왕복으로 감추지 않는다). 동적 키·전달된
 * 객체의 간접 접근까지 보호하기 위해 두 시안 모두 손실 축약을 하지 않는다.
 *
 * | 소비 화면 | 읽는 기간 | 실제 필드(중괄호는 하위 필드) | 근거 파일:줄 |
 * |---|---|---|---|
 * | 결과 서랍·지난달 비교 | 최근 두 결과 | results.{round,month,year,season,days,seed,events,tieDown,team,econ}; team.{unsPct,outH,co2Prod,co2Cons,hospH,loss,idle,grid.waitingMW,ledger,cp,unlinked,dem,uns,curtailMWh,imp,exp,cost.{fuel,policy}}; ledger.{open,income,invest,opex,close} | ui/league.js:2436,1930,1940,2418 |
 * | 계절 모드 결과 | 최신 결과 | region.{ok,unsPct,co2}, team.{unsPct,hospH,cost,co2Prod,co2Cons,imp,exp,earn,pay,sat,cp,renPct}, events,tieDown | ui/league.js:1894,3682 |
 * | 추이 그래프·CSV | 전체 36달 | results.{round,team.*.unsPct}; econ.cities.*.hist.{t,pop,appr,cash}; cities.pop0; rounds의 연·월 | ui/league.js:271,276,326 |
 * | 끝 타임라인 | 전체 36달(팀 hist는 최근 40기록 상한) | 위 추이 필드 + teams.*.hist.{r,n,l}; 나머지 결정 표지는 기기 로컬 | ui/league.js:293,921 |
 * | 끝 누적 정전·원인 | 전체 36달 | results.{round,days,month,year,team.*.outH,econ.cities.*.causes}; econ.report.{year,month,cities.*.causes}; cities.{approval,approval0}; 원인 {key,label,delta} | ui/league.js:927,1921,1930 |
 * | 끝 토의의 이웃 도움 | 전체 36달 | results.team.*.{imp,unsPct}; econ.{score,report.flows.pop,report.news} | ui/league.js:896,903 |
 * | 진행자 로그의 월 CO₂ | log 최근 12항목이 참조하는 달(두 달보다 오래될 수 있음) | results.{round,days,year,month,region.co2,econ}; econ.report.region.co2 | ui/league.js:1816,1822 |
 * | 분기 질문·CO₂ 원인 | hist 끝에서 4번째·3번째까지 | econ.cities.*.hist.{pop,ind}; cities.{pop0,ind0}; econ.before.{pop,ind}; 최근 두 results.{season,days,seed,team.*.co2Prod} | ui/league.js:893,1968,1979 |
 * | S7 정전 원인·반문 | 최근 두 결과 + 기기 로컬 운영 사본 두 달 | results.{round,year,month,season,seed,days,team.*.{unsPct,grid,cpList,spareMW,co2Prod,imp,exp}}; teams.{plan,base,research,resp,trialGrid}; econ.{before,intl,cities,report,previousScore}; ties,events,grid | ui/league.js:822,853,2150,2219,2313; ui/league-core.js:804 |
 * | 도시·재정·집단·이주·제안 | 현재 및 직전 운영 보고서 | cities.{name,pop,ind,cash,debtCap,approval,approval0,policy,groups,shares,groupParts,grid}; report.{cities,groups,fiscal,net,flows,weekMul}; offers.{name,workers,eval}; 최신 team.cost.fuel | ui/league.js:339,361,371 |
 * | 순위·가중치 시뮬레이션 | 현재 점수·직전 점수; 지지율 원값 최근 12달 | econ.{score,previousScore,totals,scoreState}; scoreState.{len,coop,order,totals,cities.*.{name,pop,pop0,ind,ind0,cash,debtCap,revYear,co2Intensity0,co2Intensity,co2pc,approval,approvalHistory,unsS}} | ui/league.js:554,968; ui/econ.js:752 |
 * | 기술·국제 지수 | 현재; 최신 결과 연구 소식 | teams.{research,rs,plan,econPol}; econ.cities.*.research; results.team.*.{research,renPct}; econ.{intl,intlActive,speeds,eduSpeed,report.news} | ui/league.js:252,380,388,405,501,562 |
 * | 진행자 건설 속도·카드 | teams.hist 전체 최근 40기록; 마지막 기록 상세 | hist.{t,r,cap,n,l}, teams.{budget,left,price,ready,seated,online,plan,research,crit}; 최신 team.{unsPct,co2Prod,imp,exp} | ui/league.js:1874,2501,2575 |
 * | 수신·자리·계획 동기화 | 현재 | teams.{seatVersion,seated,rev,ready,plan,crit,econPol,fcx,resp,left} | ui/league.js:3049,3130,3254,3558,3660 |
 * | 건설 예산·철거·시험 운전 | 현재 plan/base/배분; 최신 결과 위험 | teams.{budget,fixed,base.{k,c},plan,research,rs,trialGrid.{peakMW,round,entries.{key,allocatedMW}}}; econ.cities·intl; 최신 team.unsPct | ui/league.js:309,3187,3221; ui/league-core.js:804 |
 * | 건설 지도 실제 결과 렌즈 | 최신 완료 결과 | team.{uns,dem,unsPct,cp,cpList.{score,near}}, result.{month,days}; faded는 단계에서 계산 | ui/league.js:3244; ui/build.js:1940 |
 * | 광역 지도·진행자 위험·장부 | 현재 및 최신 결과 | teams.{plan,left,ready}; cities.{cash,debtCap,approval,approval0}; report.{cities.*.dPop,flows,region}; 최신 team.{unsPct,co2Prod,imp,exp}; results.flow.*.{ab,ba}; grid | ui/league.js:1827,1840,1864,2629,3384 |
 *
 * 주의: 오래된 results는 publicView(ui/league-core.js:475)에서 이미 요약된다.
 * 끝 화면 최소 보존은 round/days/year/month, outH/imp/unsPct, 추이 hist,
 * 건설 r/n/l이다. 로그용 region.co2도 남겨야 한다. 오래된 원인 상세는 이미
 * 네트워크에 없으며, 팀의 로컬 causes로 보완한다. 새 요약값을 전송하지 않는다.
 * teams.hist를 최근 둘로 자른 '바닥'은 크기 비교 하한일 뿐 채택할 시안이 아니다.
 * 잘라 버리면 끝 건설 표지와 진행자 spark가 사라진다(D-64의 비상 축약과 구분).
 *
 * 시안 2: base/배분의 기존 행 배열 + 결과·결과 팀·두 종류 hist의 반복 키 사전.
 *   값/존재 여부/배열 순서를 전부 보존. 없는 키와 null/0/false를 혼동하지 않는다.
 * 시안 3: 시안 2 + 정확히 같은 기존 객체만 한 번 보냄. 최신 results.econ과
 *   econ.report, score/totals/grid/research의 중복을 경로 참조로 복원한다.
 *   같다고 가정하지 않고 canonical 동일·실제 절약일 때만 생략한다.
 * 두 시안의 _cp는 전송 형식 메타데이터(버전·기존 키·기존 경로)일 뿐 새 관측값이나
 * 학생 자료가 아니다(D-65). 손실 축약/반올림/재계산/암묵적 기본값 생략은 채택 안 함.
 *
 * 구현 승인을 받으면 바뀔 경계: ui/league-net.js:52 compactSnapshot,
 * :85 expandSnapshot, :97 signHost(새 형식도 검증 전 확장 금지).
 * D-77 적용: onSnap은 expandSnapshot을 방·지역·teams 검사보다 먼저 호출한다.
 * 소비 화면 :271/:293/:326/:927/:968/:1822/:2150/:2436/:3221/:3244는
 * 변경 불필요하며 회귀 확인 지점이다. 이전 팀 클라이언트는 새 형식을 이해하지
 * 못하므로 혼재 버전 처리·디코더 길이/깊이/경로 검증을 별도 구현해야 한다.
 */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { TextEncoder, TextDecoder } = require("node:util");
const ROOT = path.resolve(__dirname, "../..");
const bytes = x => Buffer.byteLength(JSON.stringify(x), "utf8");
const clone = structuredClone;
let checks = 0, problems = 0;
function check(label, fn) {
  checks++;
  try { fn(); } catch (e) { problems++; console.error(`실패: ${label}: ${e.message.split("\n")[0]}`); }
}
// D-64 정규 JSON 절의 명시적 동등성: -0→0. 실제 2달 결과 co2Attribution의
// calendar에서 -0을 확인했다. 그 밖의 값/키/누락은 완전히 같아야 한다.
function zeroNormalized(value) {
  const out = clone(value);
  const walk = x => {
    if (typeof x === "number" && Object.is(x, -0)) return 0;
    if (x && typeof x === "object") for (const k of Object.keys(x)) x[k] = walk(x[k]);
    return x;
  };
  return walk(out);
}
const eq = (a, b) => assert.deepStrictEqual(zeroNormalized(a), zeroNormalized(b));

function engine(exposeSnapshot = false) {
  const ctx = vm.createContext({ console, document: { documentElement: {}, addEventListener() {} },
    addEventListener() {}, KCP: { route() {}, on() {}, esc: String },
    structuredClone, TextEncoder, TextDecoder, crypto: webcrypto, btoa, atob, performance });
  ctx.window = ctx;
  vm.runInContext(`const Math = globalThis.Math, JSON = globalThis.JSON, Object = globalThis.Object,
    Array = globalThis.Array, Number = globalThis.Number;
    Math.random = () => { throw new Error("씨앗 없는 Math.random 호출"); };`, ctx);
  for (const name of ["build-maps", "tech-data", "build", "econ-data", "econ",
    "league-data", "league-core", "league-ai", "league-net", "league"]) {
    const filename = path.join(ROOT, "ui", name + ".js");
    let source = fs.readFileSync(filename, "utf8");
    if (exposeSnapshot && name === "league") source = source.replace(/\}\)\(\);\s*$/, `
      KCP.snapshotFixture = value => {
        L = { room: "ROOMAAAA", snap: "무시됨" };
        onSnap(value); return L.snap;
      };
    })();`);
    vm.runInContext(source, ctx, { filename });
  }
  return ctx.KCP;
}

// JSON.stringify로 먼저 정리하면 undefined/NaN이 숨으므로 원본에서 먼저 검사한다.
function jsonOnly(x, at = "$", seen = new Set()) {
  if (x === null || typeof x === "string" || typeof x === "boolean") return;
  if (typeof x === "number") { assert.ok(Number.isFinite(x), `${at}: 유한수 아님`); return; }
  assert.ok(x && typeof x === "object", `${at}: JSON 밖 값`);
  assert.ok(!seen.has(x), `${at}: 순환 참조`);
  seen.add(x);
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) { assert.ok(Object.hasOwn(x, i), `${at}: 빈 배열 슬롯`); jsonOnly(x[i], `${at}[${i}]`, seen); }
  } else {
    assert.equal(Object.prototype.toString.call(x), "[object Object]", `${at}: 일반 객체 아님`);
    assert.ok(Object.getPrototypeOf(x) === null || Object.getPrototypeOf(x).constructor?.name === "Object");
    for (const [k, v] of Object.entries(x)) jsonOnly(v, `${at}.${k}`, seen);
  }
  seen.delete(x);
}

// D-64의 행 배열만 적용. 기존 compactSnapshot의 크기 초과 hist 삭제는 호출하지
// 않는다. 먼저 무손실 축약한 뒤 크기를 판단해야 불필요한 기록 손실을 피한다.
function baseRows(V) {
  const out = clone(V);
  assert.ok(!Object.hasOwn(out, "_cp"), "시안 메타데이터 키 충돌");
  for (const t of Object.values(out.teams)) {
    if (t.base) {
      assert.ok(!Object.hasOwn(t, "baseRows"));
      for (const row of t.base) eq(Object.keys(row).sort(), ["c", "k"]);
      t.baseRows = t.base.map(({ k, c }) => [k, c]); delete t.base;
    }
    if (t.trialGrid?.entries) {
      assert.ok(!Object.hasOwn(t.trialGrid, "rows"));
      for (const row of t.trialGrid.entries) eq(Object.keys(row).sort(), ["allocatedMW", "key"]);
      t.trialGrid.rows = t.trialGrid.entries.map(({ key, allocatedMW }) => [key, allocatedMW]);
      delete t.trialGrid.entries;
    }
  }
  return out;
}

function packRows(out, version, refs = []) {
  const keys = [], index = new Map();
  const row = obj => {
    const ks = Object.keys(obj), signature = JSON.stringify(ks);
    if (!index.has(signature)) { index.set(signature, keys.length); keys.push(ks); }
    return [index.get(signature), ...ks.map(k => obj[k])];
  };
  for (const t of Object.values(out.teams)) if (Array.isArray(t.hist)) t.hist = t.hist.map(row);
  for (const c of Object.values(out.econ?.cities || {})) if (Array.isArray(c.hist)) c.hist = c.hist.map(row);
  out.results = out.results.map(res => {
    res.team = Object.fromEntries(Object.entries(res.team).map(([id, t]) => [id, row(t)]));
    return row(res);
  });
  out._cp = { v: version, keys, refs };
  return out;
}
function compactV2(V) { return packRows(baseRows(V), 2); }
const at = (obj, keys) => keys.reduce((x, k) => x?.[k], obj);

function compactV3(V, N) {
  const out = baseRows(V), refs = [];
  // 출발 경로는 그대로 남는 곳만 사용하고, 삭제 위치의 부모는 삭제하지 않는다.
  const share = (target, source) => {
    const a = at(out, target), b = at(out, source);
    if (a === undefined || b === undefined || a === null || typeof a !== "object") return;
    if (N.canonical(a) !== N.canonical(b) || bytes(a) <= bytes([target, source]) + 2) return;
    delete at(out, target.slice(0, -1))[target.at(-1)];
    refs.push([target, source]);
  };
  out.results.forEach((r, i) => share(["results", i, "econ"], ["econ", "report"]));
  share(["econ", "score"], ["econ", "report", "score"]);
  share(["econ", "scoreState", "totals"], ["econ", "totals"]);
  for (const id of Object.keys(out.teams)) {
    share(["econ", "cities", id, "research"], ["teams", id, "research"]);
    share(["econ", "cities", id, "grid"], ["grid", id]);
  }
  return packRows(out, 3, refs);
}
function expandProposal(wire, N, version) {
  const out = clone(wire), meta = out._cp;
  assert.equal(meta.v, version);
  const row = values => {
    const keys = meta.keys[values[0]];
    assert.ok(Array.isArray(keys) && values.length === keys.length + 1, "행 길이 불일치");
    return Object.fromEntries(keys.map((key, i) => [key, values[i + 1]]));
  };
  out.results = out.results.map(values => {
    const res = row(values);
    res.team = Object.fromEntries(Object.entries(res.team).map(([id, values]) => [id, row(values)]));
    return res;
  });
  for (const t of Object.values(out.teams)) if (Array.isArray(t.hist)) t.hist = t.hist.map(row);
  for (const c of Object.values(out.econ?.cities || {})) if (Array.isArray(c.hist)) c.hist = c.hist.map(row);
  // 따로 복사한다. 공유 참조로 복원하면 한 화면의 변경이 다른 경로로 샐 수 있다.
  for (const [target, source] of meta.refs) {
    assert.notEqual(at(out, source), undefined, "복원 원본 경로 없음");
    at(out, target.slice(0, -1))[target.at(-1)] = clone(at(out, source));
  }
  delete out._cp;
  return N.expandSnapshot(out);
}
const expandV2 = (wire, N) => expandProposal(wire, N, 2);
const expandV3 = (wire, N) => expandProposal(wire, N, 3);
const PROPOSALS = [
  { name: "시안2", compact: compactV2, expand: expandV2 },
  { name: "시안3", compact: compactV3, expand: expandV3 }
];
function floorView(V) {
  const out = clone(V);
  for (const team of Object.values(out.teams)) team.hist = (team.hist || []).slice(-2);
  return out;
}

function validate(K, V, proposal, label) {
  const N = K.leagueNet, before = clone(V), wire = proposal.compact(V, N);
  check(`${label} JSON 밖 값·정규 JSON`, () => {
    jsonOnly(V); jsonOnly(wire);
    eq(JSON.parse(N.canonical(wire)), wire);
    // sig를 제외한 실제 서명 대상과 동일한 필드 구조. 크기는 데이터만 보고한다.
    N.canonical({ event: "snap", room: V.room, ...(V.sid === undefined ? {} : { sid: V.sid }), n: 1, data: wire,
      hostKey: { kty: "EC", crv: "P-256", x: "시안", y: "시안" } });
  });
  // 서명 검증기가 돌려주는 정규 JSON 파싱값을 확장하는 순서를 재현한다.
  const restored = proposal.expand(JSON.parse(N.canonical(wire)), N);
  check(`${label} 읽기 표 전체 포함 깊은 비교`, () => {
    eq(restored.results, V.results); eq(restored.econ, V.econ); eq(restored.teams, V.teams);
    eq(restored, V); assert.deepStrictEqual(clone(V), before); jsonOnly(restored); N.canonical(restored);
  });
  check(`${label} D-64 현재 계획·base·배분·최근 두 hist`, () => {
    for (const id of V.active) {
      for (const k of ["plan", "base", "trialGrid"]) eq(restored.teams[id][k], V.teams[id][k]);
      eq(restored.teams[id].hist.slice(-2), V.teams[id].hist.slice(-2));
      eq(restored.econ?.cities[id]?.hist.slice(-2), V.econ?.cities[id]?.hist.slice(-2));
    }
    eq(restored.grid, V.grid); eq(restored.results.slice(-2), V.results.slice(-2));
  });
  check(`${label} 실제 추이·CSV·가중치 함수`, () => {
    const U = K.league.uiMath;
    for (const id of V.active) {
      eq(U.monthPoints(restored, id), U.monthPoints(V, id));
      for (const timeline of [false, true]) eq(U.trendHTML(restored, id, timeline), U.trendHTML(V, id, timeline));
    }
    eq(U.publicCSV(restored), U.publicCSV(V));
    if (V.econ) {
      const weights = K.ECON_DATA.params.wScore.v;
      for (const w of [weights, { ...weights, co2: 0.30 }, Object.fromEntries(Object.keys(weights).map(k => [k, 0]))])
        eq(U.weightSimulation(restored.econ, w), U.weightSimulation(V.econ, w));
    }
  });
  check(`${label} 바닥도 정규 JSON·깊은 복원`, () => {
    const floor = floorView(V), packed = proposal.compact(floor, N);
    jsonOnly(packed); eq(proposal.expand(JSON.parse(N.canonical(packed)), N), floor);
  });
  return bytes(wire);
}

function edgeChecks(K, V) {
  const N = K.leagueNet, id = V.active[0];
  for (const proposal of PROPOSALS) {
    const sample = clone(V);
    // 서로 다른 키 집합·누락·명시적 기본값을 구별하며 이전 hist의 plan도 보존한다.
    sample.teams[id].hist = [{ t: 0, r: 1, cap: 0, n: 0, l: 0, plan: { builds: [], lines: [] } },
      { t: 1, r: 1, cap: null, n: false, l: "" }, {}];
    check(`${proposal.name} 누락·기본값·과거 계획 무손실`, () => {
      eq(proposal.expand(JSON.parse(N.canonical(proposal.compact(sample, N))), N), sample);
    });
    const unequal = clone(V);
    if (unequal.results.length && unequal.econ?.report) {
      unequal.results.at(-1).econ = { month: -1 };
      check(`${proposal.name} 서로 다른 보고서 생략 금지`, () =>
        eq(proposal.expand(JSON.parse(N.canonical(proposal.compact(unequal, N))), N), unequal));
    }
  }
  for (const bad of [undefined, NaN, Infinity, -Infinity, new Number(1), [, 1]]) {
    check("JSON 밖 값 검출기 확인", () => { assert.throws(() => jsonOnly({ bad })); assert.throws(() => N.canonical({ bad })); });
  }
  check("중복 객체 복원은 별도 사본", () => {
    const packed = compactV3(V, N), restored = expandV3(JSON.parse(N.canonical(packed)), N);
    assert.ok(packed._cp.refs.length > 0, "중복 제거 경로를 실제로 검증해야 함");
    for (const [target, source] of packed._cp.refs) {
      eq(at(restored, target), at(restored, source));
      assert.notStrictEqual(at(restored, target), at(restored, source));
    }
  });
}

function run() {
  const started = performance.now(), K = engine(), C = K.leagueCore, BG = K.buildGame, N = K.leagueNet;
  const ids = C.regionOf("south").teams.map(t => t.id), player = ids[0];
  const S = C.newState("SIZE36", "south", 0, ids, { turns: 36, seedMode: "fixed" });
  assert.equal(ids.length, 6);
  for (const id of ids) assert.ok(C.reduce(S, { type: "claim", team: id, token: "solo-city-" + id }, 0, BG)?.ok);
  let snapshots = 0;
  const measure = (month, phase) => {
    const V = C.publicView(S, 0);
    // size-budget와 같은 혼자 하기 모형에는 서명 세션이 없다. publicView는 sid:
    // undefined를 내놓지만 실제 JSON 전송에서는 이 키가 빠진다. 새 값을 만들지
    // 않고 이 한 키만 명시적으로 제외한다(바이트 불변). 다른 JSON 밖 값은 실패.
    if (V.sid === undefined) delete V.sid;
    const compact = baseRows(V), floor = floorView(compact);
    const row = { month, current: bytes(compact), floor: bytes(floor) };
    snapshots++;
    for (const p of PROPOSALS) {
      row[p.name] = validate(K, V, p, `${month}달 ${phase} ${p.name}`);
      row[p.name + "바닥"] = bytes(p.compact(floorView(V), N));
    }
    return row;
  };
  // 로비·빈 결과도 검사한다. 본 측정 행은 size-budget.js와 같은 두 시점의 최대다.
  measure(0, "로비");
  assert.ok(C.host(S, "next", 0));
  const rows = [];
  while (S.phase !== "end" && rows.length < 36) {
    assert.equal(S.phase, "plan"); assert.equal(S.round, rows.length + 1);
    C.computerPlans(S, BG, player, "balanced", false);
    C.computerPlans(S, BG, player, "balanced", true);
    C.computerPlans(S, BG, player, "balanced", true);
    assert.ok(C.reduce(S, { type: "ready", team: player, token: "solo-city-" + player, ready: true }, 0, BG)?.ok);
    assert.ok(C.run(S, BG, 0)); assert.equal(S.phase, "review");
    const month = S.round, row = measure(month, "운영 직후");
    assert.ok(C.host(S, "next", 0));
    const after = measure(month, S.phase);
    for (const k of Object.keys(row).filter(k => k !== "month")) row[k] = Math.max(row[k], after[k]);
    rows.push(row);
  }
  assert.equal(rows.length, 36); assert.equal(S.phase, "end");
  const last = C.publicView(S, 0); if (last.sid === undefined) delete last.sid;
  edgeChecks(K, last);
  console.log("6팀·36달 fixed; 혼자 하기 computerPlans(false,true,true); 운영 직후/다음 계획·종료 중 큰 값");
  console.log("데이터만 JSON UTF-8 B. 서명·Supabase 봉투는 미포함. 바닥은 팀 hist 최근 둘만 남긴 비교 하한.");
  console.log("원본 비교: 혼자 하기의 undefined sid만 실제 전송처럼 제외; D-64에 따라 -0/0 동등, 나머지 엄격 깊은 비교.");
  console.log("달\t현재\t현재 바닥\t시안2\t절감률\t시안2 바닥\t시안3\t절감률\t시안3 바닥");
  for (const r of rows) console.log([r.month, r.current, r.floor, ...PROPOSALS.flatMap(p =>
    [r[p.name], ((1 - r[p.name] / r.current) * 100).toFixed(2) + "%", r[p.name + "바닥"]])].join("\t"));
  for (const p of PROPOSALS) check(`${p.name} 모든 달 현재 크기 이하·데이터 178000B 미만`, () => {
    for (const r of rows) assert.ok(r[p.name] <= r.current && r[p.name] < 178000);
  });
  console.log(`검증: ${snapshots}개 공개 상태(로비+36달×2), ${checks}단언, 실패 ${problems}; ${Math.round(performance.now() - started)}ms`);
  console.log("시안2: 읽는 기록 전체를 행 배열로 무손실 복원. 키 사전 비용·새 디코더 필요.");
  console.log("시안3: 시안2+동일 보고서·연구·계통·합계 중복 제거. 서로 다르면 유지; 참조 복원 순서·독립 사본 주의.");
  console.log("미검증: 브라우저 화면, 실제 서명·Supabase 포장/송수신, 구버전 혼재, 비경제 계절 모드 완주·다른 씨앗/성향.");
  console.log("앱 적용 전 총괄의 샌드박스 밖 로컬 브라우저 검증 필요. 코드 위치/읽기 표는 이 파일 머리말.");
}
// D-77 실제 구현 계약 검사. 시안2/3 비교는 인자 없이 종전대로 실행한다.
function productionChecks() {
  const K = engine(true), N = K.leagueNet;
  const source = { room: "ROOMAAAA", region: "south", sid: undefined,
    teams: { a: { hist: [{ r: 0, gone: undefined, cap: -0 }, null, 7, false, "", [0, 1], {}] } },
    econ: { cities: { a: { hist: [null, {}, [1], { r: 1, x: null }] } } },
    results: [null, 1, [], { round: 1 }, { team: null },
      { team: { a: { n: 0, x: false }, b: null, c: [0], d: "old" } }] };
  const roundTrip = value => N.expandSnapshot(JSON.parse(N.canonical(N.compactSnapshot(value))));
  check("D-77 새 봉투: 옛 팀의 !teams 검사에서 무시·방/지역 보존", () => {
    const wire = N.compactSnapshot(source);
    assert.equal(wire._cp, 1); assert.ok(!wire.teams);
    assert.equal(wire.room, source.room); assert.equal(wire.region, source.region);
  });
  check("D-77 sid는 확장 전 서명 세션 검사에 남고 왕복 보존", () => {
    const value = { ...source, sid: "가상-세션" }, wire = N.compactSnapshot(value);
    assert.equal(wire.sid, value.sid); assert.ok(!Object.hasOwn(wire.body, "sid"));
    eq(roundTrip(value), JSON.parse(JSON.stringify(value)));
  });
  check("D-77 onSnap은 새 봉투·직접 공개 상태 수용, 미지 판수·다른 방·지역 무시", () => {
    const value = { room: "ROOMAAAA", region: "south", teams: {}, now: 0 };
    eq(K.snapshotFixture(N.compactSnapshot(value)), value);
    eq(K.snapshotFixture(clone(value)), value);
    for (const invalid of [null, { _cp: 2 }, { ...value, room: "ROOMBBBB" }, { ...value, region: "other" }, { ...value, teams: null }])
      assert.equal(K.snapshotFixture(invalid), "무시됨");
  });
  check("D-77 비상 축약이 행 배열화보다 먼저 오래된 계획을 요약·최근 둘 보존", () => {
    const hist = Array.from({ length: 20 }, (_, r) => ({ t: r, r, cap: 2 * r, n: r, l: 0,
      plan: { builds: [], detail: "가".repeat(4000) } }));
    const value = { teams: { a: { hist, plan: { builds: [1] }, base: [{ k: "a", c: 2 }],
      trialGrid: { entries: [{ key: "a", allocatedMW: 2 }] } } } };
    const packed = N.compactSnapshot(value), restored = N.expandSnapshot(clone(packed));
    assert.ok(bytes(packed) <= 178000);
    eq(restored.teams.a.hist.slice(0, -2), hist.slice(0, -2).map(({ t, r, cap, n, l }) => ({ t, r, cap, n, l })));
    eq(restored.teams.a.hist.slice(-2), hist.slice(-2));
    for (const key of ["plan", "base", "trialGrid"]) eq(restored.teams.a[key], value.teams.a[key]);
  });
  check("D-77 undefined·원시값·null·배열·team 없는 옛 결과 보존", () => {
    const before = clone(source);
    eq(roundTrip(source), JSON.parse(JSON.stringify(source)));
    assert.deepStrictEqual(source, before);
  });
  check("D-77 알 수 없는 판수·null 무시", () => {
    assert.equal(N.expandSnapshot({ _cp: 99, room: source.room, region: source.region }), null);
    assert.equal(N.expandSnapshot(null), null);
  });
  check("D-77 옛 진행자 base·trialGrid 복원과 혼자 하기 직접 호출", () => {
    const old = { teams: { a: { baseRows: [["b:0", 3]], trialGrid: { rows: [["k", 2]] } } } };
    eq(N.expandSnapshot(old), { teams: { a: { base: [{ k: "b:0", c: 3 }], trialGrid: { entries: [{ key: "k", allocatedMW: 2 }] } } } });
    eq(N.expandSnapshot(clone(source)), source);
  });
  for (const key of ["__proto__", "constructor", "prototype"]) check(`D-77 위험한 사전 키 거절 ${key}`, () => {
    const wire = N.compactSnapshot({ room: "ROOMAAAA", region: "south", teams: { a: { hist: [{ r: 1 }] } } });
    wire.keys[0][0] = key;
    assert.equal(N.expandSnapshot(wire), null);
    assert.equal({}.polluted, undefined);
  });
  check("D-77 base·배분의 누락·추가 필드·비객체 항목 보존", () => {
    const sample = { teams: { a: { base: [{ k: "a" }, null, { k: "b", c: 2, extra: false }],
      trialGrid: { entries: [{ key: "a", allocatedMW: 2, extra: 0 }] } } } };
    eq(roundTrip(sample), sample);
  });
  for (const mutate of [
    w => { w.keys[0].push(w.keys[0][0]); },
    w => { w.keys[0][0] = 1; },
    w => { w.body.teams.a.hist[0][0] = 99; },
    w => { w.body.teams.a.hist[0].push(3); },
    w => { w.body.teams.a.hist[0] = [-1]; }
  ]) check("D-77 잘못된 사전·행 길이·표지 거절", () => {
    const wire = N.compactSnapshot({ teams: { a: { hist: [{ r: 1 }] } } });
    mutate(wire); assert.equal(N.expandSnapshot(wire), null);
  });
  // 시안의 화면 소비 함수·D-64 보존 단언을 실제 구현에 그대로 적용한다.
  if (!process.argv.includes("--edges-only")) {
    const { simulate } = require("./size-budget.js");
    for (const style of ["balanced", "careful"]) {
      const result = simulate(K, 36, style, "fixed", "SIZE36", V => validate(K,
        JSON.parse(JSON.stringify(V)), { compact: N.compactSnapshot, expand: N.expandSnapshot }, `${style} ${V.round}달 ${V.phase}`));
      console.log(`${style}·fixed: ${result.snapshots}개 공개 상태의 화면 소비·D-64 보존 검사`);
    }
  }
}
if (require.main === module) {
  try { if (process.argv.includes("--production")) productionChecks(); else run(); } catch (e) { problems++; console.error(`실행 실패: ${e.stack}`); }
  console.log(`단언: ${checks}, problems: ${problems}`);
  process.exitCode = problems ? 1 : 0;
}
module.exports = { compactV2, expandV2, compactV3, expandV3 };
