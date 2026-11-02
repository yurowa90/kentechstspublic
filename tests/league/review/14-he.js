"use strict";
// H-E: 최종 검증 idx 1·2·3·5·11·25·27. 실제 공개 API와 월 정산 경로를 검사한다.
const assert = require("node:assert/strict"), path = require("node:path");
global.window = { KCP: { route() {}, on() {}, esc: s => String(s) } };
global.document = { documentElement: {} };
global.KCP = window.KCP;
for (const name of ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core", "league-ai"])
  require(path.resolve(__dirname, `../../../ui/${name}.js`));
const T = require("../tech.js"), { C, BG, R, K } = T.context(), X = K.econ;
const clone = T.clone, p = key => K.TECH_DATA.params[key].v;
let checks = 0;
function eq(actual, expected, label) { checks++; assert.deepEqual(actual, expected, label); }
function near(actual, expected, label) { checks++; assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} / ${expected}`); }
function request(S, id, fields) { return C.reduce(S, { team: id, token: T.token(id), ...fields }, 10, BG); }

// #1: 사건 지원금 없이는 부족한 경계에서 계획 승인과 당월 실증이 일치한다.
{
  const { S, ids } = T.fixture({ all: true });
  const ev = R.events.find(e => e.effect?.budgetAdd > 0 && e.scope.startsWith("kind:"));
  S.events = [{ id: ev.id, round: S.round, x: 1 }];
  const id = ids.find(id => C.hits(R, ev, id, S)), card = K.TECH_DATA.cards.find(c => c.id === "grid");
  const team = S.teams[id]; team.plan = T.planFor(id, ["lab"]);
  team.base = C.itemCosts(BG, R, id, team.plan); team.committed = C.capexOf(BG, R, id, team.plan);
  team.research.prog.grid = card.need - 0.5;
  eq(T.request(S, id, ["grid"]).ok, true, "#1 계획 연구 승인");
  S.econ.cities[id].cash -= C.publicView(S).teams[id].left - 0.5;
  const budget = C.budget(S, id), spend = C.spendOf(BG, S, R, id, team.plan);
  eq(budget - spend, 0.5, "#1 경계 잔액");
  S.phase = "run"; eq(C.budget(S, id), budget, "#1 계획·운영 예산 정확히 동일"); S.phase = "plan";
  const result = C.run(S, BG, 20);
  eq(team.research.stage.grid, "demo", "#1 당월 실증 시작");
  eq(team.rfix, card.demo, "#1 실증비 한 번만 지급");
  eq(result.econ.fiscal[id].rev.bonus, ev.effect.budgetAdd, "#1 당월 사건 지원금 정산");
}

// #2·3: 대기 카드에는 비용 없음. 실증 달에 다음 카드 비용을 미리 청구하지 않는다.
{
  const { S, ids: [donor, buyer] } = T.fixture({ staff: true });
  S.teams[donor].research = T.research(["grid", "sic", "fcst"]);
  for (const card of ["grid", "sic", "fcst"]) eq(T.special(S, buyer, "license", donor, card).ok, true, "#3 이전 승인");
  const seen = {};
  for (let month = 0; month < 7; month++) {
    if (S.phase === "review") C.host(S, "next", 30 + month);
    S.events = [];
    const before = clone(S.teams[buyer].research), view = C.researchView(S, buyer);
    const demo = Object.keys(before.stage).filter(key => before.stage[key] === "demo");
    const active = demo.length ? demo : view.current ? [view.current] : [];
    const outstanding = before.queue.reduce((sum, key) => sum + (!before.stage[key] ? K.TECH_DATA.cards.find(c => c.id === key).demo : 0), 0);
    eq(C.researchReserve(S, buyer, BG, S.teams[buyer].plan), outstanding + (active.length ? 0.5 : 0), "#3 current/demo 사용료만 예약");
    const res = C.run(S, BG, 40 + month), ledger = res.team[buyer].technologyCost || { expense: 0, payments: [] };
    eq(ledger.payments.map(x => x.card), active, "#3 운영 시작 때 current/demo 카드만 청구");
    for (const payment of ledger.payments) {
      seen[payment.card] = (seen[payment.card] || 0) + 1;
      eq(demo.includes(payment.card) || S.teams[buyer].research.prog[payment.card] > (before.prog[payment.card] || 0), true, "#3 실제 진척 또는 실증");
    }
    const income = res.team[donor].technologyCost?.income || 0;
    eq(income, ledger.expense, "#2 수입·지출 합 일치");
    eq(res.econ.fiscal[donor].rev.royalty, income, "#2 royalty 항목은 사용료 수입과 일치");
    eq(res.econ.fiscal[donor].rev.trade, 0, "#2 전력 거래 없으면 판매 수입 0");
    eq(Object.values(res.econ.fiscal).reduce((sum, f) => sum + f.rev.royalty, 0), income, "#2 royalty 합계");
    for (const f of Object.values(res.econ.fiscal)) near(f.cashAfter, f.cashBefore + f.revTotal - f.expTotal, "#2 현금 항등식");
  }
  eq(seen, { fcst: 2, sic: 2, grid: 2 }, "#3 카드별 연구·실증 두 번 지급");
}

// #2: 다른 조건을 동일하게 둔 사용료만의 차이는 현금에만 들어가고 지방채 한도는 같다.
{
  const { S, ids } = T.fixture();
  const inputs = Object.fromEntries(ids.map(id => [id, { energy: { demMWh: 0, tradeNet: 0, buyCost: 0 } }]));
  const plain = X.monthStep(S.econ, inputs), withRoyalty = clone(inputs);
  withRoyalty[ids[0]].energy.royalty = 2.5;
  const paid = X.monthStep(S.econ, withRoyalty);
  eq(paid.report.fiscal[ids[0]].rev.royalty, 2.5, "#2 양수 royalty");
  eq(plain.report.fiscal[ids[0]].rev.royalty, 0, "#2 누락 royalty 기본값 0");
  eq(paid.report.fiscal[ids[0]].rev.trade, plain.report.fiscal[ids[0]].rev.trade, "#2 판매 수입 불변");
  near(paid.E.cities[ids[0]].cash - plain.E.cities[ids[0]].cash, 2.5, "#2 현금은 사용료만큼 증가");
  eq(paid.E.cities[ids[0]].debtCap, plain.E.cities[ids[0]].debtCap, "#2 지방채 한도에서 제외");
}

// #3: 인력 0 대기는 무료, 인력 0이라도 유레카로 실제 진척되면 현재 카드만 청구한다.
{
  const { S, ids: [donor, buyer] } = T.fixture();
  S.teams[donor].research = T.research(["fcst", "sic"]);
  for (const card of ["sic", "fcst"]) eq(T.special(S, buyer, "license", donor, card).ok, true, "#3 무인력 이전");
  eq(C.royaltyLedger(S)[buyer].expense, 0, "#3 무인력·무진척 사용료 0");
  eq(C.researchReserve(S, buyer, BG, S.teams[buyer].plan), 5, "#3 무인력 예약은 실증비만");
  S.events = [{ id: "heatwave_peak", round: S.round, x: 1 }];
  eq(C.researchReserve(S, buyer, BG, S.teams[buyer].plan), 5.5, "#3 유레카 진척 사용료 예약");
  const result = C.run(S, BG, 30);
  eq(result.team[buyer].technologyCost.payments.map(x => x.card), ["fcst"], "#3 유레카 current만 청구");
  eq(S.teams[buyer].research.prog.fcst > 0, true, "#3 무인력 유레카 실제 진척");
  C.host(S, "next", 31); S.events = [];
  eq(C.royaltyLedger(S)[buyer].expense, 0, "#3 다음 달 진척 없으면 사용료 중단");
  // 대기열 편집으로 이미 시작한 실증의 비용을 피할 수 없다.
  S.teams[buyer].research.stage.fcst = "demo"; S.teams[buyer].plan.rq = [];
  eq(C.researchReserve(S, buyer, BG, S.teams[buyer].plan), 0.5, "#3 대기열 밖 실증 예약");
  eq(C.royaltyLedger(S)[buyer].payments.map(x => x.card), ["fcst"], "#3 대기열 밖 실증 지급");
}

// #3: 판정 시점 경계 — 당월 DR 누적 유레카와 직전 달 RE100 연구 자격.
{
  const { S, ids: [donor, buyer] } = T.fixture();
  S.teams[donor].research = T.research(["vpp"]);
  S.teams[buyer].research = T.research(["fcst"]);
  eq(T.special(S, buyer, "license", donor, "vpp").ok, true, "#3 VPP 이전 승인");
  S.teams[buyer].plan.policies = ["dr"];
  S.teams[buyer].research.drMonths = p("eurekaDr") - 1;
  eq(C.researchReserve(S, buyer, BG, S.teams[buyer].plan), 4.5, "#3 당월 DR 유레카 사용료 예약");
  const result = C.run(S, BG, 35);
  eq(result.team[buyer].technologyCost.payments.map(x => x.card), ["vpp"], "#3 당월 DR 유레카 사용료 청구");
  eq(S.teams[buyer].research.prog.vpp > 0, true, "#3 당월 DR 누적 실제 진척");
}
{
  const { S, ids: [donor, buyer] } = T.fixture({ staff: true });
  S.teams[donor].research = T.research(["re100"]);
  S.results = [{ round: S.round - 1, team: { [buyer]: { renPct: p("re100Need") } } }];
  eq(T.special(S, buyer, "license", donor, "re100").ok, true, "#3 직전 달 RE100 연구 조건 충족");
  const result = C.run(S, BG, 35);
  eq(result.team[buyer].renPct, 0, "#3 당월 재생 비중은 하락");
  eq(result.team[buyer].technologyCost.payments.map(x => x.card), ["re100"], "#3 계획과 같은 자격으로 사용료 청구");
  eq(S.teams[buyer].research.prog.re100 > 0, true, "#3 계획과 같은 직전 달 기준으로 실제 진척");
}

// #5: 실제 12개월 경제 운영 및 JSON 전송 뒤 기본 가중치·부분점수·순위가 오차 0.
{
  const { S } = T.fixture({ all: true, rich: false });
  for (let month = 0; month < 12; month++) {
    if (S.phase === "review") C.host(S, "next", 50 + month);
    C.computerPlans(S, BG, null, "balanced"); C.run(S, BG, 70 + month);
    const v = clone(C.publicView(S).econ);
    eq(X.score(v.scoreState), v.score, `#5 ${month + 1}개월 공식 점수 완전 일치`);
  }
  const id = S.active[0], view = C.publicView(S);
  view.econ.scoreState.cities[id].approvalHistory.push(-1);
  eq(S.econ.cities[id].approvalHistory.includes(-1), false, "#5 공개 이력은 원본과 별도 배열");
}

// #11: 잠금, 켜기, 생략 시 유지, 명시 해제 및 실제 경제 입력.
{
  const { S, ids: [id] } = T.fixture();
  eq(request(S, id, { type: "econ", re100: true }).err, "locked:re100", "#11 미도입 잠금");
  S.teams[id].research = T.research(["re100"]);
  eq(request(S, id, { type: "econ", re100: true }).ok, true, "#11 켜기");
  eq(request(S, id, { type: "econ", taxRes: 1 }).ok, true, "#11 다른 정책 변경");
  eq(S.teams[id].econPol.re100, true, "#11 생략 시 유지");
  eq(request(S, id, { type: "econ", re100: false }).ok, true, "#11 끄기");
  eq(S.teams[id].econPol.re100, false, "#11 명시 false 저장");
  C.run(S, BG, 80);
  eq(!!S.econ.cities[id].policy.re100, false, "#11 경제 운영에도 해제 전달");
}

// #11: AI 정책은 도입·재생 비중·성향을 반영한다. 기존 G 위험 선호만 사용한다.
{
  const { S, ids: [id] } = T.fixture();
  S.teams[id].research = T.research(["re100", "hvdc"]);
  S.results = [{ team: { [id]: { renPct: 45 } } }];
  const before = JSON.stringify(S);
  eq(K.leagueAI.plan(S, R, id, BG, "careful").econPol.re100, false, "#11 신중 성향은 재생 여유 필요");
  for (const style of ["balanced", "bold"]) eq(K.leagueAI.plan(S, R, id, BG, style).econPol.re100, true, "#11 조건 충족 성향 활성");
  eq(JSON.stringify(S), before, "#11 AI 조회는 상태 불변");
  S.results[0].team[id].renPct = p("re100Need") - 1;
  eq(K.leagueAI.plan(S, R, id, BG, "bold").econPol.re100, false, "#11 재생 조건 미달 비활성");
  S.results[0].team[id].renPct = 100; S.teams[id].research = T.research();
  eq(K.leagueAI.plan(S, R, id, BG, "bold").econPol.re100, false, "#11 AI 미도입 비활성");
}

// #11: 실제 AI 계획 → reduce → 상대 AI 수락까지 kind·정책 전달을 검증한다.
{
  const { S, ids } = T.fixture({ all: true });
  S.room = "HETIE";
  for (const id of ids) {
    S.econ.cities[id].cash = 10000;
    S.teams[id].research = T.research(["hvdc", "re100"]);
  }
  S.results = [{ team: Object.fromEntries(ids.map(id => [id, { renPct: 100 }])) }];
  const planned = C.computerPlans(S, BG, null, "bold");
  eq(planned.every(r => r.ok), true, "#11 AI 모든 계획 요청 승인");
  eq(S.ties.length > 0, true, "#11 AI 실제 연계선 제안 존재");
  eq(S.ties.every(t => t.kind === "hvdc"), true, "#11 제안 kind가 reduce까지 전달");
  eq(ids.every(id => S.teams[id].econPol.re100 === true), true, "#11 AI RE100 정책이 reduce까지 전달");
  const replies = C.computerPlans(S, BG, null, "bold", true);
  eq(replies.every(r => r.ok), true, "#11 상대 AI 응답 승인");
  const built = S.ties.filter(t => t.st === "built");
  eq(built.length > 0, true, "#11 HVDC 수락·건설 존재");
  for (const tie of built) {
    eq(tie.kind, "hvdc", "#11 수락 뒤에도 HVDC 유지");
    near(C.tieCost(R, tie), C.tieCost(R, { ...tie, kind: undefined }) * p("hvdcCost"), "#11 HVDC 건설비 배수");
  }
}

// #25: 이름·도 표시를 바꿔도 자료의 kind 소속이 사건 범위를 결정한다.
{
  const { S, ids } = T.fixture({ all: true });
  const renamed = clone(R); renamed.teams.forEach((team, i) => { team.name = `가상도시 ${i}`; team.prov = "가상지역"; });
  for (const [kind, members] of Object.entries(R.kinds)) for (const id of ids)
    eq(C.hits(renamed, { scope: `kind:${kind}`, effect: {} }, id, S), members.includes(id), "#25 표시 이름과 무관한 사건 대상");
  renamed.kinds.metro_south = [ids.at(-1)];
  for (const id of ids) eq(C.hits(renamed, { scope: "kind:metro_south", effect: {} }, id, S), id === ids.at(-1), "#25 자료 소속 변경 반영");
}

// #27: 최초 스냅 전·팀 항목 없음. 계절·월 모드 모두 유한한 예산.
{
  const { S, ids } = T.fixture();
  for (const teams of [undefined, {}]) for (const id of ids) {
    eq(Number.isFinite(C.budget({ round: 1, ties: [], region: R.id, teams }, id)), true, "#27 첫 스냅 전 예산");
    eq(Number.isFinite(C.budget({ ...S, teams }, id)), true, "#27 월 모드 팀 없음");
    eq(C.researchReserve({ ...S, teams }, id, BG, {}), 0, "#27 팀 없음 연구 예약");
  }
}
console.log(`H-E checks ${checks} fail 0`);
