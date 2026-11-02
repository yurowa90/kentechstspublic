"""D-76 수용 검사의 공통 조작·측정. 브라우저 실행은 총괄이 맡는다."""

from harness import Ctx


def set_mode(c: Ctx, mode: str):
    """정지한 타이머의 시간 설정 UI로 모드를 바꾼다."""
    c.page.locator("#tset").click()
    button = c.page.locator(f'[data-tm="{mode}"]')
    if mode == "ext":
        c.expect("연장 1.5배" in button.inner_text(), "D-76 연습 모드는 연장 1.5배")
    button.click()
    c.page.wait_for_function("m => KCP.settings().timeMode === m", arg=mode)
    c.page.keyboard.press("Escape")
    c.expect(c.page.locator("#timeset").is_hidden(), "D-76 시간 설정 닫힘")


def reload_at(c: Ctx, selector: str, phase: str):
    c.wait_saved(400)  # (비공개 개발 설정): 250ms 지연 저장 뒤 400ms 대기.
    c.page.reload()
    c.page.wait_for_selector(selector)
    # 총괄 정정: 단계 단추가 화면에 두 벌(머리 띠·v2 셸) 있어 strict 위반이 났다. 둘의 상태는 같으므로 첫 번째만 읽는다.
    c.eq(c.page.locator(f'[data-phase="{phase}"]').first.get_attribute("aria-pressed"),
         "true", f"D-76 새로고침 뒤 {phase} 단계 복원")


def tab_to(c: Ctx, selector: str):
    """초점을 강제로 지정하지 않고 실제 Tab만으로 도달한다."""
    # tabs/impl.md 명세 1: 자료 탭 묶음은 선택된 탭만 Tab 정지점이다.
    # 여기서는 정지점 수·고정 Tab 횟수를 가정하지 않는다. 비선택 자료 탭은
    # 이 함수로 찾지 않고 선택 탭에 진입한 뒤 방향키로 이동한다(t_T1_tabs_a11y).
    for _ in range(240):
        c.page.keyboard.press("Tab")
        if c.page.evaluate("s => !!document.activeElement?.matches(s)", selector):
            c.expect(True, f"D-76 Tab으로 {selector}에 도달")
            return True
    c.expect(False, f"D-76 Tab으로 {selector}에 도달하지 못함(240회)")
    return False


def focus_remains(c: Ctx, label: str, selector=None):
    c.expect(c.page.evaluate("() => !!document.activeElement && document.activeElement !== document.body"),
             f"D-76 {label}: 초점이 BODY로 사라지지 않음")
    if selector:
        c.expect(c.page.evaluate("s => !!document.activeElement?.matches(s)", selector),
                 f"D-76 {label}: 대응 조작 {selector}에 초점 유지")


TOUCH_JS = r"""() => {
  const root = document.querySelector('#prep-body');
  const selectorOf = el => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let node = el; node && node !== root; node = node.parentElement) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      const tag = node.tagName.toLowerCase();
      const siblings = [...node.parentElement.children].filter(n => n.tagName === node.tagName);
      parts.unshift(tag + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
    }
    return '#prep-body ' + parts.join(' > ');
  };
  return [...root.querySelectorAll('button, select, input, [role="tab"], [data-slot], [role="button"]')]
    // A-2024 작업 5 / B-2526 작업 5: 지도 칸만 이번 44px 범위에서 제외.
    .filter(el => !el.matches('[data-hex]'))
    .filter(el => {
      const r = el.getBoundingClientRect(), style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
    .map(el => {
      const r = el.getBoundingClientRect();
      return {selector: selectorOf(el), width: r.width, height: r.height};
    });
}"""


def touch_targets(c: Ctx, label: str):
    # B-2526 작업 5: 연도 준비실 범위. 시간 설정 등 공용 띠는 변경 대상이 아니다.
    c.check(label)
    if not c.cfg.mobile:
        return
    c.eq((c.cfg.width, c.cfg.height), (390, 844), f"D-76 {label}: 터치 측정 뷰포트")
    controls = c.page.evaluate(TOUCH_JS)
    c.expect(bool(controls), f"D-76 {label}: 측정할 준비실 조작이 존재")
    for item in controls:
        c.expect(item["width"] >= 44 and item["height"] >= 44,
                 f"D-76 {label}: {item['selector']} {item['width']:.2f}×{item['height']:.2f}px ≥44×44")
    dims = c.page.evaluate("() => ({vw:document.documentElement.clientWidth, sw:Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)})")
    c.eq(dims["sw"], dims["vw"], f"D-76 {label}: 페이지 가로 스크롤 0")
