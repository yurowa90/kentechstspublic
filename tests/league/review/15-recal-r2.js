"use strict";
// RECAL-SPEC v1.0.2 R2: 실제 입력·출력과 독립 수치 오라클. 외부 IO 없음.
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const root = path.resolve(__dirname, "../../.."), box = { console, document: { documentElement: {} }, KCP: { on() {}, route() {}, esc: s => s } };
box.window = box; vm.createContext(box);
vm.runInContext('Math.random=()=>{throw Error("unseeded")}', box);
for (const f of ["build-maps", "tech-data", "build", "econ-data", "econ", "league-data", "league-core", "league-ai"])
  vm.runInContext(fs.readFileSync(path.join(root, `ui/${f}.js`), "utf8"), box);
const { econ: X, ECON_DATA: D, leagueCore: C, buildGame: B, leagueAI: AI } = box.KCP;
const ids = Object.keys(D.start), a = ids[0], b = ids[1], clone = x => JSON.parse(JSON.stringify(x));
let checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const near = (v, want, msg, eps = 1e-8) => ok(Number.isFinite(v) && Math.abs(v - want) <= eps, `${msg}: ${v}/${want}`);
const sum = xs => xs.reduce((a, x) => a + x, 0);
// D-73: 국가 계수로 보정하는 가상 입력도 45.67→100×normalCo2(41.73)로 갱신.
const inp = (E, f = () => ({})) => Object.fromEntries(E.order.map(id => [id, { energy: { demMWh: 100, servedMWh: 100, unsPct: 0, hospH: 0, co2: 100 * D.params.normalCo2.v, co2Local: 100 * D.params.normalCo2.v, costPerMWh: .008, opex: .8, renPct: 15, ...f(id).energy }, policy: f(id).policy || {} }]));
const data = clone(D); data.intl.eventP = 0; data.intl.schedule = []; Object.keys(data.intl.sigma).forEach(k => data.intl.sigma[k] = 0);
const initial = () => { const E = X.initCities(ids, data, { months: 36, seed: "recal-r2" }); return X.calibrate(E, inp(E), data); };
{
  const E = initial(), normal = X.monthStep(E, inp(E), data);
  for (const h of [0, 1, 4, 8, 16]) {
    const r = X.monthStep(E, inp(E, id => id === a ? { energy: { hospH: h } } : {}), data);
    near(normal.report.cities[a].Lparts.rel - r.report.cities[a].Lparts.rel, 20 * Math.min(1, h / 8), "F08 병원 시간 비례");
  }
  const raised = X.monthStep(E, inp(E, () => ({ policy: { taxRes: 1 } })), data);
  near(raised.report.groups[a].parts.tax, 60 - 8 * 1.955 * .5, "F09 평균 대비 증세 손실회피");
  const reduced = X.monthStep(E, inp(E, () => ({ policy: { taxRes: -1 } })), data);
  near(reduced.report.groups[a].parts.tax, 64, "F09 평균 대비 감세");
  for (const id of ids) {
    const f = normal.report.fiscal[id], c = normal.E.cities[id];
    near(f.exp.service, Math.round(c.pop * (3e-5 + c.groups.senior.share * 2e-5) * 1000) / 1000, "F12 노령 서비스 비용");
    const subsidized = X.monthStep(E, inp(E, key => key === id ? { policy: { incentive: 10 } } : {}), data);
    near(subsidized.report.fiscal[id].exp.incentive, 10 * (1 - D.start[id].natShare), "F27 지방비 몫");
  }
  // 악화 즉시/회복 지연 모두 기여 합과 만족의 항등식을 유지한다.
  let S = normal.E;
  for (const save of [true, false, false]) {
    const r = X.monthStep(S, inp(S, () => ({ policy: { save } })), data);
    for (const id of ids) for (const [g, old] of Object.entries(S.cities[id].groups)) {
      const now = r.E.cities[id].groups[g].sat;
      near(sum(Object.values(r.report.groups[id].contrib[g])), now, "F10 기여 합=만족", 1e-7);
      if (save) near(r.report.groups[id].contrib[g].save, -5, "F10 악화 즉시");
      ok(now >= 0 && now <= 100 && old.sat >= 0, "만족 범위");
    }
    S = r.E;
  }
}
{
  let E = initial(); const base = E.cities[a], out = [];
  for (let m = 0; m < 14; m++) {
    const r = X.monthStep(E, inp(E, id => id === a && m === 0 ? { energy: { unsPct: 100, servedMWh: 0, co2: 0 } } : {}), data);
    out.push(r.E.cities[a].out);
    const mean = sum(out.slice(-12)) / Math.min(out.length, 12), c = r.E.cities[a];
    near(r.report.fiscal[a].rev.indTax, Math.round(c.ind * data.params.indTax.v * mean ** 1.7 * 1000) / 1000, "F11 최근 산출 평균의 세입");
    if (m < 12) near(c.revYear, base.revYear, "F14 첫해 세입 고정");
    E = r.E;
  }
  for (const ratio of [.10, .25, .40, .8, 1.6]) {
    const S = initial(); S.cities[a].cash = -ratio * 2.2 * S.cities[a].revYear;
    near(X.score(S, data).by[a].parts.fin, Math.max(0, 100 - Math.max(0, ratio - .1) / .15 * 50), "F14 재정 문턱", .05);
  }
  const crisis = initial(); crisis.cities[a].cash = -crisis.cities[a].debtCap * 3;
  const r = X.monthStep(crisis, inp(crisis), data);
  ok(r.report.fiscal[a].debtStage === "crisis" && r.report.fiscal[a].debtOver, "F14 한도 초과 위기");
  near(r.report.score.by[a].parts.fin, 0, "F14 한도 초과 점수0");
  ok(r.report.news.some(s => s.includes("운영 적자")), "F14 초과 부채 뉴스");
  near(r.report.fiscal[a].cashBefore + r.report.fiscal[a].revTotal - r.report.fiscal[a].expTotal, r.report.fiscal[a].cashAfter, "현금 항등식", 1e-7);
}
{
  const E = initial();
  const r = X.monthStep(E, inp(E, id => ({ energy: { costPerMWh: id === a ? .02 : .008 } })), data);
  // G3: 가산율 고정 1.02 대신 G 설정을 사용. 자기 제외 원가·정확한 차익·허용 오차 유지.
  near(r.report.fiscal[a].rev.tariff, 100 * (.008 * (1 + data.params.tariffMarkup.v) - .02), "F25 남의 평균 차익", .001);
  const singleton = X.initCities([a], data); const one = X.monthStep(singleton, inp(singleton, () => ({ energy: { costPerMWh: .02 } })), data);
  near(one.report.fiscal[a].rev.tariff, 100 * (.008 * (1 + data.params.tariffMarkup.v) - .02), "F25 혼자일 때 기준 원가", .001);
  const zero = X.monthStep(E, inp(E, () => ({ energy: { servedMWh: 0, unsPct: 100, co2: 0 } })), data);
  near(zero.E.cities[a].co2Intensity, E.cities[a].co2Intensity, "F19 공급0 시작 탄소 사용");
  const half = X.monthStep(E, inp(E, () => ({ energy: { servedMWh: 50, unsPct: 50, co2: 41 } })), data);
  // D-73: 기준 .4567→.4173; 지연식·수요 기반 목표의 의도는 유지.
  near(half.E.cities[a].co2Intensity, data.params.co2IntDef.v + .15 * (.82 - data.params.co2IntDef.v), "F19·29 공급량 분모와 지연");
  near(r.report.region.goal.co2, 600 * data.params.normalCo2.v * .7, "F20 2027 수요 기반 공동 목표");
  const score = X.score(E, data).by[a], w = data.params.wScore.v;
  near(score.score, Math.round(Math.exp(sum(Object.entries(w).map(([k, v]) => v * Math.log(Math.max(data.params.scorePartFloor.v, score.parts[k])))) / sum(Object.values(w))) * 10) / 10, "F39 기하평균·G6 투입 하한");
}
const R = C.regionOf("south"), game = () => C.newState("recal-r2-host", R.id, 0, ids, { turns: 36 });
{
  const S = game(); S.round = 1;
  const view = C.publicView(S, 0);
  near(view.econ.speeds.monthsPerTurn, 4.4, "화면 이동 시간 배속");
  // D-73: 호스트 목표의 국가 계수 .4567→.4173(단독 목표와 같은 기준).
  near(C.goalsOf(S, 100).co2, 100 * D.params.normalCo2.v * .7, "F20 호스트와 단독 같은 목표");
  S.events = [{ id: "regional_tariff", round: 1 }];
  for (const id of ids) {
    const input = C.econInput(S, R, id, { dem: 100, uns: 0, cost: {}, cpList: [] }, 1);
    near(input.energy.priceMul, C.teamDef(R, id).prov === "충남" ? .92 : 1, "F24 도 필드 대상");
    near(C.bonusOf(S, R, id, 1), 0, "F24 예산 가산 제거");
  }
  const unknown = "fixture-unknown"; S.teams[unknown] = { plan: {} };
  const input = C.econInput(S, R, unknown, { dem: 0, uns: 0, cost: {} }, 1);
  near(input.assets.uni, 0, "없는 자료 id 대학 안전 접근");
}
{
  // F21/B9: 확정 일정만 제외하고 기상도 다음 달 반복 금지.
  const counts = {}, total = {}, histogram = {}; let randomCount = 0, fixed = 0;
  for (let seed = 0; seed < 400; seed++) {
    const S = C.newState(`recal-events-${seed}`, R.id, 0, ids, { turns: 12 });
    for (let m = 1; m <= 12; m++) {
      S.round = m; C.drawEvents(S, R); const season = C.roundsOf(S)[m - 1].season;
      total[season] = (total[season] || 0) + 1;
      const events = S.events.filter(e => e.round === m), scheduled = events.filter(e => e.id === "finedust_coal_cap"), free = events.filter(e => e.id !== "finedust_coal_cap");
      ok(scheduled.length === ([1,2,3,12].includes(m) ? 1 : 0), "F21 계절관리 확정 월");
      ok(free.length <= 1 && !events.some(e => e.id === "light_load_curtailment"), "F21·22 추첨0/1·경제 경부하 제외");
      ok(free.every(e => !S.events.some(prev => prev.round === m-1 && prev.id === e.id)), "B9 기상 포함 다음 달 반복 금지");
      randomCount += free.length; fixed += scheduled.length;
      for (const e of free) { const key = `${season}/${e.id}`; counts[key] = (counts[key] || 0) + 1; histogram[e.id] = (histogram[e.id] || 0) + 1; }
    }
  }
  for (const [season, event, p] of [["summer","typhoon_coast",.056],["autumn","typhoon_coast",.026],["spring","spring_dust_haze",.077]])
    near((counts[`${season}/${event}`] || 0) / total[season], p, `F21 ${season}/${event} 목표 빈도`, .025);
  ok(randomCount / 4800 >= .4 && randomCount / 4800 <= .6 && fixed === 1600, "B9 확정 사건 제외 평균 .4~.6");
  console.log("R2 사건 빈도", JSON.stringify({ randomMean:randomCount/4800, fixed, histogram }));
}
{
  // F17·31~35·42: 실제 지도에서 연료·민원·수력·수소를 검산한다.
  const id = ids.find(id => { B.selectPack(C.teamDef(R, id).pack, "league"); return B.SITES.some(s => s.kind === "plant" && s.fuel !== "coal"); });
  B.selectPack(C.teamDef(R, id).pack, "league");
  const plan = types => {
    const used = new Set(), builds = types.map(t => {
      const tile = B.TILES.find(tile => !used.has(tile.i) && !B.siteRule(t, tile));
      assert.ok(tile, `fixture tile ${t}`); used.add(tile.i); return {t,i:tile.i};
    });
    const root = B.SITES.find(s => s.dem).tile;
    const targets = [...B.SITES.map(s => s.tile), ...builds.map(b => b.i)];
    return B.sanitize({ builds, lines: targets.filter(t => t !== root).map(t => ({p:B.routePath(root,t)})), policies:[], seed:982, season:"spring" }, 1e9);
  };
  const bio = B.simulate(plan(["biomass"]), 7, {league:true,mods:{demandMul:10}});
  near(bio.bioCo2, bio.tot.by.biomass * .1, "F17 별도 바이오 배출");
  // D-73: 수입 발전원 국가 계수 .4567→normalCo2(.4173), 바이오 별도 회계 유지.
  near(bio.co2, bio.tot.by.coal * .82 + bio.tot.by.lng * .37 + bio.tot.by.diesel * .75 + bio.tot.by.import * D.params.normalCo2.v, "F17 국가 총량 바이오 제외", 1e-6);
  const hs = plan(["hydro"]), cold = B.simulate(hs,7,{league:true,mods:{hydroMonth:1}}), wet = B.simulate(hs,7,{league:true,mods:{hydroMonth:7}});
  near(wet.tot.renAvail/cold.tot.renAvail,(.5+.5*(11.08*31)/(1229.6525/12))/(.5+.5*(.7*31)/(1229.6525/12)),"F35 월 강수 출력 비", .1);
  const cp = B.complaints(plan(["diesel","solar","wind"]),null);
  for(const it of cp.items){
    const kind = B.TOWNS[it.ti].kind;
    ok(["village","town_s","city","city_m","city_l","hospital","school","farm","livestock"].includes(kind),"F32 민원 수용자");
    ok(!["farm","livestock"].includes(kind)||["noise","view"].includes(it.kind),"F32 농축산은 소음·경관만");
    ok(typeof it.src==="string", "F31 민원 발생 설비 분리");
  }
  for(const it of cp.items.filter(it => it.src === "diesel"))
    ok(!cp.items.some(other => other.bi === it.bi && other.ti === it.ti && other.kind !== it.kind && ["noise","smoke"].includes(other.kind)), "F33 같은 디젤·수용자 소음/매연 중복 금지");
  const hp = plan(["solar","h2store"]);
  const plain = B.simulate(hp,7,{league:true,mods:{curtailP:1,demandMul:.01}});
  const mixed = B.simulate(hp,7,{league:true,mods:{curtailP:1,demandMul:.01,h2Co2:.88}});
  ok(mixed.tot.h2mixMWh>0 && mixed.tot.h2End>=0,"F42 수소 유한 재고");
  near(mixed.tot.batOut+mixed.tot.h2mixMWh+mixed.tot.h2End*Math.sqrt(.35),plain.tot.batOut+plain.tot.h2End*Math.sqrt(.35),"F42 혼소 포함 수소 에너지 보존",1e-6);
  ok(plain.co2 - mixed.co2 > 0,"F42 잔량 범위 탄소 감축 > 0");
  near(plain.cost.fuel - mixed.cost.fuel, mixed.tot.h2mixMWh * .008, "F42 혼소분 LNG 연료비 차감", 1e-6);
}
console.log(`R2 checks ${checks}, fail 0`);
