import json, sys
from playwright.sync_api import sync_playwright
AUTO = """
window.__auto = (id, extra) => {
  const BG = KCP.buildGame; BG.selectPack(id, "league");
  const T = BG.TILES, S = BG.SITES;
  const dist = (a, b) => { const A = T[a], B = T[b]; return Math.hypot(A.X - B.X, A.Y - B.Y); };
  const sites = S.map(s => s.tile);
  const start = (S.find(s => s.kind === "plant") || S.find(s => s.kind === "factory_big") || S[0]).tile;
  const conn = new Set([start]), lines = [];
  let rest = sites.filter(t => t !== start);
  while (rest.length) {
    let best = null;
    rest.forEach(t => conn.forEach(c => { const d = dist(t, c); if (!best || d < best.d) best = { t, c, d }; }));
    const p = BG.routePath(best.c, best.t);
    if (p) { lines.push({ p }); p.forEach(x => conn.add(x)); }
    rest = rest.filter(t => t !== best.t);
  }
  return { builds: extra || [], lines, policies: [], missions: [], shed: "home", fab2: false };
};
"""
with sync_playwright() as pw:
    br = pw.chromium.launch(); pg = br.new_page()
    pg.goto("http://127.0.0.1:9400/index.html#home"); pg.wait_for_timeout(800)
    pg.evaluate("() => {" + AUTO + "}")  # // ECON-UI v1.1: 함수 정의만 실행하여 인자 없는 자동 호출을 막는다.
    out = pg.evaluate("""() => {
      const C = KCP.leagueCore, BG = KCP.buildGame, R = C.regionOf("south");
      const runAll = (ties, seasonIdx) => {
        const S = C.newState("T", "south", 0);
        S.round = seasonIdx + 1; S.phase = "plan";
        R.teams.forEach(t => { S.teams[t.id].plan = __auto(t.id); });
        S.ties = ties ? R.ties.filter(D => D.kind !== "sea").map(D => ({ a: D.a, b: D.b, cap: 4, st: "built" })) : [];
        const res = C.runRound(S, BG);
        return { region: res.region, team: Object.fromEntries(Object.entries(res.team).map(([k, r]) => [k, [r.unsPct, r.co2Prod, r.co2Cons, r.imp, r.exp, r.cost.total, r.capexMissing]])),
                 cap: Object.fromEntries(R.teams.map(t => [t.id, C.capexOf(BG, R, t.id, __auto(t.id))])) };
      };
      return { alone: [0,1,2,3].map(i => runAll(false, i)), tied: [0,1,2,3].map(i => runAll(true, i)) };
    }""")
    for k in ("alone", "tied"):
        for i, r in enumerate(out[k]):
            print(k, i, json.dumps(r["region"], ensure_ascii=False))
            for t, v in r["team"].items(): print("   ", t, v)
    print("capex of auto plans", out["alone"][0]["cap"])
    br.close()
