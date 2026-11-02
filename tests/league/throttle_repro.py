"""부하 간헐 오류 재현 도구: 기존 리그 검사 스크립트를 그대로 돌리되 모든 페이지에
CPU 감속(CDP)·pageerror 스택·지도 전환(selectPack) 최근 기록을 붙인다.
사용: tests/.venv/bin/python tests/league/throttle_repro.py tests/league/e2e2.py http://127.0.0.1:<포트>/index.html 6 <출력파일>
2026-10-10 'reading kind' 간헐 오류(e2e·e2e2)를 6배 감속에서 3/3 재현하고 원인(검사의 evaluate(AUTO)가
__auto를 인자 없이 호출 → selectPack(null))을 찾는 데 썼다."""
import sys, runpy
from playwright.sync_api._generated import BrowserContext, Browser

script, url, rate, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
log = open(out, "a")
INIT = """
(() => {
  window.__packLog = [];
  const wrap = () => {
    const B = window.KCP && window.KCP.buildGame;
    if (!B || B.__wrapped) return !!(B && B.__wrapped);
    const orig = B.selectPack;
    B.selectPack = function (id, mode) {
      const st = (new Error().stack || '').split('\\n').slice(2, 6).map(x => x.trim()).join(' <- ');
      window.__packLog.push(`${performance.now().toFixed(0)} ${id}/${mode} ${st}`);
      if (window.__packLog.length > 12) window.__packLog.shift();
      return orig.apply(this, arguments);
    };
    B.__wrapped = true; return true;
  };
  const iv = setInterval(() => { if (wrap()) clearInterval(iv); }, 5);
  window.addEventListener('error', e => {
    if (String(e.message).includes("reading 'kind'")) console.info('PACKLOG\\n' + window.__packLog.join('\\n'));
  });
})();
"""


def instrument(page):
    try:
        s = page.context.new_cdp_session(page)
        s.send("Emulation.setCPUThrottlingRate", {"rate": rate})
    except Exception as e:
        log.write(f"cdp fail {e}\n")
    page.add_init_script(INIT)
    page.on("console", lambda m: m.type == "info" and m.text.startswith("PACKLOG") and (log.write(m.text + "\n"), log.flush()))
    page.on("pageerror", lambda e: (log.write(f"== {page.url}\n{e.stack}\n"), log.flush()))
    return page

_ctx_new = BrowserContext.new_page
def ctx_new_page(self, *a, **k): return instrument(_ctx_new(self, *a, **k))
BrowserContext.new_page = ctx_new_page
_br_new = Browser.new_page
def br_new_page(self, *a, **k): return instrument(_br_new(self, *a, **k))
Browser.new_page = br_new_page

import os; sys.path.insert(0, os.path.dirname(os.path.abspath(script))); sys.argv = [script, url]
runpy.run_path(script, run_name="__main__")
