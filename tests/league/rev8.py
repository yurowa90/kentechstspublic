"""명세 A1·A3·A5 브라우저 수용 검사. 작성 세션에서는 실행하지 않는다.

샌드박스 밖 로컬 실행 담당자:
  python3 tests/srv.py 9430 .
  tests/.venv/bin/python tests/league/rev8.py http://127.0.0.1:9430/index.html

s7.py·d82ux.py의 loopback 주소/혼자 하기 진입/진단 도구를 재사용한다.
s7.py의 다음 문서 init-script 방식을 사용해 pagehide 저장 뒤 합성 사본을
넣는다. 원본 구현 함수·DOM/CSS를 대체하지 않는다. 기대값은 spec-A만.
상태 생성 실패는 의존 단언을 BLOCKED 실패로 세며 통과로 건너뛰지 않는다.
"""

import sys

from playwright.sync_api import sync_playwright
from econui import (BOOT_JS, Checks, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow, screenshot)
from fx_end import dismiss_guide
from league_flow import select_mode, start_solo, wait_unfolded

# A1: Python 고정 입력에서 기대 문자열을 만든다(UI 포맷 함수 호출 없음).
CASES = (
    {"name": "cash-zero-zero", "cash": 3.20, "after": 1.09, "uns": 0, "grid": 0,
     "topic": "cash", "disabled": False},
    {"name": "cash-negative", "cash": -10.04, "after": -7.81, "uns": 2, "grid": .3,
     "topic": "cash", "disabled": False},
    # A3: 굳힌 주제는 유지한다. 불가능한 감소 선택지는 두 주제 모두 막는다.
    {"name": "fixed-uns-zero", "cash": 3.20, "after": 1.09, "uns": 0, "grid": .3,
     "topic": "uns", "confirmed": True, "disabled": True},
    {"name": "fixed-grid-zero", "cash": 3.20, "after": 1.09, "uns": 0, "grid": 0,
     "topic": "grid", "confirmed": True, "disabled": True},
)

# pagehide가 기존 메모리 사본을 다시 저장한 다음 새 문서에서만 fixture를 적용한다.
INSTALL_FIXTURE = """(() => {
  const key='rev8-fixture-next-document', raw=sessionStorage.getItem(key);
  if (!raw) return;
  localStorage.setItem('kcp-league-solo-v1', raw);
  sessionStorage.removeItem(key);
})();"""

BUILD_FIXTURE = """o => {
  const L=KCP.league.state(), C=KCP.leagueCore, B=KCP.buildGame;
  if (L?.role!=='solo' || !L.S) throw Error('혼자 하기 상태 필요');
  const original=JSON.stringify(L.S), saved=JSON.parse(localStorage.getItem('kcp-league-solo-v1'));
  if (!saved?.state) throw Error('혼자 하기 저장 사본 없음');
  const S=structuredClone(L.S), id=L.team, R=C.regionOf(S.region);
  const pack=C.teamDef(R,id).pack;
  try {
    // 기존 정상 상태에서 엔진으로 1월 결과·2월 계획 골격을 만든다.
    if (S.round!==1 || S.phase!=='plan') throw Error('1월 계획 출발점 필요');
    for (const city of Object.keys(S.teams)) S.teams[city].plan=structuredClone(KCP.ECON_DATA.normalStartPlans[city]);
    S.events=[]; C.run(S,B,0); C.host(S,'next',0); S.events=[];
    const old=S.results.find(r=>r.round===1), row=old?.team[id];
    if (S.round!==2 || S.phase!=='plan' || !row) throw Error('2월 계획 생성 실패');
    // A3: 공개 계통 하루 평균=(isolated.uns-uns-imp+sub)/days.
    row.unsPct=o.uns; row.uns=0; row.imp=0; row.sub=0;
    row.isolated={...row.isolated,uns:o.grid*old.days};
    S.econ.cities[id].cash=o.cash;
    S.teams[id].ready=false;
    const note={evidence:{key:'fuel',text:'LNG 지수',value:100},
      s1EvidenceValues:{evening:100,wind:5,grid:20,fuel:100,neighbor:10},
      pred:{[o.topic]:'down'},confidence:'fairly',confirmed:!!o.confirmed};
    if (o.confirmed) note.topic=o.topic;
    const interview={docs:{},journal:{},freeExperiment:false,
      interview:{months:{1:{},2:note}}};
    const fixture={...saved,state:S,interview,aiRound:2,previous:null};
    sessionStorage.setItem('rev8-fixture-next-document',JSON.stringify(fixture));
    return {round:2,phase:'plan'};
  } finally {
    B.selectPack(pack,'league');
    if (JSON.stringify(L.S)!==original) throw Error('합성 사본 생성이 원본을 바꿈');
  }
}"""

BUILD_REVIEW = """o => {
  const L=KCP.league.state(), C=KCP.leagueCore, B=KCP.buildGame;
  const saved=JSON.parse(localStorage.getItem('kcp-league-solo-v1'));
  if (L?.role!=='solo' || L.S.round!==2 || L.S.phase!=='plan') throw Error('같은 달 S4 상태 필요');
  const S=structuredClone(L.S), id=L.team, R=C.regionOf(S.region);
  const interview=structuredClone(saved.interview), n=interview.interview?.months?.[2];
  if (!n) throw Error('약속 기록 없음');
  n.topic='cash'; n.confirmed=true; n.pred={cash:o.after>o.cash?'up':o.after<o.cash?'down':'same'};
  try {
    C.run(S,B,0);
    if (S.phase!=='review' || !S.econBefore?.[id]) throw Error('S6·운영 전 현금 생성 실패');
    // A1: 같은 달의 운영 전 값과 월말 값을 독립 고정 입력으로 둔다.
    S.econBefore[id].cash=o.cash; S.econ.cities[id].cash=o.after;
    const fixture={...saved,state:S,interview,aiRound:2,previous:null};
    sessionStorage.setItem('rev8-fixture-next-document',JSON.stringify(fixture));
  } finally { B.selectPack(C.teamDef(R,id).pack,'league'); }
}"""

# A5: 실제 텍스트 노드 '!'의 Range 상자로 좌우 여백을 잰다(글꼴 폭 추측 없음).
INFO_MEASURE = r"""el => {
  const box=el.getBoundingClientRect(), style=getComputedStyle(el);
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  let node, glyph=null;
  while ((node=walker.nextNode())) {
    const at=node.textContent.indexOf('!');
    if (at<0) continue;
    const range=document.createRange(); range.setStart(node,at); range.setEnd(node,at+1);
    glyph=range.getBoundingClientRect(); break;
  }
  return {after:getComputedStyle(el,'::after').content,width:box.width,height:box.height,
    text:el.textContent.trim(),circular:[style.borderTopLeftRadius,style.borderTopRightRadius,
      style.borderBottomLeftRadius,style.borderBottomRightRadius].every(radius=>
        radius.split(/\s+/).every(value=>value.endsWith('%') ? parseFloat(value)>=50 : parseFloat(value)>=box.width/2-.5)),
    left:glyph ? glyph.left-box.left:null,right:glyph ? box.right-glyph.right:null};
}"""


class FixtureBlocked(RuntimeError):
    pass


def money(value, signed=False):
    sign = "−" if value < 0 else "+" if signed and value > 0 else ""
    return f"{sign}{abs(value):.2f}억"


def required(checks, condition, label):
    if not checks.ok(condition, label):
        raise AssertionError(label)


def attempt(checks, label, fn):
    try:
        fn()
    except Exception as exc:
        prefix = "BLOCKED " if isinstance(exc, FixtureBlocked) else ""
        checks.ok(False, f"{prefix}{label}: {type(exc).__name__}: {str(exc).splitlines()[0][:220]}")


def start(page, base):
    page.goto(base + "#league")
    page.wait_for_function(BOOT_JS)
    select_mode(page, "solo")
    page.locator("#lg-solo .lg-extra-settings > summary").click()
    page.locator("#lg-solo-seed").select_option("fixed")
    start_solo(page, months=12)
    dismiss_guide(page)
    wait_unfolded(page)


def inject(page, script, case, phase):
    try:
        page.evaluate(script, case)
        page.reload()
        page.wait_for_function("""phase => {
          const L=KCP.league.state(); return L?.role==='solo' && L.snap?.round===2 && L.snap?.phase===phase;
        }""", arg=phase)
        dismiss_guide(page)
        wait_unfolded(page)
        # 저장·복원 경계를 실제로 확인한다. UI에서 선택한 주제는 기대값으로 사용하지 않는다.
        state = page.evaluate("""() => {
          const L=KCP.league.state(), V=L.snap, id=L.team, r=V.results.find(r=>r.round===1);
          return {cash:V.econ.cities[id].cash,before:V.econ.before?.[id]?.cash,
            uns:r.team[id].unsPct,grid:Math.max(0,r.team[id].isolated.uns-r.team[id].uns-r.team[id].imp+r.team[id].sub)/r.days};
        }""")
        if phase == "plan" and (abs(state["cash"] - case["cash"]) > 1e-9 or
                                abs(state["uns"] - case["uns"]) > 1e-9 or
                                abs(state["grid"] - case["grid"]) > 1e-9):
            raise FixtureBlocked("S4 고정 입력이 복원되지 않음")
        if phase == "review" and (abs(state["cash"] - case["after"]) > 1e-9 or
                                  abs(state["before"] - case["cash"]) > 1e-9):
            raise FixtureBlocked("S6 고정 입력이 복원되지 않음")
    except Exception as exc:
        raise FixtureBlocked(str(exc)) from exc


def info_buttons(checks, page, label):
    # 접힌 내용 안 버튼도 제외하지 않고, 바깥 details를 열어 모두 측정한다.
    page.locator("#lg-panel").evaluate("""root => {
      root.querySelectorAll('details:not(.lg-info)').forEach(d=>{d.open=true;});
      root.querySelectorAll('details.lg-info').forEach(d=>{d.open=false;});
    }""")
    buttons = page.locator("#lg-panel .lg-info-btn")
    count = buttons.count()
    for i in range(count):
        button = buttons.nth(i)
        button.evaluate("""el => {
          const own=el.closest('details');
          for(let p=own?.parentElement;p && p.id!=='lg-panel';p=p.parentElement)
            if(p.tagName==='DETAILS') p.open=true;
        }""")
        button.scroll_into_view_if_needed()
        metric = button.evaluate(INFO_MEASURE)
        prefix = f"{label} A5 ! {i+1}/{count}"
        checks.ok(metric["after"] == "none", prefix + " ::after content none")
        checks.ok(metric["circular"] and abs(metric["width"] - 44) <= .5 and abs(metric["height"] - 44) <= .5,
                  prefix + f" 44px 원 크기 ({metric['width']}×{metric['height']})")
        checks.ok(metric["text"] == "!" and metric["left"] is not None and
                  metric["left"] >= 0 and metric["right"] >= 0 and
                  abs(metric["left"] - metric["right"]) <= 2,
                  prefix + f" 글자 좌우 여백 차 ≤2px ({metric['left']}/{metric['right']})")
    overflow(checks, page, label + " A5 펼친 서랍")
    return count


def plan_checks(checks, page, case, label):
    open_panel(page, "journal")
    select = page.locator(f'#lg-predict select[data-pred="{case["topic"]}"]')
    required(checks, select.count() == 1, label + " A3 명세 주제 선택자 한 개")
    down = select.locator('option[value="down"]')
    required(checks, down.count() == 1, label + " A3 down 선택지 한 개")
    checks.ok("줄 것" in down.text_content(), label + " A3 줄 것 이름")
    # Playwright is_disabled()는 <option disabled>를 false로 돌려준다(1.63 실측). DOM 속성으로 읽는다.
    checks.ok(down.evaluate("e => e.disabled") == case["disabled"], label + " A3 줄 것 비활성 여부")
    if case["disabled"]:
        checks.ok("줄 것" in page.locator("#lg-promise-down-why").inner_text(), label + " A3 감소 불가 안내")
    if case["topic"] == "cash":
        baseline = page.locator("#lg-promise-baseline").inner_text()
        expected = money(case["cash"])
        checks.ok(expected in baseline, label + f" A1 S4 운영 전 {expected}")
        checks.ok("빚 한도" in baseline and "남은 돈" in baseline, label + " A1 실제 현금·남은 돈 구별")
        checks.ok(("-10.04" not in baseline if case["cash"] < 0 else "+3.20" not in baseline),
                  label + " A1 음수 U+2212·양수 + 없음")
        why = page.locator("#lg-promise-cash-why")
        checks.ok(why.count() == 1 and why.is_visible() and "월말 현금" in why.inner_text(),
                  label + " A3 현금 주제 전환 안내")
        if why.count():
            checks.ok("lg-hint" in (why.get_attribute("class") or ""), label + " A3 안내 lg-hint")
    overflow(checks, page, label + " S4")
    screenshot(checks, page, f"rev8-{label}-S4.png")


def review_checks(checks, page, case, label):
    open_panel(page, "result")
    # 전체 문장 대신 운영 전·월말·Δ 숫자와 단위만 단언한다(A1).
    for selector in ("#lg-promise-summary", '[data-compare="cash"]'):
        line = page.locator(selector)
        required(checks, line.count() == 1, label + f" A1 S6 {selector}")
        text = line.text_content()  # 접힌 상세도 숫자 비교; 주 요약은 아래에서 별도 가시성 확인.
        for token in (money(case["cash"]), money(case["after"]), money(case["after"] - case["cash"], True)):
            checks.ok(token in text, label + f" A1 S6 {selector} {token}")
    checks.ok(page.locator("#lg-promise-summary").is_visible(), label + " A1 S6 요약 가시성")
    overflow(checks, page, label + " S6")
    screenshot(checks, page, f"rev8-{label}-S6.png")


def run_case(checks, page, base, case, label):
    start(page, base)
    page.context.add_init_script(INSTALL_FIXTURE)
    try:
        inject(page, BUILD_FIXTURE, case, "plan")
    except FixtureBlocked as exc:
        for dependent in ("A3 주제·down", "A5 서랍 버튼", "A1 S4·S6" if case["topic"] == "cash" else "A3 감소 불가 안내"):
            checks.ok(False, f"BLOCKED {label} {dependent}: {str(exc).splitlines()[0][:160]}")
        return
    attempt(checks, label + " S4", lambda: plan_checks(checks, page, case, label))
    info_count = 0
    # 리그 서랍별로 현재 DOM에 있는 모든 ! 단추를 검사한다(후보 0개 서랍은 합계로 감시).
    for panel in ("journal", "city", "deal", "tech", "rank", "help"):
        try:
            if panel == "help":
                # 도움말 서랍은 아래 막대가 아니라 머리의 #bd-help 단추로 연다(onHelp → openPanel("help")).
                page.locator("#bd-help").click()
                page.wait_for_selector('#lg-panel[data-tab="help"]:not([hidden])')
            else:
                open_panel(page, panel)
            info_count += info_buttons(checks, page, label + " " + panel)
        except Exception as exc:
            checks.ok(False, f"{label} A5 {panel}: {str(exc).splitlines()[0][:180]}")
    required(checks, info_count > 0, label + " A5 실제 ! 단추 검사 수 >0")
    if case["topic"] == "cash":
        try:
            inject(page, BUILD_REVIEW, case, "review")
        except FixtureBlocked as exc:
            checks.ok(False, f"BLOCKED {label} A1 S6 운영 전·월말·Δ: {str(exc).splitlines()[0][:180]}")
            return
        attempt(checks, label + " S6", lambda: review_checks(checks, page, case, label))
        attempt(checks, label + " A5 result", lambda: info_buttons(checks, page, label + " result"))


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()  # 샌드박스 밖 로컬 실행 담당자만 호출한다.
            try:
                for width, height in ((1280, 900), (390, 844)):
                    for case in CASES:
                        label = f"{width}x{height}-{case['name']}"
                        context, external = context_for(browser, base, width, height, "light")
                        page, events = monitored_page(context)
                        try:
                            run_case(checks, page, base, case, label)
                        except Exception as exc:
                            checks.ok(False, f"BLOCKED {label}: {type(exc).__name__}: {str(exc).splitlines()[0][:220]}")
                        finally:
                            attempt(checks, label + " 마지막 가로 스크롤", lambda: overflow(checks, page, label))
                            diagnostics(checks, events, label)
                            checks.ok(not external, label + f" 외부 연결 시도 0: {external}")
                            context.close()
            finally:
                browser.close()
    except Exception as exc:
        checks.ok(False, f"BLOCKED 실행 환경: {type(exc).__name__}: {str(exc).splitlines()[0][:220]}")
    print(f"assertions {checks.count} failures {checks.failed}", flush=True)
    return 1 if checks.failed else 0


if __name__ == "__main__":
    sys.exit(main())
