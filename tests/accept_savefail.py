"""저장 실패 경고의 명세 기반 수용 검사. app.js 저장 구현은 참조하지 않는다.

S1: 경고의 접근성·중복·3초 지속·회복·재실패(명세 1~3).
S2: 실패 중 초안과 재그리기, 회복 후 실제 저장·재로드(명세 4).
S3: 2023/2022 두 저장 키의 반복 실패와 전체 회복(명세 2~4).
각 검사: 요청 감시(명세 5), 엄격한 오류 집계·화면 폭·경고 위치(명세 6).

선택자와 저장 경로는 accept_base.py/accept_g2023.py 및 g2022.js의
입력 화면에서 확인했다. 입력은 가상 자료만 쓴다. harness가 처음 여는
페이지 이후 요청 감시를 설치하고 재로드하여 최초 정적 자원도 검사한다.
외부 요청은 실패로 기록하되, index.html이 처음부터 싣는 Google Fonts GET만
제외한다(학생 입력을 싣지 않음, 총괄 판정).
실행은 총괄의 샌드박스 밖 로컬 환경에서만 한다. -k/--cfg는 main에 위임한다.
"""

from contextlib import contextmanager
from pathlib import PurePosixPath
from urllib.parse import urlsplit

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

from harness import Ctx, main


KEY23 = "kcp:v1:2023"
KEY22 = "kcp:v1:2022"
TEXT = "저장하지 못했어요"
STATIC_SUFFIXES = {
    ".html", ".htm", ".css", ".js", ".mjs", ".json", ".webmanifest",
    ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico",
    ".woff", ".woff2", ".ttf", ".otf", ".mp3", ".wav", ".ogg", ".mp4", ".webm",
}

WARN_JS = """() => {
  const els = [...document.querySelectorAll('[id="kcp-save-warn"]')];
  const el = els[0], r = el?.getBoundingClientRect();
  let visible = !!el && !!el.getClientRects().length && r.width > 0 && r.height > 0;
  for (let p = el; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.display === 'none' || s.visibility === 'hidden' ||
        s.visibility === 'collapse' || Number(s.opacity) === 0) visible = false;
  }
  // 같은 문구를 다른 id/요소에 쌓는 경우도 센다. 부모의 textContent 중복은 제외한다.
  const messages = [...document.querySelectorAll('body *')].filter(e =>
    e.textContent.includes('저장하지 못했어요') &&
    ![...e.children].some(child => child.textContent.includes('저장하지 못했어요')))
    .reduce((n, e) => n + e.textContent.split('저장하지 못했어요').length - 1, 0);
  return {count: els.length, messages, visible, role: el?.getAttribute('role') ?? null,
    text: el?.textContent ?? '', left: r?.left ?? null, right: r?.right ?? null,
    width: r?.width ?? null, viewport: innerWidth};
}"""


def _origin(url):
    parts = urlsplit(url)
    return (parts.scheme, parts.hostname,
            parts.port or {"http": 80, "https": 443}.get(parts.scheme))


@contextmanager
def _observed(c):
    """초기 로딩을 포함한 요청을 기록한다. 차단·가로채기로 요청을 숨기지 않는다."""
    origin = _origin(c.page.url)
    unexpected = []

    def request_seen(request):
        path = urlsplit(request.url).path
        static = path.endswith("/") or PurePosixPath(path).suffix.lower() in STATIC_SUFFIXES
        # 총괄 판정: index.html이 처음부터 싣는 글꼴 GET은 학생 입력을 싣지 않으므로 명세 5 대상이 아니다.
        if request.method == "GET" and urlsplit(request.url).hostname in ("fonts.googleapis.com", "fonts.gstatic.com"):
            return
        if request.method != "GET" or _origin(request.url) != origin or not static:
            unexpected.append({"메서드": request.method, "주소": request.url,
                               "종류": request.resource_type})

    c.page.context.on("request", request_seen)
    try:
        c.page.reload(wait_until="load")
        c.page.wait_for_selector("#app > *", timeout=15000)
        c.page.evaluate("""() => {
          const original = Storage.prototype.setItem;
          window.__failSave = false;
          window.__saveFailures = [];
          Storage.prototype.setItem = function(key, value) {
            if (window.__failSave && String(key).startsWith('kcp:')) {
              window.__saveFailures.push({key: String(key), at: performance.now()});
              throw new DOMException('quota', 'QuotaExceededError');
            }
            return original.call(this, key, value);
          };
        }""")
        yield
    finally:
        c.page.context.remove_listener("request", request_seen)
        c.eq(unexpected, [], "명세 5 동일 출처 정적 파일 GET 이외의 요청 0건")
        for category, label in (("console", "콘솔 error·warning"),
                                ("pageerrors", "페이지 오류")):
            actual = [item for item in c.rec[category] if item["test"] == c.test]
            c.eq(actual, [], f"명세 6 {label} 0건")
        c.check("명세 6 검사 종료 화면")


def _until(c, expression, arg, label, actual):
    """고정 시간 경과로 저장 성공을 가정하지 않고 최대 3초 조건 대기한다."""
    try:
        c.page.wait_for_function(expression, arg=arg, timeout=3000, polling=50)
        return True
    except PlaywrightTimeoutError:
        c.expect(False, f"{label}: 3초 안에 충족되지 않음, 실제 {actual()!r}")
        return False


def _warning(c, label):
    _until(c, "() => !!document.querySelector('#kcp-save-warn')", None,
           f"명세 1 {label} 경고 등장", lambda: c.page.evaluate(WARN_JS))
    info = c.page.evaluate(WARN_JS)
    c.eq(info["count"], 1, f"명세 1·2 {label} 경고 요소 하나")
    c.eq(info["messages"], 1, f"명세 2 {label} 경고 문구를 반복해 쌓지 않음")
    c.eq(info["role"], "alert", f"명세 1 {label} 경고 역할")
    c.expect(TEXT in info["text"], f"명세 1 {label} 필수 문구 {TEXT!r}, 실제 {info!r}")
    c.eq(info["visible"], True, f"명세 1 {label} 보이는 경고: {info!r}")
    inside = (info["left"] is not None and 0 <= info["left"] <= info["right"]
              <= info["viewport"] and info["width"] > 0)
    c.expect(inside, f"명세 6 {label} 경고 좌우 경계가 0..innerWidth 안: 실제 {info!r}")
    c.check(f"명세 6 {label} 경고가 뜬 화면")


def _gone(c, label):
    _until(c, """() => [...document.querySelectorAll('[id="kcp-save-warn"]')]
      .every(e => !e.getClientRects().length || getComputedStyle(e).visibility === 'hidden'
        || getComputedStyle(e).display === 'none')""", None,
           f"명세 3 {label} 경고 사라짐", lambda: c.page.evaluate(WARN_JS))
    c.eq(c.page.locator('[id="kcp-save-warn"]:visible').count(), 0,
         f"명세 3 {label} 보이는 경고 0개")
    c.check(f"명세 6 {label} 회복 화면")


def _prep(c, year="2023"):
    selector = "#q1-23" if year == "2023" else "#r1-solar"
    c.goto(f"#y{year}", wait=selector)
    c.eq(c.page.locator(selector).count(), 1, f"준비실 {year} 입력칸 {selector} 하나")
    c.check(f"명세 6 {year} 준비실")
    return selector


def _saved(c, key, path, expected):
    args = {"key": key, "path": path, "value": expected}
    _until(c, """a => {
      let value; try { value = JSON.parse(localStorage.getItem(a.key)); }
      catch (_) { return false; }
      for (const part of a.path) value = value?.[part];
      return value === a.value;
    }""", args, f"명세 4 {key} 답변 {expected!r} 실제 저장", lambda: c.ls(key))
    value = c.ls(key)
    for part in path:
        value = value.get(part) if isinstance(value, dict) else None
    c.eq(value, expected, f"명세 4 {key} 저장된 답변")


def _fail_input(c, selector, value, key):
    before = c.page.evaluate("window.__saveFailures.length")
    c.page.evaluate("window.__failSave = true")
    c.page.locator(selector).fill(value)
    _until(c, """a => window.__saveFailures.slice(a.before).some(x => x.key === a.key)""",
           {"before": before, "key": key}, f"실패 조건 {key} 지연 쓰기 도달",
           lambda: c.page.evaluate("window.__saveFailures"))
    c.eq(c.page.locator(selector).input_value(), value,
         f"명세 4 {key} 저장 실패 뒤 입력 답변 유지")
    _warning(c, f"{key} 실패")


def _recover_input(c, selector, value, key, path):
    c.page.evaluate("window.__failSave = false")
    # 같은 칸에 한 글자 더 입력하여 회복 저장을 유발한다.
    c.page.locator(selector).fill(value + "가")
    _saved(c, key, path, value + "가")
    return value + "가"


def t_S1_warning_lifecycle(c: Ctx):
    """경고 누락·중복·자동 소멸·회복 뒤 잔류·재실패 미표시를 잡는다."""
    with _observed(c):
        selector = _prep(c)
        for n in range(3):
            draft = f"가상 답변 {n}: 환경과 행복의 변화를 비교한다."
            _fail_input(c, selector, draft, KEY23)

        # 3초 이상 지속 자체가 시간 계약이다. 저장 완료 판정에는 이 대기를 쓰지 않는다.
        c.page.evaluate("window.__warnSince = performance.now()")
        violations = c.page.evaluate("""async snapshot => {
          const read = (0, eval)('(' + snapshot + ')'), bad = [];
          do {
            const s = read();
            if ((!s.visible || s.count !== 1 || s.messages !== 1) && bad.length < 8)
              bad.push({elapsed: performance.now() - window.__warnSince, ...s});
            await new Promise(resolve => setTimeout(resolve, 50));
          } while (performance.now() - window.__warnSince < 3100);
          return {elapsed: performance.now() - window.__warnSince, bad};
        }""", WARN_JS)
        c.expect(violations["elapsed"] >= 3000,
                 f"명세 2 실패 지속 관찰 3초 이상: 실제 {violations!r}")
        c.eq(violations["bad"], [], "명세 2 실패 중 경고를 숨기거나 중복시키지 않음")
        _warning(c, "3초 이상 실패 지속 뒤")
        c.eq(c.page.locator(selector).input_value(), draft, "명세 4 지속 실패 중 답변 유지")

        recovered = _recover_input(c, selector, draft, KEY23, ["game", "q1"])
        _gone(c, "첫 회복")
        _fail_input(c, selector, recovered + " 재실패", KEY23)
        _recover_input(c, selector, recovered + " 재실패", KEY23, ["game", "q1"])
        _gone(c, "두 번째 회복")


def t_S2_failed_draft_survives_rerender(c: Ctx):
    """재그리기가 실패 중 초안을 예전 localStorage 값으로 덮는 버그를 잡는다."""
    with _observed(c):
        selector = _prep(c)
        old = "가상 이전 답변: 과학 지수를 우선한다."
        draft = "가상 새 답변: 행복과 환경도 함께 고려한다."
        c.page.locator(selector).fill(old)
        _saved(c, KEY23, ["game", "q1"], old)
        _fail_input(c, selector, draft, KEY23)
        c.eq((c.ls(KEY23) or {}).get("game", {}).get("q1"), old,
             "명세 4 저장 실패 중 디스크에는 이전 값이 남아 있음")

        if c.page.evaluate("typeof KCP.rerender === 'function'"):
            c.page.evaluate("() => KCP.rerender()")
        else:
            c.phase("room")
            c.phase("prep")
        c.page.wait_for_selector(selector, timeout=3000)
        c.eq(c.page.locator(selector).input_value(), draft,
             "명세 4 같은 연도 재그리기 뒤 실패 중 초안 유지")
        _warning(c, "재그리기 뒤")
        recovered = _recover_input(c, selector, draft, KEY23, ["game", "q1"])
        _gone(c, "초안 저장 회복")
        c.page.reload(wait_until="load")
        c.page.wait_for_selector(selector, timeout=3000)
        c.eq(c.page.locator(selector).input_value(), recovered,
             "명세 4 회복 뒤 재로드해도 새 답변 유지")
        _gone(c, "재로드 뒤")


def t_S3_multiple_keys_need_full_recovery(c: Ctx):
    """다른 키의 성공 한 번만으로 아직 실패한 키의 경고를 지우는 버그를 잡는다."""
    with _observed(c):
        selector23 = _prep(c)
        draft23 = "가상 2023 답변: 이웃과 지수 차이를 비교한다."
        _fail_input(c, selector23, draft23, KEY23)
        selector22 = _prep(c, "2022")
        for n in range(2):
            draft22 = f"가상 2022 이유 {n}: 일사량과 서식지 영향을 비교한다."
            _fail_input(c, selector22, draft22, KEY22)

        recovered22 = _recover_input(c, selector22, draft22, KEY22, ["game", "r1", "solar"])
        # 자동 재시도로 다른 키까지 이미 회복한 구현도 허용한다.
        # 저장값과 경고를 한 JS 호출에서 읽어 판정 사이의 경합을 피한다.
        status = c.page.evaluate("""snapshot => {
          const state = JSON.parse(localStorage.getItem('kcp:v1:2023'));
          return {answer: state?.game?.q1 ?? null,
                  warning: (0, eval)('(' + snapshot + ')')()};
        }""", WARN_JS)
        if status["answer"] != draft23:
            c.expect(status["warning"]["count"] == 1 and status["warning"]["visible"],
                     f"명세 3 다른 키가 아직 실패 중이면 경고 유지: 실제 {status!r}")
            _warning(c, "2022만 회복한 뒤")

        _prep(c)
        c.eq(c.page.locator(selector23).input_value(), draft23,
             "명세 4 여러 연도 왕복 뒤 2023 초안 유지")
        _recover_input(c, selector23, draft23, KEY23, ["game", "q1"])
        _saved(c, KEY22, ["game", "r1", "solar"], recovered22)
        _gone(c, "두 연도 모두 회복")
        _prep(c, "2022")
        c.eq(c.page.locator(selector22).input_value(), recovered22,
             "명세 4 여러 연도 왕복 뒤 2022 회복 답변 유지")


if __name__ == "__main__":
    main(globals(), strict_errors=True)
