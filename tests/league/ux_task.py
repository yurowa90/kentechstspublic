"""품질 8 UX 갈래: 첫 달 과제 수행 측정(기준선·개선 뒤 비교용).

처음 쓰는 학생이 혼자 하기 첫 달(S1~S8)을 한 바퀴 도는 최소 경로를 화면 단추로만 따라가며
행동마다 다음을 남긴다.
- 행동 수(클릭·탭·고르기·입력), 스크롤이 필요했는지(대상이 화면 밖), 대상이 다른 요소에 가렸는지,
  대상 크기(44px 미만), 장면별 경과 시간(부하에 민감하므로 참고값), 보이는 조작 수·글자 수.
- 장면마다 화면 캡처, 가로 넘침.
엔진 함수는 상태 읽기·후보 칸 계산에만 쓴다. 진행은 모두 화면 조작이다.

실행: tests/.venv/bin/python tests/league/ux_task.py http://127.0.0.1:10040/index.html \
        --cfg desktop|tablet|mobile --out <폴더>
"""

import argparse
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

CFG = {
    "desktop": {"viewport": {"width": 1280, "height": 900}},
    # 교실 태블릿(가로). 터치만, 키보드·마우스 호버 없음.
    "tablet": {"viewport": {"width": 1024, "height": 768}, "has_touch": True, "is_mobile": True},
    "mobile": {"viewport": {"width": 390, "height": 844}, "has_touch": True, "is_mobile": True},
}

# 대상 요소의 화면 상태: 보이는지, 화면 안인지, 가렸는지, 크기.
TARGET_JS = r"""sel => {
  const el = document.querySelector(sel);
  if (!el) return {exists:false};
  const r = el.getBoundingClientRect();
  const W = innerWidth, H = innerHeight;
  const shown = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  // 화면 안이어도 스크롤 상자(서랍 본문 등) 밖으로 잘렸으면 '스크롤 필요'로 본다(가림과 구분).
  let clipped = false;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX)) {
      const b = p.getBoundingClientRect();
      if (r.top < b.top - 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.right > b.right + 1) { clipped = true; break; }
    }
  }
  const inView = shown && !clipped && r.top >= 0 && r.left >= 0 && r.bottom <= H && r.right <= W;
  let occluded = null;
  if (inView) {
    const cx = r.left + r.width/2, cy = r.top + r.height/2;
    const hit = document.elementFromPoint(cx, cy);
    occluded = !(hit && (hit === el || el.contains(hit) || hit.contains(el)));
    if (occluded) occluded = (hit.id ? '#'+hit.id : hit.tagName.toLowerCase() + '.' + String(hit.className).split(' ')[0]);
  }
  return {exists:true, shown, inView, occluded, w:Math.round(r.width), h:Math.round(r.height),
          top:Math.round(r.top), label:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,30)};
}"""

# 장면 요약: 화면 안에 보이는 조작 수, 44px 미만 조작, 보이는 글자 수, 가로 넘침.
SCENE_JS = r"""() => {
  const W = innerWidth, H = innerHeight;
  const inView = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W; };
  const ctl = [...document.querySelectorAll('button,a[href],[role=button],input:not([type=hidden]),select,summary,textarea')].filter(inView);
  const small = ctl.filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
    .map(e => (e.id ? '#'+e.id : '') + ' ' + (e.innerText||e.value||e.getAttribute('aria-label')||'').trim().slice(0,20) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  let chars = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const p = n.parentElement; if (!p || !n.textContent.trim()) continue;
    const r = p.getBoundingClientRect(); const s = getComputedStyle(p);
    if (s.display === 'none' || s.visibility === 'hidden' || r.width === 0) continue;
    if (r.bottom > 0 && r.top < H && r.right > 0 && r.left < W) chars += n.textContent.trim().length;
  }
  return {controls: ctl.length, small: small.slice(0, 12), smallCount: small.length, chars,
          overflowX: document.documentElement.scrollWidth > W + 1};
}"""

STATE_JS = "() => {const L=KCP.league.state(); const S=L.S||L.snap; return S ? {round:S.round, phase:S.phase, results:(S.results||[]).length} : null;}"

CAND_JS = """kind => {
  const B=KCP.buildGame, st=B.current(), used=new Set(st.builds.map(b=>b.i));
  const line=new Set(st.lines.flatMap(l=>l.p));
  return B.TILES.filter(t=>!t.out && t.site<0 && !used.has(t.i) &&
    !B.siteRule(kind,t) && (()=>{
      const p=B.tileXY(t.c,t.r);
      return p && document.elementFromPoint(p[0],p[1])?.tagName==='CANVAS';
    })()).map(t=>({i:t.i, near:(line.has(t.i)||t.nb.some(i=>line.has(i)))?0:1}))
    .sort((a,b)=>a.near-b.near||a.i-b.i).map(x=>x.i);
}"""

TILE_XY_JS = "i => { const T = KCP.buildGame.TILES[i]; const p = KCP.buildGame.tileXY(T.c, T.r); const el = p && document.elementFromPoint(p[0], p[1]); return p && el && el.tagName === 'CANVAS' ? p : null; }"


class Run:
    def __init__(self, page, cfg, out):
        self.page, self.cfg, self.out = page, cfg, out
        self.touch = CFG[cfg].get("has_touch", False)
        self.steps, self.scenes, self.cur, self.t0 = [], [], None, None
        self.stuck = []

    def scene(self, name):
        self.end_scene()
        self.cur, self.t0 = name, time.monotonic()
        self.scene_steps0 = len(self.steps)

    def end_scene(self):
        if not self.cur:
            return
        info = self.page.evaluate(SCENE_JS)
        shot = f"{self.cfg}-{self.cur}.png"
        self.page.screenshot(path=str(self.out / shot))
        own = self.steps[self.scene_steps0:]
        self.scenes.append({"scene": self.cur, "sec": round(time.monotonic() - self.t0, 1),
                            "actions": sum(s["kind"] != "view" for s in own),
                            "scrolls": sum(bool(s.get("scrolled")) for s in own),
                            "occluded": [s["sel"] for s in own if s.get("occluded")],
                            "smallTargets": [s["sel"] for s in own if s.get("small")],
                            **info, "shot": shot})
        self.cur = None

    def _prep(self, sel, note):
        st = self.page.evaluate(TARGET_JS, sel)
        if not st.get("exists") or not st.get("shown"):
            self.stuck.append({"scene": self.cur, "sel": sel, "why": "대상 없음/숨김", "note": note})
            raise AssertionError(f"{self.cur}: {sel} 없음")
        scrolled = not st["inView"]
        if scrolled:
            self.page.locator(sel).first.scroll_into_view_if_needed(timeout=10000)
            self.page.wait_for_timeout(150)
            st2 = self.page.evaluate(TARGET_JS, sel)
            st["occluded"] = st2.get("occluded")
        rec = {"scene": self.cur, "sel": sel, "label": st["label"], "w": st["w"], "h": st["h"],
               "small": st["w"] < 44 or st["h"] < 44, "scrolled": scrolled,
               "occluded": st.get("occluded") or None, "note": note}
        return rec

    def act(self, sel, note="", kind="click"):
        rec = self._prep(sel, note)
        rec["kind"] = kind
        loc = self.page.locator(sel).first
        if rec["occluded"]:
            # 가린 요소가 있으면 실제 학생도 못 누른다. 막힘으로 남기고 강제로 누른다.
            self.stuck.append({"scene": self.cur, "sel": sel, "why": f"가림: {rec['occluded']}", "note": note})
            loc.dispatch_event("click")
        elif self.touch:
            loc.tap(timeout=15000)
        else:
            loc.click(timeout=15000)
        self.steps.append(rec)
        self.page.wait_for_timeout(250)

    def shot(self, tag):
        """장면 중간 화면(서랍·카드가 열린 상태)을 남긴다."""
        self.page.screenshot(path=str(self.out / f"{self.cfg}-{self.cur}-{tag}.png"))

    def view(self, sel, note=""):
        """누르지 않고 읽기만 하는 대상: 화면 안에 들어오게 하는 데 스크롤이 필요한지만 잰다."""
        rec = self._prep(sel, note)
        rec["kind"] = "view"
        rec["small"] = False
        self.steps.append(rec)

    def select(self, sel, value, note=""):
        rec = self._prep(sel, note)
        rec["kind"] = "select"
        self.page.locator(sel).first.select_option(value)
        self.steps.append(rec)

    def fill(self, sel, text, note=""):
        rec = self._prep(sel, note)
        rec["kind"] = "fill"
        loc = self.page.locator(sel).first
        if self.touch:
            loc.tap()
        loc.fill(text)
        self.steps.append(rec)

    def tile(self, i, note=""):
        p = self.page.evaluate(TILE_XY_JS, i)
        if not p:
            self.stuck.append({"scene": self.cur, "sel": f"tile {i}", "why": "칸이 화면 밖/가림", "note": note})
            return False
        if self.touch:
            self.page.touchscreen.tap(p[0], p[1])
        else:
            self.page.mouse.move(p[0], p[1], steps=4)
            self.page.mouse.click(p[0], p[1])
        self.steps.append({"scene": self.cur, "sel": f"tile {i}", "kind": "tap" if self.touch else "click",
                           "note": note, "scrolled": False, "occluded": None, "small": False})
        self.page.wait_for_timeout(300)
        return True

    def visible(self, sel):
        loc = self.page.locator(sel)
        return loc.count() > 0 and loc.first.is_visible()


def builds(page, kind):
    return page.evaluate("k => KCP.buildGame.current().builds.filter(b=>b.t===k).length", kind)


def month_one(r):
    page = r.page
    # 로비
    r.scene("L-lobby")
    page.goto(r.base + "#league")
    page.wait_for_selector(".lg-modes [data-mode='solo']")
    page.wait_for_timeout(800)
    if page.locator(".lg-modes [data-mode='solo']").get_attribute("aria-pressed") != "true":
        r.act(".lg-modes [data-mode='solo']", "혼자 하기 탭")
    if getattr(r, "city", None):
        # 기준선(옛 기본 도시)과 같은 조건으로 비교할 때만 도시를 고른다. 고르기도 행동 하나로 센다.
        r.select("#lg-solo-city", r.city, "내 도시 고르기")
    r.act("#lg-solo-start", "혼자 시작")
    page.wait_for_selector("#lg-bar", timeout=60000)
    page.wait_for_timeout(1500)

    # S1 근거 하나: 첫 달 안내를 닫고 사건을 본다.
    r.scene("S1")
    r.coach = r.visible("#lg-coach")
    if r.visible("#lg-coach-close"):
        r.shot("coach")
        r.act("#lg-coach-close", "첫 달 안내 닫기")
    elif r.visible("#lg-guide-close"):
        r.act("#lg-guide-close", "첫 달 안내 닫기")
    r.act('#lg-bar [data-panel="deal"]', "사건 서랍 열기")
    page.wait_for_selector("#lg-panel", state="visible")
    page.wait_for_timeout(400)
    r.shot("drawer")
    resp = page.locator('.lg-evopt[data-resp]:visible:enabled')
    if resp.count():
        rid = resp.first.get_attribute("data-resp")
        r.act(f'.lg-evopt[data-resp="{rid}"]', "사건 대응 고르기")
    if r.visible(".lg-px"):
        r.act(".lg-px", "서랍 닫기")

    # S2 자리 판단: 태양광 한 기를 놓는다(민원 렌즈 확인 포함).
    r.scene("S2")
    if not r.visible('[data-tool="solar"]'):
        r.act('[data-group="ren"]', "재생 묶음 열기")
    r.act('[data-tool="solar"]', "태양광 고르기")
    r.shot("tool")
    if r.visible('[data-lens="complaints"]'):
        r.act('[data-lens="complaints"]', "민원 렌즈")
    before = builds(page, "solar")
    taps = 0
    for i in page.evaluate(CAND_JS, "solar")[:6]:
        if not r.tile(i, "칸 누르기"):
            continue
        taps += 1
        if builds(page, "solar") > before:
            break
        # 터치: 첫 탭 미리보기, 둘째 탭 설치.
        if r.touch and r.tile(i, "같은 칸 다시 눌러 설치"):
            taps += 1
            if builds(page, "solar") > before:
                break
        if r.visible("#bd-cf-ok"):
            r.act("#bd-cf-ok", "설치 확인")
            if builds(page, "solar") > before:
                break
    if builds(page, "solar") == before:
        r.stuck.append({"scene": "S2", "sel": "solar", "why": "태양광 설치 실패", "note": f"칸 누름 {taps}"})
    page.keyboard.press("Escape") if not r.touch else None

    # S3 1주 시험
    r.scene("S3")
    r.act('[data-run="7"]', "시험 1주")
    page.wait_for_selector("#bd-skip, #bd-again", state="visible", timeout=90000)
    if r.visible("#bd-skip"):
        r.act("#bd-skip", "재생 건너뛰기")
    page.wait_for_selector("#bd-again", state="visible", timeout=90000)
    page.wait_for_timeout(500)
    r.shot("report")
    if r.visible("#bd-drawer-x"):
        r.act("#bd-drawer-x", "성적표 닫기")

    # S4 약속
    r.scene("S4")
    r.act("#lg-ready", "준비")
    if r.visible("#lg-issue-check"):
        # 품질8 UX U3: 전선 미연결·돌 설비 없음이면 준비 전 확인이 한 번 뜬다. 학생도 겪는 단계라 행동으로 센다.
        r.shot("issue-check")
        r.act("#lg-issue-go", "그대로 진행")
    page.wait_for_selector("#lg-ready-confirm", state="visible", timeout=30000)
    ev = page.locator("[data-evidence]:visible").first.get_attribute("data-evidence")
    r.act(f'[data-evidence="{ev}"]', "근거 하나")
    r.select("#lg-predict [data-pred]", "down", "방향")
    r.act('[data-confidence="fairly"]', "확신")
    r.shot("promise")
    before_state = page.evaluate(STATE_JS)
    r.act("#lg-ready-confirm", "약속하고 준비")

    # S5 준비·운영 → 결과
    r.scene("S5")
    page.wait_for_function("s => {const L=KCP.league.state(),S=L.S||L.snap;return S && (S.results||[]).length > s.results;}",
                           arg=before_state, timeout=180000)
    page.wait_for_timeout(1500)

    # S6 예측 대 실제
    r.scene("S6")
    # 폰에서는 재생 동안 결과 서랍이 접혀 있다(U10). 학생처럼 재생이 끝나 펼쳐지기를 기다린다.
    try:
        page.wait_for_function("() => document.getElementById('lg-panel')?.dataset.folded !== 'true'", timeout=8000)
    except Exception:
        pass
    # 상세(#lg-promise-result)는 '이번 달 자세히' 접힘 안이다. 결과 서랍이 열렸는지는 판정 줄로 본다.
    if not r.visible("#lg-promise-summary"):
        r.act('#lg-bar [data-panel="result"]', "결과 서랍 열기")
    page.wait_for_selector("#lg-promise-summary", timeout=30000)
    r.shot("top")
    # S6 판정은 결과 서랍 맨 위 판정 줄(#lg-promise-summary, 품질8 UX ①). 상세(#lg-promise-result)는 '예측 자세히'의 보조 정보.
    r.view("#lg-promise-summary" if r.visible("#lg-promise-summary") else "#lg-promise-result", "약속 판정 보기")

    # S7 원인 하나
    r.scene("S7")
    if page.locator("#lg-outage-cards [data-missed]").count():
        key = page.locator("#lg-outage-cards [data-missed]").first.get_attribute("data-missed")
        r.act(f'#lg-outage-cards [data-missed="{key}"]', "원인 카드 고르기")
        r.act("#lg-outage-open", "열기")
        r.shot("opened")
    elif page.locator("#lg-outage-single").count():
        r.view("#lg-outage-single", "한 줄 요약 보기")

    # S8 다음 달에 바꿀 것
    r.scene("S8")
    if page.locator("[data-compared]").count():
        r.act("[data-compared]", "비교했어요 표시")
    r.shot("ask")
    r.act('[data-answer="keep"]', "유지")
    r.fill('[data-note="askReason"]', "정전이 남아 다음 달 시험에서 배터리를 확인하겠다", "이유 쓰기")
    # 혼자 하기의 '다음 달'은 준비 단추(#lg-ready)의 글자가 바뀐 것이다.
    r.act("#lg-ready", "다음 달")
    page.wait_for_function("() => {const L=KCP.league.state(),S=L.S||L.snap;return S && S.round===2 && S.phase==='plan';}",
                           timeout=120000)
    r.scene("M2-start")
    page.wait_for_timeout(800)
    r.end_scene()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--cfg", default="desktop", choices=list(CFG))
    ap.add_argument("--out", default="tests/results/ux")
    ap.add_argument("--city", default=None, help="혼자 하기 도시 id(생략하면 로비 기본값)")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(**CFG[a.cfg], color_scheme="light", locale="ko-KR")
        page = ctx.new_page()
        page.set_default_timeout(30000)
        page.on("console", lambda m: problems.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        page.on("dialog", lambda d: d.accept())
        r = Run(page, a.cfg, out)
        r.base = a.base
        r.city = a.city
        t0 = time.monotonic()
        err = None
        try:
            month_one(r)
        except Exception as exc:  # 막힌 지점을 결과에 남기고 끝낸다.
            err = f"{type(exc).__name__}: {str(exc).splitlines()[0][:300]}"
            try:
                r.end_scene()
            except Exception:
                pass
        total = round(time.monotonic() - t0, 1)
        browser.close()
    acts = [s for s in r.steps if s["kind"] != "view"]
    summary = {"cfg": a.cfg, "city": a.city or "기본", "completed": err is None, "error": err, "totalSec": total,
               "actions": len(acts), "scrolls": sum(bool(s.get("scrolled")) for s in r.steps),
               "occluded": sum(bool(s.get("occluded")) for s in acts),
               "smallTargets": sum(bool(s.get("small")) for s in acts),
               "stuck": r.stuck, "console": problems[:20], "scenes": r.scenes, "steps": r.steps}
    (out / f"ux-task-{a.cfg}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    # console은 tests/ci/judge.py가 콘솔 error·warning·페이지 오류를 판정하는 근거다(이 검사는 늘 0으로 끝난다).
    print(json.dumps({k: summary[k] for k in ("cfg", "completed", "error", "totalSec", "actions",
                                              "scrolls", "occluded", "smallTargets", "console")}, ensure_ascii=False))
    for s in r.scenes:
        print(f" {s['scene']:9} {s['sec']:6}s 행동 {s['actions']:2} 스크롤 {s['scrolls']} 조작 {s['controls']:3} "
              f"작은조작 {s['smallCount']:2} 글자 {s['chars']:5} 넘침 {s['overflowX']} 가림 {s['occluded']}")
    for s in r.stuck:
        print(" 막힘:", s)


if __name__ == "__main__":
    main()
