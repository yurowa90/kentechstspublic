"use strict";
// 독립 전략 검산: ECON-TECH-SPEC T5 v1.1. 36달, 7전략×6도시, 같은 방 씨앗.
// 판정 G: 연구 몰빵−연구0 평균 점수는 (0,15], 공통 6도시 지배 전략 없음.
// 연구0도 건설·정책을 운영한다. 기준 AI의 확정 공급 확보를 모든 전략에 재사용한다.
// 각 판의 다른 5도시는 균형 AI. 기대 점수·순위는 구현에서 복사하지 않는다.
// 최초 고정정책0·잔여자금 건설 실험은 평균 연구 이득−2.25점, 작은3도시SMR미착공.
// 수정 근거: T5에는 세율0 고정 제한이 없다. 모든 전략에 같은 AI 재정 대응을 적용하고,
// 특화 해금 설비 착공 전에는 선택 투자를 미뤄 자금을 모은다. 필수 공급은 계속 확보한다.
// 도시 제외·점수 문턱 변경은 하지 않는다. 원 결과는 /tmp/kcp-tech-balance-fixed-policy.*.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "../../.."), OUT = process.env.TECH_BALANCE_OUT || "/tmp/kcp-tech-balance.json";
const ctx = vm.createContext({ console, document: { documentElement: {} }, KCP: { route() {}, on() {}, esc: x => x } });
ctx.window = ctx;
vm.runInContext('Math.random = () => { throw new Error("unseeded random"); };', ctx);
for (const n of ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core"])
  vm.runInContext(fs.readFileSync(path.join(ROOT, `ui/${n}.js`), "utf8"), ctx, { filename: n });
// 착공 예외 진단도 AI와 같은 대표 주·연료·학생 총점 비교를 실행한다.
// 별도 비용식을 복제하지 않고 현재 엔진 함수 본문을 읽어 VM 안에서만 노출한다.
const aiSource = fs.readFileSync(path.join(ROOT, "ui/league-ai.js"), "utf8");
function aiBlock(from, to) {
  const start = aiSource.indexOf(from), end = aiSource.indexOf(to, start);
  if (start < 0 || end < 0) throw Error("T5 SMR 비교 엔진 구간을 확인하세요");
  return aiSource.slice(start, end);
}
const smrComparison = `
  KCP.t5SmrComparison = function(S, R, id, bg, plan, tile) {
    const C = KCP.leagueCore, rounds = C.roundsOf(S), turn = Math.max(1, S.round);
    const seed = \`\${S.seedKey ?? S.room}:\${S.round}:\${id}\`;
    const start = bg.SITES.find(s => s.kind === "plant") || bg.SITES.find(s => s.dem);
    const connected = bg.network(plan), anchor = connected.nodes.find(n => n.tile === start.tile);
    const roots = new Set([start.tile]);
    connected.nodes.filter(n => anchor && n.comp === anchor.comp && n.comp >= 0)
      .forEach(n => n.att.forEach(([i]) => roots.add(i)));
    const route = routes(bg, roots), t = "smr", best = {
      cost: bg.capex({ builds: [{ t, i: tile }], lines: [] }) + route.dist[tile]
    }, capacity = 1; // MW로 나누기 전 순이득(억). 대형 선호는 부호를 바꾸지 않는다.
    if (!Number.isFinite(best.cost)) throw Error("T5 SMR 비교 경로 없음");
    const trial = assets(plan); trial.builds.push({ t, i: tile }); addPath(trial, route.path(tile));
    ${aiBlock('const rd = rounds[turn - 1], publicState', 'const candidates = [], buildBudget')}
    ${aiBlock('const after = S.econ ? forecast(trial)', 'const large = 1 + style.risk')}
    return { net: costScore, cost: best.cost, fuelDelta, scoreDelta, scoreValue: value("aiScoreValue") };
  };
`;
vm.runInContext(aiSource.replace("  KCP.leagueAI =", smrComparison + "  KCP.leagueAI ="), ctx);
const { leagueCore: C, buildGame: B, leagueAI: AI, econ: X, ECON_DATA: D } = ctx.KCP;
if (process.env.TECH_BALANCE_FUEL_MUL) {
  const value = Number(process.env.TECH_BALANCE_FUEL_MUL);
  if (D.params.smrFuelMul.grade !== "G" || !Number.isFinite(value) || value <= 0) throw Error("G 연료 민감도 값 오류");
  D.params.smrFuelMul.v = value; // 진단 프로세스 안에서만 변경, 근거 키·파일 불변
}
if (process.env.G6_VARIANT) require("./g6-variants").apply(ctx.KCP, process.env.G6_VARIANT);
if (process.env.G7_VARIANT) require("./g7-variants").apply(ctx.KCP, process.env.G7_VARIANT);
const R = C.regionOf("south"), ids = R.teams.map(t => t.id), clone = x => JSON.parse(JSON.stringify(x));
const STRATEGIES = {
  smr: ["smr", "grid", "fcst", "vpp", "sic", "ccu"],
  research: ["grid", "fcst", "bms", "vpp", "sic", "tandem", "mass", "nbat", "ccu", "hvdc", "scable", "re100"],
  none: [],
  hydrogen: ["h2store", "h2mix", "grid", "fcst", "vpp", "bms", "sic", "tandem", "nbat", "mass"],
  renew: [], ties: [], hybrid: []
};
const names = { research: "연구 몰빵", none: "연구 0", smr: "SMR 조기", hydrogen: "수소 장주기", renew: "동일예산 재생+저장", ties: "동일예산 연계선", hybrid: "동일예산 재생+저장·연계선" };
const report = { contract: "ECON-TECH-SPEC T5 v1.1 G9 대칭 총지출 (2026-10-07)", strategies: names, seed: "tech-strategy-common", months: 36, smrFuelMul: D.params.smrFuelMul.v, runs: [], failures: [] };
report.sources = Object.fromEntries(["tests/league/review/11-tech-balance.js", ...["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core", "league-ai"].map(n => `ui/${n}.js`)]
  .map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex")]));
let passes = 0;
function ok(test, label) { if (test) passes++; else { report.failures.push(label); console.log("FAIL:", label); } }
function select(id) { B.selectPack(C.teamDef(R, id).pack, "league"); }
function observeSmrSite(S, id) {
  select(id);
  const sites = B.TILES.filter(t => !B.siteRule("smr", t));
  const observation = { month: S.round, candidateCount: sites.length };
  if (sites.length !== 1) return observation;
  const tile = sites[0].i, plan = S.teams[id].plan;
  const occupant = plan.builds.find(b => b.i === tile);
  return { ...observation, tile, ...(occupant ? { occupiedBy: occupant.t } :
    ctx.KCP.t5SmrComparison(S, R, id, B, plan, tile)) };
}
function assertSmrStarted(run) {
  if (run.months.some(m => m.builds.includes("smr"))) {
    ok(true, `${run.id} SMR 전략 실제 착공`); return;
  }
  const observations = run.smrSiteObservations || [];
  // 빈 칸에서 양수 이득을 놓친 달·비유한 값·입지 수 변화는 예외로 덮지 않는다.
  const blocked = run.id === "cheonan" && observations.length === run.months.length && observations.length > 0 &&
    observations.every(o => o.candidateCount === 1 && (o.occupiedBy ? o.occupiedBy !== "smr" : Number.isFinite(o.net) && o.net <= 0));
  if (blocked) {
    run.smrStart = { status: "incomparable", reason: "유일한 SMR 입지: 다른 설비 점유 또는 착공 비교 순이득≤0", observations };
    console.log("비교 불가: cheonan SMR 전략 실제 착공", JSON.stringify(run.smrStart));
  } else ok(false, `${run.id} SMR 전략 실제 착공`);
}
function affordable(S, id, p) { return C.spendOf(B, S, R, id, p) <= C.budget(S, id); }
function add(S, id, plan, type, accepts = () => true) {
  const used = new Set(plan.builds.map(b => b.i));
  const anchors = [...new Set(plan.lines.flatMap(l => l.p))];
  if (!anchors.length) anchors.push(B.SITES.find(s => s.dem).tile);
  const tiles = B.TILES.filter(t => !used.has(t.i) && !B.siteRule(type, t));
  tiles.sort((a, b) => Math.min(...anchors.map(i => Math.hypot(a.X - B.TILES[i].X, a.Y - B.TILES[i].Y))) - Math.min(...anchors.map(i => Math.hypot(b.X - B.TILES[i].X, b.Y - B.TILES[i].Y))) || a.i - b.i);
  for (const tile of tiles) {
    const minimal = { ...plan, builds: [...plan.builds, { t: type, i: tile.i }] };
    if (!accepts(minimal)) continue;
    const nearest = anchors.slice().sort((a, b) => Math.hypot(tile.X - B.TILES[a].X, tile.Y - B.TILES[a].Y) - Math.hypot(tile.X - B.TILES[b].X, tile.Y - B.TILES[b].Y))[0];
    const route = B.routePath(nearest, tile.i); if (!route) continue;
    const p = clone(plan); p.builds.push({ t: type, i: tile.i });
    for (let i = 0; i < route.length - 1; i += 79) p.lines.push({ p: route.slice(i, i + 80) });
    if (affordable(S, id, p) && accepts(p)) return p;
  }
  return plan;
}
function focalPlan(S, id, strategy) {
  const prev = S.teams[id].plan || { builds: [], lines: [] }, rs = C.researchView(S, id);
  // 공통 건설 봇의 신규 연구 인력만 지운 뒤 전략별 인력·연구 순서를 적용한다.
  const target = strategy === "smr" ? "smr" : strategy === "hydrogen" ? "h2store" : null;
  const saving = target && !prev.builds.some(b => b.t === target);
  const style = saving ? { ...AI.STYLES.balanced, invest: 0 } : "balanced";
  const answer = AI.plan(S, R, id, B, style); select(id);
  let p = clone(answer.plan);
  p.builds = p.builds.filter(b => !["lab", "uni"].includes(b.t) || prev.builds.some(x => x.t === b.t && x.i === b.i));
  p.rq = strategy === "none" ? [] : rs.queue.filter(k => rs.stage[k] !== "done");
  if (strategy === "none") return { plan: p, econPol: answer.econPol };
  const pending = p.rq[0], card = saving && rs.adopted.includes(target) ? null :
    pending || STRATEGIES[strategy].find(k => !rs.stage[k] && !rs.adopted.includes(k) && !C.researchError(S, id, [k], B));
  if (!affordable(S, id, p)) p.rq = [];
  // 연구 인력을 계속 늘려 전력 예산을 고갈시키지 않는다: 명세 속도 기준 연구소2·대학1.
  if (card) {
    const q = clone(p); q.rq = [card];
    if (affordable(S, id, q)) {
      p = q;
      for (const [type, goal] of [["lab", 2], ["uni", 1]])
        while (p.builds.filter(b => b.t === type).length < goal) {
          const next = add(S, id, p, type); if (next === p) break; p = next;
        }
    }
  }
  // 새로 짓는 설비만 해금 대안으로 바꾼다. 기존 설비를 무료 업그레이드하지 않는다.
  for (const b of p.builds) {
    if (prev.builds.some(x => x.t === b.t && x.i === b.i)) continue;
    const to = ({ solar: "tandem", roof: "tandem_roof", battery: "nbat" })[b.t];
    if (!to || !B.BLD[to] || !rs.adopted.includes(B.BLD[to].tech)) continue;
    const old = b.t; b.t = to; if (!affordable(S, id, p)) b.t = old;
  }
  // T5의 특화 전략은 해금 뒤 착공 자금을 먼저 확보한다. 지금 착공할 수 없을 때만
  // 연구 설비를 합법 철거해 회수액·절약한 유지비를 모은다. 세입·지방채 한도는 그대로다.
  if (strategy === "smr" && saving && rs.adopted.includes(target)) {
    const next = add(S, id, p, target);
    if (next !== p) p = next;
    else {
      p.builds = p.builds.filter(b => !["lab", "uni"].includes(b.t));
      p = add(S, id, p, target);
    }
  }
  if (strategy === "hydrogen" && rs.adopted.includes("h2store") && !p.builds.some(b => b.t === "h2store")) p = add(S, id, p, "h2store");
  if (rs.adopted.includes("vpp")) p.policies = ["dr"];
  return { plan: p, econPol: answer.econPol };
}
// 같은 예산 실험 어댑터. 실제 상태·가격·AI 계수는 유지하고 AI가 보는 예산만 제한한다.
// 기본 건설·세금·부채 대응은 balanced로 통일하고 기존 AI 협상을 재사용한다.
const alternatives = new Set(["renew", "ties", "hybrid"]);
const references = {};
const budgetTolerance = 1e-6; // 원장 부동소수 누계 오차만 허용(억), 실질 지출 초과 허용 아님
report.budgetTolerance = budgetTolerance;
const tradeForecastMargin = 1.25; // G: 공개 계획 운전 예상의 연료·수요 변화 여유
report.tradeForecastMargin = tradeForecastMargin;
const sum = xs => xs.reduce((a, b) => a + b, 0);
function investment(S, id, plan) {
  select(id);
  return Math.max(0, C.spendOf(B, S, R, id, plan) + C.tieShare(S, R, id) - (S.teams[id].stock || 0)) +
    plan.builds.filter(b => b.t === "lab").length * B.RS.labOpexR;
}
// G9: 양쪽 모두 36달 건설+운영·연료+구매 총지출로 비교한다.
// 건설은 SMR의 월별 건설·연구 투자 속도를 따르고, 운영 절약을 즉시 재투자하지 않는다.
// 미래 전 용량 구매를 예약하지 않는다. 공개 계획의 실제 급전·거래 예상으로 구매와
// 수출 추가 연료를 함께 예약(25% 예상 여유)한다. 예약은 실제 지출에 더하지 않는다.
// 이번 달 운영비는 전월 실적(달력 보정)과 같은 달 SMR 실적 중 큰 값으로 예상한다.
function envelopeRoom(S, id, run, extraTie = null) {
  const ref = references[id], index = S.round - 1, rounds = C.roundsOf(S);
  const active = S.ties.filter(t => t.st === "built");
  if (extraTie && !active.some(t => C.tieId(t) === C.tieId(extraTie))) active.push(extraTie);
  let incremental = 0;
  if (active.some(t => [t.a, t.b].includes(id))) {
    const sims = {}, prices = {};
    for (const key of ids) {
      const p = S.teams[key].plan || {builds:[],lines:[]};
      const publicState = {...S, events: []};
      sims[key] = C.simTeam(B, R, key, p, {...rounds[index], seed: X.hashStr(`${S.seedKey ?? S.room}:${S.round}:budget`)},
        Number.MAX_VALUE, C.trialMods(publicState, R, key));
      prices[key] = S.teams[key].price;
    }
    const without = C.settle([], sims, prices, sims[id].H, rounds[index].days).out[id];
    const withTies = C.settle(active.map(t => C.effectiveTie(S,t)), sims, prices, sims[id].H, rounds[index].days).out[id];
    const gross = row => row.fuelX - row.saveFuel + row.pay;
    // 수입 구매비뿐 아니라 수출용 추가 연료도 포함. 판매액은 지출에서 빼지 않는다.
    incremental = Math.max(0, gross(withTies) - gross(without)) / rounds[index].days;
  }
  const previous = run.months.at(-1);
  const current = Math.max(ref.months[index].operation + ref.months[index].purchase,
    previous ? (previous.operation + previous.purchase) * rounds[index].mdays / rounds[Math.max(0,index-1)].mdays : 0);
  let reserve = 0, room = Infinity;
  for (let m = index; m < report.months; m++) {
    reserve += (m === index ? current : ref.months[m].operation + ref.months[m].purchase) + incremental * rounds[m].mdays * tradeForecastMargin;
    room = Math.min(room, ref.months[m].cumulativeMatchedSpend - run.account.matchedSpend - reserve);
  }
  // SMR 가동 전의 일시적 운영 절약을 영구 투자재원으로 앞당겨 쓰지 않는다.
  // 건설 속도도 같은 달 SMR의 건설·연구 운영 누계 안에 둔다.
  room = Math.min(room, ref.months[index].cumulativeInvestment - run.account.investment,
    run.capitalLimit - run.account.construction);
  return Math.max(0, room);
}
function alternativePlan(S, id, strategy, run) {
  const room = envelopeRoom(S, id, run);
  const previous = S.teams[id].plan || { builds: [], lines: [] };
  const style = "balanced"; // 동일 기본 공급·재정 정책, 기술 투자 대상만 교체
  // 기존 AI가 같은 달 집행 가능한 돈만 보게 한다. 실제 현금·부채를 주입하지 않는다.
  ctx.KCP.leagueCore = { ...C, budget: (state, key) => key === id ? Math.min(C.budget(state, key),
    (state.teams[key].stock || 0) - C.tieShare(state, R, key) + room) : C.budget(state, key) };
  let answer;
  try { answer = AI.plan(S, R, id, B, style); } finally { ctx.KCP.leagueCore = C; }
  select(id);
  let plan = clone(answer.plan);
  plan.rq = [];
  plan.builds = plan.builds.filter(b => !["uni", "lab"].includes(b.t) || previous.builds.some(x => x.t === b.t && x.i === b.i));
  const accepts = p => investment(S, id, p) <= room + 1e-8;
  if (!accepts(plan)) plan = clone(previous);
  if (strategy === "renew") plan = renewablePlan(S, id, plan, room);
  // 혼합은 첫 연계선 준공을 우선해 자금을 모으고, 이후 남은 예산으로 재생 묶음을 추가한다.
  return { plan, econPol: answer.econPol, allowance: room };
}
function renewablePlan(S, id, original, room) {
  select(id);
  let plan = clone(original);
  const fits = p => investment(S, id, p) <= room + 1e-8;
  // 점수 최적화가 아닌 사전 고정 투자 묶음, 입지는 기존 SMR add 함수 재사용.
  // 기존 신중 AI의 저장 비율·소수력 상한·ESS 접속 여유를 따른다.
  // 태양광→풍력→소수력 순서로 합법 묶음을 추가하며 월 처리량 초과는 실제 대기한다.
  const mw = (p, cls) => sum(p.builds.filter(b => B.BLD[b.t]?.cls === cls).map(b => B.BLD[b.t].mw));
  const hydroLimit = B.peakDemand({}, false) * D.params.aiHydroMaxShare.v;
  const gridOf = p => {
    const g = C.gridStatus({ ...S, teams: { ...S.teams, [id]: { ...S.teams[id], plan: p } } }, R, B, id, true);
    select(id); return g;
  };
  for (let step = 0; step < B.TILES.length; step++) {
    let next = plan;
    for (const type of ["solar", "wind", "hydro"]) {
      if (type === "hydro" && sum(plan.builds.filter(b => b.t === type).map(b => B.BLD[b.t].mw)) + B.BLD[type].mw > hydroLimit) continue;
      let candidate = add(S, id, plan, type, fits);
      if (candidate === plan) continue;
      const needsStorage = p => {
        const g = gridOf(p);
        return mw(p, "bat") < mw(p, "ren") * D.params.aiStorageShare.v ||
          sum(g.entries.map(e => e.mw)) > g.hostMW + 1e-8;
      };
      while (needsStorage(candidate)) {
        const battery = add(S, id, candidate, "battery", fits);
        if (battery === candidate) break;
        candidate = battery;
      }
      if (needsStorage(candidate)) continue;
      next = candidate; break;
    }
    if (next === plan) break;
    plan = next;
  }
  return plan;
}

function cooperate(S, focal, strategy, run, month) {
  if (!["ties", "hybrid"].includes(strategy)) return;
  // 초안 계산 당시에는 이웃 계획이 비어 있을 수 있어, 확정 계획으로 기존 AI 협상만 다시 묻는다.
  const neighbors = R.ties.filter(t => [t.a, t.b].includes(focal)).map(t => t.a === focal ? t.b : t.a);
  for (const id of [focal, ...neighbors]) {
    const answer = AI.plan(S, R, id, B, id === focal ? "bold" : "balanced");
    for (const action of answer.ties) {
      if (id !== focal && action.other !== focal) continue;
      if (!["propose", "accept", "cancel"].includes(action.type)) continue;
      const half = C.tieCost(R, { a: id, b: action.other, cap: action.cap, kind: action.kind }) / 2;
      const definition = C.tieDef(R, id, action.other);
      const candidate = { ...definition, cap: action.cap, kind: action.kind };
      if (action.type !== "cancel" && investment(S, focal, S.teams[focal].plan) + half >
        envelopeRoom(S, focal, run, candidate) + 1e-8) continue;
      const result = C.reduce(S, { type: "tie", team: id, token: "test-bot", other: action.other,
        op: action.type, cap: action.cap, kind: action.kind }, month * 100000 + 2, B);
      ok(result.ok, `${focal}/${strategy}/${month} 연계선 ${action.type}: ${result.err || ""}`);
      run.tieRequests.push({ month, id, ...action, result });
    }
  }
}

const selectedIds = process.env.TECH_BALANCE_CITY ? ids.filter(id => id === process.env.TECH_BALANCE_CITY) : ids;
const requested = process.env.TECH_BALANCE_STRATEGY;
const selectedStrategies = requested ? Object.keys(STRATEGIES).filter(s => s === requested || alternatives.has(requested) && s === "smr") : Object.keys(STRATEGIES);
if (!selectedIds.length || !selectedStrategies.length) throw Error("기술 진단 선택 오류");
for (const focal of selectedIds) for (const strategy of selectedStrategies) {
  // 비용만으로 예산을 맞추는 사전 반복. 점수·순위는 투자 한도 선택에 사용하지 않는다.
  const fitHistory = [];
  let capitalLimit = Infinity;
  for (let fitAttempt = 0; fitAttempt < 12; fitAttempt++) {
  const S = C.newState(report.seed, R.id, 0, ids, { turns: 36 });
  ids.forEach(id => { S.teams[id].token = "test-bot"; });
  const run = { capitalLimit, id: focal, name: D.start[focal].name, strategy, months: [], rejected: [], tieRequests: [], account: { tariff: 0, tariffGross: 0, service: 0, interest: 0, construction: 0, researchOperation: 0, purchase: 0, operation: 0, investment: 0, matchedSpend: 0 } }; report.runs.push(run);
  for (let m = 1; m <= 36; m++) {
    C.host(S, "next", m * 100000);
    const proposals = Object.fromEntries(ids.map(id => [id, id === focal ? (alternatives.has(strategy) ? alternativePlan(S, id, strategy, run) : focalPlan(S, id, strategy)) : AI.plan(S, R, id, B, "balanced")]));
    for (const id of ids) {
      const ask = msg => C.reduce(S, { team: id, token: "test-bot", ...msg }, m * 100000 + 1, B);
      const pol = ask({ type: "econ", ...proposals[id].econPol });
      ok(pol.ok, `${focal}/${strategy}/${m}/${id} 정책 ${pol.err || ""}`);
      const res = ask({ type: "plan", rev: S.teams[id].rev + 1, plan: proposals[id].plan });
      ok(res.ok, `${focal}/${strategy}/${m}/${id} 건설 ${res.err || ""}`);
      if (id === focal && alternatives.has(strategy) && res.ok)
        ok(JSON.stringify(S.teams[id].plan.builds) === JSON.stringify(proposals[id].plan.builds),
          `${focal}/${strategy}/${m} 호스트가 설비를 잘라내지 않고 계획 그대로 승인`);
      if (!res.ok) { select(id); run.rejected.push({ month: m, id, response: res, cash: S.econ.cities[id].cash, debtCap: S.econ.cities[id].debtCap, budget: C.budget(S, id), spend: C.spendOf(B, S, R, id, proposals[id].plan), plan: proposals[id].plan }); }
    }
    cooperate(S, focal, strategy, run, m);
    if (strategy === "hybrid" && S.ties.some(t => t.st === "built" && [t.a, t.b].includes(focal))) {
      const room = envelopeRoom(S, focal, run);
      const plan = renewablePlan(S, focal, S.teams[focal].plan, room);
      const res = C.reduce(S, { type: "plan", team: focal, token: "test-bot", rev: S.teams[focal].rev + 1, plan }, m * 100000 + 3, B);
      ok(res.ok, `${focal}/hybrid/${m} 연계선 협상 뒤 재생 투자 ${res.err || ""}`);
      ok(JSON.stringify(S.teams[focal].plan.builds) === JSON.stringify(plan.builds), `${focal}/hybrid/${m} 추가 계획 그대로 승인`);
      proposals[focal].allowance = room;
    }
    if (focal === "cheonan" && strategy === "smr") (run.smrSiteObservations ||= []).push(observeSmrSite(S, focal));
    const result = C.run(S, B, m * 100000 + 20), r = result.team[focal], city = S.econ.cities[focal];
    const fiscal = result.econ.fiscal[focal];
    run.account.tariff += fiscal.rev.tariff; run.account.tariffGross += fiscal.tariffGross;
    run.account.service += fiscal.exp.service; run.account.interest += fiscal.exp.interest;
    run.account.construction += fiscal.exp.capex;
    run.account.researchOperation += r.cost.research;
    run.account.purchase += r.pay * C.roundsOf(S)[m - 1].mdays / C.roundsOf(S)[m - 1].days;
    run.account.investment += fiscal.exp.capex + r.cost.research;
    const wk = C.roundsOf(S)[m - 1].mdays / C.roundsOf(S)[m - 1].days;
    const operation = (r.cost.fuel + r.cost.policy) * wk + (r.cost.resp || 0) + (r.cost.research || 0);
    run.account.operation += operation;
    run.account.matchedSpend = run.account.construction + run.account.operation + run.account.purchase;
    run.months.push({ budget: alternatives.has(strategy) ? {
      target: references[focal].months[m - 1].cumulativeMatchedSpend,
      spent: run.account.matchedSpend,
      unspent: references[focal].months[m - 1].cumulativeMatchedSpend - run.account.matchedSpend,
      constructionAllowance: proposals[focal].allowance
    } : null, operation, cumulativeMatchedSpend: run.account.matchedSpend, purchase: r.pay * C.roundsOf(S)[m - 1].mdays / C.roundsOf(S)[m - 1].days, cumulativeInvestment: run.account.investment, investment: fiscal.exp.capex + r.cost.research, construction: fiscal.exp.capex, researchOperation: r.cost.research, ties: clone(S.ties), importMWh: r.imp * C.roundsOf(S)[m - 1].mdays / C.roundsOf(S)[m - 1].days, exportMWh: r.exp * C.roundsOf(S)[m - 1].mdays / C.roundsOf(S)[m - 1].days, grid: r.grid, score: [12, 24, 36].includes(m) ? X.score({...S.econ, len: m}).by[focal] : null, month: m, uns: r.unsPct, ren: r.renPct, cash: city.cash, debtCap: city.debtCap, debtRatio: S.econRep.fiscal[focal].debtRatio, debtStage: S.econRep.fiscal[focal].debtStage, unrest: city.unrest,
      growth: { pop: city.pop / city.pop0 / (S.econ.totals.pop / S.econ.totals.pop0) - 1, ind: city.ind / city.ind0 / (S.econ.totals.ind / S.econ.totals.ind0) - 1 },
      adopted: C.researchView(S, focal).adopted, builds: S.teams[focal].plan.builds.map(b => b.t) });
  }
  if (strategy === "smr") references[focal] = run;
  const scored = X.score(S.econ).by[focal];
  run.score = scored.score; run.parts = scored.parts; run.coop = scored.coop;
  run.state = S.econ;
  run.avgUns = run.months.reduce((sum, m) => sum + m.uns, 0) / run.months.length;
  run.adopted = C.researchView(S, focal).adopted;
  if (alternatives.has(strategy)) {
    const excess = Math.max(...run.months.map(m => m.cumulativeMatchedSpend - references[focal].months[m.month - 1].cumulativeMatchedSpend));
    fitHistory.push({attempt: fitAttempt + 1, capitalLimit: Number.isFinite(capitalLimit) ? capitalLimit : null,
      construction: run.account.construction, operation: run.account.operation, purchase: run.account.purchase,
      spent: run.account.matchedSpend, target: references[focal].account.matchedSpend, excess});
    if (excess > budgetTolerance && fitAttempt < 11 && capitalLimit !== 0) {
      ok(run.avgUns <= 5, `${focal}/${strategy} 예산 사전 반복도 평균 정전 ≤5%`);
      // 관측 초과액만큼 다음 시도의 건설 상한을 낮춘다. 운영·연료·구매는 항상 실제 지출로 계산.
      capitalLimit = Math.max(0, run.account.construction - excess);
      report.runs.pop();
      console.log('예산 맞춤 재실행', JSON.stringify({focal,strategy,fitAttempt,excess,capitalLimit}));
      continue;
    }
    for (const month of run.months) ok(month.cumulativeMatchedSpend <= references[focal].months[month.month - 1].cumulativeMatchedSpend + budgetTolerance,
      `${focal}/${strategy}/${month.month} 실제 누적 총지출 ≤ 같은 달 SMR 누계 + 허용 오차`);
    run.budget = { fitHistory, capitalLimit: Number.isFinite(capitalLimit) ? capitalLimit : null, target: references[focal].account.matchedSpend, spent: run.account.matchedSpend,
      unspent: references[focal].account.matchedSpend - run.account.matchedSpend,
      execution: run.account.matchedSpend / references[focal].account.matchedSpend,
      maxPrefixOverspend: Math.max(...run.months.map(m => m.budget.spent - m.budget.target)) };
    ok(run.adopted.length === 0, `${focal}/${strategy} 추가 연구비 없이 투자 대안 실행`);
  }
  ok(Number.isFinite(run.score), `${focal}/${strategy} 유한 점수`);
  // B18 공통 실용성 기준: 36달 평균 정전 5% 이하여야 전력 운영 전략으로 비교 가능.
  ok(run.avgUns <= 5, `${focal}/${strategy} 평균 정전 ${run.avgUns.toFixed(3)}% >5%`);
  if (strategy === "none") ok(run.adopted.length === 0, `${focal} 연구0 도입0장`);
  if (strategy === "smr") assertSmrStarted(run);
  if (strategy === "hydrogen") ok(run.months.some(m => m.builds.includes("h2store")), `${focal} 수소 전략 실제 저장 건설`);
  console.log(JSON.stringify({ city: run.name, strategy: names[strategy], score: run.score, avgUns: +run.avgUns.toFixed(3), cards: run.adopted.length }));
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  break;
  }
}
if (selectedIds.length === ids.length && selectedStrategies.length === Object.keys(STRATEGIES).length) {
  for (const strategy of ["ties", "hybrid"]) {
    const runs = report.runs.filter(r => r.strategy === strategy);
    ok(runs.some(r => r.tieRequests.some(t => t.type === "accept" && t.result.ok)), `${strategy} AI 협상으로 실제 연계선 준공`);
    ok(runs.some(r => r.months.some(m => m.importMWh > 0 || m.exportMWh > 0)), `${strategy} 실제 이웃 거래 발생`);
  }
  const avg = key => report.runs.filter(r => r.strategy === key).reduce((s, r) => s + r.score, 0) / ids.length;
  report.average = Object.fromEntries(Object.keys(STRATEGIES).map(k => [k, avg(k)]));
  report.researchGain = avg("research") - avg("none");
  ok(report.researchGain > 0 && report.researchGain <= 15, `T5 연구몰빵−연구0 평균 ${report.researchGain}, 계약 (0,15]`);
  report.winners = Object.fromEntries(ids.map(id => {
    const rows = report.runs.filter(r => r.id === id), best = Math.max(...rows.map(r => r.score));
    return [id, rows.filter(r => r.score === best).map(r => r.strategy)];
  }));
  for (const strategy of Object.keys(STRATEGIES)) ok(!ids.every(id => report.winners[id].includes(strategy)), `T5 ${strategy} 6도시 모두 1위 금지(공동1위 포함)`);
  report.smrFirstCities = ids.filter(id => report.winners[id].includes("smr")).length;
  report.smrTargetMet = report.smrFirstCities <= 3;
  // v1.1: SMR≤3은 G 희망 목표이며 실패 수에 넣지 않는다. B16 독식 금지는 위에서 검사한다.
  // 점수는 기하평균이므로 가중 부분점수를 선형 합산하지 않는다.
  // 로그 차이의 정확 분해(LMDI). 관찰된 점수 차이의 회계이며 정책의 인과 효과는 아니다.
  const w = D.params.wScore.v, wsum = Object.values(w).reduce((a, b) => a + b, 0);
  const floor = process.env.G6_VARIANT ? (require("./g6-variants").variants[process.env.G6_VARIANT].floor || 1) : (D.params.scorePartFloor?.v || 1);
  const geometric = r => Math.exp(Object.keys(w).reduce((s, k) => s + w[k] * Math.log(Math.max(floor, r.parts[k])), 0) / wsum);
  report.smrComparison = Object.fromEntries(ids.map(id => {
    const rows = report.runs.filter(r => r.id === id), smr = rows.find(r => r.strategy === "smr");
    const other = rows.filter(r => r.strategy !== "smr").sort((a, b) => b.score - a.score)[0];
    const a = geometric(smr), b = geometric(other), mean = Math.abs(a - b) < 1e-10 ? a : (a - b) / Math.log(a / b);
    const contributions = Object.fromEntries(Object.keys(w).map(k => [k, mean * w[k] / wsum * Math.log(Math.max(floor, smr.parts[k]) / Math.max(floor, other.parts[k]))]));
    ok(Math.abs(Object.values(contributions).reduce((s, x) => s + x, 0) - (a - b)) < 1e-8, `${id} SMR 부분점수 기하평균 차이 보존`);
    return [id, { alternative: other.strategy, score: [smr.score, other.score], parts: [smr.parts, other.parts], account: [smr.account, other.account], contributions, coopDelta: smr.coop - other.coop }];
  }));
  console.log("SMR 도시1위", report.smrFirstCities, "/6; 목표 ≤3", report.smrTargetMet);
  console.log("평균·도시별1위", JSON.stringify({ average: report.average, gain: report.researchGain, winners: report.winners }));
} else console.log("부분 실행: T5 전체 전략·6도시 판정 미실행");
report.passes = passes;
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`T5 전략: ${passes} 통과, ${report.failures.length} 실패; ${OUT}`);
process.exitCode = report.failures.length ? 1 : 0;
