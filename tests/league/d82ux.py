"""D-82 결정 1·화면 지시서 및 결정 2·5차 영상 N2/S8/CO₂ 머리 칩 수용 검사.

실행 담당: 샌드박스 밖 로컬. 이 파일은 작성 중 실행하지 않는다.
  tests/.venv/bin/python tests/league/d82ux.py http://127.0.0.1:9430/index.html
N3 빈 마지막 달은 d82ux-node.js에서 실제 decisionsHTML을 별도 검사한다.
화면 건너뛰기도 자동 월 기록을 남기므로 빈 기록을 브라우저에 주입하지 않는다.
evaluate는 공개 상태/시험/계획/DOM 조회만 한다. 운영·저장·계획 주입 없음.
기대값은 Python 달력과 원시 공개 값으로 계산한다(uiMath 호출 없음).
"""

from league_flow import finish_trial
import calendar
import math
import re
import sys

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, Checks, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow, screenshot, shown)
from fx_end import dismiss_guide, prepare
from fx_map import tool
from league_flow import pass_issue_check, select_mode, start_solo, wait_unfolded
from solo import click_next, close_drawer, read

NUMBER = r"[+−-]?\s*\d[\d,]*(?:\.\d+)?"
PER_DAY = rf"{NUMBER} MWh/일(?: 미만)?"
# rev12 Q5 A1: 일반 span은 aria-label 없이 보이는 글자 뒤 숨김 글자로 이름을 잇는다.
TITLE = "CO₂ 시험·소비, 시험 운전 소비 배출(계통 포함)"


def require(checks, condition, label):
    if not checks.ok(condition, label):
        raise AssertionError(label)


def value(token):
    return float(re.sub(r"\s|,", "", token).replace("−", "-"))


def near(token, expected, digits):
    return math.isfinite(expected) and abs(value(token) - expected) <= .5 * 10 ** -digits + 1e-7


def per_day_near(token, expected, digits=1):
    # 10-21 후속: 0 이상 0.05 미만은 숫자 0 대신 상한 문구. 나머지는 기존 1자리 허용폭 그대로.
    return token == "0.1 MWh/일 미만" if 0 <= expected < .05 else (
        token.endswith(" MWh/일") and near(token.removesuffix(" MWh/일"), expected, digits))


def capture(checks, page, label):
    overflow(checks, page, label)
    screenshot(checks, page, f"d82ux-{label}.png")


def close_map_drawers(page):
    close_drawer(page)
    if shown(page, "#bd-drawer-x"):
        page.locator("#bd-drawer-x").click()


def month_days(result):
    return calendar.monthrange(result["year"], result["month"])[1]


def chip(checks, page, label):
    label_node = page.locator('[data-cap="co2"] .v2-cap-k')
    require(checks, label_node.count() == 1, label + " CO₂ 칩 한 개")
    visible_text = label_node.evaluate("""e => [...e.childNodes]
      .filter(n => !(n.nodeType === 1 && n.classList.contains('bd-sr')))
      .map(n => n.textContent).join('').trim()""")
    checks.ok(visible_text == "CO₂ 시험·소비" and
              label_node.get_attribute("title") == TITLE and
              label_node.get_attribute("aria-label") is None,
              label + " CO₂ 보이는 글자·title A1·일반 span aria-label 없음")
    name = label_node.evaluate("e => e.textContent.trim().replace(/\\s+/g, ' ')")
    checks.ok(name == TITLE and name.startswith(visible_text),
              label + " CO₂ 접근 이름 A1·보이는 글자로 시작")
    checks.ok(label_node.evaluate("""el => {
      const cap=el.closest('[data-cap]'), box=cap.getBoundingClientRect();
      const rects=[...el.childNodes].filter(n=>!(n.nodeType===1 && n.classList.contains('bd-sr')))
        .flatMap(n=>{const range=document.createRange();range.selectNode(n);return [...range.getClientRects()];});
      return rects.length>0 && rects.every(r=>r.left>=box.left-.5 &&
        r.right<=box.right+.5 && r.top>=box.top-.5 && r.bottom<=box.bottom+.5 &&
        r.left>=0 && r.right<=innerWidth);
    }"""), label + " 칩 글자 전체가 칩·화면 안에 표시")


def start(page, base):
    page.goto(base + "#league")
    page.wait_for_function(BOOT_JS)
    # D80B의 고정 씨앗·정상 연결 배치를 재사용하되 배치 변경은 모두 화면 조작한다.
    select_mode(page, "solo")
    page.locator("#lg-solo .lg-extra-settings > summary").click()
    page.locator("#lg-solo-seed").select_option("fixed")
    start_solo(page, months=12)
    dismiss_guide(page)
    wait_unfolded(page)


def point(page, tile):
    return page.evaluate("""i => new Promise(resolve=>requestAnimationFrame(()=>
      requestAnimationFrame(()=>{
        const B=KCP.buildGame, t=B.TILES[i], [x,y]=B.tileXY(t.c,t.r);
        const r=document.querySelector('#bd-canvas').getBoundingClientRect();
        resolve([x+r.left,y+r.top]);
      })))""", tile)


def click_tile(page, tile):
    # 390에서도 가려진 칸은 실제 지도 드래그로 옮겨 누른다. 좌표·DOM만 조회한다.
    for _ in range(4):
        x, y = point(page, tile)
        if page.evaluate("([x,y])=>document.elementFromPoint(x,y)?.id==='bd-canvas'", [x, y]):
            page.mouse.click(x, y)
            page.mouse.move(0, 0)
            return
        safe = page.evaluate("""() => {
          for(const fy of [.5,.4,.6,.3,.7]) for(const fx of [.5,.4,.6]) {
            const x=innerWidth*fx,y=innerHeight*fy;
            if(document.elementFromPoint(x,y)?.id==='bd-canvas') return [x,y];
          }
          return null;
        }""")
        if safe is None:
            raise AssertionError("지도 드래그 시작점이 보이지 않음")
        sx, sy = safe
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(sx + sx - x, sy + sy - y, steps=8)
        page.mouse.up()
    raise AssertionError(f"지도 칸 {tile}을 화면 조작으로 드러내지 못함")


def connect(page, start_tile, end_tile):
    tool(page, "line")
    old = page.evaluate("() => KCP.buildGame.current().lines.length")
    click_tile(page, start_tile)
    click_tile(page, end_tile)
    page.locator("#bd-cf-ok").click()
    page.wait_for_function("old => KCP.buildGame.current().lines.length===old+1", arg=old)


def normal_connections(page):
    close_map_drawers(page)
    edges = page.evaluate("""() => {
      const id=KCP.league.state().team;
      return KCP.ECON_DATA.normalStartPlans[id].lines.map(l=>[l.p[0],l.p.at(-1)]);
    }""")
    for a, b in edges:
        connect(page, a, b)


def add_diesel(page):
    close_map_drawers(page)
    tile, neighbor = page.evaluate("""() => {
      const B=KCP.buildGame, st=B.current(), connected=new Set(st.lines.flatMap(l=>l.p));
      const t=B.TILES.find(t=>!t.out && t.site<0 && !B.siteRule('diesel',t) &&
        !st.builds.some(b=>b.i===t.i) && t.nb.some(i=>connected.has(i)));
      if(!t) throw Error('연결 디젤을 놓을 합법적 칸 없음');
      return [t.i,t.nb.find(i=>connected.has(i))];
    }""")
    old = page.evaluate("() => KCP.buildGame.current().builds.length")
    tool(page, "diesel")
    click_tile(page, tile)
    page.wait_for_function("old => KCP.buildGame.current().builds.length===old+1", arg=old)
    connect(page, neighbor, tile)


def trial(checks, page, label):
    close_map_drawers(page)
    page.locator('[data-run="7"]').click()
    finish_trial(page)
    tested = page.evaluate("() => KCP.buildGame.lastTrial()")
    require(checks, tested is not None and tested["days"] == 7, label + " 실제 7일 시험")
    chip(checks, page, label)
    overflow(checks, page, label + " 성적표")
    return tested


def trial_report(checks, page, tested, label):
    days = month_days(tested)
    # D-82 결정 1·화면 지시서: 달력 일수·원시험으로 일평균과 보조 월 합계를 각각 검산.
    per_day = tested["gridMWh"] / tested["days"]
    monthly = per_day * days
    line = page.locator("#bd-league-goals p").filter(has_text="바깥 계통이 메워 준 전기").inner_text()
    match = re.search(rf"전기 시험 {tested['days']}일 ({NUMBER}) MWh → 하루 평균 ({PER_DAY})\(이번 달 {days}일이면 약 ({NUMBER}) MWh · 비용 약 ({NUMBER})억", line)
    require(checks, bool(match), label + " S3 계통 시험·하루 평균·보조 월 합계·비용 형식")
    price = page.evaluate("() => KCP.ECON_DATA.params.normalCost.v*KCP.ECON_DATA.params.gridImportMarkup.v")
    checks.ok(near(match[1], tested["gridMWh"], 1) and per_day_near(match[2], per_day) and
              near(match[3], monthly, 1) and near(match[4], monthly * price, 2) and line.count("비용") == 1,
              label + " S3 계통 MWh/일·월 환산 비용 독립 검산(7일 비용 혼용 없음)")
    explanation = page.locator("#bd-league-goals p").filter(has_text="머리 칩").inner_text()
    co2 = re.search(rf"7일 시험 약 ({NUMBER}) t", explanation)
    factor = page.evaluate("() => KCP.ECON_DATA.params.normalCo2.v")
    # rev11 R5·총괄 결정: 생산 배출 설명과 통일한 머리 칩 소비 이름을 확인한다.
    checks.ok("생산 배출" in explanation and "CO₂ 소비(계통 포함)" in explanation and
              "바깥 계통에서 받은 전기" in explanation and bool(co2) and
              near(co2[1], tested["gridMWh"] * factor, 0),
              label + " 생산/소비 CO₂ 차이 = 실제 계통 MWh × 기존 normalCo2")
    return match[2], per_day  # D-82 결정 1·화면 지시서: S4와 비교할 값은 하루 평균.


def promise(checks, page, topic, label, baseline=None):
    close_map_drawers(page)
    state = read(page)["S"]
    page.locator("#lg-ready").click()
    pass_issue_check(page)
    page.wait_for_selector("#lg-ready-confirm")
    require(checks, shown(page, f'[data-pred="{topic}"]'), label + f" S4 {topic} 주제")
    if topic == "grid":
        # D-82 결정 1·화면 지시서: 390px도 하루 평균·월 보조 정보를 말줄임 없이 표시한다(로컬 실행).
        checks.ok(page.locator("#lg-promise-baseline").evaluate("""el => {
          const s=getComputedStyle(el);
          return s.whiteSpace==='normal' && el.scrollWidth<=el.clientWidth+1 && el.scrollHeight<=el.clientHeight+1;
        }"""), label + " S4 계통 기준 전체 줄바꿈·가로 넘침 없음")
    if baseline:
        token, per_day = baseline  # D-82 결정 1·화면 지시서: 성적표와 같은 일평균.
        line = page.locator("#lg-promise-baseline").inner_text()
        match = re.search(rf"시험 1주 대비 · 하루 평균 ({PER_DAY})", line)
        checks.ok(bool(match) and per_day_near(match[1], per_day) and match[1] == token,
                  label + " S4 비교 기준 MWh/일 = 독립 하루 평균 = S3 표시")
    page.locator('[data-evidence="grid"]').click()
    page.locator(f'[data-pred="{topic}"]').select_option("same")
    page.locator('[data-confidence="fairly"]').click()
    capture(checks, page, label + "-S4")
    page.locator("#lg-ready-confirm").click()
    page.wait_for_function("r => {const S=KCP.league.state().S; return S.round===r && S.phase==='review';}", arg=state["round"])
    wait_unfolded(page)


def result(checks, page, tested, label, grid=True):
    state = read(page)
    S, player = state["S"], state["player"]
    current = S["results"][-1]
    open_panel(page, "result")
    r = current["team"][player]
    previous = next((x for x in S["results"] if x["round"] == current["round"] - 1), None)
    basis = ("시험 1주 대비" if tested["days"] == 7 else f"시험 {tested['days']}일 대비") if tested else "시험 1주 대비"
    # spec-C §M1: 정전·현금 주제도 생산 CO₂와 Δ는 하루 평균 t/일, 월 합계는 보조다.
    # rev11 R5: 생산 표지의 접두 순서 통일, 하루 평균/월 합계 검산 유지.
    prod = page.locator("#lg-result-deltas > div").filter(has_text="CO₂ 생산(이번 달)")
    prod_total = r["co2Prod"] * month_days(current) / current["days"]
    prod_value, prod_change = prod.locator("dd").inner_text(), prod.locator("small").inner_text()
    m = re.fullmatch(rf"({NUMBER}) t/일", prod_value)
    checks.ok(bool(m) and near(m[1], r["co2Prod"] / current["days"], 1),
              label + " S6 생산 CO₂ 하루 평균 먼저(모든 주제)")
    if previous:
        old_per_day = previous["team"][player]["co2Prod"] / previous["days"]
        m = re.fullmatch(rf"지난달 대비 Δ ({NUMBER}) t/일\(이번 달 합 ({NUMBER}) t\)", prod_change)
        checks.ok(bool(m) and near(m[1], r["co2Prod"] / current["days"] - old_per_day, 1) and
                  near(m[2], prod_total, 0) and (value(m[1]) == 0 or m[1].lstrip().startswith(("+", "−", "-"))),
                  label + " S6 생산 CO₂ Δ t/일·월 합계 독립 검산(모든 주제)")
    elif tested and "co2Prod" in tested:
        m = re.fullmatch(rf"{basis} Δ ({NUMBER}) t/일\(이번 달 합 ({NUMBER}) t\)", prod_change)
        checks.ok(bool(m) and near(m[1], r["co2Prod"] / current["days"] - tested["co2Prod"] / tested["days"], 1) and
                  near(m[2], prod_total, 0), label + " S6 첫 달 시험 생산 CO₂ 하루 평균 비교·월 합계")
    else:
        m = re.fullmatch(rf"{basis} Δ 비교 없음\(시험 기록 없음\) · 이번 달 합 ({NUMBER}) t", prod_change)
        checks.ok(bool(m) and near(m[1], prod_total, 0), label + " S6 시험 생산 CO₂ 기록 없으면 비교 없음·월 합계")
    node = page.locator("#lg-s6-co2cons")
    # rev16 #72-1·3: 소비 CO₂는 예측 자세히 안. 펼친 뒤 내용·순서를 검산한다.
    if not node.is_visible() and shown(page, '[data-promise-details]'):
        page.locator('[data-promise-details]').click()
    # rev9 R9(명세 rev9-fix/spec.md): 소비 CO₂ 하루 평균 줄은 정전·현금 주제 달에도 보인다. 아래 계통 전용 검산은 계통 주제만.
    if not grid:
        checks.ok(node.count() == 1 and node.is_visible(), label + " 정전 주제 S6 소비 CO₂ 줄 표시(rev9 R9)")
        capture(checks, page, label + "-uns-S6")
        return
    require(checks, node.count() == 1 and node.is_visible(), label + " S6 소비 CO₂ 줄 표시")
    checks.ok(node.evaluate("""el => {const s=el.closest('#lg-promise-result'),v=s?.querySelector('[data-compare]');
      return !!v && !!el.closest('details[open]') && !!(v.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING); }"""),
        label + " S6 예측 자세히 섹션 안 판정 줄 뒤 소비 CO₂")
    node.scroll_into_view_if_needed()
    checks.ok(node.evaluate("""el => {
      const r=el.getBoundingClientRect(), p=el.closest('.lg-pbody').getBoundingClientRect();
      return r.top>=p.top-.5 && r.bottom<=Math.min(innerHeight,p.bottom)+.5;
    }"""), label + " S6 펼친 상세에서 CO₂ 줄 전체 보임")
    # D-82 결정 1·화면 지시서: 소비 CO₂·계통 칩도 하루 평균 먼저, 월 합계는 보조.
    total = r["co2Cons"] * month_days(current) / current["days"]
    per_day = total / month_days(current)
    if previous:
        base = previous["team"][player]["co2Cons"] * month_days(previous) / previous["days"] / month_days(previous)
        baseline_name = "지난달 대비"
    else:
        base = tested["co2"] / tested["days"]
        baseline_name = "시험 1주 대비"
    line = node.inner_text()
    # rev11 R5: 같은 소비 개념의 명세 표기, 숫자/단위/기준은 그대로 검사.
    match = re.search(rf"CO₂ 소비\(계통 포함\) 하루 평균 ({NUMBER}) t/일 · {baseline_name} Δ ({NUMBER}) t/일\(이번 달 합 ({NUMBER}) t\)", line)
    require(checks, bool(match), label + " S6 소비 CO₂·기준·Δ 형식")
    checks.ok(near(match[1], per_day, 1) and near(match[2], per_day - base, 1) and near(match[3], total, 0) and
              (value(match[2]) == 0 or match[2].lstrip().startswith(("+", "−", "-"))),
              label + " S6 소비 CO₂ 하루 평균·Δ·보조 월 합계 독립 검산(부호·표시 자릿수)")
    checks.ok("계통에서 끌어온 전기도 우리 도시 소비 배출에 들어가요." in line,
              label + " S6 계통 수입과 소비 배출 연결")
    isolated = r["isolated"]["uns"]
    grid_per_day = max(0, isolated - r["uns"] - r["imp"] + r["sub"]) / current["days"]
    # rev17 #55: S8 기준은 이전 실제 하루 평균, 첫 달은 약속 때 시험값. 계획·시험 표시는 기존 1자리.
    if previous:
        old = previous["team"][player]
        grid_base = max(0, old["isolated"]["uns"] - old["uns"] - old["imp"] + old["sub"]) / previous["days"]
    else:
        grid_base = tested["gridMWh"] / tested["days"]
    shown_digits = 2 if grid_base < 2 else 1
    buttons = page.locator(".lg-reason-starts").first.locator("[data-reason-start]")
    starts = buttons.all_text_contents()
    m = re.search(rf"이번 달 계통이 메운 전기가 평균 ({PER_DAY})이어서", starts[0] if starts else "")  # 총괄 10-23 아르곤 문구(UX 갈래)
    checks.ok(len(starts) == 3 and bool(m) and per_day_near(m[1], grid_per_day, shown_digits) and
              starts[1] == "다음 달 시험에서 계통이 메운 전기가 줄어드는지 확인하고 " and
              starts[2].startswith("남은 돈(빚 한도 포함) ") and not any("정전" in x for x in starts),  # rev9 R14 K10b
              label + " S8 계통 하루 평균 칩·확인 칩·현금 칩(정전 0% 없음)")
    # 칩은 클릭할 때 textarea에 같은 문장을 넣는 실제 사용자 조작도 확인한다.
    buttons.nth(0).click()
    checks.ok(page.locator('[data-note="askReason"]').input_value().startswith(starts[0]),
              label + " S8 계통 칩 클릭이 이유 입력에 반영")
    capture(checks, page, label + "-grid-S6-S8")


def play_grid(checks, page, base, label):
    start(page, base)
    normal_connections(page)
    # D80B zero_plan과 같은 '정상 연결 + 디젤 추가' 탐색. 예산/시험/결과는 덮어쓰지 않는다.
    tested = None
    for count in range(13):
        tested = trial(checks, page, f"{label}-jan-{count}")
        if tested["unsPct"] < .005:
            break
        if count < 12:
            add_diesel(page)
    require(checks, tested["unsPct"] < .005, label + " 화면 배치로 1월 시험 정전 0 확보")
    baseline = trial_report(checks, page, tested, label)
    capture(checks, page, label + "-jan-S3")
    promise(checks, page, "grid", label + "-jan", baseline)
    result(checks, page, tested, label + "-jan")
    state = read(page)["S"]
    require(checks, state["results"][-1]["team"][read(page)["player"]]["unsPct"] < .005,
            label + " 1월 실제 정전 0 → 다음 계획 계통 주제 경로")
    click_next(page, state)
    wait_unfolded(page)
    promise(checks, page, "grid", label + "-feb")
    result(checks, page, None, label + "-feb")
    # 실제 12달 완주와 끝 화면도 검사한다. 3~12월은 기존 prepare의 화면 건너뛰기 경로.
    for _ in range(24):
        state = read(page)["S"]
        if state["phase"] == "end":
            break
        wait_unfolded(page)
        if state["phase"] == "plan":
            prepare(page)
            page.wait_for_function("() => KCP.league.state().S.phase==='review'")
        else:
            click_next(page, state)
        overflow(checks, page, label + f" {state['round']}월 {state['phase']}")
    state = read(page)["S"]
    require(checks, state["phase"] == "end" and len(state["results"]) == 12,
            label + " 화면 조작으로 12달 완주")
    open_panel(page, "result")
    checks.ok(page.locator("#lg-decisions > ul > li[data-decision-month]").count() > 0,
              label + " 끝 화면 첫 목록에 내용 있는 결정 기록 표시")
    capture(checks, page, label + "-end")


def play_uns(checks, page, base, label):
    start(page, base)
    promise(checks, page, "uns", label + "-uns")
    result(checks, page, None, label, grid=False)


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for width, height in ((1280, 900), (390, 844)):
                    for mode, play in (("grid", play_grid), ("uns", play_uns)):
                        label = f"{width}x{height}-{mode}"
                        context, external = context_for(browser, base, width, height, "light")
                        page, events = monitored_page(context)
                        try:
                            play(checks, page, base, label)
                        except Exception as exc:
                            checks.ok(False, f"{label} {type(exc).__name__}: {str(exc).splitlines()[0][:240]}")
                            screenshot(checks, page, f"d82ux-{label}-failure.png")
                        finally:
                            overflow(checks, page, label + " 마지막")
                            diagnostics(checks, events, label)
                            checks.ok(not external, label + f" 외부 연결 시도 0: {external}")
                            context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f"실행 오류 {type(exc).__name__}: {str(exc).splitlines()[0][:240]}")
    return checks.finish()


if __name__ == "__main__":
    sys.exit(main())
