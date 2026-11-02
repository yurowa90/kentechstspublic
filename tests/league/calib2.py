import json, sys
from playwright.sync_api import sync_playwright
AUTO = open(__file__.replace("calib2.py", "calib.py")).read().split('AUTO = """')[1].split('"""')[0]
STRAT = """
window.__plan = (id, strat, budget) => {
  const BG = KCP.buildGame, P = __auto(id); BG.selectPack(id, "league");
  const T = BG.TILES, onLine = new Set(P.lines.flatMap(L => L.p)), used = new Set(BG.SITES.map(s => s.tile));
  const cap = () => BG.capex(P);
  const spots = (ok) => T.filter(t => !used.has(t.i) && ok(t) && t.nb.some(j => onLine.has(j)) && !onLine.has(t.i));
  const add = (type, ok, n) => { for (const t of spots(ok)) { if (n <= 0) break; P.builds.push({ t: type, i: t.i }); if (cap() > budget) { P.builds.pop(); return; } used.add(t.i); n--; } };
  const peak = BG.peakDemand({}, false);
  if (strat === "diesel") add("diesel", t => ["plain","beach","hill","forest"].includes(t.t), Math.ceil(peak / 3) + 1);
  if (strat === "green") {
    add("roof", t => t.t === "urban", 40);
    for (let k = 0; k < 30; k++) { add("solar", t => t.t === "plain" || t.t === "beach", 2); add("battery", t => t.t === "plain", 1); if (cap() > budget - 8) break; }
  }
  if (strat === "mix") {
    add("roof", t => t.t === "urban", 20);
    add("diesel", t => ["plain","beach","hill","forest"].includes(t.t), Math.ceil(peak / 6));
    for (let k = 0; k < 30; k++) { add("solar", t => t.t === "plain" || t.t === "beach", 2); add("battery", t => t.t === "plain", 1); if (cap() > budget - 8) break; }
  }
  return P;
};
"""
with sync_playwright() as pw:
    br = pw.chromium.launch(); pg = br.new_page()
    pg.goto("http://127.0.0.1:9400/index.html#home"); pg.wait_for_timeout(800)
    # 문자열 식의 값이 함수면 Playwright가 인자 없이 호출한다(__auto(undefined) → selectPack(null) → 기본 지도로 바뀜). 정의만 하도록 감싼다.
    pg.evaluate(f"() => {{ {AUTO} }}"); pg.evaluate(f"() => {{ {STRAT} }}")
    for strat in ["diesel", "green", "mix"]:
      for ties in [False, True]:
        out = pg.evaluate("""([strat, ties]) => {
          const C = KCP.leagueCore, BG = KCP.buildGame, R = C.regionOf("south"), all = [];
          for (const rd of [1, 2, 4]) {
            const S = C.newState("T", "south", 0); S.round = rd; S.phase = "plan";
            S.ties = ties ? R.ties.filter(D => D.kind !== "sea").map(D => ({ a: D.a, b: D.b, cap: 4, st: "built" })) : [];
            R.teams.forEach(t => { S.teams[t.id].plan = __plan(t.id, strat, C.budget(S, t.id)); });
            const res = C.runRound(S, BG);
            all.push({ rd, region: res.region, t: Object.fromEntries(Object.entries(res.team).map(([k, r]) => [k, [r.unsPct, r.co2Prod, r.imp, r.exp, r.cost.capex]])) });
          }
          return all;
        }""", [strat, ties])
        for o in out:
            print(strat, "ties" if ties else "alone", "R", o["rd"], o["region"]["unsPct"], o["region"]["co2"], json.dumps(o["t"], ensure_ascii=False))
    br.close()
