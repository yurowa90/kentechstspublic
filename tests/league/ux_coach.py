"""품질 8 UX U5 확인: 첫 달 코치 띠(#lg-coach)만 따라 혼자 하기 1월을 끝낸다.

코치의 행동 단추(#lg-coach-action)와 강조 대상(.lg-coach-target)만 누른다. 지도 칸은 코치가 고르게 한
도구로 '사람이 고를 만한 칸'(수요지에 가까운 빈 칸)을 누른다. 기록: 단계마다 행동 수, 건너뛰기 없이
8단계에 닿았는지, 1월 실제 정전율(100%가 아니어야 함).

실행: tests/.venv/bin/python tests/league/ux_coach.py <주소> [--cfg desktop|tablet|mobile] [--city id]
"""

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright
from econui import OVERFLOW_JS

sys.path.insert(0, str(Path(__file__).parent))
from ux_task import CFG, TILE_XY_JS  # noqa: E402
from ux_s2fix import reveal_tile  # noqa: E402

STEP_JS = "() => { const c=document.querySelector('#lg-coach'); return c ? Number(c.dataset.step) : 0; }"
# 수요지(마을)에서 가까운 순서로, 지금 도구로 지을 수 있고 화면에 보이는 칸.
NEAR_TOWN_JS = """kind => {
  const B=KCP.buildGame, st=B.current(), used=new Set(st.builds.map(b=>b.i));
  const towns=B.SITES.filter(s=>s.dem).map(s=>B.TILES[s.tile]);
  const d=t=>Math.min(...towns.map(w=>Math.hypot(w.X-t.X,w.Y-t.Y)));
  return B.TILES.filter(t=>!t.out && t.site<0 && !used.has(t.i) && !B.siteRule(kind,t) && (()=>{
    const p=B.tileXY(t.c,t.r); return p && document.elementFromPoint(p[0],p[1])?.tagName==='CANVAS';})())
    .sort((a,b)=>d(a)-d(b)).slice(0,6).map(t=>t.i);
}"""
# 전선에 안 닿은 설비에서 가장 가까운 마을까지 두 끝점.
LINE_ENDS_JS = """() => {
  const B=KCP.buildGame, st=B.current(), iss=B.planIssues();
  const b=iss.unlinked[0]; if(!b) return null;
  const T=B.TILES[b.i]; const towns=B.SITES.filter(s=>s.dem);
  const w=towns.map(s=>B.TILES[s.tile]).sort((x,y)=>Math.hypot(x.X-T.X,x.Y-T.Y)-Math.hypot(y.X-T.X,y.Y-T.Y))[0];
  return [b.i, w.i];
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--cfg", default="desktop", choices=list(CFG))
    ap.add_argument("--city", default=None)
    ap.add_argument("--out", default="tests/results/ux")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    log, problems, actions = [], [], {}
    pans = 0
    touch = CFG[a.cfg].get("has_touch", False)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(**CFG[a.cfg], color_scheme="light", locale="ko-KR")
        page = ctx.new_page()
        page.set_default_timeout(30000)
        page.on("console", lambda m: problems.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        page.on("dialog", lambda d: d.accept())

        def press(sel, step):
            loc = page.locator(sel).first
            loc.scroll_into_view_if_needed()
            (loc.tap if touch else loc.click)()
            actions[step] = actions.get(step, 0) + 1
            page.wait_for_timeout(350)

        def tile(i, step):
            nonlocal pans
            if step == 3 and page.evaluate(TILE_XY_JS, i) is None:
                # M2: 자동 확대 뒤 다른 끝점이 가려졌으면 터치 pointer 드래그로 드러낸다.
                def count_pan():
                    nonlocal pans
                    pans += 1
                    actions[step] = actions.get(step, 0) + 1
                reveal_tile(page, touch, i, count_pan)
            xy = page.evaluate(TILE_XY_JS, i)
            if not xy:
                return False
            (page.touchscreen.tap if touch else page.mouse.click)(*xy)
            actions[step] = actions.get(step, 0) + 1
            page.wait_for_timeout(300)
            return True

        page.goto(a.base + "#league")
        page.wait_for_selector(".lg-modes [data-mode='solo']")
        page.wait_for_timeout(800)
        page.click(".lg-modes [data-mode='solo']")
        if a.city:
            page.select_option("#lg-solo-city", a.city)
        page.click("#lg-solo-start")
        page.wait_for_selector("#lg-coach", timeout=60000)
        page.wait_for_timeout(1200)
        reached, skipped, err = 0, 0, None
        try:
            for _ in range(60):
                # 같은 갱신 틱의 단계/문구를 함께 읽어 자동 전진과 Python 왕복이 경합하지 않게 한다.
                frame = page.evaluate("""() => {
                  const c=document.querySelector('#lg-coach');
                  return {step:c ? Number(c.dataset.step) : 0,
                    task:c?.querySelector('#lg-coach-task')?.textContent || ''};
                }""")
                step = frame['step']
                if not step:
                    break
                reached = max(reached, step)
                log.append(frame)
                # 지시서 T F4: 학생에게 보이는 장면 이름은 고정 계약이다.
                scenes = ('근거 하나', '자리 판단', '자리 판단', '시험 1주', '약속',
                          '예측 대 실제', '원인 하나', '다음 달')
                assert log[-1]['task'].startswith(f'{scenes[step-1]} · {step}/8 '), log[-1]
                assert page.evaluate(OVERFLOW_JS) <= 0, '코치 장면 가로 스크롤 0'
                if step == 3:
                    issues = page.evaluate("""() => {
                      const B=KCP.buildGame, p=B.planIssues(), b=p.unlinked[0];
                      if(!b) return {count:0, waiting:p.waiting.length};
                      const T=B.TILES[b.i], q=t=>t.c-(t.r-(t.r&1))/2;
                      // M2: odd-r → axial 헥스 거리. 구현의 대상/문구 생성 함수는 쓰지 않는다.
                      const d=t=>Math.max(Math.abs(q(t)-q(T)),Math.abs(t.r-T.r),
                        Math.abs(q(t)-q(T)+t.r-T.r));
                      const town=B.SITES.filter(s=>s.dem).slice().sort((a,z)=>
                        d(B.TILES[a.tile])-d(B.TILES[z.tile]) || a.tile-z.tile)[0];
                      return {count:p.unlinked.length, waiting:p.waiting.length, name:b.name,
                        town:town?.name, existing:!B.current().builds.some(x=>x.i===b.i)};
                    }""")
                    count, waiting = issues['count'], issues['waiting']
                    if count:
                        name, town = issues['name'], issues['town']
                        assert name and town, 'M2 미연결 설비·가장 가까운 수요지 이름 존재'
                        if issues['existing']:
                            # rev11 R3 / REV11_COPY.C3: 기존 설비 미연결 이유와 순서.
                            text = (f"기존 {name}도 전선에 안 닿으면 운영에서 못 써요. {name} 칸, {town} 칸을 차례로 누르고 '연결'을 눌러야 넘어가요.")
                        else:
                            text = f"{name} 칸, {town} 칸을 차례로 누르고 '연결'을 누르세요"
                        if count >= 2:
                            text += f' · 전선 미연결 {count}기'
                        if waiting:
                            text += f' · 대기 {waiting}기'
                    else:
                        text = f'마을까지 이어요 · 미연결 0기 · 대기 {waiting}기'
                    assert log[-1]['task'] == f'자리 판단 · 3/8 {text}', log[-1]
                if step == 2:
                    press("#lg-coach-action", step)
                    tool = page.locator('[data-tool="diesel"]')
                    if tool.count() and tool.first.is_visible():
                        press('[data-tool="diesel"]', step)
                    kind = page.evaluate("() => document.querySelector('#bd-root').dataset.mode")
                    before = page.evaluate("() => KCP.buildGame.current().builds.length")
                    for i in page.evaluate(NEAR_TOWN_JS, kind or "diesel"):
                        tile(i, step)
                        if touch and page.evaluate("() => KCP.buildGame.current().builds.length") == before:
                            tile(i, step)
                        if page.locator("#bd-cf-ok").count() and page.locator("#bd-cf-ok").is_visible():
                            press("#bd-cf-ok", step)
                        if page.evaluate("() => KCP.buildGame.current().builds.length") > before:
                            break
                elif step == 3:
                    press("#lg-coach-action", step)
                    for _ in range(4):
                        ends = page.evaluate(LINE_ENDS_JS)
                        if not ends:
                            break
                        tile(ends[0], step)
                        tile(ends[1], step)
                        if page.locator("#bd-cf-ok").count() and page.locator("#bd-cf-ok").is_visible():
                            press("#bd-cf-ok", step)
                    page.keyboard.press("Escape") if not touch else None
                elif step == 4:
                    press("#lg-coach-action", step)
                    page.wait_for_selector("#bd-skip, #bd-again", state="visible", timeout=90000)
                    if page.locator("#bd-skip").is_visible():
                        press("#bd-skip", step)
                    page.wait_for_selector("#bd-again", state="visible", timeout=90000)
                    page.wait_for_timeout(900)
                elif step == 5:
                    # 명세 B3: 켜진 주 단추와 같은 동작인 코치 행동 단추는 숨긴다.
                    press("#lg-ready", step)
                    if page.locator("#lg-issue-check").count() and page.locator("#lg-issue-check").is_visible():
                        log.append({"issueCheck": page.locator("#lg-issue-check").inner_text()[:300]})
                        press("#lg-issue-go", step)
                    if page.locator("#lg-ready-confirm").count() and page.locator("#lg-ready-confirm").is_visible():
                        press("#lg-predict [data-evidence]", step)
                        page.locator("#lg-predict [data-pred]").first.select_option("down")
                        actions[step] += 1
                        press('[data-confidence="fairly"]', step)
                        press("#lg-ready", step)
                    page.wait_for_function("() => {const L=KCP.league.state(),S=L.S||L.snap;return S && (S.results||[]).length>0;}",
                                           timeout=180000)
                    page.wait_for_timeout(6500)  # 달 넘김 재생(최대 4초)과 서랍 펼침
                    # 명세 B1: 결과 서랍 자동 열림은 학생의 S6 행동이 아니다.
                    assert page.evaluate(STEP_JS) == 6, '결과 자동 열림 뒤 6/8 유지'
                elif step == 6:
                    assert '운영 끝 · 결과 맨 위에서 내 예측과 실제를 비교해요' in frame['task']
                    press("#lg-coach-action", step)
                    page.wait_for_function("() => Number(document.querySelector('#lg-coach')?.dataset.step) === 7")
                elif step == 7:
                    # 명세 B1: 카드 없음/고르기 생략도 직접 확인해야 S8로 간다.
                    no_card = page.locator('#lg-missed[data-opened]').count() == 0 or \
                        page.locator('#lg-missed[data-single="true"]').count() > 0
                    if no_card:
                        assert '원인 카드가 없어요' in frame['task']
                        assert page.locator('#lg-coach-action').inner_text() == '확인하고 다음'
                    else:
                        assert page.locator('#lg-coach-action').inner_text() == '원인 열기'
                        cards = page.locator('#lg-outage-cards [data-missed]')
                        if cards.count():
                            press('#lg-outage-cards [data-missed]', step)
                    press("#lg-coach-action", step)
                    page.wait_for_function("() => Number(document.querySelector('#lg-coach')?.dataset.step) === 8")
                elif step == 8:
                    if page.locator('[data-answer="keep"]').count():
                        press('[data-answer="keep"]', step)
                    field = page.locator('[data-note="askReason"]').first
                    field.scroll_into_view_if_needed()
                    field.fill("시험과 실제 정전을 보고 다음 달 시험에서 다시 확인하겠다")
                    field.press("Tab")
                    actions[step] = actions.get(step, 0) + 1
                    page.wait_for_timeout(1200)
                    break
                else:
                    press("#lg-coach-action", step)
                page.wait_for_timeout(1200)
                if page.evaluate(STEP_JS) == step and step not in (5, 8):
                    # 같은 단계에 머물면 한 번 더 확인 뒤 건너뛴다(막힘으로 기록).
                    page.wait_for_timeout(1200)
                    if page.evaluate(STEP_JS) == step:
                        log.append({"stuck": step})
                        skipped += 1
                        press("#lg-coach-skip", step)
        except Exception as exc:
            err = f"{type(exc).__name__}: {str(exc).splitlines()[0][:300]}"
        page.screenshot(path=str(out / f"coach-{a.cfg}-{a.city or 'default'}-end.png"))
        res = page.evaluate("""() => {const L=KCP.league.state(),S=L.S||L.snap; const r=(S.results||[])[0];
          return {team:L.team, unsPct:r?.team?.[L.team]?.unsPct ?? null, builds:KCP.buildGame.current().builds.map(b=>b.t)};}""")
        browser.close()
    summary = {"cfg": a.cfg, "city": a.city or "기본", "error": err, "reachedStep": reached, "skipped": skipped,
               "actions": actions, "totalActions": sum(actions.values()), "pans": pans,
               "month1": res, "console": problems[:10], "log": log}
    (out / f"ux-coach-{a.cfg}-{a.city or 'default'}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps({k: summary[k] for k in ("cfg", "city", "error", "reachedStep", "skipped", "totalActions", "month1")},
                     ensure_ascii=False))
    for item in log:
        if "stuck" in item or "issueCheck" in item:
            print(" ", item)
    print(" console:", problems[:5])
    # T 검사 규칙: 수집한 단언/페이지 예외·console error/warning을 성공 종료로 숨기지 않는다.
    if err or problems or skipped or reached != 8:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
