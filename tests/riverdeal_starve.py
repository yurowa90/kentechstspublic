"""s-riverdeal 10-13 간헐 실패 단계('새로고침 뒤 #rd-root 대기 30초 초과') 굶주림 재현 도구.

새로고침 직전에 CPU 감속(CDP)을 걸고, RD_AFTER가 있으면 새로고침이 끝난 뒤 #rd-root 대기 동안 더 센 감속을 건다.
2026-10-21 기록(docs/QUALITY-stability.md §4): 새로고침 100배·뒤 0이면 통과(대기 4.1초), 새로고침 200배면 reload 자체가
30초 초과(다른 단계), 새로고침 100배·뒤 400배/1000배면 10-13과 같은 'Page.wait_for_selector #rd-root 30초 초과'.
같은 단계·같은 오류의 재현이며, 10-13 실패가 이것이었다는 증명은 아니다.
사용: RD_AFTER=400 KCP_BASE=$U tests/.venv/bin/python tests/riverdeal_starve.py tests/accept_s-riverdeal.py 100 -k t_12_2_cancel_restore --cfg desktop-light"""
import os, sys, runpy, time
from playwright.sync_api._generated import BrowserContext, Page
script, rate = sys.argv[1], float(sys.argv[2])
after = float(os.environ.get("RD_AFTER", "0"))  # 새로고침이 끝난 뒤 #rd-root 대기 동안의 감속(0이면 그대로)
_new, _reload = BrowserContext.new_page, Page.reload
def new_page(self, *a, **k):
    p = _new(self, *a, **k); p._kcp_cdp = self.new_cdp_session(p); return p
def reload(self, *a, **k):
    self._kcp_cdp.send("Emulation.setCPUThrottlingRate", {"rate": rate})
    t = time.time()
    try:
        return _reload(self, *a, **k)
    finally:
        self._kcp_reloaded = True
        print(f"RELOAD rate={rate} reload {time.time()-t:.1f}s", flush=True)
BrowserContext.new_page, Page.reload = new_page, reload
_wfs = Page.wait_for_selector
def wfs(self, sel, *a, **k):
    if sel == "#rd-root" and after and getattr(self, "_kcp_reloaded", False):
        self._kcp_cdp.send("Emulation.setCPUThrottlingRate", {"rate": after})
    t = time.time()
    try:
        return _wfs(self, sel, *a, **k)
    finally:
        if sel == "#rd-root": print(f"WAIT #rd-root {time.time()-t:.1f}s", flush=True)
Page.wait_for_selector = wfs
sys.path.insert(0, os.path.dirname(os.path.abspath(script)))
sys.argv = [script] + sys.argv[3:]
runpy.run_path(script, run_name="__main__")
