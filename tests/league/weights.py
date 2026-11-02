"""끝 화면 '가중치를 바꾸면?' 검사(진행자 + 3팀, 혼자 하기).

실행(로컬 서버를 먼저 띄운다):
  python3 tests/srv.py <포트> .
  tests/.venv/bin/python tests/league/weights.py http://127.0.0.1:<포트>/index.html
브라우저 실행은 총괄 담당.

기대값의 근거(구현 코드를 옮기지 않고 이 파일에서 직접 계산한다):
- 공식 점수(ui/econ.js score 계약): 부분 점수 6종을 하한 params.scorePartFloor로 자른 뒤
  wScore 가중의 가중 기하평균 + 공동 보너스, 0~100, 소수 첫째 자리(JS 반올림).
  순위는 점수 내림차순, 동점은 도시 순서.
- 끝 화면 목록은 기본 가중에서 공식 순위표와 이름·순서·점수가 같아야 한다
  (2026-10-10 영상: 평택 30.7·당진 24.8이 목록에서 61.9·47.9로 뒤집힌 결함 → c6004cb).
- 가중을 모두 0으로 했을 때는 명세가 없다. 동작을 INFO로만 기록하고 유한한 숫자인지만 단언한다.
evaluate는 상태·DOM 읽기와 기존 검사(econui)와 같은 고정 판 준비에만 쓴다.
"""

import math
import re
import sys

from playwright.sync_api import sync_playwright

from econui import (BOOT_JS, Checks, context_for, diagnostics, local_address,
                    monitored_page, open_panel, overflow, screenshot, setup_pair,
                    shown, advance, automatic_plan)
from solo import click_next, start

KEYS = ("pop", "ind", "fin", "co2", "appr", "rel")
NUM = r"(\d+(?:\.\d+)?)"

# econui.SEED_JS와 같은 방식(규칙 엔진 fixture)으로 3팀 판을 만든다. 사람 팀은 평택 하나,
# 당진·아산은 고정 토큰으로 자리만 잡고 정책을 서로 다르게 둬 부분 점수가 갈리게 한다.
SEED3_JS = """turns => {
  const C = KCP.leagueCore, ids = ['pyeongtaek', 'dangjin', 'asan'];
  // 옛 방 코드 형식은 ui/league.js validRoom의 /^[A-Z2-9]{4,6}$/ (0·1·O·I 없음). 어기면 로비에 머문다.
  const room = 'WGTW32', now = Date.now();
  const S = C.newState(room, 'south', now, ids, {turns});
  C.reduce(S, {type:'claim', team:'dangjin', token:'fixture-dangjin'}, now, KCP.buildGame);
  C.reduce(S, {type:'claim', team:'asan', token:'fixture-asan'}, now, KCP.buildGame);
  C.reduce(S, {type:'econ', team:'dangjin', token:'fixture-dangjin', taxRes:2, taxInd:2, service:-2, incentive:0}, now, KCP.buildGame);
  C.reduce(S, {type:'econ', team:'asan', token:'fixture-asan', taxRes:-2, taxInd:-1, service:2, incentive:1}, now, KCP.buildGame);
  const net = {kind:'local'};
  localStorage.setItem('kcp-league-net-v1', JSON.stringify(net));
  localStorage.setItem('kcp-league-host-v1', JSON.stringify({room, net, state:S}));
  return {room, ids, team:ids[0]};
}"""
PLAN_JS = """() => { KCP.league.plan(st => Object.assign(st, window.__auto('pyeongtaek'))); }"""

# 공개 상태(진행자·팀이 받는 값)의 공식 점수와 부분 점수, 자료 파일의 하한·기본 가중.
PUBLIC_JS = """() => {
  const L = KCP.league.state();
  const V = L.S ? KCP.leagueCore.publicView(L.S, Date.now()) : L.snap, E = V.econ;
  return {
    phase: V.phase,
    rank: E.score.rank.map(r => ({id:r.id, name:r.name, score:r.score, parts:r.parts, coop:r.coop})),
    order: (E.scoreState && E.scoreState.order) || Object.keys(E.score.by),
    floor: KCP.ECON_DATA.params.scorePartFloor.v,
    w: KCP.ECON_DATA.params.wScore.v
  };
}"""
# 공식 순위표(#lg-rank): data-team·data-rank·제목의 이름·[data-total]·부분 점수 meter.
OFFICIAL_JS = r"""root => {
  const box = document.querySelector(root);
  if (!box) return null;
  return [...box.querySelectorAll('.lg-rankrow[data-team]')].map(n => {
    const h = n.querySelector('h3');
    const title = h ? [...h.childNodes].filter(x => x.nodeType === 3).map(x => x.textContent).join('') : '';
    const total = n.querySelector('[data-total]');
    return {id:n.dataset.team, rank:+n.dataset.rank, title:title.trim(),
      total: total ? total.textContent.trim() : '',
      meters: Object.fromEntries(['pop','ind','fin','co2','appr','rel'].map(k => {
        const m = n.querySelector(`[data-part="${k}"] meter[value]`);
        return [k, m ? +m.getAttribute('value') : null];
      }))};
  });
}"""
LIST_JS = """root => [...document.querySelectorAll(root + ' #lg-wrank li')].map(li => li.textContent.trim())"""
SLIDERS_JS = """root => [...document.querySelectorAll(root + ' input[data-weight]')].map(el => ({
  key: el.dataset.weight, value: el.value, attr: el.getAttribute('value'), min: el.min, max: el.max, step: el.step,
  out: (document.querySelector(root + ` output[data-weight-value="${el.dataset.weight}"]`) || {}).textContent }))"""


def js_round1(x):
    """JS Math.round(x * 10) / 10 (파이썬 round의 짝수 반올림과 다르다)."""
    return math.floor(x * 10 + 0.5) / 10


def spec_rank(rank, order, weights, floor):
    """명세 식으로 직접 계산한 (이름, 점수) 순위. 가중 합이 0이면 None."""
    den = sum(max(0.0, float(weights[k])) for k in KEYS)
    if den <= 0:
        return None
    rows = []
    for r in rank:
        num = sum(max(0.0, float(weights[k])) * math.log(max(floor, r["parts"][k])) for k in KEYS)
        raw = min(100.0, max(0.0, math.exp(num / den) + (r.get("coop") or 0)))
        rows.append({"id": r["id"], "name": r["name"], "score": js_round1(raw)})
    rows.sort(key=lambda x: (-x["score"], order.index(x["id"])))
    return rows


def arithmetic_rank(rank, order, weights):
    """판별력 확인용: 2026-10-10 결함(가중 산술평균)이라면 나올 순위."""
    den = sum(weights[k] for k in KEYS)
    rows = [{"id": r["id"], "name": r["name"], "score": js_round1(min(100, sum(
        weights[k] * r["parts"][k] for k in KEYS) / den + (r.get("coop") or 0)))} for r in rank]
    rows.sort(key=lambda x: (-x["score"], order.index(x["id"])))
    return rows


def parse_list(items):
    out = []
    for text in items:
        m = re.match(r"^(.*\S)\s+" + NUM + r"점$", text)
        out.append({"name": m.group(1), "score": float(m.group(2))} if m else {"name": text, "score": None})
    return out


def same_rows(got, expected, tol=0.05):
    return (len(got) == len(expected) and all(
        g["name"] == e["name"] and g["score"] is not None and abs(g["score"] - e["score"]) <= tol + 1e-9
        for g, e in zip(got, expected)))


def fmt_rows(rows):
    return ", ".join(f"{r['name']} {r['score']}" for r in rows)


def set_weight(page, root, key, value):
    """화면 슬라이더 조작. fill은 range에 값을 넣고 input·change를 보낸다."""
    page.locator(f'{root} input[data-weight="{key}"]').fill(str(value))
    page.wait_for_timeout(150)


def current_weights(page, root):
    return {s["key"]: float(s["value"]) for s in page.evaluate(SLIDERS_JS, root)}


def check_end_screen(checks, page, label, rank_root, sim_root):
    """끝 화면 한 곳(진행자 또는 혼자 하기)의 공식 순위표와 '가중치를 바꾸면?' 비교."""
    pub = page.evaluate(PUBLIC_JS)
    rank, order, floor, w0 = pub["rank"], pub["order"], pub["floor"], pub["w"]
    checks.ok(pub["phase"] == "end", f"{label} 끝 단계")
    checks.test(f"{label} 공식 순위표 표시", lambda: shown(page, rank_root))
    checks.test(f"{label} '가중치를 바꾸면?' 표시", lambda: shown(page, f"{sim_root}"))
    checks.ok(sorted(w0) == sorted(KEYS) and all(w0[k] > 0 for k in KEYS), f"{label} 자료 wScore 6종")

    # (0) 공식 순위표 DOM = 공개 상태 점수, 공개 상태 점수 = 명세 식(기본 가중)
    official = page.evaluate(OFFICIAL_JS, rank_root) or []
    checks.ok([o["id"] for o in official] == [r["id"] for r in rank],
              f"{label} 공식 순위표 행 순서 = 공개 상태 순위 {[o['id'] for o in official]}")
    for o, r in zip(official, rank):
        total = re.search(NUM + r"점", o["total"])
        checks.ok(bool(total) and abs(float(total.group(1)) - r["score"]) <= 0.05 + 1e-9 and
                  o["rank"] == rank.index(r) + 1 and o["title"].endswith(r["name"]),
                  f"{label} 공식 순위표 {r['name']} {o['total']} = 공개 {r['score']}")
        checks.ok(all(o["meters"][k] is not None and abs(o["meters"][k] - r["parts"][k]) <= 1e-9 for k in KEYS),
                  f"{label} 공식 순위표 {r['name']} 부분 점수 meter = 공개 parts")
    spec0 = spec_rank(rank, order, w0, floor)
    official_rows = [{"name": r["name"], "score": r["score"]} for r in rank]
    checks.ok(same_rows(official_rows, spec0, tol=1e-9),
              f"{label} 공식 점수 = 명세 식(기하평균·하한 {floor}·공동 보너스): {fmt_rows(spec0)}")
    arith = arithmetic_rank(rank, order, w0)
    print(f"INFO {label} 이 판에서 산술평균이었다면: {fmt_rows(arith)} "
          f"({'공식과 다름 → 이 판은 결함을 구별함' if not same_rows(arith, spec0, tol=1e-9) else '공식과 같음 → 이 판은 결함을 구별하지 못함'})", flush=True)

    # (1) 기본 가중의 첫 목록 = 공식 순위표(이름·순서·점수 ±0.05)
    first = parse_list(page.evaluate(LIST_JS, sim_root))
    checks.ok(same_rows(first, official_rows),
              f"{label} 기본 가중 목록 = 공식 순위표: 목록 [{fmt_rows(first)}] / 공식 [{fmt_rows(official_rows)}]")
    sliders = page.evaluate(SLIDERS_JS, sim_root)
    checks.ok(sorted(s["key"] for s in sliders) == sorted(KEYS), f"{label} 슬라이더 6개")
    checks.ok(all(s["attr"] is not None and abs(float(s["attr"]) - w0[s["key"]]) <= 1e-9 for s in sliders),
              f"{label} 슬라이더 초깃값 속성 = 자료 wScore")
    snapped = {s["key"]: (s["attr"], s["value"]) for s in sliders if s["attr"] != s["value"]}
    print(f"INFO {label} 슬라이더 칸(step {sliders[0]['step'] if sliders else '?'})에 맞춰 바뀐 기본값(속성→실제 value): {snapped or '없음'}", flush=True)

    # (2) 슬라이더 하나 바꾸기 → 목록 변화 + 명세 식과 일치
    for key, value in (("co2", 1), ("rel", 0), ("pop", 0.6)):
        before = page.evaluate(LIST_JS, sim_root)
        set_weight(page, sim_root, key, value)
        weights = current_weights(page, sim_root)
        checks.ok(abs(weights[key] - value) <= 1e-9, f"{label} 슬라이더 {key} → {value}")
        outputs = {s["key"]: s["out"] for s in page.evaluate(SLIDERS_JS, sim_root)}
        checks.ok(bool(re.fullmatch(r"\d+(?:\.\d+)?", outputs.get(key) or "")) and
                  abs(float(outputs[key]) - value) <= 0.005 + 1e-9, f"{label} 슬라이더 {key} 옆 숫자 {outputs.get(key)}")
        got = parse_list(page.evaluate(LIST_JS, sim_root))
        expected = spec_rank(rank, order, weights, floor)
        checks.ok(page.evaluate(LIST_JS, sim_root) != before, f"{label} {key}={value}: 목록이 바뀜")
        checks.ok(same_rows(got, expected),
                  f"{label} {key}={value} 가중 {weights}: 목록 [{fmt_rows(got)}] = 명세 [{fmt_rows(expected)}]")

    # (참고) 슬라이더를 처음 위치(실제 value)로 되돌렸을 때: 명세 없음 → 기록만
    for s in sliders:
        set_weight(page, sim_root, s["key"], s["value"])
    back = parse_list(page.evaluate(LIST_JS, sim_root))
    weights = current_weights(page, sim_root)
    checks.ok(same_rows(back, spec_rank(rank, order, weights, floor)),
              f"{label} 처음 위치로 되돌림: 목록 = 명세 식(슬라이더 값 {weights})")
    print(f"INFO {label} 처음 위치로 되돌린 목록 [{fmt_rows(back)}] "
          f"{'= 공식 순위표' if same_rows(back, official_rows) else '≠ 공식 순위표(슬라이더 칸 맞춤 때문)'}", flush=True)

    # (3) 가중 모두 0: 명세 없음. NaN·빈 목록이 없는지만 단언하고 동작은 기록한다.
    for key in KEYS:
        set_weight(page, sim_root, key, 0)
    zero = parse_list(page.evaluate(LIST_JS, sim_root))
    checks.ok(len(zero) == len(rank) and all(z["score"] is not None and 0 <= z["score"] <= 100 for z in zero),
              f"{label} 가중 모두 0: 목록 {len(zero)}행·유한 숫자")
    hint = page.locator(f"{sim_root} .lg-hint").inner_text() if page.locator(f"{sim_root} .lg-hint").count() else ""
    print(f"INFO {label} 가중 모두 0 → 목록 [{fmt_rows(zero)}] "
          f"{'= 공식 순위표' if same_rows(zero, official_rows) else '≠ 공식 순위표'} · 안내 문구: {hint!r}", flush=True)
    # 다음 검사를 위해 기본 위치로 되돌린다.
    for s in sliders:
        set_weight(page, sim_root, s["key"], s["value"])


def host_flow(checks, context, base, label, pages):
    host, team, fixture = setup_pair(context, base, 12, pages, seed_js=SEED3_JS)
    checks.ok(host.locator(".lg-tcard").count() == 3, f"{label} 진행자 3팀 카드")
    advance(host, team, 1, "plan")
    # econui와 같은 자동 연결 계획(AUTO는 함수 정의만 실행되게 감싼다).
    team.evaluate("() => {" + automatic_plan() + "}")
    team.evaluate(PLAN_JS)
    host.wait_for_function("id => !!KCP.league.state().S.teams[id].plan", arg=fixture["team"])
    for month in range(1, 13):
        if month > 1:
            advance(host, team, month, "plan")
        advance(host, team, month, "review")
    advance(host, team, 12, "end")
    host.wait_for_selector("#lg-host-debrief #lg-wsim")
    host.locator("#lg-host-debrief #lg-wsim").scroll_into_view_if_needed()
    check_end_screen(checks, host, label + " 진행자", "#lg-host-rank #lg-rank", "#lg-host-debrief #lg-wsim")
    overflow(checks, host, label + " 진행자 끝")
    overflow(checks, team, label + " 팀 끝")
    screenshot(checks, host, f"weights-{label}-host-end.png")


def solo_flow(checks, context, base, label, pages):
    page, events = monitored_page(context)
    pages.append((page, events, "혼자 하기"))
    page.goto(base + "#home")
    page.wait_for_function(BOOT_JS)
    page.evaluate("() => { localStorage.clear(); sessionStorage.clear(); }")
    page.goto(base + "#league")
    observation = start(page)
    if page.locator("#lg-guide-close").count() and page.locator("#lg-guide-close").is_visible():
        page.locator("#lg-guide-close").click()
    for _ in range(40):  # 12달 × 계획/결과 + 끝. 실행기 무한 루프 방지 한도.
        if observation["S"]["phase"] == "end":
            break
        observation = click_next(page, observation["S"])
    checks.ok(observation["S"]["phase"] == "end" and observation["S"]["round"] == 12,
              f"{label} 혼자 하기 버튼으로 12달 완주")
    open_panel(page, "result")
    page.wait_for_selector("#lg-panel #lg-wsim")
    check_end_screen(checks, page, label + " 혼자 하기", "#lg-panel #lg-rank", "#lg-panel #lg-wsim")
    overflow(checks, page, label + " 혼자 하기 끝")
    screenshot(checks, page, f"weights-{label}-solo-end.png")


def main():
    checks = Checks()
    try:
        base = local_address(sys.argv)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for width, height, scheme in ((1280, 900, "light"), (390, 844, "dark")):
                label = f"{width}x{height}-{scheme}"
                for name, flow in (("진행자", host_flow), ("혼자 하기", solo_flow)):
                    context, external = context_for(browser, base, width, height, scheme)
                    pages = []
                    try:
                        flow(checks, context, base, label, pages)
                    except Exception as exc:
                        checks.ok(False, f"{label} {name} 진행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
                        for page, _, who in pages:
                            screenshot(checks, page, f"weights-{label}-{who}-failure.png")
                    finally:
                        for _, events, who in pages:
                            diagnostics(checks, events, f"{label} {name}/{who}")
                        checks.ok(not external, f"{label} {name} 외부 연결 시도 0: {external}")
                        context.close()
            browser.close()
    except Exception as exc:
        checks.ok(False, f"검사 실행 예외 {type(exc).__name__}: {str(exc).splitlines()[0][:200]}")
    return checks.finish()


if __name__ == "__main__":
    sys.exit(main())
