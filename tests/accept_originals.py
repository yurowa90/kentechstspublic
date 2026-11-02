"""창작 쟁점 게임 공통 검사: 다섯 게임이 공통 셸 위에서 같은 규칙으로 동작하는지 본다."""
import re
from harness import main

IDS = ["s-island-grid", "s-cement-carbon", "s-variant-desk", "s-shuttle-permit", "s-riverdeal"]


def assert_single_request(c, questions):
    """결함 8: 다섯 게임 공통. 인용한 발언/입력은 빼고 물음과 명령형 종결을 함께 센다.

    연결어로 묶인 복수 과제까지 판별하는 검사는 아니므로 문안 검토도 필요하다.
    """
    for q in questions:
        text = re.sub(r"“[^”]*”|‘[^’]*’", "", q["q"])
        # N7: 말하세요·적으세요·설명하세요 등 직접 명령형 종결도 센다.
        count = len(re.findall(r"[?？]|(?:주세요|[가-힣]+세요)[.!]", text))
        c.eq(count, 1, f"결함 8 {q['k']} 요청 하나")
    return questions


def t_O1_home_cards(c):
    c.goto("#home", wait=".home-grid")
    c.eq(c.page.locator(".home-grid .pkg").count(), 5, "O1 기출 카드는 5개 그대로")
    c.eq(c.page.locator("#home-originals .opkg").count(), 5, "O1 창작 게임 카드 5개")
    c.eq(c.page.evaluate("KCP.ORIGINAL_ORDER"), IDS, "O1 등록 순서")
    c.check("O1 홈")


def _each(c, gid):
    c.goto("#y" + gid, wait="#prep-body > *")
    brief = c.page.inner_text(".brief")
    c.expect("창작 게임" in brief and "가상 자료" in brief, f"O2 {gid} 머리에 창작 게임·가상 자료 표시")
    c.expect("학년도" not in c.page.inner_text("#strip .ttl"), f"O2 {gid} 띠 제목에 학년도 없음")
    c.check(f"O2 {gid} 준비실")
    if c.page.locator('[data-phase="room"]').is_disabled():
        # 계획 확정 전에는 면접실·성찰을 잠그는 게임(명세 결정): 안내 title만 확인한다
        c.expect(bool(c.page.get_attribute('[data-phase="room"]', "title")), f"O3 {gid} 잠긴 단계 버튼에 안내가 있다")
        return
    c.phase("room")
    c.page.wait_for_selector("#room-empty, .qdeck .qcard")
    n = c.page.locator(".qdeck .qcard").count()
    if n == 0:
        # 확정 전 질문이 없는 게임: 셸의 안내와 준비실 복귀 버튼
        c.expect(c.page.locator("#room-empty").is_visible(), f"O3 {gid} 확정 전 질문이 없을 때 안내가 보인다")
        c.page.click("#room-to-prep")
        c.page.wait_for_selector("#prep-body > *")
        c.expect(True, f"O3 {gid} 준비실로 돌아가기 동작")
        c.phase("room")
        c.page.wait_for_selector("#room-empty, .qdeck .qcard")
    else:
        c.expect(6 <= n <= 9, f"O3 {gid} 질문 {n}개(6~9)")
    c.eq(c.page.locator(".qdeck .tag-official").count(), 0, f"O3 {gid} 보고서 문항 표시 없음")
    keys = c.page.evaluate(f"KCP.games['{gid}'].questions(KCP.load('{gid}')).map(q => q.k)")
    c.expect(all(isinstance(k, str) and k for k in keys) and len(set(keys)) == len(keys), f"O3 {gid} 질문 k가 모두 있고 고유 {keys}")
    srcs = c.page.evaluate(f"KCP.games['{gid}'].questions(KCP.load('{gid}')).filter(q => q.src).length")
    c.eq(srcs, 0, f"O3 {gid} 질문에 src 없음")
    c.check(f"O3 {gid} 면접실")
    c.phase("reflect")
    c.page.wait_for_selector("table.rubric")
    c.expect("연습용 평가 기준" in c.page.inner_text("#phase"), f"O4 {gid} 연습용 평가 기준 표시")
    c.expect("설계 의도" in c.page.inner_text("#phase"), f"O4 {gid} 설계 의도 표시")
    c.expect(c.page.locator(f"#exwrap").is_hidden(), f"O4 {gid} 예시는 처음에 숨김")
    c.page.fill(f"#before-{gid}", "안전을 비용보다 무겁게 보았다")
    c.page.click("#openEx")
    c.page.wait_for_timeout(150)
    c.expect(c.page.locator("#exwrap").is_visible() and len(c.page.inner_text("#exwrap").strip()) > 0, f"O4 {gid} 기준 한 줄 뒤 예시 영역 열림(확정 전에는 안내만 있을 수 있음)")
    c.check(f"O4 {gid} 성찰")
    c.wait_saved(400)
    c.expect(c.ls("kcp:v1:" + gid) is not None, f"O5 {gid} 저장 키 생성")


def t_O2_island(c): _each(c, "s-island-grid")
def t_O2_cement(c): _each(c, "s-cement-carbon")
def t_O2_variant(c): _each(c, "s-variant-desk")
def t_O2_shuttle(c): _each(c, "s-shuttle-permit")
def t_O2_river(c): _each(c, "s-riverdeal")


if __name__ == "__main__":
    main(globals())
