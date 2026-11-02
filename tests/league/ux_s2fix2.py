"""시각 결함 A1~A6. 구현 파일을 읽지 않고 사용자 명세로 작성한다.

샌드박스 밖 로컬 총괄 실행:
  tests/.venv/bin/python tests/league/ux_s2fix2.py <주소> \
    [--cfg desktop|tablet|mobile|all] [--out <폴더>]
진행은 화면 단추, evaluate는 공개 상태 조회·DOM 관측·스크롤에만 쓴다.
"""

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright

from league_flow import pass_issue_check, wait_unfolded
from solo import CHANGED_JS, close_drawer, read
from ux_task import CFG


RESULTS = Path(__file__).resolve().parents[1] / "results"
RESULT_CARD = 'article[data-forecast="false"]'
BAR_NAME = re.compile(r"^(\d+)위 (.+), 종합 (\d+(?:\.\d)?)점\(100점 만점\)$")

# 독립 DOM 관측 도구. 구현의 위치 계산 함수/사설 클래스는 사용하지 않는다.
DOM_JS = r"""(() => {
  const visible=e=>{
    if(!e || !e.getClientRects().length) return false;
    const r=e.getBoundingClientRect(); if(r.width<=0 || r.height<=0) return false;
    for(let p=e;p;p=p.parentElement) {
      const s=getComputedStyle(p);
      if(p.hidden || s.display==='none' || /hidden|collapse/.test(s.visibility) || +s.opacity===0)
        return false;
      if(p.tagName==='DETAILS' && !p.open && !p.querySelector('summary')?.contains(e)) return false;
    }
    return true;
  };
  const box=e=>{if(!e)return null; const r=e.getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const area=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
    Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  const inside=(a,b,t=1)=>!!a&&!!b&&a.left>=b.left-t&&a.right<=b.right+t&&
    a.top>=b.top-t&&a.bottom<=b.bottom+t;
  const accessible=e=>(e.getAttribute('aria-label')||
    (e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim()||
    e.querySelector(':scope > title')?.textContent||e.getAttribute('alt')||e.getAttribute('title')||'')
    .replace(/\s+/g,' ').trim();
  const spark=e=>[...e.querySelectorAll('.bd-spark')].some(visible);
  // visibility:hidden이어도 도크 상자는 위치 기준이다. 상자가 없을 때만 화면 아래끝−8px.
  const dockTop=()=>{
    const d=box(document.querySelector('#bd-dock'));
    return d&&d.width>0&&d.height>0?d.top:innerHeight-8;
  };
  const mapBox=()=>{
    const r=box(document.querySelector('#bd-canvas')); if(!r)return null;
    // A4의 기존 캔버스 중심 관측은 유지한다.
    const left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),
      top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
    return right>left&&bottom>top?{left,right,top,bottom,width:right-left,height:bottom-top}:null;
  };
  const visibleMapBox=()=>{
    const top=Math.max(0,...['#lg-bar','#bd-mapbar','#bd-hud'].map(s=>
      box(document.querySelector(s))?.bottom||0)),bottom=dockTop(),left=0;
    const panel=document.querySelector('#lg-panel'),p=box(panel),
      fold=document.querySelector('#lg-panel-fold');
    const folded=fold?.getAttribute('aria-expanded')==='false'||
      /펼치기/.test(fold?.textContent||'');
    const right=visible(panel)&&!folded&&p.width<innerWidth*.9?p.left:innerWidth;
    return right>left&&bottom>top?{left,right,top,bottom,width:right-left,height:bottom-top}:null;
  };
  const run=()=>{
    const e=document.querySelector('#bd-run'),dock=document.querySelector('#bd-dock');
    const r=box(e),d=box(dock),m=visibleMapBox(),pts=[];
    if(m) {
      const x=(m.left+m.right)/2,y=(m.top+m.bottom)/2;
      for(const [dx,dy] of [[0,0],[0,-.25],[0,.25],[-.25,0],[.25,0]]) {
        const px=x+m.width*dx,py=y+m.height*dy,hit=document.elementFromPoint(px,py);
        pts.push({x:px,y:py,hit:hit?.id||hit?.tagName,covered:!!e&&!!hit&&(e===hit||e.contains(hit))});
      }
    }
    const toast=document.querySelector('#bd-toast[data-show="true"]');
    const toggles=[...(e?.querySelectorAll('button')||[])].filter(b=>
      /그래프 (열기|접기)/.test(b.textContent));
    const toggle=toggles[0];
    const skip=document.querySelector('#bd-skip');
    const live=window.KCP?.league?.state?.(),s=live?.S||live?.snap;
    return {shown:visible(e),dock:visible(dock),box:r,dockBox:d,dockTop:dockTop(),map:m,points:pts,
      replayEnded:s?.phase==='review'&&window.KCP?.fxTurn?.state?.().playing!==true,
      toggleCount:toggles.length,
      toggle:toggle?{text:toggle.textContent.trim(),expanded:toggle.getAttribute('aria-expanded'),
        controls:toggle.getAttribute('aria-controls'),box:box(toggle),shown:visible(toggle)}:null,
      spark:!!e&&spark(e),skip:{shown:visible(skip),box:box(skip)},
      toast:visible(toast),toastOverlap:visible(toast)?area(r,box(toast)):0};
  };
  const title=(h,excludeControls=false)=>{
    const style=getComputedStyle(h),nodes=[],walker=document.createTreeWalker(h,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())) {
      if(node.parentElement?.closest('[aria-hidden="true"]')||
        (excludeControls&&node.parentElement?.closest('button'))) continue;
      nodes.push(node);
    }
    const text=excludeControls?nodes.map(n=>n.textContent).join('').trim():h.textContent.trim();
    // A5의 두 대안 중 keep-all이면 계산 스타일로 판정한다. 그 외에는
    // 텍스트 노드마다 한 글자 Range를 만들고 같은 y의 글자를 한 줄로 묶는다.
    // 줄 사이에 공백이 있거나 앞 줄이 문장부호로 끝나야 한다.
    if(style.wordBreak==='keep-all') return {text,method:'word-break:keep-all',ok:true};
    const chars=[];
    let index=0,full='';
    for(const node of nodes) {
      const offset=full.length;full+=node.textContent;
      for(let i=0;i<node.length;i++) {
        const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);
        const r=range.getBoundingClientRect(),c=node.textContent[i];
        if(r.width>0&&r.height>0&&!/\s/.test(c)) chars.push({i:offset+i,c,y:r.top});
      }
    }
    const breaks=[];
    for(index=1;index<chars.length;index++) if(Math.abs(chars[index].y-chars[index-1].y)>1) {
      const a=chars[index-1],b=chars[index],between=full.slice(a.i+1,b.i);
      breaks.push({before:a.c,after:b.c,between,ok:/\s/.test(between)||/[.!?…。！？]/.test(a.c)});
    }
    return {text,method:'Range line ends',ok:chars.length>0&&breaks.every(b=>b.ok),breaks};
  };
  return {visible,box,area,inside,accessible,run,mapBox,title};
})()"""

# 재생·토스트는 짧다. 캡처 대기보다 먼저 매 프레임에서 관측한다.
# 관찰자는 앱 상태·함수·시간을 바꾸지 않는다. Python에서 arm()한 구간만 저장한다.
PROBE_JS = r"""(() => {
  const D=""" + DOM_JS + r""";
  // 상자만으로는 CSS 3D 카드의 숨은 뒷면을 구별할 수 없다.
  // aria-hidden과 backface-visibility도 확인해 실제 보이는 면만 관측한다.
  const exposed=e=>{
    if(!D.visible(e)||e.closest('[aria-hidden="true"]'))return false;
    const r=e.getBoundingClientRect();
    if(r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;
    for(let face=e;face;face=face.parentElement) {
      if(getComputedStyle(face).backfaceVisibility!=='hidden')continue;
      let matrix=new DOMMatrix();
      for(let p=face;p;p=p.parentElement) {
        const transform=getComputedStyle(p).transform;
        if(transform!=='none')matrix=new DOMMatrix(transform).multiply(matrix);
      }
      if(matrix.inverse().m33<=0)return false;
    }
    return true;
  };
  window.__ux2={armed:false,clickAt:null,firstRun:null,runs:[],result:[],stripTitles:[],frames:0};
  document.addEventListener('click',()=>{const q=window.__ux2;
    if(q.armed&&!q.firstRun) q.clickAt=performance.now();},true);
  let scheduled=false;
  // record: 지금 화면을 한 번 기록한다(rAF 예약·frames 수는 건드리지 않는다). sample은 rAF마다 record를 부른다.
  const record=()=>{
    const q=window.__ux2;if(!q.armed)return;
    const now=performance.now(),r=D.run();
    if(r.shown && r.skip.shown) {
      if(!q.firstRun) q.firstRun={at:now,elapsed:q.clickAt==null?null:now-q.clickAt,...r};
      if(q.runs.length<400)q.runs.push({at:now,...r});
    }
    const live=window.KCP?.league?.state?.(),s=live?.S||live?.snap;
    const resultPhase=s?.round===1&&s.phase==='review';
    const cards=[...document.querySelectorAll('article[data-forecast="false"]')].filter(exposed);
    if(resultPhase) {
      for(const strip of [...document.querySelectorAll('.fx-turn-strip, .fx-turn-layer[data-strip="true"]')].filter(exposed)) {
        // 조작 단추의 글자는 빼고, 접힌 띠에 실제 배치된 제목 글자의 Range를 잰다.
        const texts=document.createTreeWalker(strip,NodeFilter.SHOW_TEXT);
        const candidates=[];let textNode;
        while((textNode=texts.nextNode())) {
          if(textNode.textContent.trim()&&!textNode.parentElement.closest('button')&&
            exposed(textNode.parentElement))
            candidates.push(textNode);
        }
        // 장식 기호나 '외 1장'보다 긴 제목 본문을 담은 요소를 고른다.
        candidates.sort((a,b)=>b.textContent.trim().length-a.textContent.trim().length);
        if(candidates.length) {
          const title=D.title(candidates[0].parentElement,true);
          if(title.text)q.stripTitles.push({at:now,...title});
        }
      }
    }
    if(resultPhase&&cards.length) {
      const toast=document.querySelector('#bd-toast[data-show="true"]');
      const headings=cards.flatMap(c=>[...c.querySelectorAll('h3')])
        .filter(h=>exposed(h)&&h.textContent.trim());
      q.result.push({at:now,expectedTitles:headings.map(h=>h.textContent.trim()),
        titles:headings.map(h=>D.title(h)),cards:cards.map(D.box),
        toast:D.visible(toast)&&toast.textContent.includes('결과가 나왔어요'),
        overlaps:D.visible(toast)?cards.map(c=>D.area(D.box(c),D.box(toast))):[]});
    }
  };
  const sample=()=>{
    scheduled=false;const q=window.__ux2;if(!q.armed)return;
    q.frames++;record();
    if(q.armed) {scheduled=true;requestAnimationFrame(sample);}
  };
  // #56: 움직임 줄이기 시험에서 page.clock을 멈춘 동안(rAF가 돌지 않음) 조작 직후 같은 기록을 한 번 남긴다.
  window.__ux2Record=()=>{record();return window.__ux2.runs.length;};
  window.__ux2Arm=()=>{Object.assign(window.__ux2,{armed:true,clickAt:null,firstRun:null,
    runs:[],result:[],stripTitles:[],frames:0});if(!scheduled){scheduled=true;requestAnimationFrame(sample);}};
})();"""


def shown(page, selector):
    return page.locator(selector).evaluate_all("es=>es.some((" + DOM_JS + ").visible)")


def frame(page):
    page.evaluate("() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")


class Suite:
    def __init__(self, cfg, out):
        self.cfg, self.out = cfg, out
        self.rows, self.events, self.cases = [], [], []
        self.freeze_shots = False
        self.clock_held = False
        self.clock_advanced = 0
        out.mkdir(parents=True, exist_ok=True)

    def check(self, condition, name, detail=None):
        ok = bool(condition)
        self.rows.append({"name": name, "pass": ok, "detail": detail})
        print(f'{"PASS" if ok else "FAIL"} {self.cfg} {name}' +
              (f" ({json.dumps(detail, ensure_ascii=False)})" if not ok and detail is not None else ""), flush=True)
        return ok

    def info(self, name, detail):
        print(f"INFO {self.cfg} {name} {json.dumps(detail, ensure_ascii=False)}", flush=True)

    def shot(self, page, name):
        target = self.out / f"{self.cfg}-{name}.png"
        try:
            # animations='disabled'는 관측 중인 재생을 바꾸므로 쓰지 않는다.
            page.screenshot(path=str(target), timeout=10000)
            self.cases.append({"scene": name, "capture": str(target)})
        except Exception as exc:
            self.check(False, name + " 캡처", str(exc))

    def window_shot(self, page, name):
        """시험 운전 창 안의 증거 캡처. 이 판에 가짜 시계가 있으면 캡처하는 동안 앱 시간을 멈춘다.

        움직임 줄이기 시험은 앱 설계상 약 0.57초 만에 끝난다(150ms 간격 4번 + 120ms). 캡처 한 장은 맥에서
        80~95ms, CI 리눅스에서 그보다 길어 캡처가 그 창을 써 버리면 뒤의 조작·단언 전에 띠가 사라진다.
        시험 운전 띠 조작 동안 이미 시계를 멈췄으면(hold_clock) 그대로 찍는다.
        """
        if not self.freeze_shots or self.clock_held:
            self.shot(page, name)
            return
        self.pause_clock(page)
        try:
            self.shot(page, name)
        finally:
            page.clock.resume()

    @staticmethod
    def pause_clock(page):
        for attempt in range(5):
            try:
                # 페이지 시계의 지금보다 1ms 뒤에서 멈춘다. 그사이 시계가 지나가 '과거' 오류가 나면 다시 읽는다.
                page.clock.pause_at(page.evaluate('() => Date.now()') / 1000 + 0.001)
                return
            except Exception as exc:
                if 'past' not in str(exc) or attempt == 4:
                    raise

    # #56: 움직임 줄이기 시험의 첫 진행 틱은 누른 뒤 150ms(build.js startRun reduced 갈래, 150ms 간격 4번 + 120ms 뒤 끝).
    # 시계를 멈춘 채 앞당기는 앱 시각의 총량을 이보다 작게 묶어, 조작하는 동안 진행 틱이 한 번도 돌지 않게 한다.
    ADVANCE_STEP_MS = 16
    ADVANCE_LIMIT_MS = 120

    def hold_clock(self, page):
        """#56: 움직임 줄이기 시험 운전을 누르기 전에 이 판의 page.clock을 멈춘다(가짜 시계가 있는 판만).

        예전 설계는 캡처 동안만 멈추고 조작·관측은 실제 시간에서 했다. 이 시험은 앱 설계상 약 0.57초(앱 시각) 만에
        끝나고, 맥 4·6배 감속 재현(88f0f67)에서 띠가 약 0.85초 뒤 숨은 다음 '그래프 접기' 클릭이 숨은 단추를 15초
        기다리다 끝났다(누를 때 bd-running false·#bd-run hidden true, 원인 '사라짐' 확정). 첫 띠 관측 직후에 멈춘 판
        (9bb8afc)도 6배에서 멈추기까지의 왕복 사이에 운영이 끝난 일이 1/3 있었다. 이 판이 재는 것은 띠가 보이는 동안
        펼치기·접기·건너뛰기가 되는지와 그때의 배치이고, 0.57초 안에 사람이 조작할 수 있는지가 아니므로(움직임 줄이기는
        일부러 짧다), 시험을 누르기 전에 시계를 멈추고 띠가 보일 때까지만 16ms씩 앞당긴 뒤(advance_until_strip,
        총량 ≤120ms) 그 상태에서 조작하고, 건너뛰기를 누른 뒤 푼다. 단언과 기대값은 그대로다. 시험 시작·펼치기·접기·
        건너뛰기 클릭 처리기는 타이머 없이 바로 돌므로 시계가 멈춰도 결과가 같다. 멈춘 동안 rAF 관찰자 표본은 돌지 않아
        조작 직후 __ux2Record로 같은 기록을 한 번씩 남긴다.
        """
        if not self.freeze_shots or self.clock_held:
            return False
        self.pause_clock(page)
        self.clock_held = True
        self.clock_advanced = 0
        return True

    def advance_until_strip(self, page, name):
        """시계를 멈춘 채 시험을 누른 뒤, 띠와 건너뛰기가 보일 때까지 앱 시각을 16ms씩 앞당긴다(총량 ≤120ms)."""
        seen_js = '() => {const r=(' + DOM_JS + ').run();return r.shown&&r.skip.shown;}'
        while not page.evaluate(seen_js):
            if self.clock_advanced + self.ADVANCE_STEP_MS > self.ADVANCE_LIMIT_MS:
                state = page.evaluate('() => (' + DOM_JS + ').run()')
                raise AssertionError(
                    f'BLOCKED {name} 시험 띠 관측 전 앞당김 한도 {self.ADVANCE_LIMIT_MS}ms 초과'
                    f'(앞당긴 {self.clock_advanced}ms): 띠 {state["shown"]} 건너뛰기 {state["skip"]["shown"]}')
            page.clock.run_for(self.ADVANCE_STEP_MS)
            self.clock_advanced += self.ADVANCE_STEP_MS
        page.evaluate('() => window.__ux2Record()')
        self.info(name + ' 시험 띠 관측까지 앞당긴 앱 시각(ms)', self.clock_advanced)

    def record_held(self, page):
        """시계를 멈춘 동안(rAF 표본 없음) 조작 직후 관찰자 기록을 한 번 남긴다. 시계가 돌면 rAF 표본이 맡는다."""
        if self.clock_held:
            page.evaluate('() => window.__ux2Record()')

    def release_clock(self, page, quiet=False):
        """멈춘 시계를 푼다. quiet=True(finally 경로)면 페이지가 닫혔거나 풀기가 실패해도 원래 예외를 가리지 않는다."""
        if not self.clock_held:
            return
        self.clock_held = False
        if quiet:
            if page is None or page.is_closed():
                return
            try:
                page.clock.resume()
            except Exception as exc:
                self.info('시계 풀기 실패(원래 예외 유지)', f'{type(exc).__name__}: {str(exc).splitlines()[0][:120]}')
            return
        page.clock.resume()

    def overflow(self, page, name):
        size = page.evaluate("() => ({width:innerWidth,scroll:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)})")
        self.check(size['scroll'] <= size['width'], name + " 가로 스크롤 0", size)

    def case(self, browser, base, name, fn, reduced=False, freeze_shots=False):
        ctx = page = None
        self.freeze_shots = False
        self.clock_held = False
        try:
            ctx = browser.new_context(**CFG[self.cfg], color_scheme="light", locale="ko-KR",
                                      reduced_motion="reduce" if reduced else "no-preference")
            ctx.add_init_script(PROBE_JS)
            page = ctx.new_page()
            page.set_default_timeout(15000)
            if freeze_shots:
                # 문서가 열리기 전에 설치한다. 판 중간에 설치하면 performance.now()가 0부터 다시 시작해
                # 앱이 미리 잰 시각보다 작아진다. 설치 뒤 시계는 실제 시간과 같은 속도로 흐르며
                # 시험 운전(hold_clock: 시험 누르기 전~건너뛰기 클릭, 그 사이 앞당김 ≤120ms)과 window_shot 캡처 동안에만 멈춘다.
                page.clock.install()
                self.freeze_shots = True
            def event(kind, message):
                rec = {"case": name, "kind": kind, "message": str(message)}
                self.events.append(rec)
                self.check(False, name + " " + kind, str(message))
            page.on('console', lambda m: event(m.type, m.text) if m.type in ('error', 'warning') else None)
            page.on('pageerror', lambda exc: event('pageerror', exc))
            page.on('dialog', lambda d: d.accept())
            # ux_s2fix.Suite.run_once와 같은 빈 context → 로비 → 혼자 하기 경로.
            page.goto(base.split('#', 1)[0] + '#league')
            page.wait_for_selector('.lg-modes [data-mode="solo"]')
            page.wait_for_timeout(800)
            page.locator('.lg-modes [data-mode="solo"]').click()
            length = page.locator('[data-select="lg-solo-turns"][data-value="12"]')
            length.click()
            page.locator('#lg-solo-start').click()
            page.wait_for_selector('#lg-coach', timeout=60000)
            page.wait_for_timeout(1200)
            for selector in ('#lg-coach-close', '#lg-guide-close'):
                if shown(page, selector):
                    page.locator(selector).click()
            # 코치를 닫은 뒤 예보가 지도를 가리지 않게 화면 Esc를 사용한다.
            page.keyboard.press('Escape')
            close_drawer(page)
            fn(page, name)
        except Exception as exc:
            self.check(False, name + " 진행 예외", f"{type(exc).__name__}: {exc}")
            if page is not None:
                self.shot(page, name + '-failure')
        finally:
            if page is not None and not page.is_closed():
                try:
                    self.overflow(page, name + " 마지막")
                except Exception as exc:
                    self.check(False, name + " 종료 검사 예외", str(exc))
            if ctx is not None:
                ctx.close()
            self.freeze_shots = False
            self.clock_held = False

    def summary(self):
        passed = sum(r['pass'] for r in self.rows)
        return {"cfg": self.cfg, "pass": passed, "fail": len(self.rows)-passed,
                "assertions": self.rows, "events": self.events, "scenes": self.cases,
                "browser_environment": "실행 담당자가 샌드박스 밖 로컬 여부 확인 필요"}

    def hud(self, page, name):
        data = page.evaluate("""() => {const D=""" + DOM_JS + """;
          const caps=[...document.querySelectorAll('.lg-team-map .bd-cap')].filter(D.visible);
          return {caps:caps.map(e=>{const k=e.querySelector('.v2-cap-k'),v=e.querySelector('.v2-cap-v');
            return {text:e.textContent,box:D.box(e),key:D.box(k),value:D.box(v),
              inside:D.inside(D.box(k),D.box(e))&&D.inside(D.box(v),D.box(e)),
              font:v?parseFloat(getComputedStyle(v).fontSize):0,
              overflow:v?getComputedStyle(v).textOverflow:null,
              scroll:v?.scrollWidth,client:v?.clientWidth};}),
            overlaps:caps.flatMap((a,i)=>caps.slice(i+1).map(b=>({a:a.textContent,b:b.textContent,
              x:Math.max(0,Math.min(D.box(a).right,D.box(b).right)-Math.max(D.box(a).left,D.box(b).left)),
              y:Math.max(0,Math.min(D.box(a).bottom,D.box(b).bottom)-Math.max(D.box(a).top,D.box(b).top))})))};
        }""")
        self.check(bool(data['caps']), name + " A1 HUD 캡슐 존재", data)
        for i, c in enumerate(data['caps']):
            self.check(c['inside'], f"{name} A1 캡슐 {i+1} 이름·값 내부 ±1px", c)
            self.check(c['font'] >= 10, f"{name} A1 캡슐 {i+1} 값 글자 ≥10px", c)
            # A1은 ellipsis 스타일 자체가 아니라 실제 잘림을 금지한다(명시한 scrollWidth 식).
            self.check(c['scroll'] is not None and c['scroll'] <= c['client']+1,
                       f"{name} A1 캡슐 {i+1} 값 잘림 0", c)
        # A1의 '1px 테두리 맞닿음 허용': 두 축 중 하나라도 교차 폭 ≤1px이면 허용.
        self.check(all(o['x'] <= 1 or o['y'] <= 1 for o in data['overlaps']),
                   name + " A1 캡슐 쌍 겹침 0(테두리 1px 허용)", data['overlaps'])
        self.shot(page, name)
        self.overflow(page, name)

    def actions(self, page, name):
        data = page.evaluate("""() => {const D=""" + DOM_JS + """;
          const a=document.querySelector('#lg-bar .lg-actions'),ready=document.querySelector('#lg-ready');
          const clip=b=>{const r=D.box(b),q=D.box(a);return {left:Math.max(0,r.left,q.left),
            right:Math.min(innerWidth,r.right,q.right),top:Math.max(0,r.top,q.top),
            bottom:Math.min(innerHeight,r.bottom,q.bottom)};};
          return {a:D.box(a),ready:D.box(ready),buttons:[...(a?.querySelectorAll('button')||[])]
            .filter(b=>D.visible(b)&&clip(b).right>clip(b).left&&clip(b).bottom>clip(b).top)
            .map(b=>({text:b.textContent.trim(),overlap:D.area(clip(b),D.box(ready))}))};}
        """)
        self.check(bool(data['a']) and bool(data['ready']) and bool(data['buttons']), name + ' A2 막대 존재', data)
        for i, b in enumerate(data['buttons']):
            self.check(b['overlap'] == 0, f"{name} A2 보이는 단추 {i+1} 준비와 교차 0", b)
        a, ready = data['a'], data['ready']
        same_line = a and ready and min(a['bottom'], ready['bottom']) > max(a['top'], ready['top'])
        self.check(bool(a and ready) and (not same_line or a['right'] <= ready['left']-4),
                   name + ' A2 같은 줄 행동 영역 오른쪽 여백 ≥4px', data)
        for title in ('사건·거래', '지역 지도', '연구', '결과', '일지', '도시', '순위'):
            buttons = page.locator('#lg-bar .lg-actions').get_by_role('button', name=title, exact=True)
            if not self.check(buttons.count() == 1, name + ' A2 단추 존재 ' + title, buttons.count()):
                continue
            b = buttons.first
            # 정해진 .lg-actions의 scrollLeft만 변경한다. transform/폭을 고치지 않는다.
            b.evaluate("""b=>{const a=b.closest('.lg-actions'),r=b.getBoundingClientRect(),q=a.getBoundingClientRect();
              a.scrollTo({left:a.scrollLeft+(r.left+r.right-q.left-q.right)/2,behavior:'instant'});}""")
            frame(page)
            hit = b.evaluate("""b=>{const r=b.getBoundingClientRect(),a=b.closest('.lg-actions').getBoundingClientRect(),h=document.elementFromPoint(
              (r.left+r.right)/2,(r.top+r.bottom)/2);return {inside:r.left>=0&&r.right<=innerWidth&&
              r.top>=0&&r.bottom<=innerHeight&&r.left>=a.left&&r.right<=a.right,
              hit:h===b,tag:h?.tagName,id:h?.id};}""")
            self.check(hit['inside'] and hit['hit'], name + ' A2 스크롤 뒤 노출·중심 hit ' + title, hit)
        self.shot(page, name + '-actions')
        self.overflow(page, name + '-actions')

    def strip_assert(self, condition, name, record, trial, detail=None):
        # 시험 운전은 항상 필수다. 실제 운영만 자연 종료로 없어진 해당 관측을 INFO로 남긴다.
        if not trial and not record['shown'] and record['replayEnded']:
            self.info(name, {'observed': 0, 'reason': '1월 재생 종료로 띠 사라짐'})
            return False
        return self.check(condition, name, record if detail is None else detail)

    def strip_click(self, page, locator, trial):
        try:
            locator.click(timeout=15000 if trial else 1000)
        except PlaywrightTimeoutError as exc:
            current = page.evaluate('() => (' + DOM_JS + ').run()')
            if not trial and not current['shown'] and current['replayEnded']:
                return False  # 다음 관측 단언이 해당 항목을 INFO로 기록한다.
            # #56: CI 판정 표는 실패 줄을 300자에서 잘라 Playwright 호출 기록 끝(재시도 까닭: 안 보임·안정 대기·가림)이
            # 남지 않았다(#82 CI desktop reduce-trial '그래프 접기'). 원인을 가를 사실을 앞에 두고 같은 예외 종류로 다시 던진다
            # (예외 종류는 TimeoutError 그대로). 띠 보임·운영 중 표시, 시험 누른 뒤 앱 시각(ms), 누르려던 단추의 상자,
            # 그 가운데의 맨 위 요소, 호출 기록 마지막 세 줄. 첫머리는 원래 첫 줄(Locator.click: …)이라 대기 예외임이 그대로 보인다.
            facts_js = """b => {
              const q=window.__ux2,r=b?.getBoundingClientRect();
              const top=r&&r.width?document.elementFromPoint(r.left+r.width/2,r.top+r.height/2):null;
              return {sinceTrialClick:q?.clickAt==null?null:Math.round(performance.now()-q.clickAt),
                running:document.documentElement.classList.contains('bd-running'),runHidden:!!document.querySelector('#bd-run')?.hidden,
                box:r?[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]:null,
                topAtCenter:top?(b&&b.contains(top)?'단추':top.id||(typeof top.className==='string'&&top.className)||top.tagName):null};
            }"""
            try:
                facts = locator.evaluate(facts_js, timeout=1000)
            except Exception:
                try:
                    facts = page.evaluate(facts_js.replace('b => {', '() => { const b=null;', 1))
                except Exception as probe_exc:
                    facts = f'사실 읽기 실패 {type(probe_exc).__name__}'
            calls = [line.strip() for line in str(exc).splitlines() if line.strip().startswith('-')]
            # 판정 표(300자)에는 앞의 사실이 남고, 원시 로그에는 호출 기록 전체가 뒤에 남는다.
            raise PlaywrightTimeoutError(
                f"{str(exc).splitlines()[0][:60]} · 띠 보임 {current['shown']} · {json.dumps(facts, ensure_ascii=False)} · "
                f"호출 기록 끝 {calls[-3:]} · 호출 기록 전체 {calls}") from exc
        return True

    def run_strip(self, page, name, trial=False, reduced=False):
        # #56: 움직임 줄이기 시험은 trial()이 누르기 전에 시계를 멈췄다(hold_clock). 여기서는 이미 멈췄으면 그대로 둔다.
        held = trial and self.hold_clock(page)
        try:
            q = page.evaluate('() => window.__ux2')
            first = q['firstRun']
            if not trial and reduced and not first:
                self.info(name + ' A3 재생 중 운영 띠 관측',
                          {'observed': 0, 'reason': '움직임 줄이기 즉시 재생'})
                return
            self.check(bool(first), name + ' A3 재생 중 운영 띠 관측', first)
            if trial:
                self.check(bool(first) and first['elapsed'] is not None and first['elapsed'] <= 500,
                           name + ' A3 시험 누른 뒤 500ms 안 띠 표시', first)
            if not first:
                return
            self.strip_geometry(first, name + ' 최초')
            if not trial:
                # 1월은 재생 중 관찰자 기록만 판정한다. 카드 밖 클릭으로 결과 공개를 닫지 않는다.
                self.info(name + ' A3 1월 펼침·접힘·건너뛰기 클릭 단언',
                          {'reason': '시험 운전에서 검증; 1월은 재생 중 클릭 없이 관측'})
                self.run_toasts(page, name, reduced_month=reduced)
                self.overflow(page, name)
                return
            if trial:
                self.window_shot(page, name + '-collapsed')
            current = page.evaluate('() => (' + DOM_JS + ').run()')
            self.strip_assert(current['shown'], name + ' A3 조작할 띠가 재생 중 보임', current, trial)
            if not current['shown']:
                return
            button = page.locator('#bd-run').get_by_role('button', name='그래프 열기', exact=True)
            toggle = current['toggle'] or {}
            if self.check(current['toggleCount'] == 1 and toggle.get('text') == '그래프 열기',
                          name + ' A3 그래프 열기 단추 1개', current):
                b = button.first
                controls = toggle['controls']
                self.check(toggle['expanded'] == 'false' and bool(controls),
                           name + ' A3 접힘 aria-expanded=false·controls', controls)
                self.check(not current['spark'], name + ' A3 접힌 spark 숨김', current)
                bb = toggle['box']
                self.check(bb and bb['width'] >= 44 and bb['height'] >= 44,
                           name + ' A3 펼침 단추 ≥44×44', bb)
                self.strip_click(page, b, trial)
                self.record_held(page)
                expanded = page.evaluate("""id=>{const D=""" + DOM_JS + """;
                  const e=id?document.getElementById(id):null;
                  const b=[...document.querySelectorAll('#bd-run button')].find(b=>b.textContent.trim()==='그래프 접기');
                  return {run:D.run(),button:!!b,expanded:b?.getAttribute('aria-expanded'),
                    controls:b?.getAttribute('aria-controls'),visible:D.visible(e),
                    spark:!!e&&[...e.querySelectorAll('.bd-spark')].some(D.visible)};}
                """, controls)
                self.strip_assert(expanded['button'] and expanded['expanded'] == 'true' and
                           expanded['controls'] == controls and expanded['visible'] and expanded['spark'],
                           name + ' A3 그래프 접기·true·제어 영역 spark 보임', expanded['run'], trial, expanded)
                if trial:
                    self.window_shot(page, name + '-expanded')
                fold = page.locator('#bd-run').get_by_role('button', name='그래프 접기', exact=True)
                if fold.count() and fold.is_visible():
                    self.strip_click(page, fold, trial)
                    self.record_held(page)
                collapsed = page.evaluate('() => (' + DOM_JS + ').run()')
                t = collapsed['toggle'] or {}
                self.strip_assert(collapsed['shown'] and t.get('text') == '그래프 열기' and
                           t.get('expanded') == 'false' and not collapsed['spark'],
                           name + ' A3 다시 접힘·spark 숨김', collapsed, trial)
                self.strip_geometry(collapsed, name + ' 다시 접음', trial)
            skip = page.locator('#bd-skip')
            current = page.evaluate('() => (' + DOM_JS + ').run()')
            bb = current['skip']['box']
            if self.strip_assert(current['skip']['shown'] and bb and bb['width'] >= 44 and bb['height'] >= 44,
                                 name + ' A3 건너뛰기 보임·≥44×44', current, trial, bb):
                clicked = self.strip_click(page, skip, trial)
                # 건너뛰기 클릭(finishRun)까지 멈춘 시계 안에서 하고, 종료·결과는 시계를 풀고 기다린다.
                self.release_clock(page)
                ended = page.wait_for_function("""() => {
                  const D=""" + DOM_JS + """;
                  return !document.documentElement.classList.contains('bd-running') &&
                    (D.visible(document.querySelector('#bd-again')) ||
                     D.visible(document.querySelector('#bd-res-title')) ||
                     ((KCP.league.state().S||KCP.league.state().snap)?.phase==='review'&&
                      KCP.fxTurn?.state?.().playing!==true));
                }""", timeout=30000)
                if clicked:
                    self.check(bool(ended), name + ' A3 건너뛰기 뒤 종료·결과')
                else:
                    self.info(name + ' A3 건너뛰기 뒤 종료·결과',
                              {'observed': 0, 'reason': '클릭 전에 1월 재생 종료로 띠 사라짐'})
            self.run_toasts(page, name)
            self.overflow(page, name)
        finally:
            if held:
                self.release_clock(page, quiet=True)

    def run_toasts(self, page, name, reduced_month=False):
        records = page.evaluate('() => window.__ux2.runs')
        collapsed = [r for r in records if r['toggle'] and r['toggle']['expanded'] == 'false']
        limit = 120 if self.cfg == 'mobile' else 96
        def clear(r):
            b = r['box']
            return (r['shown'] and b is not None and
                    -2 <= r['dockTop']-b['bottom'] <= 24 and b['height'] <= limit and
                    len(r['points']) == 5 and not any(p['covered'] for p in r['points']))
        bad = [r for r in collapsed if not clear(r)]
        if reduced_month and not records:
            self.info(name + ' A3 접힌 띠 전체 관측 위치·지도 가림',
                      {'observed': 0, 'reason': '움직임 줄이기 즉시 재생'})
        else:
            self.check(bool(collapsed) and not bad, name + ' A3 접힌 띠 전체 관측 위치·지도 가림',
                       {'observed': len(collapsed), 'violations': bad[:3]})
        toasts = [r for r in records if r['toast']]
        collisions = [r for r in toasts if r['toastOverlap'] != 0]
        if reduced_month and not records:
            self.info(name + ' A3 보이는 토스트와 띠 교차 0',
                      {'observed': 0, 'reason': '움직임 줄이기 즉시 재생'})
        else:
            self.check(not collisions, name + ' A3 보이는 토스트와 띠 교차 0',
                       {'observed': len(toasts), 'collisions': collisions[:3]})
        self.info(name + ' A3 토스트 동시 관측 수(조건부)', len(toasts))

    def strip_geometry(self, r, name, trial=True):
        b = r['box']
        limit = 120 if self.cfg == 'mobile' else 96
        self.strip_assert(r['shown'] and b is not None and
                          -2 <= r['dockTop']-b['bottom'] <= 24 and b['height'] <= limit,
                          name + f' A3 도크 바로 위·높이 ≤{limit}px', r, trial)
        self.strip_assert(len(r['points']) == 5 and not any(p['covered'] for p in r['points']),
                          name + ' A3 지도 중심·사방 1/4 지점 띠 가림 0', r, trial, r['points'])

    def trial(self, page, name):
        self.hud(page, name + '-before')
        self.actions(page, name)
        close_drawer(page)
        page.evaluate('() => window.__ux2Arm()')
        # #56: 움직임 줄이기 시험(가짜 시계가 있는 판)은 누르기 전에 시계를 멈추고 띠가 보일 때까지만 앞당긴다(hold_clock).
        # 그 판의 '500ms 안 띠 표시'는 앞당긴 앱 시각(≤120ms)으로 재고, 실제 반응 시간은 움직임 판(시계 없음)이 잰다.
        held = self.hold_clock(page)
        try:
            page.locator('[data-run="7"]').click()
            if held:
                self.advance_until_strip(page, name + '-trial')
            else:
                # DOM 관찰자로 클릭 시각부터 잰다. Python/캡처의 왕복 시간을 500ms에 섞지 않는다.
                page.wait_for_function('() => window.__ux2.firstRun || document.querySelector("#bd-res-title")', timeout=30000)
            self.run_strip(page, name + '-trial', trial=True)
        finally:
            self.release_clock(page, quiet=True)
        page.wait_for_function("() => !document.documentElement.classList.contains('bd-running') && KCP.buildGame.lastTrial()?.days===7", timeout=30000)
        self.check(page.evaluate('() => KCP.buildGame.lastTrial()?.days') == 7,
                   name + ' A1 7일 시험 완료 기록')
        if shown(page, '#bd-again'):
            page.locator('#bd-again').click()
        close_drawer(page)
        self.hud(page, name + '-after-week')
        page.evaluate('() => {window.__ux2.armed=false;}')

    def ready(self, page):
        close_drawer(page)
        page.locator('#lg-ready').click()
        pass_issue_check(page)
        page.wait_for_function("""() => {const L=KCP.league.state(),S=L.S||L.snap;
          return S.phase!=='plan'||S.teams[L.team].ready||
            !!document.querySelector('#lg-ready-confirm')||!!document.querySelector('#lg-predict-skip');}
        """)
        if shown(page, '#lg-predict-skip'):
            page.locator('#lg-predict-skip').click()
        elif shown(page, '#lg-ready-confirm'):
            page.locator('[data-evidence="evening"]').click()
            page.locator('[data-pred]').select_option('down')
            page.locator('[data-confidence="fairly"]').click()
            page.locator('#lg-ready-confirm').click()

    def month(self, page, name, reduced):
        # 준비 클릭보다 먼저 켜 두어 즉시 공개되거나 곧 접히는 제목도 보존한다.
        page.evaluate('() => window.__ux2Arm()')
        self.ready(page)
        try:
            page.wait_for_function("""() => {
              const q=window.__ux2,L=KCP.league.state(),s=L.S||L.snap;
              return s.round===1&&s.phase==='review'&&KCP.fxTurn?.state?.().playing!==true&&
                (q.result.some(s=>s.titles.length)||q.stripTitles.length>0);
            }""", timeout=180000)
        except PlaywrightTimeoutError:
            pass  # 결과 카드·접힌 띠 미노출은 아래 A5 단언에서 FAIL로 기록한다.
        # A5가 끝날 때까지 서랍 닫기·띠 펼치기 등 카드 밖 클릭을 하지 않는다.
        # 첫 페이지도 다음 페이지와 같은 관측 시간을 준 뒤 넘긴다.
        page.wait_for_timeout(40 if reduced else 1000)
        frame(page)
        # 페이지식 카드도 실제 '다음' 단추로 각 제목을 노출한다(fx_event의 동일 UI 경로).
        count = page.locator(RESULT_CARD).count()
        for _ in range(max(0, count-1)):
            following = page.locator(RESULT_CARD + ':visible .fx-turn-card-nav').get_by_role('button', name='다음', exact=True)
            buttons = [b for b in following.all() if b.is_visible() and b.is_enabled()]
            if not buttons:
                break
            buttons[0].click()
            page.wait_for_timeout(40 if reduced else 1000)
        observation = page.evaluate('() => ({result:window.__ux2.result,stripTitles:window.__ux2.stripTitles})')
        samples, strip_titles = observation['result'], observation['stripTitles']
        titles = [t for sample in samples for t in sample['titles']]
        self.check(bool(titles or strip_titles),
                   name + ' A5 1월 결과 사건 카드·띠 제목 실제 표시',
                   {'cards': len(titles), 'strip': len(strip_titles)})
        # 자동 닫힘 뒤 예보 DOM을 기대 제목으로 읽지 않고, 결과 공개 당시 기록을 쓴다.
        expected = {t for sample in samples for t in sample['expectedTitles'] if t}
        if expected:
            self.check(expected <= {t['text'] for t in titles},
                       name + ' A5 모든 카드 제목 실제 노출',
                       {'expected': sorted(expected), 'seen': sorted({t['text'] for t in titles})})
        else:
            self.info(name + ' A5 카드 제목 관측 없음', {'strip': len(strip_titles)})
        unique = {json.dumps(t, ensure_ascii=False, sort_keys=True): t for t in titles}
        for i, t in enumerate(unique.values(), 1):
            self.check(t['ok'], f'{name} A5 제목 {i} 낱말 중간 줄바꿈 0', t)
        unique_strip = {json.dumps({k: v for k, v in t.items() if k != 'at'},
                                  ensure_ascii=False, sort_keys=True): t for t in strip_titles}
        for i, t in enumerate(unique_strip.values(), 1):
            self.check(t['ok'], f'{name} A5 접힌 띠 제목 {i} 낱말 중간 줄바꿈 0', t)
        simultaneous = [s for s in samples if s['toast']]
        # 구현 지시서 7은 '카드와 겹치지 않는 자리' 또는 '카드가 닫힌 뒤 보이기'를 모두 허용한다(총괄 판정 2026-10-25).
        # 그래서 동시 표시가 없으면(카드가 닫힐 때까지 미룸) 교차 0으로 본다. 동시 표시가 있으면 모두 교차 0이어야 한다.
        good = all(all(a == 0 for a in s['overlaps']) for s in simultaneous)
        if reduced:
            self.check(good, name + ' A6 결과 토스트가 사건 카드와 교차 0(동시 표시 또는 카드 뒤 표시)',
                       {'observed': len(simultaneous),
                        'collisions': [s for s in simultaneous if any(a != 0 for a in s['overlaps'])][:3]})
        else:
            self.info(name + ' A6 움직임 있음(채점 제외)',
                      {'observed': len(simultaneous), 'no_overlap': good, 'samples': simultaneous[-3:]})
        self.shot(page, name + '-event-cards')
        self.run_strip(page, name + '-month', reduced=reduced)
        self.run_toasts(page, name + '-month-late', reduced_month=reduced)
        page.evaluate('() => {window.__ux2.armed=false;}')
        self.overflow(page, name + '-month')

    def end(self, page, name):
        reviews = set()
        for _ in range(40):
            state = read(page)['S']
            if state['phase'] == 'end':
                break
            page.wait_for_function("() => !document.documentElement.classList.contains('bd-running') && KCP.fxTurn?.state?.().playing!==true", timeout=30000)
            wait_unfolded(page)
            for selector in ('#lg-coach-close', '#lg-guide-close'):
                if shown(page, selector):
                    page.locator(selector).click()
            # 카드를 닫고 다음 달로 간다. 저장본·round·결과를 주입하지 않는다.
            page.keyboard.press('Escape')
            close_drawer(page)
            previous = [state['round'], state['phase'], len(state.get('results', []))]
            if state['phase'] == 'plan':
                self.ready(page)
            else:
                if state['phase'] == 'review':
                    reviews.add(state['round'])
                page.locator('#lg-ready').click()
            page.wait_for_function(CHANGED_JS, arg=previous, timeout=180000)
            skip = page.locator('#bd-skip')
            if skip.count() and skip.is_visible():
                skip.click()
            self.overflow(page, name + f"-{state['round']}-{state['phase']}")
        state = read(page)['S']
        complete = state['phase'] == 'end' and state['round'] == 12 and len(state.get('results', [])) == 12
        if not self.check(complete and reviews == set(range(1, 13)), name + ' A4 12달 뒤 끝 단계 도달',
                          {'phase': state['phase'], 'round': state['round'], 'reviews': sorted(reviews)}):
            return
        wait_unfolded(page)
        page.wait_for_selector('#lg-panel', state='visible')
        # 기존 끝 그래프 검사의 최종 관측 시각(1.5초)까지 기다린 뒤 폭을 잰다.
        # 등장 중의 0→점수 애니메이션을 최종 길이로 잘못 판정하지 않는다.
        page.wait_for_timeout(1600)
        frame(page)
        panel = page.locator('#lg-panel').bounding_box()
        viewport = page.evaluate('() => ({w:innerWidth,h:innerHeight})')
        self.check(panel and panel['width'] >= viewport['w']-32, name + ' A4 결과 서랍 전폭', panel)
        if self.cfg == 'desktop':
            self.check(panel and panel['height'] >= viewport['h']*.6, name + ' A4 desktop 서랍 높이 ≥60%', panel)
        trials = page.locator('[data-run="7"]')
        self.check(all(not b.is_visible() or b.is_disabled() for b in trials.all()),
                   name + ' A4 끝 시험 숨김 또는 비활성')
        for selector in ('#lg-final-summary', '.lg-fx-end', '#lg-y2022-end', '#lg-reflect', '.lg-rankrow'):
            self.check(page.locator('#lg-panel ' + selector).count() > 0,
                       name + ' A4 기존 내용 유지 ' + selector)
        self.shot(page, name + '-end')  # 필수 1280·390: --cfg all에서 둘 다 저장.
        chart = page.locator('#lg-rank #lg-rank-chart')
        if self.check(chart.count() == 1, name + ' A4 순위 그래프 1개'):
            chart.scroll_into_view_if_needed()
            frame(page)
            self.rank_chart(page, name)
            self.shot(page, name + '-end-rank')
            page.emulate_media(media='print')
            printed = chart.evaluate(r"""e=>{const D=""" + DOM_JS + r""";
              const painted=n=>{const s=getComputedStyle(n),opaque=c=>c&&c!=='none'&&
                c!=='transparent'&&!/rgba\([^)]*,\s*0\s*\)/.test(c)&&!/[ /]0\)$/.test(c);
                return opaque(s.backgroundColor)||
                  ['Top','Right','Bottom','Left'].some(k=>parseFloat(s['border'+k+'Width'])>0&&
                    s['border'+k+'Style']!=='none'&&opaque(s['border'+k+'Color']))||
                  (n instanceof SVGElement&&n.matches('rect,path,line,polygon,polyline,circle,ellipse')&&
                    (opaque(s.fill)||opaque(s.stroke)));};
              const bars=[...e.querySelectorAll('[aria-label], [role="img"]')].filter(n=>
                /^\d+위 .+, 종합 \d+(\.\d)?점\(100점 만점\)$/.test(D.accessible(n)));
              return {shown:D.visible(e)&&getComputedStyle(e).display!=='none',
                painted:bars.some(b=>[b,...b.querySelectorAll('*')].some(n=>D.visible(n)&&painted(n)))};}
            """)
            self.check(printed['shown'], name + ' A4 print 그래프 보임', printed)
            self.check(printed['painted'], name + ' A4 print 막대 배경 또는 테두리 비투명', printed)
            self.shot(page, name + '-end-print')
            page.emulate_media(media='screen')
        self.overflow(page, name + '-end')
        fold = page.locator('#lg-panel-fold')
        if self.check(fold.count() == 1 and fold.is_visible(), name + ' A4 접기 단추 존재'):
            fold.click()
            frame(page)
            hit = page.evaluate("""() => {const D=""" + DOM_JS + """,r=D.mapBox();
              return r?document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2)?.tagName:null;}""")
            self.check(hit == 'CANVAS', name + ' A4 접은 뒤 지도 중심 CANVAS', hit)
            self.shot(page, name + '-end-map')

    def rank_chart(self, page, name):
        data = page.locator('#lg-rank-chart').evaluate(r"""chart=>{const D=""" + DOM_JS + r""";
          const accessible=D.accessible;
          const candidates=[...chart.querySelectorAll('[aria-label], [role="img"]')]
            .filter(n=>/^\d+위 /.test(accessible(n)));
          // 중첩 role=img/aria-label은 같은 막대를 두 번 세지 않는다.
          const bars=candidates.filter(n=>!candidates.some(c=>c!==n&&n.contains(c)));
          const labels=[...chart.querySelectorAll('*')].filter(n=>D.visible(n)&&
            ![...n.children].some(c=>c.textContent.trim()===n.textContent.trim()));
          const ticks=['0','25','50','75','100'].map(t=>{
            const nodes=labels.filter(n=>n.textContent.trim()===t);
            return {text:t,boxes:nodes.map(D.box)};});
          const below=chart.nextElementSibling;
          const texts=[...new Set([...labels,...(below?[below,...below.querySelectorAll('*')]:[])])]
            .filter(D.visible).map(n=>n.textContent.trim());
          return {shown:D.visible(chart),bars:bars.map(b=>({name:accessible(b),box:D.box(b),shown:D.visible(b),
              team:b.getAttribute('data-team')||b.closest('[data-team]')?.getAttribute('data-team'),
              me:b.getAttribute('data-me')==='true'||b.closest('[data-me="true"]')!==null||
                b.textContent.includes('내 도시')||(b.parentElement.textContent.includes('내 도시')&&
                  bars.filter(other=>b.parentElement.contains(other)).length===1)})),ticks,texts,
            rows:[...document.querySelectorAll('#lg-rank .lg-rankrow[data-team]')].map(r=>({
              team:r.dataset.team,text:r.textContent,total:r.querySelector('[data-total]')?.textContent})),
            active:(KCP.league.state().S||KCP.league.state().snap).active,
            own:KCP.league.state().team};}
        """)
        bars, rows = data['bars'], data['rows']
        self.check(data['shown'], name + ' A4 그래프 보임')
        self.check(len(bars) == len(data['active']) and len(bars) > 0,
                   name + ' A4 도시 수만큼 막대', data)
        self.check(all(t['boxes'] for t in data['ticks']), name + ' A4 눈금 0·25·50·75·100 보임', data['ticks'])
        # 0/100 눈금 중심 사이 = 축 0~100의 실제 화면 폭. data-score/style.width를 기대값으로 쓰지 않는다.
        axes = [(z['left']+z['right'])/2-(a['left']+a['right'])/2
                for a in data['ticks'][0]['boxes'] for z in data['ticks'][-1]['boxes']
                if abs((a['top']+a['bottom'])/2-(z['top']+z['bottom'])/2) <= 2 and z['left'] > a['left']]
        axis = max(axes) if axes else 0
        self.check(axis > 0, name + ' A4 축 0~100 폭 관측', axes)
        matched = set()
        own_distinct = False
        for i, b in enumerate(bars, 1):
            m = BAR_NAME.fullmatch(b['name'])
            self.check(bool(m), f'{name} A4 막대 {i} 접근성 이름 형식', b)
            if not m:
                continue
            score, city = float(m[3]), m[2]
            candidates = [r for r in rows if (r['team'] == b['team'] if b['team'] else city in r['text'])]
            nums = re.findall(r'(?<![\d.])\d+(?:\.\d+)?', candidates[0]['total'] or '') if len(candidates) == 1 else []
            same = len(nums) == 1 and f'{float(nums[0]):.1f}' == f'{score:.1f}'
            self.check(same, f'{name} A4 막대 {i} 기존 순위 총점 소수 1자리 일치', {'bar': b, 'rows': candidates})
            if same:
                matched.add(candidates[0]['team'])
                if candidates[0]['team'] == data['own']:
                    own_distinct = b['me']
            ratio = b['box']['width']/axis if axis else None
            self.check(0 <= score <= 100 and ratio is not None and abs(ratio-score/100) <= .02,
                       f'{name} A4 막대 {i} 길이/축 = 점수/100 ±2%', {'ratio': ratio, 'score': score, 'bar': b})
        self.check(matched == set(data['active']), name + ' A4 모든 도시 일대일 점수 대조', sorted(matched))
        self.check(own_distinct and sum(b['me'] for b in bars) == 1, name + ' A4 내 도시 막대 구별')
        for text in ('종합 점수(점)', '막대 길이는 종합 점수(0~100점, 높을수록 좋음·모형 계산·게임 가정)'):
            self.check(text in data['texts'], name + ' A4 그래프 설명 보임 ' + text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('--cfg', choices=[*CFG, 'all'], default='all')
    parser.add_argument('--out', type=Path, default=RESULTS/'ux_s2fix2')
    args = parser.parse_args()
    suites = [Suite(cfg, args.out) for cfg in (CFG if args.cfg == 'all' else [args.cfg])]
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            try:
                for suite in suites:
                    for reduced in (False, True):
                        label = 'reduce' if reduced else 'motion'
                        # 움직임 줄이기 시험(약 0.57초)만 띠 조작·캡처 동안 앱 시계를 멈춘다(hold_clock·window_shot, #56).
                        suite.case(browser, args.base, label+'-trial', suite.trial, reduced,
                                   freeze_shots=reduced)
                        def month_case(page, name, reduced=reduced, suite=suite):
                            suite.month(page, name, reduced)
                        suite.case(browser, args.base, label, month_case, reduced)
                    # A3/A5 실패가 필수 끝 화면 캡처를 막지 않도록 새 판에서 별도 완주한다.
                    suite.case(browser, args.base, 'end', suite.end)
                    suite.check(not suite.events, '콘솔 error/warning·pageerror 0', suite.events)
            finally:
                browser.close()
    except Exception as exc:
        for suite in suites:
            suite.check(False, '브라우저 실행기 예외', f'{type(exc).__name__}: {exc}')
    RESULTS.mkdir(parents=True, exist_ok=True)
    summaries = [suite.summary() for suite in suites]
    for result in summaries:
        (RESULTS/f'ux_s2fix2-{result["cfg"]}.json').write_text(
            json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    passed, failed = (sum(r[key] for r in summaries) for key in ('pass', 'fail'))
    print(f'PASS {passed} / FAIL {failed}', flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
