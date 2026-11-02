"""수정 명세 12절 수용 검사. 실행은 구현 세션 담당(KCP_BASE, harness).

기준 ID: 번호 항목은 12.1-1~7/12.4-1~8, 글머리 항목은
12.2-1~8/12.3-1~7, 12.5는 keyboard/gate/visual/integration.
명세에 없는 구현 계산값이나 문구를 기대값으로 사용하지 않는다.
"""
import copy
import math
import re

from accept_originals import assert_single_request
from harness import Ctx, main

GAME = "s-variant-desk"
KEY = "kcp:v1:" + GAME
ROUTE = "#ys-variant-desk"
POLICIES = ("secondary", "minors", "noCare", "relatives")
ORDER = ["P-01", "P-07", "P-13", "P-02", "P-09", "P-14", "P-03", "P-08",
         "P-15", "P-04", "P-10", "P-16", "P-05", "P-11", "P-06", "P-12"]
# 검토 H1: 기본 무게에서 빈도를 1로 낮추고 상담선을 1로 둔다.
DEFAULT = dict(version=1, weights=[2, 1, 3, 1, 1], t1=12, t2=1, overrides={},
               stage1Confirmed=False, policyMode="pending",
               policy=dict.fromkeys(POLICIES), piPct=1, piTouched=False,
               revealed=False, truthSeen=False, replannedAfterReveal=False,
               plan="", locked=None, tab="evidence", selectedId=None, overrideDraft=None)
SNAP_FIELDS = ("version", "weights", "t1", "t2", "overrides", "policyMode", "policy",
               "piPct", "piTouched", "replannedAfterReveal", "plan")
CASES = {
    "A": dict(weights=[3]*5, t1=-30, t2=-31),
    "B": dict(weights=[3]*5, t1=47, t2=46),
    "D": dict(weights=[0, 0, 0, 3, 0], t1=6, t2=1),
    "E": dict(weights=[0]*5, t1=1, t2=0),
}


def _text(c, sel):
    return c.page.locator(sel).inner_text().strip()


def _has(c, sel, text, aid):
    c.expect(text in _text(c, sel), f"{aid} {sel}에 {text} 표시")


def _hidden(c, sel, aid):
    c.expect(c.page.locator(sel).is_hidden(), f"{aid} {sel} 숨김")


def _enabled(c, sel, yes, aid):
    c.eq(c.page.locator(sel).is_enabled(), yes, f"{aid} {sel} 사용 가능 상태")


def _load(c):
    return c.page.evaluate("KCP.load('s-variant-desk')")


def _questions(c):
    return assert_single_request(c, c.page.evaluate("KCP.games['s-variant-desk'].questions(KCP.load('s-variant-desk'))"))


def _prep(c):
    c.goto(ROUTE, wait="#vd-board")


def _inject(c, game, phase="prep", common=None):
    # 홈 이동 및 flush 후 주입해야 이전 화면의 지연 저장이 덮지 않는다.
    c.goto("#home", wait=".home-grid")
    c.page.evaluate("KCP.flush()")
    state = c.page.evaluate("KCP.load('s-variant-desk')")
    state.update(common or {})
    state.update(game=game, phase=phase)
    c.page.evaluate("([key,s])=>localStorage.setItem(key,JSON.stringify(s))", [KEY, state])
    c.page.reload()
    c.page.wait_for_selector(".home-grid")
    _prep(c)


def _seed(c, **extra):
    game = copy.deepcopy(DEFAULT)
    game.update(extra)
    _inject(c, game)


def _policy(c, values):
    c.page.locator("#vd-policy-open").click()
    for key, value in zip(POLICIES, values):
        c.page.locator(f"#vd-policy-{key}-{'yes' if value else 'no'}").check()


def _reveal(c, policies=None):
    c.page.locator("#vd-stage1-confirm").click()
    if policies is None:
        c.page.locator("#vd-policy-skip").click()
    else:
        _policy(c, policies)
    c.page.locator("#vd-export").click()
    c.page.wait_for_selector("#vd-matrix-r")


def _groups(c, expected, aid):
    c.eq([int(_text(c, f"#vd-count-{g}")) for g in "RCN"], expected,
         f"{aid} 보고·상담·보고하지 않음 장수")
    c.eq(c.page.locator("#vd-board [data-vd-card]").count(), 16, f"{aid} 카드 총16장")
    for g in "RCN":
        actual = c.page.locator(f"#vd-list-{g} [data-vd-card]").evaluate_all(
            "es=>es.map(e=>e.dataset.vdCard)")
        c.eq(actual, [i for i in ORDER if i in actual], f"{aid} {g} 표시 순서")


def _matrix(c, kind, values, aid):
    for k, v in zip(("TP", "FP", "FN", "TN"), values):
        c.eq(_text(c, f'#vd-matrix-{kind} [data-vd-cell="{k}"]'), str(v),
             f"{aid} {kind} {k} 카운트")
    table = c.page.locator(f"#vd-matrix-{kind}")
    c.expect(any("이 게임이 정한 분류(가상의 추적 결과)" in t
                 for t in table.locator("th").all_text_contents()), f"{aid} 표 안 비교 기준 th")
    _has(c, f"#vd-matrix-{kind} caption", "미확정", aid)
    c.expect(table.locator('th[scope="row"]').count() >= 2, f"{aid} 행 머리 scope")
    c.expect(table.locator('th[scope="col"]').count() >= 2, f"{aid} 열 머리 scope")


def _metrics(c, kind, values, aid):
    for k, v in zip(("se", "sp", "ppv"), values):
        loc = c.page.locator(f'#vd-metrics-{kind} [data-vd-metric="{k}"]')
        text = loc.inner_text().strip()
        # label이 span 안에 있든 밖에 있든 수치는 동일해야 한다.
        actual = text.removeprefix({"se": "민감도", "sp": "특이도", "ppv": "양성예측도"}[k]).strip()
        c.eq(actual, v, f"{aid} {kind} {k} 표시값")
        if k != "ppv":
            c.expect(re.fullmatch(r"[0-6]/6", actual) is not None, f"{aid} Se·Sp 원분모6, 소수·% 없음")
    c.eq(c.page.locator(f"#vd-metrics-{kind} [data-vd-metric]").count(), 3,
         f"{aid} 세 지표만 제공")
    sizes = c.page.locator(f"#vd-metrics-{kind} [data-vd-metric]").evaluate_all(
        "es=>es.map(e=>getComputedStyle(e).fontSize)")
    c.eq(len(set(sizes)), 1, f"{aid} 세 지표 글자 크기 동일")


def _final(c, numbers, aid):
    expected = {f"P-{n:02}" for n in numbers}
    actual = c.page.locator("#vd-final-list [data-vd-final]").evaluate_all(
        "es=>es.map(e=>e.dataset.vdFinal)")
    c.eq(actual, [i for i in ORDER if i in expected], f"{aid} 보고 목록 ID·표시 순서")
    c.eq(_text(c, "#vd-final-count"), str(len(numbers)), f"{aid} 목록 장수")


def _resources(c, actions, demand, aid):
    c.eq([int(_text(c, f"#vd-action-{k}")) for k in ("image", "surgery", "drug", "family")],
         actions, f"{aid} 네 조치 요청(0건 포함)")
    c.eq(_text(c, "#vd-demand"), str(demand), f"{aid} 상담 수요")
    c.eq(c.page.locator("#vd-wait").is_visible(), demand > 8, f"{aid} 8건 초과에서만 대기")


def _f(c, counts, aid):
    text = _text(c, "#vd-metrics-f")
    for name, n in zip(("맞게 보고", "비병원성을 보고", "병원성을 보고하지 않음", "비병원성을 보고하지 않음"), counts):
        c.expect(f"{name} {n}" in text, f"{aid} 목록 비교 {name} {n}")
    c.eq(c.page.locator("#vd-metrics-f [data-vd-metric]").count(), 0, f"{aid} 목록 비교 지표 요소 없음")
    c.expect(not any(w in text for w in ("양성예측도", "PPV", "민감도", "특이도")), f"{aid} f는 카운트만")


def _ppv_range(tp, tn, pi):
    # 명세 5.2의 교육용 Wilson 범위. SVG 기대값은 앱 계산에서 얻지 않는다.
    def wilson(k):
        p, z2 = k / 6, 1.96**2
        den = 1 + z2 / 6
        center = (p + z2 / 12) / den
        half = 1.96 * math.sqrt(p * (1 - p) / 6 + z2 / 144) / den
        return (0 if k == 0 else center - half, 1 if k == 6 else center + half)
    se, sp = wilson(tp), wilson(tn)
    return [se[i] * pi / (se[i] * pi + (1 - sp[i]) * (1 - pi)) for i in (0, 1)]


def _straight_path_segments(d):
    # 명세 4.5절은 직선의 좌표·모양을 정하며 SVG 태그 종류는 지정하지 않는다.
    # path의 표준 직선 명령도 line과 같은 좌표 구간으로 읽는다. 곡선은 허용하지 않는다.
    tokens = re.findall(r"[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?", d or "")
    segments, pos, start = [], (0.0, 0.0), (0.0, 0.0)
    i, command = 0, None
    while i < len(tokens):
        if tokens[i].isalpha():
            command = tokens[i]
            i += 1
        if command is None or command.upper() not in ("M", "L", "H", "V", "Z"):
            return []
        kind, relative = command.upper(), command.islower()
        if kind == "Z":
            segments.append([pos[0], start[0], pos[1], start[1]])
            pos, command = start, None
            continue
        count = 2 if kind in ("M", "L") else 1
        if i + count > len(tokens) or any(t.isalpha() for t in tokens[i:i + count]):
            return []
        values = [float(t) for t in tokens[i:i + count]]
        i += count
        x, y = pos
        if kind in ("M", "L"):
            target = (values[0] + (x if relative else 0), values[1] + (y if relative else 0))
        elif kind == "H":
            target = (values[0] + (x if relative else 0), y)
        else:
            target = (x, values[0] + (y if relative else 0))
        if kind == "M":
            start = target
            command = "l" if relative else "L"  # M 뒤의 추가 좌표 쌍은 L이다.
        else:
            segments.append([x, target[0], y, target[1]])
        pos = target
    return segments


def _graph(c, svg, tp, tn, aid):
    c.eq(svg.get_attribute("viewBox"), "0 0 320 112", f"{aid} 범위 SVG 좌표계")
    # 명세 4.5·12.5절: line/path 모두 실제 구간을 검사한다. 기대 계산과 .02 허용 오차는 유지한다.
    shapes = svg.locator('line[stroke="var(--accent)"], path[stroke="var(--accent)"]').evaluate_all(
        "es=>es.map(e=>({tag:e.localName,d:e.getAttribute('d'),"
        "coords:['x1','x2','y1','y2'].map(k=>Number(e.getAttribute(k)))}))")
    lines = [segment for shape in shapes for segment in
             ([shape["coords"]] if shape["tag"] == "line" else _straight_path_segments(shape["d"]))]
    texts = []
    for row, pi in enumerate((0.002, 0.01, 0.05)):
        lo, hi = _ppv_range(tp, tn, pi)
        xlo, xhi, y = 86 + 212 * lo, 86 + 212 * hi, 28 + 28 * row
        horizontal = [ln for ln in lines if abs(ln[2] - y) < .02 and abs(ln[3] - y) < .02]
        c.expect(any(abs(ln[0] - xlo) < .02 and abs(ln[1] - xhi) < .02 for ln in horizontal),
                 f"{aid} π {pi*100:.1f}% 범위선은 실제 하한~상한")
        for x in (xlo, xhi):
            c.expect(any(abs(ln[0] - x) < .02 and abs(ln[1] - x) < .02
                         and ln[2] < y < ln[3] for ln in lines), f"{aid} 양 끝 수직선")
        texts.append(f"{math.floor(lo*1000+1e-10)/10:.1f}~{math.ceil(hi*1000-1e-10)/10:.1f}%")
    c.expect(svg.evaluate("""(e,expected)=>{
      for(let p=e.parentElement;p&&p.id!=='vd-prep';p=p.parentElement) {
        const texts=Array.from(p.querySelectorAll('*')).filter(n=>!n.closest('svg')).map(n=>n.textContent);
        if(expected.every(t=>texts.some(s=>s.includes(t))))return true;
      }return false;
    }""", texts), f"{aid} SVG 밖 세 행의 정확한 범위 텍스트 동일")
    c.expect(svg.locator('line[stroke="var(--line)"]').count() > 0, f"{aid} 축은 CSS 변수 색")
    c.expect(svg.locator('text:not([fill="var(--ink-2)"])').count() == 0, f"{aid} SVG 글자는 CSS 변수 색")
    c.expect(svg.evaluate("e=>e.getBoundingClientRect().width<=e.parentElement.getBoundingClientRect().width+1"),
             f"{aid} SVG 폭 넘침 없음")


def _onset(c, key, pen, value, aid):
    sel = f'#vd-onset [data-vd-onset="{key}"]'
    _has(c, sel, pen, aid)
    _has(c, sel, value, aid)
    c.expect(re.search(r"P-\d\d", _text(c, "#vd-onset")) is None, f"{aid} 발병 행에 개인 ID 없음")


def _no_grade(c, aid):
    text = _text(c, "#vd-results")
    c.expect(re.search(r"합격|건강 점수|최적 조합|진단 성공|정답입니다|성공 배지", text) is None,
             f"{aid} 결과에 성적·성공 판정 없음")
    c.expect(not any(t in text for t in ("NaN", "Infinity", "null")), f"{aid} 비유한값 문자열 없음")


def _manual(c, id_, target, reason):
    c.page.locator(f"#vd-card-{id_}").click()
    c.page.locator("#vd-override-to").select_option(target)
    c.page.locator("#vd-override-reason").fill(reason)
    c.page.locator("#vd-override-save").click()


def _tab_to(c, selector, aid):
    # 클릭/프로그램 focus 없이 실제 Tab 키로 이동한다.
    for _ in range(200):
        if c.page.evaluate("sel=>document.activeElement.matches(sel)", selector):
            return
        c.page.keyboard.press("Tab")
    c.expect(False, f"{aid} Tab으로 {selector}에 도달하지 못함")
    raise AssertionError(f"{aid} 키보드 접근 불가: {selector}")


def _keys(c, expected, aid):
    qs = _questions(c)
    keys = [q["k"] for q in qs]
    c.eq(len(qs), len(expected), f"{aid} 질문 개수")
    c.eq(keys, expected, f"{aid} 명세 우선순위와 질문 순서")
    c.eq(len(set(keys)), len(keys), f"{aid} 질문 키 유일")
    c.expect(all("src" not in q and "time" not in q for q in qs), f"{aid} 출처·시간 생략")
    c.eq(_questions(c), qs, f"{aid} 동일 확정에서 질문 결정적")
    return qs


def _expected_keys(result="balance", evidence="evidence-pair", policy=None, moved=False, replanned=False):
    # 검토 반영: 면접 카드 6~7장. 공통 1(기준 먼저), 오류 질문(얻는 것·잃는 것 한 문장), 반문을 늘 포함한다.
    return ["vd-c1", "vd-error-" + result, "vd-" + evidence,
            *(["vd-" + policy] if policy else []),
            "vd-replanned" if replanned else "vd-pi-" + ("moved" if moved else "unmoved"),
            "vd-counter-capacity", "vd-divergent-system"]


def t_12_1_1_home(c: Ctx):
    aid = "12.1-1"
    c.goto("#home", wait=".home-grid")
    card = c.page.locator(f'#home-originals .opkg[href="{ROUTE}"]')
    c.eq(card.count(), 1, f"{aid} 창작 구역에 게임 카드1개")
    for text in ("변이 판독대", "증거의 무게를 바꾸어 변이 카드 16장을 분류하고, 무엇을 알릴지 판단합니다.",
                 "생명과학", "보건", "정보와 선택권", "준비 25분", "답변 15분"):
        c.expect(text in card.inner_text(), f"{aid} 홈 메타 {text}")
    c.eq(c.page.locator(".pkg").count(), 5, f"{aid} 기출 카드5개 유지")
    card.click()
    c.page.wait_for_selector("#vd-board")
    c.expect(c.page.url.endswith(ROUTE), f"{aid} 게임 라우트")
    _groups(c, [4, 8, 4], aid)
    _has(c, ".brief", "창작 게임 · 가상 자료", aid)
    _has(c, ".brief", "1차 목적", aid)
    _has(c, ".brief", "‘2차 발견’", aid)
    c.page.locator("#vd-plan").fill("가상 자료의 불확실성을 설명합니다.")
    c.wait_saved(400)
    c.expect(isinstance(c.ls(KEY), dict), f"{aid} 400ms 후 저장키 생성")
    c.check(f"{aid} 준비실")


def t_12_1_2_initial_gates(c: Ctx):
    aid = "12.1-2"
    _prep(c)
    for sel in ("#vd-policy-choice", "#vd-policy", "#vd-results", "#vd-detail"):
        _hidden(c, sel, aid)
    for sel in ("#vd-export", "#vd-lock", "#vd-next", '.phases button[data-phase="room"]',
                '.phases button[data-phase="reflect"]'):
        _enabled(c, sel, False, aid)
    c.eq(c.page.locator("#vd-matrix-r").count(), 0, f"{aid} 공개 전 참값 표 DOM 없음")
    _has(c, "#vd-prep", "면접실과 성찰은 기준 확정 뒤 열립니다.", aid)
    for p in ("room", "reflect"):
        c.eq(c.page.locator(f'.phases button[data-phase="{p}"]').get_attribute("title"),
             "면접실과 성찰은 기준 확정 뒤 열립니다.", f"{aid} 단계 잠금 이유 title")


def t_12_1_3_detail_privacy(c: Ctx):
    aid = "12.1-3"
    _prep(c)
    leak = c.page.locator("#vd-board [data-vd-card]").evaluate_all("""es=>es.some(e=>
      [e.textContent,...Array.from(e.attributes,a=>a.name+'='+a.value),
       ...Array.from(e.querySelectorAll('*')).flatMap(n=>Array.from(n.attributes,a=>a.name+'='+a.value))]
      .some(s=>/분류 점수|이 게임이 정한 분류|truth|\\bTP\\b/.test(s)))""")
    c.expect(not leak, f"{aid} 접힌 카드 텍스트·속성에 점수·참값 없음")
    c.page.locator("#vd-card-P-01").click()
    c.eq(_text(c, "#vd-card-score"), "20", f"{aid} 상세 점수20")
    _has(c, "#vd-detail", "병원성으로 보고하면 검토할 조치", aid)
    # N1: VUS 분류 설명을 앞세운 새 문구의 대명사와 지침 구절을 확인한다.
    _has(c, "#vd-detail", "의미불명 변이(VUS)는 보고 시점의 증거로 정하는 분류", aid)
    _has(c, "#vd-detail", "이를 임상 결정에 쓰지 말라고 권고합니다", aid)
    c.expect("혈족 연락 가능 사례" in c.page.locator("#vd-card-P-01").inner_text(), f"{aid} P-01 혈족 표식 문구")
    for text in ("40~70%", "가계 내 공동분리", "집단 내 빈도", "기능 실험", "컴퓨터 예측",
                 "같은 위치의 다른 변이 보고", "가상 자료"):
        _has(c, "#vd-detail", text, aid)
    c.eq(c.page.evaluate("document.activeElement.id"), "vd-detail-title", f"{aid} 상세 제목으로 초점")
    c.page.locator("#vd-detail-close").click()
    c.eq(c.page.evaluate("document.activeElement.id"), "vd-card-P-01", f"{aid} 닫으면 카드로 초점 복귀")


def t_12_1_4_weights(c: Ctx):
    aid = "12.1-4"
    _prep(c)
    # 기본 [2,1,3,1,1]에서 예측 무게 2: 이동 없음 / 3: P-08이 보고하지 않음→상담으로 1장 이동.
    for value, groups, moved in ((2, [4, 8, 4], "이동한 카드가 없습니다."), (3, [4, 9, 3], "1장이 이동했습니다.")):
        c.page.locator("#vd-w-3-plus").click()
        _groups(c, groups, aid)
        c.eq(_text(c, f"#vd-w-3-value"), str(value), f"{aid} 예측 무게{value}")
        live = c.page.locator("#vd-live").text_content()
        c.expect(live.startswith(moved), f"{aid} 이동량 알림")
        c.expect(all(t in live for t in (f"보고 {groups[0]}장", f"상담 {groups[1]}장", f"보고하지 않음 {groups[2]}장")), f"{aid} 알림의 장수")
        c.eq([_text(c, f"#vd-w-{i}-value") for i in (0, 1, 2, 4)], ["2", "1", "3", "1"], f"{aid} 다른 무게 유지")
        c.eq([c.page.locator(f"#vd-{k}").input_value() for k in ("t1", "t2")], ["12", "1"], f"{aid} 문턱 유지")
        c.eq(c.page.locator("#vd-board table, #vd-board #vd-card-score").count(), 0, f"{aid} 카드판 전면 점수표 없음")
    c.expect(c.page.locator("#vd-w-3-plus").is_disabled(), f"{aid} 무게3의 +만 비활성")


def t_12_1_5_tabs(c: Ctx):
    aid = "12.1-5"
    _prep(c)
    c.page.locator("#vd-tab-voices").click()
    for key in ("voices", "evidence"):
        c.eq(c.page.locator(f"#vd-tab-{key}").get_attribute("aria-selected"),
             str(key == "voices").lower(), f"{aid} 클릭 선택 aria")
        c.eq(c.page.locator(f"#vd-tab-{key}").get_attribute("tabindex"), "0" if key == "voices" else "-1", f"{aid} 선택 탭만 Tab")
        c.eq(c.page.locator(f"#vd-material-{key}").is_visible(), key == "voices", f"{aid} 패널 hidden 동기화")
    c.page.locator("#vd-tab-voices").press("ArrowLeft")
    c.eq(c.page.locator("#vd-tab-evidence").get_attribute("aria-selected"), "true", f"{aid} 좌우키 활성화")
    _hidden(c, "#vd-material-voices", aid)
    c.page.locator("#vd-tab-evidence").press("End")
    c.eq(c.page.evaluate("document.activeElement.id"), "vd-tab-voices", f"{aid} End 마지막 탭")
    c.page.locator("#vd-tab-voices").press("Home")
    c.page.keyboard.press("Tab")
    c.expect(not c.page.evaluate("!!document.activeElement.closest('[hidden]')"), f"{aid} 숨긴 패널은 Tab 순서 제외")


def t_12_1_6_policy_gates(c: Ctx):
    aid = "12.1-6"
    _prep(c)
    c.expect(not c.page.locator("#vd-policy-open").is_visible(), f"{aid} 1단계 전 정책 진입 불가")
    c.page.locator("#vd-stage1-confirm").click()
    for sel in ("#vd-export", "#vd-lock", "#vd-next"):
        _enabled(c, sel, False, aid)
    c.page.locator("#vd-policy-open").click()
    c.eq(c.page.locator('#vd-policy input[type="radio"]:checked').count(), 0, f"{aid} 초기 정책 모두 미선택")
    for i, key in enumerate(POLICIES):
        c.page.locator(f"#vd-policy-{key}-no").check()
        _enabled(c, "#vd-export", i == 3, aid)
        if i < 3:
            _has(c, "#vd-policy-preview", "네 정책을 모두 선택해 주세요.", aid)
    c.page.locator("#vd-export").click()
    _final(c, [1, 2], aid)
    c.page.locator("#vd-policy-skip").click()
    _hidden(c, "#vd-policy", aid)
    _enabled(c, "#vd-export", True, aid)
    c.page.locator("#vd-export").click()
    _final(c, [1, 2, 3, 4], aid)
    c.expect("최종 보고" not in _text(c, "#vd-results"), f"{aid} skip에 최종 보고 표현 없음")


def t_12_1_7_uncertain(c: Ctx):
    aid = "12.1-7"
    _prep(c)
    _reveal(c)
    for id_ in ("P-13", "P-14", "P-15", "P-16"):
        _has(c, "#vd-uncertain", id_, aid)
        c.page.locator(f"#vd-card-{id_}").click()
        _has(c, "#vd-detail", "현재 자료로는 판단할 수 없다 — 이 게임이 정한 추적 뒤에도 판단하지 못한 가상 사례", aid)
        _has(c, "#vd-detail", "보고에 따른 조치 요청과 재검토·재연락 등록을 함께 표시", aid)
        _has(c, "#vd-detail", "미확정", aid)
        c.expect(not re.search(r"발병 범위[^<]*\d+\.\d+%", _text(c, "#vd-detail")), f"{aid} U 발병 숫자 없음")
        c.expect("이 게임이 정한 분류(가상의 추적 결과): 병원성" not in _text(c, "#vd-detail"), f"{aid} U 숨은 병원성 없음")
    for kind in ("r", "rc"):
        c.eq(sum(int(x) for x in c.page.locator(f"#vd-matrix-{kind} [data-vd-cell]").all_text_contents()), 12, f"{aid} U 제외 분모12")
    _has(c, "#vd-uncertain", "미확정 — 발병 범위를 추정하지 않음", aid)
    # N1: 성찰에서도 동일한 VUS 분류 설명과 지침 문구를 확인한다.
    _has(c, "#vd-uncertain", "의미불명 변이(VUS)는 보고 시점의 증거로 정하는 분류", aid)
    _has(c, "#vd-uncertain", "이를 임상 결정에 쓰지 말라고 권고합니다", aid)


def t_12_2_default(c: Ctx):
    _prep(c)
    _reveal(c)
    _matrix(c, "r", [4, 0, 2, 6], "12.2-1")
    _matrix(c, "rc", [6, 2, 0, 4], "12.2-1")
    _metrics(c, "r", ["4/6", "6/6", "0.7~100.0%"], "12.2-2")
    _metrics(c, "rc", ["6/6", "4/6", "0.8~9.5%"], "12.2-2")
    # 검토 M2: 열 머리 '비병원성'에 양성(良性) 괄호를 붙이지 않고, 양성 판정(陽性)을 따로 풀이한다.
    c.eq(c.page.locator('#vd-matrix-r th[scope="col"]').all_text_contents()[1:], ["병원성", "비병원성"], "12.2-1 열 머리")
    _has(c, "#vd-results", "양성 판정’은 보고 쪽으로 분류했다는 뜻(陽性)", "12.2-1")
    # 검토 H1: 빈도만 쓴 분류의 한계를 결과에서 밝힌다.
    _has(c, "#vd-results", "집단 내 빈도 하나만 쓰면 어떤 문턱에서도 12장 가운데 4장 이상을 잘못 분류합니다", "12.2-1")
    _final(c, [1, 2, 3, 4], "12.2-3")
    for text in ("1단계 보고 분류(정책 판단 보류)", "미성년 P-03", "예방·치료법 없음 P-04", "2차 발견", "실제로 전할지는 정하지 않았습니다."):
        _has(c, "#vd-results", text, "12.2-3")
    _resources(c, [3, 1, 1, 3], 12, "12.2-4")
    _has(c, "#vd-wait", "대기 발생", "12.2-4")
    c.eq(_text(c, "#vd-recontact"), "0", "12.2-4 보고한 미확정 없음")
    _has(c, "#vd-over", "이 카드 묶음에서는 없음", "12.2-4")
    c.eq(set(c.page.locator("#vd-missed [data-vd-missed]").evaluate_all("es=>es.map(e=>e.dataset.vdMissed)")),
         {"P-05", "P-06"}, "12.2-4 놓친 카드 둘")
    _has(c, '#vd-missed [data-vd-missed="P-06"]', "상담 후 결정에 남음", "12.2-4")
    _no_grade(c, "12.2-4")
    _onset(c, "40-70", "40~70%", "0.3~70.0%", "12.2-5")
    for key, value, r, rc, aid in (("End", "50", "3.8~100.0%", "4.3~35.3%", "12.2-6"),
                                  ("Home", "2", "0.1~100.0%", "0.1~2.1%", "12.2-7")):
        c.page.locator("#vd-pi").press(key)
        c.eq(c.page.locator("#vd-pi").input_value(), value, f"{aid} π 키보드 끝점")
        _metrics(c, "r", ["4/6", "6/6", r], aid)
        _metrics(c, "rc", ["6/6", "4/6", rc], aid)
        _groups(c, [4, 8, 4], aid)
        _final(c, [1, 2, 3, 4], aid)
        _resources(c, [3, 1, 1, 3], 12, aid)
    for _ in range(8):
        c.page.locator("#vd-pi").press("ArrowRight")
    c.eq(c.page.locator("#vd-pi").input_value(), "10", "12.2-7 π 기본값 복귀")
    c.expect(_load(c)["game"]["piTouched"], "12.2-7 π 조작 이력 유지")
    c.page.locator("#vd-card-P-01").click()
    c.page.locator("#vd-lock").click()
    for sel in ("#vd-pi", "#vd-t1", "#vd-t2", "#vd-override-save", "#vd-plan"):
        _enabled(c, sel, False, "12.2-8")
    c.expect(c.page.locator('#vd-weights button:not(:disabled), #vd-policy input:not(:disabled)').count() == 0,
             "12.2-8 저울·정책 입력 모두 잠김")
    _enabled(c, "#vd-next", True, "12.2-8")
    c.check("12.2-8 준비실 결과")
    c.page.locator("#vd-next").click()
    c.page.wait_for_selector(".qcard")
    _keys(c, _expected_keys(moved=True), "12.2-8")
    c.eq(c.page.locator(".qdeck .qcard").count(), 6, "12.2-8 면접 카드6개")
    for text in c.page.locator(".qdeck .qcard").all_text_contents():
        c.expect("연습용 질문" in text and "보고서 문항" not in text, "12.2-8 모든 카드 연습용 표시")
    c.check("12.2-8 면접실")


def t_12_3_1_extreme_report(c: Ctx):
    aid = "12.3-1"
    _seed(c, **CASES["A"])
    _reveal(c)
    _groups(c, [16, 0, 0], aid)
    ppv = "1.0%(범위 없음 — 전부 양성인 규칙에서는 π와 같습니다)"
    for k in ("r", "rc"):
        _matrix(c, k, [6, 6, 0, 0], aid)
        _metrics(c, k, ["6/6", "0/6", ppv], aid)
    _f(c, [6, 6, 0, 0], aid)
    # 결함 0·7: 미확정 4장의 요청 [2,0,2,2]도 합산하고 재연락을 병기한다.
    _resources(c, [10, 2, 6, 7], 16, aid)
    _has(c, "#vd-uncertain-actions", "정기 영상 검사 2건", aid)
    c.eq(_text(c, "#vd-recontact"), "4", f"{aid} 재검토·재연락 등록 4건")
    _final(c, list(range(1, 17)), aid)
    # 검토 M6: 비병원성인데 보고한 카드와 그 부담을 따로 보여 준다.
    c.eq(c.page.locator("#vd-over [data-vd-over]").evaluate_all("es=>es.map(e=>e.dataset.vdOver)"),
         [i for i in ORDER if i in {f"P-{n:02}" for n in range(7, 13)}], f"{aid} 비병원성 보고 6장")
    _has(c, "#vd-results", "불필요한 정기 관찰이나 예방적 수술 상담", aid)
    _has(c, "#vd-results", "전부 양성인 규칙에서는 새 구별 정보가 없어 π와 같습니다.", aid)
    _has(c, "#vd-uncertain", "미확정 — 발병 범위를 추정하지 않음", aid)
    _onset(c, "40-70", "40~70%", "0.4~0.7%", aid)


def t_12_3_2_extreme_none(c: Ctx):
    aid = "12.3-2"
    _seed(c, **CASES["B"])
    _reveal(c)
    _groups(c, [0, 0, 16], aid)
    for k in ("r", "rc"):
        _matrix(c, k, [0, 0, 6, 6], aid)
        _metrics(c, k, ["0/6", "6/6", "양성 판정이 없어 계산하지 않음"], aid)
    _f(c, [0, 0, 6, 6], aid)
    _final(c, [], aid)
    _resources(c, [0, 0, 0, 0], 0, aid)
    _no_grade(c, aid)
    c.page.locator("#vd-lock").click()
    _keys(c, _expected_keys(result="more-miss"), aid)


def t_12_3_3_prediction_policy(c: Ctx):
    aid = "12.3-3"
    _seed(c, **CASES["D"])
    c.page.locator("#vd-stage1-confirm").click()
    _policy(c, [True, False, False, True])
    preview = _text(c, "#vd-policy-preview")
    c.expect("3장" in preview and "2건" in preview, f"{aid} 미리보기 최종3·혈족2")
    c.expect("상담에서 제외 P-04" in preview, f"{aid} 정책이 상담 칸에도 적용(M3)")
    c.expect(not re.search(r"\bTP\b|\bFP\b|병원성으로 설정|참값", preview), f"{aid} 공개 전 미리보기 참값 없음")
    _has(c, "#vd-family-warning", "P-01은 혈족 연락을 거부했습니다.", aid)
    _contrast(c, "#vd-family-warning, #vd-policy p, #vd-policy .vd-source", aid)
    c.page.locator("#vd-export").click()
    _groups(c, [5, 5, 6], aid)
    _final(c, [2, 7, 13], aid)
    _matrix(c, "r", [2, 2, 4, 4], aid)
    _matrix(c, "rc", [5, 3, 1, 3], aid)
    _f(c, [1, 1, 5, 5], aid)
    _resources(c, [3, 1, 1, 0], 9, aid)
    c.eq(_text(c, "#vd-recontact"), "1", f"{aid} 보고한 미확정 P-13은 재검토·재연락 등록")
    _has(c, "#vd-consult-removed", "P-04", aid)
    _onset(c, "50-80", "50~80%", "0.0~5.5%", aid)
    _onset(c, "20-50", "20~50%", "0.0~3.5%", aid)
    _has(c, "#vd-results", "표시 자릿수 때문에 하한이 0.0%로 보일 수 있습니다. 위험이 없다는 뜻은 아닙니다.", aid)
    _has(c, "#vd-uncertain", "P-13", aid)
    _has(c, "#vd-uncertain", "미확정 — 발병 범위를 추정하지 않음", aid)
    c.page.locator("#vd-lock").click()
    _keys(c, _expected_keys("consult", "prediction", "relatives-on"), aid)


def t_12_3_4_policy_changes(c: Ctx):
    aid = "12.3-4"
    _seed(c, **CASES["D"])
    _reveal(c, [True, False, False, True])
    before = c.page.evaluate("KCP.games['s-variant-desk'].model.compute(KCP.load('s-variant-desk').game).ranges")
    for key, yes, expected, demand in (("minors", True, [2, 3, 7, 13], 10),
                                        ("noCare", True, [2, 3, 7, 8, 13], 12),
                                        ("secondary", False, [2, 7, 8, 13], 10)):
        c.page.locator(f"#vd-policy-{key}-{'yes' if yes else 'no'}").check()
        _hidden(c, "#vd-results", aid)
        _enabled(c, "#vd-export", True, aid)
        _has(c, "#vd-policy-preview", f"{len(expected)}장", aid)
        c.page.locator("#vd-export").click()
        _final(c, expected, aid)
        c.eq(_text(c, "#vd-demand"), str(demand), f"{aid} 변경 후 상담 수요")
        _groups(c, [5, 5, 6], aid)
        _matrix(c, "r", [2, 2, 4, 4], aid)
        _matrix(c, "rc", [5, 3, 1, 3], aid)
        after = c.page.evaluate("KCP.games['s-variant-desk'].model.compute(KCP.load('s-variant-desk').game).ranges")
        c.eq(after, before, f"{aid} 정책 변경이 R/RC PPV에 영향 없음")
    c.page.locator("#vd-policy-relatives-no").check()
    _hidden(c, "#vd-family-warning", aid)


def t_12_3_5_all_policies(c: Ctx):
    aid = "12.3-5"
    _prep(c)
    _reveal(c, [True]*4)
    _matrix(c, "r", [4, 0, 2, 6], aid)
    _matrix(c, "rc", [6, 2, 0, 4], aid)
    _final(c, [1, 2, 3, 4], aid)
    _f(c, [4, 0, 2, 6], aid)
    _resources(c, [3, 1, 1, 3], 14, aid)
    _has(c, "#vd-results", "혈족 고지 검토 2건", aid)
    _onset(c, "40-70", "40~70%", "0.3~70.0%", aid)


def t_12_3_6_zero_weights(c: Ctx):
    aid = "12.3-6"
    _seed(c, **CASES["E"])
    _has(c, "#vd-zero", "저울에 무게를 하나도 두지 않았습니다", aid)
    _groups(c, [0, 16, 0], aid)
    for n in range(1, 17):
        c.page.locator(f"#vd-card-P-{n:02}").click()
        c.eq(_text(c, "#vd-card-score"), "0", f"{aid} P-{n:02} 점수0")
    _enabled(c, "#vd-stage1-confirm", True, aid)
    c.expect(c.page.locator('#vd-zero[role="alert"], #vd-zero.vd-error').count() == 0, f"{aid} 무게0은 차단 오류 아님")
    c.expect(c.contrast("#vd-zero") >= 4.5, f"{aid} 무게0 안내는 읽을 수 있는 대비")
    _reveal(c)
    _metrics(c, "r", ["0/6", "6/6", "양성 판정이 없어 계산하지 않음"], aid)
    _metrics(c, "rc", ["6/6", "0/6", "1.0%(범위 없음 — 전부 양성인 규칙에서는 π와 같습니다)"], aid)
    _resources(c, [0, 0, 0, 0], 16, aid)
    _enabled(c, "#vd-lock", True, aid)


def t_12_3_7_thresholds(c: Ctx):
    aid = "12.3-7"
    _prep(c)
    # range에 실제 키보드 입력. 기본 t1 12, t2 1에서 t1을 1로 내리면 t2가 0으로 밀린다.
    c.page.locator("#vd-t1").focus()
    for _ in range(11):
        c.page.keyboard.press("ArrowLeft")
    c.eq([c.page.locator(f"#vd-{k}").input_value() for k in ("t1", "t2")], ["1", "0"], f"{aid} T1이 T2에 닿으면 T2=T1-1")
    _has(c, "#vd-live", "두 분류선이 겹치지 않도록 상담선을 0에 두었습니다.", aid)
    c.page.locator("#vd-t2").press("ArrowRight")
    c.eq([c.page.locator(f"#vd-{k}").input_value() for k in ("t1", "t2")], ["2", "1"], f"{aid} T2가 T1에 닿으면 T1=T2+1")
    _has(c, "#vd-live", "보고선을 2에 두었습니다.", aid)
    c.page.locator("#vd-w-0-plus").click()
    c.wait_saved()
    game = c.ls(KEY)["game"]
    c.eq([game["t1"], game["t2"]], [2, 1], f"{aid} 저장된 문턱 엄격부등식·무게 변경 때 유지")


def t_12_4_1_manual_f(c: Ctx):
    aid = "12.4-1"
    _prep(c)
    _manual(c, "P-05", "R", "   ")
    _has(c, "#vd-override-error", "바꾸는 이유를 한 문장으로 적어 주세요.", aid)
    c.eq(_load(c)["game"]["overrides"], {}, f"{aid} 공백 이유는 미저장")
    _manual(c, "P-05", "R", "추가 확인의 기회를 남기겠습니다.")
    _has(c, "#vd-manual-count", "1/3", aid)
    _has(c, "#vd-card-P-05", "수동", aid)
    c.expect("수동" in c.page.locator("#vd-card-P-05").get_attribute("aria-label"), f"{aid} 수동 aria 표식")
    _manual(c, "P-06", "R", "판독 근거의 한계를 설명하며 보고하겠습니다.")
    _groups(c, [6, 6, 4], aid)
    _reveal(c)
    _matrix(c, "r", [6, 0, 0, 6], aid)
    _metrics(c, "r", ["6/6", "6/6", "1.5~100.0%"], aid)
    _no_grade(c, aid)


def t_12_4_2_manual_limit(c: Ctx):
    aid = "12.4-2"
    _prep(c)
    reason = "작은 자료의 한계를 설명하며 선택합니다."
    for id_ in ("P-05", "P-06", "P-07"):
        _manual(c, id_, "R", reason)
    before = _load(c)["game"]["overrides"]
    _manual(c, "P-08", "R", reason)
    _has(c, "#vd-override-error", "수동 변경은 최대 3장입니다. 먼저 한 장을 자동으로 되돌리세요.", aid)
    c.eq(_load(c)["game"]["overrides"], before, f"{aid} 네 번째 차단·기존3개 유지")
    c.page.locator("#vd-card-P-07").click()
    c.page.locator("#vd-override-reset").click()
    _manual(c, "P-08", "R", reason)
    c.eq(set(_load(c)["game"]["overrides"]), {"P-05", "P-06", "P-08"}, f"{aid} reset 뒤 추가")
    # 기존 override는 자동과 같아져도 보존된다.
    c.page.locator("#vd-w-3-plus").click()
    c.expect("P-05" in _load(c)["game"]["overrides"], f"{aid} 무게 변경은 수동 기록 삭제하지 않음")
    c.page.locator("#vd-card-P-09").click()
    c.page.locator("#vd-override-to").select_option("R")
    c.page.locator("#vd-override-reason").fill("아직 적용하지 않은 초안입니다.")
    _reveal(c)
    c.eq(set(_load(c)["game"]["overrides"]), {"P-05", "P-06", "P-08"}, f"{aid} 미제출 초안 제외")
    _has(c, "#vd-manual-log", reason, aid)
    c.page.locator("#vd-lock").click()
    recap = c.page.evaluate("KCP.games['s-variant-desk'].recap(KCP.load('s-variant-desk'))")
    item = next(x for x in recap if x["t"] == "수동 변경")
    c.expect(reason in item["d"] and item["text"] == item["d"], f"{aid} recap·내보내기 이유 원문")


def t_12_4_2_manual_edit(c: Ctx):
    aid = "12.4-2"
    _prep(c)
    reason = "이유를 한 문장으로 설명합니다."
    for id_ in ("P-05", "P-06", "P-07"):
        _manual(c, id_, "R", reason)
    edited = "새로운 기준에 따른 이유로 수정합니다."
    _manual(c, "P-05", "R", edited)
    c.eq(_load(c)["game"]["overrides"]["P-05"]["reason"], edited, f"{aid} 한도3장이어도 기존 이유 편집 가능")
    # 자동 보고선까지 내려도 수동 기록은 자동 삭제하지 않는다.
    for _ in range(11):
        c.page.locator("#vd-t1").press("ArrowLeft")
    c.eq(c.page.locator("#vd-t1").input_value(), "1", f"{aid} 자동과 같은 보고로 변경")
    c.eq(_load(c)["game"]["overrides"]["P-05"]["reason"], edited, f"{aid} 자동과 같아진 수동 기록 보존")


def t_12_4_3_escape(c: Ctx):
    aid = "12.4-3"
    _prep(c)
    dialogs = []
    c.page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
    reason = "<img src=x onerror=alert(1)>라는 표시 대신 근거를 설명하겠습니다."
    _manual(c, "P-05", "R", reason)
    _reveal(c)
    _has(c, "#vd-manual-log", reason, aid)
    c.eq(c.page.locator("#vd-prep img").count(), 0, f"{aid} 이유가 img 노드 생성하지 않음")
    c.page.locator("#vd-lock").click()
    c.page.locator("#vd-next").click()
    c.page.wait_for_selector(".recap")
    _has(c, ".recap", reason, aid)
    c.eq(c.page.locator(".recap img").count(), 0, f"{aid} recap 텍스트 이스케이프")
    c.eq(dialogs, [], f"{aid} alert 미실행")
    c.expect(all("<img" not in q["q"] for q in _questions(c)), f"{aid} 이유를 q에 삽입하지 않음")


def t_12_4_4_snapshot_tamper(c: Ctx):
    aid = "12.4-4"
    _prep(c)
    _reveal(c, [True]*4)
    c.page.locator("#vd-card-P-05").click()
    before = _load(c)["game"]
    c.page.locator("#vd-lock").click()
    locked = _load(c)["game"]["locked"]
    c.eq(locked, {k: before[k] for k in SNAP_FIELDS}, f"{aid} 설정의 깊은 확정 복사")
    qs = _questions(c)
    c.page.evaluate("""() => {
      for (const sel of ['#vd-w-0-plus','#vd-override-save','#vd-policy-secondary-no']) {
        const e=document.querySelector(sel);e.disabled=false;e.click();
      }
      for(const [sel,value] of [['#vd-t1','47'],['#vd-t2','46'],['#vd-pi','50'],['#vd-plan','변조 시도']]) {
        const e=document.querySelector(sel);e.disabled=false;e.value=value;
        e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
      }
    }""")
    c.eq(_load(c)["game"]["locked"], locked, f"{aid} disabled 제거·강제 이벤트에도 스냅샷 불변")
    c.eq(_questions(c), qs, f"{aid} 변조 시도 뒤 질문 불변")


def _branch(c, extra, expected, values=None):
    aid = "12.4-5"
    _seed(c, **extra)
    _reveal(c, values)
    c.page.locator("#vd-lock").click()
    _keys(c, expected, aid)
    c.page.locator("#vd-next").click()
    c.page.wait_for_selector(".qcard")
    c.expect(6 <= c.page.locator(".qcard").count() <= 9, f"{aid} 면접실6~9개")
    for card in c.page.locator(".qcard").all():
        c.expect("연습용 질문" in card.inner_text() and "보고서 문항" not in card.inner_text(), f"{aid} 모든 질문 연습용")
    c.check(f"{aid} 분기 면접실")


def t_12_4_5_branch_manual(c: Ctx):
    _branch(c, {"overrides": {"P-05": {"to": "R", "reason": "판독의 한계를 설명합니다."}}}, _expected_keys(evidence="manual"))


def t_12_4_5_branch_prediction(c: Ctx):
    _branch(c, CASES["D"], _expected_keys("consult", "prediction"))


def t_12_4_5_branch_segregation(c: Ctx):
    _branch(c, {"weights": [0, 1, 3, 1, 1]}, _expected_keys(evidence="segregation-zero"))


def t_12_4_5_branch_frequency(c: Ctx):
    # 검토 H1: 빈도에 가계·기능보다 큰 무게를 두면 드물지만 비병원성인 P-11·P-12를 묻는다.
    _branch(c, {"weights": [1, 3, 2, 1, 1]}, _expected_keys(evidence="frequency"))


def t_12_4_5_branch_pi(c: Ctx):
    _branch(c, {"piTouched": True}, _expected_keys(moved=True))


def t_12_4_5_branch_fallback(c: Ctx):
    _branch(c, CASES["B"], _expected_keys("more-miss", policy="policy-reason"), [False]*4)


def t_12_4_5_branch_relatives_absent(c: Ctx):
    _branch(c, CASES["B"], _expected_keys("more-miss", policy="policy-reason"), [False, False, True, True])


def t_12_4_5_branch_prediction_tie(c: Ctx):
    _branch(c, CASES["B"], _expected_keys("more-miss"))


def t_12_4_5_branch_pi_no_change(c: Ctx):
    aid = "12.4-5"
    _seed(c, piPct=5)
    _reveal(c)
    c.page.locator("#vd-pi").press("End")
    c.expect(not _load(c)["game"]["piTouched"], f"{aid} 끝점에서 값 변화 없는 입력은 π 조작 아님")
    c.page.locator("#vd-lock").click()
    _keys(c, _expected_keys(), aid)


def _policy_branch_test(extra, values, result, evidence, key):
    def run(c):
        _branch(c, extra, _expected_keys(result, evidence, key), values)
    return run


# 명세 8.4 + 총괄 B: 정책 전 카드 분류가 같은 상태에서 켬/끔 양쪽을 묻는다.
# 미성년·조치 수단은 목적 안 카드, 중복 표식은 2차 발견에서 다룬다. 다른 정책 값으로 후보를 거르지 않는다.
for _key, _target in (("minors", "P-11"), ("nocare", "P-08"), ("secondary", "P-12"), ("relatives", "P-09")):
    for _on in (True, False):
        _extra = {"t1": 47, "t2": 46, "overrides": {_target: {"to": "R", "reason": "이 카드의 정책 갈등을 검토합니다."}}}
        _values = [True, True, True, False]
        _values[{"secondary": 0, "minors": 1, "nocare": 2, "relatives": 3}[_key]] = _on
        globals()[f"t_12_4_5_branch_{_key}_{'on' if _on else 'off'}"] = _policy_branch_test(
            _extra, _values, "more-miss", "manual", f"{_key}-{'on' if _on else 'off'}")


def t_12_4_5_consult_filter(c: Ctx):
    # 검토 M3: 예시 나(정책 모두 끔)에서 미성년 P-03은 상담 칸에 있어도 참여자 상담에서 빠진다.
    aid = "12.4-5"
    _seed(c, weights=[2, 3, 3, 0, 1], t1=18, t2=10)
    _reveal(c, [False]*4)
    _final(c, [1, 2], aid)
    c.eq(_text(c, "#vd-consult-removed"), "P-03", f"{aid} 상담에서 제외 P-03")
    _resources(c, [2, 1, 1, 1], 3, aid)


def t_12_4_6_replan_unseen(c: Ctx):
    aid = "12.4-6"
    _prep(c)
    c.page.locator("#vd-plan").fill("상담의 설명 시간을 확보합니다.")
    c.page.locator("#vd-stage1-confirm").click()
    c.page.locator("#vd-unlock").click()
    game = _load(c)["game"]
    c.eq([game["replannedAfterReveal"], game["truthSeen"], game["policyMode"], game["plan"]],
         [False, False, "pending", "상담의 설명 시간을 확보합니다."], f"{aid} 미공개 재계획은 공개 이력 없음")


def t_12_4_6_replan_seen(c: Ctx):
    aid = "12.4-6"
    common = dict(memo="가상 메모", answers={"8": "이전 질문의 답변"},
                  answerQ={"8": "이전 질문 원문"}, rubric={"0": 3}, ext={"test": {"keep": True}})
    _seed(c, plan="기준 설명 보존", piTouched=True)
    # 공통 상태도 실제 앱 저장 API를 통해 넣는다.
    c.page.evaluate("extra=>{const s=KCP.load('s-variant-desk');Object.assign(s,extra);KCP.save('s-variant-desk',s);KCP.flush();KCP.rerender();}", common)
    _reveal(c, [True]*4)
    c.page.locator("#vd-lock").click()
    before = _load(c)
    c.phase("room")
    c.page.locator('textarea[data-a="0"]').fill("현재 질문에 남긴 답변")
    c.phase("prep")
    before = _load(c)
    c.page.locator("#vd-unlock").click()
    after = _load(c)
    for field in ("weights", "t1", "t2", "overrides", "policy", "piPct", "piTouched", "plan"):
        c.eq(after["game"][field], before["game"][field], f"{aid} 재계획에서 {field} 보존")
    for field in ("memo", "answers", "answerQ", "rubric", "ext"):
        c.eq(after[field], before[field], f"{aid} 공통 {field} 보존")
    c.eq([after["game"][k] for k in ("locked", "stage1Confirmed", "revealed", "policyMode", "replannedAfterReveal")],
         [None, False, False, "pending", True], f"{aid} 공개 뒤 재계획 상태")
    _has(c, "#vd-prep", "비교 자료를 이미 본 상태에서 다시 계획하고 있습니다.", aid)
    for p in ("room", "reflect"):
        _enabled(c, f'.phases button[data-phase="{p}"]', False, aid)
    _reveal(c)
    c.page.locator("#vd-lock").click()
    # 검토 M7: 결과를 본 뒤 다시 계획하면 과적합을 묻는 질문이 π 질문 자리에 온다.
    _keys(c, _expected_keys(replanned=True), aid)
    c.phase("room")
    _has(c, ".recap", "결과 공개 뒤 다시 계획함", aid)
    _has(c, "#room-orphans", "이전 질문의 답변", aid)
    c.expect("8" in _load(c)["answers"], f"{aid} 지금 질문에 없는 답도 유지")


def t_12_4_7_reload(c: Ctx):
    aid = "12.4-7"
    _prep(c)
    reason = "자료가 부족하다는 한계를 그대로 설명합니다."
    _manual(c, "P-05", "R", reason)
    _reveal(c)
    c.page.locator("#vd-lock").click()
    before, qs = _load(c)["game"]["locked"], _questions(c)
    c.page.evaluate("KCP.flush()")
    c.page.reload()
    c.page.wait_for_selector("#vd-board")
    c.eq(_load(c)["game"]["locked"], before, f"{aid} 새로고침 확정 스냅샷 동일")
    c.eq(_questions(c), qs, f"{aid} 새로고침 질문 동일")
    _has(c, "#vd-manual-log", reason, aid)


def _corrupt_test(game, phase="prep"):
    def run(c):
        aid = "12.4-7"
        _inject(c, copy.deepcopy(game), phase)
        c.eq(c.page.locator("#vd-board [data-vd-card]").count(), 16, f"{aid} 손상값 복구 준비실16장")
        c.eq(_load(c)["phase"], "prep", f"{aid} 확정 없는 단계는 준비실 복귀")
        _enabled(c, "#vd-next", False, aid)
        c.eq(_load(c)["game"]["locked"], None, f"{aid} 잘못된 확정 해제")
        c.check(f"{aid} 복구 준비실")
    return run


t_12_4_7_corrupt_string = _corrupt_test("손상 문자열")
t_12_4_7_corrupt_array = _corrupt_test([1, 2, 3])
t_12_4_7_corrupt_ranges = _corrupt_test({"version": 1, "weights": [99, -8, 100, 4, -1], "t1": 999, "t2": 999,
                                       "piPct": -30, "locked": {"version": 1, "weights": [99]*5}})
t_12_4_7_corrupt_fields = _corrupt_test({"version": 1, "weights": None, "piPct": "oops", "locked": "broken"})
t_12_4_7_corrupt_room = _corrupt_test(copy.deepcopy(DEFAULT), "room")
t_12_4_7_corrupt_reflect = _corrupt_test(copy.deepcopy(DEFAULT), "reflect")


def t_12_4_7_forced_phase(c: Ctx):
    aid = "12.4-7"
    _prep(c)
    c.page.evaluate("KCP.goPhase('room')")
    c.eq(_questions(c), [], f"{aid} 미확정 강제 면접 질문 없음")
    c.eq(c.page.locator(".qdeck .qcard").count(), 0, f"{aid} 강제 면접 참값 질문 안 그림")
    c.page.evaluate("KCP.goPhase('reflect')")
    c.eq(c.page.locator("#exwrap .vd-reveal, #vd-matrix-r").count(), 0, f"{aid} 강제 성찰 예시·참값 없음")
    c.expect("가. 놓침 줄이기 우선" not in _text(c, "#phase"), f"{aid} 강제 성찰 예시 누설 없음")


def t_12_4_8_finish_prep(c: Ctx):
    aid = "12.4-8"
    _prep(c)
    c.page.locator("#vd-plan").fill("정보 수신 범위를 먼저 의논합니다.")
    # memoPanel 계약은 textarea의 id를 인자로 사용한다(app.js).
    c.page.locator("#vd-memo").fill("가상의 판단 메모입니다.")
    _enabled(c, "#vd-finish-prep", True, aid)
    c.page.locator("#vd-finish-prep").click()
    c.page.wait_for_selector(".home-grid")
    c.expect(c.page.url.endswith("#home"), f"{aid} 준비실 중단은 홈 이동")
    c.wait_saved()
    state = c.ls(KEY)
    c.eq(state["game"]["plan"], "정보 수신 범위를 먼저 의논합니다.", f"{aid} 기준 설명 저장")
    c.eq(state["memo"], "가상의 판단 메모입니다.", f"{aid} 공통 메모 저장")
    c.expect(not re.search(r"미완료|불이익|벌점", _text(c, "body")), f"{aid} 중단 압박 없음")


def t_12_5_keyboard(c: Ctx):
    aid = "12.5-keyboard"
    _prep(c)
    _tab_to(c, "#vd-w-3-plus", aid)
    c.page.keyboard.press("Space")
    _groups(c, [4, 8, 4], aid)
    _tab_to(c, "#vd-t1", aid)
    c.page.keyboard.press("ArrowRight")
    c.eq(c.page.locator("#vd-t1").input_value(), "13", f"{aid} 슬라이더 방향키1단위")
    # input 때 root나 range 노드가 교체되지 않아야 한다.
    c.page.locator("#vd-t1").evaluate("e=>window.__vdRange=e")
    c.page.keyboard.press("ArrowLeft")
    c.expect(c.page.evaluate("window.__vdRange===document.querySelector('#vd-t1')"), f"{aid} range DOM 동일")
    _tab_to(c, "#vd-card-P-05", aid)
    c.page.keyboard.press("Enter")
    c.eq(c.page.evaluate("document.activeElement.id"), "vd-detail-title", f"{aid} 카드 Enter 제목 초점")
    _tab_to(c, "#vd-override-to", aid)
    c.page.keyboard.press("Home")
    _tab_to(c, "#vd-override-reason", aid)
    c.page.keyboard.type("추가 확인의 기회를 남깁니다.")
    _tab_to(c, "#vd-override-save", aid)
    c.page.keyboard.press("Enter")
    c.expect(c.page.evaluate("document.activeElement.tagName !== 'BODY'"), f"{aid} 카드 이동 뒤 초점 유지")
    for sel in ("#vd-stage1-confirm", "#vd-policy-skip", "#vd-export"):
        _tab_to(c, sel, aid)
        c.page.keyboard.press("Enter")
        c.expect(c.page.evaluate("document.activeElement.tagName !== 'BODY'"), f"{aid} {sel} 단계 초점 유지")
    _tab_to(c, "#vd-pi", aid)
    c.page.keyboard.press("ArrowRight")
    for sel in ("#vd-lock", "#vd-next"):
        _tab_to(c, sel, aid)
        c.page.keyboard.press("Enter")
    c.page.wait_for_selector(".qcard")
    c.expect(c.page.evaluate("document.activeElement.tagName !== 'BODY'"), f"{aid} 면접 이동 뒤 초점 유지")
    c.check(f"{aid} 키보드 면접실")


def t_12_5_radio_keyboard(c: Ctx):
    aid = "12.5-keyboard"
    _prep(c)
    c.page.locator("#vd-stage1-confirm").click()
    c.page.locator("#vd-policy-open").click()
    for key in POLICIES:
        yes, no = (c.page.locator(f"#vd-policy-{key}-{suffix}") for suffix in ("yes", "no"))
        yes.focus()
        c.page.keyboard.press("Space")
        c.expect(yes.is_checked(), f"{aid} {key} Space 선택")
        c.page.keyboard.press("ArrowRight")
        c.expect(no.is_checked(), f"{aid} {key} 방향키 다른 정책 선택")
    _enabled(c, "#vd-export", True, aid)


def t_12_5_reflect_gate(c: Ctx):
    aid = "12.5-gate"
    _prep(c)
    _reveal(c)
    c.page.locator("#vd-lock").click()
    for p in ("room", "reflect"):
        _enabled(c, f'.phases button[data-phase="{p}"]', True, aid)
        c.expect(not c.page.locator(f'.phases button[data-phase="{p}"]').get_attribute("title"), f"{aid} 확정 후 잠금 title 제거")
    c.phase("reflect")
    c.page.wait_for_selector("#before-s-variant-desk")
    rubric = c.page.locator("section.panel").filter(has=c.page.locator("#rsum"))
    c.expect("연습용 평가 기준" in rubric.locator("h3").inner_text(), f"{aid} 자기 평가 머리")
    c.eq(c.page.locator("#phase h3").filter(has_text="설계 의도").count(), 1, f"{aid} 의도 패널 이름")
    _hidden(c, "#exwrap", aid)
    _enabled(c, "#openEx", False, aid)
    c.page.locator("#before-s-variant-desk").fill("불확실성 설명을 가장 중하게 봅니다.")
    c.page.locator("#openEx").click()
    for text in ("가. 놓침 줄이기 우선", "나. 과한 개입 피하기 우선", "다. 선택권 중심", "확률 해설", "이 모형이 단순화한 것"):
        _has(c, "#exwrap", text, aid)
    # 검토 M1·M4·H2·Low: 실제 지침과의 차이, 결함 9 예시 가의 혼합 정책, VUS 재분류, 차별 금지 조항을 밝힌다.
    exwrap = c.page.locator("#exwrap").text_content()
    for text in ("다섯 단계", "(BA1)", "(PVS1)", "de novo", "생식세포 변이만", "Pejaver", "Mersch", "약 90%",
                 "제46조", "ACMG SF", "미성년 참여자의 성인기 위험 보고와 참여자 거부 시 혈족 고지 검토는 끄겠습니다", "참여자 상담 11건",
                 "0.1~2.1%", "4.3~35.3%"):
        c.expect(text in exwrap, f"{aid} 성찰 해설에 {text}")
    c.expect("현재 과학으로" not in exwrap, f"{aid} ‘현재 과학으로 알 수 없다’ 표현 없음")
    c.expect(c.page.locator("#exwrap").is_visible(), f"{aid} 공통 관문 뒤 해설 보임")
    c.eq(c.page.locator("#exwrap #openEx, #exwrap textarea, #exwrap button").count(), 0, f"{aid} 게임 자체 관문·적용 버튼 없음")
    c.expect(c.page.evaluate("typeof KCP.games['s-variant-desk'].afterReflect==='undefined'"), f"{aid} 자체 afterReflect 없음")
    for detail in c.page.locator("#exwrap details").all():
        detail.locator("summary").click()
    c.check(f"{aid} 성찰 details 전부 열림")


def _contrast(c, selector, aid):
    for i, loc in enumerate(c.page.locator(selector).all()):
        if loc.is_visible():
            loc.evaluate("(e,i)=>e.dataset.vdTestContrast=String(i)", i)
            ratio = c.contrast(f'[data-vd-test-contrast="{i}"]')
            c.expect(ratio is not None and ratio >= 4.5, f"{aid} {selector} {i} 대비4.5:1")
            loc.evaluate("e=>delete e.dataset.vdTestContrast")


def t_12_5_visual(c: Ctx):
    aid = "12.5-visual"
    _prep(c)
    long_reason = "불확실성과 설명 시간을 함께 고려합니다" * 12
    _manual(c, "P-05", "R", long_reason)
    _manual(c, "P-06", "R", long_reason)
    _reveal(c)
    c.check(f"{aid} 긴 이유·결과 준비실")
    _contrast(c, "#vd-prep p, #vd-prep .vd-source, #vd-prep .vd-notice, #vd-prep [data-vd-metric], #vd-onset li, #vd-results svg text", aid)
    svgs = c.page.locator("#vd-results svg")
    c.eq(svgs.count(), 2, f"{aid} R/RC에만 범위 SVG")
    # F 검산: R=(6,0,0,6), RC=(6,2,0,4). 표 순서가 R 다음 RC다.
    for svg, tp, tn in zip(svgs.all(), (6, 6), (6, 4)):
        _graph(c, svg, tp, tn, aid)
    before = _load(c)["game"]
    c.page.emulate_media(reduced_motion="reduce")
    c.eq(_load(c)["game"], before, f"{aid} reduced-motion에서 상태 동일")
    c.page.locator("#vd-lock").click()
    c.phase("room")
    c.check(f"{aid} 면접실")
    c.phase("reflect")
    c.page.locator("#before-s-variant-desk").fill("충분한 설명과 정보 선택권을 먼저 봅니다.")
    c.page.locator("#openEx").click()
    for summary in c.page.locator("#exwrap details summary").all():
        summary.click()
    _contrast(c, "#exwrap p, #exwrap li, #exwrap .vd-source", aid)
    c.check(f"{aid} 열린 성찰")


def t_12_5_warning_condition(c: Ctx):
    aid = "12.5-visual"
    _seed(c, **CASES["B"])
    c.page.locator("#vd-stage1-confirm").click()
    _policy(c, [True]*4)
    _hidden(c, "#vd-family-warning", aid)
    c.page.locator("#vd-export").click()
    c.eq(_text(c, "#vd-demand"), "0", f"{aid} P-01=N이면 혈족 검토 없음")


def t_12_5_integration(c: Ctx):
    aid = "12.5-integration"
    originals = c.page.evaluate("KCP.ORDER.slice()")
    saved = {}
    for year, selector in (("2024", "[data-hex]"), ("2026", "#score select")):
        c.goto(f"#y{year}", wait=selector)
        for phase in ("room", "reflect"):
            _enabled(c, f'.phases button[data-phase="{phase}"]', True, aid)
        c.page.evaluate("KCP.flush()")
        saved[year] = c.ls("kcp:v1:" + year)
    _prep(c)
    _reveal(c)
    c.page.locator("#vd-lock").click()
    c.page.locator("#vd-unlock").click()
    for phase in ("room", "reflect"):
        _enabled(c, f'.phases button[data-phase="{phase}"]', False, aid)
    c.goto("#home", wait=".home-grid")
    c.eq(c.page.locator(".pkg").count(), 5, f"{aid} 기존 홈5개 유지")
    c.eq(c.page.evaluate("KCP.ORDER.slice()"), originals, f"{aid} 기출 ORDER 변경 없음")
    for year, selector in (("2024", "[data-hex]"), ("2026", "#score select")):
        c.eq(c.ls("kcp:v1:" + year), saved[year], f"{aid} 기존 {year} 저장 데이터 변경 없음")
        c.goto(f"#y{year}", wait=selector)
        c.phase("room")
        c.expect(c.page.locator(".qcard").count() > 0, f"{aid} 기존 {year} 면접 동작 유지")
        c.phase("reflect")
        c.expect(c.page.locator("table.rubric").is_visible(), f"{aid} 기존 {year} 성찰 동작 유지")


if __name__ == "__main__":
    main(globals())
