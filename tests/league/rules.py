# 리그 규칙 불변 조건 검사(브라우저 안에서 KCP.leagueCore를 직접 부른다)
import json, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9420/index.html"
JS = r"""
() => {
  const C = KCP.leagueCore, BG = KCP.buildGame, out = {}, ok = (c, m) => { (out.checks = out.checks || []).push([!!c, m]); };
  const seat = S => Object.keys(S.teams).forEach(id => C.reduce(S, { type: "claim", team: id, token: "tok-" + id + "-0001" }, 1, BG));
  const tok = id => "tok-" + id + "-0001";
  const free = (pack, type, n, skip) => { BG.selectPack(pack, "league"); const r = []; BG.TILES.forEach(T => { if (r.length < n && !(skip || []).includes(T.i) && !T.out && T.site < 0 && !BG.siteRule(type, T)) r.push(T.i); }); return r; };
  // 1) 철거 회수와 현금 흐름
  let S = C.newState("RULE1", "south", 0, ["pyeongtaek", "dangjin"]); seat(S);
  C.host(S, "next", 2); S.events = [];
  const [a1, a2] = free("pyeongtaek", "solar", 2), [b1] = free("pyeongtaek", "battery", 1, [a1, a2]);
  const p1 = { builds: [{ t: "solar", i: a1 }, { t: "solar", i: a2 }, { t: "battery", i: b1 }], lines: [], policies: [], shed: "home" };
  ok(C.reduce(S, { type: "plan", team: "pyeongtaek", token: tok("pyeongtaek"), rev: 1, plan: p1 }, 3, BG).ok, "plan r1 accepted");
  ok(C.reduce(S, { type: "plan", team: "pyeongtaek", token: tok("pyeongtaek"), rev: 1, plan: { builds: [], lines: [] } }, 3, BG).quiet, "duplicate rev ignored (reconnect)");
  const cap1 = C.capexOf(BG, C.regionOf("south"), "pyeongtaek", S.teams.pyeongtaek.plan);
  const r1 = C.run(S, BG, 4).team.pyeongtaek;
  ok(Math.abs(r1.cost.inv - cap1) < 0.02 && Math.abs(r1.cost.stock - cap1) < 0.02, `r1 new investment = capex (${r1.cost.inv} vs ${cap1})`);
  ok(Math.abs(r1.cost.total - (r1.cost.inv + r1.cost.opex)) < 0.02, "total = inv + opex");
  C.host(S, "next", 5); S.events = S.events.filter(x => x.round !== 2);
  const solarC = S.teams.pyeongtaek.base.find(x => x.k === `b:solar:${a1}`).c;
  const p2 = { builds: p1.builds.slice(1), lines: [], policies: [], shed: "home" };
  C.reduce(S, { type: "plan", team: "pyeongtaek", token: tok("pyeongtaek"), rev: 2, plan: p2 }, 6, BG);
  const R = C.regionOf("south"), loss = C.lossOf(S.teams.pyeongtaek.base, S.teams.pyeongtaek.plan);
  ok(Math.abs(loss - solarC * (1 - C.SALV)) < 0.02, `remove last-round solar loses 70% (${loss} of ${solarC})`);
  ok(Math.abs(C.spendOf(BG, S, R, "pyeongtaek", S.teams.pyeongtaek.plan) - (cap1 - solarC + loss)) < 0.05, "spend = capex + loss");
  C.reduce(S, { type: "plan", team: "pyeongtaek", token: tok("pyeongtaek"), rev: 3, plan: p1 }, 7, BG);
  ok(C.lossOf(S.teams.pyeongtaek.base, S.teams.pyeongtaek.plan) === 0, "rebuilding the same item restores (no loss)");
  // 이번 라운드에 새로 놓았다 뺀 것은 손실 없음
  const [n1] = free("pyeongtaek", "solar", 1, [a1, a2, b1]);
  const p3 = { builds: p1.builds.concat([{ t: "solar", i: n1 }]), lines: [], policies: [], shed: "home" };
  C.reduce(S, { type: "plan", team: "pyeongtaek", token: tok("pyeongtaek"), rev: 4, plan: p3 }, 8, BG);
  C.reduce(S, { type: "plan", team: "pyeongtaek", token: tok("pyeongtaek"), rev: 5, plan: p2 }, 9, BG);
  ok(Math.abs(C.lossOf(S.teams.pyeongtaek.base, S.teams.pyeongtaek.plan) - loss) < 0.02, "same-round undo is free");
  const r2 = C.run(S, BG, 10).team.pyeongtaek;
  ok(Math.abs(r2.cost.inv + solarC * C.SALV) < 0.05, `r2 cash flow = −salvage returned (${r2.cost.inv})`);
  ok(Math.abs(r1.cost.inv + r2.cost.inv - r2.cost.stock) < 0.05, "Σ inv = cumulative stock (no double count)");
  ok(Math.abs(S.teams.pyeongtaek.sunk - loss) < 0.02, "sunk recorded after run");
  out.cash = { r1: r1.cost, r2: r2.cost };
  // 2) 사건: 예보 숨김 · 대응 비용 한 번만 · 효과
  S = C.newState("RULE2", "south", 0, ["pyeongtaek", "dangjin", "asan"]); seat(S);
  C.host(S, "next", 2);
  S.events = [{ id: "heatwave_peak", round: 1, x: 1.2 }];
  let V = C.publicView(S, 3);
  ok(V.events[0].x === undefined, "actual size hidden during plan");
  const b0 = C.budget(S, "pyeongtaek") - C.fixedOf(S, R, "pyeongtaek");
  ok(C.reduce(S, { type: "respond", team: "pyeongtaek", token: tok("pyeongtaek"), ev: "heatwave_peak", opt: "dr" }, 4, BG).ok, "respond ok");
  ok(C.reduce(S, { type: "respond", team: "pyeongtaek", token: tok("pyeongtaek"), ev: "heatwave_peak", opt: "dr" }, 5, BG).quiet, "duplicate respond quiet");
  ok(Math.abs(b0 - (C.budget(S, "pyeongtaek") - C.fixedOf(S, R, "pyeongtaek")) - 4) < 1e-6, "response cost charged once (4억)");
  ok(!C.reduce(S, { type: "respond", team: "pyeongtaek", token: tok("pyeongtaek"), ev: "typhoon_coast", opt: "harden" }, 6, BG).ok, "respond to absent event rejected");
  const m1 = C.modsFor(S, R, "pyeongtaek").demandMul, m2 = C.modsFor(S, R, "dangjin").demandMul;
  ok(Math.abs(m1 - (1 + 0.12 * 1.2 * 0.5)) < 1e-9 && Math.abs(m2 - (1 + 0.12 * 1.2)) < 1e-9, `response halves the deviation (${m1.toFixed(4)} vs ${m2.toFixed(4)})`);
  const rr = C.run(S, BG, 7);
  V = C.publicView(S, 8);
  ok(V.events[0].x === 1.2, "actual size shown after run");
  ok(rr.team.pyeongtaek.cost.resp === 4, "response cost in this round's opex");
  ok(!C.reduce(S, { type: "respond", team: "pyeongtaek", token: tok("pyeongtaek"), ev: "heatwave_peak", opt: "none" }, 9, BG).ok, "no respond outside plan");
  // 3) 태풍: 보강하면 연계선 고장 없음
  const typh = harden => { const T = C.newState("RULE3", "south", 0, ["pyeongtaek", "dangjin", "asan"]); seat(T); C.host(T, "next", 2);
    T.ties = [{ a: "asan", b: "dangjin", cap: 2, st: "built", by: "asan", round: 1 }]; T.events = [{ id: "typhoon_coast", round: 1, x: 1 }];
    if (harden) C.reduce(T, { type: "respond", team: "dangjin", token: tok("dangjin"), ev: "typhoon_coast", opt: "harden" }, 3, BG);
    return C.run(T, BG, 4).tieDown; };
  const d0 = typh(false), d1 = typh(true);
  ok(d0 && !d1, `harden prevents tie outage (${d0} → ${d1})`);
  // 4) 지원금: 유치 보류면 0
  const T4 = C.newState("RULE4", "south", 0, ["pyeongtaek", "dangjin"]); seat(T4); C.host(T4, "next", 2);
  T4.events = [{ id: "datacenter_siting", round: 1, x: 1 }];
  const g0 = C.bonusOf(T4, R, "pyeongtaek");
  C.reduce(T4, { type: "respond", team: "pyeongtaek", token: tok("pyeongtaek"), ev: "datacenter_siting", opt: "hold" }, 3, BG);
  ok(g0 === 10 && C.bonusOf(T4, R, "pyeongtaek") === 0 && C.modsFor(T4, R, "pyeongtaek").demandMul === 1, "hold: no grant, no demand");
  // 5) 재현성: 같은 방·계획이면 같은 결과
  const same = () => { const X = C.newState("RULE5", "south", 0, ["pyeongtaek", "dangjin"]); seat(X); C.host(X, "next", 2);
    C.reduce(X, { type: "plan", team: "pyeongtaek", token: tok("pyeongtaek"), rev: 1, plan: p1 }, 3, BG); return JSON.stringify(C.run(X, BG, 4)); };
  ok(same() === same(), "same inputs → same result");
  // 6) 배터리: 에너지를 만들지 않는가 — 시작 잔량 차이
  const auto = id => { BG.selectPack(id, "league"); const T = BG.TILES, Sx = BG.SITES, dist = (a, b) => Math.hypot(T[a].X - T[b].X, T[a].Y - T[b].Y);
    const start = (Sx.find(s => s.kind === "plant") || Sx[0]).tile, conn = new Set([start]), lines = []; let rest = Sx.map(s => s.tile).filter(t => t !== start);
    while (rest.length) { let best = null; rest.forEach(t => conn.forEach(c => { const d = dist(t, c); if (!best || d < best.d) best = { t, c, d }; })); const p = BG.routePath(best.c, best.t); if (p) { lines.push({ p }); p.forEach(x => conn.add(x)); } rest = rest.filter(t => t !== best.t); }
    return { conn: [...conn], lines }; };
  const A = auto("pyeongtaek"), near = A.conn.flatMap(i => BG.TILES[i].nb).filter((i, k, a) => a.indexOf(i) === k);
  const pick = (type, n, skip) => near.filter(i => !skip.includes(i) && !BG.TILES[i].out && BG.TILES[i].site < 0 && !BG.siteRule(type, BG.TILES[i])).slice(0, n);
  const bs = pick("battery", 3, []), ss = pick("solar", 6, bs);
  const st = BG.sanitize({ builds: bs.map(i => ({ t: "battery", i })).concat(ss.map(i => ({ t: "solar", i }))), lines: A.lines.concat(bs.concat(ss).map(i => { const c = A.conn.find(x => BG.TILES[x].nb.includes(i)); return { p: [c, i] }; })) }, 1e9);
  out.battery = {};
  ["summer", "winter"].forEach(se => { st.season = se; const res = BG.simulate(st, 7);
    out.battery[se] = { n: st.builds.filter(b => b.t === "battery").length, start: res.tot.batStart, end: Math.round(res.tot.batEnd * 100) / 100, batOut: Math.round(res.tot.batOut * 100) / 100, dem: Math.round(res.tot.dem), uns: Math.round(res.unsTotal * 100) / 100 };
    ok(Math.abs(res.tot.batDebt - Math.max(0, res.tot.batStart - res.tot.batEnd)) < 1e-6, se + " battery deficit accounted"); ok(res.tot.batEnd >= 0.1 * 16 * out.battery[se].n - 1e-6 && res.tot.batEnd <= 16 * out.battery[se].n + 1e-6, se + " SOC within floor..capacity"); });

  // 7) 연구: 혼자 하기(운영 기간 안), 병목, 캠퍼스 수요, 리그 라운드 진척
  BG.selectPack("pyeongtaek", "league");
  const [u1, l1] = pick("uni", 2, bs.concat(ss));
  const base7 = { builds: bs.map(i => ({ t: "battery", i })).concat(ss.map(i => ({ t: "solar", i }))), lines: A.lines.concat(bs.concat(ss).map(i => { const c = A.conn.find(x => BG.TILES[x].nb.includes(i)); return { p: [c, i] }; })) };
  const mk = (extra, rq) => { const z = BG.sanitize({ builds: base7.builds.concat(extra), lines: base7.lines, rq }, 1e9); z.season = "summer"; return z; };
  const both = [{ t: "uni", i: u1 }, { t: "lab", i: l1 }];
  const rr90 = BG.researchRun(mk(both, ["bms"]), 13), rrLab = BG.researchRun(mk([{ t: "lab", i: l1 }], ["bms"]), 13), rrUni = BG.researchRun(mk([{ t: "uni", i: u1 }], ["bms"]), 13);
  ok(rr90.adoptW.bms === 5, "uni+lab: BMS adopted week 6 (index 5) — " + rr90.adoptW.bms);
  ok(rrLab.adoptW.bms === 6, "lab only: one week later (staff bottleneck) — " + rrLab.adoptW.bms);
  ok(rrUni.adoptW.bms === undefined && rrUni.seats === 0, "uni without lab: no seats, no research");
  ok(BG.researchRun(mk(both, []), 13).log.length === 0, "no research chosen → nothing happens (building alone does nothing)");
  ok(BG.researchRun(mk(both, ["bms"]), 1).adoptW.bms === undefined, "1-week run: not adopted");
  const s0 = BG.simulate(mk([], []), 7), s1 = BG.simulate(mk(both, []), 7);
  ok(Math.abs((s1.tot.dem - s0.tot.dem) - 0.45 * 168) < 0.5, "campus load 0.45 MW added to demand (" + (s1.tot.dem - s0.tot.dem).toFixed(1) + " MWh)");
  const sA = BG.simulate(mk(both, ["bms"]), 90), sB = BG.simulate(mk(both, []), 90);
  const ss2 = pick("solar", 30, bs.concat([u1, l1])), rich = (rq) => { const z = BG.sanitize({ builds: bs.map(i => ({ t: "battery", i })).concat(ss2.map(i => ({ t: "solar", i })), both), lines: A.lines.concat(bs.concat(ss2).map(i => { const c = A.conn.find(x => BG.TILES[x].nb.includes(i)); return { p: [c, i] }; })), rq }, 1e9); z.season = "spring"; return BG.simulate(z, 90); };
  const e0 = rich([]), e1 = rich(["bms"]), e2 = rich(["fcst"]), e3 = rich(["grid"]);
  const brief = r => ({ solar: r.st ? 0 : undefined, batOut: Math.round(r.tot.batOut), uns: Math.round(r.unsTotal), eveH: r.town.reduce((a, t) => a + t.eveH, 0), hospH: r.hospH, loss: Math.round(r.tot.loss), curt: Math.round(r.tot.curt), fuel: Math.round(r.cost.fuel * 10) / 10, co2: Math.round(r.co2) });
  out.rich = { n: ss2.length, none: brief(e0), bms: brief(e1), fcst: brief(e2), grid: brief(e3) };
  ok(sA.techDay.bms === 35, "BMS effect from day 35");
  ok(Math.abs(sA.cost.research - (13 * 0.3 + 3 + 3 * 1)) < 0.01, "research cost = lab opex + demo + retrofit (" + sA.cost.research + ")");
  out.research = { batOutWith: Math.round(sA.tot.batOut), batOutWithout: Math.round(sB.tot.batOut), unsWith: Math.round(sA.unsTotal * 10) / 10, unsWithout: Math.round(sB.unsTotal * 10) / 10, fuelWith: Math.round(sA.cost.fuel * 100) / 100, fuelWithout: Math.round(sB.cost.fuel * 100) / 100 };
  const sF = BG.simulate(mk(both, ["fcst"]), 90);
  out.research.fcst = { uns: Math.round(sF.unsTotal * 10) / 10, hospH: sF.hospH, eveOut: sF.town.reduce((a, t) => a + t.eveH, 0), base: { uns: Math.round(sB.unsTotal * 10) / 10, hospH: sB.hospH, eveOut: sB.town.reduce((a, t) => a + t.eveH, 0) } };
  // 리그
  const L7 = C.newState("RULE7", "south", 0, ["pyeongtaek", "dangjin"]); seat(L7);
  const lp = Object.assign({}, base7, { builds: base7.builds.concat(both), rq: ["bms"], policies: [], shed: "home" });
  const step = (rev) => { C.host(L7, "next", 10 * rev); L7.events = []; C.reduce(L7, { type: "plan", team: "pyeongtaek", token: tok("pyeongtaek"), rev, plan: lp }, 10 * rev + 1, BG); return C.run(L7, BG, 10 * rev + 2).team.pyeongtaek; };
  const q1 = step(1); const rs1 = JSON.parse(JSON.stringify(L7.teams.pyeongtaek.rs));
  const q2 = step(2); const rs2 = JSON.parse(JSON.stringify(L7.teams.pyeongtaek.rs));
  const q3 = step(3); const rs3 = JSON.parse(JSON.stringify(L7.teams.pyeongtaek.rs));
  C.host(L7, "next", 40);
  // 유레카는 정규 연구 전에 남은 need의 1/3을 더한다(계절·달 모드 공통).
  const bmsNeed = (KCP.TECH_DATA?.cards || BG.TECHS).find(c => c.id === "bms").need;
  const bmsEureka = rs1.eureka?.includes("bms") ? bmsNeed / 3 : 0;
  const expectedBms = Math.min(bmsNeed, 3 + bmsEureka);
  ok(Math.abs(rs1.prog.bms - expectedBms) < 1e-9 && rs1.eff === 1,
    `league r1: new uni not staffed yet (eff 1, prog ${expectedBms} including eureka ${bmsEureka})`);
  ok(rs2.stage.bms === "demo" && rs2.eff === 3, "league r2: uni staffed → demo");
  ok(Math.abs(q2.cost.inv - (3 + 3)) < 0.05 && q2.cost.research === 3, "league r2: demo+retrofit in new investment, lab opex in opex (" + q2.cost.inv + ")");
  ok(rs3.stage.bms === "done" && rs3.adoptR.bms === 4 && C.modsFor(L7, R, "pyeongtaek").tech.includes("bms"), "league r4: BMS active");
  ok(C.publicView(L7, 41).teams.pyeongtaek.fcx === null, "no forecast tech → no precise forecast");
  L7.teams.pyeongtaek.rs.adoptR.fcst = 1; L7.events = [{ id: "heatwave_peak", round: L7.round, x: 1.3 }];
  const fx = C.publicView(L7, 42).teams.pyeongtaek.fcx.heatwave_peak;
  ok(fx[0] <= 1.3 && fx[1] >= 1.3 && fx[1] - fx[0] <= 0.7 + 1e-9 && fx[1] - fx[0] < 1, "forecast tech: narrowed range (×0.7, ECON-RECAL-SPEC §1.3·REF 12.7) containing actual (" + fx + ")");
  return out;
}
"""
with sync_playwright() as pw:
    br = pw.chromium.launch(); pg = br.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "#home"); pg.wait_for_timeout(500)
    out = pg.evaluate(JS)
    br.close()
bad = 0
for c, m in out["checks"]:
    print("PASS" if c else "FAIL", m); bad += 0 if c else 1
print("cash", json.dumps(out["cash"], ensure_ascii=False)); print("battery", out["battery"]); print("research", out.get("research")); print("rich", json.dumps(out.get("rich"))); print("errors", errs)
print("PROBLEMS", bad + len(errs))
