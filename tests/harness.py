"""켄텍 연습실 수용 검사 공통 틀.

검사 모듈은 이 파일을 import하고, 이름이 t_ 로 시작하는 함수를 정의한 뒤 main(globals())를 부른다.

    from harness import main, Ctx

    def t_A1_slots_exist(c: Ctx):
        c.goto("#y2022")
        c.expect(c.page.locator("#prep-top").count() == 1, "A1 준비실 슬롯 #prep-top 1개")

    if __name__ == "__main__":
        main(globals())

규칙
- 검사 함수 하나마다 새 브라우저 컨텍스트를 연다(localStorage가 비어 있는 상태에서 시작).
- 네 환경(데스크톱·모바일 × 라이트·다크)에서 모두 돈다. 특정 환경에서만 의미 있는 검사는 c.cfg.mobile, c.cfg.scheme로 분기한다.
- 콘솔 error·warning, 페이지 오류, 실패한 요청(구글 폰트 제외)은 자동으로 문제로 센다.
- c.check(label)은 그 시점의 가로 스크롤(문서 scrollWidth > clientWidth)을 검사한다.
- 실행: KCP_BASE=<index.html 주소> python accept_X.py [-k 이름조각] [--cfg desktop-light]
"""
import json
import os
import sys
import time
import traceback
from dataclasses import dataclass

from playwright.sync_api import sync_playwright

BASE = os.environ.get("KCP_BASE", "http://127.0.0.1:8765/index.html")


@dataclass
class Cfg:
    name: str
    width: int
    height: int
    scheme: str
    mobile: bool


CONFIGS = [
    Cfg("desktop-light", 1280, 900, "light", False),
    Cfg("desktop-dark", 1280, 900, "dark", False),
    Cfg("mobile-light", 390, 844, "light", True),
    Cfg("mobile-dark", 390, 844, "dark", True),
]

OVERFLOW_JS = """() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const sw = Math.max(de.scrollWidth, document.body.scrollWidth);
  const offenders = [];
  if (sw > vw) {
    const inScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 1 || r.left < -1) && !inScroller(el)) {
        const cls = (el.className && el.className.baseVal !== undefined) ? el.className.baseVal : (el.className || '');
        offenders.push(`<${el.tagName.toLowerCase()} id='${el.id}' class='${String(cls).slice(0, 50)}'> ${Math.round(r.left)}..${Math.round(r.right)}`);
        if (offenders.length >= 6) break;
      }
    }
  }
  return {vw, sw, offenders};
}"""

CONTRAST_JS = """(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return {r:p[0], g:p[1], b:p[2], a: p.length > 3 ? p[3] : 1}; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const fg = parse(getComputedStyle(el).color);
  let bg = null;
  for (let p = el; p; p = p.parentElement) {
    const c = parse(getComputedStyle(p).backgroundColor);
    if (c && c.a > 0.5) { bg = c; break; }
  }
  if (!bg) bg = parse(getComputedStyle(document.body).backgroundColor) || {r:255,g:255,b:255,a:1};
  const L1 = lum(fg), L2 = lum(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}"""


class Ctx:
    """검사 함수에 넘어가는 도구 묶음."""

    def __init__(self, page, cfg, rec, test):
        self.page = page
        self.cfg = cfg
        self.rec = rec
        self.test = test

    # 이동
    def open(self, query=""):
        url = BASE + (query or "")
        self.page.goto(url)
        self.page.wait_for_selector("#app > *", timeout=15000)
        self.page.wait_for_timeout(80)

    def goto(self, hash_, wait=None):
        if self.page.url == "about:blank":
            self.open()
        self.page.evaluate(f"location.hash = {json.dumps(hash_)}")
        if wait:
            self.page.wait_for_selector(wait, timeout=10000)
        self.page.wait_for_timeout(120)

    def phase(self, p):
        self.page.click(f'[data-phase="{p}"]')
        self.page.wait_for_timeout(120)

    def wait_saved(self, ms=400, limit=3000):
        """250ms 지연 저장을 기다린다. 먼저 ms만큼 기다리고(지연 저장 자체를 검증),
        부하로 타이머가 늦어지면 앱의 저장 대기열이 빌 때까지 limit ms 더 기다린다.
        저장값을 대신 쓰지 않으며(flush 아님), 시간이 다 되면 그대로 넘어가 단언이 판정한다."""
        self.page.wait_for_timeout(ms)
        try:
            self.page.wait_for_function(
                "() => !(window.KCP && typeof KCP.savePending === 'function') || KCP.savePending() === 0",
                timeout=limit, polling=50)
        except Exception:
            pass

    def ls(self, key):
        """localStorage 값을 JSON으로 읽는다(없으면 None)."""
        raw = self.page.evaluate(f"localStorage.getItem({json.dumps(key)})")
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return raw

    def contrast(self, sel):
        return self.page.evaluate(CONTRAST_JS, sel)

    # 기록
    def expect(self, cond, msg):
        self.rec["asserts"].append({"test": self.test, "ok": bool(cond), "msg": msg})
        return bool(cond)

    def eq(self, actual, expected, msg):
        ok = actual == expected
        self.rec["asserts"].append({"test": self.test, "ok": ok, "msg": f"{msg} (기대 {expected!r}, 실제 {actual!r})" if not ok else msg})
        return ok

    def check(self, label):
        r = self.page.evaluate(OVERFLOW_JS)
        if r["sw"] > r["vw"]:
            self.rec["overflow"].append({"test": self.test, "where": label, **r})


def _run_cfg(pw, cfg, tests, only):
    rec = {"asserts": [], "console": [], "pageerrors": [], "failed": [], "overflow": [], "exceptions": []}
    browser = pw.chromium.launch()
    for name, fn in tests:
        if only and not any(o in name for o in only):
            continue
        ctx = browser.new_context(viewport={"width": cfg.width, "height": cfg.height}, color_scheme=cfg.scheme,
                                  is_mobile=cfg.mobile, has_touch=cfg.mobile, locale="ko-KR")
        page = ctx.new_page()
        page.on("console", lambda m, n=name: rec["console"].append({"test": n, "type": m.type, "text": m.text}) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e, n=name: rec["pageerrors"].append({"test": n, "text": str(e)}))
        page.on("requestfailed", lambda r, n=name: rec["failed"].append({"test": n, "url": r.url, "err": r.failure}))
        c = Ctx(page, cfg, rec, name)
        try:
            c.open()
            fn(c)
        except Exception as e:  # noqa: BLE001
            rec["exceptions"].append({"test": name, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1200:]})
        ctx.close()
    browser.close()
    return rec


def main(ns, *, strict_errors=False):
    args = sys.argv[1:]
    only, cfgs = [], [c.name for c in CONFIGS]
    while args:
        a = args.pop(0)
        if a == "-k" and args:
            only.append(args.pop(0))
        elif a == "--cfg" and args:
            cfgs = [args.pop(0)]
    tests = sorted(((k, v) for k, v in ns.items() if k.startswith("t_") and callable(v)), key=lambda kv: kv[0])
    t0 = time.time()
    out = {}
    with sync_playwright() as pw:
        for cfg in CONFIGS:
            if cfg.name in cfgs:
                out[cfg.name] = _run_cfg(pw, cfg, tests, only)
    res_path = os.environ.get("KCP_RESULT")
    if res_path:
        with open(res_path, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
    bad = 0
    print(f"{'config':14} {'asserts':>9} {'console':>8} {'pageerr':>8} {'overflow':>9} {'except':>7}")
    for name, r in out.items():
        ok = sum(1 for a in r["asserts"] if a["ok"])
        tot = len(r["asserts"])
        # D-76 검사 작성 지시: 새 연도 검사는 콘솔 error/warning·실패 요청 모두 0.
        # 기존 호출의 판정은 유지하고, 명시한 새 검사에서만 광범위한 폰트 제외를 끈다.
        cons = r["console"] if strict_errors else [c for c in r["console"] if "fonts.g" not in c["text"]]
        fails = r["failed"] if strict_errors else [f for f in r["failed"] if "fonts.g" not in f["url"]]
        n_bad = (tot - ok) + len(cons) + len(r["pageerrors"]) + len(r["overflow"]) + len(r["exceptions"]) + len(fails)
        bad += n_bad
        print(f"{name:14} {ok:>4}/{tot:<4} {len(cons):>8} {len(r['pageerrors']):>8} {len(r['overflow']):>9} {len(r['exceptions']):>7}")
        for a in r["asserts"]:
            if not a["ok"]:
                print(f"   FAIL [{a['test']}] {a['msg']}")
        for c in cons:
            print(f"   CONSOLE[{c['type']}] [{c['test']}] {c['text'][:200]}")
        for e in r["pageerrors"]:
            print(f"   PAGEERROR [{e['test']}] {e['text'][:200]}")
        for f in fails:
            print(f"   REQFAIL [{f['test']}] {f['url'][:100]} {f['err']}")
        for o in r["overflow"]:
            print(f"   OVERFLOW [{o['test']}] {o['where']}: {o['sw']} > {o['vw']} :: {' | '.join(o['offenders'][:3])}")
        for ex in r["exceptions"]:
            print(f"   EXCEPTION [{ex['test']}] {ex['error'][:300]}")
    print(f"\n{time.time() - t0:.1f}s, problems: {bad}")
    sys.exit(1 if bad else 0)
