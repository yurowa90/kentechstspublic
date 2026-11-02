"""통합 고유 검사: 여러 모듈이 같은 슬롯을 함께 쓸 때의 배치와 전체 삭제."""
from harness import main

def t_I1_room_tools_order(c):
    c.goto("#y2022", wait="#grid")
    c.phase("room")
    c.page.wait_for_selector(".qdeck .qcard")
    ids = c.page.evaluate("[...document.querySelector('#room-tools').children].map(e => e.id || e.className)")
    c.expect(len(ids) >= 2, f"I1 면접실 도구 줄에 모듈 요소가 둘 이상 있다 {ids}")
    c.expect(all(any(p in s for p in ("pb-", "pv-", "jn-", "dr-")) for s in ids), f"I1 도구 줄 자식은 모두 모듈 접두어를 가진다 {ids}")
    over = c.page.evaluate("[...document.querySelector('#room-tools').children].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length")
    c.eq(over, 0, "I1 도구 줄 요소가 화면 밖으로 넘치지 않는다")
    c.check("I1 면접실")

def t_I2_reflect_slots(c):
    c.goto("#y2025", wait="[data-tab]")
    c.phase("reflect")
    c.page.wait_for_selector("table.rubric")
    left = c.page.evaluate("[...document.querySelector('#reflect-left').children].map(e => e.id)")
    c.expect(all(i.startswith(("pb-", "pv-", "jn-")) or i == "" for i in left), f"I2 성찰 왼쪽 슬롯은 모듈 패널만 담는다 {left}")
    c.check("I2 성찰")

def t_I3_copy_has_all_blocks(c):
    c.goto("#y2022", wait="#grid")
    c.phase("reflect")
    c.page.fill("#nextstep-2022", "결론을 먼저 말한다")
    c.page.evaluate("() => { Object.defineProperty(navigator,'clipboard',{value:{writeText:t=>{window.__clip=t;return Promise.resolve();}},configurable:true}); }")
    c.page.click("#copyAll")
    c.page.wait_for_function("typeof window.__clip === 'string'")
    clip = c.page.evaluate("window.__clip")
    a, g = clip.find("■ 자기 평가"), clip.find("■ 다음 연습 목표")
    c.expect(0 <= a < g, "I3 자기 평가 블록이 다음 연습 목표보다 앞에 있다")

def t_I4_wipe_all(c):
    c.goto("#y2022", wait="#grid")
    c.page.click('[data-tool="wind"]'); c.page.click('[data-cell="B1"]')
    c.goto("#drill", wait="#app h1")
    c.goto("#home", wait=".home-grid")
    c.wait_saved(400)
    c.page.evaluate("KCP.clearAll()")
    c.wait_saved(600)
    keys = c.page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('kcp:'))")
    c.eq(keys, [], "I4 모두 지우기 뒤 kcp: 키가 남지 않는다")
    c.page.reload(); c.page.wait_for_selector(".home-grid")
    c.eq(c.page.locator(".pkg .chip.accent").count(), 0, "I4 다시 열어도 이어서 하기 표시가 없다")
    c.check("I4 홈")

if __name__ == "__main__":
    main(globals())
