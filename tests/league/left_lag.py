"""next.py left_consistency의 '옛 남은 돈이 화면에 남는 시간'을 페이지 안에서 잰다(2026-10-21, 53b5560).

진행자: 상태에 팀 계획이 들어온 순간(tState) → 장부 표 그 도시 '남은 돈' 칸 글자가 바뀐 순간(tDom).
팀: 계획을 보낸 순간(t0) → 받은 공개 상태의 left가 바뀐 순간(tSnap) → 머리 칸 #lg-left-hud 글자가 바뀐 순간(tHud).
진행자는 changed()의 150ms 묶음 대기 뒤에 다시 그리고 팀에 보내므로(ui/league.js) 그만큼의 창이 생긴다.
총괄 기준: 1초를 넘으면 화면 결함(학생이 1초 넘게 옛 돈을 본다). 결과 기록: docs/QUALITY-stability.md §4·§5.
사용: tests/.venv/bin/python tests/league/left_lag.py $U [회수] [감속배수...]   (기본 3회, 1·4배)
"""
import importlib.util, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
URL = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 3
RATES = [float(x) for x in sys.argv[3:]] or [1, 4]
spec = importlib.util.spec_from_file_location("next_check", os.path.join(HERE, "next.py"))
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)

from playwright.sync_api import sync_playwright

HOST_WATCH = """id => { const w = window.__lag = {}; const cell = () => {
  const b = document.querySelector(`[data-host-city="${id}"]`); const tr = b && b.closest('tr');
  const td = tr && tr.querySelector('td[data-label="남은 돈"]'); return td ? td.textContent : null; };
  w.init = cell(); const loop = () => { const S = KCP.league.state().S, now = performance.now();
    if (w.tState == null && ((S.teams[id].plan || {}).builds || []).length === 1) w.tState = now;
    if (w.tState != null && w.tDom == null && cell() !== w.init) { w.tDom = now; w.after = cell(); }
    if (w.tDom == null) requestAnimationFrame(loop); }; requestAnimationFrame(loop); return w.init; }"""
TEAM_WATCH = """id => { const w = window.__lag = {}; const hud = () => document.querySelector('#lg-left-hud')?.textContent;
  w.initHud = hud(); w.initLeft = KCP.league.state().snap.teams[id].left; w.t0 = performance.now();
  const loop = () => { const L = KCP.league.state(), now = performance.now();
    if (w.tSnap == null && L.snap.teams[id].left !== w.initLeft) w.tSnap = now;
    if (w.tHud == null && hud() !== w.initHud) { w.tHud = now; w.after = hud(); }
    if (w.tHud == null || w.tSnap == null) requestAnimationFrame(loop); }; requestAnimationFrame(loop); return w.initHud; }"""

base = URL.split("#", 1)[0]
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for rate in RATES:
        orig = mod.monitor
        def monitor(context, pages, label, orig=orig, rate=rate):
            page = orig(context, pages, label)
            if rate > 1: context.new_cdp_session(page).send("Emulation.setCPUThrottlingRate", {"rate": rate})
            return page
        mod.monitor = monitor
        worst = 0
        for i in range(N):
            context = mod.make_context(browser, base, 390); pages = []
            host, team, fixture = mod.setup_pair(context, base, pages)
            mod.advance(host, team, "plan")
            host.evaluate("() => { KCP.league.state().S.events = []; }")
            tid = fixture["team"]
            host.evaluate(HOST_WATCH, tid); team.evaluate(TEAM_WATCH, tid)
            team.evaluate(mod.PLAN)
            host.wait_for_function("() => window.__lag.tDom != null", timeout=30000)
            team.wait_for_function("() => window.__lag.tHud != null && window.__lag.tSnap != null", timeout=30000)
            h = host.evaluate("() => window.__lag"); t = team.evaluate("() => window.__lag")
            hostLag = h["tDom"] - h["tState"]; snapLag = t["tSnap"] - t["t0"]; hudLag = t["tHud"] - t["t0"]
            worst = max(worst, hostLag, hudLag)
            errs = sum(len(e["console"]) + len(e["page"]) for _, _, e in pages)
            print(f"rate {rate:g} run {i}: host state→DOM {hostLag:.0f}ms ({h['init']}→{h['after']}) | "
                  f"team plan→snap {snapLag:.0f}ms, plan→HUD {hudLag:.0f}ms ({t['initHud']}→{t['after']}) | errors {errs}", flush=True)
            context.close()
        mod.monitor = orig
        print(f"MAX rate {rate:g}: {worst:.0f}ms", flush=True)
    browser.close()
