"use strict";
// ECON-BALANCE v1.4.1 B18 독립 검사. 계수 기대값은 명세에서 직접 옮겼다.
// ECON-EVIDENCE §11.2·11.3·11.5: 계통·제어 크기는 G, 옥외 ESS 90%는 O*.
// 근사 전력 입력(lib.js) 대신 실제 build/league 엔진을 DOM 없이 실행한다.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "../../..");
const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } });
ctx.window = ctx;
vm.runInContext('Math.random = () => { throw new Error("Math.random called"); };', ctx);
for (const name of ["build-maps", "build", "econ-data", "econ", "league-data", "league-core"]) {
  const file = path.join(ROOT, `ui/${name}.js`);
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
}
const { leagueCore: C, buildGame: bg, ECON_DATA: D } = ctx.KCP;
const R = C.regionOf("south"), ids = R.teams.map(t => t.id);
const clone = x => JSON.parse(JSON.stringify(x)), sum = xs => xs.reduce((a, b) => a + b, 0);
let passes = 0, fails = 0;
const ok = (yes, text) => { if (yes) passes++; else { fails++; console.log("FAIL:", text); } };
const near = (a, b, text) => ok(Number.isFinite(a) && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b)), `${text}: ${a} / ${b}`);
const test = (title, fn) => { try { fn(); } catch (e) { ok(false, `${title}: ${e.stack}`); } };
const game = monthly => {
  const S = C.newState("b18-independent", R.id, 0, ids, monthly === false ? undefined : { turns: 36 });
  S.round = 1; S.phase = "plan"; S.events = [];
  return S;
};
function select(id) { bg.selectPack(C.teamDef(R, id).pack, "league"); }
function planOf(id, types, connect = false) {
  select(id);
  const plan = { builds: [], lines: [] }, used = new Set();
  const anchor = bg.SITES.find(s => s.dem).tile;
  for (const t of types) {
    const tile = bg.TILES.find(q => !used.has(q.i) && !bg.siteRule(t, q) && (!connect || bg.routePath(anchor, q.i)));
    if (!tile) throw new Error(`fixture ${id}/${t} 자리가 없음`);
    used.add(tile.i); plan.builds.push({ t, i: tile.i });
    if (connect) {
      const route = bg.routePath(anchor, tile.i);
      for (let j = 0; j < route.length - 1; j += 79) plan.lines.push({ p: route.slice(j, j + 80) });
    }
  }
  return bg.sanitize(plan, 1e9);
}
const key = b => `${b.t}:${b.i}`;
const allocated = g => sum(g.entries.map(e => e.allocatedMW));

test("도시별 시작 H와 월 한도", () => {
  const S = game();
  ids.forEach(id => {
    select(id);
    const expectedPeak = bg.peakDemand({}, false), before = JSON.stringify(S);
    const g = C.gridStatus(S, R, bg, id);
    ok(JSON.stringify(S) === before, `gridStatus 입력 불변 ${id}`);
    near(g.peakMW, expectedPeak, `도시 피크 ${id}`);
    near(g.hostMW, expectedPeak * 0.4, `시작 H=피크×0.4 ${id}`);
    near(g.monthlyMW, expectedPeak * (0.00375 * 27), `월 한도=피크×0.1 ${id}`);
    near(g.waitingMW, 0, `빈 계획 대기 0 ${id}`);
    S.teams[id].plan = planOf(id, ["battery"]);
    const withBattery = C.gridStatus(S, R, bg, id);
    near(withBattery.hostMW - g.hostMW, bg.M.batMW, `ESS 1 MW당 H +1 ${id}`);
    S.econ.cities[id].pop *= 2; S.econ.cities[id].ind *= 2;
    S.teams[id].plan.policies = ["save", "dr"];
    near(C.gridStatus(S, R, bg, id).peakMW, expectedPeak, `시작 피크는 인구·정책 변경에 고정 ${id}`);
  });
});

test("v1.4.1 등급·소수력 접속·옛 저장 1회 이행", () => {
  for (const k of ["hostCapMul", "curtailLoadMul", "curtailSlope", "curtailKnee", "curtailMax", "curtailOffSeason", "curtailLossReal"])
    ok(D.params[k].grade === (["hostCapMul", "curtailSlope", "curtailKnee", "curtailLossReal"].includes(k) ? "M" : "G"), `${k} RECAL-SPEC §1.1 근거/게임 가정 등급`);
  const S = game(), id = "hwaseong";
  S.round = 3;
  S.teams[id].plan = planOf(id, ["hydro", "solar", "solar", "solar", "solar"], true);
  const hydroMW = bg.BLD.hydro.mw;
  const fresh = C.gridStatus(S, R, bg, id);
  near(fresh.connectedMW, 0, "새 게임은 즉시 접속 이행 대상 아님");
  delete S.grid;
  const before = JSON.stringify(S), migrated = C.gridStatus(S, R, bg, id);
  ok(JSON.stringify(S) === before, "옛 저장 접속 조회도 입력 불변");
  near(allocated(migrated), migrated.hostMW, "옛 설비를 H까지 즉시 배정");
  ok(migrated.entries[0].t === "hydro" && migrated.entries[0].allocatedMW === hydroMW, "옛 소수력도 즉시 접속");
  ok(migrated.connectedMW > migrated.monthlyMW && migrated.waitingMW > 0, "월 한도보다 큰 옛 접속 복원·H 밖 대기");
  C.refreshGrid(S, bg);
  const once = JSON.stringify(S.grid);
  C.refreshGrid(S, bg);
  ok(JSON.stringify(S.grid) === once, "저장 이행은 한 번만");
  S.teams[id].plan.builds.shift();
  C.refreshGrid(S, bg);
  near(S.grid[id].connectedMW, migrated.connectedMW - hydroMW, "철거 후 빈 H를 즉시 재배정하지 않음");
  S.round++;
  C.refreshGrid(S, bg, true);
  ok(allocated(S.grid[id]) <= allocated(migrated) - hydroMW + migrated.monthlyMW + 1e-8, "이행 뒤 추가 접속은 월 한도");

  const edited = game(); edited.round = 3; delete edited.grid;
  edited.teams[id].plan = planOf(id, ["hydro"], true);
  edited.teams[id].token = "legacy-test";
  const result = C.reduce(edited, { type: "plan", team: id, token: "legacy-test", rev: 1,
    plan: planOf(id, ["hydro", "solar"], true) }, 0, bg);
  ok(result.ok, "옛 저장 첫 계획 수정 승인");
  near(edited.grid[id].connectedMW, hydroMW, "첫 수정에서도 원래 소수력만 즉시 접속");
  near(edited.grid[id].waitingMW, 2, "이행 직후 새 태양광은 대기");
});

test("연계선은 지어진 선만 H에 가산", () => {
  const S = game(), id = ids[0], other = ids[1];
  const base = C.gridStatus(S, R, bg, id).hostMW;
  S.ties = [{ a: id, b: other, cap: 4, st: "proposed" }];
  near(C.gridStatus(S, R, bg, id).hostMW, base, "제안 중인 선은 여유 아님");
  S.ties[0].st = "built";
  near(C.gridStatus(S, R, bg, id).hostMW, base, "내부망 미연결 연계선은 여유 아님");
  for (const [here, there] of [[id, other], [other, id]]) {
    select(here);
    const pack = ctx.KCP.BUILD_MAPS[C.teamDef(R, here).pack];
    const gate = pack.gates.find(q => q.to.includes(there));
    const tile = bg.TILES.find(q => q.c === gate.c && q.r === gate.r);
    const route = bg.routePath(bg.SITES.find(q => q.dem).tile, tile.i);
    S.teams[here].plan = bg.sanitize({ builds: [], lines: [{ p: route }] }, 1e9);
  }
  near(C.gridStatus(S, R, bg, id).hostMW, base + 4 * 0.5, "연결선 4 MW → H +2 MW");
  const outage = R.events.find(e => e.effect && (e.effect.tieDown || e.effect.tieCapMul));
  ok(!!outage, "연계선 고장·감축 사건 fixture");
  if (outage) {
    S.events = [{ id: outage.id, round: S.round }];
    near(C.gridStatus(S, R, bg, id).hostMW, base + 4 * 0.5, "일시 고장에도 접속권 H 유지");
  }
});

test("FIFO·월별 누적·중복 실행·철거", () => {
  const S = game(), id = ids.reduce((a, b) => C.gridStatus(S, R, bg, a).peakMW < C.gridStatus(S, R, bg, b).peakMW ? a : b);
  S.teams[id].plan = planOf(id, Array(12).fill("solar"));
  const order = S.teams[id].plan.builds.map(key);
  C.refreshGrid(S, bg, true);
  let g = S.grid[id];
  ok(g.waitingMW > 0, "재생 과다 계획에 접속 대기 발생");
  near(allocated(g), Math.min(g.hostMW, g.monthlyMW), "첫 달 배정은 H·월한도 이내");
  const first = JSON.stringify(g);
  C.refreshGrid(S, bg, true);
  ok(JSON.stringify(S.grid[id]) === first, "같은 달 재실행은 월 한도를 다시 지급하지 않음");
  S.teams[id].plan.builds.reverse();
  C.refreshGrid(S, bg, false);
  ok(JSON.stringify(S.grid[id].entries.map(e => e.key)) === JSON.stringify(order), "계획 배열 순서를 바꿔도 최초 대기 순서 유지");
  const firstEntry = S.grid[id].entries[0], firstMW = firstEntry.mw;
  if (g.monthlyMW < firstMW) {
    near(g.connectedMW, 0, "부분 배정은 접속 완료로 세지 않음");
    near(C.modsFor(S, R, id).reCap[firstEntry.key], 0, "부분 배정 설비는 발전 0 훅");
  }
  const totalMW = sum(g.entries.map(e => e.mw));
  for (let month = 2; month <= 12; month++) {
    S.round = month; C.refreshGrid(S, bg, true); g = S.grid[id];
    near(allocated(g), Math.min(totalMW, g.hostMW, month * g.monthlyMW), `누적 배정 ${month}달`);
    near(g.connectedMW + g.waitingMW, totalMW, `접속+대기=설비 용량 ${month}달`);
    const partial = g.entries.findIndex(e => e.allocatedMW < e.mw - 1e-8);
    ok(partial < 0 || g.entries.slice(partial + 1).every(e => e.allocatedMW === 0), `FIFO 선행 미충족이면 후행 배정 없음 ${month}달`);
  }
  const removed = S.teams[id].plan.builds.pop();
  C.refreshGrid(S, bg, false);
  ok(!S.grid[id].entries.some(e => e.key === key(removed)), "철거된 설비는 접속 대기열에서도 제거");
});

test("ESS 철거로 H가 줄면 후순위 설비는 다시 대기", () => {
  const S = game(), id = ids[0];
  S.teams[id].plan = planOf(id, [...Array(12).fill("solar"), "battery"]);
  for (let month = 1; month <= 12; month++) { S.round = month; C.refreshGrid(S, bg, true); }
  const connectedBefore = S.grid[id].connectedMW;
  S.teams[id].plan.builds = S.teams[id].plan.builds.filter(b => b.t !== "battery");
  C.refreshGrid(S, bg, false);
  const g = S.grid[id];
  ok(g.connectedMW < connectedBefore, "ESS 철거 후 접속량 감소");
  ok(allocated(g) <= g.hostMW + 1e-8, "기존 배정량도 감소한 H 이내");
  near(g.connectedMW + g.waitingMW, 24, "재대기 뒤 접속+대기 용량 보존");
});

test("출력제어 계절식과 경제 전용 훅", () => {
  const S = game(), id = ids[0];
  S.teams[id].plan = planOf(id, [...Array(10).fill("solar"), ...Array(3).fill("battery")]);
  for (let month = 1; month <= 18; month++) { S.round = month; C.refreshGrid(S, bg, true); }
  const g = S.grid[id], r = g.connectedMW / (0.4 * g.peakMW);
  const spring = Math.min(0.6, Math.max(0, 1.3 * (r - 0.64))) * (0.018 * 3.3);
  ok(spring > 0, "제어식 양수 fixture");
  for (const [month, multiplier] of [[3, 1], [5, 1], [9, 1], [11, 1], [1, 0.3], [7, 0.3]]) {
    S.round = month;
    near(C.modsFor(S, R, id).curtailP, spring * multiplier, `월 ${month} 강제 손실 비율`);
  }
  near(C.modsFor(S, R, id).essCap, 0.9, "경제 ESS 90% 훅");
  const season = game(false);
  C.refreshGrid(season, bg, true);
  const mods = C.modsFor(season, R, id), view = C.publicView(season, 0);
  ok(!season.grid && !view.grid, "계절 상태에 grid 없음");
  ok(!Object.hasOwn(mods, "reCap") && !Object.hasOwn(mods, "curtailP") && !Object.hasOwn(mods, "essCap"), "계절 MODS에 B18 훅 없음");
});

test("실제 발전: 대기 차단·강제 버림·일반잉여 분리", () => {
  const id = "pyeongtaek";
  select(id);
  // §11.6의 조력 포함. 현재 6도시에 합법 조력 타일이 없어 분류 계약을 확인한다.
  ok(bg.BLD.tidal.variable === true, "조력은 변동 재생 분류");
  ok(!bg.BLD.hydro.variable && !bg.BLD.biomass.variable, "소수력·바이오매스는 변동 재생 출력제어 제외");
  ok(bg.BLD.hydro.hostLimited && !bg.BLD.biomass.hostLimited, "소수력 접속 제한·바이오매스 면제");
  for (const t of ["solar", "roof", "wind", "offshore", "hydro"]) {
    const plan = planOf(id, [t], true);
    plan.season = "spring"; plan.seed = 812;
    const run = mods => bg.simulate(clone(plan), 7, { league: true, mods });
    const normal = run({}), disconnected = run({ reCap: { [key(plan.builds[0])]: 0 } });
    ok(normal.tot.renAvail > 0, `${t} 실제 발전 fixture`);
    near(disconnected.tot.renAvail, 0, `${t} 접속 대기는 발전 안 함`);
    const curtailed = run({ curtailP: 0.036 });
    near(curtailed.tot.curtailMWh, normal.tot.renAvail * (t === "hydro" ? 0 : 0.036), `${t} 변동 재생만 강제 버림=가능 발전×3.6%`);
    ok(curtailed.tot.curt >= 0 && (t === "hydro" ? curtailed.tot.curtailMWh === 0 : curtailed.tot.curtailMWh > 0), `${t} 일반잉여·강제 버림 별도 기록`);
    const after = run({});
    ok(JSON.stringify(after) === JSON.stringify(normal), `${t} MODS는 다음 실행에 남지 않음`);
  }
});

test("ESS 우선 회수와 충전 상한", () => {
  const id = ids[0], plan = planOf(id, [...Array(8).fill("solar"), "battery"], true);
  plan.season = "summer"; plan.seed = 812;
  const run = (p, mods) => bg.simulate(clone(p), 1, { league: true, mods });
  const without = clone(plan); without.builds = without.builds.filter(b => b.t !== "battery");
  const noBat = run(without, { curtailP: 1, essCap: 0.9 });
  const withBat = run(plan, { curtailP: 1, essCap: 0.9 });
  ok(withBat.tot.curtailMWh < noBat.tot.curtailMWh, "자기 배터리가 강제 버림 전력을 우선 회수");
  const saturated = run(plan, { demandMul: 1e-12, essCap: 0.9 });
  near(saturated.tot.batEnd, bg.M.batMWh * 0.9, "충분한 재생·무부하에서 ESS 90%까지만 충전");
  const uncapped = run(plan, { demandMul: 1e-12 });
  ok(uncapped.tot.batEnd > saturated.tot.batEnd, "essCap 없는 기존 충전 용량 유지");
});

test("결과·공개·월환산과 재실행", () => {
  const S = game(), id = ids[0];
  S.teams[id].plan = planOf(id, ["solar", "roof", "roof", "roof", ...Array(18).fill("solar")], true);
  for (let month = 1; month <= 12; month++) { S.round = month; C.refreshGrid(S, bg, true); }
  S.round = 15; C.refreshGrid(S, bg, true);
  const before = JSON.stringify(S.grid);
  const res = C.run(S, bg, 1), team = res.team[id], view = C.publicView(S, 2);
  ok(JSON.stringify(S.grid) === before, "run·경제 재시뮬레이션에서 같은 달 접속 한도 중복 소진 없음");
  ok(team.grid.waitingMW > 0 && team.curtailMWh > 0, "재생 과다 도시 결과에 접속 대기·출력제어량");
  near(view.grid[id].headroomMW, S.grid[id].headroomMW, "AI가 읽는 공개 grid의 H 여유");
  near(view.econ.cities[id].grid.waitingMW, S.grid[id].waitingMW, "경제 공개 도시의 접속 대기");
  const energy = C.econInput(S, R, id, team, 31 / 7).energy;
  near(energy.curtailMWh, team.curtailMWh * 31 / 7, "출력제어 MWh의 7일→31일 환산");
  near(res.econ.grid[id].curtailMWh, energy.curtailMWh, "월 보고서의 제어량은 월환산 값");
  near(view.econ.cities[id].curtailMWh, energy.curtailMWh, "공개 경제 도시의 제어량은 월환산 값");
  console.log("B18 실측", D.start[id].name, JSON.stringify({ connectedMW: team.grid.connectedMW, waitingMW: team.grid.waitingMW, headroomMW: team.grid.headroomMW, curtail7dayMWh: team.curtailMWh, curtailMonthMWh: energy.curtailMWh }));
});

test("지난 결과 화면의 월환산 대체 값", () => {
  // 브라우저 배치 대신 결과 서랍에서 실제 쓰는 계산 구간을 Node로 실행한다.
  const source = fs.readFileSync(path.join(ROOT, "ui/league.js"), "utf8");
  const start = source.indexOf("        const rd = C.roundsOf(V)[res.round - 1];");
  const end = source.indexOf("        const rank =", start);
  ok(start >= 0 && end > start, "결과 서랍의 출력제어 계산 구간");
  const S = game(), id = ids[0]; S.round = 4;
  const calculate = res => vm.runInNewContext(source.slice(start, end) + "curtailMWh", {
    C, V: S, L: { team: id }, res, r: res.team[id]
  });
  near(calculate({ round: 3, econ: null, team: { [id]: { curtailMWh: 7 } } }), 31,
    "지난 3월 대표 7일 7 MWh는 현재 4월과 무관하게 31 MWh");
  near(calculate({ round: 2, team: { [id]: { curtailMWh: 7 } } }), 28,
    "보고서 누락된 2월은 28일로 환산");
  near(calculate({ round: 3, econ: { grid: { [id]: { curtailMWh: 0 } } },
    team: { [id]: { curtailMWh: 7 } } }), 0, "월 보고서의 0은 대체하지 않음");
  ok(calculate({ round: 3, econ: null, team: { [id]: {} } }) === undefined,
    "원자료도 없으면 허위 0을 만들지 않음");
});

test("강제 버림은 연계선 판매로 되살아나지 않음", () => {
  const a = "hwaseong", b = "pyeongtaek", plans = {};
  for (const [here, there] of [[a, b], [b, a]]) {
    const plan = planOf(here, here === a ? Array(20).fill("solar") : [], true);
    select(here);
    const pack = ctx.KCP.BUILD_MAPS[C.teamDef(R, here).pack];
    const gate = pack.gates.find(q => q.to.includes(there));
    const tile = bg.TILES.find(q => q.c === gate.c && q.r === gate.r);
    plan.lines.push({ p: bg.routePath(bg.SITES.find(q => q.dem).tile, tile.i) });
    plans[here] = plan;
  }
  const dispatch = curtailP => {
    const sims = {};
    for (const id of [a, b]) sims[id] = C.simTeam(bg, R, id, plans[id], { season: "spring", seed: 812, days: 7 }, 1e9, { curtailP });
    const settled = C.settle([{ id: `${a}~${b}`, a, b, cap: 4 }], sims, { [a]: 0.001, [b]: 0.02 }, 168, 7);
    return { sims, settled };
  };
  const normal = dispatch(0), forced = dispatch(1);
  ok(normal.settled.out[a].exp > 0, "출력제어 전에는 재생 판매가 있는 fixture");
  ok(forced.sims[a].gx.some(g => g.to.includes(b)), "실제 연계선 접속망 fixture");
  near(sum(forced.sims[a].gx.map(g => sum(Array.from(g.ren)))), 0, "전부 제어하면 GX의 판매 가능 재생 0");
  near(forced.settled.out[a].exp, 0, "전부 제어하면 이 도시 재생 판매 0");
});

test("재생 과다·연결 ESS의 실제 회수 수치", () => {
  const S = game(), id = "hwaseong";
  S.teams[id].plan = planOf(id, [...Array(20).fill("solar"), ...Array(6).fill("battery")], true);
  for (let month = 1; month <= 27; month++) { S.round = month; C.refreshGrid(S, bg, true); }
  const g = S.grid[id], res = C.run(S, bg, 1), team = res.team[id];
  ok(g.connectedMW > g.peakMW && g.waitingMW > 0, "피크보다 큰 재생 접속·추가 대기 fixture");
  ok(Number.isFinite(team.curtailMWh) && team.curtailMWh >= 0, "ESS 전량 회수에서도 출력제어량은 음수 아님");
  const energy = C.econInput(S, R, id, team, 31 / 7).energy;
  near(energy.curtailMWh, team.curtailMWh * 31 / 7, "ESS 회수 뒤 제어량도 월환산");
  console.log("B18 연결 ESS 실측", D.start[id].name, JSON.stringify({ connectedMW: g.connectedMW, waitingMW: g.waitingMW, renPct: team.renPct, curtail7dayMWh: team.curtailMWh, curtailMonthMWh: energy.curtailMWh }));
});

console.log(`B18: ${passes} 통과, ${fails} 실패`);
process.exitCode = fails ? 1 : 0;
